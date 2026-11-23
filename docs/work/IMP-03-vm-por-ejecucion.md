# IMP-03 — Preparación local de una VM por ejecución

Fecha inicial: 16/11/2026, America/Santiago. Estado actualizado el 17/11:
**RUN8 y SUBMIT8 medidos y aprobados en dos VMs nuevas del Ryzen, con arnés
revisión 2 y kit-v2**. Es el alcance local
acotado de la [decisión propuesta](IMP-03-decision-ejecutor-2026-11-16.md).
No cambia el proveedor productivo ni integra una segunda API o un puerto SQL
simulado. No modifica el kit histórico `linux-native-kvm` ni transforma sus
50 SUBMIT dentro de un mismo huésped en aceptación de este candidato.

Actualización del 17/11: [guion de validación física RUN8/SUBMIT8](IMP-03-validacion-fisica.md),
recibos con límites y tiempos por caso, perfil opcional saneado y comprobación
del Node real contra el bundle. El [anfitrión Ryzen pasó el preflight](IMP-03-preparacion-fisica-12.md)
con QEMU y KVM. Después de construir las bases compatibles, `attempt-02`
terminó con salida 0, `measured`, `SUCCESS` y ocho casos para ambos modos.
El [registro físico](IMP-03-kit-fisico-12.md) conserva estas observaciones y
los fallos previos; las pruebas offline mantienen su alcance separado.

La revisión 2 del arnés usa raíz virtio (`/dev/vda`) y un único namespace
NVMe para el almacén (`/dev/nvme0n1`), con un disco por familia de dispositivo.
Corrige la carrera de nombres NVMe observada en el primer kit. El kit-v2
incorpora kernel revisión 3; imagen, bundle `.12`, límites y presupuestos
permanecen iguales. Su manifiesto tiene SHA-256
`c3275243ff75f5fcfee43f26c691684c8145588fc13a59dfd4edb6aaec7ebb0f`.

## Alcance ejecutable

`tests/runner/linux-single-execution/launch.py` ofrece cuatro operaciones:

