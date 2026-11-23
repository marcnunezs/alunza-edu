# IMP-05.05 — Señales persistentes y recuperación

Fecha: 25/10/2026, hora de Santiago. Estado: **CERRADO LOCALMENTE EN TEST; CI COMPLETA .03/.04/.05 APROBADA, 17/17**.

El [diagnóstico y cierre SUBMIT](2026-10-25-submit-admission.md) conserva la
corrección, el candidato final y los tres gates consecutivos aprobados, sin
cambiar umbrales. Las corridas fallidas descritas abajo permanecen históricas.

## Alcance autorizado

Implementar el plan solicitado en este laboratorio: captura consistente, episodios/testigos/evaluaciones durables, recuperación, reconciliación y reconstrucción de proyecciones. Sin modificar el proyecto principal, pantallas, endpoints públicos, proveedores remotos ni acción docente de revisión. La semántica aprobada DEC-005 D1–D5 y los evaluadores de IMP-05.04 se conservan.

Trazabilidad: RF/HU/CU/PT-018 y soporte de 026; regresión 015; almacenamiento preparatorio de 019. RNF-IA-05, CON-02/04, SEG-01/05 y MAN-02/04. El cierre de este incremento no cierra el tablero, RF-019 ni la aceptación académica.

## Base observada

- HEAD inicial: `75708ceecf2ca755bd32fb4b04e77bcb8de310f4`, rama `laboratorio`, con cambios anteriores preservados.
- Inventario privado de fuentes existentes: `.local/evidence/imp-05-05/baseline.json`, 471 archivos, SHA-256 `9b785e592cb7e12bb0b822bed5455396eaebd3d8ae5a5471b4238091818ddd28`. Los archivos nuevos de este incremento se excluyen de esa base.
- Runtime portable existente Node 24.21.0. No se instalan dependencias nuevas.
- Foco inicial ejecutado: seis suites API de reglas/evaluadores, **260/260 PASS**, antes de cambiar esos módulos.
- No había lock de integración TEST al inspeccionar. Los servicios de desarrollo del laboratorio y del principal estaban activos y se conservan.

## Decisiones de implementación

Se reutiliza PostgreSQL para trabajos durables. Los productores escriben invalidaciones en su transacción; un cierre diferido actualiza revisiones por componente. Captura y finalización bloquean ese vector, sin bloquear filas del dominio desde el worker. Los cambios se reconocen por UUID, nunca por un máximo de secuencia.

Los snapshots conservan referencias/digests y metadatos necesarios; el resultado canónico se rehidrata para cálculo sin copiar código, consola ni pruebas ocultas. Los timestamps conservan microsegundos y los deadlines se expresan como enteros decimales exactos.

El worker queda apagado por defecto. Recuperación operacional, reconciliación de hechos confirmados tarde y reconstrucción histórica son operaciones distintas. La reconstrucción no abre alertas ni altera el checkpoint operativo. Bootstrap y cobertura no inventan historia anterior a su instalación comprobada.

## Verificación ejecutada durante implementación

| Comprobación                                                                     | Resultado observado                                                                                                                                                                |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base .03/.04, seis suites focales antes de cambios                               | 260/260 PASS.                                                                                                                                                                      |
| Nueve suites de reglas/evaluadores/motor/worker después de integración de código | 307/307 PASS; 39 casos del nuevo motor/tiempo y ocho del worker.                                                                                                                   |
| TypeScript API, ESLint de las rutas nuevas y modificadas                         | PASS tras corregir la conservación de causa en un error operacional.                                                                                                               |
| Formato global del repositorio                                                   | PASS.                                                                                                                                                                              |
| Primera instalación focal SQL                                                    | FAIL en bootstrap: permiso de `signal_capture_definition`; corregido el orden de owner/rol/bootstrap/revocación.                                                                   |
| Primera actualización focal con fixture                                          | FAIL de readiness anterior a .05: el harness no preparaba la credencial del rol de aplicación tras reset; corregido usando `migrate(ctx)` antes de arrancar la API previa.         |
| Siguiente preparación de actualización                                           | FAIL en aserción del fixture: tres SUBMIT producen seis eventos; corregida la expectativa.                                                                                         |
| Aplicación incremental de .05 sobre intentos/regla existentes                    | Migración aplicada; la verificación posterior falló por seleccionar dos carriles sin filtrar asignación. Filtro corregido; esta corrida no acredita todavía preservación completa. |

