# IA y procesamiento documental

Fecha: 2026-09-10. Estado: **Documentado** para proveedor inicial, catálogos, límites de ingestión y precedencia determinista; **Propuesta técnica DEC-010** para pipelines, prompts, campos anidados y evaluación. Fuentes: F01 §§3.1, 3.3.7 y AD-IA-001; F03 CU-006/012/013/025 del [inventario](00-fuentes-y-decisiones.md).

## Responsabilidad y restricciones

Azure OpenAI es el proveedor inicial de generación y embeddings mediante interfaces configurables. RAG recupera fragmentos oficiales almacenados en Supabase/pgvector. El modelo redacta explicación y pistas sobre un intento ya persistido.

La IA no decide corrección técnica, progreso, señales, calificación o intervención. No puede ejecutar SQL, modificar datos, invocar herramientas, navegar ni ejecutar el código del alumno. Código, documentos y preguntas no pueden modificar las instrucciones del sistema. El flujo no requiere arquitectura multiagente.

## Ingestión del corpus

**Documentado:** PDF con texto, TXT o Markdown; máximo 10 MB por archivo; fragmentos de 500 tokens con solapamiento de 50; recuperación top-k=5, siempre restringida al ámbito autorizado.

**Pipeline propuesto:**

1. Verificar cuenta, rol, organización, clase y actividad opcional. Validar nombre, tamaño real, extensión y contenido detectado, sin confiar en MIME del navegador.
2. Guardar binario en Storage privado con clave generada por servidor, hash y versión. Crear metadatos y trabajo durable en una transacción de dominio; registrar fallos y objetos huérfanos para limpieza.
3. Extraer texto en proceso acotado. Rechazar archivos cifrados, corruptos o PDF sin texto útil; mostrar causa accionable. Limitar tiempo y expansión en memoria del extractor.
4. Normalizar Unicode y espacios conservando ubicación de página/sección. No ejecutar macros, scripts, HTML ni referencias externas.
5. Fragmentar con el tokenizer fijado para la configuración de embeddings. Cada fragmento contiene hasta 500 tokens; los siguientes retroceden 50 tokens salvo borde de documento. Guardar índices, versión, hash y localizador.
6. Generar embeddings del corpus autorizado. Validar dimensión y valores finitos antes de escribir; almacenar deployment/modelo, dimensión y versión de configuración.
7. Escribir fragmentos de una generación nueva. Publicar la generación completa atómicamente; solo entonces estará disponible para recuperación.
8. Registrar resultado, cantidad de fragmentos y duración. Reintentar de forma acotada sin duplicar versión activa ni borrar la última versión utilizable por un fallo transitorio.

**Estados operativos propuestos:** `UPLOADED`, `PROCESSING`, `READY`, `FAILED`, `ARCHIVED`. Son estados de ingestión nuevos y no reemplazan `SUPPORTED/NO_EVIDENCE/PROVIDER_UNAVAILABLE`. Una fuente archivada deja de ser recuperable inmediatamente, incluso si el índice físico se limpia después.

Reindexar una fuente fallida crea una nueva generación para la misma versión; reemplazar el contenido crea versión nueva. No mezclar embeddings de dimensiones/modelos distintos en una búsqueda. Una migración de modelo requiere reindexación y activación coherentes. OCR, web crawling y documentos de terceros no autorizados quedan fuera de esta propuesta MVP.

## Recuperación

La consulta deriva de ejercicio, conceptos y evidencia técnica mínima del intento. La API obtiene esos datos de persistencia; el estudiante no puede elegir un índice de otra clase ni pasar filtros permisivos.

