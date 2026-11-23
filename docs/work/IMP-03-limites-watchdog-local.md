# Límites comunes y observación del watchdog

Fecha: 16/11/2026. Incremento local autorizado a partir de
[PROP-EJEC-001](IMP-03-decision-ejecutor-2026-11-16.md): completar los controles
de `cold` y casos 3–8, instrumentar el watchdog y preparar un huésped por
ejecución. No autoriza despliegue, contratación ni cambio de AD-ARQ-001.
Runner final del incremento: `imp-03-quickjs.11`, después de observar el primer
ensayo instrumentado `.10`. Las imágenes y mediciones `.9`
anteriores conservan su identidad y no prueban este incremento.

## Contratos afectados y aceptación

RF-009/010/011/014; HU/CU/PT-009 y flujos RUN/SUBMIT relacionados;
RNF-REN-02/SEG-04, SEC de ejecución y recuperación. Se conserva DEC-003:
134217728 bytes agregados en la cápsula, swap cero, 3000 ms compartidos entre
casos, 65536 bytes combinados de stdout/stderr; entorno de 1 vCPU/2 GiB.
Los diagnósticos, proyecciones públicas, pruebas ocultas y API de dominio
permanecen con sus contratos previos.

La aceptación de código exige rechazo antes de stdin cuando faltan controles,
cambia el motor/PID/grupo o vence la autoridad; compartir límite exterior entre
casos; presupuesto acumulado; trazas privadas coherentes; empaquetado completo.
Las pruebas con dobles acreditan esas decisiones de software. La observación
en Linux, el último instante físico de ejecución y p95 requieren ensayos reales
separados; no se deducen de esos dobles.

## Controles comunes

`infra/runner/kernel-controls.mjs` sustituye la comprobación exclusiva de la
pareja por un observador usado por las dos rutas. Verifica el motor local
Linux/systemd/cgroup v2, contenedor activo y PID; relaciona ese PID con el scope
Docker completo; lee los límites efectivos de la hoja y busca un ancestro
común limitado a como máximo 1 CPU/2147483648 bytes. Relee estado y pertenencia
antes de permitir stdin, después de comprobar la autoridad durable.

`DockerAdapter` conserva la primera frontera observada durante un intento
`cold`. Cuando consume una pareja, su continuación para los casos 3–8 nace
ligada a la frontera de esa pareja. El camino configurado falla cerrado si
la observación no está disponible, incluso en Windows o con un motor remoto.
Docker Desktop genérico conserva la ruta anterior y no acredita el nuevo
control exterior; no se interpreta `/proc` del cliente como el del daemon.

La observación del ancestro demuestra la pertenencia y límites de las cápsulas.
La instalación del laboratorio debe comprobar por separado la ubicación de
dockerd y del supervisor dentro del entorno total: este helper no prueba por
sí solo esos dos procesos ni convierte un cgroup en una frontera de VM.

## Tiempo observado

El puente confiable incorpora `watchdog-observation.cjs`. Todos sus tiempos son
offsets de `performance.now()` desde que el puente interpreta la entrada:

- presupuesto restante y deadline del caso;
- petición de arranque, aviso de spawn y armado del temporizador;
- disparo del watchdog y retraso respecto del deadline;
- intentos y retornos exitosos de SIGKILL;
- avisos de exit y close.

`closeObservedMs` coincide con `runtimeMs`. Una llamada SIGKILL exitosa no
equivale a confirmar la salida del grupo; un aviso de exit del líder puede
preceder al cierre de pipes de descendientes. Por eso
`lastGuestInstructionObservedMs` es siempre `null`. No se cambió el presupuesto
para ocultar un retraso de terminación ni se afirma un corte físico a 3000 ms.

El sobre confiable se valida estrictamente y se conserva en
`evidence.timings[].watchdog`. No contiene código, argumentos, salidas, PIDs
ni identificadores de pruebas. `publicResult` y las proyecciones de API no lo
exponen. Paquetes anteriores sin instrumentación quedan con observación `null`;
no reciben tiempos inventados. Un paquete incoherente falla como protocolo.

El Dockerfile de cápsula copia el helper y el ensamblador del supervisor copia
`kernel-controls.mjs`; recompilar TypeScript no actualiza una imagen antigua.

## Hallazgos reales y corrección del permiso de terminación

El primer smoke en la VM existente usó `.10`, Node 24.21.0, crun 1.31 y un
motor privado dentro de 1 CPU/2 GiB. `cold RUN8` se detuvo en el quinto caso
por el presupuesto acumulado: 3183,261 ms de runtime observado, con limpieza
confirmada. Los cinco controles de hoja y ancestro pasaron. Esto **no acredita
ocho casos exitosos**: la inicialización y el cierre incluidos en el reloj
actual consumieron el presupuesto incluso con una función trivial.