Las regresiones del motor se reprodujeron fallando antes de corregirlas:
reconciliación que suprimía el corte actual, continuación con lotes de una
frontera, SUBMIT empatado confirmado tarde, interrupción tardía con el mismo
testigo y elección del estado operacional por orden durable de evaluaciones.
Se añadió una continuación de revisión/corte para limitar a 100 las llamadas a
predicados sin recortar la evidencia lógica.

Las corridas focales usan `node scripts/signals-integration.mjs` con Node
24.21.0. Los fallos anteriores no se presentan como pruebas aprobadas. La
reanudación diagnóstica de TEST conservado sirve para depurar integración;
una nueva corrida completa de actualización debe acreditar el digest previo y
posterior. El [diccionario](IMP-05-episodes-dictionary.md) conserva comandos y
procedimiento operacional.

## Integración y actualización observadas

La actualización completa posterior desde .03 pasó: digest canónico idéntico,
tres intentos, una regla y una apertura preservados; T0 nuevo y cero episodios
anteriores. Informe: `signals-upgrade.json` del grupo IMP-05.

La primera integración real aprobó 16/17 casos; falló la precedencia SQL al
validar JSON de continuación. Después de corregirla, la repetición aprobó
17/17: productores reales, dos procesos, caída antes/después del commit,
revisión, reconstrucción, retroceso de reloj y reintentos.

pgTAP identificó seis fixtures que cerraban todas las restricciones antes de
continuar DML. Se conservan todas las aserciones y se validan explícitamente
las cuatro restricciones de dominio previas. La segunda corrida ejecutó 928
aserciones/13 archivos; falló únicamente la expectativa de ausencia de toda
membresía administrativa.

La inspección real de `pg_auth_members` confirmó una sola concesión de
`supabase_admin` a `postgres` sobre `alunza_identity`: `ADMIN=true`,
`INHERIT=false`, `SET=false`. Es el autogrant original de PostgreSQL/Supabase;
la prueba ahora verifica que no quedan permisos efectivos SET/USAGE ni una
concesión temporal de `postgres`. No se modificó ese permiso administrativo
original ni se redujeron las garantías de `alunza_app`.

El candidato final añade además una guarda contra vincular un testigo conocido
a otro episodio y conserva en el recibo inmutable el checkpoint y control
resultante, incluyendo páginas sin nuevas evaluaciones. Las aserciones de ese
recibo, cambio de regla y los ajustes pgTAP aprobaron en integración y en la
aceptación focal final.

## Correspondencia de aceptación

La suite SQL/API está en `tests/integration/zzzzzzzzzz-signals.test.cjs`;
el motor puro, en `apps/api/src/signals/signal-processing.spec.ts` y
`signal-time.spec.ts`; las garantías SQL, en
`supabase/tests/013_signal_episodes.test.sql`.

| Caso del plan                   | Evidencia implementada                                                                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Productores reales y cobertura  | Apertura explícita, RUN y SUBMIT HTTP/Docker; ayuda fallback `NO_EVIDENCE` y ACK; replay sin actividad nueva; T0 real y deshabilitación/restauración del capturador.              |
| Fronteras temporales            | Pruebas puras a −1/exacto/+1 µs, secuencias superiores a 2^53, int4 máximo y repetición inclusiva.                                                                                |
| Commit tardío y rollback        | Transacciones PostgreSQL con barreras; revisión nueva al mismo T; late SUBMIT mediante funciones reales de reserva/confirmación y resultado técnico tipado de fixture.            |
| Dos workers y token vencido     | Reclamaciones concurrentes, exclusión de token antiguo y dos procesos Node independientes.                                                                                        |
| Caídas antes/después del commit | Proceso hijo detenido mediante IPC tras snapshot o tras commit antes de responder; otro proceso recupera las mismas identidades.                                                  |
| Mejora intermedia, E17          | Motor puro y seis SUBMIT reales: dos episodios de estancamiento y uno de repetición, conservando la mejora intermedia.                                                            |
| Regla o disponibilidad          | Cambio de regla con los mismos intentos abre otro episodio enlazado; cambio de regla/membresía durante cálculo rechaza la confirmación obsoleta.                                  |
| REVIEWED, E23/E24               | Integración conserva primer actor, fecha y base; evidencia nueva crea otro episodio. E23/E24 específicos se verifican en el motor puro.                                           |
| Reconstrucción                  | CLI detecta corrupción derivada; reproduce snapshots; un resultado adulterado aborta antes de reparar; reparación conserva episodios, revisión y checkpoint.                      |
| Aislamiento e independencia IA  | RLS/ACL y lectura docente por ámbito; comparación del mismo snapshot real con transportes IA locales que fallan o devolverían ayuda alterada: resultados iguales y cero llamadas. |

