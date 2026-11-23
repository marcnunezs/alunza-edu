# IMP-03 — Guion de validación en Linux físico

Fecha: 17/11/2026, America/Santiago. Estado: **RUN8 y SUBMIT8 aprobados en dos
VMs nuevas del Ryzen, con kit-v2 y arnés revisión 2**. El [registro del kit
físico](IMP-03-kit-fisico-12.md) conserva `attempt-02`, las identidades y los
fallos anteriores. Cada muestra terminó con salida 0, `measured`, `SUCCESS`
y ocho casos; la meta de 5 s, la batería adversarial física y la integración
remota siguen pendientes. Dos muestras no acreditan p95.
El [arnés](IMP-03-vm-por-ejecucion.md) conserva una VM nueva por
ejecución y una sola VM simultánea. Esta comprobación acota RF-009/010/011,
RNF-REN-02/SEG-04 y DEC-003; no acepta por sí sola las
[puertas G1–G6](IMP-03-decision-ejecutor-2026-11-16.md#puertas-de-aceptación).

La [preparación de entrada de `.12`](IMP-03-preparacion-fisica-12.md) registra
los artefactos verificados, el paquete offline y los rechazos de Windows,
WSL2 y del kit histórico. El inspector nuevo complementa este preflight;
no cambia los controles ni convierte un paquete incompleto en un kit de VM.
El kit finalmente medido usa kernel revisión 3, raíz virtio y almacén NVMe;
su manifiesto tiene SHA-256
`c3275243ff75f5fcfee43f26c691684c8145588fc13a59dfd4edb6aaec7ebb0f`.
La revisión del arnés se identifica por separado del snapshot, la imagen y
el bundle `.12`, que permanecen intactos, con los mismos límites.

## Antes de medir

1. Congelar las fuentes que se van a comparar, conservando el HEAD base y la
   identidad del árbol con cambios. El bundle usa `quality-coverage-v1`; no
   intercambiar ese digest con el del snapshot `runner-candidate`. Restaurar
   fuentes y verificar su manifiesto antes de instalar/build; seguir el
   [procedimiento del candidato](IMP-03-candidato-reproducible.md). Usar las
   dependencias y versiones fijadas por el lockfile, sin actualizarlas para
   ejecutar este guion.
2. Conservar los resultados del mismo candidato para watchdog, salida
   acumulada, memoria directa/descendientes, identidad nativa y ausencia de
   privilegios. Las pruebas offline comprueban rechazo de recibos y contratos;
   **no ejecutan** esos ataques en hardware físico. Un TIMEOUT, OUTPUT_LIMIT,
   MEMORY_LIMIT o CAPABILITY_GAP no puede convertirse en éxito de la suma de
   ocho casos. La batería adversarial física sigue pendiente por separado.
3. Construir y verificar la cápsula desde esas fuentes. `worker.cjs`,
   `bridge.cjs` y sus módulos `.cjs` viajan en la imagen, no en el bundle del
   supervisor. Anotar su ID `sha256:...` real y la procedencia de construcción;
   un ID identifica bytes, pero no demuestra por sí solo que procedan del
   árbol declarado. No reutilizar la imagen del kit histórico ni una etiqueta
   mutable como evidencia. Para A/B, registrar por separado ambos candidatos
   e instrumentar ambos de la misma forma.
4. Crear el bundle con el comando siguiente, en un destino nuevo. Su manifiesto
   fija fuentes, inventario SHA-256, lockfile, Node y npm. Captura `dist/*.js`,
   `infra/runner/*.mjs` y Zod. Si aparece otra dependencia de ejecución local,
   ampliar/verificar ese inventario antes de preparar el huésped; no resolverla
   mediante descarga dentro de la VM.

```bash
python3 -B tests/runner/linux-single-execution/launch.py bundle --out /ruta/nueva/bundle
```

5. Suministrar kernel x86-64 y bases ext4 limpias compatibles, sin secretos,
   trabajos ni contenedores previos. El kernel debe exponer NVMe, ext4,
   `qemu_fw_cfg` y cgroup v2; la raíz incluye systemd, Node de la versión exacta
   del manifiesto, Docker y el ELF de crun 1.31 o runc 1.3.4 con hash fijado.
   Docker debe funcionar con `OSType=linux`, cgroup v2, driver `systemd` y
   socket Unix privado. La base Docker contiene la imagen exacta anterior.
   Completar una copia privada de `artifacts.example.json` con hashes/tamaños
   reales y los hashes del bundle. `virginBase=true` es declaración de
   procedencia del preparador, no una inspección forense automática.
6. Ejecutar `prepare` en un directorio nuevo. Solo modifica copias, instala
   los bytes del supervisor y verifica lo instalado con `debugfs`. Conservar
   los hashes de bases originales, de las copias preparadas y de
   `guest-manifest.json`; usar el hash emitido por el recibo, sin reconstruirlo
   por memoria. No se descarga ni inventa un kernel, imagen o runtime faltante.

```bash
python3 -B tests/runner/linux-single-execution/launch.py prepare --artifacts /ruta/privada/artifacts.json --bundle /ruta/nueva/bundle --out /ruta/nueva/kit
```

El preflight exige Linux x86-64 físico, `systemd-detect-virt=none`, CPU sin
bandera de hipervisor, DMI compatible, acceso a `/dev/kvm` y QEMU disponible.
Windows, WSL, hosts anidados y observaciones incompletas quedan fuera del
ensayo. No cambiar esos controles para utilizar la VM de desarrollo: sus
resultados conservan un alcance distinto.

## Dos muestras funcionales independientes

El bloque siguiente es un guion **para el operador en el host elegible**. Crea
dos VMs secuenciales, cada una con UUID y overlays nuevos, cuando se ejecute.
No es una campaña p95. `KIT` identifica el kit preparado, `MANIFEST_SHA256`
su huella revisada y `EVIDENCE_ROOT` un directorio privado existente. Ejecutar
desde la raíz de las fuentes correspondientes, sin cambiar el kit entre
muestras. Si RUN8 falla, el guion se detiene y conserva el fallo; no intenta
repeticiones para reemplazarlo por un resultado favorable.

```bash
set -u -o pipefail
: "${KIT:?Ruta absoluta del kit verificado}"
: "${MANIFEST_SHA256:?SHA-256 real del manifiesto preparado}"
: "${EVIDENCE_ROOT:?Directorio privado existente para nuevos recibos}"
session=$(mktemp -d "${EVIDENCE_ROOT}/physical-eight-XXXXXXXX")
chmod 700 "$session"
python3 -B tests/runner/linux-single-execution/launch.py preflight > "$session/preflight.json"
status=$?
if [ "$status" -ne 0 ]; then cat "$session/preflight.json"; exit "$status"; fi
for mode in RUN SUBMIT; do
  python3 -B tests/runner/linux-single-execution/launch.py run \
    --kit "$KIT" --manifest-sha256 "$MANIFEST_SHA256" \
    --mode "$mode" --cases 8 --scratch /var/tmp \
    --out "$session/$mode" > "$session/$mode-command.json"
  status=$?
  if [ "$status" -ne 0 ]; then cat "$session/$mode-command.json"; exit "$status"; fi
done
printf 'Recibos conservados en %s\n' "$session"
```

La suma fija `sum-fixed-v1` usa ocho entradas independientes; RUN presenta
ocho casos visibles y SUBMIT uno visible y siete ocultos. Los valores ocultos
no salen en los recibos. El perfil es `cold`: no consume una pareja preparada,
no reutiliza una VM y no permite un segundo RUN/SUBMIT dentro del mismo guest.

## Qué debe pasar y qué hace fallar la muestra

| Control             | Evidencia exigida                                                                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identidad           | `manifestSha256`, `sourceDigest` con algoritmo explícito, hashes de bundle, imagen inmutable y runtime coinciden; `ready` conserva runner y Node observados. El guest verifica Node contra el bundle antes de importar código.                 |
| VM exterior         | QMP observado antes de `cont`: KVM habilitado, UUID esperado, un vCPU y 2147483648 bytes sin memoria añadida. Sin NIC ni directorios compartidos.                                                                                              |
| Frontera conjunta   | Supervisor, PID real de dockerd y cápsulas bajo `alunzasingleexecutor.slice`: CPUQuota 100%, MemoryMax 2147483648 y MemorySwapMax 0. Comparador fuera de la cápsula estudiantil.                                                               |
| Ocho casos          | `SUCCESS/COMPLETED`, infraestructura `OK`, ocho casos completados y ocho registros de tiempo/control; `ok=true`. No basta terminar cinco o seis casos.                                                                                         |
| Cápsula estudiantil | Controles efectivos por caso: memory.max 134217728, memory.swap.max 0, pids.max 32 y cpu.max `100000 100000`. Bridge incluido en los 128 MiB.                                                                                                  |
| Presupuesto         | `runtimeMs < 3000` para éxito; a partir de 3000 el runner declara TIMEOUT. `outputBytes <= 65536` combinados y acumulados, sin truncamiento para el fixture de suma. No reiniciar presupuesto por caso ni restar bootstrap del tiempo cobrado. |
| Retiro              | Cero contenedores propios, QEMU recolectado, scratch ausente, bases con hashes intactos. `completeMs <= 40000`; el TTL absoluto de 60000 tampoco se reinicia. Pasar el TTL sin pasar la ventana de 40 s sigue siendo fallo.                    |

Para éxito, guest y host comprueban además los ocho ordinales: el presupuesto
de cada caso es `3000 - suma previa de supervisorProcessMs`, y la suma final
coincide exactamente con `runtimeMs`. No basta declarar un booleano de límite
ni presentar ocho ejecuciones que recibieron cada una 3000 ms. En los fallos
se conservan marcas incompletas, por ejemplo cuando un OOM impide obtener el
paquete del supervisor, sin convertirlas en una aprobación.

El resultado local de la muestra es `measured`/salida 0 solo si se satisfacen
esos controles. Un resultado estudiantil o de límites fallido produce
`measured-with-errors`/salida 1; errores de protocolo, deadline o retiro
producen `failed`/salida 1. Prerrequisitos ausentes producen
`unavailable-not-executed`/salida 2. Conservar `admission.json`,
`events.jsonl`, `report.json` y el resultado del comando, incluidos fallos.
No borrar una marca `PREVIOUS_RESOURCES_UNRESOLVED` para repetir: requiere
comprobar independientemente la ausencia de los recursos propios.

Los checks del recibo demuestran lo observado por esta cadena confiable;
no prueban el último instante físico de ejecución bajo loop ni tolerancia a
SIGKILL del guardián. Esas pruebas siguen pendientes y no se sustituyen por
el éxito de dos sumas.

## Coste por caso y p95 tienen alcances distintos

`caseTimings` conserva el ordinal, host start/attach, duración de contenedor,
tiempo cobrado por supervisor y presupuesto disponible para ese caso. Si la
imagen habilita el perfil `case-cost-v1`, incluye la proyección privada de
`caseCost`; en otro caso vale `null`. Solo admite fases conocidas y números
acotados. `COMPLETE` significa que llegó `workerExit`, no que el caso aprobó;
`MISSING`, `PARTIAL` o `INVALID` impiden comparar ese perfil completo, pero no
alteran diagnóstico ni presupuesto. No se exportan stdin, código, stdout,
expected ni resultados privados y no cambia el DTO público de la API.

Los offsets del worker usan `PERFORMANCE_NOW` con origen
`NODE_PERFORMANCE_TIME_ORIGIN`; los del bridge usan `BRIDGE_INPUT_PARSED`.
No restar valores de relojes distintos ni presentar `entry` como el inicio
físico del proceso. El intervalo parse→close del bridge sigue contando
completo. Tampoco sumar fases superpuestas ni sus percentiles.

Las dos muestras anteriores no calculan p95. Una campaña posterior debe fijar
antes sus perfiles y conservar todos los fallos: como referencia del plan,
al menos 50 RUN y 50 SUBMIT por perfil; separar cold/prearrancado, runtime,
imagen, fuentes, mezcla y concurrencia. El arnés actual solo permite
concurrencia uno y no implementa VM prearrancada. `completeMs` incluye
creación→retiro local, pero no cola/persistencia/API/navegador/red de Chile.
Por ello un p95 local, aunque fuera menor que 5000 ms, no acredita el p95
completo de G6. La campaña histórica dentro de una VM persistente tampoco
se mezcla con estas muestras.
