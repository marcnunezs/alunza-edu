# IMP-04 — Fuentes y ayuda contextual con IA/RAG

Estado inicial: **pendiente de implementación**. La fase cierra principalmente ALZ-RF-006/012/013/025 y completa la verificación integrada de degradación IA de ALZ-RF-010. Los artefactos, división de trabajo y precisiones nuevas son propuestas; este documento no acredita evaluación de IA ni integración con proveedores.

## Resultado y demostración de la fase

Un profesor carga material ficticio autorizado, observa su procesamiento y comprueba que una versión completa queda disponible. Un estudiante con intento propio persistido solicita ayuda, recibe explicación y pista con diagnóstico intacto y puede abrir la referencia correcta. Un administrador gobierna fuentes y visibilidad de su ámbito usando el mismo servicio de ingestión.

La demostración debe mostrar los tres estados `SUPPORTED`, `NO_EVIDENCE` y `PROVIDER_UNAVAILABLE`, una reindexación fallida recuperable y una fuente archivada que deja de recuperarse. Otra clase u organización no puede influir en las referencias ni recibir contenido ajeno. En todos los casos el intento y el resultado técnico permanecen disponibles; se puede seguir ejecutando, enviando y reintentando.

## Lecturas, entradas y dependencias

Leer [IA y procesamiento](../../specs/08-ia-y-procesamiento.md), [fuentes y decisiones](../../specs/00-fuentes-y-decisiones.md), [arquitectura](../../specs/05-arquitectura.md), [datos](../../specs/06-modelo-de-datos.md), [API](../../specs/07-api-y-contratos.md), [guía IA/RAG](../agent/07-ia-y-rag.md) y [seguridad](../agent/09-seguridad-y-permisos.md). Conservar escenarios de [aceptación](../../specs/03-flujos-y-criterios-de-aceptacion.md).

- IMP-01 aporta identidad, permisos vigentes, aislamiento y auditoría. ADMIN de gobierno no recibe acceso pedagógico general por su rol.
- IMP-02 aporta clases, actividades, ejercicios y conceptos versionados. Una fuente de actividad pertenece a esa clase; compartir curso o concepto no permite compartir corpus.
- IMP-03 aporta el intento confirmado y el resumen técnico público. Recuperación y generación de ayuda leen esa evidencia desde persistencia.
- IMP-00 aporta interfaces/configuración y ensayo temprano de Azure OpenAI, embeddings y schema cuando el entorno lo permite. En esta fase se repite con el corpus, filtros, trabajos y configuración finales.
- Las operaciones de ingestión autorizada son independientes de un intento estudiantil. Se pueden adelantar IMP-04.01–04.03 al estabilizar IMP-02; solo las tareas de ayuda sobre intentos esperan IMP-03.

IMP-05 depende de práctica y evidencia determinista, no de esta fase. Si Azure OpenAI está temporalmente indisponible, avanzar reglas, progreso y tablero conserva valor y evita acoplar decisiones académicas al modelo.

| Decisión | Qué concretar con evidencia | Trabajo que puede avanzar mientras tanto |
| --- | --- | --- |
| DEC-010 | Deployment/modelo, dimensión, tokenizer, extractor, distancia/umbral, ambigüedad, niveles, timeout y reintentos; unidad de 10 MB | Interfaces, schema estricto, corpus etiquetado, fallbacks y ensayos locales marcados como tales |
| DEC-004 | API de trabajos, deduplicación, adquisición/lease, respuesta durable, consulta de estado, cancelación y recuperación | Implementación reversible de contratos y pruebas de concurrencia; no `202` sin persistencia |
| DEC-006 | Fuentes/versiones/generaciones/fragmentos, claves de alcance, relación con intentos y RLS | Diccionario y migraciones locales revisadas |
| DEC-008 | Perfil, muestra, concurrencia, región, costo y medición de ayuda completa | Instrumentación y preparación del experimento; no p95 inferido de mocks |
| DEC-009/012 | Corpus ficticio canónico y condiciones institucionales antes de datos reales | Demo sin datos reales, fixtures adversarios separados y referencias reproducibles |

Azure OpenAI es el proveedor inicial de generación y embeddings; PostgreSQL/pgvector recupera y Storage privado guarda archivos. No se sustituye por otro proveedor, motor vectorial, AI Gateway o arquitectura multiagente. Las interfaces aíslan SDK y configuración de las reglas de dominio NestJS.

## Incrementos en orden

Los ocho incrementos comienzan **pendientes**. Cada uno deja una capacidad comprobable y evidencia propia. No se considera RF-006 listo por subir un archivo si todavía no puede indexarse y recuperarse de forma autorizada.

