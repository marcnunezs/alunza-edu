# IMP-05.01–05.02 — Diccionario de eventos y progreso

Contrato incremental del 02/10/2026. Complementa los diccionarios de SUBMIT y
ayuda; conserva sus hechos, versiones, permisos e idempotencia.

## Hechos y cobertura

`app_private.student_activity_observations` conserva exclusivamente nuevas
aperturas y finalizaciones RUN: identidad, secuencia, organización, clase,
actividad, estudiante, entidad/ejecución/asignación/versión cuando corresponda,
instante del servidor, schema 1 y clasificación operativa. Es append-only y no
contiene código, salidas, tests ni respuestas del modelo.

Una apertura tiene unicidad permanente por estudiante/actividad/clave. Repetir
la solicitud devuelve el mismo ID/fecha tras reautorizar; una nueva apertura
intencional usa otra clave. Una finalización RUN tiene unicidad por ejecución y
se registra en la misma transacción que su transición COMPLETED, antes de purgar
la respuesta temporal. Infraestructura FAILED conserva un hecho operativo, pero
no acredita EXECUTION_COMPLETED elegible.

`student_event_coverage` registra el instante real de aplicación de la migración
para ACTIVITY_OPEN y RUN. No se fabrican aperturas ni resultados purgados. Los
eventos existentes de SUBMIT y ayuda no se copian a esta tabla.

La cobertura se identifica por la instalación del capturador y su contrato:

| Evento                                            | Inicio de la fuente durable                                                                                                                                                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLASS_JOINED                                      | Inscripción con `enrolled_at` del [contrato académico](../../supabase/migrations/20260923193112_academic_content.sql), con API de inscripción compatible.                                                            |
| ATTEMPT_SUBMITTED y EXECUTION_COMPLETED de SUBMIT | Confirmación transaccional del [ledger de intentos](../../supabase/migrations/20260926215711_practice_submissions.sql), con el capturador SUBMIT instalado.                                                          |
| HINT_DELIVERED y FEEDBACK_VIEWED                  | ACK autenticado del [ledger de ayuda](../../supabase/migrations/20260927182613_contextual_help.sql), con la API de presentación instalada.                                                                           |
| ACTIVITY_OPENED y EXECUTION_COMPLETED de RUN      | `student_event_coverage.starts_at` registrado al instalar la [migración de este corte](../../supabase/migrations/20261002203857_student_progress_events.sql); apertura mediante la nueva API y RUN mediante trigger. |

El timestamp del nombre de una migración identifica su versión, no la fecha de
despliegue de un destino. Para las fuentes anteriores se conservan los hechos
realmente persistidos y se consulta el historial de instalación/release del
ambiente; los seeds ficticios no acreditan actividad real ni cobertura previa.
No se infiere una apertura a partir de un GET ni una finalización RUN a partir
de una respuesta purgada.

`student_activity_events` es un contrato SQL interno, schema 1, con fuente/ID,
entidad, ámbito, fecha, deduplicación, clasificación y elegibilidad. Combina las
inscripciones, attempt_events, help_events y observaciones nuevas. Solo el rol
interno puede consultarlo; no existe una API pública de evidencia entre alumnos.

| Evento              | Origen y elegibilidad acordada                                                              |
| ------------------- | ------------------------------------------------------------------------------------------- |
| CLASS_JOINED        | ID/enrolled_at de inscripción; referencia de clase, sin atribuirla a todas las actividades. |
| ACTIVITY_OPENED     | Apertura explícita autenticada; no GET, preload, polling ni refresco técnico.               |
| EXECUTION_COMPLETED | RUN o SUBMIT con infraestructura OK; fallo operativo no elegible.                           |
| ATTEMPT_SUBMITTED   | Intento confirmado; una reserva o repetición de transporte no crea otro hecho.              |
| HINT_DELIVERED      | ACK de pista realmente concedida; una pista fallida no cuenta.                              |
| FEEDBACK_VIEWED     | ACK explícito de explicación, incluidos NO_EVIDENCE, PROVIDER_UNAVAILABLE y UNKNOWN.        |

