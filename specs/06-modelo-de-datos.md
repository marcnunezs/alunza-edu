# 06 · Modelo de datos

**Ampliación IMP-06.05:** `20261102233927_audit_read.sql` añade lectura administrativa sobre `app.audit_events`, sin tablas nuevas ni backfill. Conserva eventos, RLS e índice organización/fecha/ID. La entrada `audit_events_list` reautoriza ADMIN, proyecta ocho columnas y calcula conteo/página en una sentencia; los cursores no congelan commits entre solicitudes. Helpers privados y permisos explícitos en el [diccionario .05](../docs/work/IMP-06-audit-read-dictionary.md); resultados y límites en el [registro](../docs/work/IMP-06-audit-read.md).

**Ampliación IMP-06.04:** la migración aditiva de revisión pública reutiliza
episodios, signal_reviews, snapshots, clocks, proyecciones y audit_events. La
entrada autorizada conserva actor/sesión, captura al presente sin reutilizar
continuación del worker y confirma una revisión/auditoría efectiva única. El
helper TEST y las tablas privadas no reciben acceso directo de aplicación.
El [diccionario .04](../docs/work/IMP-06-signal-review-dictionary.md) concreta
DEC-004/006; [el registro](../docs/work/IMP-06-signal-review.md) distingue pruebas
y límites. No se reescriben hechos ni se hace backfill de nombres/historia.

**Corte histórico del cierre técnico local IMP-06.03:** la migración
[de detalle docente](../supabase/migrations/20261027182430_student_detail.sql)
añade proyecciones autorizadas de solo lectura sobre hechos existentes, sin
tablas nuevas ni backfill. El [diccionario .03](../docs/work/IMP-06-student-detail-dictionary.md)
define matrícula actual, ayuda entregada, corte y permisos; el
[registro .03](../docs/work/IMP-06-student-detail.md) conserva las pruebas,
las incidencias y la CI local aprobada del candidato. La CI Linux, la aceptación
humana/remota y los incrementos IMP-06.04–.07 permanecen pendientes.

**Ampliación IMP-06.02, 27/10/2026:** el gobierno del banco conserva las
entidades existentes y añade validación del nuevo propietario más permisos
INSERT de versiones/conceptos/tests para ADMIN. La migración es aditiva y no
reescribe versiones, usos ni intentos. El [diccionario .02](../docs/work/IMP-06-bank-governance-dictionary.md)
detalla políticas, trigger, restricciones y actualización; el [registro](../docs/work/IMP-06-bank-governance.md)
enlaza las pruebas locales de persistencia y la actualización .01→.02, que
conservó también auditoría previa creada mediante una operación HTTP real.
La aceptación integrada de fase y humana permanece pendiente.

**Base hasta IMP-05.08:** modelo concretado por migraciones y diccionarios incrementales de identidad, contenido académico, RUN/SUBMIT, materiales/ayuda, ledger de evaluación, progreso, reglas, episodios y lecturas docentes. El [estado actual](../docs/estado-actual.md) concentra qué está implementado, probado y pendiente; el [cierre local IMP-05.08](../docs/work/IMP-05-acceptance.md) conserva su evidencia. La preparación TEST de IMP-04.08 no acredita evaluación Azure, calidad pedagógica ni aceptación CAPSTONE. En ese corte RF-017 integral y la acción pública RF-019 permanecían pendientes; .03 incorpora después la consulta integral descrita en §4.5.1.

IMP-06.01 añade [proyecciones administrativas del banco](../docs/work/IMP-06-bank-read.md)
mediante la migración `20261027020051_exercise_bank_read.sql`, sobre estas
entidades y claves existentes. Son lecturas de metadatos autorizadas por
organización; no agregan tablas de dominio ni amplían las políticas generales
de lectura pedagógica. Su actualización y conservación de datos están
verificadas localmente. Las mutaciones administrativas de IMP-06.02 completan
esa capacidad según el diccionario y registro enlazados arriba. .03 añade las
proyecciones docentes y .04 la revisión pública, implementada con focos locales
aprobados y cierre integral pendiente según su registro, sin modificar el gobierno
del banco. IMP-06.05–.07 conservan su alcance pendiente.

**Documentado** identifica una obligación de las fuentes. **Propuesta** identifica un diseño aún no concretado o conservado como antecedente. **Contrato ejecutable** identifica su materialización en migraciones y diccionarios enlazados. **Pendiente** identifica una decisión o capacidad no cerrada. Las tablas lógicas no son un inventario literal del esquema: cuando difieren, prevalece la concreción incremental explícita, sin cambiar la obligación de producto.

**Corte histórico 05/10/2026:** la aprobación de DEC-005 D1–D5 fijó la semántica de señales.
IMP-05.03 concretaba versiones/activación en §4.5 y estaba implementado/probado
en focos locales al 06/10/2026; CI17 estaba pendiente al congelar FINAL;
estado/pruebas en [registro .03](../docs/work/IMP-05-rules.md). Progreso/eventos
.01–.02 conservan su resolución y evidencia propia. Datos de evaluadores y
episodios .04–.05 eran futuros en ese corte. Su materialización posterior y las
lecturas .07–.08 se describen en §4.5; no se mantienen como pendientes actuales.

## 1. Fuentes, alcance y precedencia

Fuentes principales:

- [ERS, §§2.1, 2.4, 3.1.5, 3.2 y 3.3](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/Informe_ERS_Alunza.docx>).
- [Casos de uso extendidos, reglas del MVP y ALZ-CU-001 a ALZ-CU-027](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/Documento_Casos_de_Uso_Extendidos_Alunza.docx>).
- [MER histórico, imagen](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/MER/MERALUNZA.png>) y [descriptor del diseño](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/MER/MER_ALUNZA.dmd>).

**Documentado:** el almacenamiento vigente es Supabase PostgreSQL, con objetivo de compatibilidad PostgreSQL 17, Auth, Storage, RLS y pgvector. NestJS conserva las reglas de negocio y la autorización. El modelo debe soportar organizaciones, cursos, clases, ejercicios, actividades, intentos, progreso, fuentes, reglas, señales y auditoría. El MVP se limita a Programación I con JavaScript.

**Propuesta:** `organization` es el nombre técnico del colegio o institución cliente; `course` describe el curso curricular; `class` identifica el grupo de alumnos y profesores de una organización. Una actividad pertenece a una clase y contiene ejercicios versionados. No confundir curso con clase ni ejercicio con actividad.

Este documento se complementa con [arquitectura](05-arquitectura.md), [API](07-api-y-contratos.md), [IA/RAG](08-ia-y-procesamiento.md), [seguridad](09-seguridad-y-privacidad.md), [ejecución controlada](13-ejecucion-controlada.md) y [progreso y señales](14-progreso-y-senales.md). Las decisiones abiertas se registran en [fuentes y decisiones](00-fuentes-y-decisiones.md).

## 2. Tratamiento del MER existente

La imagen fue inspeccionada visualmente. Contiene `ROL`, `USUARIO`, `INSCRIPCION`, `CURSO`, `UNIDAD`, `CONTENIDO`, `ACTIVIDAD`, `PREGUNTA`, `OPCION_RESPUESTA`, `INTENTO`, `RESPUESTA`, `DESEMPENO`, `INTERACCION_IA` y `RECOMENDACION`. Usa tipos Oracle como `NUMBER`, `VARCHAR2` y `TIMESTAMP WITH LOCAL TIME ZONE`. El `.dmd` disponible es un descriptor de diseño Oracle Data Modeler, sin el diccionario completo de tablas en su contenido visible.

