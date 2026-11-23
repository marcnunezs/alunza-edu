# IMP-03 — Rendimiento y adversariales físicos del candidato .12

Fecha: 17/11/2026, America/Santiago. Estado: **40 muestras normales físicas
verificadas, p95 del ciclo local <5 s; 16/20 adversariales aprobados y cuatro
fallos conservados; dos pruebas de guardián y respaldos verificados**.
El usuario autorizó mejorar la latencia local hacia cinco segundos y comprobar
los adversariales en el Ryzen físico, manteniendo los límites. No autoriza
atribuir aceptación remota, desplegar, contratar ni modificar la arquitectura
productiva. Se conservan RF-009/010/011, RNF-REN-02/SEG-04 y DEC-003/008.

El punto de partida es el [kit físico .12 verificado](IMP-03-kit-fisico-12.md):
dos muestras RUN8/SUBMIT8 correctas, de 8339,79 y 8789,23 ms de ciclo local.
Estas observaciones se conservan como antecedentes; no se agregan después a
la muestra estadística de una variante distinta.

## Variante y artefactos preservados

Se mantienen kernel r3, raíz preparada, almacén, guest normal, imagen OCI y
bundle originales. El [manifiesto del kit](../../.local/preproduction/imp-03-07/physical-build-20261117/evidence-final/kit-v2/guest-manifest.json)
tiene SHA-256 `c3275243ff75f5fcfee43f26c691684c8145588fc13a59dfd4edb6aaec7ebb0f`.

| Identidad                               | SHA-256                                                            |
| --------------------------------------- | ------------------------------------------------------------------ |
| Imagen OCI .12                          | `59b49b3c72e25715373fd948634307bfcaaf112c3096b85cc46a2ae83e9d3c5b` |
| Bundle                                  | `b7473369c112f71abc7856549c148dcdcbacc8216a5134ae80bd77430ee91e01` |
| Manifiesto del bundle                   | `0b722fc5775cebf70f9718574eceb1b0e511f6c49ce5f23c4afe6fe869b55053` |
| Fuente, algoritmo `quality-coverage-v1` | `b9b86390c955b26d3f7efd1d8dd21ebfe60c1594affe3059277ae46cdfd9fb0f` |
| Guest normal                            | `a9f4495fabe8246d73bb035c9ed8d7d60f434d03dca61e59f64537816e3e64fb` |
| Launcher de referencia                  | `9b16429f2c9e527055b69cd530d1eb16b6e0b243b0d429d7d49b745fb228818c` |
| Launcher de rendimiento                 | `2a16495bee7cbc36fec1d5515bedb647bb57becb83f87635cb41040b6d61ede4` |

El cambio de arranque usa `q35,sata=off,i8042=off` y añade
`quiet systemd.show_status=error` a la línea del kernel. Se omiten dispositivos
SATA y PS/2 sin uso; se conservan serie, recibos, raíz virtio, almacén NVMe,
QMP previo a continuar y errores de arranque. Las propiedades se contrastaron
con QEMU 8.2.2 del host. La [justificación y fuentes primarias](../../.local/preproduction/imp-03-07/physical-performance-20261117/boot/recommendation.md)
separan los huecos de logs observados de ahorros todavía no demostrados.

El [launcher congelado de rendimiento](../../.local/preproduction/imp-03-07/physical-performance-20261117/performance-launch.py)
también incorpora preparación y selección de fixtures adversariales. Las
campañas de latencia usan exclusivamente `sum-fixed-v1`, ocho casos y el
guest/kit normales originales; esas ramas adicionales no se ejercitan.
No se presenta el archivo entero como un cambio limitado a flags de QEMU.

La variante seleccionada usa `/dev/shm` para overlays y conserva la caché
predeterminada `writeback`. No se usa `cache=unsafe`, no se precarga un worker
antes de la admisión y no se restan boot ni limpieza. tmpfs puede usar swap
del anfitrión y consume RAM adicional del host; no equivale a ampliar ni a
medir dentro de los 2147483648 bytes de RAM asignados al huésped. Se conserva
la observación antes/después de memoria, swap y contadores del host.

