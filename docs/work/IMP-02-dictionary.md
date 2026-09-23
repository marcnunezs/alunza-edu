# IMP-02 — Diccionario académico

Revisión técnica de implementación, 23/09/2026. No acredita aceptación académica ni despliegue. Se conserva el esquema institucional y se amplía mediante una migración nueva. Diccionario comunicado al responsable API antes de escribir DDL.

## Convenciones

UUID de servidor, `organization_id` y FK compuestas; `revision` positiva para recursos editables. Fechas académicas `date`; eventos y ventanas `timestamptz`. Las versiones son inmutables. Todos los archivos conservan historia; no hay borrado de entidades publicadas. Sin permisos directos para anon/authenticated/service_role.

## Entidades

| Tabla                      | Campos específicos e invariantes                                                                                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| courses                    | id, organization_id, code, name, description, academic_period, start_date, end_date, archived_at, revision, created_at, updated_at. Código único institucional.                                                                                       |
| course_teacher_grants      | id, organization_id, course_id, teacher_id, granted_by, revoked_at, revision, created_at. Único curso/profesor; revocar bloquea nuevas clases, no clases existentes.                                                                                  |
| classes                    | id, organization_id, course_id, teacher_id, code, name, description, start_date, end_date, archived_at, revision, created_at, updated_at. Un profesor vigente; solo ADMIN reasigna.                                                                   |
| class_memberships          | id, organization_id, class_id, user_id, enrolled_at, ended_at. Única inscripción; estudiante institucional activo.                                                                                                                                    |
| class_join_codes           | id, organization_id, class_id, token_digest, expires_at, revoked_at, created_by, uses_count, revision, created_at. Solo digest, un código no revocado por clase; rotación revoca anterior.                                                            |
| concept_tags               | id, organization_id, normalized_name, current_version_id, archived_at, revision, created_at, updated_at. Nombre normalizado único.                                                                                                                    |
| concept_versions           | id, organization_id, concept_id, version, name, description, parent_concept_id, created_by, created_at. Inmutable; grafo vigente acíclico.                                                                                                            |
| exercises                  | id, organization_id, owner_id, visibility, current_version_id, archived_at, revision, created_at, updated_at. PRIVATE por defecto; otra visibilidad ORGANIZATION.                                                                                     |
| exercise_versions          | id, organization_id, exercise_id, version, title, statement, starter_code, language, entrypoint, difficulty, execution_limits, created_by, created_at. JavaScript/solve; BEGINNER/INTERMEDIATE/ADVANCED; límites 134217728 bytes/3000 ms/65536 bytes. |
| exercise_version_concepts  | organization_id, exercise_version_id, concept_version_id. Referencias de versión inmutables.                                                                                                                                                          |
| app_private.exercise_tests | id, organization_id, exercise_version_id, test_id, position, visibility, args, expected. 1–8 casos por versión, al menos uno visible, argumentos JSON array y comparación JSON exacta. Ocultos excluidos de RLS estudiantil.                          |
| activities                 | id, organization_id, class_id, created_by, title, type, instructions, state, opens_at, closes_at, published_at, closed_at, revision, created_at, updated_at. DIAGNOSTIC/FORMATIVE; DRAFT→PUBLISHED→CLOSED irreversible.                               |
| activity_exercises         | id, organization_id, activity_id, exercise_version_id, position, required. Versiones fijas y orden único; solo DRAFT admite modificar conjunto.                                                                                                       |

## Autorización y transacciones

Helpers de `app_private` pertenecen a `alunza_identity`, NOLOGIN y sin BYPASSRLS, con políticas de lectura explícitas. `lock_academic_organization(org)` valida actor, sesión y membresía ACTIVE y toma bloqueo de fila institucional con los privilegios de bloqueo ya existentes del helper. No concede UPDATE institucional a profesores/estudiantes. API lo invoca tras fijar contexto; comparte orden con membresías, invitaciones y archivo de IMP-01.

Lecturas permiten contexto vacío para resolver organización desde ID; con contexto fijado no cruzan organización. Escrituras lo exigen. Curso/profesor se concede por ADMIN; crear clase docente deriva el profesor de la cuenta autorizada por curso. Revocar concesión no revoca asignaciones anteriores. Cambios de rol/estado sí invalidan permiso en cada consulta.