| Elemento del MER | Tratamiento propuesto para la línea base actual |
| --- | --- |
| `USUARIO` con un `ROL` | Identidad administrada por Supabase Auth, perfil y membresías con rol y alcance explícito. |
| `INSCRIPCION` en `CURSO` | Inscripción en `class_memberships`; fecha de inscripción sigue siendo evidencia, pero deja de ser clave primaria. |
| `CURSO → UNIDAD → ACTIVIDAD` | `courses → classes → activities`. No convertir unidades automáticamente en clases: son conceptos distintos y requieren mapeo si llegan a existir datos. |
| `PREGUNTA`, `OPCION_RESPUESTA`, `RESPUESTA` | No son entidades obligatorias del MVP de programación. Se sustituyen funcionalmente por ejercicios JavaScript, pruebas y resultados técnicos; no se añade un módulo de cuestionarios. |
| `INTENTO` con puntaje/porcentaje | Historial inmutable de código, versión, eventos y resultado determinista. No trasladar puntajes como calificación ni puntaje de IA. |
| `DESEMPENO` | Proyección explicable de ejercicios completados/requeridos, reconstruible desde evidencias. |
| `CONTENIDO`, `INTERACCION_IA`, `RECOMENDACION` | Fuentes versionadas, fragmentos, solicitudes de feedback, referencias y señales deterministas separadas. |
| Organización, clase, versión, fuente, regla, señal y auditoría | Faltan o no están resueltas en el MER histórico; son necesarias según la ERS vigente. |

**Documentado:** AD-ARQ-001 fija el stack vigente. El MER se conserva como antecedente, no como DDL para producción. La revisión previa a la primera migración era un hito de DEC-006; los diccionarios incrementales registran sus concreciones autorizadas y pruebas locales. Esto no acredita aprobación académica del modelo. No se modifican ni eliminan los archivos originales.

## 3. Convenciones e invariantes generales

### 3.1 Tipos y nombres

| Convención propuesta | Regla |
| --- | --- |
| Identificadores | `uuid` generado por el servidor; `profiles.id` coincide con `auth.users.id`. No usar correo, fecha o código de incorporación como clave primaria. |
| Nombres | Tablas y columnas en `snake_case`; contratos HTTP en `camelCase`, salvo nombres exactos del contrato RAG documentado. |
| Tiempo | `timestamptz` en UTC; `date` para fechas académicas sin hora. La presentación aplica la zona configurada sin cambiar el orden de eventos. |
| Campos comunes | `id`, `organization_id` en datos institucionales y `created_at`; `updated_at` y `revision` solo en registros editables; `created_by` cuando existe autor humano. |
| Archivo lógico | `archived_at` y `archived_by` en organizaciones y catálogos archivables. No implica borrado de evidencia. |
| Cantidades | Enteros no negativos para bytes, tokens, duraciones, contadores y orden. No almacenar porcentajes como única evidencia de progreso. |
| Texto | `text` con límites validados por contrato; no asumir que `text` permite entradas ilimitadas. Los límites sin fuente se configuran y documentan antes de aceptación. |
| JSON | `jsonb` para parámetros versionados, evidencia y métricas con esquema; no para sustituir claves foráneas o permisos consultables. |

En los diccionarios, `?` indica nulabilidad. Las referencias y campos de alcance son obligatorios salvo indicación contraria. Las tablas puente usan las claves indicadas en lugar de un `id` artificial cuando este no aporta identidad de dominio.

### 3.2 Integridad por organización y clase

1. Todo registro de una organización conserva su `organization_id`, incluso cuando puede inferirse mediante otra relación.
2. Las referencias entre entidades institucionales usan claves compuestas `(organization_id, id)` y claves foráneas equivalentes. Un UUID válido de otra organización no debe poder insertarse como referencia.
3. Las entidades de clase conservan `class_id`; las referencias relevantes verifican también `(organization_id, class_id, id)`. Actividad, intento, fuente y señal deben pertenecer a la misma clase declarada.
4. No se aceptan `organization_id`, `student_id`, `created_by`, rol o estado privilegiado enviados por el navegador como prueba de autorización. El servidor deriva el actor y verifica el ámbito.
5. Los índices únicos de negocio se limitan al ámbito institucional. Las claves de identidad externas de Auth se tratan separadamente.
6. Las eliminaciones de catálogos referenciados usan `RESTRICT` o archivado. No propagar un borrado de organización a intentos, fuentes citadas o auditoría mediante cascada.
7. La autorización se vuelve a evaluar al consultar evidencia histórica. Haber tenido acceso en el pasado no concede acceso actual.

## 4. Modelo lógico y contratos ejecutables

Las secciones conservan el diseño lógico y los cortes históricos. Para el
esquema físico vigente, consultar las [migraciones](../supabase/migrations)
y los diccionarios de cada incremento; no crear tablas paralelas a partir
de un nombre propuesto que ya tenga otra materialización.

### 4.1 Identidad, gobierno y estructura académica

| Entidad | Campos específicos | Relaciones y restricciones |
| --- | --- | --- |
| `organizations` | `code`, `name`, `timezone`, `revision`, `archived_at?`, `archived_by?`, `archive_reason?` | Código normalizado único. Creación con permiso técnico de un uso. Archivo conserva al único ADMIN activo para lectura; bloqueado por otros miembros activos, invitaciones y trabajos pendientes. |
| `profiles` | `id`, `display_name`, `email_normalized`, `account_state`, `created_at`, `updated_at` | `id → auth.users`. Estado exacto `INVITED`, `ACTIVE` o `DISABLED`. Sin contraseña, hash de contraseña ni tokens en esta tabla. Propuesta MVP: una identidad por correo normalizado; una identidad existente puede referenciarse mediante una membresía autorizada. |
| `organization_memberships` | `organization_id`, `user_id`, `role`, `state`, `joined_at?`, `disabled_at?`, `revision` | Único `(organization_id, user_id)`. `role`: `ADMIN`, `TEACHER`, `STUDENT` como nombres técnicos propuestos. `state`: `INVITED`, `ACTIVE`, `DISABLED`. Perfil y membresía deben estar activos. |
| `organization_invitations` | `organization_id`, `email_normalized`, `role`, `token_digest?`, `generation`, `revision`, `expires_at`, `accepted_at?`, `accepted_by?`, `revoked_at?`, `invited_by` | Secreto utilizable solo en memoria/correo, digest en BD. Vigencia de 72 horas; reenvío reinicia plazo e invalida generación anterior. Aceptar verifica sesión, destinatario y organización; repetición no reactiva membresías deshabilitadas. |
| `provisioning_grants` | `user_id`, `granted_by`, `reason`, `granted_at`, `expires_at`, `revoked_at?`, `revoked_by?`, `revocation_reason?`, `consumed_at?`, `consumed_organization_id?` | Permiso técnico revocable y consumible una vez. El producto no lo concede. Consumo, organización, primer ADMIN y auditoría en una transacción. |
| `invitation_deliveries` | `organization_id`, `invitation_id`, `requested_by`, `kind`, `state`, `attempt_count`, `available_at`, `lease_until?`, `lease_token?`, `auth_user_id?`, `last_error_code?`, `correlation_id` | Entrega durable con lease; máximo tres intentos automáticos. El ADMIN del último trabajo reautoriza cada generación sin cambiar el emisor histórico. Resultado incierto se reconcilia y rota secreto antes de repetir. |
| `courses` | `code`, `name`, `description?`, `academic_period`, `start_date?`, `end_date?`, `archived_at?` | Código único por organización; período documentado en CU-022 con formato técnico por fijar; fin no anterior al inicio si ambas fechas existen. |
| `classes` | `course_id`, `code`, `name`, `description?`, `start_date?`, `end_date?`, `archived_at?` | Curso de la misma organización. Código único por organización. Las fechas deben ser coherentes con el curso según regla académica validada. |
| `class_memberships` | `organization_id`, `class_id`, `user_id`, `class_role`, `enrolled_at`, `ended_at?` | Único `(organization_id, class_id, user_id)`. Rol de clase propuesto `TEACHER` o `STUDENT`, compatible con la membresía institucional activa. `enrolled_at` se conserva para las reglas de inactividad. |
| `class_join_codes` | `class_id`, `token_digest`, `expires_at`, `revoked_at?`, `max_uses?`, `uses_count`, `created_by` | Código no reversible, revocable y expirable. Incremento de usos e inscripción en una transacción. `max_uses` es configuración propuesta; no constituye un límite documentado. |
| `class_invitations` | `class_id`, `email_normalized`, `token_digest`, `expires_at`, `accepted_at?`, `revoked_at?` | Alternativa de invitación individual. Destinatario y clase verificados; aceptación idempotente. |

