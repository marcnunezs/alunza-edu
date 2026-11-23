# IMP-05.03 — Diccionario de versiones y activación de reglas

**Ampliación IMP-05.06, 25/10/2026:** la administración web añade la lectura
de parámetros efectivos y recuperación de operaciones descritas al final.
El [registro .06](IMP-05-rules-ui.md) documenta su cierre técnico local,
registrado el 26/10/2026 con CI 17/17 aprobada;
el estado histórico de .03 que sigue se conserva, con su CI conjunta cerrada
posteriormente en [IMP-05.05](IMP-05-episodes.md).

Contrato incremental del 05/10/2026. Estado al 06/10/2026:
**IMPLEMENTADO Y PROBADO EN FOCOS LOCALES**, con CI17 pendiente al congelar
FINAL; la evidencia se registra en [IMP-05-rules](IMP-05-rules.md). Complementa
[eventos y progreso](IMP-05-progress-dictionary.md), [modelo](../../specs/06-modelo-de-datos.md)
y [API](../../specs/07-api-y-contratos.md). DEC-005 D1–D5 tiene
[aprobación de producto trazable](DEC-005-2026-10-05.md). Este corte concreta
únicamente versiones, validación, consultas administrativas y activación;
evaluadores .04, episodios .05, UI .06, tablero y revisión docente siguen pendientes.

## Semántica y representación

Los tipos exactos son `INACTIVITY`, `REPEATED_ERROR`, `STAGNATION`.
`schemaVersion=1` y `algorithmVersion=DEC005_V1` identifican el contrato aprobado,
sin scripts, fórmulas o semánticas arbitrarias suministradas por cliente.

| Tipo           | Parámetros estrictos                              | Línea base                                                     |
| -------------- | ------------------------------------------------- | -------------------------------------------------------------- |
| INACTIVITY     | `{inactivityDays}`                                | 7 días de 24 h                                                 |
| REPEATED_ERROR | `{repeatedErrorAttempts,repeatedErrorWindowDays}` | 3 envíos en [T−14 días,T], extremos incluidos                  |
| STAGNATION     | `{stagnationAttempts}`                            | 3 envíos, conteos no crecientes por pares, sin plazo adicional |

Días: enteros 1–2.147.483.647; conteos: enteros 2–2.147.483.647. El límite int4
coordina PostgreSQL/DTO y expresa representabilidad, sin máximo pedagógico
inventado. Los evaluadores futuros deberán comparar duraciones con enteros de
precisión suficiente, sin multiplicaciones inseguras de Number ni pérdida de
microsegundos. N distinto de 3 usa últimos N confirmados y comparaciones
adyacentes; requiere oráculos propios antes de habilitar evaluación. .03 valida
y almacena configuraciones, sin evaluarlas; conserva la línea base SIG N=3.

Todos los campos de parámetros son obligatorios para su tipo. Rechazar ausentes,
null, extras, booleanos/texto/coerción, fracciones, valores <=0, conteos 1, valores
fuera de int4 y schema/algoritmo desconocido. El cuerpo de creación tampoco
admite author/organizationId/version/state/fechas cliente. El organismo/actor
proviene de ruta y sesión autorizadas.

Crear reserva una versión DRAFT; no instala ni activa una regla por defecto.
Los parámetros/schema/algoritmo son inmutables desde la creación como elección
técnica de este corte: no hay PATCH/DELETE. Cambiar exige otra versión. D5 exige
inmutabilidad al activar; esta representación evita borradores mutables sin
ampliar funciones de producto.

`DRAFT`, `ACTIVE`, `RETIRED` describe ciclo de **versión de regla**. El catálogo
de **señal** conserva exclusivamente `ACTIVE`/`REVIEWED`; no se crean señales en .03.
Una organización sin versión activa de un tipo permanece sin configuración de
ese tipo; no mostrarlo como ausencia de dificultad.

## DTO y proyección pública

Crear usa la unión discriminada estricta:

```json
{
  "type": "REPEATED_ERROR",
  "schemaVersion": 1,
  "algorithmVersion": "DEC005_V1",
  "parameters": {
    "repeatedErrorAttempts": 3,
    "repeatedErrorWindowDays": 14
  }
}
```

Activar usa `{expectedCurrentVersionId: UUID|null}` obligatorio; null significa
que se espera que todavía no exista versión vigente para ese tipo/organización.
No recibe fechas. Las respuestas validan el siguiente objeto seguro:

