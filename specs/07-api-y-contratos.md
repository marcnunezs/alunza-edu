# API y contratos de Alunza

**Ampliación IMP-06.05:** `GET /api/v1/organizations/{orgId}/audit-events` permite consulta ADMIN vigente, incluyendo lectura archivada. Filtros estrictos `from/asOf/actorId/action/entityType/entityId`, límite 20/máximo 100 y cursor ligado al actor/ámbito/filtros/corte. Orden fecha descendente/UUID ascendente; conteo anterior al cursor. Proyección `eventId,occurredAt,actorId,action,entityType,entityId,organizationId,outcome`, con `outcome ← result`. Precisión de microsegundos y sin snapshot entre páginas. Consultas y denegaciones emiten registro operativo separado y mínimo. El [diccionario](../docs/work/IMP-06-audit-read-dictionary.md) define errores y nulabilidad; el [registro](../docs/work/IMP-06-audit-read.md) conserva verificación. CSV continúa en IMP-06.06.

**Ampliación IMP-06.04:** `PUT /api/v1/signals/{id}/review`, cuerpo `{}`
estricto y sin query, devuelve REVIEWED con primer responsable/fecha. Exige
sesión docente vigente, asignación actual, ámbito operativo y estudiante
CURRENT_ACTIVE también en replay. Idempotencia permanente por episodio, sin
If-Match ni Idempotency-Key obligatorio. `reviewedByName` es etiqueta actual,
sin correo; las consultas al corte anterior no revelan la revisión futura.
No admite notas. Contrato completo y errores en el
[diccionario .04](../docs/work/IMP-06-signal-review-dictionary.md), resultados
reales en [el registro](../docs/work/IMP-06-signal-review.md). Los cortes
anteriores siguientes conservan su estado histórico.

**Cierre técnico local IMP-06.01, 27/10/2026:** las lecturas administrativas del
banco están implementadas y verificadas con CI integrada **17/17 PASS**;
su evidencia y límites se registran en
[consulta del banco](../docs/work/IMP-06-bank-read.md). Ese corte comprendía
únicamente lectura. La ampliación [IMP-06.02](../docs/work/IMP-06-bank-governance.md)
implementa y verifica localmente propiedad/visibilidad, versionado administrativo
y archivo, con los contratos descritos más abajo. IMP-06.03 tiene cierre técnico
local de las consultas docentes descritas en su sección; las pruebas, incidencias
y CI del candidato constan en su [registro](../docs/work/IMP-06-student-detail.md).
Los incrementos .04–.07, la CI Linux y la aceptación humana/remota permanecen pendientes.

| GET bajo `/api/v1` | Contrato de lectura ADMIN |
| --- | --- |
| `/organizations/{orgId}/exercise-bank` | Filtros de título actual, estado, dificultad, concepto y visibilidad; metadatos y conteos completos. |
| `/exercises/{id}/governance` | Propietario ID/nombre, versión actual directa, conceptos fijados, estado/visibilidad y conteos. |
| `/exercises/{id}/governance/versions` | Historia de metadatos por número de versión descendente, con usos por estado. |
| `/exercises/{id}/governance/uses` | Asignaciones a actividades/clases; filtros de versión y estado de actividad. |

Los [schemas ejecutables](../packages/contracts/src/exercise-bank.ts) definen
envelopes estrictos, `observedAt`, `items` y páginas con
`nextCursor/hasMore/totalFiltered`. Predeterminado 20, máximo 100; lista/usos
por UUID ascendente y cursores ligados a actor/ámbito/recurso/filtros/orden.
Una asignación es un uso; conteos anteriores al cursor, coherentes en la
misma consulta. No hay snapshot entre páginas. Solo ADMIN vigente, incluyendo
organización READ_ONLY; cada lectura reautoriza. No se entregan correos,
enunciados, código, pruebas ni evidencia individual. La lectura compartida
docente y sus permisos de autoría permanecen separados.

**Estado vigente:** la base contractual hasta IMP-05.08 cubre identidad, contenido, RUN/SUBMIT, materiales/ayuda, progreso, gobierno de reglas y lectura docente de tablero/señales; IMP-06.01 añade las lecturas administrativas descritas arriba e IMP-06.02 las mutaciones de gobierno y la lectura de definición vigente para su formulario. IMP-06.03 implementa el detalle integral RF-017 mediante GET docentes con contexto obligatorio de clase y estudiante, sin ampliar rutas propias del alumno. El listener y ledger de IMP-04.07/preparación .08 y el worker de señales tienen interfaces internas distintas de la API pública. Fuentes: F01 ERS §§3.1–3.3 y F03 casos de uso en [fuentes](00-fuentes-y-decisiones.md). [OpenAPI](../packages/contracts/openapi.json) y los [DTO compartidos](../packages/contracts/src/index.ts) describen la API ejecutable; el [estado actual](../docs/estado-actual.md) y los registros de trabajo distinguen implementación, prueba local y pendientes. El [registro .03](../docs/work/IMP-06-student-detail.md) documenta su cierre técnico local. La acción pública RF-019 está implementada en [.04](../docs/work/IMP-06-signal-review.md), con focos locales aprobados y cierre integral pendiente; el despliegue remoto y la aceptación CAPSTONE permanecen pendientes.

**Corte histórico 05/10/2026:** progreso/eventos .01–.02 conservan contrato y evidencia
propios; DEC-005 D1–D5 estaba aprobada. IMP-05.03 concretaba reglas/activación
y estaba implementado/probado en focos locales al 06/10/2026, con CI17
pendiente al congelar FINAL y [registro](../docs/work/IMP-05-rules.md).
Evaluadores .04, episodios .05 y rutas docentes eran posteriores a ese corte.
La CI conjunta cerró localmente .03–.05 después; .06–.08 concretan gobierno web,
lecturas y aceptación transversal descritos más abajo, sin cambiar DEC-005.

## Convenciones

- API de dominio exclusiva de NestJS bajo `/api/v1`, HTTPS, JSON UTF-8. Excepciones explícitas: carga/descarga binaria de materiales y exportación CSV.
- DTO públicos en `camelCase`; contrato RAG conserva exactamente sus cinco claves en `snake_case`.
- IDs opacos UUID, fechas ISO 8601 en UTC, números finitos. La interfaz presenta zona `America/Santiago` cuando corresponde.
- Cada request protegido lleva `Authorization: Bearer <JWT>` de Supabase Auth. El backend valida token, cuenta, membresía activa y ámbito real del recurso.
- `organizationId` y `classId` delimitan recursos; nunca prueban por sí solos autorización. Las listas filtran antes de paginar o contar.
- Roles API `ADMIN`, `TEACHER`, `STUDENT`; la interfaz usa administrador, profesor y estudiante. Un permiso administrativo no implica lectura automática de todo código estudiantil.
- Paginación según contrato de cada endpoint: el historial propio de intentos usa 10 por defecto/máximo 20; reglas y lecturas IMP-05.07 usan 50 por defecto/máximo 100. El cursor y su orden no son intercambiables entre rutas. Filtros permitidos se enumeran por endpoint; no se aceptan fragmentos SQL.
- Campos desconocidos en escritura se rechazan. `null` se admite solo cuando el DTO lo declare; ausencia no equivale a borrar.
- Errores llevan `requestId` seguro; cargas sensibles no se reflejan. Respuestas privadas usan `Cache-Control: no-store`.

```json
{
  "data": [],
  "page": { "nextCursor": null, "hasMore": false },
  "requestId": "req-demo-001"
}
```

Recursos individuales usan `{ "data": {...}, "requestId": "..." }` sin `page`. UUID abreviados como `{id}` en las rutas son metavariables, no valores de prueba.

## Errores y concurrencia

```json
{
  "error": {
    "code": "ACTIVITY_CLOSED",
    "message": "La actividad está cerrada y no admite nuevos envíos.",
    "fields": [],
    "retryable": false
  },
  "requestId": "req-demo-002"
}
```

