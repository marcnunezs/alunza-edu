# IMP-06.05 — Diccionario de auditoría consultable

## Contrato público (DEC-004)

`GET /api/v1/organizations/{orgId}/audit-events`, bearer JWT, `Cache-Control: no-store`. Query estricta: `from`, `asOf`, `actorId`, `action`, `entityType`, `entityId`, `limit`, `cursor`.

- Fechas ISO con offset explícito y hasta seis decimales, normalizadas UTC sin perder microsegundos. Intervalo inclusivo `from ≤ occurredAt ≤ asOf`; corte no futuro, predeterminado del servidor. Inicio ausente no limita historia.
- Actor y entidad son UUID; acción/tipo son textos exactos de 1–100 caracteres, sin normalización de mayúsculas ni catálogo cerrado. Identificadores ajenos/desconocidos usados como filtros no consultan un directorio global: producen cero coincidencias dentro de la organización autorizada.
- Límite 20 predeterminado, 1–100; cursor opaco base64url máximo 4096 caracteres. Un cursor requiere reenviar `asOf`.
- Orden `occurred_at DESC,id ASC`; cursor versionado vinculado a actor solicitante, organización, filtros normalizados, corte y orden. Su digest no es una credencial: cada entrada reautoriza y valida el ancla en el conjunto filtrado.
- Sobre `{data:{organizationId,asOf,items,page:{nextCursor,hasMore,totalFiltered}},requestId}`. Conteo antes del cursor, página y conteo en la misma sentencia. No hay snapshot entre solicitudes. Un commit tardío puede cambiar el conteo y aparecer tras el cursor; si queda antes, Actualizar permite recuperarlo.

| Campo público  | Origen                             | Nulabilidad |
| -------------- | ---------------------------------- | ----------- |
| eventId        | id                                 | No          |
| occurredAt     | occurred_at, UTC con microsegundos | No          |
| actorId        | actor_id                           | Sí          |
| action         | action                             | No          |
| entityType     | entity_type                        | No          |
| entityId       | entity_id                          | Sí          |
| organizationId | organization_id                    | No          |
| outcome        | result, texto 1–80                 | No          |

Actor nulo se presenta como «Sin actor identificado». No se infiere SYSTEM/TECHNICAL. No se proyecta `actor_kind`, `safe_changes`, correlación ni `request_id` histórico. `requestId` del sobre es la correlación de esta respuesta.

## Persistencia y permisos (DEC-006)

Migración `20261102233927_audit_read.sql`; entrada `app_private.audit_events_list(uuid,jsonb)`, propietario NOLOGIN `alunza_identity`, `search_path=pg_catalog`, permiso EXECUTE de entrada únicamente para `alunza_app` y propietario. Helpers privados sin grant runtime. Conserva índice `(organization_id,occurred_at DESC,id)` y políticas existentes. No cambia eventos originales ni datos pedagógicos.

La consulta usa `DatabaseService.readAs`. `academic_role(org,['ADMIN'],true)` exige sesión/perfil/membresía actuales y permite organización archivada. No hay permiso docente implícito. RLS y ámbito anteceden filas, conteos y cursor. Readiness requiere la nueva función.

Errores: 401 sesión inválida; 403 perfil inactivo según frontera existente; 404 recurso inexistente/no autorizado; 422 filtros, fechas o cursor inválidos; 503 persistencia no disponible. Vacío es 200 con lista vacía y conteo cero, no un reemplazo del error.

## Registro operativo y UX

El registro HTTP permanente añade `event:audit.query` y `outcome:SUCCEEDED|DENIED|INVALID|FAILED` para GET del visor y su HEAD implícito, incluyendo variantes de mayúsculas admitidas por Express. Incluye instante, requestId, status y duración existentes; actor únicamente de JWT verificado; organización solo tras lectura autorizada y proyección validada. Excluye query, cursor, filtros, secretos y contenido. Se emite una vez al terminar la respuesta; no se afirma recepción humana ni durabilidad DB. Captura/retención centralizada siguen sin verificar.

Formulario con aplicación explícita; fechas en zona institucional; cambio de filtro reinicia navegación, primera página conserva corte y Actualizar obtiene otro. Respuestas obsoletas se descartan; cambio de sesión o pérdida de permiso retira datos. Estados de carga, vacío, validación, acceso y servicio diferenciados. CSV no forma parte de este contrato.