## Protocolos y relojes

El [protocolo de calidad](../../.local/preproduction/imp-03-07/physical-performance-20261117/quality/PROTOCOLO.md)
fija una VM simultánea, huéspedes nuevos, una admisión por VM, 1 vCPU/2 GiB,
cápsula de 134217728 bytes, swap guest/cápsula cero, 32 tareas, 3000 ms y
65536 bytes acumulados. Rigen 30/40/60 s de operación/cierre/TTL.

| Campaña             | Muestra fijada                                     | Protocolo SHA-256                                                  | Estado de resultados en este corte          |
| ------------------- | -------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------- |
| `screen-scratch-01` | 3 pares por modo, 12 VMs; SSD/tmpfs en orden AB/BA | `d10b81f127a2dec9f494d96167c060239808fd3f7736e1466f5a5a4b2d3a434a` | 12/12 recibos válidos; ninguna muestra <5 s |
| `screen-boot-01`    | 3 RUN8 y 3 SUBMIT8, 6 VMs; boot reducido y tmpfs   | `538ae6a3bae7a95f56800143a6763ff143c464d2b06cad86c0e5701db25e2428` | 6/6 válidas y <5 s; cribado separado        |
| `confirm-boot-01`   | 20 RUN8 y 20 SUBMIT8 nuevos, 40 VMs secuenciales   | `70dd8658a2633cefc6d88617084b187181effdf56c8b4f2e111d0ac8a8cd080f` | 40/40 válidas y <5 s; verificador salida 0  |

Se fijan orden, tamaño y hashes antes de ejecutar. Todos los intentos quedan
en el denominador, incluidos errores, interrupciones y posiciones no
ejecutadas. La retirada incierta detiene nuevas VMs y deja una campaña
incompleta; no se sustituyen sus muestras. Los cribados y la confirmación
permanecen separados; la variante conjunta no permite atribuir por separado
una diferencia a `quiet`, SATA, PS/2 o tmpfs.

Cada VM y cápsula es nueva, pero no se vació la caché de páginas del host y
la verificación previa lee las bases: estas muestras no representan un host
recién encendido ni cachés vacías.

`completeMs` empieza **antes de crear overlays** y termina después de retirar
QEMU y scratch. Incluye boot, ejecución y cierre local. El launcher comprueba
los hashes de las bases antes de iniciar ese reloj y los vuelve a calcular
después de fijar `completeMs`. Esas comprobaciones, preflight y el resto de la
invocación quedan en `wrapperWallMs`. La CLI tiene una mediana de **7,433 s**
en ambos modos; su p95 es aproximadamente **7,482 s** y no está contenido
entero en `completeMs`. No se atribuye toda la diferencia a hashes sin
descomponerla.

`runtimeMs` corresponde al presupuesto estudiantil acumulado; `executeMs`
corresponde a `runner.execute` dentro del huésped. No se suman a los intervalos
del host que ya los contienen ni se suman fases Docker solapadas. API,
persistencia y red remota siguen fuera de estas mediciones. Por ello,
**RNF-REN-02 y DEC-008 del recorrido completo permanecen abiertos**, incluso
si la confirmación local satisface su umbral.

El cálculo local usa nearest-rank por modo, sin redondear antes de comparar:
la observación 19 de 20 ordenadas debe estar por debajo de 5000 ms. También
se informarán máximo, errores y cantidad de observaciones bajo el umbral.
Con una duración faltante no se declara p95 de la muestra completa. Veinte
observaciones tienen resolución empírica de 5%; no garantizan un percentil
poblacional ni estabilidad en otra carga.

## Resultados normales verificados