| Campo público                   | Significado / mapping                                                     |
| ------------------------------- | ------------------------------------------------------------------------- |
| id, organizationId, type        | Identidad de versión, organización autorizada y tipo                      |
| version                         | Entero secuencial por organización/tipo                                   |
| schemaVersion, algorithmVersion | Schema 1 y DEC005_V1, inmutables                                          |
| parameters                      | Solo parámetros estrictos del tipo                                        |
| state                           | DRAFT, ACTIVE o RETIRED, derivado de su vigencia                          |
| createdBy, createdAt            | Actor y fecha UTC del servidor al crear                                   |
| activatedBy                     | Actor activador; null mientras DRAFT                                      |
| validFrom, validTo              | Inicio inclusivo / fin exclusivo; ambos null en DRAFT; fin null en ACTIVE |

Timestamps conservan UTC/microsegundos según el contrato de fechas existente.
No se incluye evidencia individual, código, tests, snapshots de aprendizaje,
payloads de idempotencia ni campos operativos privados.

## API administrativa

NestJS es la única API de dominio, con JWT y permisos ACTIVE vigentes. Rutas
bajo `/api/v1`, respuestas `no-store` y proyección pública validada.

| Método/ruta                              | Entrada                                                              | Resultado                                                        |
| ---------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| GET /organizations/{orgId}/signal-rules  | `type?`, `cursor?` UUID, `limit?` 1–100 (50 por defecto); sin extras | Lista autorizada `{data:[],page:{hasMore,nextCursor},requestId}` |
| POST /organizations/{orgId}/signal-rules | DTO estricto de creación e Idempotency-Key                           | 201 con versión DRAFT confirmada y auditoría                     |
| GET /signal-rules/{id}                   | UUID de versión                                                      | 200 con una versión de la organización autorizada                |
| POST /signal-rules/{id}/activate         | expectedCurrentVersionId e Idempotency-Key                           | 200 con versión activa/resultado durable, o conflicto            |

Solo ADMIN de esa organización con perfil/membresía ACTIVE y sesión vigente.
Las lecturas administrativas conservadas admiten organización ARCHIVED según
DEC-001, sin ampliar permisos pedagógicos. Crear/activar y sus replays de
mutación exigen organización ACTIVE; organización archivada devuelve 409
ORGANIZATION_ARCHIVED. TEACHER/STUDENT no gobiernan reglas. IDs de versiones
ajenas/inexistentes no revelan su ámbito. Este permiso no concede lectura de
tableros/código/intentos. RLS/RPC revalidan ámbito y permisos actuales; no confiar
en user_metadata ni en organizationId del cuerpo.

Idempotency-Key es obligatoria, con formato y límite existentes del producto,
permanente por organización/actor/operación. Replay con los mismos valores
semánticos del payload JSONB (orden de claves y 7 frente a 7.0 son equivalentes) devuelve el
snapshot durable original y conserva ID, fechas y auditoría efectiva única.
Reutilizar la clave con otro payload es conflicto. Las consultas y replays siguen
requiriendo permisos actuales; revocación no permite acceso por tener una clave.

## Activación y concurrencia

Serializar por `(organizationId,type)` bajo lock del scope y comprobar la versión
vigente esperada después de adquirirlo. No bloquear otros tipos/organizaciones
por ese conflicto. A es hora real del servidor al efectuar la activación; en la
misma transacción cerrar la anterior con B=A, abrir la nueva desde A, actualizar
scope, registrar auditoría y conservar resultado de operación. No puede haber
dos intervalos [A,B) solapados ni dos versiones con fin abierto.

Si dos administradores esperan la misma vigente y activan versiones diferentes,
solo uno cambia vigencia; el otro recibe RULE_VERSION_CONFLICT y debe recargar.
Una versión RETIRED no se reactiva. Replay de la clave inicial conserva snapshot
original aunque después exista otra versión activa. Activar con nueva clave la
versión que ya es ACTIVE y expectedCurrentVersionId igual a ella es no-op: conserva
validFrom/activatedBy y no duplica auditoría efectiva. Un expected obsoleto produce
conflicto incluso al apuntar a una versión ya vigente. Nunca confiar solo en un
check previo fuera de la transacción.

La vigencia de parámetros activados es inmutable salvo el cierre autorizado de
validTo y transición a RETIRED en la transacción de reemplazo. Rechazar fecha
cliente, activación retroactiva/futura, sobrescritura de identidad/autor/parámetros
y cambios directos fuera del protocolo. Crear y activar auditan
`RULE_VERSION_CREATED`/`RULE_VERSION_ACTIVATED`, con organización, actor, entidad,
fecha servidor y requestId, sin evidencia pedagógica.

