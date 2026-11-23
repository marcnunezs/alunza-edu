# Persistencia del detalle docente — IMP-06.03

Fecha: 27/10/2026. Concreción de RF/HU/CU/PT-017 y UX-11 sobre los núcleos
de [progreso y tablero](IMP-05-dashboard-dictionary.md),
[intentos](IMP-03-submissions.md) y [ayuda](IMP-04-help-dictionary.md).
Este diccionario describe contratos implementados; los resultados de ejecución,
la aceptación humana y las integraciones remotas se registran por separado.

## Alcance y autorización

Las rutas son GET bajo
`/api/v1/classes/:classId/students/:userId`. Usan al docente real de la sesión,
`DatabaseService.readAs`, respuestas `{data,requestId}` y `Cache-Control: no-store`.
No amplían las rutas del alumno ni registran apertura de actividad, presentación
de ayuda, entrega de pista o revisión de señal.

`student_detail_context` compone la autorización existente de `dashboard_context`
con `dashboard_roster`: docente asignado a esa clase, perfil/membresía/sesión
vigentes; estudiante actualmente inscrito, perfil ACTIVE y membresía STUDENT
ACTIVE de la misma organización. El padrón se identifica como `CURRENT_ACTIVE`,
también cuando el corte solicitado es pasado. El archivo de clase permite la
consulta histórica docente existente; no restaura ayuda que perdió disponibilidad.
Una organización archivada, ADMIN sin rol docente, estudiante retirado o permiso
revocado no reciben acceso integral. Las señales históricas fuera del padrón
conservan exclusivamente la consulta de clase ya autorizada en IMP-05.

Todos los IDs hijos se resuelven dentro de clase, estudiante y organización.
`RESOURCE_NOT_FOUND` evita revelar existencia en ámbitos ajenos. Un parámetro
de consulta no puede cambiar el estudiante del path. Los errores de filtros,
cursores y períodos se distinguen del resultado válido sin evidencia.

## Funciones y proyecciones

La migración `20261027182430_student_detail.sql` no crea tablas, columnas ni
índices, no reescribe filas y no hace backfill. Añade ocho funciones públicas
para el rol de la API; todas son `STABLE SECURITY DEFINER`, con
`search_path=pg_catalog` y propietario `alunza_identity` sin LOGIN ni BYPASSRLS.
Los kernels son privados y no se conceden a `alunza_app`. PUBLIC, anon,
authenticated y service_role no pueden invocar estas funciones. Se conservan
RLS forzada y los grants previos: no se añade lectura general docente de intentos,
ayudas ni resultados internos.

| Sufijo GET                                         | Función `app_private`                                          | Proyección                                                                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `/progress`                                        | `student_detail_progress(cls,student,options)`                 | Contexto, identidad mínima y padrón; progreso canónico, desgloses, evidencia de completitud, última actividad y observación paginada. |
| `/evidence`                                        | `student_detail_evidence(cls,student,options)`                 | Evidencia ATTEMPT/COMPLETION/EVENT/HINT con el estudiante impuesto por el servidor.                                                   |
| `/attempts/:attemptId`                             | `student_detail_attempt(cls,student,attempt,options)`          | Intento canónico exacto, código y definición pública de la versión fija.                                                              |
| `/attempts/:attemptId/feedback`                    | `student_detail_feedback_history(cls,student,attempt,options)` | Historial paginado exclusivamente entregado/visto al corte.                                                                           |
| `/feedback/:feedbackId`                            | `student_detail_feedback(cls,student,feedback,options)`        | Metadatos de entrega y ayuda persistida actualmente disponible.                                                                       |
| `/feedback/:feedbackId/sources/:chunkId[/content]` | `student_detail_reference(cls,student,feedback,chunk,options)` | Cita exacta de esa ayuda y versión original, reautorizada.                                                                            |
| `/signals`                                         | `student_detail_signals(cls,student,options)`                  | Episodios y procesamiento exclusivamente del estudiante.                                                                              |
| `/signals/:signalId`                               | `student_detail_signal(cls,student,signal,options)`            | Regla, causa, fechas y evidencia del episodio autorizado.                                                                             |

Los IDs son UUID, `options` es JSONB y las ocho funciones devuelven JSONB.
La autoridad ejecutable del DTO es `packages/contracts/src/student-detail.ts`.

`progress_payload`, `progress_observations`, `dashboard_attempts`,
`dashboard_events`, `dashboard_observation_summary` y `dashboard_evidence_body`
mantienen sus fórmulas y elegibilidad. `attempt_payload` conserva el código y
resultado confirmado, incluidos seis diagnósticos, pruebas visibles y el único
resumen público oculto `hiddenChecksPassed`. El enunciado, conceptos y pruebas
se obtienen desde `attempt.exercise_version_id`, nunca desde la versión actual
del banco. Las pruebas se filtran por `visibility='visible'` dentro de SQL;
no se entrega `attempt_results`, expectativas ocultas ni el DTO de autoría.