| HTTP | Código de ejemplo propuesto | Comportamiento |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | JSON o parámetros malformados |
| 401 | `UNAUTHENTICATED` | JWT ausente, inválido o vencido; pedir nueva sesión |
| 403 | `FORBIDDEN`, `ACCOUNT_INACTIVE` | Rol/estado no habilita la acción; no revela recursos ajenos |
| 404 | `RESOURCE_NOT_FOUND` | ID inexistente o fuera del ámbito consultable; respuesta indistinguible |
| 409 | `ACTIVITY_CLOSED`, `VERSION_CONFLICT`, `DUPLICATE`, `DEPENDENCIES_ACTIVE`, `LAST_ADMIN`, `REQUEST_IN_PROGRESS` | Conflicto de dominio o concurrencia |
| 412 | `PRECONDITION_FAILED` | Revisión antigua; recargar antes de editar |
| 413 | `FILE_TOO_LARGE`, `CODE_TOO_LARGE` | Tamaño fuera del contrato |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Formato no soportado |
| 422 | `VALIDATION_FAILED` | Campos, pruebas o combinación semántica inválidos |
| 428 | `PRECONDITION_REQUIRED` | Falta `If-Match` en recurso versionado |
| 429 | `RATE_LIMITED` | Cupo o frecuencia; `Retry-After`, conservar editor |
| 503 | `DEPENDENCY_UNAVAILABLE`, `PERSISTENCE_UNAVAILABLE` | Fallo de servicio; no confirmar intento inexistente |
| 504 | `OPERATION_DEADLINE_EXCEEDED` | Plazo de infraestructura; consultar/reintentar con la misma clave |

Un error JavaScript del estudiante es una ejecución procesada con diagnóstico, normalmente HTTP 201; no es un HTTP 500. `TIMEOUT` del programa tampoco equivale a 504 de la API. La indisponibilidad de IA puede terminar como feedback válido con `PROVIDER_UNAVAILABLE`, conservando HTTP 200 y el intento existente.

**Idempotencia:** los cortes ejecutables concretan esta regla, incluida la ayuda propia descrita más abajo; las exportaciones conservan su propuesta. `Idempotency-Key` obligatorio para crear ejecuciones, intentos, trabajos de feedback, invitaciones y exportaciones. Alcance `(actor, organización, operación, clave)` más hash de payload. Misma clave y payload recupera el mismo recurso mientras se conserve su respuesta; distinto payload devuelve 409. Una reserva transaccional impide que dos requests concurrentes creen dos envíos. Si sigue procesándose, devolver 409 `REQUEST_IN_PROGRESS` con `Retry-After`. Una reserva vencida se reconcilia según el contrato de su operación: RUN/SUBMIT nunca vuelven a ejecutar código por vencimiento o incertidumbre; SUBMIT conserva el resultado durable o confirma UNKNOWN operacional tras verificar limpieza.

Guardar el recurso confirmado y la respuesta idempotente en la misma transacción. IMP-01 y RUN/SUBMIT de IMP-03 conservan la respuesta durante 24 horas y mantienen la clave, hash y vínculo para impedir duplicación; una clave expirada no repite efectos. Los plazos de módulos futuros y la retención institucional de datos reales conservan sus decisiones DEC-004/009. Un nuevo intento deliberado requiere nueva clave. La interfaz conserva su clave hasta conocer el desenlace.

Ediciones de recursos versionados llevan `If-Match` con el ETag obtenido en lectura. Si cambió, devolver 412 `PRECONDITION_FAILED` y ofrecer recarga; no sobrescribir silenciosamente. El catálogo de errores HTTP no amplía catálogos de diagnóstico, RAG o señales.

## Identidad y sesión

Inicio, renovación de sesión, verificación de correo y cierre de sesión usan el SDK de Supabase Auth. La API no guarda contraseñas ni emite un JWT alternativo. La aceptación institucional se confirma en NestJS después de verificar Auth. El callback web `/acceso/invitacion` toma los secretos del fragmento y lo retira; una continuación explícita canjea `token_hash` con `verifyOtp`, incluso en otro navegador.

| Método y ruta | Actor / alcance | Datos y respuesta | RF |
| --- | --- | --- | --- |
| `GET /me` | Cuenta ACTIVE y sesión vigente | Perfil mínimo, membresías operativas o archivos consultables, `organizationState`, `accessMode`, `provisioningGrants` y `canProvisionOrganization`; admite cero membresías | 001 |
| `GET /organizations` | Miembro activo según organización | Solo organizaciones consultables; archivo visible al ADMIN autorizado | 020 |
| `POST /organizations` | Cuenta ACTIVE con permiso técnico disponible, sin exigir membresía anterior | `grantId`, `code`, `name`; 201 con organización, primer ADMIN, consumo del permiso y auditoría atómicos | 020 |
| `GET /organizations/{orgId}` | Miembro activo, proyección mínima | Identidad institucional | 020 |
| `PATCH /organizations/{orgId}` | ADMIN de ese ámbito | `name`, `code`; unicidad y versión | 020 |
| `POST /organizations/{orgId}/archive` | ADMIN de ese ámbito | Motivo; 409 con dependencias activas | 020 |
| `GET /organizations/{orgId}/members` | ADMIN | Filtros rol/estado; correo restringido al uso administrativo | 021 |
| `POST /organizations/{orgId}/invitations` | ADMIN | `email`, `role`; 202 con invitación INVITED y estado de entrega durable; no crea membresía anticipadamente | 021 |
| `PATCH /organizations/{orgId}/members/{userId}` | ADMIN | `role`, `state`; no último admin, no roles fuera del catálogo | 021 |
| `GET /organizations/{orgId}/invitations` | ADMIN, consulta de archivo permitida | Lista paginada de invitaciones y sus estados institucional/de entrega | 021 |
| `GET /organizations/{orgId}/invitations/{invitationId}` | ADMIN | Estado actual y revisión, sin secretos | 021 |
| `POST /organizations/{orgId}/invitations/{invitationId}/resend` | ADMIN de organización activa | 202; nuevo trabajo, invalida enlace anterior y reinicia las 72 horas | 021 |
| `POST /organizations/{orgId}/invitations/{invitationId}/revoke` | ADMIN de organización activa | 200; revoca usos futuros y cancela trabajos pendientes | 021 |
| `POST /invitations/{invitationId}/accept` | Destinatario verificado con sesión válida; excepción acotada para cuenta INVITED | `token`, `generation`, `displayName?`; 200 con membresía destinataria vigente | 021 |
| `POST /invitations/{invitationId}/renew-auth` | Prueba institucional vigente, sin exigir sesión Auth todavía | `token`, `generation`; 202 con trabajo de renovación; no extiende plazo institucional | 021 |

DEC-001 fija un permiso revocable y válido para una creación, concedido por herramienta técnica con actor y motivo. El rol ADMIN no permite emitir permisos ni consultar organizaciones ajenas. Archivo exige que solo el ADMIN ejecutor siga activo, sin otras invitaciones ni trabajos pendientes; conserva referencias y bloquea mutaciones posteriores. Los recursos de clases/documentos futuros deberán ampliar esta comprobación.

Activación exige sesión real, correo confirmado igual al destinatario y secreto/generación vigentes. Un PATCH no acepta una invitación inicial. Repetir una aceptación consumida observa el estado actual y nunca reactiva una deshabilitación posterior. Cuenta nueva puede fijar contraseña de al menos 12 caracteres; cuenta existente conserva identidad y contraseña. Deshabilitar una membresía no deshabilita la cuenta global ni otras pertenencias. No se añade registro público ni recuperación independiente.

El JWT conserva una hora y debe incluir `session_id`; NestJS valida firma ES256, emisor, audiencia, expiración, sujeto y existencia de esa sesión. El helper de BD solo observa la sesión del actor mediante columnas y políticas mínimas sobre Auth. El arranque local instala estos permisos como propietario Auth; no se infiere validación de este procedimiento en remoto. Los metadatos del usuario no autorizan operaciones.