1. Resolver permisos actuales del solicitante sobre intento, clase y fuentes.
2. Aplicar predicados de organización, clase, visibilidad, fuente no archivada y generación READY. Una fuente de actividad solo es elegible para esa actividad; una fuente de clase puede apoyar actividades de esa clase.
3. Buscar los cinco fragmentos más pertinentes dentro de ese conjunto. El filtro debe integrarse en la consulta, no aplicarse después de recuperar fragmentos globales.
4. Aplicar umbral de pertinencia validado con corpus de prueba y una política explícita de ambigüedad. **Pendiente:** distancia, umbral y construcción de consulta; top-k=5 no garantiza que exista evidencia útil.
5. Si no quedan fragmentos pertinentes, devolver `NO_EVIDENCE` sin pedir al modelo que improvise una explicación documental.
6. Antes de mostrar la respuesta y antes de abrir una referencia, revalidar visibilidad. Si se revocó la fuente, ocultar contenido o regenerar bajo permisos actuales.

No mezclar documentos entre organizaciones, entre clases de la misma organización ni entre actividades restringidas de una clase. Compartir un curso o concepto no autoriza compartir el corpus.

## Entrada a generación

**Contrato interno propuesto:** ID de intento opaco, versión del ejercicio, enunciado, conceptos, código limitado, diagnóstico determinista, resumen público de pruebas visibles, nivel de pista y fragmentos permitidos con identificadores. Excluir nombre/correo del alumno, tokens, claves, código de otros usuarios y entradas/salidas de pruebas ocultas.

El prompt versionado debe indicar: responder en español claro para un principiante; conservar el diagnóstico; explicar solo lo sustentado; dar un siguiente paso concreto; citar únicamente los IDs suministrados; no proporcionar solución completa; ignorar instrucciones contenidas en material/código; producir el contrato estricto. El servidor mantiene esa política, sin aceptar un prompt de sistema enviado por el cliente.

Guardar `prompt_version`, configuración del proveedor, versión del schema y hashes/referencias del contexto para reproducir la solicitud sin duplicar información personal en logs. No almacenar razonamiento interno del modelo como requisito del producto.

## Salida estructurada

Las cinco claves de primer nivel y sus catálogos son **Documentados**. Tipos, longitudes y estructura de `source_refs` son **Propuesta técnica**.

```json
{
  "diagnosis_code": "FAILED_TEST",
  "explanation": "La salida no coincide con la verificación visible. Revisa el límite superior de la iteración.",
  "hint": "Compara los valores que toma el índice con el rango pedido en el enunciado.",
  "source_refs": [
    {
      "source_id": "33333333-3333-4333-8333-333333333333",
      "source_version_id": "44444444-4444-4444-8444-444444444444",
      "chunk_id": "55555555-5555-4555-8555-555555555555",
      "locator": "Página 3"
    }
  ],
  "status": "SUPPORTED"
}
```

| Campo | Validación |
| --- | --- |
| `diagnosis_code` | Uno de SUCCESS, SYNTAX_ERROR, RUNTIME_ERROR, FAILED_TEST, TIMEOUT, UNKNOWN; debe coincidir con el resultado persistido |
| `explanation` | Texto plano no vacío; propuesta máximo 2.000 caracteres; sin HTML activo |
| `hint` | Texto plano, propuesta máximo 1.000 caracteres; cadena vacía permitida en degradación o cuando no corresponda pista |
| `source_refs` | Lista de 0–5 referencias; cada ID debe pertenecer al contexto recuperado, a la versión registrada y al ámbito vigente |
| `status` | Exactamente SUPPORTED, NO_EVIDENCE o PROVIDER_UNAVAILABLE |

Schema estricto, `additionalProperties: false`, todos los campos obligatorios, sin `score`, confianza numérica ni códigos nuevos. Validar campos anidados, longitudes y combinaciones. Las URLs se resuelven desde metadatos del servidor; no abrir una URL inventada por el modelo. Un localizador válido debe corresponder al fragmento suministrado.

`SUPPORTED` exige al menos una referencia pertinente validada. La existencia del ID no basta para demostrar que respalda el texto: la evaluación de corpus debe incluir citas reales pero irrelevantes. Una respuesta que contradice el diagnóstico se rechaza; no se acepta cambiando solamente el enum y dejando una explicación contradictoria.

