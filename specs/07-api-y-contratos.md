# API y contratos de Alunza

Estado: **contratos institucionales concretados para IMP-01 / DEC-004**; las áreas académicas posteriores permanecen propuestas. Fuentes: F01 ERS §§3.1–3.3 y F03 casos de uso en [fuentes](00-fuentes-y-decisiones.md). La API institucional implementada se describe también en [OpenAPI](../packages/contracts/openapi.json) y [DTO compartidos](../packages/contracts/src/index.ts). La ejecución local se registra en docs/work, sin acreditar despliegue remoto.

## Convenciones

- API de dominio exclusiva de NestJS bajo `/api/v1`, HTTPS, JSON UTF-8. Excepciones explícitas: carga binaria y exportación CSV.
- DTO públicos en `camelCase`; contrato RAG conserva exactamente sus cinco claves en `snake_case`.
- IDs opacos UUID, fechas ISO 8601 en UTC, números finitos. La interfaz presenta zona `America/Santiago` cuando corresponde.
- Cada request protegido lleva `Authorization: Bearer <JWT>` de Supabase Auth. El backend valida token, cuenta, membresía activa y ámbito real del recurso.
- `organizationId` y `classId` delimitan recursos; nunca prueban por sí solos autorización. Las listas filtran antes de paginar o contar.
- Roles API propuestos `ADMIN`, `TEACHER`, `STUDENT`; la interfaz usa administrador, profesor y estudiante. Un permiso administrativo no implica lectura automática de todo código estudiantil.
- Paginación por `cursor` opaco y `limit` entero, propuesta 20 por defecto y máximo 100. Filtros y orden permitidos se enumeran por endpoint; no se aceptan fragmentos SQL.
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

**Idempotencia propuesta:** `Idempotency-Key` obligatorio para crear ejecuciones, intentos, trabajos de feedback, invitaciones y exportaciones. Alcance `(actor, organización, operación, clave)` más hash de payload. Misma clave y payload devuelve el mismo recurso; distinto payload devuelve 409. Una reserva transaccional impide que dos requests concurrentes creen dos envíos. Si sigue procesándose, devolver 409 `REQUEST_IN_PROGRESS` con `Retry-After`; una reserva vencida se reconcilia con el resultado persistido antes de reejecutar.

