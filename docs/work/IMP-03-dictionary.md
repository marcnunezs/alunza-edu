# Diccionario de RUN — IMP-03.01–03.03

Fecha: 2026-09-26. Revisión técnica previa a migración incremental. Implementación local autorizada; no acredita aceptación académica ni Sandbox productivo.

`app.executions` conserva admisiones operativas RUN, nunca intentos. UUID servidor; organización, clase, actividad, asignación, versión, estudiante y operación idempotente tienen referencias verificadas y no se pueden reasignar. Guarda hashes SHA-256 de código y suite visible, presupuesto fijo (134217728 bytes/3000 ms/65536 bytes), versión del runner, fechas servidor, total visible, estado `RUNNING/RECOVERING/COMPLETED`, lease de 60 segundos y token de exclusión. No guarda código fuente, expectativas ni pruebas ocultas. Un resultado terminal es una proyección pública estricta; la respuesta vence 24 horas después de la admisión. Después permanecen el contexto, los hashes y el vínculo idempotente, sin respuesta.

La admisión toma el mismo bloqueo de organización que el cierre académico, comprueba sesión/perfil/membresía/inscripción, clase activa, PUBLISHED y ventana `[opensAt, closesAt)`. Una admisión anterior al cierre termina después; toda entrega y repetición comprueba permiso vigente. Las pruebas se obtienen mediante RLS como estudiante y solo incluyen visibles. Versiones y asignaciones publicadas siguen siendo inmutables.

El archivo de organización rechaza `RUNNING/RECOVERING` con `DEPENDENCIES_ACTIVE`, incluso después de retirar membresías y recursos académicos. El `UPDATE` de archivo y la admisión serializan sobre la misma fila de organización: una reserva admitida impide archivar; un archivo confirmado impide admisiones nuevas. Una reserva `COMPLETED` conserva evidencia sin bloquear el archivo.

`app.operation_keys` se reutiliza con operación `practice.run`. Reserva y admisión comparten commit; ejecución externa ocurre sin transacción; finalización y respuesta idempotente comparten otro commit. Misma clave/payload recupera el mismo resultado, distinta carga entra en conflicto, en curso responde 409, vencida responde `IDEMPOTENCY_EXPIRED` sin repetir. El resultado contiene fechas, IDs y `technicalResult`; nunca concede completitud.

Los cupos locales predeterminados son 1 ejecución activa por estudiante/organización, 4 por organización y 10 admisiones nuevas por minuto/estudiante/organización. La función de admisión serializa actor y organización; los cupos son parámetros de configuración del backend, nunca del HTTP público. Los replays no consumen cupo. Reservas sin limpieza confirmada siguen ocupando cupo aunque expire el lease.

Funciones privadas con propietario `alunza_identity` (NOLOGIN/NOBYPASSRLS), `search_path=pg_catalog` y EXECUTE solo `alunza_app` realizan admisión, finalización y recuperación limitada. Las políticas de ese helper no conceden acceso al navegador. `alunza_app` solo obtiene SELECT propio con sesión/inscripción actuales, sin INSERT/UPDATE/DELETE directo. La finalización exige executionId + token vigente y solo modifica esa reserva; permite conservar fallo operativo después de revocar permisos sin entregar datos al actor revocado. El reconciliador reclama únicamente leases vencidos, rota token, limpia Docker por executionId y cierra UNKNOWN sin reejecutar. Una limpieza no confirmada mantiene RECOVERING y bloquea liberación del cupo.

El SELECT del runtime excluye `lease_token` mediante privilegios por columna. Políticas restrictivas impiden insertar o actualizar claves `practice.run` directamente mediante la política institucional general; solo las funciones internas confirman reservas y respuestas. Finalización y reclamo exigen contexto sin actor/sesión; `NULL` no equivale a token válido ni a limpieza confirmada. Tipos, claves exactas, IDs exclusivamente visibles, contadores, diagnóstico, bytes y coherencia SUCCESS se validan nuevamente en SQL antes del commit. La entrega de la API revalida autorización aunque la persistencia interna ya haya cerrado la reserva.

