# Ejecutor VM local .13

Transporte experimental opt-in para la API local/test; AD-ARQ-001 y el proveedor productivo no cambian. Usa una VM KVM nueva por ejecución completa RUN/SUBMIT y el runner, bundle e imagen `.13` sin modificarlos. Cada caso conserva una cápsula nueva y los límites acumulados originales.

El incremento posterior de navegador/capacidad aprobó 48/48 pruebas Chrome, con p95 visible RUN8/SUBMIT8 de 4761,700/4515,800 ms. El puesto durable por host permite una sola VM simultánea entre réplicas: 24 ofertas produjeron ocho admisiones y 16 rechazos `503 RUNNER_BUSY` sin estado durable. Solo una prueba correlacionada de retiro libera el puesto; no hay cola ni expiración que lo libere por sí sola. La UI conserva la solicitud para reintento manual y distingue respuesta incierta. Véanse el [registro y limitaciones](../../../docs/work/IMP-03-navegador-capacidad-13.md) y la [guía de reproducción](../../../docs/guides/validacion-local-navegador-13.md).

En la campaña HTTP física del 17/11/2026, API/Auth/PostgreSQL reales del Ryzen aprobaron 40/40 normales: 20 RUN8 con p95 de 4597,111313 ms y 20 SUBMIT8 con p95 de 4389,107517 ms. Aprobaron nueve gates con 47 VMs nuevas y un gate adicional de reinicio de API con una VM más, recuperación durable y replay sin reejecución. Perfil caliente, secuencial y loopback; no acredita navegador, concurrencia ni RNF remoto. Véase el [expediente físico](../../../docs/work/IMP-03-api-fisica-13.md).

## Preparación y arranque explícitos

`prepare.py` necesita Python y `debugfs`. Recibe un kit virgen declarado,
verifica su manifiesto externo y las tres bases, copia a una ruta nueva e instala
solo `guest.cjs` y `protocol.cjs`. Verifica por lectura los bytes instalados y el
bundle .13. No arranca VM, monta discos ni exporta un anfitrión vivo.

```sh
python3 -B prepare.py --source-kit /ruta/kit-13 \
  --source-manifest-sha256 HASH_VERIFICADO --out /ruta/nueva/kit-api

# Crear previamente rutas propias con permisos 0700. El socket debe estar
# dentro de una de ellas; no usar directorios o sockets de otros proyectos.
python3 -B broker.py --kit /ruta/nueva/kit-api \
  --manifest-sha256 HASH_NUEVO --state /ruta/privada/state \
  --scratch /dev/shm/directorio-propio --socket /ruta/privada/broker.sock \
  --host-id UUID_CONFIGURADO
```

El broker requiere Linux, `memfd`, `pidfd`, QEMU/KVM y un mismo UID para el
cliente API. El socket queda 0600; comprueba `SO_PEERCRED`. No escucha TCP.
El proceso es local y explícito; estos scripts no instalan servicios.

Al arrancar copia kernel/raíz/store a `memfd`, añade los sellos
`F_SEAL_WRITE|F_SEAL_GROW|F_SEAL_SHRINK|F_SEAL_SEAL` y verifica SHA256 sobre las
copias ya selladas. Cada admisión revalida sellos y tamaño. QEMU y `qemu-img`
heredan únicamente los descriptores necesarios y usan `/proc/self/fd/N` como
base; sus overlays son nuevos. Cambiar el archivo fuente después no cambia la
base sellada. Esto consume memoria adicional del anfitrión; no cambia los
2048 MiB ni la vCPU del huésped. El tiempo de inicio del broker se registra
separadamente del recorrido por petición; un broker frío aún no está disponible.

## Protocolo privado

HTTP POST sobre UDS, JSON estricto, cuerpo máximo 2 MiB, respuesta máximo 1 MiB.
No credenciales de API/BD/SSH entran al huésped. Los errores son códigos fijos.

| Ruta        | Solicitud / respuesta                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| `/inspect`  | `{}` → `{available,context}`                                                                               |
| `/prepare`  | `{executionId,creationId,context,normalDeadlineMs,cleanupDeadlineMs,inputSha256}` → `{resourceId,context}` |
| `/start`    | `{executionId,creationId,resourceId,context,inputJson}` → `{result,resource,cleanupVerified,vmEvidence}`   |
| `/status`   | `{executionId,creationId,resourceId,context}` → `{state,resource,cleanupVerified,result}`                  |
| `/cleanup`  | Misma identidad; `resourceId:null` permitido → `{cleanupVerified,resource,proof}`                          |
| `/snapshot` | `{}` → `{schemaVersion,context,records,totals}` sin código ni tests                                        |