Guardar el recurso confirmado y la respuesta idempotente en la misma transacción. **Propuesta:** retener claves de solicitudes terminadas 24 horas; fijar el plazo definitivo en DEC-004/009. Un nuevo intento deliberado requiere nueva clave. La interfaz conserva su clave hasta conocer el desenlace.

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
| `GET, POST /organizations/{orgId}/classes` | ADMIN; TEACHER crea en curso permitido | `courseId`, `code`, `name`, `startsAt`, `endsAt` | 002,022 |
| `GET, PATCH /classes/{id}` | ADMIN o profesor asignado según campos | Profesor edita configuración propia; solo ADMIN reasigna profesor | 002,022 |
| `POST /classes/{id}/archive` | ADMIN | Bloquear dependencias activas, conservar historial | 022 |
| `PUT /classes/{id}/teacher` | ADMIN | `teacherId` activo de misma organización | 022 |
| `POST /classes/{id}/join-codes` | Profesor asignado o ADMIN | `expiresAt`; devuelve código una vez, almacena digest | 002 |
| `POST /classes/{id}/join-codes/{codeId}/revoke` | Emisor autorizado | Revoca usos futuros, conserva membresías existentes | 002 |
| `POST /class-enrollments` | STUDENT activo | `code`; misma organización, vigente, no inscripción duplicada | 003 |
| `GET /classes/{id}/students` | Profesor asignado o ADMIN de estructura | Lista limitada a datos de membresía | 017,022 |
| `GET, POST /organizations/{orgId}/concepts` | ADMIN escribe; miembros autorizados leen | `name`, `description`, `parentId?`; unicidad normalizada, sin ciclos | 023 |
| `PATCH /concepts/{id}` y `POST /concepts/{id}/archive` | ADMIN | Nueva versión; conserva referencias | 023 |
| `GET, POST /organizations/{orgId}/exercises` | ADMIN o TEACHER autorizado | Filtros concepto/dificultad/estado, DTO de ejercicio | 004,024 |
| `GET /exercises/{id}/versions` | Docente con acceso al banco o ADMIN autorizado | Versiones reutilizables del ámbito; lectura compartida no concede edición de autor | 004,024 |
| `POST /exercises/{id}/versions` | Autor docente o ADMIN autorizado | Nueva versión completa; no modifica uso publicado | 004,024 |
| `PATCH /exercises/{id}/governance` | ADMIN | Propiedad/visibilidad dentro de organización | 024 |
| `POST /exercises/{id}/archive` | ADMIN | Retirar de nuevas asignaciones, conservar uso histórico; efecto sobre publicación vigente pendiente DEC-002 | 024 |
| `GET /classes/{id}/activities` | Profesor asignado; STUDENT ve publicadas | Listado autorizado con estado y avance | 005,007 |
| `POST /classes/{id}/activities` | Profesor asignado | `title`, `type`, `instructions`, ejercicios ordenados y ventana | 005 |
| `GET, PATCH /activities/{id}` | Autor docente; estudiante según publicación | Edición DRAFT; protección de versión | 005,007 |
| `POST /activities/{id}/publish` | Profesor asignado | Validar contenido, tests, conceptos y orden; fija versiones | 005 |
| `POST /activities/{id}/close` | Profesor asignado | Cierra admisión; historial según DEC-002 | 005 |
| `GET /activities/{id}/exercises/{activityExerciseId}` | Estudiante inscrito | Enunciado, conceptos, plantilla y pruebas visibles únicamente | 008 |

`CourseInput` propuesto: `code`, `name`, `description?`, `academicPeriod`, `startDate?`, `endDate?`. El período académico está documentado en CU-022; su formato exacto queda por fijar. `ConceptInput` propuesto: `name`, `description`, `parentId?`; CU-023 documenta nombre y descripción. Normalizar para unicidad sin eliminar el texto original legible.

`ExerciseVersionInput` propuesto: `title`, `statement` (texto/Markdown), `starterCode`, `language: "javascript"`, `difficulty`, `conceptVersionIds[]`, `entrypoint`, `tests[]`, `executionLimits`. Cada test tiene ID, visibilidad, argumentos JSON, salida esperada y comparador permitido. Dificultades y comparadores exactos se fijan antes de cargar el banco; no son enums aprobados por ERS. El [ejecutor](13-ejecucion-controlada.md) define el contrato.

`ActivityInput` propuesto: `title`, `type`, `instructions`, `opensAt?`, `closesAt?`, `exercises: [{exerciseVersionId, position, required}]`. El tipo diagnóstica/formativa está documentado en CU-005; se proponen códigos `DIAGNOSTIC` y `FORMATIVE`. Debe tener al menos un ejercicio requerido para publicar. Sin duplicados ni posiciones repetidas. Los límites no pueden superar el máximo institucional. Fechas coherentes y recursos activos de la misma organización. No aceptar `teacherId`, `organizationId` o `publishedAt` como campos libres de un estudiante.

El código colectivo de incorporación puede usarse por varios estudiantes mientras esté vigente; la unicidad se aplica a cada membresía. Solo una invitación individual puede ser de uso único según su contrato. Tener rol ADMIN de gobierno no concede publicación de actividades sin asignación docente explícita.

## Práctica e intentos

