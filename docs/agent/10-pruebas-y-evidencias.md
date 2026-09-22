# Instrucciones para probar y documentar evidencias

## Cuándo aplicar y lecturas obligatorias

Aplica este manual al implementar comportamiento, corregir defectos, integrar proveedores o preparar una versión candidata. Selecciona pruebas según el riesgo y alcance del cambio. Para una corrección trivial de documentación basta revisar contenido, coherencia y enlaces; no construyas una suite de software sin propósito.

Lee el [AGENTS.md](../../AGENTS.md), [calidad y pruebas](../../specs/10-calidad-y-pruebas.md), [decisiones](../../specs/00-fuentes-y-decisiones.md), [requisitos](../../specs/02-requisitos-funcionales.md) y los [escenarios](../../specs/03-flujos-y-criterios-de-aceptacion.md) afectados. Añade los specs de datos, API, seguridad, ejecución, RAG y señales cuando el componente los use. Usa [frontend y UX](05-frontend-y-ux.md) para experiencia y [operación y entrega](11-operacion-y-entrega.md) para ambientes.

La línea base contiene 27 RF, 108 escenarios E1–E4, 29 RNF y 6 ORG. Son cobertura documental y obligaciones de verificación; no son pruebas aprobadas ni un porcentaje de software terminado. Mantén Jest, Cypress y GitHub Actions; comprueba versiones reales y compatibilidad antes de configurar herramientas.

## Preparar el caso antes de implementar la prueba

1. Identifica RF/HU/CU/PT y escenario E1–E4. Conserva el identificador original aunque lo descompongas en varias pruebas o añadas casos de frontera.
2. Define actor/estado, organización/clase, recurso/versiones, reloj, fixture y precondiciones. Construye al menos el caso permitido y los casos de entrada inválida, permiso insuficiente y particularidad que aplique al escenario.
3. Fija un resultado esperado independiente de la implementación: conteos conocidos, transición permitida, bytes/procesos observables, pertenencias, documento/cita verificable o secuencia temporal. No calcules el esperado llamando a la misma función que quieres probar.
4. Resuelve contradicciones que cambian el oráculo. Vincula el caso a DEC pendiente y regístralo Bloqueado cuando no pueda decidirse correctamente; sigue con pruebas independientes. No uses una suposición oculta como resultado aprobado.
5. Ejecuta en el ambiente autorizado que represente la garantía. Distingue un doble de proveedor, Docker local, Supabase real de prueba y servicio productivo de ensayo. Sus resultados no son intercambiables.
6. Si corriges un defecto importante, verifica que el caso observa el fallo antes de la corrección cuando sea viable y que después pasa por la razón esperada. No borres, omitas ni debilites una aserción para ocultar una regresión.

## Elegir el nivel de prueba

| Cambio | Prueba que debes priorizar | Límite de lo demostrado |
| --- | --- | --- |
| Regla pura, cálculo o transición | Jest con fixtures deterministas, reloj controlado y fronteras válidas/inválidas. | No demuestra permisos ni transacciones de base de datos. |
| DTO, catálogo o integración web/API | Esquema válido, campos extra/ausentes, tipos inválidos, serialización, errores y compatibilidad entre consumidores. | Un tipo TypeScript sin validación runtime no prueba rechazo de payloads. |
| Persistencia, RLS o autorización | Integración con migraciones, grants, rol real de aplicación, sesiones y Storage de prueba. | Un mock de repositorio o cuenta `service_role` no demuestra aislamiento. |
| Ejecutor o supervisor | Ensayo real y adversarial del adaptador afectado, resultados confiables y destrucción de recursos. | Un doble o Docker local no certifica Vercel Sandbox. |
| RAG/modelo | Contrato determinista con dobles y corpus adverso; integración acotada con proveedor configurado cuando corresponda. | El proveedor real no es oráculo de corrección del ejercicio ni una frase exacta es medida de calidad. |
| Pantalla o flujo de rol | Cypress sobre servicios integrados y revisión manual accesible para las interacciones afectadas. | Captura o E2E que simula todas las respuestas no demuestra persistencia o aislamiento. |
| Despliegue/recuperación | Arranque limpio, smoke híbrido, migraciones y restauración en destino de prueba verificado. | Una máquina previamente preparada o un build exitoso no demuestra guía reproducible. |

Reutiliza scripts y fixtures del repositorio cuando existan. Si faltan, crea los necesarios durante la implementación y documenta sus nombres reales. No pegues comandos inexistentes como si hubiesen pasado.

## Fixtures y datos de prueba

Versiona la demo canónica ficticia: 2 organizaciones, 2 administradores, 2 profesores, 8 estudiantes, 3 clases, 10 ejercicios y 6 documentos, dos por clase. DEC-012 propone su distribución; no presentes esa propuesta como aprobación previa. Usa fixtures adicionales aislados para negativos sin cambiar los totales del seed canónico.

