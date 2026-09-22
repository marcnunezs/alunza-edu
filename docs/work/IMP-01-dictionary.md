# Diccionario de identidad y aislamiento — IMP-01

Preparado antes de la migración, 2026-09-11. Implementación técnica: Codex. El usuario confirmó aprovisionamiento mediante un permiso técnico de un uso, un rol por organización, identidad/correo global y estado de membresía local, invitaciones de 72 horas y archivado con excepción del único administrador ejecutor. No representa aceptación académica ni validación remota.

## Modelo y restricciones

- Se conservan `app.profiles`, `app.organization_memberships` y sus UUID/FK. Un perfil identifica la cuenta Auth global; una operación administrativa local modifica solamente su membresía. Una identidad ACTIVE puede no tener membresías.
- `organizations` agrega `revision`, `updated_at`, `archived_by` y `archive_reason`. El administrador ejecutor es la única membresía ACTIVE admitida al archivar; no puede haber invitaciones pendientes ni entregas capaces de activarlas. Conserva su membresía para consulta administrativa, sin escrituras ni lectura pedagógica.
- `provisioning_grants`: UUID, destinatario `user_id`, actor técnico textual, motivo, concesión/vencimiento/revocación y consumo con organización resultante. Una concesión permite una creación; no concede lectura de otras organizaciones. Solo mantenimiento técnico concede o revoca permisos. La herramienta exige un perfil ACTIVE existente, que puede no tener membresías. Creación, primer ADMIN, consumo y auditoría comparten transacción.
- `organization_invitations`: UUID, organización, correo normalizado, rol, emisor, digest SHA-256 nullable hasta primera entrega, generación, vencimiento, aceptación/destinatario, revocación/actor y revisión. Una invitación pendiente por organización/correo. El secreto usable nunca se almacena. El reenvío explícito rota generación y reinicia 72 horas; una aceptada no vuelve a pendiente.
- `invitation_deliveries`: UUID, FK compuesta a invitación/organización, solicitante, tipo INITIAL/RESEND/RENEW, estado QUEUED/RUNNING/SENT/UNCERTAIN/FAILED/CANCELLED, intentos, disponibilidad, lease/token de lease, error seguro, identidad Auth opcional y correlación. Los estados describen integración, no amplían estados de usuario.
- `operation_keys`: organización nullable para aprovisionamiento, actor, operación, clave, hash del payload, estado RUNNING/COMPLETED, lease, recurso y respuesta segura. Unicidad `NULLS NOT DISTINCT` del ámbito/actor/operación/clave. Retención técnica inicial de 24 horas para respuestas: un helper acotado purga únicamente `response_body` vencidos en lotes de 100 con `SKIP LOCKED`; conserva clave, hash, resultado y vínculo al recurso para impedir reejecución. La API rechaza repeticiones vencidas y el consumidor ejecuta la limpieza cada minuto.
- `audit_events`: UUID, organización, actor/actor_kind, hora de servidor, acción, entidad, resultado, correlación y cambios seguros. Append-only; ninguna mutación o eliminación por roles del producto.

Todos los instantes son `timestamptz`; las claves institucionales preservan FK con `ON DELETE RESTRICT`. Los cambios de ámbito/identidad son inmutables. Las transiciones de miembro que puedan retirar la última administración activa serializan por la fila de organización.

## Fronteras y permisos

`alunza_app` continúa LOGIN sin BYPASSRLS, sin propiedad y sin membresías de otros roles. Los grants de escritura se limitan a tablas/columnas necesarias; no recibe DELETE/TRUNCATE ni acceso directo a Auth. Cada solicitud usa `app.actor_id`, `app.session_id`, `app.organization_id` locales a una transacción.

Los helpers en `app_private` son propiedad de `alunza_identity`, NOLOGIN y sin privilegios elevados. Sus grants y políticas explícitos permiten verificar datos mínimos sin RLS recursiva. No es propietario de tablas. Las funciones tienen `search_path` fijo y no son ejecutables por PUBLIC/anon/authenticated/service_role. La sesión comprueba `auth.sessions(id,user_id)`; el correo de aceptación procede del usuario Auth actual confirmado.

La propiedad de `auth` pertenece al rol gestionado `supabase_admin`; el rol ordinario de migración local no puede delegar esos permisos. Tras migrar, el bootstrap local aplica como propietario exclusivamente `USAGE` en `auth`, `SELECT(id,user_id)` en `auth.sessions` y `SELECT(id,email,email_confirmed_at)` en `auth.users` a `alunza_identity`. Auth tiene RLS habilitada: las políticas SELECT del helper restringen `users.id` al `app.actor_id` y `sessions.(id,user_id)` al par `app.session_id,app.actor_id`. No delega lectura de contraseñas ni concede membresías de roles al helper o al runtime. pgTAP verifica permisos y una sesión real antes de ejercer el dominio. Un despliegue remoto deberá acordar y verificar estos mismos grants y políticas mínimos con el propietario de Auth; esta implementación no declara ese acceso remoto validado.

El consumidor durable adquiere una entrega mediante un helper interno; después utiliza actor, organización, ID y token de lease de esa entrega en contexto transaccional. El trabajo no deriva privilegios del navegador ni conserva JWT. Las políticas revalidan membresía ADMIN vigente, organización activa y lease. La aceptación se autoriza exclusivamente por sesión vigente, destinatario y digest/generación actuales; no exige una membresía ACTIVE previa.

`invited_by` preserva al emisor original. La autorización vigente corresponde al `requested_by` de la última entrega: un reenvío por otro ADMIN vigente autoriza su nueva generación, mientras que la renovación conserva ese mismo autorizante. El servidor asigna `created_at` de las entregas después de bloquear la organización y garantiza un orden estrictamente creciente dentro de cada invitación. Una invitación sin entrega o cuyo último autorizante perdió su acceso no se puede aceptar ni renovar.

Un permiso de aprovisionamiento solo sirve antes de consumirse y nunca habilita SELECT sobre organizaciones. La primera lectura de la organización creada se autoriza mediante su nueva membresía ADMIN. RLS también impide que una invitación reactive un perfil global DISABLED; únicamente puede crear el perfil ausente o promover el estado previo INVITED.

La inserción de auditoría requiere pertenencia del actor a la organización del contexto. Se admite esa pertenencia tras deshabilitarla o degradar su rol dentro de la misma transacción para conservar la evidencia de la operación, pero elegir un contexto ajeno no autoriza fabricar eventos.

## Correo y fallos

Supabase Auth envía Invite para cuentas nuevas/no confirmadas y Magic Link para cuentas confirmadas existentes. Las plantillas llevan TokenHash y credencial institucional en el fragmento del callback; `verifyOtp` funciona en otro navegador. Mailpit captura correo local. Los reintentos de entrega generan nuevo secreto y guardan solo digest; un timeout se muestra UNCERTAIN. Una aceptación repetida no duplica membresía ni reactiva una posteriormente deshabilitada.

## Comprobación local

El 2026-09-11 se ejecutaron los cuatro archivos pgTAP contra Supabase TEST local existente: 65 pruebas aprobadas, con rol runtime para las regresiones de RLS, auditoría e idempotencia. El harness concede temporalmente al ejecutor permiso para asumir `alunza_app` y acceso a funciones de pgTAP, dentro de la transacción que se revierte; no cambia privilegios persistentes del producto. La herramienta técnica tiene 21 pruebas unitarias aprobadas sin abrir BD. El registro integral de la fase consolida la migración incremental desde IMP-00, las pruebas API, las carreras reales, la reconciliación y E2E; estos resultados no acreditan aceptación académica ni despliegue remoto.