Desde A, .04–.05 usarán la nueva regla en evaluaciones actuales. Un episodio
anterior deja de acumular y conserva hechos/estado. La nueva versión puede abrir
otro ACTIVE vinculado con la misma evidencia todavía vigente, con causa «nueva
versión de regla», sin reactivar REVIEWED. .03 conserva la historia de activación
que permitirá reconstruir ese comportamiento; no calcula ni publica episodios.

## Persistencia incremental y aislamiento

Migración aditiva: `supabase/migrations/20261005233736_signal_rule_versions.sql`.
Conserva hechos y progreso .01–.02; no reconstruye ni reemplaza el MER histórico.

| Entidad                            | Campos / restricciones                                                                                                                                                                                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| app.signal_rule_versions           | Identidad/organización/tipo/version; schema_version/algorithm_version/parameters; created_by/created_at; activated_by/valid_from/valid_to. Unicidad organización/tipo/version y clave compuesta organización/tipo/id; parámetros inmutables desde creación; estados públicos derivados de vigencia |
| app_private.signal_rule_scopes     | PK organización/tipo, next_version bigint 1–2.147.483.648 (último valor indica versiones int4 agotadas), current_version_id; secuencia y exclusión por scope, FK compuesta de versión vigente                                                                                                      |
| app_private.signal_rule_operations | PK organización/actor/operación/clave; request_payload JSONB comparado por valores semánticos, response_body snapshot y created_at; idempotencia durable privada, no lectura de cliente                                                                                                            |

RLS forzada y SELECT administrativo por organización en la entidad pública;
los clientes no escriben directamente. `alunza_app` usa funciones autorizadas
de `app_private`; `alunza_identity` es rol interno sin login para cambios acotados.
PK/FK compuestas, guardas de inmutabilidad, una vigencia abierta por scope y
exclusión GiST de rangos con btree_gist sostienen aislamiento e historia, también
en intervalos históricos. Locks compartidos de organización/perfil conservan
autorización actual; los cambios de membresía ya toman lock exclusivo de esa
organización por la guarda existente. No se añade lock de fila de membresía
que invertiría ese orden. Revalidar sesión/permisos después de esperar operación
y scope. Las relaciones privadas no conceden permisos pedagógicos.

El privilegio auxiliar nuevo `UPDATE(id)` sobre app.profiles pertenece solo a
alunza_identity (rol sin login, sin membresía para el runtime) porque PostgreSQL
requiere permiso UPDATE de al menos una columna para FOR SHARE. Estas RPC no
actualizan perfiles; alunza_app/anon/authenticated/service_role no reciben ese
UPDATE. La política de UPDATE de perfiles permite el lock. INSERT en audit_events
para alunza_identity ya existía desde materiales; la política agregada admite
únicamente RULE_VERSION_CREATED/RULE_VERSION_ACTIVATED con actor/ámbito/entidad
autorizados. Son una ACL de columna y dos políticas nuevas sobre tablas previas.
El suplemento real verifica exactamente esas adiciones y preserva los demás
propietarios/RLS/ACL/políticas previos; no se afirma que todas las ACL quedaron
sin cambios. Ver [evidencia del corte](IMP-05-rules.md).

| Función app_private      | Firma / finalidad                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| signal_rule_organization | `(rule UUID)`; resuelve ámbito solo para ADMIN/sesión autorizados, sin lectura pedagógica                              |
| get_rule_version         | `(org UUID,rule UUID)`; proyección segura de una versión                                                               |
| list_rule_versions       | `(org UUID,kind TEXT,cursor UUID,page_limit INTEGER)`; orden created_at/id ascendente y cursor del mismo ámbito/filtro |
| create_rule_version      | `(org UUID,input JSONB,operation_key TEXT)`; versión/secuencia/auditoría/snapshot atómicos                             |
| activate_rule_version    | `(org UUID,rule UUID,expected_current UUID,operation_key TEXT)`; CAS/intervalos/auditoría/snapshot atómicos            |

Los timestamps públicos se formatean explícitamente en UTC con seis decimales
y Z, sin depender de timezone de sesión. Agotar version int4 rechaza creación;
una hora de activación no mayor que el inicio anterior o anterior a createdAt
rechaza con REQUEST_IN_PROGRESS, sin fabricar microsegundos ni intervalo vacío.

## Errores y verificación exigible