Estados de invitación: `INVITED`, `ACCEPTED`, `REVOKED`, `EXPIRED`. Entrega pública: `QUEUED`, `SENDING`, `SENT`, `UNCERTAIN`, `FAILED`, `CANCELLED` (`RUNNING` es el estado SQL interno). Un trabajador reclama lease de 90 segundos, revalida al ADMIN autorizante y entrega fuera de la transacción. Usa `inviteUserByEmail`; solo conflicto explícito de cuenta existente permite `signInWithOtp` con `shouldCreateUser:false`. Cada entrega rota secreto y generación; resultado incierto se reconcilia antes de repetir. Máximo tres intentos automáticos, separados por un minuto, con fallo recuperable visible.

IMP-01 exige `Idempotency-Key` de 8–128 caracteres permitidos en creación de organización, archivo y acciones de invitación. Conserva respuesta durante 24 horas y vínculo/hash persistentes para impedir duplicación; una clave vencida no vuelve a ejecutar efectos. `If-Match: "revision"` es obligatorio en PATCH, archivo, reenvío y revocación. Las listas usan `limit` 20/máximo 100, cursor UUID y `search`; miembros permiten `role/state`, invitaciones `state`. Todo filtrado ocurre antes de paginar. El parser admite JSON acotado a 32 KiB, los DTO rechazan campos desconocidos y CORS habilita únicamente los métodos/encabezados usados. Los errores de campo conservan el formulario.

## Estructura académica y contenido

En esta tabla `RF 004`, por ejemplo, significa `ALZ-RF-004`. Cada operación aplica el permiso de [requisitos funcionales](02-requisitos-funcionales.md) y [seguridad](09-seguridad-y-privacidad.md).

| Método y ruta | Actor / alcance | Contrato principal | RF |
| --- | --- | --- | --- |
| `GET, POST /organizations/{orgId}/courses` | ADMIN escribe; TEACHER lee ámbito | `code`, `name`, `description`, `academicPeriod`, fechas; códigos únicos | 022 |
| `GET, PATCH /courses/{id}` y `POST /courses/{id}/archive` | ADMIN; lectura docente autorizada | Versión y dependencias | 022 |
| `GET /courses/{id}/teachers`, `PUT /courses/{id}/teachers/{teacherId}` | ADMIN concede/revoca; docente consulta habilitación propia | `enabled`; If-Match del curso; revocar no reasigna clases existentes | 022 |
| `GET, POST /organizations/{orgId}/classes` | ADMIN; TEACHER crea en curso permitido | `courseId`, `code`, `name`, `startDate`, `endDate` | 002,022 |
| `GET, PATCH /classes/{id}` | ADMIN o profesor asignado según campos | Profesor edita configuración propia; solo ADMIN reasigna profesor | 002,022 |
| `POST /classes/{id}/archive` | ADMIN | Bloquear dependencias activas, conservar historial | 022 |
| `PUT /classes/{id}/teacher` | ADMIN | `teacherId` activo de misma organización | 022 |
| `POST /classes/{id}/join-codes` | Profesor asignado o ADMIN | `expiresAt`; devuelve código una vez, almacena digest | 002 |
| `GET /classes/{id}/join-codes` | Profesor asignado o ADMIN | Metadatos sin código; emisión exige If-Match de clase | 002 |
| `POST /classes/{id}/join-codes/{codeId}/revoke` | Emisor autorizado | Revoca usos futuros, conserva membresías existentes | 002 |
| `POST /class-enrollments` | STUDENT activo | `code`; misma organización, vigente, no inscripción duplicada | 003 |
| `POST /class-enrollments/preview` | STUDENT activo | Consulta previa sin membresía; error genérico si es inválido/ajeno/vencido | 003 |
| `GET /classes/{id}/students` | Profesor asignado o ADMIN de estructura | Lista limitada a datos de membresía | 017,022 |
| `GET, POST /organizations/{orgId}/concepts` | ADMIN escribe; miembros autorizados leen | `name`, `description`, `parentId?`; unicidad normalizada, sin ciclos | 023 |
| `PATCH /concepts/{id}` y `POST /concepts/{id}/archive` | ADMIN | Nueva versión; conserva referencias | 023 |
| `GET, POST /organizations/{orgId}/exercises` | ADMIN o TEACHER autorizado | Filtros concepto/dificultad/estado, DTO de ejercicio | 004,024 |
| `GET /exercises/{id}/versions` | Docente con acceso al banco o ADMIN autorizado | Versiones reutilizables del ámbito; lectura compartida no concede edición de autor | 004,024 |
| `POST /exercises/{id}/versions` | Autor TEACHER o ADMIN vigente del ámbito | Nueva versión completa con `If-Match` e `Idempotency-Key`; no modifica uso publicado | 004,024 |
| `GET /exercises/{id}/governance/content` | ADMIN vigente del ámbito | Definición actual para el formulario de versión, incluidos conceptos y pruebas de autoría; no entrega evidencia estudiantil | 024 |
| `PATCH /exercises/{id}/governance` | ADMIN vigente del ámbito | `ownerId` y/o `visibility` válidos dentro de organización; exige `If-Match` e `Idempotency-Key` y audita el cambio efectivo | 024 |
| `POST /exercises/{id}/archive` | ADMIN | Retirar de nuevas asignaciones y conservar publicaciones existentes según DEC-002 | 024 |
| `GET /classes/{id}/activities` | Profesor asignado; STUDENT ve publicadas | Listado autorizado con estado y avance | 005,007 |
| `POST /classes/{id}/activities` | Profesor asignado | `title`, `type`, `instructions`, ejercicios ordenados y ventana | 005 |
| `GET, PATCH /activities/{id}` | Autor docente; estudiante según publicación | Edición DRAFT; protección de versión | 005,007 |
| `POST /activities/{id}/publish` | Profesor asignado | Validar contenido, tests, conceptos y orden; fija versiones | 005 |
| `POST /activities/{id}/close` | Profesor asignado | Cierra admisión; historial según DEC-002 | 005 |
| `GET /activities/{id}/exercises/{activityExerciseId}` | Estudiante inscrito | Enunciado, conceptos, plantilla y pruebas visibles únicamente | 008 |

**Diseño inicial, previo a IMP-02:** los tres inputs siguientes conservan la
propuesta original; el contrato ejecutable citado después concreta nombres,
límites y validación. No son DTO alternativos para nuevas implementaciones.

`CourseInput` propuesto: `code`, `name`, `description?`, `academicPeriod`, `startDate?`, `endDate?`. El período académico está documentado en CU-022; su formato exacto quedaba por fijar. `ConceptInput` propuesto: `name`, `description`, `parentId?`; CU-023 documenta nombre y descripción. Normalizar para unicidad sin eliminar el texto original legible.

`ExerciseVersionInput` propuesto: `title`, `statement` (texto/Markdown), `starterCode`, `language: "javascript"`, `difficulty`, `conceptVersionIds[]`, `entrypoint`, `tests[]`, `executionLimits`. Cada test tiene ID, visibilidad, argumentos JSON, salida esperada y comparador permitido. Dificultades y comparadores exactos se fijan antes de cargar el banco; no son enums aprobados por ERS. El [ejecutor](13-ejecucion-controlada.md) define el contrato.

`ActivityInput` propuesto: `title`, `type`, `instructions`, `opensAt?`, `closesAt?`, `exercises: [{exerciseVersionId, position, required}]`. El tipo diagnóstica/formativa está documentado en CU-005; se proponen códigos `DIAGNOSTIC` y `FORMATIVE`. Debe tener al menos un ejercicio requerido para publicar. Sin duplicados ni posiciones repetidas. Los límites no pueden superar el máximo institucional. Fechas coherentes y recursos activos de la misma organización. No aceptar `teacherId`, `organizationId` o `publishedAt` como campos libres de un estudiante.

El código colectivo de incorporación puede usarse por varios estudiantes mientras esté vigente; la unicidad se aplica a cada membresía. Solo una invitación individual puede ser de uso único según su contrato. Tener rol ADMIN de gobierno no concede publicación de actividades sin asignación docente explícita.