HELP_REQUESTED se conserva en su ledger, pero no es elegible. Lectura repetida
del mismo feedback respeta la deduplicación previa. El orden de cálculo de
intentos es submitted_at ASC y ATTEMPT_SUBMITTED.event_sequence ASC; el historial
mantiene attemptNumber como orden de admisión.

## Cálculo común

`student_progress(class, activity?, concept?, cutoff?)`, SECURITY INVOKER, aplica
RLS y permisos actuales. El estudiante siempre se deriva del contexto de sesión.
Los filtros ajenos/no autorizados no revelan existencia; un concepto autorizado
sin asignaciones produce 0/0.

R son las asignaciones requeridas publicadas hasta el corte, con sus versiones
fijas. C son las de R con un intento confirmado hasta el corte cuyo resultado
canónico allRequiredPassed es true. La evidencia elegida es el primer éxito por
fecha de confirmación y secuencia. RUN, reservas, UNKNOWN y fallos ocultos no
completan; un fallo posterior no elimina un éxito anterior.

Los conceptos provienen de exercise_version_concepts/concept_versions de la
versión publicada. Cada asignación cuenta una vez por concepto; se conservan los
IDs de versiones históricas. El nombre del grupo corresponde a la versión más
reciente entre las versiones realmente asignadas, no al puntero vigente del banco.
Los porcentajes conceptuales no se suman como total de clase.

published_at <= cutoff y submitted_at <= cutoff son inclusivos. Sin cutoff se
usa statement_timestamp; el futuro se rechaza. La autorización es actual aun
cuando el corte sea histórico. CLOSED conserva el acceso permitido por DEC-002;
opensAt no cambia la lectura del progreso publicado.

Una misma consulta y snapshot produce resumen, grupos y evidencia. No hay caché,
proyección persistida ni fórmula alternativa. practice_activity_progress sigue
devolviendo su forma original como wrapper del cálculo común.

Los joins se acotan explícitamente por organización, clase y asignación para
aprovechar los índices existentes, además de conservar RLS. Las asociaciones
conceptuales autorizadas se leen una vez por versión asignada y se reutilizan
dentro de la misma consulta mediante CTEs materializados; no son tablas agregadas
ni evidencia persistida adicional.

## API pública

- GET /api/v1/me/progress: classId obligatorio; activityId, conceptId y asOf
  opcionales. No admite studentId/organizationId ni otros campos extra.
- Respuesta: classId, filters, asOf, summary, byActivity, byConcept, evidence.
  Los contadores son completed/required/ratio/evidenceState/basisAttemptIds;
  evidence contiene actividad, asignación, versión, intento y submittedAt.
- ratio es null para 0/0. NO_ATTEMPTS se refiere a intentos del ámbito filtrado;
  un intento opcional puede producir HAS_EVIDENCE, sin incrementar requeridos.
- asOf acepta zona/offset y conserva precisión submilisegundo al normalizar UTC.
  Las fechas sin zona y payloads inválidos reciben 422; un corte futuro recibe
  400 INVALID_REQUEST.
- POST /api/v1/activities/{id}/open-events: cuerpo estricto {}, Idempotency-Key
  vigente en la forma estándar del proyecto; 201 con eventId/activityId/occurredAt.
- Respuestas privadas no-store. ADMIN y TEACHER no reciben progreso personal
  estudiantil mediante estas rutas; solo STUDENT ACTIVE con matrícula vigente.

Las funciones privilegiadas de captura tienen search_path fijo, owner limitado,
grants mínimos y revalidación de actor/ámbito. Las tablas privadas no se exponen
a anon/authenticated/service_role/alunza_app. El helper de orden solo devuelve
la secuencia de un intento propio actualmente autorizado.

## Decisiones y compatibilidad

DEC-005 queda resuelta parcialmente por la instrucción del usuario: eventos,
fallback leído, orden y corte de progreso. Ventanas, firma de error,
comparabilidad, estancamiento y episodios siguen como propuestas. No se crean
reglas, señales, revisión ni tablero docente en este corte.

La migración es aditiva. Para actualizar un ambiente local autorizado se utiliza
el procedimiento de migración existente; el historial de intentos/ayudas no se
reescribe. Una captura ausente anterior a la cobertura no es prueba concluyente
de inactividad. La aceptación académica y los servicios productivos siguen
separados de las pruebas locales.