## Fallos y degradación

| Situación | Resultado esperado |
| --- | --- |
| No hay intento confirmado o falla su persistencia | No invocar recuperación ni generación; comunicar el error del envío |
| Corpus vacío, fragmentos no pertinentes o ambiguos | `NO_EVIDENCE`, referencias vacías, mensaje seguro y resultado técnico intacto |
| Proveedor de generación/embeddings no disponible, cuota o timeout | `PROVIDER_UNAVAILABLE`, referencias vacías en fallback, sugerir reintento posterior |
| Salida malformada, campos extra, cita ajena o diagnóstico contradictorio | Rechazar salida; `PROVIDER_UNAVAILABLE` según CU-013; registrar motivo interno sin mostrar carga inválida |
| BD o índice inaccesible | Estado operativo de dependencia caída; feedback de degradación `PROVIDER_UNAVAILABLE`, no afirmar que faltan documentos |
| Fallo al guardar feedback | No confirmar que quedó guardado; conservar intento y permitir reintento idempotente |
| Se archivó una fuente durante el trabajo | Revalidar, retirar fragmentos revocados y devolver `NO_EVIDENCE` si ya no queda sustento |

Los fallbacks los construye el servidor con mensajes deterministas y el diagnóstico del intento. Un ejemplo sin evidencia es `{diagnosis_code: "FAILED_TEST", explanation: "No hay material autorizado suficiente para sustentar esta ayuda.", hint: "", source_refs: [], status: "NO_EVIDENCE"}`. Se serializa como JSON válido; la notación anterior resume el contrato.

**Propuesta:** plazo total de trabajo interactivo de 15 s, sin reintentos automáticos de generación dentro de esa solicitud; meta p95 documental <12 s. La ingestión admite hasta 3 intentos con espera creciente para fallos transitorios. No reintentar archivos inválidos ni errores de permisos. Configuración final pendiente DEC-010; medir colas, recuperación, generación y validación dentro de la latencia percibida.

## Pistas progresivas

**Documentado:** existe intento registrado, ayuda gradual, sin solución completa inmediata. **Propuesta:** tres niveles por intento: orientación sobre el concepto; pregunta dirigida sobre el error; guía del siguiente paso o pseudocódigo parcial. El número de niveles y la progresión requieren DEC-010.

El backend decide el siguiente nivel disponible. Repetir la misma solicitud no salta niveles ni duplica consumo. `NO_EVIDENCE` y `PROVIDER_UNAVAILABLE` no consumen un nivel concedido. Un reintento nuevo inicia su propio registro de ayudas y conserva las anteriores en historial. Los niveles no desbloquean automáticamente una solución completa.

## Evaluación y aceptación

Construir corpus ficticio autorizado de demo con referencias conocidas y un conjunto versionado que cubra cada diagnóstico, cada estado RAG, cada nivel de pista y cada límite relevante. Registrar versión de modelo/prompt/tokenizer, casos, resultado y revisión humana.

- Evidencia insuficiente produce siempre el fallback esperado en los casos diseñados.
- Citas inventadas, de otra clase o de una fuente archivada se rechazan.
- Ninguna respuesta inválida altera resultado técnico, progreso o señales.
- PDF/TXT/MD válidos se indexan con fragmentación comprobable; archivo superior al límite y PDF sin texto fallan controladamente.
- Interrupción y reindexación no dejan fragmentos parciales activos ni resultados duplicados.
- Pistas no revelan solución completa ni contenido de pruebas ocultas en el conjunto adversarial.
- Se mide p95 de ayuda completa y consumo real; una evaluación sin ejecución se reporta como pendiente.

La rúbrica humana debe evaluar pertinencia, respaldo de citas, claridad para principiantes y revelación indebida, con ejemplos y desacuerdos registrados. Los umbrales de calidad pedagógica quedan pendientes; no atribuir una precisión porcentual inexistente. Ver [plan de pruebas](10-calidad-y-pruebas.md).