La CLI tiene además 34 pruebas locales de validación de destino, ámbito, corte
y modos. El soporte concurrente de SIG-14 se verifica con dos
conexiones del mismo docente vigente: el fixture privado no autoriza a otro
docente de la clase. No es una acción pública de revisión ni aceptación de
RF-019. La prueba de independencia IA sustituye el transporte local por fallo
o respuesta alterada sobre el mismo snapshot; no acredita una caída real de
Azure. Ambas comprobaciones forman parte del caso de integración REVIEWED;
el primer harness manual preparado en `.local` no se ejecutó ni acredita
resultados adicionales.

## Primera CI detenida antes de completar

La corrida iniciada a las 20:42 UTC del 25/10/2026 se detuvo en el paso 12,
SUBMIT, a las 21:08 UTC. Pasaron formato, lint, tipos, 2086 pruebas unitarias,
runner, fixtures, integración (181 HTTP y 928 aserciones SQL) y RUN. El candidato
de fuentes era `f21e6af5584b3cffc8e2fe378f99969e361b77e6546214f00c4f605062535f1d`.

El gate rechazó `candidateUnchanged=false`: durante SUBMIT se editaron estos
documentos y el fingerprint existente incluye documentación. No fue un fallo
de latencia: 100 respuestas válidas, p95 secuencial 2878,19 ms y concurrente
4426,24 ms, inferiores a 5000 ms. Limpieza, imagen y entorno permanecieron
válidos. Se conserva esta corrida como **FAIL**, sin relajar ningún gate.

Antes de repetir la CI se incorporaron las comprobaciones explícitas de SIG-14
concurrente e independencia IA al caso REVIEWED. Las corridas posteriores
conservaron congelados todos los archivos, incluida documentación.

El foco del caso `SIG-14 y REVIEWED` pasó a las 21:10 UTC: **1/1**, con los
otros 16 casos excluidos únicamente por el patrón de esta corrida focal.
Reutilizó TEST conservado, sin reset/migración/build/pgTAP. Informe saneado:
`.local/reports/imp-05/sig14-integration-focus.json`. Las integraciones posteriores
y la aceptación focal final ejecutaron los 17 casos sin exclusiones.

## Candidato previo a la corrección SUBMIT y resultados reales

HEAD `75708ceecf2ca755bd32fb4b04e77bcb8de310f4`, rama `laboratorio`.
Huella SHA-256 de 498 archivos de fuentes:
`c32ccb10f0db6b9dd1713911160a5dc949279ae55c66b35dd53e34b701e485b0`.
Incluye cambios previos y archivos nuevos. Inventarios, status y diff privados
quedan en `.local/evidence/imp-05-05`; `ci-attempt-1` y `ci-attempt-2` conservan
los candidatos anteriores. Se excluyen de la huella de fuentes los generados
`apps/web/next-env.d.ts` y `packages/contracts/openapi.json`; las mediciones
SUBMIT conservan además su fingerprint completo. Los tres evaluadores .04
mantienen exactamente sus hashes iniciales.

Comandos ejecutados con Node portable 24.21.0 y el npm del mismo runtime:

| Comprobación                      | Comando                                                                             | Resultado                                                                                                                                                                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Controles estáticos y unidades    | `npm run ci:verify`, pasos 1–4                                                      | Formato, lint, tipos y **2086/2086** pruebas en seis grupos: PASS.                                                                                                                                                                      |
| Runner y fixtures                 | Pasos 5–9 de `npm run ci:verify`                                                    | Preparación, doctor, probe Docker, fixtures y preparación Cypress: PASS.                                                                                                                                                                |
| Integración completa              | `npm run test:integration` dentro de CI                                             | **181/181 HTTP y 928 aserciones SQL en 13 archivos: PASS**, incluido el caso concurrente SIG-14.                                                                                                                                        |
| Instalación vacía                 | Reset exclusivo TEST de los perfiles RUN/SUBMIT, con todas las migraciones actuales | Migraciones y preparación de fixtures: PASS; sin modificar migraciones anteriores.                                                                                                                                                      |
| Actualización .03 → .05 final     | `node scripts/signals-integration.mjs`                                              | PASS a las 22:34 UTC: tres intentos, una regla y una apertura preservados; digest anterior/posterior `66236617ecddf92d04e3230cb60ace861113d8f7c18ec0ad624a14a01bccc4c1`; T0 `2026-10-25T22:34:13.489925Z`, cero episodios retroactivos. |
| Aceptación focal final            | `node scripts/signals-integration.mjs`                                              | **17/17 integración y 928/928 pgTAP: PASS**, finalizada a las 22:36 UTC. TEST detenido, datos conservados.                                                                                                                              |
| Integración IA, por separado      | `npm run test:ai:integration`                                                       | **27/27 PASS** con pgvector local y proveedor sintético; sin Azure.                                                                                                                                                                     |
| Regresión navegador, por separado | `npm run test:e2e`                                                                  | **49/49 PASS**, cero fallos, pendientes u omitidos; recorridos existentes, sin nuevas pantallas .05.                                                                                                                                    |
| Evaluación de ayuda, por separado | `npm run test:help:evaluation`                                                      | PASS: 100/100 ayudas seriales y 100/100 concurrentes; 234 muestras, 763 recibos, tres reanudaciones y cobertura 43/43; cero llamadas externas.                                                                                          |

Las tres comprobaciones separadas se ejecutaron mediante
`.local/signals-ci-continuation.mjs`, conservando la huella antes/después.
`ci-continuation.json` declara `doesNotReplaceFailedCi=true`: no es una CI17
aprobada. La documentación de resultados se actualizó después de terminar
las comprobaciones, sin cambiar fuentes ejecutables.

## Bloqueo histórico de rendimiento conservado

Se ejecutaron tres intentos de CI; ninguno completó los 17 pasos. El primero
se detuvo por la edición documental ya descrita. Los dos siguientes se
detuvieron ante el gate SUBMIT original, con candidato/imagen/entorno estables
dentro de cada corrida, 100 respuestas válidas y limpieza confirmada.

| Corrida SUBMIT                         | p95 serial | p95 concurrencia 4 | Resultado                                 |
| -------------------------------------- | ---------: | -----------------: | ----------------------------------------- |
| Segundo intento CI, serie 1, 21:32 UTC | 2431,13 ms |         4223,50 ms | PASS                                      |
| Segundo intento CI, serie 2, 21:36 UTC | 1867,11 ms |         5199,50 ms | **FAIL**, límite 5000 ms                  |
| Diagnóstico continuo, 21:40 UTC        | 1905,27 ms |         3508,25 ms | PASS diagnóstico; no sustituye aceptación |
| Tercer intento CI, serie 1, 22:01 UTC  | 2000,29 ms |         6994,68 ms | **FAIL**, límite 5000 ms                  |

El diagnóstico usó el comando existente
`npm run test:practice:performance -- --submit --continuous-diagnostics`.
Conservó 100/100 muestras y fases/reloj completos; host/VM estuvieron observados,
Docker tuvo cobertura parcial y sus huecos se conservaron. No se cambiaron
umbrales, concurrencia, muestras, límites del runner ni controles de estabilidad.

En la muestra p95 del segundo fallo, ejecución tomó 4447,33 ms y confirmación
DB 23,58 ms. En la del tercero, ejecución tomó 6658,77 ms y confirmación DB
24,12 ms. El span de confirmación incluye COMMIT y los triggers diferidos.
Esto no justifica atribuir el exceso a la captura .05 ni una optimización SQL
especulativa; tampoco demuestra una causa concreta del host o daemon. La imagen
cambió durante la preparación entre ambos intentos de CI, por lo que no se
presentan como una comparación causal equivalente. No se reiniciaron ni
detuvieron servicios ajenos para obtener un resultado favorable.

