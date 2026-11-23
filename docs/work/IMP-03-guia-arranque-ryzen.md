# Arrancar el Ryzen desde USB y comprobar Linux físico y KVM

Guía preparada el 17/11/2026 para el PC Ryzen 5 2600 con 16 GB de RAM y el
pendrive Ubuntu Server 24.04.5 reparado. El objetivo es observar el hardware;
no instalar Ubuntu, ejecutar VMs ni modificar los discos de Windows.
No hace falta conexión a Internet para estas comprobaciones.

1. **Preparar el equipo apagado.** Conecta alimentación, monitor y teclado.
   Conecta el monitor a la GTX 1650 Super y enchufa el pendrive al PC.
   Ten esta guía abierta en el teléfono o en el portátil.

2. **Abrir el menú de arranque puntual.** Enciende el PC y pulsa la tecla
   indicada en su primera pantalla como Boot Menu o menú de arranque. La
   tecla depende de la placa; no conocemos todavía su modelo. Si Windows
   arranca, apágalo normalmente y vuelve a intentarlo. No hace falta cambiar
   permanentemente el orden de arranque.

3. **Elegir el pendrive en modo UEFI.** Selecciona la entrada que empiece por
   `UEFI:` y corresponda al USB, posiblemente identificado como USB Disk 2.0
   o ESD-USB. La letra `D:` es de este equipo Windows y no aparecerá allí.
   No selecciones Windows Boot Manager para esta prueba. Si el USB no aparece
   en modo UEFI, anota el modelo de placa y las opciones visibles; no cambies
   Secure Boot, CSM, el modo SATA ni otras opciones para forzarlo.