| Incremento | Resultado observable | Artefactos propuestos | Comprobaciones para cerrar el incremento |
| --- | --- | --- | --- |
| IMP-04.01 Contratos, permisos y evaluación base | Una fuente y una solicitud de ayuda tienen alcance, versiones y salidas inequívocos; un caso etiquetado expresa qué evidencia debería sustentarlo | Puertos de extracción/embeddings/recuperación/generación, schema RAG, modelo de generaciones/trabajos, corpus inicial y registro DEC-004/010 | Tres estados, cinco campos, referencia ajena y diagnóstico cambiado rechazados; permisos docente/admin/estudiante; casos con y sin sustento y requisitos de configuración |
| IMP-04.02 Carga y gestión visible | Profesor y ADMIN autorizado cargan un archivo válido y consultan estado/metadatos; el inválido se rechaza con causa útil | API NestJS, Storage privado, metadatos/versiones, trabajo durable, carga y listado por rol; limpieza de objetos huérfanos | PDF con texto/TXT/MD, tamaño real/tipo detectado, PDF sin texto/cifrado/corrupto, metadatos incompletos y ámbito ajeno; no confirmar carga utilizable parcial |
| IMP-04.03 Indexación, reindexación y archivo | Una generación completa puede buscarse; una falla no reemplaza la anterior; archivo excluye inmediatamente la fuente | Worker durable, extractor acotado, tokenizer 500/50, adaptador Azure OpenAI embeddings, pgvector, publicación atómica, pantalla de reintento y gobierno | Caída/reanudación, doble entrega, lease vencido, dimensión errónea, valores no finitos, cambio de modelo, publicación concurrente, archivo durante indexación y ausencia de fragmentos parciales activos |
| IMP-04.04 Recuperación autorizada | Un intento propio encuentra hasta cinco fragmentos pertinentes solo de su ámbito; corpus insuficiente produce fallback | Constructor de consulta desde evidencia pública, filtros SQL/RLS previos a ranking, recuperación top-k=5, pertinencia y política de ambigüedad | Señuelos más similares de otra organización/clase/actividad excluidos; corpus vacío/irrelevante; fuente archivada; falta de intento implica cero recuperación y embeddings de consulta |
| IMP-04.05 Feedback durable y validado | Desde el intento se solicita ayuda, se observa el trabajo y se obtiene SUPPORTED o fallback consultable | Endpoint de solicitud durable, consumidor, adaptador de generación, prompt/schema versionados, validador semántico, persistencia e interfaz de feedback | `202` después de commit del trabajo; cinco campos exactos; diagnóstico/citas/localizador coherentes; salida inválida descartada; fallo de persistencia de feedback no confirmado como guardado |
| IMP-04.06 Pistas y referencias completas | El estudiante pide la siguiente ayuda permitida y abre documento/ubicación sin saltar niveles ni perder historia | Reserva atómica de nivel e idempotencia, UI de pistas, evento de entrega, lectura privada/revalidación de cita, historial por intento | Clave repetida sin doble consumo; niveles inválidos; fallbacks no consumen nivel; intento nuevo conserva ayudas anteriores; revocación entre generación, lectura y apertura de documento |
| IMP-04.07 Fallos e inyección de instrucciones | Una caída o contenido malicioso no altera dominio, expone fuentes ajenas ni bloquea práctica | Batería adversaria, errores deterministas, recuperación de trabajos y métricas seguras; endurecimiento según resultados | Proveedor/índice/BD caídos distinguidos de no evidencia; JSON extra/`score`, cita inventada/irrelevante y contradicción; documentos/código que piden revelar tests o ejecutar herramientas; reintento técnico sigue funcionando |
| IMP-04.08 Evaluación y aceptación integrada | El recorrido real queda reproducible con calidad, latencia y límites documentados | Cypress del flujo, integración real Storage/pgvector/Azure OpenAI, corpus/rúbrica versionados, registro RF/PT/RNF, manuales y configuración | E1–E4 de RF-006/012/013/025; ALZ-HU-010-E4 y orden commit→RAG; evaluación humana registrada por quien participe realmente; p95/consumo medidos y pendientes explícitos |

La preparación de corpus y fixtures atraviesa todos los incrementos. Los dobles controlados prueban fallos, permisos y contrato; la integración de embeddings y generación con Azure OpenAI se comprueba separadamente. Sin proveedor configurado puede existir código y prueba local, pero el cierre de integración queda pendiente.

## Diseño de trabajo que debe quedar concretado

### Corpus, versiones y durabilidad

