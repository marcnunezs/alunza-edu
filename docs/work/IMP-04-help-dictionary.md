# IMP-04.04–04.06 — Diccionario de ayuda contextual

Contrato de implementación del corte autorizado de recuperación, explicaciones,
pistas y referencias. La evidencia de ejecución y el cierre se registran por
separado; este diccionario no acredita calidad pedagógica ni Azure remoto.

## Identidad, alcance y permiso

Toda ayuda pertenece a un intento ya confirmado, su estudiante, organización,
clase, actividad y versión del ejercicio. El servidor carga el código y el
diagnóstico desde persistencia. El cliente solo solicita `FEEDBACK` o `HINT` y,
opcionalmente para esta última, el nivel esperado. No aporta prompt, diagnóstico,
IDs de fuentes, filtros del corpus ni resultados técnicos.

El estudiante ACTIVE puede crear y leer ayuda propia con autorización vigente,
también en una actividad CLOSED. El cierre no permite ejecutar ni enviar otro
intento. ADMIN no recibe lectura pedagógica por gobierno de fuentes. La consulta
docente de ayudas e intentos ajenos queda para el corte de seguimiento docente.

`FEEDBACK` es una explicación separada de los tres niveles de `HINT`. Las pistas
no están disponibles para `SUCCESS` ni para un intento cuya evaluación terminó
con `infrastructureStatus=FAILED`. La explicación nunca cambia el diagnóstico,
el resultado ni el progreso. La progresión es concepto, pregunta dirigida y guía
del siguiente paso/pseudocódigo parcial; no desbloquea una solución completa.

## Persistencia y fronteras

| Relación                        | Campos principales                                                                                                                                                                                                                                                  | Invariante                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.feedback_requests`         | `id`, organización, clase, actividad, estudiante, intento, `kind`, `hint_level`, `level_reserved`, `lifecycle_status`, `requested_at`, `deadline_at`, `lease_token`, `lease_until`, `completed_at`, `last_error_code`, `retrieved_at`, `context_fixed`, correlación | Reserva durable posterior al intento; adquisición recuperable y nivel reservado de manera atómica. La reserva no equivale a entrega.                                       |
| `app.feedbacks`                 | `id`, solicitud, intento, organización, `diagnosis_code`, `explanation`, `hint`, `rag_status`, metadatos, `presentation_token`, `presented_at`, `viewed_at`, `suppressed_at`                                                                                        | Una respuesta validada por solicitud. Token de presentación estable; la lectura explícita se confirma de forma idempotente. El contenido revocado no se vuelve a entregar. |
| `app.feedback_source_refs`      | Feedback y fuente/versión/fragmento/localizador autorizados                                                                                                                                                                                                         | Las referencias corresponden al contexto usado y conservan la versión original. Su existencia histórica no concede acceso actual.                                          |
| `app_private.help_calls`        | Solicitud, fase `EMBEDDING/GENERATION/REVIEW`, estado `DISPATCHED/COMPLETED`, resultado y uso                                                                                                                                                                       | Evidencia operativa de llamadas; no se expone como respuesta pedagógica ni se reintenta ciegamente una llamada incierta.                                                   |
| `app_private.help_context_refs` | Solicitud, fragmento/localizador/distancia candidato y marca de uso                                                                                                                                                                                                 | Contexto autorizado, fijado para evaluación y validación de citas. Distancia no es un puntaje estudiantil.                                                                 |
| `app_private.help_inputs`       | `request_id`, `organization_id`, `input`, `metadata`, `context_hash`, `created_at`                                                                                                                                                                                  | Entrada autorizada fijada para procesamiento recuperable; JSON hasta 102400 bytes y hash de contexto SHA-256. No se entrega como DTO público.                              |
| `app_private.help_events`       | Solicitud, intento, nivel, tipo y fecha                                                                                                                                                                                                                             | `HELP_REQUESTED`, `HINT_DELIVERED`, `FEEDBACK_VIEWED`; unicidad por solicitud/tipo y por intento/nivel entregado. Consultar metadatos no entrega una pista.                |

Los nombres compactos de claves de alcance en la tabla resumen relaciones; el
DDL es la autoridad para nombres SQL exactos. El rol de API utiliza funciones
autorizadas y no recibe lectura directa general de estas tablas. Los estados
internos de solicitud `QUEUED/RUNNING/SUCCEEDED/CANCELLED` se proyectan como
`QUEUED/RUNNING/SUCCEEDED/FAILED`; no amplían el catálogo RAG.

## Contrato público

La autoridad ejecutable es `packages/contracts/src/help.ts`. Las respuestas
conservan el envoltorio `{data,requestId}` y el objeto RAG anidado contiene solo
`diagnosis_code`, `explanation`, `hint`, `source_refs`, `status`.

| Ruta                                         | Entrada/salida                                                | Condición                                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /attempts/:id/feedback-requests`       | `{kind,hintLevel?}` → `HelpRequest`                           | `Idempotency-Key` obligatoria; `202` solo tras reserva durable. Repetir clave/payload recupera el mismo trabajo.                                   |
| `GET /feedback-requests/:id`                 | `HelpRequest` con estado, fechas, `feedbackId` o error seguro | Solo alcance propio vigente. No devuelve contenido ni consume niveles.                                                                             |
| `GET /attempts/:id/feedback`                 | `HelpHistory`: `items`, `nextCursor`, `capabilities`          | Página de hasta 20 resúmenes; incluye trabajo pendiente y ayuda preparada aunque no se haya recibido su POST.                                      |
| `GET /feedback/:id`                          | `HelpFeedback` con `help` y `presentationToken` nullable      | Apertura explícita y revalidación. Un token de presentación no es confirmación de lectura.                                                         |
| `POST /feedback/:id/viewed`                  | `{presentationToken}` → `HelpFeedback` actualizado            | Deduplicación idempotente propia, sin clave de operación adicional. La UI lo invoca después de mostrar contenido válido abierto explícitamente.    |
| `GET /feedback/:id/sources/:chunkId`         | `HelpReference`                                               | Nombre, versión, archivo, formato, fragmento y localizador autorizados de esa cita concreta.                                                       |
| `GET /feedback/:id/sources/:chunkId/content` | Bytes privados de la versión citada                           | Revalida intento, cita y permisos de fuente antes/después de Storage. No usa URL del modelo ni habilita historia general de fuentes al estudiante. |