Incluye dos clases de la misma organización para comprobar autorización por clase, además del aislamiento entre organizaciones. Prepara cuentas invitadas/deshabilitadas, actividades `DRAFT/PUBLISHED/CLOSED`, documentos admitidos/invalidables, los seis diagnósticos, tres estados RAG y casos positivos/negativos de las tres señales.

Usa un reloj inyectable para ventanas y vigencias; declara zona, límites inclusivos/exclusivos y orden antes de ejecutar. Usa datos fijos o generación con semilla registrada. Limpia únicamente datos y recursos creados por la prueba en el ambiente previsto; no reinicialices una base compartida ni retires recursos ajenos como parte de limpieza genérica.

## Matriz mínima por frontera crítica

| Frontera / requisitos | Casos que debes materializar | Evidencia que debes conservar |
| --- | --- | --- |
| Sesión y permisos; RF-001/020/021/022, RNF-SEG-01/05 | JWT inválido/vencido, cuenta deshabilitada y revocación con token anterior; rol válido sin clase; identificador de otra organización; invitación inválida; protección concurrente del último administrador. | Respuestas seguras y ausencia de cambios; consultas/Storage/vistas/vectores bajo identidades y roles reales. |
| Contenido y publicación; RF-004/005/023/024 | Versión publicada inmutable, transiciones inválidas, jerarquía cíclica, archivado con referencias, conflicto de edición y carrera admisión/cierre según DEC-002. | Versiones, orden, referencias y estado previo intactos ante rechazo. |
| Ejecutar y enviar; RF-009/010/011/014, RNF-SEG-04 y CON-01 | Práctica separada de envío; confirmación explícita del estudiante antes de solicitar admisión y cancelación sin ejecutar ni guardar; hash de suite/versión del arnés; intento persistido antes de RAG/modelo; rollback; respuesta perdida; reenvío idéntico; distinto payload con misma clave; dos solicitudes concurrentes; nuevo intento legítimo. | Secuencia de eventos/llamadas y ausencia de solicitud al cancelar; lectura posterior, unicidad y resultado técnico del arnés, sin tests ocultos en payloads. |
| Límites y aislamiento de código; RF-009, RNF-REN-02/SEG-04 | Proceso 128 MB/3 s/64 KB por separado del entorno 1 vCPU/2 GB; salida masiva, loop, memoria, red, archivos ajenos, procesos hijos y falsificación de resultado. | Mediciones y control de terminación/limpieza. Un flag de heap o un timeout de HTTP aislado no prueba el límite completo. |
| Ayuda y fuentes; RF-006/012/013/025, RNF-IA-01 a IA-04 | Fuente pertinente, ausente, ajena, revocada, cita inventada, instrucción maliciosa en documento, salida parcial/extra y proveedor caído; reintento y reindexación interrumpida. | Contrato exacto de cinco campos, tres estados, diagnóstico conservado y citas revalidadas. Intento intacto y ninguna fuente no autorizada. |
| Progreso y señales; RF-015/016/017/018/019/026, RNF-IA-05 | Denominador cero, intentos repetidos, éxito con todas las pruebas requeridas; umbrales antes/en/después; orden temporal; regla versionada; evento duplicado; confirmación de revisión, cancelación, revisión repetida/concurrente. | Cancelar conserva ACTIVE sin mutación; numerador/denominador y evidencia calculados independientemente; regla/fecha/autor persistidos; sin intervención del modelo. |
| Exportación y auditoría; RF-027, RNF-SEG-03/05 | Filtros antes de paginar/exportar, recurso ajeno, CSV con entradas interpretables como fórmulas, trabajo fallido y petición repetida. | Registros autorizados íntegros, salida segura y auditoría del resultado; sin secretos. |
| Recuperación y operación; RNF-POR-01/02/03 | Arranque limpio, caída de BD/IA, trabajo recuperado tras reinicio, sandbox huérfano, backup/restauración con archivos y referencias. | Comandos/versiones reales, correlación, estado coherente, permisos preservados y costos medidos si aplica. |

Aplica además los criterios SEC-01 a SEC-14 del [spec de seguridad](../../specs/09-seguridad-y-privacidad.md) según la superficie afectada, incluyendo CSRF, CORS, XSS, invitaciones y restauración de permisos. Esta tabla no elimina escenarios del spec ni rebaja un criterio por no aparecer aquí.

Para límites del ejecutor, prueba justo debajo, en y por encima de cada frontera conforme al [spec de ejecución](../../specs/13-ejecucion-controlada.md). Los 3 s corresponden al trabajo estudiantil total del intento, no a 3 s adicionales por test. Resuelve en DEC-003 la interpretación exacta MB/KB frente a MiB/KiB y el conteo combinado de salida antes de fijar valores esperados en bytes; no ocultes esa decisión dentro del fixture.

## Integrar las seis verticales

Antes de aceptar el MVP ejecuta E2E-01 a E2E-06 del [plan de calidad](../../specs/10-calidad-y-pruebas.md):

