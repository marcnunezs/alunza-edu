# IMP-03 — Bases del huésped y ensayo físico del candidato .12

Continuación: el [ensayo de rendimiento y adversariales físicos](IMP-03-rendimiento-adversarial-fisico-12.md)
registra la mejora posterior del ciclo local, su muestra de confirmación y los
fallos que todavía impiden aceptar el candidato. Este documento conserva las
bases y las dos mediciones originales.

Fecha: 17/11/2026, America/Santiago. Estado: **bases preparadas, dos muestras
físicas RUN8/SUBMIT8 aprobadas y respaldos verificados en Lenovo**. El usuario autorizó construir el kernel,
la raíz y el almacén del huésped, y ejecutar RUN8/SUBMIT8 en el Ryzen, sin
ampliar límites, desplegar ni contratar servicios. Se conservan RF-009/010/011,
RNF-REN-02/SEG-04 y DEC-003. La [preparación del anfitrión](IMP-03-preparacion-fisica-12.md)
ya aprobó QEMU/KVM; este trabajo cubre los artefactos que faltaban.

## Construcción y procedencia

El snapshot de fuentes, la imagen OCI y el bundle `.12` permanecen congelados.
La revisión posterior del arnés se identifica por separado, sin sustituir ese
paquete original. Las herramientas
de construcción y sus evidencias están en
`.local/preproduction/imp-03-07/physical-build-20261117/`.
La construcción usa directorios exclusivos en WSL del Lenovo; WSL no es el
ambiente de medición. El huésped se prepara y ejecuta únicamente en el Ryzen
físico, mediante SSH con clave y huella verificadas, como `alunza`.

La raíz parte de [Ubuntu Base 24.04.5 amd64](https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/),
archivo `ubuntu-base-24.04.5-base-amd64.tar.gz`, SHA-256
`e77b6f10c2590cef872b33ee9f635a0e3fd1f57fb074c0e52b5c7f56147a0c86`,
contrastado con el archivo de sumas del mismo sitio HTTPS. No se atribuye
verificación PGP. Se instalaron systemd 255, dbus, udev y las dependencias
de los ELF en un chroot nuevo, con inicio de servicios impedido mediante
`policy-rc.d`. Los paquetes y bibliotecas resueltas quedan inventariados.

Node 24.21.0, Docker 29.1.3, containerd, crun 1.31 y sus binarios auxiliares
proceden de los archivos de construcción del handoff ya verificado. Se
contrastaron sus hashes y dependencias; no se copiaron sistemas vivos,
credenciales ni un almacén de Docker existente. Docker y containerd del
sistema están enmascarados: el supervisor debe iniciar su motor privado.

La primera raíz ext4 ocupa 1610612736 bytes, carece de tabla de particiones y tiene
SHA-256 `caa62ff0cbcd22c7835c15ab0f3349761defc3af59d5233b430cf5c5915b9877`.
Su transporte gzip tiene SHA-256
`07ca0ebcfdcb5c4470069c1ef86eac860d9f5b5228023e73c7444e5d021f18d9`.
Pasó `e2fsck -fn` antes y después de transferirla al Ryzen. El primer intento
de crear el filesystem usó una unidad de tamaño equivocada y agotó espacio;
se conservó ese fallo y se generó una imagen nueva de 1536 MiB explícitos.
No se había iniciado una VM ni ejecutado el candidato.

El primer kernel se compiló desde Linux upstream 6.18.64, con fuente
SHA-256 `020d45510c539972e6f14c5c71566878d3b7ef56fb082b3e09134f2ebaade562`,
contrastada con el índice HTTPS oficial, sin atribuir verificación PGP.
La imagen `6.18.64-alunza12` tiene SHA-256
`760c29f6f14e2cd80e82392e9584bce80c794cd5c3accc307bda0d80f7f9db76`.
Aprobaron 74 opciones requeridas y la comparación de configuración embebida.
Incorpora NVMe, ext4 y `fw_cfg` por sysfs, porque el lanzador no entrega initrd;
también cgroups, namespaces y seccomp. Se conservan configuración, herramientas
y recibo. El kernel del anfitrión no se modifica.