**Documentado:** ALZ-RF-001/003/020/021/022 exigen estados, unicidad, aislamiento, inscripción sin duplicados y protección del último administrador. CU-021 precisa que el correo no se duplica dentro de una organización.

**Decisión IMP-01 / DEC-001:** la cuenta Auth y el correo normalizado son globales. Cada membresía tiene exactamente un rol y su propio estado. Los administradores consultan solo la proyección de miembros de su organización; no buscan cuentas globales ni deducen otras pertenencias. Deshabilitar una membresía no modifica Auth ni otras organizaciones. Una cuenta ACTIVE sin membresías puede consultar su situación y consumir únicamente permisos explícitos. IMP-02 concretó después las entidades académicas y de contenido de §4.1–4.2 en su [diccionario ejecutable](../docs/work/IMP-02-dictionary.md).

### 4.2 Taxonomía, banco y actividades

| Entidad | Campos específicos | Relaciones y restricciones |
| --- | --- | --- |
| `concept_tags` | `normalized_name`, `current_version_id`, `archived_at?` | Nombre normalizado único por organización. La identidad permanece aunque cambie su descripción. |
| `concept_versions` | `concept_id`, `version`, `name`, `description?`, `parent_concept_id?`, `created_by` | Único `(organization_id, concept_id, version)`. Inmutable. El grafo vigente no admite autorreferencia ni ciclos. |
| `exercises` | `owner_id`, `current_version_id?`, `visibility`, `archived_at?` | Propietario autorizado de la organización. Valores propuestos de visibilidad: `PRIVATE`, `ORGANIZATION`; ningún valor concede acceso a otra organización ni acceso estudiantil a pruebas ocultas. |
| `exercise_versions` | `exercise_id`, `version`, `title`, `statement`, `starter_code`, `entrypoint`, `language`, `difficulty`, `execution_limits`, `published_at?`, `content_hash` | `language = javascript` en MVP. Versión única por ejercicio. Toda versión publicada o referenciada por una actividad publicada es inmutable. Dificultad y límites cumplen los contratos aprobados. |
| `exercise_version_concepts` | `organization_id`, `exercise_version_id`, `concept_id`, `concept_version_id` | Sin etiquetas duplicadas. Fija la versión conceptual utilizada; la relación entre concepto y versión se valida. |
| `exercise_tests` | `exercise_version_id`, `position`, `visibility`, `required`, `test_definition`, `expected_result?`, `definition_hash` | Pruebas deterministas versionadas. Visibilidad propuesta `VISIBLE` o `HIDDEN`. Definición y expectativas ocultas viven en un esquema privado, fuera de la proyección estudiantil. |
| `activities` | `class_id`, `title`, `description?`, `type`, `state`, `opens_at?`, `closes_at?`, `published_at?`, `closed_at?`, `revision` | Tipo técnico propuesto `DIAGNOSTIC` o `FORMATIVE`; corresponde a actividad diagnóstica o formativa documentada en CU-005. Estados documentados exactos `DRAFT`, `PUBLISHED`, `CLOSED`. Fechas planificadas coherentes: `opens_at <= closes_at` cuando ambas existen. Solo `PUBLISHED` y dentro del período habilitado admite nuevos envíos. El tratamiento del historial cerrado se explicita en DEC-002. |
| `activity_exercises` | `organization_id`, `class_id`, `activity_id`, `exercise_id`, `exercise_version_id`, `position`, `required` | Posición única por actividad, un ejercicio por actividad en la propuesta MVP. La versión se fija al publicar; no se resuelve dinámicamente a «la última». |

**Documentado:** ALZ-RF-004/005/023/024 y CU-023/024 exigen pruebas, conceptos, versiones, preservación histórica y ausencia de ciclos en taxonomía.

**Documentado, CU-005:** la actividad tiene tipo diagnóstico o formativo y fechas que deben validarse. **Propuesta:** `opens_at`/`closes_at` son fechas planificadas en UTC; `published_at`/`closed_at` registran transiciones efectivas. No intercambiarlas ni asumir que publicar anticipadamente habilita envíos antes de la apertura. La nulabilidad, tratamiento de límites exactos y automatización del cierre se validan con DEC-002; una fecha programada no introduce un cuarto estado de actividad.

**Propuesta:** una actividad publicada congela sus versiones, orden y conjunto de ejercicios requeridos. Cambiar este conjunto después de recibir intentos exigiría versionar la publicación y definir cómo cambia el denominador; no se permite silenciosamente en el MVP. Puede modificarse texto meramente descriptivo mediante revisión y auditoría siempre que no altere lo que se evalúa.

### 4.3 Ejecuciones, intentos y evidencia técnica

| Entidad | Campos específicos | Relaciones y restricciones |
| --- | --- | --- |
| `executions` | `class_id`, `activity_id`, `exercise_version_id`, `student_id`, `attempt_id?`, `purpose`, `code_hash`, `lifecycle_status`, `admitted_at`, `started_at?`, `finished_at?`, `runtime_version`, `test_suite_hash`, `limits_snapshot`, `sandbox_region?`, `correlation_id` | Distingue ejecución de práctica de ejecución asociada al envío. Estados operativos y motivos se definen en [API](07-api-y-contratos.md) y [ejecución](13-ejecucion-controlada.md); no son nuevos diagnósticos. Cada solicitud ejecuta únicamente código del estudiante autorizado y la versión fijada. |
| `attempts` | `class_id`, `activity_id`, `activity_exercise_id`, `exercise_version_id`, `student_id`, `attempt_number`, `previous_attempt_id?`, `code`, `code_hash`, `submitted_at`, `idempotency_key`, `canonical_result_id` | Cada reintento es una fila nueva. Único por estudiante y clave de idempotencia dentro del ámbito de envío; número consecutivo por estudiante y ejercicio de actividad. El intento previo, si se indica, corresponde al mismo estudiante y ejercicio de actividad. Código, versión, autor y fecha son inmutables tras el registro. |
| `technical_results` | `execution_id`, `diagnosis_code`, `termination_reason?`, `visible_passed`, `visible_total`, `required_passed`, `required_total`, `duration_ms`, `stdout`, `stderr`, `output_bytes`, `output_truncated`, `result_schema_version`, `computed_at` | Un resultado por ejecución. Seis diagnósticos exactos. Contadores coherentes. Salida estudiantil saneada y limitada a 64 KB por el contrato del ejecutor; detalles ocultos no aparecen en la proyección estudiantil. |
| `test_results` | `organization_id`, `technical_result_id`, `test_id`, `passed`, `duration_ms?`, `safe_message?` | Un resultado por prueba y ejecución. Referencia a la misma versión del ejercicio. Los detalles de pruebas ocultas son privados aunque el resultado agregado influya en la completitud. |
| `learning_events` | `class_id`, `student_id`, `activity_id?`, `exercise_version_id?`, `attempt_id?`, `execution_id?`, `event_type`, `occurred_at`, `recorded_at`, `event_key`, `schema_version` | Eventos semánticos aceptados por el servidor, deduplicados por `event_key`. EXECUTION_COMPLETED referencia su ejecución autorizada. No contar GET, sondeos, refrescos ni telemetría arbitraria como aprendizaje. Catálogo y reglas en [progreso y señales](14-progreso-y-senales.md). |

El diagnóstico documentado admite exclusivamente `SUCCESS`, `SYNTAX_ERROR`, `RUNTIME_ERROR`, `FAILED_TEST`, `TIMEOUT` o `UNKNOWN`. Motivos como límite de memoria, límite de salida o indisponibilidad del ejecutor se conservan separados; su correspondencia con el diagnóstico se define en DEC-003 y en el contrato del ejecutor.

**Documentado:** ALZ-RF-010/011/014 y RNF-CON-01 obligan a persistir el intento antes de IA/RAG, conservar reintentos y basar el resultado en pruebas deterministas.

