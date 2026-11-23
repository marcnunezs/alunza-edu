# IMP-03 — Preparación de entrada física del candidato .12

Fecha: 17/11/2026, America/Santiago. Estado: **anfitrión físico elegible y
preflight completo aprobado; ejecución de `.12` pendiente de las bases del huésped**. Este registro
complementa el [guion físico](IMP-03-validacion-fisica.md) y el
[arnés de una VM por ejecución](IMP-03-vm-por-ejecucion.md). No modifica el
candidato congelado `.12`, sus límites, su imagen ni sus resultados previos.
No se ha arrancado una VM nueva en este incremento.

**Cierre posterior del 17/11:** la construcción y el ensayo se registran por
separado en [IMP-03 — Kit físico de `.12`](IMP-03-kit-fisico-12.md).
El kit-v2, con kernel revisión 3 y arnés revisión 2, completó RUN8/SUBMIT8 en
dos VMs nuevas del Ryzen; ambos resultados fueron `SUCCESS` con ocho casos.
La auditoría confirmó ausencia de recursos propios e integridad del paquete
original. Los ciclos completos superaron 5 s; estas dos muestras no acreditan
p95, pruebas adversariales físicas ni integración remota. Se conservan abajo
el estado de la preparación original, sus faltantes y sus rechazos históricos.

## Identidades que se conservan

El recibo [increment-artifacts.json](../../.local/preproduction/imp-03-07/case-cost-20261117/increment-artifacts.json)
identifica `imp-03-quickjs.12`. Se mantienen sus bytes e identidades; el paquete
de transferencia y las herramientas de preparación posteriores tendrán sus
propios manifiestos, sin reincorporarlos al snapshot congelado.

| Artefacto                            | Identidad conservada                                                      |
| ------------------------------------ | ------------------------------------------------------------------------- |
| ZIP de fuentes `.12`                 | `b87b8d581936a8f1a3c0382f7593d807a6d83081539a60ab17ca85ffde97aef9`        |
| Manifiesto del snapshot              | `013232e4694d474b9631ea0e290a482c984a685994a131726853a2c5a5601b1a`        |
| Imagen final, sin perfil             | `sha256:59b49b3c72e25715373fd948634307bfcaaf112c3096b85cc46a2ae83e9d3c5b` |
| Archivo `image-final.tar`            | `dc5e996ffce5b0b6f2d6feebdf190a9023de8e4b72798677912e713d31c1772e`        |
| Bundle `runtime-final/runner.tar.gz` | `b7473369c112f71abc7856549c148dcdcbacc8216a5134ae80bd77430ee91e01`        |
| Manifiesto del bundle                | `0b722fc5775cebf70f9718574eceb1b0e511f6c49ce5f23c4afe6fe869b55053`        |

El snapshot usa su algoritmo de `runner-candidate`; el bundle declara
`quality-coverage-v1`. Sus `sourceDigest` no son intercambiables. La imagen y
el bundle reproducen los bytes identificados del ensayo local anterior;
esto no convierte aquel ensayo WSL2 en evidencia física. El
[registro de coste por caso](IMP-03-costo-por-caso.md) conserva los resultados
favorables y fallidos, sus alcances y la limpieza observada.

## Entornos observados y elegibilidad

- Estación Windows Lenovo 21G1: 12 procesadores lógicos,
  33854394368 bytes de RAM y presencia de hipervisor informada. Windows no
  satisface el preflight Linux físico. **No se infiere que la virtualización
  esté deshabilitada en firmware** a partir de estas observaciones.
- Ubuntu WSL2: kernel `6.18.58.1`, dispositivo `/dev/kvm` presente, systemd y
  `debugfs` disponibles; faltan `qemu-system-x86_64` y `qemu-img`. Aunque KVM
  exista, WSL2 sigue siendo un entorno virtualizado y queda fuera del ensayo.
- PC Ryzen 5 2600, 16 GB de RAM declarados, SSD Crucial de 240 GB
  identificado, HDD de 500 GB y GTX 1650 Super. La estimación inicial del
  SSD como 500 GB se corrigió con su modelo y capacidad. El primer arranque
  USB aprobó las comprobaciones físicas/KVM, pero carecía de QEMU.
  Después se instaló Ubuntu en el SSD y se habilitó SSH por clave.
  Con QEMU instalado y `alunza` en `kvm`, el inspector y el preflight
  congelado aprueban con código 0, sin sudo y sin iniciar una VM.
  El recibo final conserva recursos observados, versiones y resultados;
  la GPU no participa en la ejecución JavaScript.