En el quinto caso el presupuesto restante era 423,688 ms; el watchdog se
observó a 450,109 ms, hubo un intento SIGKILL y cero llamadas exitosas. El
bridge UID0 conservaba SETUID/SETGID/SETPCAP, pero no CAP_KILL. Linux exige
coincidencia de identidades o ese permiso para señalar el UID10001
([kill(2)](https://man7.org/linux/man-pages/man2/kill.2.html),
[capabilities(7)](https://man7.org/linux/man-pages/man7/capabilities.7.html)).
La traza anterior no contiene errno y no se presenta como una observación
literal de EPERM; sí demuestra que el intento no tuvo éxito.

`.11` incorpora `CAP_KILL` exclusivamente al puente confiable, mantiene el
namespace PID privado y rechaza otras configuraciones. El hijo sigue usando
`setpriv` con bounding/inheritable/ambient vacíos y `no-new-privs`, y su
comprobación exige los cinco conjuntos de capabilities en cero. No se concede
CAP_KILL al estudiante ni se cambian 3000 ms/65536 bytes para obtener un pase.
El resultado fallido `.10` se conserva; el colector continúa los escenarios
independientes y conserva los fallos de cada uno.

La repetición `.11` ejecutó la identidad nativa y los cinco escenarios, con
23 cápsulas observadas. UID10001, los cinco conjuntos de capabilities en cero
y el guard de `no-new-privs` aprobaron. Todos los controles de hoja/ancestro
observados y las limpiezas por escenario aprobaron. El resultado agregado
**sigue siendo FAILED**, porque no se completaron los ocho casos:

| Escenario `.11`   | Casos alcanzados      | Resultado                                     | Runtime observado (ms) |
| ----------------- | --------------------- | --------------------------------------------- | ---------------------: |
| cold RUN8         | 6                     | TIMEOUT; no acredita 8 éxitos                 |               3020,493 |
| cold SUBMIT8      | 5                     | TIMEOUT; no acredita 8 éxitos                 |               3024,795 |
| prepared SUBMIT8  | 2 preparados + 3 cold | TIMEOUT; no acredita los seis fallback        |               3042,598 |
| loop1             | 1                     | Aprobó la detención esperada por TIMEOUT      |               3026,121 |
| salida acumulada8 | 5; 45000 bytes        | TIMEOUT antes de alcanzar el límite de salida |               3034,271 |

En `loop1`, deadline 3000 ms, disparo observado 3009,879 ms, retorno exitoso
de SIGKILL 3015,844 ms, aviso de exit 3025,877 ms y close 3026,121 ms.
La separación de tiempos queda observada; no acredita la última instrucción
ni un corte físico exacto a 3000 ms. Se mantuvo el presupuesto acumulado y
se conservaron las cinco muestras, incluidos los cuatro escenarios fallidos.
El probe de identidad previo también calienta el ambiente: esto no es un
A/B de rendimiento ni una campaña p95 con respecto del primer ensayo `.10`.

Los casos 7–8 quedan cubiertos por las pruebas de contratos/rechazo del mismo
fallback, pero **no por una ejecución real exitosa de ocho casos en esta VM**.
La prioridad siguiente es desglosar y reducir el coste incluido en el reloj
del proceso y contrastarlo en Linux físico con los mismos límites. No se
autoriza ampliar el presupuesto, descontar tiempos silenciosamente ni
presentar el resultado como viabilidad aceptada para pasar a un proveedor.

Un foco **independiente**, conservando el fallo anterior, sí aprobó los tres
controles que podían quedar ocultos tras TIMEOUT: dos casos que generan
40000 bytes cada uno terminaron con 65536 bytes combinados,
`UNKNOWN/OUTPUT_LIMIT`, truncamiento y 1095,593 ms; las cargas nativas de
memoria directa y de descendientes terminaron con `UNKNOWN/MEMORY_LIMIT`,
`OOMKilled=true` y un evento `oom_kill` cada una. Se verificó la limpieza de
sus cuatro cápsulas. El `runtimeMs=0` de esos resultados OOM no significa que
no hubiera ejecución: el runner deja de acumular el paquete al observar OOM;
no se usa ese cero como medición de duración.

Los montajes del laboratorio dejaron evidencia de dos incidencias previas a
enviar código: la primera preparación falló al observar el ejecutable del
daemon antes de guardar su identidad, compatible con una carrera de
`env/unshare` a `containerd`; no se conservó el errno exacto. Se retiró y
verificó esa campaña. La segunda detectó un nombre de archivo incorrecto del
auxiliar V2. Se recuperó solo tras comprobar estado PREPARING, raíz de trabajo
ausente, procesos vacíos, preparación inactiva y hashes intactos, conservando
la salida y el recibo. No se reinició la VM ni se alteró el Docker habitual.

Al cierre de la campaña 02 se observaron cero contenedores propios, daemons,
montajes y loops pendientes; el motor habitual conservó ID e inventario.
`guest-evidence.tar` conserva once archivos originales, incluidos los tres
informes de escenarios. Sus SHA-256 se contrastaron con el registro de cada
ejecución y el retiro, sin convertir el smoke agregado FAILED en aprobado.

## Ensayo de VM y evidencia

El [arnés de una VM por ejecución](IMP-03-vm-por-ejecucion.md) prepara un kit
independiente del ensayo histórico de 50 envíos en un solo huésped. Exige
artefactos con hashes, discos privados por invocación y retirada verificada.
Su alcance y carencias se registran en esa guía.

Comprobaciones ejecutadas con Node 24.21.0 y las dependencias existentes:

| Comprobación                                         | Resultado observado                                        | Alcance                                                                                                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                  | Aprobado en todos los workspaces y tipos E2E               | Incluye build de contracts, runner y AI; se corrigió el acceso potencialmente indefinido a la primera cápsula detectado por la configuración de API.                 |
| Suite `tests/runner/jest.config.cjs`                 | 21 suites, 511 pruebas aprobadas                           | Incluye las regresiones de CAP_KILL y namespace PID, controles, transporte, fallback, watchdog, presupuestos acumulados de ocho casos y arnés de VM; no ejecuta KVM. |
| Focos API Docker execution/submission/service        | 3 suites, 57 pruebas aprobadas                             | Dobles unitarios; preservan las proyecciones y el contrato de servicio. Se usó `--experimental-vm-modules`, requerido por el script del repositorio.                 |
| Focos preproduction runner-prepare/runner-candidate  | 2 suites, 52 pruebas aprobadas                             | Ensamblado del supervisor y captura/restauración de fuentes.                                                                                                         |
| Python del arnés de VM                               | 11 pruebas offline aprobadas, incluidas en el foco Jest    | Solicitud única, límites exteriores, protocolos, cancelación y retiro con dobles; no acredita QEMU real.                                                             |
| ESLint de apps/packages/scripts/tests e infra runner | Aprobado                                                   | Sin instalar dependencias.                                                                                                                                           |
| Prettier de los archivos afectados y tests runner    | Aprobado                                                   | Sin formateo masivo del repositorio.                                                                                                                                 |
| Build de cápsula                                     | Aprobado localmente con `--network=none` y base disponible | Imagen con watchdog; `.11` configura CAP_KILL/PidMode desde el supervisor. Sin publicación.                                                                          |
| Preflight del arnés de VM en Windows                 | Código 2, `LINUX_PHYSICAL_KVM_REQUIRED`                    | Rechazo esperado; no arranca VM ni usa virtualización anidada.                                                                                                       |

La imagen construida tiene ID
`sha256:99d10926b38fb77cb4ad2f5b99f94905b597ed5649402279937ae1e25ac3c191`.
Su exportación local tiene SHA-256
`2d8bd96e0f6c1805ca541c8bc9709c77428dedd46381dac3810a8be13d4d42e7`.

El primer bundle `.10` preparado para el nuevo ensayo contiene 271 archivos; tar SHA-256
`6ae917ca760e70e814f77ee12848e15a2b4dfe7c631594ee657287d54b0a61a9`,
manifiesto `5919fb8cb607d7de2cb3d63e6bd98eecef78a83798b0d3c722e09ee4e5027f9e`
y huella `quality-coverage-v1`
`f5185fcf32e609285d3871f88dd06de26b6e984de2f4d8a3b253bdcf090f7fe4`.
No contiene kernel ni discos raíz/almacenamiento compatibles verificados:
estos siguen siendo entradas necesarias para materializar el kit de VM.

El **bundle final `.11`** conserva 271 archivos, tar
`e060a603724bcf0b11f8ffc935cfe1721b2c010cca0a8abb870cd1e3297eb4a1`,
manifiesto `ff421ae0d836ecd4b1c47a7da03fe4cae5d96e13c9cdfad7cf2e763cb5309958`
y huella `quality-coverage-v1`
`a2ee64f3eea48b7bca2184a8e65d0d69795858ed4ee9ae96762f5aaa767016be`.
El foco de salida/memoria se ejecutó sobre esos bytes. El smoke de cinco
escenarios `.11` usó el tar
`7fe4a816a5a517f3a402ddd8ea88ccb75fcfda03b9e389f33468b18e07ba2854`:
se verificó que la única diferencia de archivos runtime es el formato del
array `bridgeCapabilities` emitido en `index.js`, con idénticos valores.
Ambos manifiestos e informes conservan su identidad; no se renombra la
evidencia anterior como una ejecución nueva.

Para repetir cada foco se conservan `linux-controls-smoke.cjs` y
`linux-limits-focused.cjs` en `tests/runner`, con entorno explícito, motor
privado vacío y controles del supervisor/dockerd obligatorios. El primero
conserva fallos por escenario y aborta si no puede acreditar la limpieza.
Estos focos no sustituyen el ensayo de una VM virgen ni la integración SQL.

No se reutilizan los 199/200 resultados ni el p95 de la campaña del 15/11 como
evidencia de este código. La identidad del snapshot de fuentes y los recibos
de la comprobación en la VM existente se conservan en el expediente local
`.local/preproduction/imp-03-07/vbox-limits-watchdog-20261116/`.