**Propuesta:** `attempts.canonical_result_id` identifica el resultado técnico que cuenta para ese intento. Debe apuntar a una ejecución del mismo intento, usuario, organización, actividad y versión; esta coherencia se valida transaccionalmente. La ejecución se admite y realiza antes de confirmar el intento: resultado, código, versión y eventos se persisten en una sola transacción, sin mantenerla abierta durante el sandbox. La referencia de ejecución al intento puede asignarse dentro de esa transacción, después de crear el intento. Solo entonces se responde `201` y se permite IA/RAG. Las reservas o ejecuciones pendientes no se presentan como intentos confirmados. Las ejecuciones técnicas reintentadas por infraestructura quedan trazadas, sin duplicar el envío lógico. El cliente no aporta resultados confiables ni elige el resultado canónico.

### 4.3.1 Contrato ejecutable de envíos, historial y avance — IMP-03.04–03.06

**Implementado y verificado en TEST mediante SQL y HTTP, 26/09/2026.** La
[migración incremental de SUBMIT](../supabase/migrations/20260926215711_practice_submissions.sql)
y el [diccionario de envíos](../docs/work/IMP-03-submissions-dictionary.md)
materializan este corte autorizado. La tabla lógica de §4.3 y el diagrama de §5
conservan el diseño lógico; no son un inventario literal del esquema ya creado.
No se crean ahora `technical_results`, `test_results`, `learning_events` ni
`attempts.canonical_result_id` como entidades físicas paralelas.

| Objeto físico actual | Contrato implementado |
| --- | --- |
| `app.executions` | Conserva únicamente RUN y su respuesta temporal. No guarda código fuente ni concede completitud. La admisión usa los contadores combinados con SUBMIT. |
| `app_private.submission_reservations` | Reserva privada SUBMIT: código inmutable, contexto académico completo, hashes SHA-256 de código/suite, versión del runner, límites, conteos, número de admisión, intento anterior opcional, lease con token, evidencia normalizada durable y respuesta idempotente temporal. Aún no es un intento. |
| `app.attempts` | Un intento inmutable por reserva: código, resultado público canónico `technical_result`, contexto, versiones/hashes, `admitted_at`, `submitted_at`, `attempt_number` y `previous_attempt_id`. FK por organización y guardas verifican contexto; el intento anterior exige también estudiante/asignación/versión iguales. |
| `app_private.attempt_results` | Evidencia privada canónica vinculada por organización/intento: resultados ocultos `{id,passed}`, `result_schema_version = submission.v1`, versión del runner y hash de suite. No contiene argumentos, expectativas ni consola oculta; no se purga junto al snapshot operativo. |
| `app_private.attempt_events` | Dos hechos inmutables por intento: `ATTEMPT_SUBMITTED` y `EXECUTION_COMPLETED`, deduplicados por intento/tipo, con ámbito completo, hora servidor, secuencia global y `schema_version = submission.v1`. El corte IMP-03 no evaluaba señales; IMP-05 reutiliza estos hechos sin copiarlos a otro ledger. |
| `app.operation_keys` | Operación `practice.submit`, única por organización/actor/operación/clave. Conserva hash y vínculo a reserva o intento. Respuesta de 24 horas; clave expirada queda como tombstone y no genera otro envío. |

La admisión serializa actor y organización con RUN y cierre académico. Verifica
sesión, perfil, membresía, inscripción, actividad, versión y ventana
`[opensAt, closesAt)`. Según DEC-002 ratificada por el usuario, un SUBMIT admitido
antes del cierre puede finalizar después; confirmar la interfaz no concede
admisión. El archivado de clase/organización considera SUBMIT activos. Los cupos
predeterminados del corte son un RUN y dos SUBMIT simultáneos por
estudiante/organización, sujetos a cuatro operaciones combinadas por organización
y diez admisiones combinadas por minuto/estudiante/organización.

La carga de la suite completa exige una función privada limitada a la reserva y
su token vigente. No amplía `tests_read` del estudiante. La ejecución ocurre
fuera de una transacción de base de datos. El resultado normalizado se guarda
durablemente antes del commit final; las validaciones SQL exigen IDs y conteos
coherentes, cobertura completa para `SUCCESS`/`FAILED_TEST` y evidencia real para
`allRequiredPassed`. Confirmar persiste intento, resultado privado, eventos y
respuesta idempotente en una sola transacción. Si falla ese commit, no existen
intento parcial ni eventos huérfanos y la evidencia previa permite recuperación.
El reconciliador rota leases y usa el resultado durable o un `UNKNOWN` operativo
sin completitud, sin reejecutar código automáticamente. El piso de recuperación
es de 60 segundos desde admisión ante creación incierta de la cápsula.

El esquema público conserva los seis diagnósticos y campos públicos RUN; añade
`hiddenChecksPassed` (`null` cuando no corresponde un resumen completo) y
`allRequiredPassed`. No devuelve IDs, expectativas ni consola de pruebas ocultas.
Toda entrega, detalle, historia y progreso exige autorización vigente, incluida
la consulta después del cierre o de la renovación de sesión. RLS de intentos
restringe al estudiante propietario activo e inscrito; ADMIN no adquiere lectura
pedagógica. El seguimiento docente permanece fuera de este incremento. Las
tablas privadas fuerzan RLS y el runtime no recibe SELECT directo; funciones
limitadas con propietario sin BYPASSRLS implementan la persistencia interna.

La historia usa `attempt_number DESC`, asignado por servidor al admitir cada
envío dentro de estudiante/asignación. Así conserva el orden aunque dos
ejecuciones terminen al revés; mientras una reserva esté pendiente puede haber
huecos en la lista de intentos confirmados. La paginación tiene cursor entero
exclusivo, diez elementos por defecto y máximo veinte. Una copia al editor no
modifica el intento; el nuevo envío usa otra clave y, si corresponde, referencia
el intento anterior propio.

`app_private.practice_activity_progress` es la única proyección SQL de este
corte: cuenta asignaciones requeridas y aquellas con algún intento confirmado
de la misma asignación/versión que haya superado todas las pruebas. Un fallo
posterior no elimina un éxito. RUN y reservas no completan ejercicios. Devuelve
`completed`, `required`, proporción sin redondear, `asOf` y estados
`NO_REQUIRED_EXERCISES`, `NO_ATTEMPTS` o `HAS_EVIDENCE`. El caso 0/0 conserva
proporción nula; su fixture de frontera no habilita publicaciones vacías. No se
crea una caché, cálculo de conceptos, nota ni señal.

La purga de 24 horas elimina respuestas y copias redundantes de fuente/evidencia
solo en reservas completadas; intentos, evidencia privada canónica, eventos y
vínculos idempotentes permanecen. DEC-009 sigue pendiente para datos reales.
La migración no resetea DEV ni altera las migraciones previas. La suite
[007](../supabase/tests/007_practice_submissions.test.sql) y la integración HTTP
cubren las comprobaciones pertinentes de DAT-01/02/04/05/06/09/10. La integración
coordinada de TEST pasó 110/110 pruebas HTTP y 285 aserciones pgTAP en siete
archivos; la suite 007 aporta 104 aserciones. El reporte local
`.local/reports/imp-03-submissions/integration.json` registra Supabase/Docker
reales y limpieza completada a las 23:19:32Z del 26/09/2026. La verificación de
interfaz se registra por separado. IA/RAG y señales estaban pendientes en ese
corte; §4.4–4.5 describen su incorporación posterior. La aceptación académica
y la integración productiva siguen separadas de esa evidencia local.

### 4.4 Fuentes y feedback

Fuentes e ingestión están concretadas para IMP-04.01–04.03 en el
[diccionario de materiales](../docs/work/IMP-04-materials-dictionary.md) y la
migración incremental `20260927155718_materials_ingestion.sql`. Feedback se
concreta en IMP-04.04–04.06 y evaluación/recibos en IMP-04.07 y la preparación
ejecutable de IMP-04.08, implementados y probados en TEST. El
[registro del corte](../docs/work/IMP-04-evaluation.md) distingue las pruebas
locales de los pendientes de Azure y aceptación académica.