El snapshot exportado contiene las tres campañas anteriores. El archivo
transferido tiene 500205 bytes y SHA-256
`d8b2bdcc1607c97f9dab6c11a9da3e267670833da3af100b400a1b06a4ae8c0f`.
Las comprobaciones locales leyeron los recibos sin ejecutar nuevas VMs:
[scratch](../../.local/preproduction/imp-03-07/physical-performance-20261117/quality/screen-scratch-01-verification.json),
[boot](../../.local/preproduction/imp-03-07/physical-performance-20261117/quality/screen-boot-01-verification.json)
y [confirmación](../../.local/preproduction/imp-03-07/physical-performance-20261117/quality/confirm-boot-01-verification.json).
Los cribados devuelven salida 1 por su alcance exploratorio, sin errores de
evidencia. La confirmación devuelve salida 0, `local-latency-target-met`.

| Ciclo local `completeMs`           | Mediana RUN | Mediana SUBMIT | Muestras por modo |
| ---------------------------------- | ----------- | -------------- | ----------------- |
| Cribado SSD                        | 5831,406 ms | 5825,948 ms    | 3                 |
| Cribado tmpfs                      | 5280,491 ms | 5323,693 ms    | 3                 |
| Cribado boot reducido + tmpfs      | 4053,773 ms | 4047,569 ms    | 3                 |
| Confirmación boot reducido + tmpfs | 4040,717 ms | 4032,812 ms    | 20                |

En la confirmación no hubo errores, muestras faltantes ni interrupciones.
Las 40 completaron ocho casos, preservaron identidades, presupuestos
decrecientes, límites, QMP, limpieza e integridad de las bases registradas.
El verificador contrasta esas observaciones; no vuelve a observar el kernel
ni los procesos del host desde Lenovo.

| Medición de confirmación       | RUN, 20 muestras | SUBMIT, 20 muestras |
| ------------------------------ | ---------------- | ------------------- |
| p95 del ciclo local            | **4070,062 ms**  | **4057,414 ms**     |
| Máximo del ciclo local         | 4087,106 ms      | 4070,391 ms         |
| Ciclos bajo 5000 ms            | 20/20            | 20/20               |
| Mediana de CLI `wrapperWallMs` | 7432,888 ms      | 7432,466 ms         |
| p95 de CLI `wrapperWallMs`     | 7482,448 ms      | 7482,018 ms         |
| p95 estudiantil acumulado      | 716,514 ms       | 717,602 ms          |

El [análisis de fases](../../.local/preproduction/imp-03-07/physical-performance-20261117/quality/timing-summary.json)
usa límites del mismo reloj del host para cinco intervalos disjuntos. Sus
valores por muestra suman `completeMs`; **sus medianas y percentiles no se
suman**. El p95 de cada fase se informa como diagnóstico, no como sustituto
del p95 del ciclo.

| Fase                        | Mediana RUN | p95 RUN    | Mediana SUBMIT | p95 SUBMIT |
| --------------------------- | ----------- | ---------- | -------------- | ---------- |
| Creación de overlays        | 28,84 ms    | 30,22 ms   | 29,20 ms       | 29,84 ms   |
| Overlays listos → `ready`   | 1719,72 ms  | 1738,59 ms | 1711,45 ms     | 1726,27 ms |
| `ready` → `result`          | 2221,32 ms  | 2240,66 ms | 2220,42 ms     | 2240,00 ms |
| `result` → `clean`          | 11,19 ms    | 11,72 ms   | 11,10 ms       | 13,33 ms   |
| `clean` → retirada completa | 65,93 ms    | 68,69 ms   | 66,21 ms       | 68,20 ms   |

La mediana del tiempo de wrapper fuera del ciclo es 3405,767 ms en RUN y
3397,774 ms en SUBMIT. Incluye verificación de bases, preflight y costes de
invocación; no es una medición aislada del hash. Estos costes permanecen
visibles antes de considerar una integración real con la API.

Los snapshots antes/después de las 40 muestras conservaron **512 KiB de swap
usado en el host**, con deltas acumulados `pswpin=0`, `pswpout=0` y
`pgmajfault=0`. La opción `noswap` de tmpfs no se observó. La memoria disponible
mínima en esos snapshots fue 15580804 KiB y `Shmem` máximo observado 1652 KiB;
son lecturas fuera del intervalo de vida de la VM, no picos de uso durante
la ejecución. No acreditan host sin swap ni memoria adicional gratuita.