**Contrato ejecutable IMP-02 (23/09/2026).** Véanse [OpenAPI](../packages/contracts/openapi.json), [esquemas estrictos](../packages/contracts/src/academic.ts) y [diccionario](../docs/work/IMP-02-dictionary.md). En ese corte quedaron pendientes `/exercises/{id}/governance` y avance desde intentos; IMP-03 añade después el avance propio descrito más abajo. En IMP-02 ADMIN consulta/archiva banco; únicamente el autor TEACHER con clase activa crea versiones PRIVATE. La autoría admite hasta 2 MiB HTTP sin ampliar el límite general de 32 KiB. Dificultad `BEGINNER/INTERMEDIATE/ADVANCED`; JavaScript, entrada exportada `module.exports.solve`, comparación JSON exacta; 1–8 pruebas con al menos una visible y sin IDs ni expectativas contradictorias para argumentos equivalentes. Límites fijos: 134217728 bytes, 3000 ms, 65536 bytes de salida. La coherencia estática no certifica corrección pedagógica universal.

La operación de gobierno pendiente en ese corte era `PATCH`;
`GET /exercises/{id}/governance` de IMP-06.01 incorporó solo metadatos.
IMP-06.02 implementa el `PATCH` y el recorrido administrativo de versiones
con la verificación local enlazada en su [registro](../docs/work/IMP-06-bank-governance.md).
La aceptación integrada de fase y humana conserva su alcance pendiente.

Cursos/clases usan `startDate/endDate` civiles nullable; período académico textual obligatorio. Actividades usan UTC nullable y orden explícito; publicación exige contenido válido y al menos un ejercicio requerido. `DRAFT → PUBLISHED → CLOSED` sin reapertura fija versiones inmutables y permite consulta histórica. La proyección estudiantil incluye `canEdit`, `serverNow` y ventana; edición solo dentro de `[opensAt, closesAt)` en PUBLISHED. Archivo del banco conserva publicaciones existentes. Conceptos normalizan NFKC, espacios y minúsculas; versiones y grafo acíclico conservan referencias.

El código vence a siete días o antes, se muestra una vez y una rotación invalida el anterior. Replay de emisión devuelve metadatos; replay propio de inscripción confirmada recupera la relación tras rotación, revalidando permisos. `POST /class-enrollments` responde 200, incluida repetición; no crea relaciones duplicadas. ADMIN archiva clases después de cerrar actividades publicadas y revoca códigos. La autoría valida texto Unicode persistible (sin NUL ni surrogados aislados) y mide argumentos/resultados JSON compactos en bytes UTF-8, con hasta 65536 por valor; el almacenamiento privado conserva esa representación. Las políticas y pendientes se registran en [IMP-02](../docs/work/IMP-02-content.md).

## Práctica e intentos

| Método y ruta | Entrada | Resultado y condición | RF |
| --- | --- | --- | --- |
| `POST /activities/{id}/exercises/{aeId}/executions` | `code`, `exerciseVersionId` | Ejecuta pruebas visibles; 201 con `executionId` y resultado público, sin completar progreso | 009 |
| `POST /activities/{id}/exercises/{aeId}/attempts` | `code`, `exerciseVersionId`, `previousAttemptId?` | Ejecuta todas las pruebas requeridas y persiste; 201 con intento y resultado | 010,011,014 |
| `GET /activities/{id}/exercises/{aeId}/attempts` | Filtros cursor | Historial del STUDENT propietario; consulta docente por rutas separadas .03 | 011,014 |
| `GET /attempts/{id}` | Sin payload | Código propio, fecha, versión y resultado público autorizado | 011 |
| `GET /activities/{id}/progress` | Sin payload | Avance propio mínimo por asignaciones requeridas y versiones fijas | 007 |
| `POST /attempts/{id}/feedback-requests` | `kind: "FEEDBACK"` o `kind: "HINT"`, `hintLevel?` | 202 con ID de trabajo durable; requiere intento persistido propio | 012,013 |
| `GET /feedback-requests/{id}` | Sin payload | Estado de trabajo; al terminar, `feedbackId` o error controlado | 012,013 |
| `GET /attempts/{id}/feedback` | Cursor opcional | Historial propio y capacidades actuales; consulta docente por rutas separadas .03 | 012,013 |

`previousAttemptId` solo vincula un intento del mismo estudiante y ejercicio asignado; no autoriza reutilizar ni alterar su código. Un envío siempre usa código y pruebas del servidor para una ejecución nueva: no confía en `executionId`, resultados, puntajes o hashes enviados por el navegador como prueba de éxito.

**Contrato SUBMIT IMP-03.04–03.06, 26/09/2026:** el usuario resolvió DEC-002:
un envío admitido por el servidor antes del cierre puede terminar y persistirse
después; nuevas admisiones posteriores se rechazan. La confirmación de la UI
no reserva admisión. Entregar, recuperar y consultar exige autorización vigente.
El [registro IMP-03.04–03.06](../docs/work/IMP-03-submissions.md), su diccionario,
[contratos estrictos](../packages/contracts/src/submissions.ts) y OpenAPI describen
la implementación local de las cuatro rutas de envío, historia, detalle y avance.
Estas cuatro rutas conservan acceso exclusivo del STUDENT propietario; la lectura
docente RF-017 usa las rutas separadas de IMP-06.03 descritas más abajo.
El JSON de envío acepta `code`, `exerciseVersionId` y opcionalmente
`previousAttemptId`, con `Idempotency-Key`; límites de fuente/HTTP iguales a RUN.

La respuesta `Attempt` incluye IDs de intento, ejecución, actividad, asignación
y versión, `testsVersion` SHA-256, número de admisión monotónico, intento anterior
nullable, fechas servidor, código y resultado técnico. El resultado público
extiende RUN solo con `hiddenChecksPassed` nullable y `allRequiredPassed`.
Historia omite código y pagina con cursor entero exclusivo: `limit` por defecto
10, máximo 20, `data` y `page: {nextCursor,hasMore}`. Ordena `attemptNumber DESC`.
El avance devuelve `activityId`, `completed`, `required`, `ratio`, `evidenceState`
y `asOf`; `0/0` tiene ratio null y estado `NO_REQUIRED_EXERCISES`, distinto de
`NO_ATTEMPTS` o `HAS_EVIDENCE`.

Admisión y cierre se serializan. Fuera de la transacción se ejecuta la suite
completa; evidencia normalizada se guarda antes de confirmar atómicamente
intento, código, resultados, eventos y respuesta. No se reejecuta una operación
incierta: el reconciliador conserva evidencia durable o registra UNKNOWN
operacional, tras comprobar limpieza. Misma clave/payload recupera respuesta
24 horas; clave expirada no genera otro intento. Clave activa devuelve 409
`REQUEST_IN_PROGRESS` con `Retry-After`; payload distinto entra en conflicto.
Cuotas iniciales: 1 RUN y 2 SUBMIT activos por actor/organización, 4 combinados
por organización y 10 admisiones combinadas por minuto/actor/organización.

**Contrato RUN IMP-03.01–03.03 (26/09/2026).** La ruta de ejecución usa exclusivamente
pruebas visibles y devuelve `RunExecution` según OpenAPI. Admite código de hasta
65536 bytes UTF-8 y un envoltorio HTTP de 512 KiB específico, sin ampliar el límite
general. Una reserva durable serializa con el cierre, la ejecución sucede fuera
de la transacción y el resultado público se conserva 24 horas para idempotencia.
No se guarda la fuente ni se crea intento. La misma clave/payload recupera la
misma ejecución; una clave vencida devuelve `IDEMPOTENCY_EXPIRED` y nunca ejecuta
otra vez. RUN admitido puede terminar después del cierre; devolver o recuperar
su resultado exige acceso vigente. Cuotas y reconciliación están documentadas en
[IMP-03](../docs/work/IMP-03-practice.md). Las rutas de feedback de esta sección
continúan pendientes de sus incrementos.