| Entidad | Campos específicos | Relaciones y restricciones |
| --- | --- | --- |
| `sources` | `class_id`, `activity_id?`, `title`, `owner_id`, `current_version_id?`, `visibility`, `archived_at?` | Toda fuente tiene una clase. Si tiene actividad, esta pertenece a esa clase. La visibilidad siempre se intersecta con los permisos vigentes. |
| `source_versions` | `source_id`, `version`, `storage_object_key`, `original_name`, `format`, `mime_type`, `size_bytes`, `content_hash`, `current_generation_id?` | PDF textual/TXT/Markdown de hasta 10.000.000 bytes. Versiones únicas e identidad/binario/hash inmutables. Reemplazar crea otra versión; el puntero activo cambia únicamente al publicar un índice completo. |
| `source_index_generations` | `source_id`, `source_version_id`, `generation_number`, `index_status`, `index_error_code?`, `extraction_version`, `tokenizer_version`, `embedding_model?`, `embedding_dimension?`, `configuration_id`, `expected_chunk_count`, `manifest_hash`, `indexed_at?`, `chunk_count` | Generación única por versión y número. Cada reindexación crea una generación separada; solo una generación completa `READY` se activa. Un manifiesto y perfil coherentes permiten continuar lotes tras reinicio. |
| `source_chunks` | `organization_id`, `source_id`, `source_version_id`, `generation_id`, `chunk_index`, `text`, `token_count`, `locator`, `content_hash`, `embedding` | Único `(generation_id, chunk_index)` y FK compuesta que fija fuente/versión/generación. Clase/actividad se resuelven desde la fuente; 500 tokens, solapamiento 50 y top-k=5. No hay SELECT directo de texto de fragmentos para el rol de aplicación; funciones autorizadas gestionan consulta docente y recuperación. |
| `material_jobs` | `source_id`, `source_version_id`, `generation_id`, `requested_by`, `kind`, `operation_id`, `lifecycle_status`, `attempt_count`, `available_at`, tokens/leases, error y correlación | Trabajo durable de carga/reemplazo/reindexación; como máximo uno activo por fuente. Tokens privados impiden terminar trabajo desde un lease anterior. El DTO público excluye tokens y reserva interna. |
| `feedback_requests` | `organization_id`, `class_id`, `activity_id`, `student_id`, `attempt_id`, `kind`, `hint_level?`, `level_reserved`, `lifecycle_status`, `requested_at`, `deadline_at`, token/lease, `completed_at?`, `last_error_code?`, `context_fixed` | `kind=FEEDBACK/HINT`. Solo para intento y resultado técnico persistidos; idempotencia vinculada a operaciones privadas. Estado del trabajo separado del estado RAG; reserva de pista hasta ACK, sin consumo por fallback. |
| `feedbacks` | `request_id`, `attempt_id`, `organization_id`, `diagnosis_code`, `explanation`, `hint`, `rag_status`, `metadata`, `presentation_token`, `presented_at?`, `viewed_at?`, `suppressed_at?` | Resultado validado y referencias normalizadas. Estado exacto `SUPPORTED/NO_EVIDENCE/PROVIDER_UNAVAILABLE`; supresión irreversible del contenido revocado. No tiene puntaje, porcentaje de dominio ni probabilidad de aprobar. |
| `feedback_source_refs` | `organization_id`, `feedback_id`, `source_id`, `source_version_id`, `chunk_id`, `locator`, `position` | Proyección normalizada de `source_refs` para integridad y consulta. Cada referencia debe existir, pertenecer al mismo ámbito y haber sido recuperada para esa solicitud. |

`source_refs` expuesto y `feedback_source_refs` persistido representan el mismo conjunto;
el JSON público se construye desde la relación. IMP-04.04–04.06 concreta su
persistencia en el [diccionario de ayuda](../docs/work/IMP-04-help-dictionary.md):
`feedback_requests`, `feedbacks`, `feedback_source_refs` y relaciones privadas
`help_calls`, `help_inputs`, `help_context_refs`, `help_events`. El contexto usado
incluye las fuentes no citadas para revalidación y supresión. El ACK no reutiliza
`attempt_events`; tiene unicidad por feedback/tipo y por intento/nivel entregado.
Modelo y dimensión reales requieren configuración verificada de Azure. El perfil
privado de embeddings rechaza configuraciones incompatibles y la calibración
remota permanece pendiente de medición bajo DEC-010.

**Documentado:** ALZ-RF-006/012/013/025 y RNF-IA-02/03/04 fijan formatos, límites, estados, trazabilidad y filtrado autorizado. **Implementación del corte:** reindexar crea una generación validada antes de cambiar `current_generation_id`; reemplazar crea otra versión y cambia `current_version_id` solo al completarla. Las FK compuestas mantienen organización, clase y actividad; la fuente conserva su ámbito inicial. La publicación, archivo y cambios de permisos se coordinan para impedir activación tardía. Una generación fallida no sustituye la anterior ni habilita fragmentos parciales.

`app_private.material_upload_objects` conserva reservas y compensación de
objetos propios de Storage, sin pretender una transacción distribuida con
PostgreSQL. El bucket privado se provisiona por bootstrap; el acceso de usuario
a archivos pasa por la API. `app_private.material_embedding_profile` fija el
perfil del ambiente desde el primer procesamiento; cambiarlo requiere migración
explícita futura. El historial de metadatos se conserva al archivar; retención
institucional, citas futuras y datos reales permanecen sujetos a DEC-009. Las
pruebas ejecutadas y pendientes constan en el
[registro IMP-04](../docs/work/IMP-04-materials.md).

### 4.4.1 Ledger de IA y evaluación acotada — IMP-04.07/preparación .08

La migración `20261002001227_evaluation_ledger.sql` incorpora relaciones en
`app_private`, con RLS forzada y acceso de aplicación mediante funciones
autorizadas. El [diccionario de evaluación](../docs/work/IMP-04-evaluation-dictionary.md)
es el contrato detallado; la implementación y su recuperación están probadas
en TEST. La CI completa del 02/10/2026 aprobó 146 pruebas HTTP y 471 aserciones
SQL del conjunto integrado. El arnés TEST cerró 43/43 casos, conservó 763
recibos y verificó tres reanudaciones; véase el
[registro de evidencia](../docs/work/IMP-04-evaluation.md). Esto acredita la
preparación ejecutable de IMP-04.08, no la evaluación semántica, el ensayo Azure
ni la aceptación docente/CAPSTONE de la fase.

| Relación | Alcance e integridad |
| --- | --- |
| `evaluation_runs`, `evaluation_stages` | Manifiesto/hash, hash de credencial, origen/destino y expiración; cuatro etapas y presupuestos inmutables; un run activo por base y una etapa activa por run |
| `evaluation_bindings`, `evaluation_owners` | Autorización por organización/clase/actividad/actor y archivo/hash u intento/hash; FK compuestas y máximo de operaciones; trabajo real ligado una sola vez al binding |
| `evaluation_calibrations` | Consulta/hash, candidatos y llamada observados con lease; casos de calibración y de revisión ficticia vinculados al corpus y al intento autorizado |
| `ai_call_receipts` | Despacho previo al proveedor, fase/clave lógica/intento, perfil y hash de entrada, reservas, observación y resultado/fallo privados; estados `DISPATCHED/COMPLETED/UNKNOWN` |

Los recibos se utilizan también fuera de evaluación, con run/etapa nulos. No son
eventos pedagógicos ni alteran `attempt_events`, diagnóstico o progreso. Un
resultado durable permite reconciliar un checkpoint de ayuda perdido; un
despacho incierto no permite repetir el proveedor. Las observaciones tardías
pueden completar consumo pese a la revocación, pero no publicar contenido.
Tokens/costos no observados permanecen nulos. La calibración aceptada liga
consultas, corpus, distancias y recibos del mismo origen y perfil; TEST no
acredita medición Azure. La credencial del listener nunca se guarda en claro en
estas tablas ni sustituye autorización de producto.

### 4.5 Progreso, señales y auditoría