1. **Técnica:** administración prepara acceso → profesor publica → estudiante ejecuta fallo conocido → envía → consulta intento → reintenta correctamente → profesor verifica la misma evidencia.
2. **Con fuente:** documento oficial autorizado → indexación → intento guardado → `SUPPORTED` → referencia verificable → pista, sin alterar resultado técnico.
3. **Degradación:** sin evidencia y proveedor indisponible producen estados diferentes; salida malformada o contradictoria se descarta; ayuda repetida no crea un intento.
4. **Aislamiento:** ataques por identificador entre organizaciones y entre clases en UI, API y superficies de datos/Storage expuestas; todos los roles pertinentes.
5. **Reglas y revisión:** reloj controlado para las tres señales, fronteras, duplicados, cambio de versión y revisión idempotente.
6. **Concurrencia:** cierre de actividad, edición de ejercicio publicado, reenvío de solicitud y otra solución válida respetan admisión/versiones/historial sin duplicar progreso.

Desarrolla estas verticales por incrementos; no esperes al final para detectar aislamiento o persistencia defectuosos. Ejecuta las partes afectadas por cada cambio y la secuencia completa al preparar el candidato acordado.

## Accesibilidad, rendimiento y calidad de ayuda

Para RNF-USA-01 a USA-04 registra navegadores/dispositivos reales y revisa teclado, foco, estructura, etiquetas, contraste, ampliación, estados textuales, tablas/gráficos y editor. Complementa automatización con revisión manual; una herramienta sin hallazgos no basta para declarar WCAG 2.2 AA. Una sesión interna tampoco equivale a estudio con estudiantes o profesores.

Para RNF-REN-01 a REN-04 fija primero el perfil pendiente de DEC-008: release, regiones, plan/cuota, red, corpus, caché, concurrencia, mezcla, muestras y timeouts. Mide pantalla/API p95 <3 s, ejecución completa <5 s e IA <12 s; conserva el límite de proceso de 3 s separado de la latencia completa. Separa muestras frías/calientes y conserva datos crudos, errores, timeouts y exclusiones justificadas. No elimines fallas para mejorar p95 ni midas solo el subproceso para acreditar el recorrido completo.

Antes de ensayos pagados o carga, verifica presupuesto, cuota, destino y autorización efectiva. No uses el presupuesto histórico como autorización ilimitada. Registra consumo y gasto reales; la ausencia de medición se expresa N/D.

Evalúa RAG contra documentos y referencias autorizadas, fidelidad a evidencia, comprensión y progresión de pista. Conserva prompt/modelo/configuración/corpus por caso. Rúbrica, muestra y umbral pedagógico siguen pendientes DEC-010; no inventes precisión, mejora del aprendizaje ni ahorro docente. El modelo nunca determina si el ejercicio es correcto.

## Artefactos futuros y registro de ejecución

Al implementar prepara pruebas en los directorios vigentes; como referencia, la arquitectura propone `supabase/tests`, `tests/integration`, `tests/e2e` y fixtures en `fixtures/demo`. Usa suites Jest cercanas al dominio/contratos donde sea coherente. Publica reportes de CI como artefactos asociados al commit; no supongas que esos archivos existen por aparecer en este manual.

Para cada ejecución registra:

- ID del protocolo/escenario y RF/HU/CU/RNF/ORG aplicables; fecha y autor/revisor reales.
- Commit o candidato, ambiente, versiones, seed/corpus/reloj y precondiciones.
- Comando o pasos realmente ejecutados; entrada y resultado esperado.
- Resultado observado y estado: No ejecutado, Aprobado, Fallido, Bloqueado o No aplicable justificado.
- Adjuntos pertinentes, datos crudos, defecto o DEC relacionada y siguiente acción.

Protege tokens, contraseñas, pruebas ocultas, código completo innecesario y datos personales en capturas/reportes. Conservar evidencia no autoriza exponerlos. Las capturas complementan aserciones y lecturas; no sustituyen una transacción o un ensayo adversarial.

## Cierre y comunicación

Ejecuta las comprobaciones requeridas y apropiadas al cambio: tipos/formato/lint/build según scripts reales, pruebas afectadas y flujo integrado pertinente. Una vez aprobadas, amplía o repite solo si nuevas modificaciones, fallos o dudas sin resolver lo justifican. No introduzcas cobertura arbitraria de líneas, tests redundantes o aserciones que solo reflejan implementación.

Relaciona defectos de severidad alta con acceso cruzado, pérdida/corrupción de intentos, ejecución insegura, resultado alterado por IA o bloqueo de la vertical. Corrígelos y verifica de nuevo antes de recomendar aceptación del flujo; no los rebajes para liberar una versión.

Reporta por separado implementado, ejecutado, probado y aceptado. Si faltó ambiente, credencial, decisión o revisión humana, indica exactamente la comprobación pendiente y continúa las verificaciones independientes. Un caso omitido, bloqueado o un comando que no arrancó nunca cuenta como aprobado. No atribuyas revisión cruzada, contribuciones humanas o aceptación académica al trabajo del agente.