`context` tiene exactamente `provider:'local-vm'`, `image`, `runnerVersion`,
`hostId`, `kitManifestSha256`, `brokerVersion:'local-vm-broker-v1'`, `guestSha256`,
`brokerGeneration`. `resource` contiene executionId/creationId/resourceId/context.
`resourceId` es la UUID de la VM. `inputSha256` corresponde al UTF-8 exacto de
`inputJson=JSON.stringify(ExecutionInput)`; no hay canonicalización entre lenguajes.
El JSON interior admite hasta 1572864 bytes. El código sigue limitado a 65536.

`prepare` no crea VM ni recibe código. La API debe registrar el recurso y
revalidar su lease antes de `start`. El estado STARTING se sincroniza a disco
antes de entregar el payload; ninguna repetición, reconexión o recuperación
vuelve a ejecutar ese executionId. `cleanup` previo a `prepare` deja una marca
CLOSED durable que bloquea una admisión tardía. La recuperación acepta un
contexto de generación anterior para retirar, nunca para ejecutar.

El resultado conserva `evidence.provider='docker'`: describe las cápsulas
internas. `vmEvidence` añade bootId/executionId/creationId, hostId/generación,
kit/image/runnerVersion, QMP `{vcpus:1,memoryBytes:2147483648,network:false}`,
envelope observado de siete campos, `capsulesClean`, `qemuReaped`,
`overlaysAbsent`. El cliente Node debe validar su schema completo antes de
persistir y proyectar; este resultado privado no es un DTO público.

## Retiro y recuperación

El guardian es un proceso separado y conserva el bloqueo y las bases aunque
muera el broker. Convierte una vez los plazos absolutos a reloj monotónico:
30 s operación, 40 s limpieza, 60 s TTL externo. Un watchdog independiente
observa su pidfd; QEMU además usa `PDEATHSIG=SIGKILL`. El guardian captura el
resultado, termina/recolecta QEMU y retira únicamente su directorio antes de
devolverlo. La evidencia mantiene el tiempo real, incluso si supera 3000 ms.

Un resultado parcial/fallido no se convierte en éxito durante recuperación.
Se retiran procesos únicamente con PID/start-time/boot-id o UUID y cwd propios;
si no se demuestra retiro, la siguiente admisión queda bloqueada. Las marcas
durables no se eliminan automáticamente. Los archivos de estado pueden incluir
resultados privados; deben permanecer bajo permisos 0700/0600 y no publicarse.
El stderr técnico de QEMU se limita a 32 KiB en un archivo privado, separado de
la respuesta HTTP y de logs generales.

## Comprobaciones locales

```sh
python3 -B -m unittest discover -s tests/runner/linux-vm -p 'test_*.py' -v
node --test tests/runner/linux-vm.test.cjs
```

Las pruebas Linux usan memfd/pidfd/UDS reales y procesos inertes propios; no
ejecutan QEMU, Docker ni programas estudiantiles en el anfitrión. Las bases memfd ya arrancaron con QEMU 8.2.2 del Ryzen: RUN8/SUBMIT8, cinco
adversariales y recuperación del broker pasaron, según el
[expediente físico](../../../docs/work/IMP-03-api-fisica-13.md). El recorrido
HTTP con Auth/persistencia, replay, conflicto, pérdida de respuesta, recuperación
y limpieza también está verificado allí; el [incremento posterior](../../../docs/work/IMP-03-navegador-capacidad-13.md)
añade navegador y capacidad compartida entre dos API.
La medición de API debe incluir hasta el último byte HTTP, sin excluir errores
ni sustituirla por `completeMs` del guardian.

Fundamento de los mecanismos: [memfd y sellos](https://man7.org/linux/man-pages/man2/memfd_create.2.html),
[herencia explícita de descriptores](https://docs.python.org/3/library/subprocess.html),
[bases qcow2](https://www.qemu.org/docs/master/system/qemu-block-drivers.html).