## Preparación adversarial y validación offline

El [catálogo adversarial](../../tests/runner/linux-single-execution/adversarial.cjs)
fija escenarios de loop y presupuesto acumulado, memoria, fronteras de
salida, acceso a capacidades del host, importaciones, falsificación, estado
entre casos y proyección oculta. Separa QuickJS de probes nativos de
identidad, permisos, red, procesos y memoria de descendientes.

Los controles se deben observar antes de entregar input y el cierre del
host sigue siendo independiente del resultado del guest. Un TIMEOUT
esperado con tiempo informado superior a 3000 ms falla el control temporal.
Un OOM sin packet conserva tiempo desconocido: puede acreditar el escenario
de memoria, pero no el plazo. Las notificaciones de watchdog no identifican
por sí solas el instante de la última instrucción estudiantil. Los rechazos
adversariales esperados no se incluyen como muestras rápidas en el p95 normal.

La validación offline final aprobó 56 pruebas Jest de los focos del arnés,
incluidos [boot](../../tests/runner/linux-single-boot.test.cjs) y
[catálogo adversarial](../../tests/runner/linux-single-adversarial.test.cjs),
22 pruebas Python y 10 del [verificador de campaña](../../.local/preproduction/imp-03-07/physical-performance-20261117/quality/test_summary.py),
además de ESLint y formato del incremento final. También pasaron cinco
[comprobaciones negativas en memoria](../../.local/preproduction/imp-03-07/physical-performance-20261117/quality/adversarial-negative-checks.json)
que rechazan reclasificar un TIMEOUT fallido, omitir controles previos,
reiniciar presupuesto, superar el cierre con un flag positivo o ampliar RAM.
Estas comprobaciones validan argumentos, oráculos y rechazos de evidencia;
no sustituyen ejecuciones físicas. La campaña adversarial usa su guest,
launcher y manifiesto propios, fijados por separado de la variante normal.

## Campaña adversarial: cuatro fallos conservados

Se ejecutaron los veinte perfiles del catálogo, con **16 aprobados y cuatro
fallidos**. Su protocolo tiene SHA-256
`ef0d53fa087bed5536a26a9911e69c7ca5bad6dbe85c246e2a454cefb042f781`
y el kit adversarial v2, manifiesto
`f2fc832c8668f87b5976abc7f71115db7ae89c269795ed46a4e79e758d96110b`.
La imagen y el bundle `.12` permanecen intactos. La
[revisión del arnés](../../.local/preproduction/imp-03-07/physical-performance-20261117/adversarial-revision-v2.json)
fija sus seis archivos, incluido launcher
`b5dec31f136ed6097daf2c513d2a9b8d3aeec8dc5218db7665fca6a1e5f048e0`
y guest `1c0c07d49fd181c03af08fdf7b98a527907494c0f647b966d1d741f766a7925d`.
El kit adversarial v1 se conserva como preparación no ejecutada; los veinte
ensayos usan exclusivamente v2.

| Perfil fallido        | Resultado esperado observado             | Fallo que impide aprobar                                                                              |
| --------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `qjs-loop`            | TIMEOUT; tiempo informado 3005,804950 ms | Supera el límite estricto de 3000 ms en 5,804950 ms.                                                  |
| `qjs-cumulative-time` | TIMEOUT; total informado 3002,981394 ms  | Supera el límite acumulado en 2,981394 ms.                                                            |
| `qjs-heap-memory`     | `UNKNOWN / MEMORY_LIMIT`                 | `CHARGED_TIME_SUM` y `PACKET_CONTROLS`: tiempo agregado cero pese a una observación de 482,800398 ms. |
| `qjs-buffer-memory`   | `UNKNOWN / MEMORY_LIMIT`                 | Los mismos controles fallan: tiempo agregado cero pese a una observación de 248,249510 ms.            |

