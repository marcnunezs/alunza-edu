# Diccionario de envíos — IMP-03.04–03.06

Fecha: 2026-09-26. Estado: implementado y verificado en TEST mediante SQL y HTTP.
Diccionario preparado y revisado técnicamente antes del DDL incremental;
implementación local autorizada por «implementa este plan». No acredita
aceptación académica ni despliegue remoto. La migración DEV posterior y su
recorrido se registran en [el trabajo del incremento](IMP-03-submissions.md).

## Entidades e invariantes

`app_private.submission_reservations` conserva una admisión SUBMIT privada.
Tiene UUID servidor, organización/clase/actividad/asignación/versión/estudiante,
operación idempotente única, código UTF-8 de hasta 65536 bytes, SHA-256 de código y
suite completa, límites fijos, versión de runner, contador visible, contador total,
fecha de admisión, número creciente por estudiante/asignación, intento anterior
opcional, estado RUNNING/RECOVERING/COMPLETED, token y vencimiento de lease,
evidencia normalizada durable y respuesta temporal. Ningún rol de navegador ni
`alunza_app` tiene SELECT directo de esta tabla. Sus referencias y código son
inmutables; solo se permite retirar el snapshot redundante después del plazo de
retención operativa. La reserva no es un intento ni completa ejercicios.

`app.attempts` conserva una sola confirmación por reserva: UUID de intento,
contexto completo, FK al envío, código, hashes/versiones, número de admisión,
admitted_at/submitted_at del servidor, previous_attempt_id opcional y resultado
canónico público estricto. Su unidad de consistencia incluye código, resultado,
eventos y vínculo/respuesta idempotente. No admite UPDATE/DELETE ni escritura
directa del runtime. El número de admisión ordena establemente la historia aunque
las respuestas concurrentes lleguen invertidas. La FK compuesta de intento
anterior exige la misma organización, estudiante, asignación y versión. Las
FK de clase/actividad/asignación y la validación de reserva comprueban el resto
del contexto; no hay cascadas destructivas.

`app_private.attempt_results` conserva por intento la evidencia privada canónica
`{id,passed}` de pruebas ocultas, runner_version, test_suite_hash y
result_schema_version `submission.v1`, con FK de organización/intento. No se purga
al vencer snapshots operativos y ninguna superficie pública puede leerla.

`app_private.attempt_events` conserva dos hechos deduplicados por intento y tipo:
ATTEMPT_SUBMITTED y EXECUTION_COMPLETED. Tiene UUID, secuencia global creciente,
ámbito completo, fecha servidor y versión `submission.v1`; no duplica código ni
pruebas ocultas. No activa señales ni reglas de IMP-05.

## Funciones y privilegios

La admisión `admit_practice_submit` serializa actor y organización, como RUN y
cierre. Comprueba autorización vigente, publicación, ventana `[opensAt,closesAt)`,
versión y reintento propio; deriva los hashes y la suite en DB. Admisiones previas
al cierre pueden terminar después (DEC-002). Mantiene 1 RUN y 2 SUBMIT activos por
actor/organización, 4 combinados por organización y 10 nuevas admisiones combinadas
por minuto/actor/organización. La versión incremental de RUN comparte los dos
últimos contadores. Replays no consumen cupo.

`load_practice_submit_suite` exige contexto interno sin actor/sesión y reserva
vigente con token válido; devuelve solo la suite asociada. No amplía `tests_read`
del estudiante. `stage_practice_submit_result` valida la evidencia pública y una
lista privada estricta `{id,passed}` de tests ocultos realmente ejecutados. Verifica IDs,
unicidad, visibilidad, conteos, cobertura completa de SUCCESS/FAILED_TEST y coherencia de hiddenChecksPassed y
allRequiredPassed; la lista no admite argumentos, expectativas ni consola oculta.
Conserva el primer resultado normalizado de modo inmutable antes de confirmar.