| Situación                                                                                                    | Resultado seguro                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DTO/filtro extra, parámetros inválidos, schema/algoritmo desconocido, cursor inválido o fechas en activación | 422 / VALIDATION_FAILED con campo parameters, cursor o campo validado según el caso; RULE_PARAMETERS_INVALID/RULE_CURSOR_INVALID son códigos SQL internos |
| Idempotency-Key inválida/ausente                                                                             | 400                                                                                                                                                       |
| Rol distinto de ADMIN                                                                                        | 403 al listar/crear en una organización accesible; 404 en detalle/activación para ocultar existencia                                                      |
| Sesión, estado o permiso no vigente                                                                          | Rechazo según la autorización vigente; no habilita acceso por conservar una clave de replay                                                               |
| Crear/activar o replay de mutación con organización archivada                                                | 409 / ORGANIZATION_ARCHIVED; lectura administrativa autorizada se conserva                                                                                |
| Organización/versión ajena o versión inexistente                                                             | Rechazo seguro sin revelar existencia; 404 para versión                                                                                                   |
| Vigente esperada obsoleta o mismo key con otro payload                                                       | 409; RULE_VERSION_CONFLICT para carrera de activación                                                                                                     |
| Reutilización de versión RETIRED                                                                             | 409 / RULE_VERSION_ALREADY_ACTIVATED                                                                                                                      |
| Error de persistencia                                                                                        | Falla de servicio; no devolver regla ficticia ni configuración vacía como éxito                                                                           |

ALZ-HU-026-E1–E4 requieren creación/activación, rechazo de sobrescritura/fechas,
roles/ámbitos/estados y parámetros inválidos. .03 agrega oráculos independientes
de límites int4, replays, auditoría, concurrencia de mismo scope, aislamiento
entre tipos/organizaciones e historial. E1 sobre nuevas señales, SIG-01–SIG-14,
reconstrucción y revisión pertenecen a los incrementos posteriores; no se dan
por ejecutados aquí. [Registro](IMP-05-rules.md) conserva solo comandos y
resultados reales recibidos del verificador del candidato.

## Ampliación de consulta y UI — IMP-05.06

`GET /api/v1/organizations/{orgId}/signal-rules/effective` no admite parámetros
de consulta. Devuelve `{data:{organizationId,observedAt,rules},requestId}`;
`rules` contiene exactamente `INACTIVITY`, `REPEATED_ERROR` y `STAGNATION`,
una vez cada uno, con `{type,ruleVersion}`. La versión es la proyección pública
ACTIVE del mismo tipo/organización o null si no hay configuración activa.
No aplica defaults ni interpreta error de servicio como ausencia de regla.

La migración aditiva `20261026005905_signal_rule_effective.sql` incorpora solo
`app_private.effective_signal_rules(uuid)`, función STABLE con snapshot de
sentencia, propietario limitado `alunza_identity`, search_path fijo y EXECUTE
para el runtime autorizado. Revalida sesión, ADMIN vigente y ámbito, mantiene
lectura administrativa de ARCHIVED y no concede RPC a clientes ni service_role.
No modifica tablas, parámetros, vigencias, episodios, revisiones o algoritmos.
`observedAt` conserva UTC/microsegundos y corresponde a la observación de la
consulta, no al corte ni finalización del trabajador.

La ruta web `/administracion/organizaciones/{orgId}/reglas` presenta efectivas,
historial paginado, autores/fechas, detalle, creación y activación. La activa
se consulta independientemente de las páginas del historial. Tras un replay
se vuelve a consultar la vigencia real: la respuesta durable original puede
describir una versión ACTIVE que hoy está RETIRED. El historial de versiones
no equivale al visor general de auditoría/CSV de RF-027.

Antes de enviar una mutación, la web conserva en sessionStorage un registro
estricto de formato 1, cuenta, organización, operación, clave UUID y payload;
la activación incluye versionId. No almacena credenciales ni rutas libres.
El contenido local se revalida y el endpoint se deriva de sus identificadores.
Para activar se comprueba además el ámbito mediante detalle autorizado.
La recuperación es manual, con la misma clave/payload, y exige permisos actuales;
una renovación de sesión o recarga no autoriza crear otra operación equivalente.
Un conflicto CAS conocido permite preparar una nueva confirmación deliberada.
Fallos de autenticación no descartan una mutación cuyo commit sigue incierto.

Las pruebas/mediciones y los límites de este contrato se registran en
[IMP-05.06](IMP-05-rules-ui.md). Ninguna pantalla administrativa recibe evidencia
pedagógica individual para demostrar la conexión con el motor.