Los cuatro tienen `expectedOutcomeObserved=true`, pero ese campo no anula
los controles restantes ni convierte la campaña en 20/20. Los excesos de
tiempo no se redondean a 3000 ms ni se les agrega tolerancia. Las observaciones
del supervisor tampoco identifican por sí solas la última instrucción física.

Los [recibos heap](../../.local/preproduction/imp-03-07/physical-performance-20261117/heap-report.json)
y [buffer](../../.local/preproduction/imp-03-07/physical-performance-20261117/buffer-report.json)
conservan `timingComplete=true`, `result.runtimeMs=0` y tiempo de supervisor
no nulo. El [análisis del bundle congelado](../../.local/preproduction/imp-03-07/physical-performance-20261117/boot/oom-accounting-analysis.md)
identifica que `execute()` observa un paquete válido por esquema y conserva
sus marcas, pero la rama `OOMKilled` termina antes de acumular tiempo, salida
y controles cgroup. Se mantiene el diagnóstico de memoria esperado; falla
la contabilidad de evidencia. No se infiere una fuga fuera de la cápsula ni
la validez semántica de todos los campos del paquete no exportado.

Los controles previos al input y la retirada de esos dos perfiles quedaron
confirmados. La corrección corresponde a un candidato posterior: preservar y
validar la evidencia disponible antes de resolver OOM, sin inventar datos si
falta el paquete, sin duplicar sumas ni continuar con otro caso. No se altera
`.12` ni se debilitan sus verificadores. Esa corrección sería independiente
de los fallos temporales.

La [verificación estructural independiente](../../.local/preproduction/imp-03-07/physical-performance-20261117/quality/adversarial-verification.json)
confirmó los veinte perfiles, su orden, las identidades y el retiro.
Reproduce `Receipt` con una copia local fijada del launcher v2 y contrasta
eventos, admisión, stdout, report y copias del índice. Los eventos sanitizados
omiten `executionId`; el replay toma ese identificador de la admisión, sin
atribuir una nueva observación del canal serial bruto.
El resultado es `evidenceValid=true`, `verified-adversarial-with-failures` y
**salida 1**, que conserva los cuatro fallos; no es una campaña aprobada.

## Guardián, cierre y respaldo

Las [dos pruebas del guardián](../../.local/preproduction/imp-03-07/physical-performance-20261117/evidence/host-failure-932cdd96533e49abb439a8d3c5c7af24/campaign.json)
usaron el launcher de rendimiento y el kit normal fijados. Ambas observaron
el fallo esperado y el retiro, sin mecanismo de emergencia. Los tiempos
de ciclo siguen el reloj original de creación; no son muestras de latencia
normal ni del presupuesto estudiantil.

| Inyección tras `ready` | Fallo esperado observado                 | Ciclo hasta retirada | Fase de retiro |
| ---------------------- | ---------------------------------------- | -------------------- | -------------- |
| SIGTERM del launcher   | `HOST_GUARD_INTERRUPTED`                 | 2019,362 ms          | 64,923 ms      |
| SIGSTOP de QEMU        | `ABSOLUTE_OPERATION_OR_CLEANUP_DEADLINE` | 30093,901 ms         | 64,886 ms      |

El segundo caso vence en el plazo original de operación de 30 s y completa
el retiro antes de 40 s; no recibe una ventana nueva desde `ready`. El
verificador confirmó **22 retiros registrados** entre adversariales y
guardián, con 2/2 pruebas de guardián aprobadas. No se ensayó la muerte del
guardián por SIGKILL ni se acredita ese mecanismo de recuperación.

El [snapshot completo](../../.local/preproduction/imp-03-07/physical-performance-20261117/evidence/)
contiene 562 archivos verificados; el SHA-256 de su transporte es
`220f7d9485de91e572e4749820a3ad2ac3d8dd381ff23a1b10d915a86b343af9`.
La [auditoría final del host](../../.local/preproduction/imp-03-07/physical-performance-20261117/evidence/final-audit.json)
registra cero QEMU, cero scratch, bloqueo vacío y bases intactas. En esa
auditoría posterior el swap usado era **768 KiB**; es una observación distinta
de los 512 KiB antes/después de la campaña normal, sin atribución causal.