4. **Arrancar Ubuntu y abrir una terminal.** En el menú de Ubuntu elige
   **Try or Install Ubuntu Server**, la opción normal. Espera a que aparezca
   la pantalla del instalador. Aunque el nombre incluya Install, entrar aquí
   todavía no instala Ubuntu. Pulsa **F2** o usa **Help → Enter shell**.
   Si hace falta, selecciona primero el idioma; no avances hasta almacenamiento.
   Ubuntu Server muestra una interfaz de texto, no un escritorio gráfico.
   El acceso a la terminal está documentado por
   [Canonical](https://canonical-subiquity.readthedocs-hosted.com/en/latest/tutorial/operate-server-installer.html).

5. **Comprobar el sistema arrancado.** Ejecuta estas líneas en la terminal:

   ```bash
   uname -smr
   test -d /sys/firmware/efi && echo UEFI || echo "UEFI no detectado"
   systemd-detect-virt
   echo "codigo=$?"
   ```

   Esperamos `Linux`, `x86_64`, un kernel sin `microsoft` ni `WSL`, y `UEFI`.
   Para `systemd-detect-virt`, esperamos **`none` y `codigo=1`**. Aquí el 1 es
   el resultado esperado de no detectar virtualización; no hay que corregirlo
   como si fuera un fallo del PC. Si aparece `oracle`, `kvm`, `microsoft`,
   `wsl` u otro identificador, conserva la salida y no lo marques como host
   físico válido. [Referencia de systemd](https://www.freedesktop.org/software/systemd/man/latest/systemd-detect-virt.html).

6. **Comprobar la CPU y el dispositivo KVM.** Ejecuta:

   ```bash
   LC_ALL=C lscpu | grep -E 'Architecture|Model name|Virtualization|Hypervisor'
   grep -m1 -o -E '\b(svm|vmx|hypervisor)\b' /proc/cpuinfo
   ls -l /dev/kvm
   id -u
   python3 --version
   ```

   En el Ryzen esperamos `AMD-V` y la bandera **`svm`**, sin `hypervisor`.
   `/dev/kvm` debe existir como dispositivo de caracteres: la primera letra
   de su línea en `ls -l` será `c`. `id -u` indica el usuario efectivo;
   `0` significa que la terminal ya es root. Si falta Python o el dispositivo,
   anota la salida y consulta la tabla de resultados; no instales herramientas.

7. **Consultar KVM sin crear una VM.** Si Python y `/dev/kvm` existen:

   ```bash
   python3 -B -c 'import fcntl; f=open("/dev/kvm","rb+",buffering=0); v=fcntl.ioctl(f.fileno(),0xAE00,0); f.close(); print("KVM_API =",v)'
   ```

   El resultado esperado es **`KVM_API = 12`**. La orden abre el dispositivo,
   consulta `KVM_GET_API_VERSION` y lo cierra; no llama a `KVM_CREATE_VM`.
   Es el número de API estable documentado por
   [Linux KVM](https://www.kernel.org/doc/html/latest/virt/kvm/api.html#kvm-get-api-version).

   Solo si aparece `PermissionError` y `id -u` no era 0, prueba la misma
   consulta con los permisos temporales de la sesión live:

   ```bash
   sudo -n python3 -B -c 'import fcntl; f=open("/dev/kvm","rb+",buffering=0); v=fcntl.ioctl(f.fileno(),0xAE00,0); f.close(); print("KVM_API =",v)'
   ```

   Si `sudo -n` falla o pide autorización, anota ese fallo; no es un resultado
   sobre KVM. Que la consulta funcione con sudo demuestra acceso como root,
   no que el usuario sin privilegios tenga ese permiso. No cambies grupos ni
   permisos de `/dev/kvm` para completar este diagnóstico.

8. **Conservar los resultados.** Antes de apagar, anota o fotografía el modelo
   de CPU, kernel, resultado de virtualización y su código, bandera `svm`,
   línea de `/dev/kvm`, UID utilizado y respuesta `KVM_API`. Incluye cualquier
   error literal. No hace falta montar discos Windows ni escribir logs en ellos.
   Si todo coincide, tenemos una comprobación inicial favorable de Linux
   físico y KVM. La aceptación del ejecutor `.12` continúa pendiente.
   Si quieres realizar el apéndice opcional del inspector completo, hazlo
   ahora, antes de apagar en el paso 9.

9. **Apagar y volver a Windows.** Desde la terminal ejecuta:

   ```bash
   sudo -n poweroff
   ```

   Si ya eras root y sudo no está disponible, usa `poweroff`. Sigue cualquier
   aviso de retirada del medio durante el apagado. Con el equipo apagado,
   desconecta el USB. Al encender de nuevo, deja el arranque habitual de
   Windows; si aparece Windows Boot Manager puedes seleccionarlo. No es
   necesario instalar ni desinstalar nada.

No pulses opciones como Use entire disk, Erase disk, configuración de
particiones o confirmación de instalación. Si llegas a esa pantalla, no
confirmes cambios: vuelve a la terminal. La guía no incluye `apt install`,
formateos, montaje de particiones Windows, cambios de firmware ni `modprobe`.

| Resultado                                                           | Cómo interpretarlo y qué conservar                                                                                                            |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`, `svm`, dispositivo KVM y API 12                             | Observación inicial favorable; falta el inspector completo y el ensayo del candidato.                                                         |
| `systemd-detect-virt` devuelve 1 y muestra `none`                   | Esperado para este ensayo físico.                                                                                                             |
| Falta `svm`, `/dev/kvm` o falla la consulta                         | Comprobación pendiente. Puede intervenir firmware, el kernel o la exposición del módulo; no demuestra por sí solo que el PC sea incompatible. |
| Funciona únicamente con sudo                                        | KVM accesible como root; el acceso sin privilegios sigue pendiente.                                                                           |
| USB no visible, error de Secure Boot o pantalla de arranque fallida | Anotar el mensaje y el modelo de placa. No cambiar seguridad/almacenamiento ni iniciar una instalación para resolverlo.                       |

## Opcional: ejecutar el inspector completo del paquete .12

Este apartado añade DMI, herramientas QEMU y el preflight del candidato.
También es local y no inicia VMs. Es opcional para la primera comprobación.
Ejecuta cada bloque por separado y continúa solo si obtiene lo esperado.

La sesión live suele montar el USB en `/cdrom`. Primero comprueba la ruta:

```bash
ls /cdrom/Alunza-12/alunza-12-physical-preparation.zip
findmnt -no FSTYPE /dev/shm
cat /proc/swaps
df -h /dev/shm
```

Debe existir el ZIP, `/dev/shm` debe ser `tmpfs` y `/proc/swaps` debe mostrar
solo la cabecera, sin intercambios activos. Reserva aproximadamente 1 GB
libre en ese tmpfs para extraer los 436393582 bytes del paquete y trabajar
con margen. Esto es espacio temporal para esta comprobación, no un nuevo
mínimo de RAM del host ni un cambio de límites del ejecutor. Si alguna
condición falta, detén este apartado y conserva las comprobaciones cortas.
No montes ni uses una partición Windows como alternativa.

Verifica el ZIP contra la huella conocida externa:

```bash
alunza_media=/cdrom/Alunza-12
printf 'd9d5e49f24a91871193ea34eb2ee4a71e042140972facad5399d7000d71364a5  %s\n' "$alunza_media/alunza-12-physical-preparation.zip" | sha256sum -c -
```

Solo continúa si informa `OK`. Extrae en un directorio nuevo de memoria:

```bash
alunza_tmp=$(mktemp -d /dev/shm/alunza-12.XXXXXX)
mkdir "$alunza_tmp/paquete"
python3 -B -m zipfile -e "$alunza_media/alunza-12-physical-preparation.zip" "$alunza_tmp/paquete"
cd "$alunza_tmp/paquete"
python3 -B verify.py --expect bcc5a938a6f303f545da3e74c7f75934487d8666e5a305f0687336b93d33a45e
echo "codigo=$?"
```

El resultado debe ser `verified-transfer-not-runnable`, con `vmExecuted=false`.
Aquí esperamos `codigo=0`; cualquier error o código diferente detiene el apéndice.
Indica integridad; los faltantes de host/kernel/discos enumerados en este
verificador describen el alcance del paquete, no un diagnóstico nuevo del PC.
No ejecutes sus binarios de `build-inputs` ni comandos `prepare` o `run`.

Ejecuta ahora el inspector y guarda su informe fuera del paquete, en memoria:

```bash
python3 -B tests/runner/linux-single-execution/readiness.py host --scratch "$alunza_tmp" > "$alunza_tmp/host-readiness.json"
alunza_rc=$?
cat "$alunza_tmp/host-readiness.json"
printf 'codigo=%s\n' "$alunza_rc"
```

Un código **0** significa `hostEligible=true`, con `vmStarted=false`: el host
pasa el preflight, pero todavía no se ha ejecutado el candidato. Un código
**2** indica un requisito faltante o una observación incompleta; conserva
los checks `fail/unknown`, sin cambiar el resultado para hacerlo pasar.

Si CPU, DMI y KVM pasan y solo faltan `qemu-system-x86_64`/`qemu-img`, el PC
puede servir físicamente aunque esta sesión USB aún no tenga las herramientas
del ensayo. `launch-host-authority` también puede fallar por esa misma falta.
La ausencia de `debugfs` afecta a preparar bases, no a ejecutar un kit ya
preparado. No instales nada durante esta guía.

Si necesitas repetir únicamente el inspector con sudo por un error de
permisos KVM, conserva por separado la salida anterior y la nueva e indica
con qué UID se ejecutó cada una. No reemplaces la observación sin privilegios.

Los archivos en `/dev/shm` se perderán al apagar; conserva el resultado antes
del paso 9. No hace falta copiarlo a Windows ni modificar el pendrive. El
paquete conserva sus límites y siguen pendientes las bases compatibles del
huésped y la ejecución real de `.12`.