La carga admite PDF con texto extraíble, TXT y Markdown de hasta 10 MB. La interpretación de 10.000.000 bytes es propuesta DEC-010. Se valida tamaño real y tipo por contenido; no basta MIME o extensión enviados por el cliente. No se incorpora OCR, descarga de URLs arbitrarias ni ejecución de contenido del archivo.

Cada archivo conserva hash, versión, organización, clase y actividad opcional. El extractor opera con presupuesto de memoria/tiempo y conserva localizadores. La fragmentación usa el tokenizer fijado: hasta 500 tokens y 50 de solapamiento salvo bordes. Se registra índice, texto, conteo y hash por fragmento junto a versión de extractor/tokenizer/configuración.

El modelo propuesto distingue:

| Entidad o estado | Significado que debe probarse |
| --- | --- |
| Fuente | Identidad gobernable, permisos y ámbito actual |
| Versión de contenido | Binario/texto y localizadores inmutables; reemplazar contenido crea otra versión |
| Generación de índice | Embeddings de una configuración homogénea; reindexar crea otra generación |
| Generación activa | Puntero publicado de forma atómica solo a un conjunto completo y autorizado |
| `UPLOADED/PROCESSING/READY/FAILED/ARCHIVED` | Estados operativos propuestos de ingestión; no son estados de respuesta RAG |

Storage y PostgreSQL no comparten transacción. La tarea debe resolver confirmación de metadatos/trabajo, objetos huérfanos y compensación de fallos. El trabajo durable necesita adquisición atómica, lease recuperable, deduplicación y reintentos acotados. Un proceso en memoria no justifica `202` ni recuperación después de reiniciar.

Antes de activar se valida cantidad, dimensión y valores finitos de embeddings. No se mezclan modelos/dimensiones en una consulta. Una reindexación fallida conserva la última generación utilizable si sigue autorizada. Archivar invalida recuperación inmediatamente mediante permisos/predicados, aunque la limpieza física del índice ocurra después. Una generación terminada tarde no debe reactivar una fuente archivada.

### Recuperación y contexto permitido

Para una ayuda sobre un intento, el orden obligatorio es: comprobar intento confirmado → resolver permisos vigentes → construir consulta mínima → filtrar en la consulta vectorial → recuperar top-k=5 → evaluar pertinencia → generar/validar → revalidar antes de entregar. La API lee del servidor código, ejercicio, conceptos, diagnóstico y evidencia; el cliente no elige filtros permisivos ni aporta un diagnóstico confiable.

Los filtros integran organización, clase, actividad compatible, visibilidad, fuente no archivada y generación activa completa. No se buscan fragmentos globales para filtrarlos después. Una fuente de clase puede sustentar actividades de esa clase; una fuente restringida a actividad solo la actividad correspondiente. Probar fuente señuelo muy pertinente en cada ámbito prohibido.

El contexto al modelo excluye identidad personal innecesaria, secretos, código ajeno, entradas/resultados esperados ocultos y stdout/stderr de casos ocultos. Incluye solo evidencia pública del intento, código limitado, nivel permitido y fragmentos autorizados con IDs. El prompt del servidor exige español claro, siguiente paso concreto, conservación del diagnóstico, citas suministradas y ayuda gradual sin solución completa inmediata.

Código, preguntas y documentos se tratan como datos sin autoridad para cambiar instrucciones. El modelo no recibe herramientas, SQL, navegación, permisos de escritura ni capacidad de ejecutar código. No determina progreso, señales, nota o intervención.

### Salida estricta y fallbacks

Las cinco claves son obligatorias y únicas; `additionalProperties: false` también se aplica donde corresponda a objetos anidados. No se agrega `score`, confianza numérica ni razonamiento interno.

| Campo exacto | Validación prevista |
| --- | --- |
| `diagnosis_code` | Uno de `SUCCESS`, `SYNTAX_ERROR`, `RUNTIME_ERROR`, `FAILED_TEST`, `TIMEOUT`, `UNKNOWN`; coincide con el diagnóstico persistido |
| `explanation` | Texto plano no vacío; máximo propuesto 2.000 caracteres; no contradice resultado ni evidencia |
| `hint` | Texto plano; máximo propuesto 1.000 caracteres; puede ser vacío en degradación o si no corresponde pista |
| `source_refs` | Entre 0 y 5 referencias; IDs, versión y localizador deben pertenecer al contexto autorizado y respaldar la respuesta |
| `status` | Exactamente `SUPPORTED`, `NO_EVIDENCE` o `PROVIDER_UNAVAILABLE` |