```json
{
  "data": {
    "attemptId": "11111111-1111-4111-8111-111111111111",
    "executionId": "33333333-3333-4333-8333-333333333333",
    "activityId": "44444444-4444-4444-8444-444444444444",
    "assignmentId": "55555555-5555-4555-8555-555555555555",
    "exerciseVersionId": "22222222-2222-4222-8222-222222222222",
    "testsVersion": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "attemptNumber": 1,
    "previousAttemptId": null,
    "admittedAt": "2026-09-26T15:00:00Z",
    "submittedAt": "2026-09-26T15:00:02Z",
    "code": "module.exports.solve = () => 0;",
    "technicalResult": {
      "runnerVersion": "imp-03-quickjs.4",
      "diagnosisCode": "FAILED_TEST",
      "visibleTestResults": [
        { "id": "66666666-6666-4666-8666-666666666666", "passed": false, "stdout": "", "stderr": "" },
        { "id": "77777777-7777-4777-8777-777777777777", "passed": false, "stdout": "", "stderr": "" }
      ],
      "visiblePassed": 0,
      "visibleTotal": 2,
      "hiddenChecksPassed": false,
      "allRequiredPassed": false,
      "outputTruncated": false,
      "outputBytes": 0,
      "runtimeMs": 34,
      "lifecycleMs": 2000,
      "infrastructureStatus": "OK",
      "terminationReason": "ASSERTION_FAILED"
    }
  },
  "requestId": "88888888-8888-4888-8888-888888888888"
}
```

`hiddenChecksPassed` solo indica el resumen permitido; nunca incluye entradas, salidas esperadas, nombres reveladores o stack del arnés oculto. `allRequiredPassed` lo calcula el servidor y solo es verdadero con verificaciones completas. El campo no es una calificación.

**RAG documentado:** la carga interna del feedback siempre contiene `diagnosis_code`, `explanation`, `hint`, `source_refs`, `status`. No incluir `score` ni reinterpretar `diagnosis_code`. [IA y procesamiento](08-ia-y-procesamiento.md) define schema y fallbacks. `QUEUED/RUNNING` son estados del trabajo, nunca valores de `status` RAG.

## Fuentes e ingestión

Contratos ejecutables de IMP-04.01–04.03 en
[`materials.ts`](../packages/contracts/src/materials.ts). Todas las rutas usan
`/api/v1`, JWT vigente, proyección pública validada y `no-store`. Los listados
usan `cursor`/`limit`; `activityId` en fuentes intersecta materiales generales
de esa clase y los de la actividad elegida.

| Método y ruta | Actor / entrada | Resultado | RF |
| --- | --- | --- | --- |
| `GET /classes/{id}/sources` | Profesor asignado/ADMIN; alumno inscrito ve fuentes disponibles autorizadas | Fuente, disponibilidad, versión activa, cantidad de fragmentos, permisos y último trabajo permitido | 006,025 |
| `GET /classes/{id}/source-scopes` | Profesor asignado/ADMIN | Solo ID, título y estado de las actividades; no concede lectura pedagógica a ADMIN | 006,025 |
| `POST /classes/{id}/sources` | Profesor/ADMIN; multipart `file`, `title`, `activityId?`; `Idempotency-Key` | 202 después de confirmar archivo/reserva/trabajo; `data: {source, version, job}` | 006,025 |
| `GET /sources/{id}` | Acceso vigente sobre clase/fuente | Metadatos y disponibilidad separados del último procesamiento | 006,025 |
| `GET /sources/{id}/versions` | Profesor asignado/ADMIN con permiso de historia | Versiones inmutables paginadas, incluidas fallidas; no expone ruta Storage | 006,025 |
| `POST /sources/{id}/versions` | ADMIN o docente dueño; multipart `file`; `If-Match` e `Idempotency-Key` | 202 con nueva versión y trabajo; conserva la anterior hasta completar publicación | 006,025 |
| `GET /sources/{id}/versions/{versionId}/chunks` | Profesor asignado/ADMIN, fuente activa | Fragmentos de la generación completa de la versión, con texto/localizador/tokens/hash; sin vectores ni fragmentos parciales | 006,025 |
| `GET /sources/{id}/jobs/{jobId}` | Gestor autorizado de la fuente | Estado público del trabajo, intentos y error seguro; sin tokens de lease | 006,025 |
| `PATCH /sources/{id}/visibility` | ADMIN; `{visible: boolean}`, `If-Match` | Nueva revisión auditable; la clase y actividad permanecen fijas | 025 |
| `POST /sources/{id}/reindex` | ADMIN o docente que reintenta su carga fallida; `{versionId?}`, `If-Match`, `Idempotency-Key` | 202 con nueva generación; la versión debe pertenecer a la fuente y tener archivo confirmado | 006,025 |
| `POST /sources/{id}/archive` | ADMIN; `{reason}`, `If-Match`, `Idempotency-Key` | Excluye inmediatamente recuperación/descarga y cancela activación pendiente; conserva historia | 025 |
| `GET /sources/{id}/versions/{versionId}/content` | Usuario con acceso vigente; alumno limitado a versión activa | Bytes como adjunto a través de API; autoriza antes y después de Storage, sin enlace público | 006,025 |

DEC-010 fija 10 MB como **10.000.000 bytes**. Se validan tamaño real, formato
detectado y nombre seguro. PDF sin texto, corrupto/cifrado o extracción excedida
termina con un error accionable, sin índice utilizable. No hay OCR ni ingestión
de URLs. Clases/actividades ajenas, campos desconocidos y reasignación de ámbito
se rechazan; ADMIN no recibe acceso a código o intentos por gobernar materiales.

`MaterialSource.state` contiene `ACTIVE/ARCHIVED`; `availability` contiene
`NOT_READY/READY/HIDDEN/ARCHIVED`. `latestJob.state` usa
`UPLOADING/QUEUED/RUNNING/SUCCEEDED/FAILED` y puede ser `null` según la proyección.
`UPLOADING` informa una recepción todavía no confirmada; el `202` requiere
confirmación durable del archivo y trabajo. Una
reindexación fallida puede coexistir con una versión anterior `READY`. Los
estados de generación internos no amplían el contrato RAG.

Los fragmentos se ordenan por índice con cursor de índice y paginación
acotada. La recuperación vectorial se filtra por organización/clase/actividad,
visibilidad, generación activa y perfil compatible antes de top-k=5; en este
corte se verifica por la función autorizada de datos, sin endpoint público de
ayuda sobre intentos en IMP-04.01–04.03. El corte siguiente añade estas interfaces.

### Ayuda propia implementada en IMP-04.04–04.06

El [contrato Zod](../packages/contracts/src/help.ts) y OpenAPI definen las siete
rutas bajo `/api/v1`. Solo STUDENT ACTIVE propietario con acceso vigente puede
usarlas; ADMIN y docentes no reciben lectura pedagógica adicional. CLOSED permite
ayuda sobre evidencia histórica sin habilitar otro envío.

| Método y ruta | Contrato |
| --- | --- |
| `POST /attempts/{id}/feedback-requests` | `kind: FEEDBACK\|HINT`, `hintLevel?`, Idempotency-Key; 202 tras reserva confirmada |
| `GET /feedback-requests/{id}` | Estado durable y vínculo al resultado; no registra lectura |
| `GET /attempts/{id}/feedback` | Historial de metadatos, cursor, máximo 20 y capacidades actuales |
| `GET /feedback/{id}` | Contenido autorizado y token de presentación ligado al feedback |
| `POST /feedback/{id}/viewed` | ACK `{presentationToken}` idempotente; registra presentación explícita |
| `GET /feedback/{id}/sources/{chunkId}` | Solo cita perteneciente al feedback: versión original, extracto y localizador |
| `GET /feedback/{id}/sources/{chunkId}/content` | Binario de la versión originalmente citada por NestJS, no-store y autorización vigente |