Las dos primeras VMs auxiliares arrancaron con ese kernel y systemd, pero
el control estricto rechazó `NETWORK_PRESENT` antes de cargar Docker o crear
contenedores. El segundo intento agregó únicamente diagnóstico y observó
`["lo", "sit0"]`. La configuración `CONFIG_IPV6_SIT=y` crea ese túnel por
defecto aun con `-nic none`. Esto motivó una revisión del kernel desactivando
ese componente, sin debilitar el control. Ambos intentos conservan discos,
consola y recibos separados; QMP acreditó KVM, una CPU y 2147483648 bytes,
y el cierre verificó ausencia del grupo de procesos en 2775,922/2975,482 ms.
Estos arranques no son ensayos RUN/SUBMIT del candidato.

La revisión r2 conserva la fuente Linux 6.18.64 y tiene SHA-256
`8909a37f83b773b6033b2493fad3fb3539bfe6508d730faa8f3e403db1496457`.
Verificó 75 opciones requeridas y la configuración embebida. Se desactivó
`CONFIG_IPV6_SIT`; la resolución de dependencias también retiró cuatro
opciones asociadas, según el [delta de configuración](../../.local/preproduction/imp-03-07/physical-build-20261117/kernel/revision-2/config-delta.json).
El [recibo r2](../../.local/preproduction/imp-03-07/physical-build-20261117/kernel/revision-2/receipt.json)
conserva herramientas, fuente y hashes. No se modificó el filtro de red del
guest congelado ni el kernel del anfitrión.

La VM auxiliar `seed03` observó únicamente `lo`, pero el inicio de Docker
falló porque no estaba disponible su proxy de espacio de usuario. La nueva
raíz `root-v3.img`, SHA-256
`d7834a30710009dd0cd3d1b37594d3265e5f728ac1b3b5aef22176c432ce9c7e`,
desactiva ese proxy opcional mediante `userland-proxy=false`. Conserva el
almacén containerd y la ausencia de NIC y publicación de puertos; no cambia
la imagen estudiantil, el runtime ni los límites. La raíz anterior y el
intento fallido permanecen separados.

## Preparación del almacén

El almacén empieza como un filesystem ext4 vacío de 1073741824 bytes. Una
copia separada de la raíz contiene el programa de preparación y el archivo
OCI exacto `.12`; la raíz virgen anterior permanece intacta. La VM auxiliar
tiene una CPU, 2 GiB, ninguna NIC y guardia exterior de 60 s. No ejecuta
código estudiantil ni crea contenedores. Usa el mismo bloqueo de exclusión
del lanzador para impedir VMs simultáneas de este ensayo.

La carga debe conservar el índice OCI
`sha256:59b49b3c72e25715373fd948634307bfcaaf112c3096b85cc46a2ae83e9d3c5b`,
sus capas locales y desempaquetadas, cero contenedores/tareas/volúmenes y
containerd administrado bajo el `data-root` del motor privado. El recibo
escrito en el disco no prueba su desmontaje posterior: la aceptación también
requiere el marcador serial final, desmontaje, salida de QEMU, ausencia del
grupo de procesos, filesystem consistente y hash final del anfitrión.

`seed04`, con kernel r2 y la raíz v3, aprobó la preparación en
**9892,347 ms** del reloj del anfitrión. Cargó la imagen exacta, verificó
su contenido local y desempaquetado, y conservó cero contenedores, tareas
y volúmenes. El cierre verificó el desmontaje, la retirada de QEMU y su
grupo de procesos, y `e2fsck -fn`. El almacén preparado tiene SHA-256
`fc1b0f474b9b41c02886d200b82eeae62536f3cc2ebec2c55d2134c7b9d85107`.
Es una preparación sin carga estudiantil; esos 9892,347 ms no son latencia
de RUN/SUBMIT ni una observación de p95.

Se seleccionaron explícitamente ese intento y esos artefactos para completar
el descriptor y ejecutar `prepare` del lanzador congelado. El manifiesto del
kit tiene SHA-256
`786330489a7c03966fb27d72cb52ff00bd7b9945bb028b4a63615529406b5d0c`.
Las fuentes, el bundle y la imagen `.12` siguen identificados por sus pins
anteriores; el manifiesto del kit identifica las bases nuevas y no sustituye
el manifiesto del snapshot de fuentes.

## Ensayo autorizado y criterio

RUN8 y SUBMIT8 usan huéspedes nuevos, secuenciales y desechables. Si RUN8 falla,
se conserva el resultado y no se continúa con SUBMIT8 sin resolver la causa.