Las referencias anidadas propuestas contienen `source_id`, `source_version_id`, `chunk_id`, `locator`. El servidor resuelve enlaces desde metadatos, nunca desde URLs inventadas por el modelo. `SUPPORTED` exige al menos una referencia pertinente validada; un ID existente pero irrelevante no demuestra sustento. Una explicación contradictoria invalida toda la carga: no se corrige únicamente el enum.

| Condición | Conducta verificable |
| --- | --- |
| Intento sin confirmar o commit fallido | Cero recuperación, embeddings de consulta o generación de ayuda sobre ese intento |
| Corpus vacío, insuficiente, irrelevante o ambiguo | `NO_EVIDENCE`, referencias vacías, diagnóstico intacto; sin pedir al modelo que improvise evidencia |
| Proveedor de generación/embeddings, cuota, plazo o índice inaccesible | `PROVIDER_UNAVAILABLE`, fallback construido por servidor y referencias vacías; no afirmar ausencia de material |
| Respuesta malformada, campos extra, cita falsa/ajena o contradicción | Descartar carga y devolver `PROVIDER_UNAVAILABLE` según CU-013; registrar motivo seguro |
| Feedback no se pudo guardar | No afirmar que quedó registrado; intento intacto y recuperación/reintento idempotente |
| Archivo o revocación durante el trabajo | Revalidar antes de entregar; retirar contexto revocado y devolver `NO_EVIDENCE` si no queda sustento |

Se conservan versiones de prompt, schema, proveedor y hashes/referencias del contexto para reconstruir la evaluación. No se copia material completo o cargas privadas a logs generales.

### Pistas, trabajos y latencia

La propuesta DEC-010 utiliza tres niveles por intento: orientación de concepto, pregunta dirigida y guía de siguiente paso o pseudocódigo parcial. La progresión y rúbrica requieren resolución; agotar niveles no desbloquea solución completa.

El backend decide el próximo nivel disponible y reserva idempotencia/nivel atómicamente. Repetir una clave no salta niveles ni duplica consumo. `NO_EVIDENCE` y `PROVIDER_UNAVAILABLE` no consumen un nivel concedido; un nuevo intento conserva historia y abre su propio registro de ayuda. El evento `HINT_DELIVERED` requiere entrega real, no simple solicitud o fallo.

El trabajo de feedback se confirma durablemente antes de responder `202`. El cliente consulta estado operativo y luego feedback validado; `QUEUED/RUNNING` no se incorporan al catálogo RAG. Un lease vencido o doble entrega debe reconciliar lo ya guardado y no producir dos ayudas ni consumir niveles dos veces.

La propuesta actual fija plazo interactivo total de 15 s, sin reintento automático de generación dentro de esa solicitud; la meta documentada es p95 <12 s. Ingestión propone hasta tres intentos con espera creciente para fallos transitorios, nunca para archivo inválido o acceso denegado. Estos detalles se resuelven en DEC-010; no se presentan como configuración aprobada. Medir cola, recuperación, generación, validación, persistencia y entrega: un `202` rápido no cumple por sí solo la meta de ayuda completa.

## Cobertura de aceptación y riesgos

| RF y trazabilidad del mismo número | Cobertura obligatoria E1–E4 y complemento |
| --- | --- |
| ALZ-RF-006 · HU/CU/PT-006 | Fuente válida 500/50/top-k=5; texto/metadatos inválidos; clase ajena; formato/tamaño. Reintento de indexación sin fragmentos parciales |
| ALZ-RF-012 · HU/CU/PT-012 | Ayuda gradual propia; intento ausente/nivel inválido; fuente o intento ajenos; falta de evidencia. Caída de proveedor y concurrencia sin consumo duplicado |
| ALZ-RF-013 · HU/CU/PT-013 | Cinco campos y cita válida; falta de contexto/entrada inválida/timeout; corpus ajeno; salida inválida. Diagnóstico y progreso siempre intactos |
| ALZ-RF-025 · HU/CU/PT-025 | Gobierno autorizado con versiones/fragmentos; archivo inválido; ampliación de alcance denegada; recuperación/reasignación entre ámbitos denegada y auditada |
| Integración ALZ-RF-010 · HU/CU/PT-010 | Persistencia previa a toda ayuda del intento, cero invocaciones ante fallo de commit y E4 con proveedor caído sin pérdida de resultado |

Vincular a RNF-IA-01–04, RNF-CON-01–03, RNF-REN-03/04 y controles aplicables de aislamiento y uso del [plan de pruebas](../../specs/10-calidad-y-pruebas.md). La independencia de progreso/señales se revalida con IMP-05 bajo RNF-IA-05; no se espera hasta entonces para aislar el módulo.