| Entidad o proyección | Campos específicos | Relaciones y restricciones |
| --- | --- | --- |
| Progreso — cálculo común .01–.02/.07 | Contadores, corte, actividad/concepto y evidencia del primer éxito por asignación; contrato en [progress.ts](../packages/contracts/src/progress.ts) | Funciones privadas `progress_observations`/`progress_payload`, sin tabla de porcentajes. `student_progress` conserva la forma SQL anterior; `student_progress_observed` añade observación personal. La identidad procede de la sesión. |
| Progreso por concepto — desglose del cálculo común | Identidad conceptual y versiones históricas realmente asignadas | Una asignación requerida cuenta una vez por concepto, sin multiplicarse por joins. Cada asignación fija su versión de ejercicio; no se suman porcentajes conceptuales para obtener el total. |
| `app.signal_rule_versions` — contrato IMP-05.03 | `organization_id`, `type`, `version`, `schema_version`, `algorithm_version`, `parameters`, `created_by`, `created_at`, `activated_by?`, `valid_from?`, `valid_to?` | Tipos INACTIVITY/REPEATED_ERROR/STAGNATION. Parámetros/schema/algoritmo inmutables desde creación; version secuencial por organización/tipo, schema 1 y DEC005_V1. Activación inmediata [A,B), una vigente por ámbito; DRAFT/ACTIVE/RETIRED es proyección de versión y no catálogo de señal. |
| `app_private.signal_rule_scopes` — contrato IMP-05.03 | `organization_id`, `type`, `next_version`, `current_version_id?` | PK organización/tipo, FK compuesta hacia versión del mismo ámbito; exclusión transaccional para secuencia, activación y vigente esperada. |
| `app_private.signal_rule_operations` — contrato IMP-05.03 | Organización, actor, operación, clave, payload JSONB comparado por valores semánticos y snapshot de respuesta | Idempotencia permanente privada por organización/actor/operación/clave. Replay conserva snapshot/fecha/auditoría original con permisos actuales; otro payload con la clave se rechaza. Orden de claves y 7/7.0 no crean identidad distinta. |
| `app_private.signal_episodes` — contrato .05 | Carril, regla, primer testigo, causa/evidencia inicial, `qualified_at`, `calculated_at`, antecedente, estado y corte de acumulación | Materializa la señal lógica; no existe una tabla pública paralela `signals`. Estado exacto ACTIVE/REVIEWED. Un corte interno no cambia estado; nuevos episodios se vinculan sin ciclos y conservan antecedentes. |
| `app_private.signal_reviews` — base .05 y revisión pública IMP-06.04 | Episodio/carril, primer revisor/fecha, snapshot, testigos/evaluaciones de la base y digest | Una revisión por episodio, inmutable e idempotente. IMP-06.04 escribe mediante su operación autorizada; la tabla y el soporte de prueba permanecen privados, sin acceso directo de `alunza_app`. |
| `audit_events` | `organization_id`, `actor_id?`, `actor_kind`, `occurred_at`, `action`, `entity_type`, `entity_id?`, `result`, `correlation_id`, `safe_changes?`, `request_id?` | Append-only desde componentes autorizados. Metadatos operativos mínimos, sin código estudiantil, secretos ni contenido completo de IA. Campos de la exportación en [seguridad](09-seguridad-y-privacidad.md). |

**Documentado:** ALZ-RF-015/018/019/026/027 exigen fórmula de progreso, reglas explicables, revisión idempotente, versiones de reglas y auditoría. Las señales se calculan con siete días sin eventos, el mismo error técnico en tres intentos consecutivos dentro de 14 días o tres intentos sin aumentar pruebas visibles superadas; precisiones de ventana y secuencia en [progreso y señales](14-progreso-y-senales.md).

**DEC-005 D1–D5 aprobadas 05/10/2026; contrato IMP-05.03:** el
[diccionario .03](../docs/work/IMP-05-signal-rules-dictionary.md) concreta validación
int4 (días 1–2.147.483.647, conteos 2–2.147.483.647), DTO/RPC, locks, permisos,
inmutabilidad, rechazo de fechas cliente y CAS de activación. La migración
`20261005233736_signal_rule_versions.sql` es aditiva, con RLS forzada,
auditoría RULE_VERSION_CREATED/RULE_VERSION_ACTIVATED atómica, una vigencia
abierta y guardas de no solapamiento. Crear no activa; no hay actualización
directa del cliente ni permisos pedagógicos por gobernar reglas. Estado y
pruebas reales en [registro .03](../docs/work/IMP-05-rules.md).

El suplemento de migración preserva las tablas previas con dos adiciones de
política y un permiso auxiliar explícito: UPDATE(id) de app.profiles para
alunza_identity, necesario para FOR SHARE; las RPC no actualizan perfiles y no
se concede ese UPDATE al runtime ni a roles públicos. INSERT de auditoría para
alunza_identity ya existía; la política nueva lo restringe a las dos acciones
RULE_VERSION_CREATED/RULE_VERSION_ACTIVATED y su actor/ámbito/entidad. El
[registro .03](../docs/work/IMP-05-rules.md) distingue esos cambios autorizados
de la conservación del resto de propietarios, RLS, ACL y políticas.

ADMIN actual con perfil/membresía ACTIVE y sesión vigente conserva lectura
administrativa de organización ARCHIVED según DEC-001. Crear/activar, incluidos
replays de mutación, exige organización ACTIVE; el rechazo es
ORGANIZATION_ARCHIVED 409. La consulta histórica no habilita escritura ni datos
pedagógicos individuales.

### 4.5.1 Persistencia, recuperación y lectura — IMP-05.05–05.08

La [migración .05](../supabase/migrations/20261025201002_signal_episodes.sql)
materializa D4 en `app_private`. El [diccionario de episodios](../docs/work/IMP-05-episodes-dictionary.md)
detalla claves, nulabilidad, restricciones, recuperación y permisos; sus familias son:

| Registros | Responsabilidad |
| --- | --- |
| `signal_lanes`, `signal_jobs` | Ámbito de cálculo, lease/token, checkpoint, continuación, deadline y fallos recuperables. El trabajo no es una señal. |
| `signal_input_changes`, `signal_evidence_clocks`, `signal_change_acks` | Revisión consistente por componentes y reconocimiento individual de cambios confirmados; `MAX(event_sequence)` no acredita consistencia ni captura commits tardíos. |
| `signal_runtime`, `signal_capture_registry`, `signal_coverage_epochs` | Inicio real de instalación, definición de capturadores y continuidad comprobada; no inventan historia anterior. |
| `signal_snapshots`, `signal_evaluations` | Referencias/digests y resultado inmutable con regla, corte, frontera y reconciliación. La evidencia técnica se rehidrata desde el intento canónico. |
| `signal_witnesses`, `signal_episode_evaluations`, `signal_reviews` | Testigos, vínculos y base revisada preservados; un commit tardío puede ser nuevo aunque su fecha sea anterior a la revisión. |
| `signal_projections`, `signal_rebuild_receipts`, `signal_finalize_receipts` | Derivados reparables y recibos de replay; nunca reemplazan hechos, evaluaciones o checkpoints. |

Las tablas privadas tienen RLS habilitada y forzada. El runtime opera mediante
funciones explícitas con propietario limitado, sin privilegios directos sobre
los ledgers ni `BYPASSRLS`. El worker captura, calcula fuera de la transacción
y revalida antes de confirmar; una revisión distinta exige reconciliación.
Reconstruir reproduce snapshots originales y repara solo derivados, sin
retroceder el puntero operativo ni publicar alertas históricas nuevas.

La [migración .07](../supabase/migrations/20261026163925_teacher_dashboard.sql)
añade lectura personal/docente sobre el núcleo común. Los totales docentes
cuentan pares estudiante/asignación de matrícula actualmente activa; las
señales históricas autorizadas fuera de esa matrícula se conservan etiquetadas.
Los agregados se calculan antes de paginar. El período filtra observaciones,
no logros anteriores ni última actividad al corte. El
[diccionario del tablero](../docs/work/IMP-05-dashboard-dictionary.md) concreta
evidencia mínima, fechas, cursores y frescura, sin exponer código ni pruebas ocultas.

Las migraciones aditivas .08 de [frescura en conjunto](../supabase/migrations/20261026212627_dashboard_processing_set_based.sql)
y [resumen de intentos](../supabase/migrations/20261026220133_dashboard_summary_projection.sql)
optimizan consultas existentes sin cambiar hechos, tablas, índices, contratos
públicos, propietarios o permisos. El [cierre .08](../docs/work/IMP-05-acceptance.md)
registra instalación vacía, actualización .07→.08, reconstrucción/replay,
comparación de 26 colecciones canónicas y DTO al mismo corte, excluyendo solo
`observedAt`, y controles de ACL. Esa evidencia local no cierra RF-017 integral,
la acción pública RF-019 ni aceptación remota o CAPSTONE.