| Método y ruta | Entrada | Resultado y condición | RF |
| --- | --- | --- | --- |
| `POST /activities/{id}/exercises/{aeId}/executions` | `code`, `exerciseVersionId` | Ejecuta pruebas visibles; 201 con `executionId` y resultado público, sin completar progreso | 009 |
| `POST /activities/{id}/exercises/{aeId}/attempts` | `code`, `exerciseVersionId`, `previousAttemptId?` | Ejecuta todas las pruebas requeridas y persiste; 201 con intento y resultado | 010,011,014 |
| `GET /activities/{id}/exercises/{aeId}/attempts` | Filtros cursor | Historial propio o del alumno permitido al profesor | 011,014,017 |
| `GET /attempts/{id}` | Sin payload | Código propio, fecha, versión y resultado público autorizado | 011,017 |
| `POST /attempts/{id}/feedback-requests` | `kind: "FEEDBACK"` o `kind: "HINT"`, `hintLevel?` | 202 con ID de trabajo durable; requiere intento persistido propio | 012,013 |
| `GET /feedback-requests/{id}` | Sin payload | Estado de trabajo; al terminar, `feedbackId` o error controlado | 012,013 |
| `GET /attempts/{id}/feedback` | Cursor opcional | Feedback validado y niveles concedidos; proyección propia/docente | 012,013,017 |

`previousAttemptId` solo vincula un intento del mismo estudiante y ejercicio asignado; no autoriza reutilizar ni alterar su código. Un envío siempre usa código y pruebas del servidor para una ejecución nueva: no confía en `executionId`, resultados, puntajes o hashes enviados por el navegador como prueba de éxito.

```json
{
  "data": {
    "attemptId": "11111111-1111-4111-8111-111111111111",
    "exerciseVersionId": "22222222-2222-4222-8222-222222222222",
    "submittedAt": "2026-09-10T15:00:00Z",
    "technicalResult": {
      "diagnosisCode": "FAILED_TEST",
      "visibleTests": [
        { "id": "visible-1", "passed": false },
        { "id": "visible-2", "passed": false }
      ],
      "visiblePassed": 0,
      "visibleTotal": 2,
      "hiddenChecksPassed": false,
      "allRequiredPassed": false,
      "stdout": "",
      "outputTruncated": false,
      "durationMs": 34
    },
    "feedbackAvailable": false
  },
  "requestId": "req-demo-003"
}
```

`hiddenChecksPassed` solo indica el resumen permitido; nunca incluye entradas, salidas esperadas, nombres reveladores o stack del arnés oculto. `allRequiredPassed` lo calcula el servidor y solo es verdadero con verificaciones completas. El campo no es una calificación.

**RAG documentado:** la carga interna del feedback siempre contiene `diagnosis_code`, `explanation`, `hint`, `source_refs`, `status`. No incluir `score` ni reinterpretar `diagnosis_code`. [IA y procesamiento](08-ia-y-procesamiento.md) define schema y fallbacks. `QUEUED/RUNNING` son estados del trabajo, nunca valores de `status` RAG.

## Fuentes e ingestión

| Método y ruta | Actor / entrada | Resultado | RF |
| --- | --- | --- | --- |
| `GET /classes/{id}/sources` | Profesor/ADMIN; alumno ve fuentes visibles autorizadas | Nombre, versión y estado permitido | 006,025 |
| `POST /classes/{id}/sources` | Profesor/ADMIN; multipart `file`, `title`, `activityId?` | 202 con fuente, versión y trabajo; PDF texto/TXT/MD ≤10 MB | 006,025 |
| `GET /sources/{id}` | Autoridad sobre esa clase/fuente | Metadatos y estado, no URL pública permanente | 006,025 |
| `PATCH /sources/{id}/visibility` | ADMIN autorizado | Alcance compatible con clase/actividad; nueva revisión auditable | 025 |
| `POST /sources/{id}/reindex` | ADMIN; docente reintenta su carga fallida según permiso | 202 con nueva generación, nunca mezcla versiones | 006,025 |
| `POST /sources/{id}/archive` | ADMIN | Excluye inmediatamente futuras recuperaciones | 025 |
| `GET /sources/{id}/versions/{versionId}/content` | Usuario con acceso vigente | Contenido o enlace temporal privado; reválida autorización | 013,025 |

Tamaño operativo propuesto: 10 MB significa 10.000.000 bytes, por confirmar en DEC-010. Rechazar PDF sin texto extraíble con mensaje de formato no procesable. No OCR ni ingestión de URLs arbitrarias en el MVP. La reindexación no duplica resultados en el corpus activo.