Se mantienen 1 vCPU/2147483648 bytes de envolvente, 134217728 bytes por
cápsula, swap cero, 32 tareas y CPU 100000/100000. Los ocho casos comparten
3000 ms y 65536 bytes de salida. Rigen 30/40/60 s de operación/cierre/TTL.
Los hashes de las bases y la retirada de QEMU/overlays forman parte del cierre.
Dos muestras aprobadas no acreditan p95, recuperación ante SIGKILL,
concurrencia cuatro, aceptación remota ni los controles adversariales físicos.

## Primer RUN8 y diagnósticos preservados

El primer RUN8 llegó al estado `ready` con runner `imp-03-quickjs.12`,
Node `v24.21.0` y crun `1.31`. QMP acreditó KVM, una CPU, 2147483648 bytes
y el UUID esperado; el supervisor y el daemon declararon pertenencia a la
envolvente. El resultado fue **`measured-with-errors`, `UNKNOWN/RUNNER_FAILURE`,
infraestructura `FAILED` y cero casos completados**. La fase `start` falló
después de crear la cápsula y conectar sus canales. No se observaron controles
por caso ni una ejecución estudiantil aprobada.

El [recibo completo del primer fallo](../../.local/preproduction/imp-03-07/physical-build-20261117/run-first-failure.json)
conserva estas duraciones, con ámbitos distintos:

| Campo        | Valor          | Alcance                                                                                                           |
| ------------ | -------------- | ----------------------------------------------------------------------------------------------------------------- |
| `runtimeMs`  | 0 ms           | Presupuesto estudiantil informado sin casos completados; no acredita ejecución correcta ni mejora de rendimiento. |
| `executeMs`  | 1302,009089 ms | Duración de `runner.execute` dentro del huésped.                                                                  |
| `readyMs`    | 3958,099 ms    | Desde antes de crear overlays hasta recibir `ready`, en el reloj del host.                                        |
| `completeMs` | 5366,58 ms     | Desde esa creación hasta la retirada local; no incluye API, persistencia ni red remota.                           |

El resultado del runner conserva `cleanupVerified=false`. La comprobación
posterior del huésped informó cero contenedores (`guestCleanupVerified=true`),
y el host verificó `qemuReaped`, `scratchAbsent` y `baseFilesUnchanged`, además
de las ventanas de cierre y TTL. Esta limpieza posterior no convierte el
resultado fallido en éxito.

El auxiliar `diagnostic01` terminó con kernel panic: `/dev/nvme0n1` quedó
asignado al almacén, cuyo UUID es `310dc721-a883-4c37-8ff3-786923d75928`, y
faltó `/lib/systemd/systemd` en el volumen usado como raíz. La
[consola preservada](../../.local/preproduction/imp-03-07/physical-build-20261117/diagnostic-01-console.log)
registra el montaje y el fallo de init. `diagnostic02` volvió a alcanzar la
fase `start` y reprodujo su fallo. Los diagnósticos conservaron limpieza y
hashes de las bases; son observaciones auxiliares separadas del RUN8 medido.
El problema de asignación NVMe no explica por sí solo el fallo de inicio de
la cápsula. `diagnostic03` volvió a intercambiar los discos y terminó sin una
muestra aceptable; su [recibo](../../.local/preproduction/imp-03-07/physical-build-20261117/evidence-intermediate/diagnostic-03/diagnostic.json)
conserva el fallo, QEMU retirado, scratch ausente y bases intactas.

## Revisión del arnés y causa observada en Docker

La revisión `harness-v2` elimina la dependencia del orden entre dos namespaces
NVMe: conecta únicamente la raíz por virtio (`/dev/vda`) y el almacén como
único namespace del único controlador NVMe (`/dev/nvme0n1`, `nsid=1`). El
guest monta ese almacén con las mismas opciones `ext4`, `nosuid,nodev`.
El [delta preservado](../../.local/preproduction/imp-03-07/physical-build-20261117/kernel/harness-storage-v2/storage-layout.patch)
no modifica límites, protocolo, admisión, `fw_cfg`, red, relojes ni limpieza.
El kernel r2 ya contiene los drivers virtio requeridos como integrados.

Pasaron **29 pruebas focales offline**, incluida la suite Python del lanzador,
y lint. La revisión independiente contrastó los cambios con la copia
congelada. Las identidades nuevas son:

- `launch.py`: `9b16429f2c9e527055b69cd530d1eb16b6e0b243b0d429d7d49b745fb228818c`.
- `guest.cjs`: `a9f4495fabe8246d73bb035c9ed8d7d60f434d03dca61e59f64537816e3e64fb`.
- Prueba del arnés: `f62ee9a518a65987e861be2b0a14dab0e832e78d4f7b324518fa751e065526fc`.

Es una corrección del arnés local, no una nueva imagen estudiantil ni un cambio
de arquitectura productiva. Las pruebas offline no acreditan que los ocho
casos hayan completado su ejecución física.

La preparación auxiliar `diagnostic-kit-v2` partió de una raíz ya preparada.
La reinstalación dejó un directorio huérfano y `e2fsck` rechazó el filesystem;
ese kit no se arrancó ni aceptó. Se conservó el fallo y se rehízo
`diagnostic-kit-v3` desde la base virgen, con comprobación de integridad de
salida 0. No se usó un resultado fallido de filesystem como base aprobada.

Con la conexión de discos corregida, `diagnostic04` arrancó y permitió observar
el fallo de la cápsula: Docker devolvió HTTP 400 con
``OCI runtime create failed: open `io.max`: No such file or directory``.
El kernel r2 tiene `CONFIG_BLK_CGROUP=y`, pero
`CONFIG_BLK_DEV_THROTTLING=n`; disponer de cgroups de bloque no garantizaba
que el archivo requerido existiera. Este diagnóstico auxiliar no sustituye
el primer RUN8 fallido ni constituye una muestra aprobada.

El kernel r3 se compiló desde la misma fuente. La comprobación confirmó
80 requisitos; el delta de configuración se limita a
`CONFIG_BLK_DEV_THROTTLING` y `CONFIG_BLK_CGROUP_RWSTAT`, ambos de `n` a `y`.
El [script de reconstrucción](../../.local/preproduction/imp-03-07/physical-build-20261117/kernel/revision-3/rebuild-kernel.sh)
verificó ese delta y preservó las revisiones anteriores. La imagen tiene
SHA-256 `49604546758f9e8d60ba8c44d478faad53b2148abd760c217576f36c182c0819`;
el [recibo r3](../../.local/preproduction/imp-03-07/physical-build-20261117/kernel/revision-3/receipt.json)
conserva configuración y procedencia. El nuevo `kit-v2` combina ese kernel,
la base de raíz v3, el almacén ya identificado y `harness-v2`. La raíz
preparada, con el arnés y el bundle incorporados, tiene SHA-256
`82e2095fe5a0763138b2989d25d744252197e3eb856f9cf297c751f6674bdbb3`;
es distinta de la base virgen `d7834a…` usada por `prepare`. Su manifiesto
tiene SHA-256
`c3275243ff75f5fcfee43f26c691684c8145588fc13a59dfd4edb6aaec7ebb0f`.
El kit original, la primera RUN8 fallida y los diagnósticos permanecen intactos.

## Dos muestras físicas aprobadas y alcance del cierre

La campaña nueva `attempt-02` ejecutó RUN8 y SUBMIT8 en huéspedes distintos,
secuenciales y de un solo uso. Ambas terminaron con salida 0, estado
`measured`, `SUCCESS`, ocho casos completados y `ok=true`, sin interrupción
del wrapper. Son muestras del arnés normal de ejecución, con la imagen y el
bundle `.12` originales. La aprobación
cubre los criterios de estas dos muestras, no todos los gates de aceptación.

| Campo        | RUN8           | SUBMIT8        | Alcance                                                                                                |
| ------------ | -------------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| `runtimeMs`  | 714,103623 ms  | 759,542977 ms  | Tiempo estudiantil cobrado, acumulado entre ocho casos; ambos por debajo de 3000 ms.                   |
| `executeMs`  | 3129,243232 ms | 5492,498056 ms | Duración de `runner.execute` dentro del huésped, incluidos costes de preparación y retiro de cápsulas. |
| `readyMs`    | 4960,519 ms    | 3036,994 ms    | Desde antes de crear overlays hasta recibir `ready`, en el reloj del host.                             |
| `completeMs` | 8339,79 ms     | 8789,23 ms     | Ciclo local desde esa creación hasta la retirada; excluye API, persistencia y red remota.              |