El envoltorio separa identidad/fechas/tipo/nivel/estado del objeto RAG, que conserva
sus cinco campos y tres estados. FEEDBACK siempre tiene `hint` vacío. Las pistas
preparadas permanecen reservadas hasta ACK; un fallback no consume nivel. Replays
devuelven el trabajo existente y otro payload con la misma clave produce 409.
La explicación válida se reutiliza. Polling no crea eventos. Ocultar/archivar una
fuente suprime texto derivado y referencias, aunque no fuera citada. Las descargas
genéricas de materiales para estudiantes siguen limitadas a versiones activas.
Véanse límites y eventos en el [registro de ayuda](../docs/work/IMP-04-help.md).

### Listener operacional privado de evaluación

IMP-04.07/preparación .08 incorpora un listener independiente en loopback,
habilitado solo para TEST/LAB-EVAL con `EVALUATION_ENABLED` y
`EVALUATION_OPERATIONS_PORT` (4401 en el perfil fijado). No forma parte de
`/api/v1`, de la interfaz estudiantil ni de los permisos ADMIN. La credencial
opaca ligada al run se genera durante autorización de mantenimiento; no es un
JWT de usuario ni permite crear/modificar el manifiesto aprobado.

| Método y ruta operacional | Conducta |
| --- | --- |
| `GET /operations/ai-runs/{id}` | Estado, etapas, presupuestos/totales, resultados operacionales y calibración del run autorizado |
| `GET /operations/ai-runs/{id}/receipts?cursor=&limit=` | Proyección segura, cursor UUID, límite 1–100, `items/nextCursor`; sin contenido privado ni tokens de despacho |
| `POST /operations/ai-runs/{id}/stages/{stage}/start` | Inicia una de las cuatro etapas solo si la precedente está confirmada; cuerpo vacío |
| `POST /operations/ai-runs/{id}/stop` | Detiene nuevos despachos/publicaciones de la corrida; no borra recibos ni consumo tardío; cuerpo vacío |

Todas las respuestas son `no-store`; se rechazan origen de navegador, cuerpo de
petición y acceso fuera de loopback. El
[contrato privado compartido](../packages/contracts/src/evaluation.ts) valida
manifiestos, perfiles, observaciones y recibos. Las cargas de materiales y
solicitudes/ACK/referencias del experimento usan las rutas de producto existentes,
JWT de actores autorizados, `Idempotency-Key`, revisión y cuotas normales.
Los bindings de servidor intersectan esos permisos con el alcance, hash,
operaciones y presupuesto del run. No existe endpoint operacional para ejecutar
un prompt arbitrario. El [manual](../docs/work/IMP-04-evaluation-operations.md)
separa preparar/autorizar/ejecutar. Los contratos y el arnés están probados en
TEST: la CI completa del 02/10/2026 aprobó 146 pruebas HTTP y 45 recorridos
Cypress sin omisiones; el run de evaluación cerró 43/43 casos y tres
reanudaciones. Los resultados y sus límites constan en el
[registro de evaluación](../docs/work/IMP-04-evaluation.md). IMP-04.08 conserva
el alcance de preparación ejecutable; Azure, p95 remoto, evaluación semántica,
revisión docente y aceptación CAPSTONE permanecen pendientes.

## Progreso, tablero, señales y auditoría

| Método y ruta | Actor y filtros | Resultado | RF |
| --- | --- | --- | --- |
| `GET /me/progress` | Estudiante; `classId` obligatorio, actividad/concepto, `from/asOf`, cursor/límite | Progreso acumulado, evidencia de completitud y observación personal del período | 015 |
| `GET /classes/{id}/dashboard` | Profesor asignado; actividad/concepto, `from/asOf`, cursor/límite | Agregados, estudiantes paginados, contadores de señales y procesamiento | 016 |
| `GET /classes/{id}/dashboard/evidence` | Profesor asignado; mismos filtros, clase de evidencia y estudiante opcional | Evidencia mínima paginada del conjunto vigente; diagnóstico solo para intentos | 016 |
| `GET /classes/{id}/signals` | Profesor asignado; tipo/estado, actividad/concepto, `asOf`, cursor/límite | Episodios persistidos, pertenencia actual explícita y procesamiento | 018 |
| `GET /classes/{id}/signals/{signalId}` | Profesor asignado; `asOf` | Regla, causa, fechas, última evaluación y evidencia mínima autorizada | 018 |
| `PUT /signals/{id}/review` | Profesor ACTIVE asignado; estudiante CURRENT_ACTIVE; body `{}` estricto, sin query | Revisión y auditoría atómicas; replay reautorizado conserva primer autor/fecha y evidencia; contrato IMP-06.04 | 019 |
| `GET, POST /organizations/{orgId}/signal-rules` | ADMIN ACTIVE; filtros administrativos o tipo/schema/algoritmo/parámetros estrictos, Idempotency-Key al crear | Lista o versión DRAFT, sin fechas cliente | 026 |
| `GET /organizations/{orgId}/signal-rules/effective` | ADMIN ACTIVE; sin filtros, lectura administrativa permitida en organización archivada | Tres tipos con versión ACTIVE o null, observación UTC consistente e independiente del historial paginado | 026 |
| `GET /signal-rules/{id}` | ADMIN ACTIVE de la organización de la versión | Configuración e historia administrativa, sin evidencia individual | 026 |
| `POST /signal-rules/{id}/activate` | ADMIN ACTIVE; expectedCurrentVersionId UUID o null obligatorio e Idempotency-Key | Activación inmediata servidor [A,B), CAS/auditoría/replay, sin borrar previas | 026 |
| `GET /health/live`, `GET /health/ready` | Acceso operativo restringido para detalle | Vida y disponibilidad mínima; sin secretos | RNF-POR-03 |

Las siguientes rutas son **propuestas para incrementos pendientes**. El soporte
persistido no equivale a su disponibilidad HTTP; RF-017 se implementa por separado
en las rutas docentes IMP-06.03 descritas más abajo:

| Método y ruta propuesta | Actor y resultado previsto | RF |
| --- | --- | --- |
| `GET /organizations/{orgId}/audit-events` | ADMIN; lista con fecha, actor, acción y entidad | 027 |
| `POST /organizations/{orgId}/audit-exports` | ADMIN; CSV filtrado con auditoría de la exportación | 027 |

Los contadores y su evidencia se concretan en [progress.ts](../packages/contracts/src/progress.ts)
y [dashboard.ts](../packages/contracts/src/dashboard.ts). `ratio=null` si
`required=0`; nunca NaN ni división por cero. `evidenceState` es metadato de vista,
no diagnóstico o estado RAG. La [especificación de reglas](14-progreso-y-senales.md)
fija interpretación y ejemplos; no se usa un porcentaje almacenado como fuente de verdad.

**Contrato IMP-05.01–05.02, 02/10/2026:** `GET /api/v1/me/progress` requiere
classId; admite activityId/conceptId/asOf y deriva el alumno de la sesión.
Devuelve filtros, corte UTC, summary/byActivity/byConcept y evidencia del primer
éxito por asignación. Publicaciones y confirmaciones hasta el corte son
inclusivas; fecha futura se rechaza y los permisos son actuales. La ruta
`GET /activities/{id}/progress` conserva su forma como wrapper de ese cálculo.
`POST /api/v1/activities/{id}/open-events` recibe {} y Idempotency-Key permanente
por alumno/actividad/clave; devuelve 201 con eventId/activityId/occurredAt de
servidor. Los [contratos ejecutables](../packages/contracts/src/progress.ts),
OpenAPI y el [diccionario](../docs/work/IMP-05-progress-dictionary.md) concretan
este corte histórico; .07 amplía después la lectura personal y añade las rutas
docentes. Reglas se concretan en IMP-05.03 a continuación.

