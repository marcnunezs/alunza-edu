# IMP-03.07 — Disponibilidad de la VM Linux y arranque de cada cápsula

## Estado del ensayo

El 13/11/2026 se inspeccionó la estación desde la que se ejecutó el [perfil de VirtualBox](IMP-03-latencia-linux.md). El anfitrión es Windows 11 Pro. Su Ubuntu ya activo usa WSL2 y la CPU expone tanto `vmx` como `hypervisor`. El dispositivo `/dev/kvm` respondió con la versión 12 de la API del kernel. La consulta no creó una VM. Un QEMU ejecutado desde esa distribución añadiría un huésped dentro de la VM administrada por Windows. La referencia para esta comparación requiere Linux como anfitrión físico. [Recibo local](../../.local/reports/imp-03-07/linux-native-host-preflight-20261113.json) · [Arquitectura de WSL2 según Microsoft](https://learn.microsoft.com/en-us/windows/wsl/compare-versions) · [Consulta de disponibilidad de KVM](https://docs.kernel.org/virt/kvm/api.html).

| Medición solicitada                                         | Estado en la estación inspeccionada            |
| ----------------------------------------------------------- | ---------------------------------------------- |
| Arranque de una VM precargada hasta estar lista para SUBMIT | Pendiente de un anfitrión Linux físico con KVM |
| Arranque de la cápsula del caso visible                     | Pendiente                                      |
| Arranque de la cápsula del caso oculto                      | Pendiente                                      |

La traza anterior conserva el tiempo conjunto de los dos arranques. Dividir ese total por dos no permite reconstruir cuánto tardó cada cápsula. Se probó la comprobación previa del lanzador en Windows y en Ubuntu sobre WSL2; ambos devolvieron el código de entorno no apto antes de lanzar QEMU. Las cuatro pruebas del arnés de latencia y las siete pruebas del lanzador pasaron sin arrancar VMs.

El panel de Hostinger mostró una VPS activa del plan KVM 2 con la plantilla Ubuntu 24.04 con Docker y Traefik. Hostinger deshabilita la virtualización anidada en sus planes VPS. Por tanto, este destino tampoco admite el arranque de la VM del ensayo. Se verificó el plan mediante consulta del panel, sin acceder por SSH ni ejecutar cargas en la VPS. Un perfil posterior de Docker directamente en ese servidor solo podría medir la parte de cápsulas de un Linux ya arrancado. [Soporte oficial de Hostinger](https://www.hostinger.com/support/10429687-is-nested-virtualization-supported-in-hostinger/).

## Método para el anfitrión Linux

El ensayo utiliza 1 vCPU, 2048 MiB, la imagen fijada del perfil anterior y el mismo ejercicio sintético. El huésped carece de interfaz de red externa. Docker y su almacén viven dentro de sus discos de trabajo. Un primer arranque prepara la imagen. El cronómetro de disponibilidad se inicia al lanzar QEMU para el arranque precargado y termina al recibir en la consola privada el marcador `LATENCY_READY`. Ese marcador se emite después de cargar el runner, comprobar el motor y resolver la identidad de la cápsula. La concordancia del UUID entre anfitrión y huésped y la confirmación del acelerador por QMP identifican la VM que se midió. [Información de aceleración de QEMU](https://www.qemu.org/docs/master/interop/qemu-qmp-ref.html#accelerators).

Cada SUBMIT ejecuta primero el caso visible y después el oculto. Cada caso recibe una cápsula nueva. Se mide por separado el tiempo desde la petición de arranque al motor hasta su confirmación; la fase de creación del contenedor dispone de su propio contador. El invitado informa del primer SUBMIT y de las 50 repeticiones posteriores, preservando los diagnósticos de fallo y los arranques ausentes. Los percentiles por ordinal se calculan sobre observaciones efectivas e indican cuántas faltaron. Los relojes interiores y el reloj de disponibilidad del anfitrión se presentan por separado. [Arnés de las cápsulas](../../tests/runner/linux-latency.cjs).

## Ejecutar el paquete en un equipo físico del laboratorio

El archivo transportable contiene el kernel, dos imágenes de disco ext4, el lanzador y su manifiesto. Se comprobó en lectura el sistema de archivos de ambos discos y se contrastaron el runner, el arnés y el init dentro de la imagen. El almacenamiento se precarga dentro del huésped durante el ensayo. Las imágenes de base permanecen intactas. [Paquete del ensayo](../../.local/preproduction/imp-03-07/linux-native-kvm-20261113/linux-kvm-guest.tar.gz) · [Manifiesto](../../.local/preproduction/imp-03-07/linux-native-kvm-20261113/guest-manifest.json).

En un Linux x86-64 con Python 3.9 o posterior, `systemd-detect-virt`, QEMU, `qemu-img` y acceso del usuario a `/dev/kvm`, ejecutar los comandos siguientes desde el directorio donde se copiaron el archivo y su [suma SHA-256](../../.local/preproduction/imp-03-07/linux-native-kvm-20261113/linux-kvm-guest.tar.gz.sha256). El directorio de resultados debe ser nuevo.

```bash
sha256sum -c linux-kvm-guest.tar.gz.sha256
mkdir alunza-kvm
tar -xzf linux-kvm-guest.tar.gz -C alunza-kvm
cd alunza-kvm
python3 launch.py --preflight
python3 launch.py --kit . \
  --manifest-sha256 bb568a0227bb977867dcb69d6b4e795b6ed9f6fe5e40043a1135aa543882f62a \
  --out ../resultado-alunza-kvm
```

El resultado debe vincular la aceleración KVM activa, el UUID del arranque y las lecturas de ambas cápsulas. El primer uso se informa aparte de las 50 repeticiones. Un único tiempo de disponibilidad corresponde a una observación de arranque. [Lanzador local](../../tests/runner/linux-native-kvm/launch.py).