`executeMs` no es el presupuesto estudiantil: que supere 3000 ms no amplía
los 3000 ms acumulados que el supervisor cobra a los ocho casos. Ambos ciclos
locales `completeMs` superan 5000 ms. Estas dos observaciones no constituyen
una campaña p95 ni acreditan la meta de latencia del recorrido completo.
No se suman percentiles ni se mezclan los relojes de fases distintas.

El [resumen de costes por caso](../../.local/preproduction/imp-03-07/physical-build-20261117/case-cost-summary.json)
también registra los acumulados de las fases de Docker:

| Fase     | RUN8       | SUBMIT8     |
| -------- | ---------- | ----------- |
| `create` | 925,730 ms | 1310,486 ms |
| `start`  | 530,495 ms | 1442,828 ms |
| `delete` | 137,515 ms | 637,464 ms  |

No todas las fases se pueden sumar: por ejemplo, `wait` y `streams` se
solapan. En estas dos muestras, los ocho casos consumieron menos de 760 ms
del presupuesto estudiantil. El siguiente foco de medición es el arranque
de la VM y el ciclo de Docker; los datos no justifican ampliar el presupuesto
ni atribuir un cuello de botella general a partir de dos observaciones.

Se mantuvieron los límites y controles del ensayo: 1 vCPU/2147483648 bytes
para la envolvente; 134217728 bytes, swap cero y 32 tareas por cápsula;
3000 ms y 65536 bytes acumulados, con presupuestos decrecientes. Las dos
muestras verificaron la limpieza y la integridad de sus bases. La auditoría
física posterior encontró cero QEMU del ensayo, cero directorios scratch,
el archivo de bloqueo vacío y el paquete original verificado.

El anfitrión conserva un archivo de swap de **4 GiB nominales habilitado**
(4194300 KiB utilizables). La auditoría posterior observó **512 KiB usados**;
no es una medición durante el ensayo. No se declara un host sin swap ni se
atribuye la latencia a ese uso a partir de una sola observación posterior.
Este dato es distinto del swap cero observado en los controles de las
cápsulas y su envolvente.

## Respaldo y verificación independiente

El snapshot [de evidencia final](../../.local/preproduction/imp-03-07/physical-build-20261117/evidence-final/)
conserva 104 archivos verificados, incluidos los fallos anteriores y la
campaña nueva. Su archivo de transporte `evidence-final.tar.gz` tiene SHA-256
`c3d0c94c900a23c48321a185d11b8930e5011253cb2e7839dafb7aeacf76b587`.
El verificador independiente terminó con salida 0 y estado
`verified-two-local-samples`, seleccionando `kit-v2`, `attempt-02`,
la revisión 2 del arnés y el hash externo del manifiesto. El
[recibo de campaña](../../.local/preproduction/imp-03-07/physical-build-20261117/campaign-verification.json)
contrasta identidades, UUID distintos, ocho presupuestos decrecientes,
suma del tiempo cobrado, controles, QMP y cierre registrados. Esa lectura
offline no vuelve a observar recursos vivos ni ejecuta una VM.

El respaldo `alunza-12-physical-kit.tar.gz` llegó a Lenovo con **431226415 bytes**
y SHA-256
`4c3fef63122c6b634962b4eb76ada2600d8c34017bbe228711528b5a5b4dafab`.
La [verificación del respaldo](../../.local/preproduction/imp-03-07/physical-build-20261117/kit-backup-verification.json)
leyó gzip/tar sin extraer los discos y recalculó los hashes de sus once
archivos, incluidos kernel, raíz preparada, almacén, manifiesto y arnés.
Terminó en `verified-transferred-kit`, con `guestDiskBytesRehashed=true`.
La [guía de reproducción](../../.local/preproduction/imp-03-07/physical-build-20261117/README-reproduccion.md)
fija las rutas, el manifiesto y la revisión del arnés; indica conservar cada
campaña nueva y no aplicar `prepare` a la raíz ya preparada del respaldo.

El alcance técnico alcanzado es disponer de kernel, raíz y almacén compatibles
y completar las dos muestras físicas RUN8/SUBMIT8 con sus límites y retiro.
Permanecen pendientes la batería adversarial física, el instante de corte
bajo abuso, la recuperación ante SIGKILL, concurrencia cuatro, la campaña p95,
el recorrido API/persistencia y la aceptación remota. No se modificó la
arquitectura productiva ni se desplegaron o contrataron servicios.