En aquel corte quedó pendiente diagnosticar el ciclo de ejecución Docker y
revalidar los tres perfiles SUBMIT consecutivos y la CI completa. No se declaró
entonces el cierre local de .05 ni la CI pendiente de .03. La corrección y
verificación posterior que resuelven ese pendiente constan a continuación;
los FAIL anteriores se conservan sin convertirlos en resultados aprobados.

## Cierre local posterior a la corrección SUBMIT

La CI completa `npm run ci:verify` terminó con salida 0 y **17/17 PASS** a
las `2026-10-26T00:35:22.681Z` (25/10 en Santiago). Candidato: mismo HEAD
`75708ceecf2ca755bd32fb4b04e77bcb8de310f4`, 502 fuentes, SHA-256
`19253829d0baecaf2055c855714ab15247344a28d6fb1887fab5b65823834ba6`.
Conserva todos los cambios anteriores y los evaluadores .04 sin modificación.

La admisión SUBMIT entrega al adaptador el digest inmutable ya inspeccionado;
evita una segunda consulta de imagen por solicitud sin reutilizar cápsulas.
El primer intento integral de esta corrección aprobó los tres gates SUBMIT,
pero falló un fixture E2E ante un retroceso observado del reloj PostgreSQL.
Una barrera temporal acotada corrige su precondición, conservando todos los
contadores y cortes históricos exigidos. El [registro específico](2026-10-25-submit-admission.md)
documenta evidencia, cambios y ese FAIL antes de la CI final aprobada.

La CI final aprobó 2.110 unidades, 181 HTTP, 928 aserciones SQL/13 archivos,
incluidos los 17 casos de señales, integración IA, 49/49 E2E y evaluación de
ayuda (234 muestras, 763 recibos, tres reanudaciones, cero llamadas externas).
Los tres p95 serial/concurrencia cuatro fueron 2.072,35/3.415,01 ms,
1.644,12/3.198,67 ms y 1.646,66/3.246,24 ms. Cada gate mantuvo 50+50 muestras,
100 respuestas válidas, límite estricto de 5.000 ms y todos los controles de
estabilidad y limpieza. La actualización con preservación de datos conserva
la prueba focal aprobada anterior; sus fuentes y migraciones no cambiaron.

Con persistencia, recuperación, reconstrucción y aislamiento demostrados,
queda cerrado localmente IMP-05.05 y comprobada conjuntamente la CI pendiente
de .03/.04. La documentación se actualiza después de la CI; las fuentes
ejecutadas permanecen idénticas. El principal permanece limpio y sin cambios.

## Evidencia y límites de entrega

Los JSON saneados de `.local/reports/imp-05` y sus historiales incluyen
`signals-focused`, `signals-upgrade`, `integration`, `ci`, `ci-continuation`,
`sig14-integration-focus`, `submit-attempt2-analysis`,
`submit-continuous-analysis`, `submit-attempt3-analysis` y `local-acceptance`.
Este último verifica huella de fuentes, resultados, liberación de TEST y
estado limpio del principal. Su versión final declara `localCompletion=true`;
la versión histórica con `false` se conserva en el historial. El workflow los
incluye en su empaquetado; los logs, diffs, estados privados y credenciales
quedan fuera. Los informes de rendimiento conservan todas las muestras,
incluidas las fallidas, en `imp-03-submissions/history`.

`SIGNALS_WORKER_ENABLED=false` sigue siendo el valor predeterminado. La CLI
`signals:rebuild` dispone de `plan`, `check`, `rebuild` y `report`, con ámbito y
corte obligatorios; procedimientos en el [diccionario](IMP-05-episodes-dictionary.md).
No hubo cambios en el proyecto principal, commits, pushes ni despliegues.

La concurrencia de revisión usa dos conexiones del mismo docente vigente;
E23/E24 específicos son pruebas del motor puro. No se acredita RF-019,
tablero, cierre integral RF-018, aceptación académica, CI Linux ni servicios
Azure/Vercel remotos. La evaluación de ayuda aprueba latencia API local;
conserva pendiente la métrica navegador→feedback visible por falta de esa
evidencia, sin convertirla en un resultado aprobado.