`HelpFeedbackSummary` incluye ID, intento, solicitud, tipo, nivel, estado RAG,
fecha, `viewedAt` y `available`; no contiene explicación, pista ni material.
`HelpCapabilities` incluye `canExplain`, `canHint`, `nextHintLevel`, `reason`,
`pendingRequest` y `preparedFeedbackId`. La web respeta estas capacidades; no
calcula niveles a partir del número de solicitudes ni de una página histórica.

## Entrega, fallbacks y recuperación

`SUPPORTED` necesita referencias pertinentes y diagnóstico idéntico al intento.
`NO_EVIDENCE` y `PROVIDER_UNAVAILABLE` contienen referencias vacías y `hint: ""`;
no consumen niveles ni generan un evento de pista entregada. La respuesta del
servidor diferencia material insuficiente de indisponibilidad técnica.

Mostrar la lista histórica o seguir un trabajo no confirma lectura. El alumno
abre una ayuda preparada o un registro histórico; la web obtiene el detalle,
renderiza texto plano y luego confirma su presentación cuando el servidor entrega
un token. Una explicación `FEEDBACK` registra `FEEDBACK_VIEWED` también cuando
su estado es `NO_EVIDENCE` o `PROVIDER_UNAVAILABLE`, incluido UNKNOWN de
infraestructura; esto no consume pistas. Un `HINT` fallback carece de token y no
registra `HINT_DELIVERED`. Una pérdida de ACK o un montaje interrumpido se recupera
con el mismo token sin consumir otro nivel. La siguiente pista depende del estado
confirmado por el servidor.

Una respuesta HTTP incierta conserva clave y payload exactos; un fallback ya
confirmado permite una solicitud deliberada nueva. Una recarga descubre trabajo,
ayuda preparada e historia desde el servidor. El seguimiento automático es
acotado y ofrece consulta manual al terminar. Salir de la vista cancela consultas
del navegador, sin afirmar que canceló el trabajo durable.

El navegador no persiste contenido de ayuda, fragmentos ni tokens de presentación
en localStorage. La renovación de credenciales revalida lecturas y conserva una
intención incierta en un contexto de memoria exterior al panel que se desmonta
durante la revalidación. Ese contexto almacena solo clave de operación, tipo y
nivel por intento; está acotado a la sesión y cuenta actuales. Cambiar de cuenta
descarta el contexto; cambiar de intento separa su estado y descarta respuestas
tardías. Un nuevo intento abre historia propia y conserva las ayudas previas en
el intento original.

Reemplazar o reindexar una fuente no redirige una cita a contenido distinto: la
lectura autorizada recupera su versión y fragmento originales. Ocultar, archivar
o revocar acceso vuelve indisponible el contenido afectado; no se reaprovecha un
enlace de descarga anterior ni se revela el título de un recurso ajeno.

## Verificación local y límites

El corte IMP-04.04–04.06 está implementado y probado localmente. Las regresiones web
comprueban idempotencia, renovación/cancelación, doble activación, recuperación del
ACK y rutas privadas de descarga. Cypress aprobó **42/42 recorridos**, incluidos
los cuatro de ayuda: envío previo, explicación, pistas/ACK, recarga, fallbacks,
actividad cerrada, éxito, historial independiente, referencias/versionado, permisos
y revocación. Auth, API, Storage y pgvector son reales en TEST; el proveedor de IA
es un doble explícito.

Los resultados y fallos históricos se conservan en el
[registro del corte](IMP-04-help.md); esta evidencia no declara aprobada la CI
agregada. Azure real, calidad semántica, evaluación docente y aceptación CAPSTONE
siguen pendientes. El arnés remoto de ejecución aún no está implementado;
IMP-04.07–04.08, Vercel Sandbox IMP-03.07 y la operación productiva del consumidor
en Azure Container Apps conservan sus pendientes.