El host elegible debe ser Linux x86-64 físico, sin WSL ni virtualización
anidada, con CPU `vmx`/`svm` sin bandera `hypervisor`, DMI verificable,
`systemd-detect-virt=none`, acceso de lectura/escritura a `/dev/kvm` con API 12,
Python y las herramientas QEMU. No hay un mínimo numérico documentado de RAM,
CPU o disco del anfitrión. Los 2 GiB son la envolvente del huésped; no una
promesa de que un host con solo esa memoria sea suficiente.

Se implementó el inspector de solo lectura `readiness.py host`, que informa todos
los checks disponibles sin arrancar VMs ni instalar herramientas. Distingue
requisitos de `run` y `prepare`, informa memoria/disco sin inventar mínimos y
conserva la autoridad del preflight existente. La ausencia de `debugfs` impide
preparar discos, pero no invalida por sí sola ejecutar un kit ya preparado.

```bash
python3 -B tests/runner/linux-single-execution/readiness.py host --scratch /var/tmp
```

El reporte usa `scope=READ_ONLY_HOST_PREPARATION`, `vmStarted=false`,
`checks` con estados `pass/fail/unknown`, `hostEligible` y
`prepareToolsAvailable` separados. Salida 0 significa host elegible, no ensayo
aprobado; salida 2 significa entorno no elegible o comprobación incompleta.

## PC propuesto y revisión del pendrive

El 17/11 se inspeccionó `D:` únicamente en lectura. Contiene Ubuntu Server
24.04.5 amd64 y cargadores UEFI; es FAT32, con 31124881408 bytes de capacidad
y 19914932224 libres. No se encontró el paquete `.12` en el pendrive ni se
probó su arranque. Se conserva el instalador Windows anterior en su carpeta.