**Contrato IMP-05.03, 05/10/2026:** API de reglas bajo
`/api/v1`, JWT/permisos ACTIVE vigentes y `no-store`. Crear recibe unión estricta
`{type,schemaVersion:1,algorithmVersion:DEC005_V1,parameters}`. Parámetros por
tipo: `{inactivityDays}`, `{repeatedErrorAttempts,repeatedErrorWindowDays}` o
`{stagnationAttempts}`; días positivos y conteos >=2 dentro de int4. Rechazar
extras, fracciones, coerción, algoritmo/schema desconocido y parámetros de otro
tipo. No aceptar scripts, IDs de autor/organización o estado/fecha de cliente.

El listado admite solo type?, cursor UUID? y limit 1–100 (50 por defecto), con
`{data:[],page:{hasMore,nextCursor},requestId}`. Proyección de versión:
`{id,organizationId,type,version,schemaVersion,algorithmVersion,parameters,state,
createdBy,createdAt,activatedBy,validFrom,validTo}`. DRAFT/ACTIVE/RETIRED pertenece
a versiones; señales conservan ACTIVE/REVIEWED. Crear confirma 201 DRAFT y no
activa automáticamente; activación confirma 200 con la versión/resultados durables.

Activar exige `{expectedCurrentVersionId:UUID|null}`, con null para esperar
ausencia de vigente. Serializar por organización/tipo; cerrar anterior y abrir
nueva a la misma hora servidor A, con auditoría y snapshot de respuesta
idempotente atómicos. Sin programación, retroactividad ni fecha efectiva cliente.
Una carrera produce 409 RULE_VERSION_CONFLICT; una RETIRED no se reactiva
(409 RULE_VERSION_ALREADY_ACTIVATED). Replay de la misma clave/payload conserva
snapshot original; otro payload es 409. Nueva clave apuntando a la versión ya
activa con expected igual a ella es no-op, conservando fecha/autor/auditoría.

ADMIN de reglas no obtiene permisos pedagógicos. TEACHER/STUDENT o membresía
inactiva se rechaza; versión ajena/inexistente tiene respuesta segura 404.
ADMIN actual con perfil/membresía ACTIVE y sesión vigente conserva lectura
administrativa de organización ARCHIVED. Crear/activar y replays de mutación
exigen organización ACTIVE; archivada devuelve 409 ORGANIZATION_ARCHIVED.
Parámetros/cursor inválidos producen 422 VALIDATION_FAILED, con campo seguro
parameters/cursor; RULE_PARAMETERS_INVALID/RULE_CURSOR_INVALID son códigos SQL
internos. Idempotency-Key inválida/ausente produce 400. Persistencia caída
devuelve falla, nunca una configuración ficticia o vacía como éxito.
El [diccionario .03](../docs/work/IMP-05-signal-rules-dictionary.md) coordina campos,
RLS/transacciones y límites; el [registro](../docs/work/IMP-05-rules.md) conserva
pruebas realmente observadas, incluido el corte inicial con CI pendiente.
.03 aislado no incluía evaluadores, episodios ni UI; .04–.06 los incorporaron
después. La revisión docente pública permanece pendiente.

**Ampliación IMP-05.06, 25/10/2026:** la consulta `/signal-rules/effective`
bajo organización devuelve `{data:{organizationId,observedAt,rules},requestId}`,
con exactamente tres entradas `{type,ruleVersion}`. Cada versión no nula es
ACTIVE y pertenece al tipo/organización solicitados; null significa sin
configuración activa, no una conclusión sobre estudiantes. `observedAt` es
hora UTC de observación del servidor y no acredita procesamiento del worker.
Se obtiene el conjunto en un snapshot de sentencia y no desde la primera
página del historial. Rechaza query extra con 422 y conserva autorización,
lectura de archivo y `no-store` del módulo. El [diccionario incremental](../docs/work/IMP-05-signal-rules-dictionary.md)
detalla recuperación web y RPC; el [registro .06](../docs/work/IMP-05-rules-ui.md)
conserva pruebas y estado de cierre. Las mutaciones .03 y su semántica siguen
vigentes; el cierre local posterior de .03/.04/.05 consta en
[episodios](../docs/work/IMP-05-episodes.md).

CSV: encabezados fijos propuestos `event_id,occurred_at,actor_id,action,entity_type,entity_id,organization_id,outcome`. Adjuntar alcance y fecha de generación en metadatos descargables sin revelar información fuera del filtro. Sanitizar fórmulas de hoja de cálculo, comillas y saltos de línea. Si no hay registros, entregar encabezados y el contexto de exportación. Generar auditoría antes de confirmar la entrega; nunca exportar tokens, contraseñas, tests ocultos o código completo por defecto.

## Consultas de progreso, tablero y señales — IMP-05.07–05.08

**Ampliación IMP-05.07, 26/10/2026:** las consultas docentes se concretan en
`GET /api/v1/classes/{id}/dashboard`, `/dashboard/evidence`, `/signals` y
`/signals/{signalId}`. Requieren docente asignado con permisos actuales,
devuelven proyecciones mínimas y no ejecutan evaluadores ni registran eventos
estudiantiles. `GET /me/progress` añade observación personal del período sin
cambiar el progreso acumulado. Contratos ejecutables y semántica de matrícula
vigente, historia al corte, cursores y procesamiento en el
[diccionario .07](../docs/work/IMP-05-dashboard-dictionary.md),
[dashboard.ts](../packages/contracts/src/dashboard.ts),
[progress-observation.ts](../packages/contracts/src/progress-observation.ts)
y [progress.ts](../packages/contracts/src/progress.ts). El [registro .07](../docs/work/IMP-05-dashboard.md)
conserva su corte y el [cierre .08](../docs/work/IMP-05-acceptance.md) la verificación transversal posterior.
Ese corte no incluía detalle integral RF-017 ni mutación de revisión RF-019.
IMP-06.03 incorpora después la consulta integral descrita a continuación;
IMP-06.04 implementa RF-019 con focos aprobados y cierre integral pendiente según
su [registro](../docs/work/IMP-06-signal-review.md). El gobierno administrativo del banco no
concede esos permisos docentes.

`from` limita intentos/eventos observados, sin retirar logros previos ni limitar
la última actividad anterior al corte. La población de los totales docentes es
`CURRENT_ACTIVE`, incluso para `asOf` histórico; las señales autorizadas fuera
de esa población permanecen etiquetadas. El listado de señales no admite `from`
y usa `ACTIVE` por defecto; `ALL` es un filtro, nunca un estado persistido.
La evidencia mínima excluye código, consola, contenido RAG y pruebas ocultas.

Cada respuesta aplica permisos vigentes y un snapshot consistente. El cursor
está ligado al actor, ámbito, filtros, corte y orden estable; las siguientes
páginas envían el `asOf` resuelto por el servidor. Esto no congela commits
tardíos entre peticiones. Fechas/filtros inválidos y cursores incompatibles
producen 422; un corte futuro conserva 400. El esquema estricto de cada ruta
determina los campos admitidos. Una falla de consulta devuelve error, no ceros.

La proyección distingue estado del episodio, interrupción, última evaluación
persistida del propio episodio, verificabilidad y frescura actual. No promete
evaluación exactamente en T. `UP_TO_DATE/PENDING/FAILED/NOT_EVALUATED` describe
procesamiento, no estados de señal ni conclusiones académicas. Consultar no
invoca IA, evalúa reglas, modifica el worker ni crea eventos de lectura estudiantil.

IMP-05.08 conserva firmas y DTO públicos; sus dos migraciones optimizan las
consultas de frescura y resumen. La actualización .07→.08 comparó las cinco
superficies públicas al mismo corte, excluyendo únicamente `observedAt`, y
preservó hechos, grafo de roles y ACL. Los resultados y límites pertenecen al
[registro de aceptación](../docs/work/IMP-05-acceptance.md), sin convertirlos en
validación remota ni aceptación CAPSTONE.

## Detalle docente del estudiante — IMP-06.03