`resolve_join_code(digest)` devuelve metadatos únicamente para estudiante ACTIVE de la misma institución y código vigente; una inscripción terminada impide preview y nueva incorporación. Inscripción requiere contexto `app.join_code_digest`; no crea pertenencia institucional. Un secreto nunca se guarda en respuestas idempotentes. La proyección de nombre docente exige que el perfil solicitado pertenezca a esa organización.

Una actividad publicada permanece consultable fuera de ventana o CLOSED. El editor opera solamente PUBLISHED y `opens_at <= ahora < closes_at`, cuando existan límites. Clase archivada conserva lectura autorizada, impide operaciones y exige ausencia de publicaciones abiertas. Conceptos y ejercicios archivados no admiten referencias nuevas; las existentes continúan consultables.

La validación de pruebas comprueba formato, entradas iguales con resultados contradictorios y contrato determinista; no demuestra corrección pedagógica de cualquier enunciado. Referencia correcta/incorrecta del corpus canónico se ensaya aparte; la validación universal de autoría propuesta en specs/13 queda para IMP-03.

Los argumentos y resultados esperados se almacenan como `json`, conservando los bytes de `JSON.stringify` enviados por la API, con máximo 65536 por valor. El límite no se mide sobre la salida de `jsonb`, que agrega espacios y expande exponentes numéricos. La comprobación de contradicciones convierte a `jsonb` solamente para comparar valores: ignora orden de claves y notación numérica. El código usa `octet_length` con el mismo límite UTF-8 de 65536 bytes del contrato.

## Verificación prevista

pgTAP sobre rol limitado: aislamiento entre organizaciones y clases; profesor sin concesión; estudiante sin inscripción; privado/oculto; inmutabilidad; ciclos; archivo; publicación inválida y contexto. Instalación y actualización de migración se coordinan con el responsable principal; no se aplican migraciones remotas.

## Resultado local ejecutado

Resultado final del 23/09/2026: la CI completa reconstruyó TEST, comprobó la actualización desde IMP-01 y aprobó 122/122 pgTAP, 82/82 HTTP y 24/24 Cypress. El [registro de entrega](IMP-02-content.md) enlaza las evidencias finales y sus límites. Los párrafos siguientes conservan las etapas de verificación anteriores; `database.json` documenta las 110 comprobaciones iniciales, no el total final.

La CLI Supabase 2.101.0 generó `20260923193112_academic_content.sql` mediante `migration new`. El 23/09/2026 se aplicaron todas las migraciones en la base TEST separada, con Node 24.21.0, Docker 29.7.2 y Compose 5.3.1. Las 110 comprobaciones pgTAP aprobaron: 65 institucionales existentes y 45 académicas. Los dos oráculos globales de fundación se acotaron a sus ocho tablas institucionales; la suite académica comprueba expresamente las trece tablas nuevas con RLS forzada y que únicamente el conjunto de ejercicios DRAFT admite DELETE.

El seed académico se ejecutó dos veces y conservó 2 organizaciones, 2 administradores, 2 profesores, 8 estudiantes, 3 clases y 10 ejercicios. Los seis documentos permanecen fuera de este incremento. Evidencia saneada: `.local/reports/imp-02/database.json`. No se modificó ni detuvo el entorno de desarrollo; TEST terminó detenido y liberó su bloqueo. Integración HTTP, Cypress y aceptación humana se registran por separado.

Las pruebas verifican también recuperación de inscripción con la clave original después de rotar el código: `enrollment_replay` solo observa una operación propia y membresía vigente, mientras el código revocado sigue rechazando inscripciones nuevas. Las versiones de ejercicio conservan `created_transaction` interno, fijado por trigger, para impedir añadir tests o conceptos a cualquier versión de una transacción anterior, incluso cuando ya no es la versión actual. Este campo no forma parte del DTO.

La revisión posterior agregó doce comprobaciones académicas (57 en total): inscripción terminada, proyección de nombres entre organizaciones, creación con `INSERT RETURNING`, archivo de conceptos, límites JSON y contradicciones. La integración reanudada del 23/09/2026 aprobó **122/122 pgTAP** y **82/82 HTTP**, sobre la base TEST migrada, sin otro reset. Evidencia: `.local/reports/imp-02/integration-resumed.json` y `.local/resumed-integration-sql.log`. Un concepto archivado impide añadir su ejercicio a un borrador; conserva lectura y cierre de publicaciones previas. Las políticas de lectura de recursos nuevos utilizan columnas de la fila y permisos del padre; evitan consultar la misma fila mediante un helper STABLE, que todavía no la ve dentro del comando INSERT. La validación de contratos rechaza NUL y surrogados aislados antes de persistir.