| Riesgo | Ensayo o tratamiento antes de aceptar |
| --- | --- |
| Dimensión/modelo/tokenizer incompatibles | Repetir ensayo temprano de IMP-00 con configuración real y corpus final; rechazar lotes incoherentes y probar cambio de generación |
| Cita existente pero poco pertinente | Corpus con citas correctas, irrelevantes y ambiguas; umbral/rúbrica versionados, revisión de respaldo real por afirmación |
| Inyección desde código o materiales | Casos que piden ignorar instrucciones, revelar tests/secretos, abrir herramientas o dar solución completa; comprobar salida y ausencia de efectos de dominio |
| Revocación produce fuga de contenido guardado | Pruebas durante indexación, recuperación, generación, lectura del feedback y apertura de cita; permisos vigentes en cada entrega |
| Worker reiniciado duplica consumo o pierde trabajo | Fallos y reentrega alrededor de adquisición, proveedor, persistencia y respuesta; leases e idempotencia observables |
| Latencia/cuota impide uso interactivo | Medir ayuda completa y consumo con perfil registrado; degradación explícita y práctica operativa, sin cambiar proveedor silenciosamente |

La evaluación usa corpus ficticio con versiones/localizadores conocidos y fixtures adversarios separados de los seis documentos canónicos de demo. La rúbrica humana cubre pertinencia, sustento de citas, claridad para principiantes, gradualidad y revelación indebida. Registrar participantes y desacuerdos reales; una revisión automática no acredita validación docente ni un porcentaje de precisión aprobado.

## Condición de cierre y siguiente fase

- [ ] RF-006/012/013/025 conservan E1–E4 y resultados reales enlazados; ALZ-HU-010-E4 se ejecutó con degradación integrada.
- [ ] PDF con texto, TXT y Markdown se procesan con fronteras, fragmentación y referencias verificadas; archivos inválidos se rechazan sin índice utilizable.
- [ ] Solo una generación completa, compatible y autorizada entra a recuperación; reindexación fallida y archivo preservan integridad e historia.
- [ ] Filtros de ámbito se aplican antes de recuperar; señuelos de otra clase/organización no aparecen en contexto, feedback ni citas.
- [ ] Intento y commit preceden a la ayuda correspondiente; la ingestión docente funciona independientemente.
- [ ] Las cinco claves y tres estados son estrictos; salida inválida, cita falsa y contradicción producen fallback sin alterar datos deterministas.
- [ ] Repeticiones, leases vencidos y concurrencia no duplican ayudas ni niveles; fallbacks no consumen ayuda concedida.
- [ ] Fuente revocada no se entrega mediante feedback antiguo, enlace temporal generado posteriormente o apertura de referencia.
- [ ] La integración real de Storage/pgvector/Azure OpenAI está documentada con configuración, resultado, consumo y latencia; pruebas con dobles se identifican aparte.
- [ ] Corpus, rúbrica y resultados están versionados; las revisiones humanas y decisiones pendientes se reportan sin atribuir aprobación inexistente.
- [ ] El recorrido técnico de IMP-03 sigue operativo durante fallas de IA; IMP-05 mantiene sus cálculos sin dependencia del LLM.

Continuar o integrar IMP-05 Evidencia determinista cuando esté disponible; esa rama puede haber avanzado en paralelo desde IMP-03. Después se completan gobierno y seguimiento en IMP-06 y verificación transversal en IMP-07. No se posterga hasta IMP-07 la seguridad o integridad necesarias para aceptar esta fase.

## Prompt de inicio acotado

```text
Lee AGENTS.md, docs/plan/04-ayuda-contextual.md y las guías IA/RAG, datos,
seguridad y pruebas pertinentes. Inspecciona el estado real y selecciona
únicamente el primer incremento pendiente de IMP-04 con dependencias listas.
Indica su ID, RF/HU/CU/PT, contratos, artefactos, pruebas y DEC aplicables.
Conserva Azure OpenAI, pgvector, Storage privado, filtros previos a retrieval,
500/50/top-k=5, cinco campos y tres estados RAG exactos, sin score.
La ayuda sobre una solución exige intento confirmado; la ingestión docente
autorizada no lo exige. Construye un recorrido real con trabajos durables,
aislamiento, fallbacks y pruebas de fallos. No presentes dobles de proveedor
como integración ni evaluación pedagógica real. Registra resultados y
pendientes; permite continuar trabajo determinista independiente de IA.
Cierra el incremento con evidencia y siguiente paso, sin iniciar otra fase
por omisión ni atribuir aprobaciones humanas que no existan.
```