`finish_practice_submit` verifica el lease y limpieza, y confirma intento,
resultado público/privado canónico, eventos y respuesta en una transacción. Sin limpieza mantiene
RECOVERING, con piso de admisión de 60 segundos, y conserva la evidencia previa.
`claim_expired_practice_submit` rota el token y devuelve si existe evidencia
durable; la recuperación usa esa evidencia o un UNKNOWN operacional normalizado,
nunca reejecuta código. Finalizar no concede permiso de entrega: NestJS revalida
actor y sesión después del commit. Organizaciones y clases no pueden archivarse
con SUBMIT activos; las reservas no dependen de membresía vigente para finalizar.

Las funciones internas son SECURITY DEFINER en esquema privado, propietario
`alunza_identity` NOLOGIN/NOBYPASSRLS, con search_path fijo y grants mínimos.
`alunza_app` puede ejecutarlas; navegador, `authenticated`, `anon`, `service_role`
y PUBLIC no. El helper tiene políticas explícitas y todas las tablas fuerzan RLS.
Lectura de intentos y proyección usa SECURITY INVOKER y RLS, restringida al
estudiante propietario, organización, inscripción, perfil y sesión actuales.
ADMIN y TEACHER no reciben lectura pedagógica en este corte.

## Contrato público y proyección

Un intento contiene attemptId, executionId, activityId, assignmentId,
exerciseVersionId, testsVersion (SHA-256), attemptNumber, previousAttemptId,
admittedAt, submittedAt, code y technicalResult. El resultado añade únicamente
hiddenChecksPassed (`null` sin cobertura completa de ocultas) y allRequiredPassed
a los campos públicos RUN. La historia omite code, ordena attemptNumber DESC y
usa cursor entero positivo exclusivo, 10 elementos por defecto y máximo 20.
`read_practice_attempt` no encuentra filas ajenas; `list_practice_attempts` y
`practice_activity_progress` exigen actividad/asignación legible por estudiante.

La proyección única de avance cuenta asignaciones requeridas y las que tienen
algún intento confirmado de esa misma asignación/versión con allRequiredPassed.
Un fallo posterior conserva un éxito anterior. RUN, reservas y resultados
incompletos no suman. Devuelve ratio sin redondear, asOf y estados
NO_REQUIRED_EXERCISES (0/0, ratio null), NO_ATTEMPTS o HAS_EVIDENCE. No crea una
tabla agregada ni una definición paralela de completitud.

## Retención, actualización y verificación

Respuestas operativas y código redundante de reservas completadas vencen 24 horas
después de admisión; la purga acotada elimina esos snapshots y la evidencia privada
redundante. Reservas pendientes se conservan hasta limpieza/confirmación para no
perder recuperación. El vínculo/hash idempotente permanece: una clave expirada
jamás crea otro intento. Intentos y eventos no se purgan por este mecanismo.
DEC-009 mantiene pendiente la retención institucional para datos reales.

La migración es aditiva, mantiene migraciones previas, no altera Auth ni seed y
requiere avance correctivo para cambios de esquema con evidencia ya escrita.
La integración coordinada en TEST del 26/09/2026 pasó 110/110 pruebas HTTP y
285 aserciones pgTAP en siete archivos, con Supabase y Docker reales y limpieza
completada. `007_practice_submissions.test.sql` aporta 104 aserciones de reserva,
atomicidad, recuperación, cierre, cuotas combinadas, RLS negativa, secreto de
ocultas, inmutabilidad, retención y avance. El reporte es
`.local/reports/imp-03-submissions/integration.json`, registrado a las 23:19:32Z.
Los fallos previos de privilegios de reemplazo de funciones se corrigieron con
membresía/CREATE temporales y `SET ROLE` del propietario; se revocan al terminar
la migración. Esta evidencia corresponde a instalación y ejecución local TEST,
independiente de la aplicación de la migración en DEV, y no acredita Sandbox
productivo ni aceptación académica. La verificación de interfaz y el cierre integral se registran por
separado en el trabajo del incremento.

Se consultaron el changelog Supabase y sus guías actuales de funciones y RLS.
El aviso PostgreSQL 15.19/17.11 afecta ltree, btree_gist, cifrado PGP y operadores
personalizados; este cambio usa SHA-256 nativo, índices B-tree y ninguna de esas
capacidades. CLI fijada 2.101.0; creación de migración mediante `migration new`.