## Progreso, tablero, señales y auditoría

| Método y ruta | Actor y filtros | Resultado | RF |
| --- | --- | --- | --- |
| `GET /me/progress` | Estudiante; `classId`, `activityId`, `conceptId` | Numerador, denominador, proporción nullable y evidencia | 015 |
| `GET /classes/{id}/dashboard` | Profesor asignado; actividad/concepto/fecha | Agregados deterministas y señales autorizadas | 016 |
| `GET /classes/{id}/students/{userId}/progress` | Profesor asignado | Progreso y enlaces a intentos, sin datos de otras clases | 017 |
| `GET /classes/{id}/signals` | Profesor asignado; `type`, `state`, actividad | Causa, evidencia, fecha y regla aplicada | 018 |
| `PUT /signals/{id}/review` | Profesor asignado; `note?` | ACTIVE → REVIEWED; repetición conserva primer autor/fecha | 019 |
| `GET, POST /organizations/{orgId}/signal-rules` | ADMIN; parámetros, tipo y vigencia | Lista o versión nueva inactiva | 026 |
| `POST /signal-rules/{id}/activate` | ADMIN; fecha efectiva | Activa versión coherente sin borrar previas | 026 |
| `GET /organizations/{orgId}/audit-events` | ADMIN; fecha, actor, acción, entidad | Paginación y proyección permitida | 027 |
| `POST /organizations/{orgId}/audit-exports` | ADMIN; mismos filtros | CSV autorizado con auditoría de la exportación | 027 |
| `GET /health/live`, `GET /health/ready` | Acceso operativo restringido para detalle | Vida y disponibilidad mínima; sin secretos | RNF-POR-03 |

Progreso propuesto: `{completed, required, ratio, evidenceState, asOf, basisAttemptIds}`. `ratio=null` si `required=0`; nunca NaN ni división por cero. `evidenceState` es metadato de vista, no diagnóstico o estado RAG. La [especificación de reglas](14-progreso-y-senales.md) fija interpretación y ejemplos.

CSV: encabezados fijos propuestos `event_id,occurred_at,actor_id,action,entity_type,entity_id,organization_id,outcome`. Adjuntar alcance y fecha de generación en metadatos descargables sin revelar información fuera del filtro. Sanitizar fórmulas de hoja de cálculo, comillas y saltos de línea. Si no hay registros, entregar encabezados y el contexto de exportación. Generar auditoría antes de confirmar la entrega; nunca exportar tokens, contraseñas, tests ocultos o código completo por defecto.

## Validación y contratos derivados

Longitudes propuestas: nombres/títulos 1–160 caracteres normalizados; descripciones 0–10.000; código hasta 64 KiB UTF-8; notas de revisión hasta 2.000. Son límites de producto nuevos, sujetos a DEC-004. No confundir el límite del código fuente con 64 KB de salida del proceso, fijado por la ERS.

El schema OpenAPI debe generarse o mantenerse junto a DTO validados e incluir request/response/errores/ejemplos/permisos. El cliente se valida contra esos contratos. Antes de aceptar una ruta, demostrar caso permitido, inválido, ajeno, estado inactivo y concurrencia relevante. Los [escenarios funcionales](03-flujos-y-criterios-de-aceptacion.md) definen las expectativas de negocio por RF.

Mapeos explícitos hacia [persistencia](06-modelo-de-datos.md): `academicPeriod → academic_period`, instrucciones de actividad `instructions → description`, `opensAt/closesAt → opens_at/closes_at`, diagnóstico técnico público `diagnosisCode → diagnosis_code`, progreso `evidenceState → evidence_status` y CSV `outcome → audit_events.result`. `startsAt/endsAt` de clase deben sustituirse por `startDate/endDate` si el modelo final conserva fechas sin hora; no convertir silenciosamente una fecha académica en un instante UTC. Cerrar esta elección en DEC-004 antes del schema ejecutable.