**Contrato con cierre técnico local:** los
[schemas estrictos](../packages/contracts/src/student-detail.ts) y el
[diccionario .03](../docs/work/IMP-06-student-detail-dictionary.md) concretan
RF-017 E1–E4. El [registro del incremento](../docs/work/IMP-06-student-detail.md)
documenta las pruebas, las incidencias y los límites de este cierre.
Todas las rutas siguientes son GET bajo
`/api/v1/classes/{classId}/students/{studentId}`, con JWT, sesión vigente,
respuesta `{data,requestId}` y `Cache-Control: no-store`, salvo los bytes de descarga.

| Sufijo de ruta | Filtros | Resultado |
| --- | --- | --- |
| `/progress` | Actividad/concepto, `from/asOf`, cursor/límite | Identidad mínima, padrón `CURRENT_ACTIVE`, progreso canónico y observación paginada. |
| `/evidence` | Mismos filtros, `kind=ATTEMPT/COMPLETION/EVENT/HINT`; diagnóstico solo para ATTEMPT | Evidencia del estudiante del path; no admite `studentId` alternativo en query. |
| `/attempts/{attemptId}` | `asOf` | Intento confirmado con código/resultado y enunciado, conceptos y pruebas visibles de su versión fija. |
| `/attempts/{attemptId}/feedback` | `asOf`, cursor/límite 1–20, 20 por defecto | Metadatos paginados de ayudas entregadas/vistas antes del corte. |
| `/feedback/{feedbackId}` | `asOf` | Ayuda persistida disponible o `available=false, help=null`. |
| `/feedback/{feedbackId}/sources/{chunkId}` | `asOf` | Cita exacta: fuente/versión/fragmento, nombre de archivo, formato, texto y localizador autorizados. |
| `/feedback/{feedbackId}/sources/{chunkId}/content` | `asOf` | Bytes privados de la versión citada, hash/tamaño verificados y permiso revalidado tras Storage. |
| `/signals` | Actividad/concepto, tipo/estado, `asOf`, cursor/límite | Episodios y procesamiento del estudiante, filtrados antes de paginar. |
| `/signals/{signalId}` | `asOf` | Regla, causa, fechas y evidencia del episodio de esa clase y estudiante. |

La autoridad es el docente actualmente asignado con perfil/membresía ACTIVE y
el estudiante actualmente inscrito con perfil y membresía STUDENT ACTIVE de la
misma organización. El corte pasado no restaura una matrícula o permiso retirado.
ADMIN de gobierno no recibe acceso pedagógico. Cada ID hijo se verifica dentro
del ámbito completo; recurso ajeno/inexistente devuelve 404 sin datos personales.
Los GET del alumno conservan sus permisos propios y no se usan para estas lecturas.

`asOf` y `observedAt` identifican corte y observación; se conserva la precisión
UTC de microsegundos. El servidor resuelve el corte ausente y las páginas
siguientes lo transmiten. `from` limita observaciones, no completitud ni última
actividad anterior; las señales no admiten `from`. Evidencia/progreso/señales
conservan límite predeterminado 50 y máximo 100. Los cursores ligan actor,
clase, estudiante, recurso, filtros, corte y orden. Filtros/cursor inválidos
devuelven 422, corte futuro 400; un filtro válido vacío conserva su estado
sin evidencia. Las fallas no se convierten en ceros o éxito vacío.

Por decisión explícita para .03, la ayuda docente requiere un evento persistido
`HINT_DELIVERED` o `FEEDBACK_VIEWED` hasta `asOf`. Generación o presentación sin
ACK no habilita listado, acceso por ID ni cita. Cada resumen incluye `id`,
`attemptId`, `kind`, `hintLevel`, `status`, `createdAt`, `deliveredAt` y
`available`; el detalle añade `help` con los cinco campos RAG existentes o null.
No entrega tokens de presentación, capacidades para pedir ayuda ni entradas
del proveedor. La disponibilidad y autorización de fuentes son actuales;
el contenido revocado no se vuelve a entregar. La descarga mantiene el corte
original y reautoriza docente, matrícula, entrega y fuente después de Storage.
Los campos privados de almacenamiento nunca forman parte del JSON público.

Estas consultas usan transacciones de solo lectura. No invocan IA, ejecutan
evaluadores, revisan señales, registran actividad estudiantil ni alteran
intentos, progreso, solicitudes, acuses o auditoría. La respuesta del intento
reutiliza el resultado canónico y `hiddenChecksPassed` como resumen público;
ningún detalle de pruebas ocultas se incorpora a esta superficie. Los wrappers
de tablero y señales de clase conservan su comportamiento previo.

## Interfaces internas de señales — IMP-05.05

El corte .05 no añadió rutas HTTP de producto. Sus interfaces tipadas
de carril, snapshot, frontera, evaluación, episodio y reclamación son internas;
el worker usa funciones privadas con contexto transaccional vacío y un token
de lease vigente. La lectura interna de evidencia mínima exige docente
asignado y permisos actuales. ADMIN de reglas no adquiere lectura pedagógica.
El soporte persistido de `REVIEWED` no publica una acción docente ni cierra
RF-019. Véanse [diccionario](../docs/work/IMP-05-episodes-dictionary.md) y
[registro de verificación](../docs/work/IMP-05-episodes.md).

La captura durable y el worker recuperable están implementados; el flag
`SIGNALS_WORKER_ENABLED` permanece desactivado por defecto. El mantenimiento
`signals:rebuild` separa `plan/check/rebuild/report`, con ámbito y destino local
explícitos. Reconstruye derivados desde snapshots sin revisar señales ni
reescribir hechos/checkpoints. Estas operaciones internas no son endpoints
estudiantiles o docentes y no conceden privilegios de mantenimiento al navegador.

## Validación y contratos derivados

**IMP-06.02 — gobierno del banco.** `PATCH /exercises/{id}/governance`
exige ADMIN vigente, `If-Match` e `Idempotency-Key`; admite únicamente cambios
de `ownerId` y/o `visibility`. El destino es ADMIN/TEACHER ACTIVE del mismo
ámbito con perfil ACTIVE; visibilidad PRIVATE/ORGANIZATION. Devuelve detalle
y ETag, conserva referencias históricas y audita junto con el cambio efectivo.
`GET /exercises/{id}/governance/content` entrega la definición vigente de
autoría exclusivamente a ADMIN. `POST /exercises/{id}/versions` añade ADMIN
a la autorización previa del docente propietario, sin conceder publicación ni
evidencia estudiantil. El archivo conserva DEC-002. Contratos, recuperación,
rechazos y resultados en el [registro .02](../docs/work/IMP-06-bank-governance.md).

**Propuesta inicial de longitudes:** nombres/títulos 1–160 caracteres normalizados; descripciones 0–10.000; código hasta 64 KiB UTF-8; notas de revisión hasta 2.000. Los módulos implementados concretan sus límites en los [schemas compartidos](../packages/contracts/src/index.ts) y diccionarios respectivos; esta propuesta no los reemplaza. La propuesta histórica de notas no aplica a IMP-06.04: su contrato exige cuerpo `{}` sin notas. No confundir el límite del código fuente con 64 KB de salida del proceso, fijado por la ERS.

El schema OpenAPI debe generarse o mantenerse junto a DTO validados e incluir request/response/errores/ejemplos/permisos. El cliente se valida contra esos contratos. Antes de aceptar una ruta, demostrar caso permitido, inválido, ajeno, estado inactivo y concurrencia relevante. Los [escenarios funcionales](03-flujos-y-criterios-de-aceptacion.md) definen las expectativas de negocio por RF.

El diseño lógico de [persistencia](06-modelo-de-datos.md) propuso mapeos como
`instructions → description`, `diagnosisCode → diagnosis_code` y
`evidenceState → evidence_status`; no todos son columnas físicas. IMP-02
conserva `instructions` y fija `startDate/endDate → start_date/end_date` como
fechas sin hora. SUBMIT persiste el resultado público en `technical_result`;
IMP-05 calcula `evidenceState` en su proyección, sin una tabla de porcentajes.
Los diccionarios ejecutables describen los mapeos vigentes. No se convierten
fechas académicas en instantes UTC; la exportación CSV pendiente conserva su propuesta.