| Operación   | Efecto y resultado                                                                                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preflight` | Comprueba Linux físico x86-64, ausencia de WSL/virtualización anidada, KVM y herramientas con el preflight existente. No crea huésped.                                                                                                                              |
| `bundle`    | Compila el runner actual con TypeScript ya instalado, captura identidad de fuentes y produce un tar determinista con JS, módulos de infraestructura y Zod local. No instala dependencias ni usa proveedores.                                                        |
| `prepare`   | Verifica hashes suministrados de kernel, raíz ext4, almacenamiento Docker y bundle; copia bases a un directorio nuevo e instala el supervisor/unidades con `debugfs`, sin montar ni arrancar discos. Comprueba los bytes instalados mediante extracción de lectura. |
| `run`       | Solo en un host elegible: overlays nuevos, un QEMU KVM y una admisión de un fixture fijo. Al terminar o fallar, retira su QEMU y overlays, conserva recibos y contrasta bases. RUN8 y SUBMIT8 aprobaron en `attempt-02` con dos VMs independientes del kit-v2.      |

El ensayo usa el adaptador **cold** real: RUN con 1, 2 u 8 casos; SUBMIT con
2 u 8 casos, primero visible y restantes ocultos. Hay una sola llamada a
`execute` por huésped y una cápsula nueva por caso. El trabajo es la función
ficticia de suma `sum-fixed-v1`; el manifiesto no acepta código de terceros.
La marca exclusiva `/run/alunza-single-admitted` impide una segunda admisión
en el mismo arranque, incluso si se reinicia la unidad.

`prepared-pair-v1`, las reservas de VM prearrancadas, las cargas adversariales,
la persistencia de API/SQL, cuotas de dominio y recuperación de dos
reconciliadores no forman parte de este arnés. **No cierra G1 completo ni
G2/G3/G5/G6**. Los fixtures de ocho casos verificaron el camino cold de los
casos 3–8 en estas dos muestras; no acreditan persistencia durable.

## Identidad del candidato y requisitos

El bundle contiene `runner.tar.gz` y `runner-bundle.json`. El manifiesto incluye
inventario ordenado por ruta, bytes y SHA-256, hash del lockfile, Node observado,
package manager declarado y `sourceIdentityMode=quality-coverage-v1`. La huella
de fuentes procede de `readCoverageCandidate` antes/después del build y otra
vez después de archivar/verificar. No es el algoritmo del snapshot
`runner-candidate`; tampoco es una aprobación de la auditoría de cobertura.
La ausencia de cambios de fuente no sustituye las pruebas funcionales.

El tar se valida antes de usarlo: solo archivos regulares relativos sin
traversal, links, duplicados ni discrepancias de bytes/hash. El guest contrasta
el hash del tar y manifiesto antes de extraer y verifica de nuevo el inventario
extraído antes de importar el runner. Los hashes concretos se entregan en el
recibo; no se reutilizan los del kit histórico ni se incorporan constantes de
una cápsula anterior. Cada bundle provisional conserva su propia identidad.

Para `prepare` se suministra una copia privada de
`tests/runner/linux-single-execution/artifacts.example.json`, completada con
archivos y hashes reales. La plantilla contiene `null` y `virginBase=false` y
**no autoriza ni simula** una preparación válida. El descriptor requiere:

- Kernel x86-64 apto para NVMe, ext4, cgroup v2 y `qemu_fw_cfg` accesible por sysfs.
- Raíz ext4 completa con `/lib/systemd/systemd`, Node fijado en `/usr/bin/node`
  o `/usr/local/bin/node`, Docker CLI/daemon, tar, mount y el ELF de runtime.
- Disco ext4 de almacenamiento Docker, con capas de la cápsula indicada y sin
  contenedores ni trabajos previos. La cápsula se identifica por su ID inmutable.
- Runtime crun 1.31 o runc 1.3.4, nombre registrado, ruta y SHA-256 efectivos;
  estrategia `cold`. El runner vuelve a comprobar esa identidad dentro del huésped.
- SHA-256 y tamaño de cada artefacto; hashes del bundle y su manifiesto.

`virginBase=true` registra la declaración del preparador sobre la procedencia
de bases construidas sin secretos ni código estudiantil; no constituye una
inspección forense. El guest rechaza un Docker con contenedores previos. El
disco de trabajo siempre es un overlay nuevo. La etiqueta esperada por
`inspectDockerRunner` se crea solo en ese overlay después de verificar el ID
inmutable; nunca se cambia la base suministrada.

## Envolvente y transporte

QEMU arranca detenido, sin NIC, monitor interactivo, carpetas compartidas ni
discos del anfitrión diferentes de sus overlays. Antes de `cont`, QMP confirma
KVM, UUID nuevo, un vCPU y 2147483648 bytes de memoria sin memoria conectada
adicional. Los discos son qcow2 nuevos sobre bases raw; no se ejecuta `commit`.
El comportamiento de backing images y los archivos de configuración firmware
está documentado por [QEMU image utility](https://www.qemu.org/docs/master/tools/qemu-img.html)
y [QEMU invocation](https://www.qemu.org/docs/master/system/invocation.html).

La única solicitud fija llega por `fw_cfg` desde un archivo privado generado
por el host. No hay socket Docker del anfitrión ni credenciales cloud/BD en el
huésped. Los recibos salen por serial; el lector conserva únicamente campos
permitidos, identidades, códigos, cantidades y tiempos. No guarda arranque en
bruto, código, stdout estudiantil, valores esperados ni resultados ocultos.

El supervisor y dockerd se colocan en `alunzasingleexecutor.slice`, con
`MemoryMax=2147483648`, `MemorySwapMax=0` y `CPUQuota=100%`; Docker usa ese mismo
padre para sus cápsulas y driver cgroup `systemd`. Antes de ejecutar se observan
el límite común, un CPU, la pertenencia del supervisor y la del PID real de
dockerd. El runner verifica los controles de cada cápsula antes de stdin. El
comparador permanece fuera de los 128 MiB estudiantiles y dentro de la VM y
slice exterior; el bridge interior sigue consumiendo el presupuesto de la
cápsula. El recibo `ready` conserva la versión real del runner y los controles
observados; la prueba de configuración por sí sola no acredita aislamiento
adversarial.

## Vida única, relojes y retiro

El reloj monotónico del host empieza **antes** de crear overlays. Arranque,
QMP, readiness y entrega no lo reinician: operación hasta 30 s, cierre inicial
hasta 40 s y TTL máximo de 60 s desde esa creación. El reloj de pared permite
al guest aplicar el mismo corte operacional; el host conserva la autoridad
monotónica aunque el guest se bloquee. Los 3000 ms acumulados de trabajo
estudiantil pertenecen al runner y no se sustituyen por esos plazos.

Un flock exclusivo permite una sola VM propia simultánea por usuario Unix
entre las invocaciones de este arnés. Una marca durable en ese mismo archivo
mantiene la admisión bloqueada si el guardián muere o el retiro no puede
acreditarse; se borra solo después de observar QEMU recolectado y scratch
ausente. No existe un borrado automático de una marca pendiente: requiere
verificación independiente de los recursos propios antes de rehabilitarla.
Cada comando produce un UUID y dos
overlays nuevos; el guest nunca vuelve a una reserva. Al recibir resultado y
limpieza o al fallar, el host mata/recolecta su proceso QEMU, retira únicamente
el directorio privado creado por esa invocación y comprueba ausencia. No se
detienen VMs, motores o procesos ajenos. Las bases se vuelven a contrastar por
hash. Un cierre incierto no produce estado `measured`.

Este guardián es el proceso de lanzamiento del **host**, separado de la API y
del supervisor guest. Aún no se acredita supervivencia ante SIGKILL del propio
guardián, caída del host ni limpieza automática después de esos eventos. Ese
control y la recuperación durable pertenecen a G5 y deben completarse antes
de presentar el mecanismo como operación productiva tolerante a esas fallas.
SIGTERM y SIGINT sí activan el retiro acotado; una segunda señal capturable
no interrumpe esa limpieza. Un cierre entre 40 y 60 s puede respetar el TTL
externo, pero falla la ventana inicial y devuelve fallo del ensayo.

`report.json` distingue preparación de overlays, llegada de readiness, tiempos
internos de ejecución/fases y retiro. `completeMs` mide desde creación hasta
ausencia de los recursos de trabajo. La comprobación posterior de integridad
de bases no se presenta como duración de ejecución. No sumar percentiles ni
duraciones superpuestas de fases; una muestra no acredita p95. Comparar RUN y
SUBMIT, runtime, mezcla y origen frío solo con sus identidades explícitas.
Los recibos registran `outputBytes`, presupuesto, casos completados y
controles observados. El host rechaza una afirmación de éxito si faltan casos,
controles o identidad, si hay truncamiento o si el tiempo cobrado llega a
3000 ms. Para éxito, contrasta también que cada presupuesto sea 3000 menos
la suma previa y que la suma de los tiempos por caso sea exactamente
`runtimeMs`; ocho presupuestos reiniciados no acreditan el límite acumulado.
Los tiempos privados `caseCost` son diagnóstico opcional y no alteran
ese presupuesto; un perfil inválido se conserva como `INVALID`. Sus relojes
del worker y bridge tienen orígenes distintos.

## Comandos preparados

Preparar un bundle de fuentes actuales en un directorio **nuevo**, con padre
existente, desde la raíz del repositorio:

```powershell
python -B tests/runner/linux-single-execution/launch.py bundle --out .local/single-execution-bundle
python -B tests/runner/linux-single-execution/launch.py preflight
```

En el Linux elegible y con descriptor completo y artefactos suministrados:

```bash
python3 -B tests/runner/linux-single-execution/launch.py prepare --artifacts /ruta/privada/artifacts.json --bundle /ruta/bundle --out /ruta/kit-nuevo
```

La invocación siguiente **crea una VM**. Cada perfil requiere un directorio
de salida nuevo y una VM nueva; las dos muestras físicas registradas usaron
el arnés revisión 2 y el manifiesto del kit-v2:

```bash
python3 -B tests/runner/linux-single-execution/launch.py run --kit /ruta/kit-nuevo --manifest-sha256 HASH_DEL_RECIBO --mode SUBMIT --cases 8 --out /ruta/resultado-nuevo --scratch /var/tmp
```

Si no existe un host o artefacto requerido, el comando termina con código 2 y
`unavailable-not-executed`. No instala KVM, obtiene infraestructura ni sustituye
el host por WSL/virtualización anidada. Un ensayo iniciado que falla devuelve
1 y conserva su resultado; éxito de esa única muestra devuelve 0, sin aceptar
producto ni proveedor.

## Verificación efectuada y pendientes

- Linux físico, `attempt-02`: RUN8/SUBMIT8 aprobaron con ocho casos y salida 0.
  `runtimeMs` fue 714,103623/759,542977 ms y `completeMs`, 8339,79/8789,23 ms.
  La auditoría confirmó cero QEMU/scratch propios y el paquete original
  íntegro. La meta de 5 s sigue pendiente; dos muestras no calculan p95 ni
  sustituyen la batería adversarial física, API/SQL o aceptación remota.
- Python: **15/15 pruebas offline** de manifiestos/tar, identidad, una sola
  admisión, reloj absoluto, argumentos QEMU, QMP previo al arranque, rechazo de
  host no Linux, señales, cierre fuera de la ventana inicial, marca de recursos
  inciertos y retiro de recursos simulados aun con fallo del guest.
  Incluye rechazo de host anidado, afirmaciones de éxito sin presupuesto/casos
  completos y saneamiento de la instrumentación opcional.
- Jest: **27/27 pruebas**; verifica solicitud/fixtures de 1/2/8 casos,
  envolvente, redacción de resultados y bytes del bundle, e invoca la suite
  Python anterior sin iniciar VMs. Los quince casos Python no son ensayos KVM.
  Los fixtures de TIMEOUT/salida/memoria/capacidad solo comprueban que esos
  resultados no pueden acreditar éxito del ensayo; no ejecutan ataques reales.
- Las primeras focales detectaron constantes Linux ausentes en los mocks de
  Windows y una comparación de arrays entre contextos Jest. Se corrigieron los
  mocks y la comparación exacta de nombres; las comprobaciones de datos y rutas
  se conservaron.
- Preflight real del equipo Windows: `LINUX_PHYSICAL_KVM_REQUIRED`, código 2,
  `unavailable-not-executed`. No se accedió a KVM ni se creó un huésped.

Comandos focales: `python -B tests/runner/linux-single-execution/test_launch.py`
y Jest con `--runTestsByPath tests/runner/linux-single-execution.test.cjs`.
ESLint/Prettier se aplican a los archivos JS/JSON/Markdown nuevos. La guía no
atribuye al arnés nuevo los resultados del laboratorio Ubuntu persistente ni
de los candidatos anteriores. La observación física posterior se identifica
por kit, revisión del arnés y recibos propios; quedan pendientes mejorar y
medir el ciclo completo frente a la meta de 5 s y completar las puertas de
aceptación que estas dos muestras funcionales no cubren.