La ISO local de Ubuntu, de 4080486400 bytes, tiene SHA-256
`97f3d7ffb032c3eb3b23d2c8be9cc76e60c2c1f2c0146ba5ba9fe01cafae0fd8`,
igual al publicado por HTTPS en [Ubuntu](https://releases.ubuntu.com/24.04.5/SHA256SUMS).
No se verificó la firma GPG. En el USB, tres de cinco imágenes squashfs
coinciden con sus sumas, pero difieren `ubuntu-server-minimal.squashfs` y
`ubuntu-server-minimal.ubuntu-server.installer.generic-hwe.squashfs`.
También difieren `casper/initrd` y `casper/hwe-initrd`. Las cuatro entradas
originales de la ISO sí coinciden con las sumas incluidas; los dos squashfs
del USB volvieron a fallar en una segunda lectura. No se atribuye una causa
física ni una modificación intencional sin evidencia.

El [recibo de revisión](../../.local/preproduction/imp-03-07/physical-readiness-20261117/usb-review-20261117.json)
vincula inventario, comprobación oficial y comparación de archivos.
Esa revisión terminó con integridad fallida, sin escribir en el pendrive.
La reparación autorizada y el diagnóstico manual posterior se documentan
a continuación. Sigue pendiente el preflight completo. No se ha realizado
una instalación ni se han indicado comandos que modifiquen los discos de
Windows; el instalador Ubuntu no sustituye las bases del huésped pendientes.

### Reparación autorizada y transferencia al USB

El usuario autorizó reparar desde la ISO verificada y copiar `.12` sin
formatear. Después aclaró que podía retirarse el instalador anterior de
Windows. Se comprobaron la identidad del volumen y el destino absoluto antes
de operar. El árbol ISO se contrastó con bsdtar: 942 archivos regulares y
tres enlaces simbólicos. En FAT32 se verificaron también los 12 archivos
materializados de `dists/stable` y `dists/unstable`; se omite el alias
recursivo `ubuntu -> .`.

La comparación completa encontró únicamente los cuatro archivos ya
identificados. Se conservaron sus bytes anteriores en respaldos locales
del proyecto y se reemplazaron desde la ISO, comprobando SHA-256 antes y
después del reemplazo. La lectura final aprobó **954/954 archivos**,
4071793617 bytes, sin diferencias. También quedan cubiertos los cargadores
UEFI, `boot.catalog` y los archivos vacíos de la ISO.

Se retiró únicamente `D:\previous-installer-11b372cf`: 1068 archivos,
7110031346 bytes lógicos. La unidad conserva FAT32 y la misma partición,
sin formateo; quedaron 26829520896 bytes libres en la observación final.

El paquete está en `D:\Alunza-12\alunza-12-physical-preparation.zip`, junto
con su archivo `.sha256`. Conserva el hash externo completo documentado
en la evidencia final de la transferencia original. Se volvió a leer desde
D:, se extrajeron sus 24 entradas a un directorio local nuevo y su verificador
aprobó las identidades del manifiesto, 928 fuentes y 271 archivos de runtime.
El estado sigue siendo **verified-transfer-not-runnable**: no se completaron
las bases pendientes ni se ejecutó una VM o se probó el arranque físico.

El [recibo de reparación](../../.local/preproduction/imp-03-07/physical-readiness-20261117/usb-repair-20261117/receipt.json)
vincula inventarios previos y finales, cambios, retirada autorizada,
verificación interna del paquete y scripts utilizados. El siguiente paso
previsto entonces era arrancar desde el USB y comprobar el host.

La [guía de arranque y diagnóstico del Ryzen](IMP-03-guia-arranque-ryzen.md)
detalla ese recorrido sin instalación ni modificaciones de Windows, con
comprobaciones cortas y un apéndice opcional del inspector en memoria.
Su copia USB está en `D:\Alunza-12\GUIA-ARRANQUE-RYZEN.md`, fuera del ZIP
inmutable. Se revisaron la sintaxis de sus comandos y los hashes publicados;
esto no acredita que se hayan ejecutado en el Ryzen.

### Observación manual del Ryzen arrancado desde USB

El 17/11 el usuario aportó fotografías de la terminal del instalador Ubuntu
arrancado en el PC indicado. La última reúne las siguientes salidas:

- `uname -smr`: `Linux 6.8.0-139-generic x86_64`.
- `systemd-detect-virt`: `none`, seguido de código `1`.
- Consulta de banderas con `grep -m1`: `svm`, sin `hypervisor` en esa línea.
  No comprueba las banderas de todos los procesadores.
- `/dev/kvm`: dispositivo de caracteres `crw-rw----`, propietario `root:kvm`.
- Python `3.12.3` y prompt de root visible; no se consultó aún el UID numérico.
- Consulta `KVM_GET_API_VERSION` mediante `fcntl.ioctl(..., 0xAE00, 0)`: `12`.

El [recibo de observación](../../.local/preproduction/imp-03-07/physical-readiness-20261117/physical-ryzen-20261117/observation.json)
enlaza una copia local de la fotografía y su SHA-256. Es evidencia visual de
órdenes realizadas por el usuario, no stdout capturado por el agente ni un
reporte del inspector completo. La consulta de versión no crea una VM.

La comprobación inicial de KVM es favorable. La evidencia posterior del
inspector se distingue a continuación. No se considera ejecutado ni aceptado
el candidato `.12` por estas salidas.

### Verificación del paquete e inspector en el Ryzen

Las fotografías posteriores muestran el ZIP en `/cdrom/Alunza-12`, su SHA-256
conocido, tmpfs con 7,8 G libres y `/proc/swaps` sin entradas. El usuario
extrajo el paquete en `/dev/shm/alunza-12.*/paquete`; el verificador con el
manifiesto fijado terminó en `verified-transfer-not-runnable`, código 0.

La [transcripción del resumen fotografiado](../../.local/preproduction/imp-03-07/physical-readiness-20261117/physical-ryzen-20261117/readiness-summary.json)
conserva la fotografía y su hash. El inspector terminó con código 2 y
`hostEligible=false`: `platform`, `kernel-native`, `virtualization`,
`cpu-virtualization`, `dmi`, `kvm-device`, `kvm-api` y `debugfs` figuran como
`pass`; `qemu-system-x86_64` y `qemu-img`, como `fail`; la autoridad del
lanzador, como `unknown`. Los errores previos de invocación y visualización
quedan visibles en la foto; después se obtuvo el resumen corregido.

La comprobación de Linux físico y KVM es favorable. El entorno completo
todavía no es elegible. La [consulta posterior de PATH](../../.local/preproduction/imp-03-07/physical-readiness-20261117/physical-ryzen-20261117/qemu-path-check.json)
conserva la fotografía con las salidas `QEMU no encontrado` y
`qemu-img no encontrado` tras las órdenes guiadas `command -v`.
Ambas herramientas no están disponibles en el PATH de esa sesión live;
no es un inventario de todos los ejecutables de todos los discos. No se
instalaron paquetes ni se indicaron cambios a Windows o arranques de VMs.
No se ha recibido aún el JSON completo del inspector, con sus campos `observed`.
UEFI sigue sin una comprobación explícita; no es un requisito del preflight
actual. Las tres bases del huésped y la ejecución `.12` siguen pendientes.

Con esto concluye el diagnóstico solicitado sin instalación: el PC pasa las
comprobaciones físicas/KVM observadas; antes del ensayo hacen falta las
herramientas QEMU del host y las bases compatibles del huésped. No se amplían
límites ni se declara aceptado el ejecutor. El informe nativo sigue en la
sesión temporal y se perderá al apagar; las fotografías y transcripciones
ya están conservadas en el proyecto.

## Instalación permanente autorizada e identificación de discos

El 17/11/2026 el usuario eligió dedicar el Ryzen al laboratorio con Ubuntu
permanente y confirmó que no hay archivos que conservar y se pueden borrar
los discos internos. Esta autorización sustituye la restricción anterior de
no instalar ni borrar Windows en ese PC; no autoriza publicar servicios,
contratar proveedores ni modificar los límites del ejecutor.

La [fotografía de identificación](../../.codex-attachments/89ff6cef-c871-4be7-aec7-5f2bba42d35b/8684b3b4-9488-4b84-93fd-017d68fbfb63/image-1794949219101.jpg)
muestra `UEFI` y el siguiente resultado de `lsblk` en la sesión live:

| Dispositivo actual | Modelo visible     | Tamaño mostrado | Tipo observado   |
| ------------------ | ------------------ | --------------- | ---------------- |
| `sda`              | `WDC WD5000AAKX-6` | 465,8 G         | HDD SATA, ROTA 1 |
| `sdb`              | `CT240BX500SSD1`   | 223,6 G         | SSD SATA, ROTA 0 |
| `sdc`              | `Disk 2.0`         | 29 G            | Pendrive USB     |

El SSD real es de 240 GB comerciales, no los 500 GB estimados previamente.
El destino propuesto para Ubuntu es ese Crucial; se identificará por modelo
y capacidad, porque los nombres de dispositivo pueden cambiar al reiniciar.
El HDD no necesita formatearse para este incremento y el USB debe conservar
el instalador y el paquete. Antes de aplicar el almacenamiento se revisará
que la raíz y el arranque EFI correspondan al SSD elegido.

Esta identificación es evidencia fotográfica transcrita, no una consulta
remota al Ryzen. El resumen posterior del instalador mostró únicamente dos
particiones nuevas en el Crucial: raíz ext4 de 222,518 G y EFI FAT32 de
1,049 G; HDD y USB figuraban con sus particiones existentes.

### Arranque instalado y preparación de SSH

El usuario informó que terminó la instalación. La [fotografía del primer inicio de sesión](../../.codex-attachments/09f4ecd2-18e7-4f10-a109-6911d2df82d5/944f1ca2-f743-43e5-b6fe-a239c3901ae5/image-1794950169820.jpg)
muestra Ubuntu 24.04.5 LTS, kernel `6.8.0-149-generic x86_64`, usuario
`alunza`, hostname `alunza-lab` y dirección LAN `192.168.1.20`.
Desde Lenovo se comprobó TCP/22 y el banner
`SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.20`; esto prueba accesibilidad,
no autenticación ni permisos del usuario remoto.

Se preparó una identidad ED25519 exclusiva en el perfil local de Lenovo,
fuera del repositorio; su clave pública todavía no está instalada en Ryzen.
La consulta de la clave pública del servidor con el `ssh-keyscan` de
Windows 9.5p2 falló por `unsupported KEX method`; la herramienta ya existente
de Git pudo obtenerla sin instalar dependencias ni cambiar el servidor.
La huella observada por red es
`SHA256:Bo7yq1sv8F4WeTorr3UCViH4Z5P+FZvIvspjOnS8Hic`.
La [fotografía de la huella desde la consola](../../.codex-attachments/6f29c830-e801-4c2c-9f31-8b0ac39a56d2/b127928f-373c-472d-9f0b-de2bf351db2f/image-1794950497957.jpg)
muestra la misma huella al ejecutar `ssh-keygen -lf` sobre la clave pública
ED25519 del servidor. Se fijó en un `known_hosts` dedicado en el perfil de
Lenovo, conservando el registro original de la consulta por red. Una conexión
con `StrictHostKeyChecking=yes`, identidad explícita y `BatchMode=yes`
comprobó el servidor, pero fue rechazada por autenticación: la clave nueva
todavía no está instalada en el Ryzen.

Se preparó `habilitar-alunza.ps1` junto a la identidad local, fuera del
repositorio. El usuario debe ejecutarlo en PowerShell del Lenovo e introducir
su contraseña directamente en el cliente SSH. El script fija destino y
huella, rechaza enlaces en `.ssh` y `authorized_keys`, conserva las claves
existentes y agrega la clave pública exacta de forma idempotente. Luego
comprueba autenticación por clave con contraseña deshabilitada. No modifica
sudo, grupos ni configuración del servidor. Su modo `-Comprobar` pasó en
Windows PowerShell 5.1; la instalación remota sigue pendiente de ejecución
por el usuario. No se solicitaron contraseñas por chat ni se abrieron puertos
del router.

### Acceso por clave, transferencia al SSD y preflight instalado

El usuario ejecutó el bootstrap y obtuvo `ACCESO_SSH_LISTO`. Se comprobó
desde Lenovo una sesión real como UID 1000 (`alunza`) con clave explícita,
pin estricto y autenticación por contraseña deshabilitada. El sistema
instalado informó Linux `6.8.0-149-generic`, Ubuntu 24.04.5 y raíz ext4
en `/dev/sdb2`, con aproximadamente 201 GiB disponibles. `sudo -n true`
fue rechazado porque requiere contraseña; no se cambió la política sudo.

Se copió el ZIP congelado a un directorio nuevo del SSD:
`/home/alunza/laboratorio/preparacion-12-20261117.JUi4A1`. Su SHA-256
coincidió antes y después del transporte. Se extrajo en `paquete` y el
verificador original aprobó 23 archivos de transferencia, 928 fuentes y
271 archivos del runtime, con salida 0 y `verified-transfer-not-runnable`.
Los reportes se guardaron fuera de `paquete`; no se alteró el candidato.

El [recibo remoto conservado en Lenovo](../../.local/preproduction/imp-03-07/physical-readiness-20261117/physical-ryzen-20261117/installed-host-preparation.stdout.json)
contiene el reporte nativo del preflight, ejecutado sin sudo sobre el
sistema instalado: salida 2, `hostEligible=false`, `vmStarted=false`.
Aprueban plataforma, kernel, detección de virtualización, CPU, DMI,
dispositivo KVM, KVM API 12 y debugfs. Fallan la disponibilidad de
`qemu-system-x86_64` y `qemu-img`; la autoridad final queda `unknown`.

El usuario todavía no figura en el grupo `kvm`, aunque tiene acceso efectivo
de lectura/escritura al dispositivo, cuyo modo muestra ACL extendida.
Se solicitaron tres comandos en su consola para actualizar el índice APT,
instalar `qemu-system-x86 qemu-utils` sin recomendaciones y agregar `alunza`
al grupo `kvm`. Son operaciones pendientes de contraseña local; no se pidió
compartirla ni se otorgó sudo sin contraseña. El índice observado ofrece
`1:8.2.2+ds-0ubuntu1.18` de `noble-updates` para ambos paquetes; todavía no
están instalados. Se comprobará la versión efectiva después de instalarlos.

El host tiene `/swap.img` de aproximadamente 4 GiB, sin uso en la consulta.
No es un rechazo del preflight actual ni modifica los límites de swap cero
dentro del huésped y de la cápsula. Se conserva sin cambios y deberá
observarse su uso durante mediciones. Continúan pendientes las tres bases
compatibles del huésped y la ejecución física de `.12`.

### Anfitrión elegible tras instalar QEMU

El usuario ejecutó los tres comandos sin errores. Una sesión SSH nueva
confirmó UID 1000 y pertenencia efectiva de `alunza` al grupo `kvm`.
`qemu-system-x86_64` y `qemu-img` informan versión 8.2.2; los paquetes
`qemu-system-x86` y `qemu-utils` tienen versión
`1:8.2.2+ds-0ubuntu1.18`. `e2fsprogs` es
`1.47.0-2.4~exp1ubuntu4.1` y `debugfs` está disponible.

Se repitió la verificación del paquete congelado y después se ejecutaron
como `alunza`, sin sudo, el inspector y el preflight del lanzador incluido
en ese paquete. Los tres comandos terminaron con código 0:

- Integridad: los mismos 23 archivos de transferencia, 928 fuentes y 271
  archivos del runtime, con el manifiesto esperado.
- Inspector: 11/11 comprobaciones `pass`, `hostEligible=true`,
  `prepareToolsAvailable=true` y `vmStarted=false`.
- Preflight congelado: `host-eligible-not-executed`, Linux físico,
  `systemd-detect-virt=none`, KVM API 12 y ambas herramientas QEMU versionadas.

El [recibo final del anfitrión](../../.local/preproduction/imp-03-07/physical-readiness-20261117/physical-ryzen-20261117/installed-host-ready-receipt.json)
conserva argumentos, códigos de salida, stdout/stderr, grupos, versiones,
recursos, observación de swap y hashes de cada archivo de evidencia. Su
SHA-256 es `96e16e43980888e11b9ba5457a4b82572f600ee7b0143653645b834bb0981de7`.
Los originales también están en
`/home/alunza/laboratorio/preparacion-12-20261117.JUi4A1/host-verification-j623uhix`
en el Ryzen. Los fallos previos se conservan como observaciones históricas.

Queda cerrada la preparación del anfitrión para este candidato. No se
ejecutó una VM ni RUN8/SUBMIT8; siguen pendientes el kernel compatible,
la raíz ext4 virgen y el almacén ext4 con la imagen `.12` exacta. El kernel
del host no sustituye automáticamente al kernel del huésped. No se
alteraron los límites, la cápsula, el bundle ni la arquitectura productiva.

## Artefactos del huésped que faltan

Faltan un kernel compatible, una raíz ext4 virgen y un almacenamiento Docker
ext4 virgen. La raíz debe incluir systemd, Node exacto del bundle, Docker
CLI/daemon, tar, mount y crun 1.31 o runc 1.3.4 fijado por hash. Docker debe
usar cgroup v2 y driver `systemd`; su almacenamiento debe contener exactamente
la imagen final `.12`, sin contenedores, trabajos, secretos ni código previo.

La inspección del [kernel histórico](../../.local/preproduction/imp-03-07/linux-native-kvm-20261113/kernel)
encontró `# CONFIG_FW_CFG_SYSFS is not set`. Tiene 15795200 bytes y SHA-256
`4845ac8718804c91f3b5cbb9c09c856732612af4e1729faf402f727b0f3285b6`.
Ese kernel no expone el canal sysfs `qemu_fw_cfg` que lee el supervisor nuevo;
no constituye un sustituto compatible. No copiar sus bases como si fueran
artefactos del candidato `.12`. El kernel nuevo debe permitir NVMe, ext4,
cgroup v2 y `qemu_fw_cfg` accesible por sysfs. El lanzador no entrega initrd:
NVMe/ext4 deben estar disponibles desde el arranque y `qemu_fw_cfg` antes de
la admisión; un kernel de distribución con esos drivers solo como módulos
no es automáticamente compatible.

La [interfaz sysfs documentada por Linux](https://www.kernel.org/doc/Documentation/ABI/testing/sysfs-firmware-qemu_fw_cfg)
es el canal usado por el huésped. La raíz histórica tampoco contiene systemd;
su glibc 2.36 no satisface GLIBC_2.38 exigido por el runc y `libnftables`
disponibles, según sus tablas ELF. Los archivos de binarios y dos bibliotecas
son insumos identificados, no una raíz completa. Se copió además el CLI
Docker Linux existente, sin instalarlo. No se exportó ningún sistema vivo.

La imagen `.12` se identifica por su índice OCI, no por el digest de su
configuración. La preparación debe conservar ese ID y el almacenamiento
[containerd compatible con índices y attestations](https://docs.docker.com/engine/storage/containerd/).
El motor WSL usó containerd externo y rutas distintas; no basta copiar aquel
almacén ni cargar la imagen en un backend clásico. Este incremento conserva
la cápsula y exige resolver la nueva raíz/almacén, sin convertir la imagen.

El descriptor pendiente conserva `virginBase=false` y los campos desconocidos
sin completar. Una declaración de base virgen requiere procedencia real y
no equivale a inspección forense. Sin los tres artefactos, sus tamaños y
hashes verificados, no se preparará ni arrancará un huésped.

## Transferencia offline y entrada del operador

El paquete preparado transporta el ZIP congelado, la imagen final, el
bundle con su manifiesto, el arnés y el inspector, incluida la dependencia
`linux-native-kvm/launch.py` usada por el preflight. Incluye un descriptor
pendiente y un inventario de integridad propio. No transporta secretos,
configuración privada ni el directorio `.local` completo. **No es todavía un
kit de VM ejecutable**: contiene componentes preparados y faltantes explícitos.

1. Contrastar el hash externo conocido del paquete antes de extraer; después,
   verificar cada artefacto contra el inventario y los hashes `.12` anteriores.
2. Ejecutar el inspector en el host físico propuesto y conservar su reporte
   completo. No instalar ni cambiar firmware como efecto implícito del check.
3. Suministrar las tres bases compatibles y su descriptor real; ejecutar
   `prepare` en un directorio nuevo y conservar el hash emitido del manifiesto.
   Solo se modifican copias; snapshot, imagen y bases originales permanecen intactos.
4. Seguir el guion físico existente: RUN8 y SUBMIT8 en dos VMs secuenciales,
   nuevas y desechables. Conservar todos los fallos y detener el guion si RUN8 falla.
5. Conservar `admission.json`, `events.jsonl`, `report.json` y recibo del comando.
   No borrar una marca de recursos inciertos para repetir sin verificar su ausencia.

## Límites y alcance de una futura observación

La VM y la frontera conjunta conservan 1 vCPU/2147483648 bytes; cada cápsula,
134217728 bytes agregados, swap cero y 32 tareas. Cada caso usa una cápsula
nueva. El intento completo conserva 3000 ms y 65536 bytes combinados de salida.
El presupuesto disminuye por la suma previa parse→close; no se descuentan
bootstrap, fases confiables ni cierre para permitir ocho casos.

Desde antes de crear overlays rigen 30 s de operación, 40 s de cierre inicial
y TTL absoluto de 60 s. Readiness no reinicia esos relojes. Se exige retirar
QEMU y overlays, confirmar ausencia y conservar bases intactas. El guion
físico no acepta p95, API/SQL, recuperación ante SIGKILL del guardián ni el
instante de última instrucción física por aprobar dos funciones de suma.

## Evidencia final del incremento

El [ZIP de transferencia](../../.local/preproduction/imp-03-07/physical-readiness-20261117/alunza-12-physical-preparation.zip)
contiene 24 archivos y 209321285 bytes. SHA-256:
`d9d5e49f24a91871193ea34eb2ee4a71e042140972facad5399d7000d71364a5`.
Su manifiesto tiene SHA-256
`bcc5a938a6f303f545da3e74c7f75934487d8666e5a305f0687336b93d33a45e`.
Se verificaron transferencia, extracción a otro directorio e inventario;
estado final **verified-transfer-not-runnable**. El verificador pasó en
Windows y WSL2, y ocho comprobaciones cubrieron corrupción, mezcla, rutas y
rechazo de preparación incompleta. Sus primeros fallos se conservaron.

Pasaron 28 pruebas focales Jest, incluidas las 10 pruebas Python del inspector;
estas últimas también pasaron en WSL2. Ambos reportes reales de host tienen
11 checks y salida 2, sin VM iniciada. El [recibo de preparación](../../.local/preproduction/imp-03-07/physical-readiness-20261117/preparation-receipt.json)
vincula paquete, inventario y reportes. No se repitieron las pruebas de producto
del incremento anterior ni se atribuye aceptación física, p95 o académica.