### 4.5.1 Detalle docente — IMP-06.03

Las ocho funciones `student_detail_progress`, `student_detail_evidence`,
`student_detail_attempt`, `student_detail_feedback_history`,
`student_detail_feedback`, `student_detail_reference`, `student_detail_signals`
y `student_detail_signal` reciben clase y estudiante explícitos y autorizan al
actor docente real. `dashboard_context` comprueba sesión, perfil, membresía y
asignación vigentes; `dashboard_roster` exige matrícula actual sin retiro,
perfil ACTIVE y membresía STUDENT ACTIVE. El corte histórico no reconstruye
matrícula ni restaura permisos. ADMIN no obtiene lectura pedagógica general.

Son funciones `STABLE SECURITY DEFINER`, propiedad de `alunza_identity`, con
`search_path=pg_catalog` y ejecución limitada a `alunza_app`. Sus kernels no son
invocables por el runtime ni por los roles Data API. Conservan RLS y grants de
las tablas; no añaden lectura general docente de intentos o ayudas. Reutilizan
`progress_payload`, `dashboard_attempts`, `dashboard_events` y evidencia mínima.
La definición del intento sale de su versión fijada, filtrando tests visibles
en SQL y conservando únicamente `hiddenChecksPassed` como resumen oculto público.

La entrega de ayuda se comprueba mediante `app_private.help_events`: evento
`HINT_DELIVERED`/`FEEDBACK_VIEWED` del mismo feedback/solicitud/intento hasta
`asOf`. `presented_at`, reserva o generación sin evento no habilitan listado,
detalle ni referencia. `help_scope_valid` y `suppressed_at` determinan
disponibilidad actual sin ejecutar supresión: al revocarse, `help=null` y
`available=false`, conservando metadatos. La proyección docente no devuelve
token de presentación ni crea acuses. Las referencias conservan fuente,
versión y fragmento originales y requieren reautorización tras Storage.

`dashboard_processing_scoped` y `dashboard_signals_scoped` reciben estudiante
opcional: filtran antes de crear carriles, ordenar o paginar. Estudiante NULL
conserva los wrappers de clase anteriores. Los cursores vinculan actor,
estudiante, recurso, filtros y corte. La migración no reescribe hechos ni
recalcula señales; las lecturas no modifican ayuda, progreso, intentos o
auditoría. La actualización .02→.03 y la inmutabilidad se verificaron localmente
mediante los arneses enlazados en el [diccionario .03](../docs/work/IMP-06-student-detail-dictionary.md),
con resultados, incidencias y límites conservados en el [registro .03](../docs/work/IMP-06-student-detail.md).

### 4.6 Persistencia operativa

| Entidad propuesta | Campos específicos | Finalidad y restricciones |
| --- | --- | --- |
| `operation_keys` | `organization_id`, `actor_id`, `operation`, `key`, `payload_hash`, `reserved_at`, `lease_until?`, `resource_type?`, `resource_id?`, `response_code?` | Único `(organization_id, actor_id, operation, key)`. Reservas de idempotencia; no guardar cuerpos sensibles completos. Una reserva vencida se reconcilia antes de repetir el efecto externo. |
| `background_jobs` | `organization_id`, `class_id?`, `requested_by?`, `kind`, `entity_type`, `entity_id`, `lifecycle_status`, `attempt_count`, `available_at`, `lease_until?`, `last_error_code?`, `correlation_id` | Trabajo durable de ingestión, feedback u otro efecto autorizado; payload de IDs mínimos y referencias, sin tokens. Adquisición atómica, lease recuperable y reintentos acotados según contrato de [API](07-api-y-contratos.md). |

Estas tablas son soporte interno, no nuevas funciones del producto. Una solicitud de feedback identifica su trabajo mediante una referencia única; fuente y exportación pueden usar el mismo mecanismo. La transacción de negocio crea el trabajo o evento outbox que lo alimenta; no confirmar `202` si solo existe una tarea en memoria. Los estados de trabajo no amplían los catálogos de diagnóstico, actividad, usuario, señal o RAG.

## 5. Relaciones principales

```mermaid
erDiagram
    organizations ||--o{ organization_memberships : autoriza
    profiles ||--o{ organization_memberships : pertenece
    organizations ||--o{ courses : posee
    courses ||--o{ classes : agrupa
    classes ||--o{ class_memberships : inscribe
    profiles ||--o{ class_memberships : participa
    classes ||--o{ activities : publica
    activities ||--o{ activity_exercises : ordena
    exercises ||--|{ exercise_versions : versiona
    exercise_versions ||--o{ activity_exercises : fija
    exercise_versions ||--o{ exercise_tests : verifica
    exercise_versions ||--o{ exercise_version_concepts : etiqueta
    concept_versions ||--o{ exercise_version_concepts : contextualiza
    activity_exercises ||--o{ attempts : recibe
    attempts ||--o{ executions : procesa
    executions ||--o| technical_results : produce
    attempts ||--o{ feedback_requests : solicita
    feedback_requests ||--o| feedbacks : responde
    classes ||--o{ sources : autoriza
    sources ||--|{ source_versions : versiona
    source_versions ||--o{ source_index_generations : reindexa
    source_index_generations ||--o{ source_chunks : fragmenta
    feedbacks ||--o{ feedback_source_refs : cita
    source_chunks ||--o{ feedback_source_refs : sustenta
    signal_rule_versions ||--o{ signal_evaluations : aplica
    signal_rule_versions ||--o{ signal_episodes : explica
    signal_episodes ||--o{ signal_episode_evaluations : vincula
    signal_episodes ||--o| signal_reviews : registra
    organizations ||--o{ audit_events : conserva
```

El diagrama omite claves compuestas, eventos y proyecciones para facilitar lectura; las restricciones del diccionario prevalecen.

## 6. Transacciones, idempotencia y concurrencia

| Operación | Unidad de consistencia propuesta |
| --- | --- |
| Aceptar invitación o código | Bloquear o actualizar condicionalmente el token; validar vigencia; crear membresía una vez; consumir uso; registrar evento y auditoría; confirmar todo o nada. |
| Cambiar rol/deshabilitar usuario | Bloquear la organización o serializar la comprobación del último administrador activo; aplicar estado/rol y auditoría en la misma transacción. Dos deshabilitaciones concurrentes no pueden dejar cero administradores. |
| Publicar actividad | Validar profesor, clase, ejercicios, versiones y pruebas; fijar conjunto/orden/versiones; cambiar estado y auditar atómicamente. Publicación vacía o inconsistente se rechaza. |
| Admitir envío | Verificar estado `PUBLISHED` y pertenencia; reservar clave y hash del contenido; registrar el orden de admisión frente al cierre. Un mismo identificador con otro contenido produce conflicto. La reserva no es un intento confirmado. Ejecutar fuera de la transacción de base de datos. |
| Confirmar intento y evaluación | Persistir intento, código, versión, resultado técnico confiable y evento en una sola transacción, vinculados a la ejecución admitida. No confirmar éxito si falla. Solo después del commit se devuelve `201` y se habilita feedback. |
| Solicitar feedback | Verificar intento y resultado durables; reservar clave/nivel de ayuda; crear trabajo persistido. Error posterior de IA conserva intento y resultado, con estado de degradación. |
| Reindexar | Escribir nueva versión/generación; validar todos los metadatos y fragmentos; activar mediante cambio atómico de versión. Fallar conserva la versión previa si sigue autorizada. |
| Activar regla — .03 | Serializar por organización/tipo y comprobar vigente esperada; hora servidor A, cerrar anterior B=A, activar nueva [A,B), actualizar scope, auditar y guardar snapshot de replay en una transacción. Sin fecha cliente ni reactivar RETIRED. .05 procesa después el cambio conservando episodios y versiones anteriores. |
| Revisar señal — IMP-06.04 sobre soporte IMP-05.05 | Reautorizar permisos/matrícula actuales y bloquear fuentes/cobertura antes de capturar; fijar base inmutable, primer revisor/fecha, transición `ACTIVE → REVIEWED`, evento REVIEW, proyección y auditoría SIGNAL_REVIEWED en una transacción. Replay reautorizado conserva hechos y no duplica auditoría. Un lease ocupado rechaza sin mutar. |
| Archivar catálogo | Validar dependencias, archivar y auditar; impedir nuevas referencias activas, conservar las históricas. |