El reconciliador funciona cada 15 segundos y al inicio en local/test incluso si se deshabilitan admisiones nuevas. No reejecuta fuente. La purga propia retira respuestas vencidas de ejecuciones y claves, sin depender del trabajador de invitaciones. El adaptador no añade un segundo plazo de limpieza a una ejecución ya cerrada: el límite operativo de 30 segundos y los 10 segundos de limpieza comparten una envolvente de 40 segundos.

La pérdida de respuesta de `create` no convierte una ausencia inmediata en limpieza confirmada. Una migración incremental preserva `lease_until >= admitted_at + 60 segundos` al escribir `RECOVERING`; el mínimo se fija a la admisión y no se prorroga indefinidamente. El runner conserva una barrera temporal ante creaciones inciertas y el reconciliador barre cápsulas propias vencidas antes de consultar la base de datos o reclamar reservas. Ese barrido encuentra apariciones tardías aunque la ejecución ya esté `COMPLETED`, también con admisiones deshabilitadas o una caída de persistencia. Solo elimina nombres y etiquetas propios; un fallo de barrido retiene la recuperación para el siguiente ciclo.

La migración de recuperación también corrige reservas `RECOVERING` anteriores únicamente si su lease es menor que el piso de admisión y ese piso todavía está en el futuro. Conserva el token y todos los demás campos; no extiende pisos vencidos y una repetición no modifica filas adicionales.

La consola del motor conserva bytes NUL en su frontera confiable. La proyección HTTP/persistente reemplaza cada NUL por `?`, de un byte, porque PostgreSQL JSONB no admite NUL. El saneo no expande ni elude el presupuesto de salida; la validación compartida y SQL comprueban nuevamente los bytes publicados.

La migración agrega FKs y comprobación de contexto, índices por actor/organización/lease/fecha, RLS FORCE y tombstones. Su aplicación en DEV está registrada en `IMP-03-practice.md`; no borra ni reinicializa datos y no repite el seed. No modifica evidencias Office, intentos, progreso ni RAG.

Verificación ejecutada el 26/09/2026: integración completa en TEST pasó 6 suites con 96 pruebas y 171 aserciones SQL; dentro de ellas, RUN aportó 14 pruebas HTTP y 49 aserciones de `006_practice_runs.test.sql`. Las pruebas focales de servicio/reconciliación pasaron 11 casos. La regresión real confirmó consola NUL saneada, los seis diagnósticos, cierre y revocación durante RUN, fallo real de commit, recuperación, idempotencia y aislamiento. El registro global está en `IMP-03-practice.md`. Estos resultados no acreditan Sandbox productivo ni aceptación académica.

Después de esa integración, la migración incremental `20260926195206_practice_archive_guard.sql` se aplicó en TEST y la suite focal SQL pasó 53 aserciones: incluye cuatro nuevas que verifican archivo con RUN activo, recuperación pendiente, finalización tras revocación y archivo permitido después de finalizar. No se repitió toda la integración HTTP por este cambio acotado; los informes locales conservan ambas ejecuciones por separado.

La protección posterior ante `create` incierto pasó 15 pruebas unitarias del servicio/reconciliador, 55 aserciones SQL y 15 pruebas HTTP reales. La prueba nueva crea una cápsula vencida después de completar RUN y verifica que el barrido la elimina sin cambiar el replay. El informe separado es `.local/reports/imp-03/recovery-sql-http.json`. La suite SQL final, con cuatro comprobaciones adicionales del backfill, pasó 59 aserciones; se conserva en `recovery-backfill-sql.json`.

La integración completa dentro de `npm run ci:verify` volvió a ejecutarse con las
tres migraciones y el runner `imp-03-quickjs.3`: 97/97 pruebas HTTP y 181 aserciones
SQL en seis archivos aprobadas, con limpieza completada. El informe del
26/09/2026 es `.local/reports/imp-03/integration.json`. Incluye los 15 casos HTTP
de práctica y las 59 aserciones de su suite SQL; no sustituye los registros
anteriores ni acredita una integración remota.