El respaldo adversarial llegó a Lenovo con **431248481 bytes** y SHA-256
`1a383ce75eb5c04ef11325f70629b56a4cee7851c1968ab34e430cd79a662b77`.
Su [recibo de verificación](../../.local/preproduction/imp-03-07/physical-performance-20261117/adversarial-kit-backup-verification.json)
confirma los once archivos y el recálculo de hashes de kernel, raíz y almacén:
`verified-transferred-adversarial-kit`, `guestDiskBytesRehashed=true`.
No quedan transferencias ni tareas remotas de esta campaña pendientes.

## Reproducción y siguiente cierre

Las fuentes y protocolos operativos están en
`.local/preproduction/imp-03-07/physical-performance-20261117/`; se conservan
los scripts [de cribado scratch](../../.local/preproduction/imp-03-07/physical-performance-20261117/screen-remote.py),
[de boot](../../.local/preproduction/imp-03-07/physical-performance-20261117/screen-boot-remote.py)
y [de confirmación](../../.local/preproduction/imp-03-07/physical-performance-20261117/confirm-remote.py).
Sus carpetas de salida son exclusivas: una repetición necesita nombre y
protocolo nuevos; no se sobrescriben campañas anteriores.

En el Ryzen preparado, el kit normal está en
`/home/alunza/laboratorio/guest-build-12-20261117/kit-v2` y el arnés de rendimiento
en `/home/alunza/laboratorio/physical-performance-12-20261117/harness-perf/`.
Una repetición normal usa ese árbol completo y los hashes anteriores:

```bash
base=/home/alunza/laboratorio/guest-build-12-20261117
perf=/home/alunza/laboratorio/physical-performance-12-20261117
campaign=$(mktemp -d "$perf/replay-normal-XXXXXX")
python3 -B "$perf/harness-perf/tests/runner/linux-single-execution/launch.py" preflight
python3 -B "$perf/harness-perf/tests/runner/linux-single-execution/launch.py" run --kit "$base/kit-v2" --manifest-sha256 c3275243ff75f5fcfee43f26c691684c8145588fc13a59dfd4edb6aaec7ebb0f --out "$campaign/run" --scratch /dev/shm --mode RUN --cases 8
```

Revisar salida 0, `measured`, ocho casos, `ok=true`, controles, retirada y bases
intactas antes de SUBMIT. Si falla, conservar los recibos y resolver la causa.
Para SUBMIT se usa el mismo comando con `--mode SUBMIT` y una salida nueva
`"$campaign/submit"`. Estos dos comandos no equivalen a repetir la campaña
estadística de 40 muestras. No aplicar `prepare` a la raíz ya preparada.

El [verificador solo lectura](../../.local/preproduction/imp-03-07/physical-performance-20261117/quality/verify-summary.py)
contrastó el snapshot exportado con el SHA externo del protocolo. Para repetir la
confirmación se seleccionan las [copias fijadas para revisión](../../.local/preproduction/imp-03-07/physical-performance-20261117/quality/artifacts-boot/)
mediante `--arm-artifacts tmpfs-boot=RUTA`, además de
`--plan-sha256 70dd8658a2633cefc6d88617084b187181effdf56c8b4f2e111d0ac8a8cd080f`.
Esas tres copias sirven para verificar identidad; no constituyen por sí solas
un kit ejecutable. Salida 0 exige confirmación completa, evidencia válida y
ambos p95 locales <5000 ms; 1 indica cribado o umbral no acreditado, y 2 indica
evidencia incompleta o fallida.

El siguiente trabajo es corregir la contabilidad OOM y resolver los dos
incumplimientos temporales en candidatos nuevos, con regresiones y repetición
de los perfiles afectados. Los fallos `.12` permanecen como evidencia.
Se demuestra el umbral del ciclo local bajo el perfil normal medido; siguen
abiertos la CLI completa bajo cinco segundos, API/persistencia, aceptación
física global, aceptación remota y RNF-REN-02.