Los efectos externos, como enviar invitaciones o llamar proveedores, se ejecutan después del commit mediante el contrato de trabajos de [API](07-api-y-contratos.md). Si se utiliza outbox, la fila del trabajo se confirma con el cambio de negocio; su entrega puede repetirse, sus efectos deben ser idempotentes. Ningún fallo de red justifica confirmar una escritura no persistida.

## 7. Índices y rendimiento propuestos

| Acceso principal | Índice candidato |
| --- | --- |
| Miembros y permisos actuales | Único `organization_memberships(organization_id, user_id)`; índice `class_memberships(organization_id, class_id, user_id)` con acceso a estado/fin de pertenencia. |
| Listas de clase y actividades | `classes(organization_id, course_id)`; `activities(organization_id, class_id, state, created_at, id)`. |
| Versiones y orden | Únicos por entidad/versión, `activity_exercises(activity_id, position)` y relación a `exercise_version_id`; incluir alcance institucional en las claves foráneas. |
| Historial de intentos | `attempts(organization_id, class_id, student_id, activity_id, submitted_at DESC, id)` y acceso por ejercicio/versión para reglas. |
| Inactividad | `learning_events(organization_id, class_id, student_id, activity_id, occurred_at DESC, id)`. |
| Fuentes recuperables | `sources(organization_id, class_id, activity_id, archived_at)`; `source_index_generations(source_version_id, index_status)`; metadatos de alcance indexados en `source_chunks`. |
| Recuperación vectorial | Evaluar índice compatible con pgvector y el modelo aprobado después de medir el corpus. Conservar filtro de permisos dentro de la consulta; el índice nunca reemplaza RLS. |
| Señales | El diseño lógico se concretó en índices de carril/historia .05 y `dashboard_episodes_lane_cut` / `dashboard_evaluations_latest` de .07; consultar esas migraciones antes de proponer otro índice. |
| Auditoría | `audit_events(organization_id, occurred_at DESC, id)` y, según medición, actor/acción/entidad más fecha. Paginación estable por fecha e ID. |

La tabla conserva candidatos del modelo lógico, no un inventario de índices instalados. IMP-05.08 optimizó las consultas medidas sin añadir índices. No crear índices por intuición en todas las columnas. Validar planes y latencias con el conjunto canónico y un perfil de carga acordado; ver [calidad](10-calidad-y-pruebas.md). Las políticas RLS se incluyen en las pruebas de consulta. Una vista expuesta debe ejecutar con permisos del invocador o quedar privada y servirse a través de una proyección autorizada.

## 8. Migraciones, datos iniciales y ciclo de vida

**Documentado:** RNF-POR-01/02 exige inicialización reproducible con Docker Compose, Supabase CLI, adaptador local y datos ficticios. La demo canónica tiene 2 organizaciones, 2 administradores, 2 profesores, 8 estudiantes, 3 clases, 10 ejercicios y 2 documentos por clase.

**Propuesta de entregables de implementación:**

1. Migraciones versionadas con tablas, restricciones, funciones controladas, privilegios, RLS y políticas de Storage; una nueva instalación y una actualización desde la versión anterior deben funcionar.
2. Datos iniciales deterministas con IDs estables para la demo, sin correos ni códigos de alumnos reales; no guardar contraseñas o claves válidas en el repositorio.
3. Casos de evidencia suficiente, ausencia de intentos, IA sin evidencia, fuente fallida, ejercicio cerrado y señal revisada. Las fixtures de prueba adicionales se mantienen separadas del conteo de la demo.
4. Instrucción para reconstruir proyecciones e índices desde las tablas fuente y verificar integridad después de restaurar un respaldo.
5. Migraciones de expansión/contracción cuando cambie un contrato consumido por servicios desplegados separadamente; no eliminar una columna todavía usada por una versión activa.

**Pendiente, DEC-009:** períodos de retención para perfiles, código, eventos, feedback, archivos, logs, auditoría y respaldos; tratamiento de solicitudes de acceso o eliminación y conservación de evidencia. No fijar una retención legal supuesta. Antes de un piloto real deben acordarse una política institucional y el proceso de eliminación o anonimización, incluida la retirada de vectores, objetos y copias derivadas. El archivado funcional no sustituye ese proceso.

## 9. Criterios de aceptación de datos

**Incremento IMP-05.01–05.02:** la migración aditiva conserva observaciones
privadas append-only de apertura explícita y finalización RUN, junto con el inicio
real de cobertura. El contrato interno combina estos registros con inscripción,
attempt_events y help_events, sin duplicar ledgers ni inventar historia. El
progreso consulta versiones publicadas e intentos confirmados hasta el corte bajo
RLS y permisos actuales; las proyecciones se calculan en consulta y no son una
nueva fuente de verdad. El [diccionario incremental](../docs/work/IMP-05-progress-dictionary.md)
detalla claves, funciones, grants, evidencia y compatibilidad.
Las versiones/activación de reglas se concretan en el contrato .03 anterior;
los evaluadores puros corresponden a .04. La implementación local .05 añade
ledgers privados de captura, snapshots, evaluaciones, testigos, episodios,
revisión y trabajos, junto con proyecciones reconstruibles. El
[diccionario .05](../docs/work/IMP-05-episodes-dictionary.md) detalla las claves
y permisos; su [registro](../docs/work/IMP-05-episodes.md) conserva ese corte
histórico. .07 añade las lecturas autorizadas y .08 verifica aceptación
transversal, actualización y rendimiento; véanse [matriz de aceptación](../docs/work/IMP-05-acceptance-matrix.md)
y [estado actual](../docs/estado-actual.md). El soporte interno de revisión
no acredita la acción pública RF-019.

| ID | Evidencia exigida antes de aceptar implementación |
| --- | --- |
| DAT-01 | Intentar relacionar recurso de organización A con clase, miembro, ejercicio, resultado o fuente de B falla por validación y por restricciones de persistencia aplicables. |
| DAT-02 | Repetir inscripción o envío con la misma clave no duplica membresías ni intentos; repetir clave de envío con código diferente devuelve conflicto. |
| DAT-03 | Dos cambios concurrentes de administradores preservan al menos uno activo; un usuario deshabilitado deja de tener permiso aunque conserve JWT anterior. |
| DAT-04 | Editar un ejercicio publicado crea nueva versión; un intento anterior reproduce la versión y pruebas originales. Archivar un concepto no elimina su referencia histórica. |
| DAT-05 | Una falla de commit del intento o resultado impide la llamada IA/RAG. Una falla posterior del proveedor no elimina ni altera el intento. |
| DAT-06 | El cálculo de progreso coincide con ejercicios distintos que superaron todas las pruebas requeridas; denominador cero produce ausencia de evidencia, no división por cero ni 100 %. |
| DAT-07 | Cada señal conserva regla, parámetros versionados, intervalo y evidencia; revisar dos veces deja una revisión efectiva. |
| DAT-08 | Reindexación incompleta no aparece en recuperación; feedback previo conserva referencias a versión y ubicación originales, sujetas a autorización vigente. |
| DAT-09 | Migrar un entorno vacío, inicializar la demo y reconstruir las proyecciones genera relaciones válidas y los conteos canónicos. |
| DAT-10 | Las proyecciones estudiantiles, consultas directas expuestas y exportaciones operativas no revelan pruebas ocultas, filas de otra clase ni campos privados. |

Esta tabla fija criterios de aceptación; no acredita su ejecución por redactarlos. §4.3.1 registra la evidencia local efectivamente obtenida para el corte de envíos y los criterios de capacidades futuras siguen pendientes. La ejecución y evidencia corresponden a [calidad y pruebas](10-calidad-y-pruebas.md) y [operación](11-operacion-y-despliegue.md).
