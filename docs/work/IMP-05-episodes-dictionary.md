# IMP-05.05 — Diccionario incremental y recuperación

Implementación local del laboratorio. El estado de verificación y los resultados reales están en [el registro del incremento](IMP-05-episodes.md). DEC-005 conserva la fórmula, los parámetros y los estados; este documento describe su persistencia y operación.

## Identidad y registros

Todo el modelo operacional vive en `app_private`, con RLS habilitada y forzada. `alunza_app` accede mediante funciones explícitas, sin privilegios directos sobre los ledgers ni `BYPASSRLS`. El propietario de las funciones es el rol limitado existente `alunza_identity`; el rol de aplicación no puede asumirlo.

| Registro                                            | Responsabilidad                                                                                                                                                             |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signal_runtime`                                    | Corte inicial T0 real de instalación; no deriva cobertura del nombre de migración.                                                                                          |
| `signal_lanes`                                      | Organización, clase, estudiante, actividad y tipo; asignación adicional para repetición/estancamiento. La versión de ejercicio no fragmenta la secuencia.                   |
| `signal_input_changes`                              | UUID de cambio, componente, ámbito, transacción y valores mínimos de disponibilidad antes/después. La secuencia no certifica commits.                                       |
| `signal_evidence_clocks`                            | Época y revisión por componente; cierre transaccional diferido en orden canónico.                                                                                           |
| `signal_capture_registry`, `signal_coverage_epochs` | Definiciones verificadas y continuidad real de apertura, RUN, ATTEMPT y HELP. Un hueco conserva evidencia de discontinuidad.                                                |
| `signal_jobs`                                       | Lease/token, intentos técnicos, checkpoint, prefijo empatado, continuación, interrupción pendiente de reconciliación y deadline decimal. Control separado de los episodios. |
| `signal_snapshots`                                  | Vector, referencias/digests, corte y metadatos reproducibles. El resultado técnico se rehidrata desde el intento canónico.                                                  |
| `signal_evaluations`                                | Resultado inmutable, versión, frontera, snapshot y vínculo de reconciliación; una nueva revisión no sobrescribe la anterior.                                                |
| `signal_episodes`                                   | Identidad, primer testigo, causa/evidencia inicial, fechas, antecedente y estado `ACTIVE`/`REVIEWED`. El fin de acumulación es metadato interno.                            |
| `signal_witnesses`                                  | Asociación inmutable de testigo, regla y episodio. Repetir un testigo no lo mueve ni reactiva el episodio.                                                                  |
| `signal_episode_evaluations`                        | Evaluaciones vinculadas al episodio, dentro del mismo carril.                                                                                                               |
| `signal_reviews`                                    | Primer revisor/fecha y base inmutable de evidencia; soporte interno para una futura acción docente.                                                                         |
| `signal_change_acks`, `signal_finalize_receipts`    | Reconocimiento por UUID y replay atómico. El recibo conserva el checkpoint recibido y el control resultante, también en páginas sin evaluaciones nuevas.                    |
| `signal_projections`, `signal_rebuild_receipts`     | Proyección derivada reparable y recibo de reconstrucción. Nunca sustituyen los hechos canónicos.                                                                            |

Las referencias entre carriles se restringen mediante claves compuestas y validaciones. La cadena de antecedentes exige un episodio anterior del mismo carril; no puede formar un ciclo. Las restricciones de unicidad impiden dos acumulaciones abiertas y duplicados de testigos/evaluaciones.

El instante de cumplimiento denominado `matchedAt` en el plan se conserva como `qualified_at` en SQL y `qualifiedAt` en la proyección interna. `calculatedAt` conserva la fecha del cálculo inicial; una reconciliación no sustituye esas fechas ni la causa inicial.

## Captura y consistencia

Los productores existentes conservan sus transacciones y contratos. Se observan apertura explícita, RUN terminado, SUBMIT confirmado, entrega/lectura elegible de ayuda, disponibilidad, pertenencias y reglas. Polling, replay de transporte y ayuda fallida sin lectura no crean actividad elegible nueva.

Cada cambio afectado registra una invalidación en la misma transacción. Un trigger diferido publica una revisión por componente al terminar; una guarda rechaza DML de dominio posterior a un cierre anticipado. El worker toma bloqueos compartidos del vector, después lee las fuentes en una nueva sentencia `READ COMMITTED`. No toma bloqueos de fila sobre el dominio ni un bloqueo exclusivo de organización.

La verificación de cobertura termina en una transacción anterior a la captura. El cálculo puro ocurre fuera de la transacción; la confirmación vuelve a comprobar revisión, disponibilidad, regla y token. Un conflicto descarta el efecto operacional y vuelve a capturar. Reconocer UUID individuales permite detectar una transacción confirmada tarde aunque sus fechas o secuencias sean anteriores.

Un event trigger registra cambios DDL que interrumpen la captura, incluso con el worker apagado: cierra conservadoramente la época en `verified_through`; restaurar la definición aprobada abre otra época `CAPTURE_RESTORED`. El vector incluye la atestación de épocas. Para confirmar, se toman bloqueos `ACCESS SHARE` sobre las relaciones fuente y compartidos sobre registro/épocas, antes de volver a comparar el vector. Estos bloqueos no son bloqueos de fila del dominio.

El perfil técnico procede de resultados, reservas y versión del ejercicio persistidos: runner, schema, límites, hash y lista visible completa. No se reconstruye una suite a partir de una ejecución parcial. Señales, snapshots y logs no duplican código, consola, argumentos ni expectativas ocultas.

## Worker y tiempo

`SIGNALS_WORKER_ENABLED=false` es el valor predeterminado. Cuando se habilita, el worker NestJS usa PostgreSQL: polling de 1 segundo, máximo 100 fronteras evaluadas por lote, lease de 30 segundos y renovación cada 10. `SKIP LOCKED` permite reclamar carriles independientes; cada reclamación tiene un token nuevo.

Un lote puede avanzar sin producir evaluaciones nuevas. La continuación conserva revisión, corte fijo, última frontera, significado y deadline. Cambiar la revisión obliga a reconciliar con la entrada nueva. La evidencia completa sigue disponible para seleccionar los últimos N; el tamaño del lote no limita N.

UTC mantiene seis decimales. La aritmética usa `BigInt` y los deadlines se guardan en `numeric(30,0)`: inactividad en el extremo exacto, repetición un microsegundo después del extremo inclusivo y estancamiento sin caducidad temporal. Los SUBMIT empatados usan su secuencia persistida y su frontera de procesamiento. Los otros ledgers no reciben un orden global ficticio. Un retroceso de reloj suspende el avance afectado y se registra como `CLOCK_REGRESSION`.

Cinco fallos técnicos permiten cuatro esperas: 1, 5, 15 y 60 segundos. El quinto conserva el trabajo en `FAILED`. Los conflictos de revisión no son resultados pedagógicos ni consumen ese presupuesto. La reanudación explícita usa la operación interna `SignalsRepository.resumeFailed(laneId)` / `signal_resume_job(uuid)` después de corregir la causa; no hay ruta HTTP para ella.

## Tres operaciones distintas

1. **Recuperación operacional:** reanuda una continuación válida; ante una revisión nueva vuelve a recorrer desde T0 conservando el corte operacional que impide publicar historia pasada. Separa episodios aunque una mejora intermedia ocurriera durante la caída.
2. **Reconciliación:** incorpora commits tardíos al ledger, con `reconciliation_of`, sin reasignar vínculos ni retroceder el checkpoint. Una interrupción histórica posterior al ancla del episodio deja `pending_reconciliation_break`; la primera evaluación publicable cierra su acumulación con `RECONCILIATION_INTERRUPTION`, sin retrofecharla. Puede forzarse una frontera `CURRENT` con el mismo testigo para materializar ese corte.
3. **Reconstrucción histórica:** rehidrata snapshots originales, comprueba digests y reproduce los resultados con los mismos evaluadores. Una discrepancia detiene la reparación; solo se escriben proyecciones y recibos derivados.

El replay conserva revisión y causa inicial. Evidencia nueva se distingue por pertenencia a la base revisada, no únicamente por fecha. Cambiar la versión de regla corta la acumulación previa y permite un episodio con la nueva regla, indicando ese cambio.

El corte `asOf` de reconstrucción limita la reparación a episodios cuya historia completa —evaluaciones, revisión y cierre— está incluida en él. Las proyecciones con historia posterior permanecen intactas y se contabilizan en `excludedAfterCut`. Los recibos de finalización preservan el estado para reconstruir el control; este comando no reconstruye trabajos ni modifica su checkpoint.

## Comandos y procedimiento local

Compilar antes de usar mantenimiento: `npm run build -w @alunza/api` con los paquetes del workspace ya compilados, o el build normal del repositorio. El comando de mantenimiento no inicia HTTP, runner ni otros workers.

```powershell
npm run signals:rebuild -- plan --target test --organization <UUID> --class <UUID> --student <UUID> --activity <UUID> --as-of 2026-10-25T20:00:00.000000Z
npm run signals:rebuild -- check --target test --organization <UUID> --class <UUID> --student <UUID> --activity <UUID> --as-of 2026-10-25T20:00:00.000000Z
npm run signals:rebuild -- rebuild --target test --organization <UUID> --class <UUID> --student <UUID> --activity <UUID> --as-of 2026-10-25T20:00:00.000000Z
npm run signals:rebuild -- report --target test --organization <UUID> --class <UUID> --student <UUID> --activity <UUID> --as-of 2026-10-25T20:00:00.000000Z
```

Sustituir los UUID por el ámbito real y el corte por un instante pasado. `plan` valida sin abrir conexiones; `check` reproduce cálculos y detecta diferencias; `rebuild` repara únicamente lo derivado; `report` muestra el estado operacional y sus métricas sin reproducir cálculos. También se admite el destino `development` del laboratorio. Destinos externos, puertos del proyecto principal, ámbitos incompletos y cortes futuros se rechazan.

Para detener el procesamiento, desactivar el flag y apagar normalmente el proceso propio. Los hechos y su captura durable se conservan. Al volver a habilitarlo, los leases vencidos se reclaman con tokens nuevos y el trabajo pendiente continúa. Para un trabajo `FAILED`, inspeccionar primero el código seguro de error y corregir la causa; la reanudación interna es explícita. No borrar checkpoints, testigos, episodios ni migraciones para recuperar.

Las métricas no contienen código ni contenido de ayuda: backlog, demora, checkpoint, siguiente deadline, estado del trabajo, conflictos, fallos/reintentos y resultados no verificables. La lectura pedagógica interna exige docente asignado y permisos vigentes; ADMIN de reglas no obtiene esa lectura. El fixture de revisión no está concedido a `alunza_app` y no constituye RF-019 implementado.

Aceptación focal local: `node scripts/signals-integration.mjs`, dentro del runtime fijado. Reserva TEST, prepara una actualización con evidencia real, aplica la migración y ejecuta integración/pgTAP. La CI integral conserva su entrada `npm run ci:verify`, sus 17 pasos y los gates SUBMIT existentes. Los informes saneados IMP-05 se incluyen en el artefacto del workflow; logs privados y credenciales quedan fuera.

## Límites del incremento

Sin pantallas, endpoints públicos de señales, revisión docente, despliegue ni integración cloud. La lectura interna y el almacenamiento preparan los incrementos posteriores. Aprobar pruebas locales no acredita Linux, Azure OpenAI/Vercel Sandbox remotos, aceptación académica ni el cierre integral de RF-018.