## Tiempo, paginación y señales

`from <= asOf <= hora del servidor`, UTC con precisión de hasta seis decimales.
Sin `asOf`, el servidor resuelve un corte por consulta; las páginas posteriores
envían ese corte. Cada respuesta incluye `observedAt` y vuelve a autorizar.
`from` limita observación; no borra completitud ni última actividad anterior.
COMPLETION conserva el primer éxito; las señales no aceptan `from`.

Las páginas de evidencia conservan límite predeterminado 50 y máximo 100.
La ayuda usa límite predeterminado/máximo 20 y orden descendente por entrega/ID.
Los cursores enlazan actor, clase, estudiante, filtros, corte, recurso y clave
estable. Un cursor de otro estudiante o intento no puede reutilizarse.
Un corte no promete congelar commits tardíos ni recuperar permisos históricos.

`dashboard_processing_scoped(cls,student,activity,concept,cut)` comparte el
cálculo vigente de frescura, acuses y vectores. Filtra el padrón antes de crear
los carriles esperados, por lo que un trabajo fallido de otro alumno no altera
el estado individual. `dashboard_signals_scoped(class,student,options)` filtra
`lane.student_id` antes de ordenar/paginar. Ambos aceptan estudiante NULL como
ámbito de clase. Los wrappers originales `dashboard_processing` y
`dashboard_signals` conservan firmas, payloads y contexto de cursor previos.
Ninguna consulta evalúa reglas, publica episodios ni realiza RF-019.

## Ayuda entregada y referencias

Decisión explícita del usuario para este incremento: el profesor consulta
**solo ayudas entregadas/vistas**. La autoridad es un evento persistido
`HINT_DELIVERED` o `FEEDBACK_VIEWED` del mismo feedback/solicitud/intento,
ocurrido hasta `asOf`. La generación, reserva o `presented_at` sin ACK no basta.
La misma regla se aplica al listado, acceso por ID, fragmento y descarga.

El historial conserva `id`, `attemptId`, `kind`, `hintLevel`, `status`,
`createdAt`, `deliveredAt` y `available`. El detalle añade `help` con los cinco
campos RAG existentes. No devuelve `presentationToken`, capacidades de solicitud,
prompts, recibos de proveedor ni entradas privadas. Consultar no invoca IA,
no consume niveles y no crea eventos de lectura del estudiante.

`student_detail_feedback_value` comprueba entrega y disponibilidad sin escribir.
Reutiliza `help_scope_valid` y respeta `suppressed_at`. Si la ayuda fue revocada,
conserva metadatos originales pero devuelve `available=false, help=null`, sin
texto de reemplazo ni citas; no llama `help_suppress` ni modifica la solicitud.
Una explicación entregada NO_EVIDENCE/PROVIDER_UNAVAILABLE conserva ese estado
y puede consultarse mientras siga autorizada; no representa una pista entregada.

Las citas se resuelven mediante `feedback_source_refs` y sus FK de procedencia,
sin aceptar una URL del modelo. El resultado SQL incluye exclusivamente dentro
de `reference` los campos internos `storageKey`, `mimeType`, `sizeBytes` y
`sha256`; el servicio los elimina del JSON público. La descarga verifica tamaño
y hash y repite la autorización docente, entrega y fuente después de Storage,
antes de enviar bytes. Una cita histórica no concede acceso permanente.

## Actualización y verificación

La API nueva requiere las funciones .03 para readiness; desplegar primero la
migración expansiva. La API anterior conserva sus funciones de clase y alumno.
Ante un defecto se prefiere avance correctivo, sin borrar hechos, ayudas,
auditoría ni episodios para reconstruirlos.

`supabase/tests/019_student_detail.test.sql` ejercita `alunza_app` con sesiones
ficticias, admisión/finalización canónica, preparación/presentación/ACK de ayuda,
permisos, paginación, resultado vacío, pruebas ocultas, fuente revocada,
procesamiento individual y comparación de hechos antes/después de lecturas.
Los recibos de proveedor SQL son sintéticos, no ejecución Azure.

`scripts/student-detail-upgrade.mjs` prepara la base .02 mediante rutas previas,
intentos Docker y ayuda TEST entregada/no vista. Comprueba readiness 503 antes
de migrar y 200 después; compara cantidades/digests de ejercicios, intentos,
ayuda, eventos, fuentes, señales y auditoría tanto tras la migración como tras
abrir las nuevas rutas y referencias. La reserva TEST y las suites HTTP/E2E
completan la verificación coordinada; este documento no anticipa resultados.

RF-019, auditoría/exportación operativa y aceptación integrada .04–.07 quedan
fuera de este incremento.
