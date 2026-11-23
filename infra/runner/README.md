# Ensayo técnico del ejecutor

El ejecutor de IMP-03 conserva el contrato `module.exports.solve`, argumentos
JSON y retorno JSON síncrono. Cada caso tiene una cápsula y un intérprete
QuickJS WASM nuevos. El paquete no concede permisos académicos: el backend
autoriza la ejecución y selecciona versiones/pruebas antes de llamar `execute`.

El candidato físico `.13` dispone de un [transporte VM local opt-in](linux-vm/README.md) y [adaptador de API con ledger durable](../../docs/work/IMP-03-api-local-vm.md). Su [expediente](../../docs/work/IMP-03-api-fisica-13.md) distingue SQL/VM probados del recorrido HTTP pendiente. Esta opción no cambia el proveedor productivo.

## Reproducción local

Desde la raíz Git, con Node 24.21.0, npm 11.19.0 y Docker Linux con cgroup v2:

```powershell
npm run runner:prepare
npm run runner:doctor
npm run runner:probe -- --adapter docker
npm run runner:probe -- --acceptance-only
npm run runner:cleanup
```

`runner:doctor` ejecuta el probe fijo de identidad mediante `runCapsule`. Verifica
`memory.max=134217728`, `memory.swap.max=0`, `pids.max=32`,
`cpu.max="100000 100000"`, Node 24.21.0, UID10001, cinco conjuntos de capabilities
en cero y limpieza observada. Devuelve 2 cuando faltan motor, controladores o
imagen; 1 cuando el ensayo real no acredita esos controles; 0 cuando pasa.

Los informes están en `.local/reports/imp-00-06-08/`. La batería completa produce
`runner-docker.json`; el ensayo focal de identidad, permisos, memoria nativa,
descendientes, procesos, DNS/IPv6/UDP y recolección de
un contenedor expirado produce `runner-docker-acceptance.json`. El recolector
solo considera nombres, etiqueta y vencimiento propios. Su prueba mantiene
controles vigentes y con otra etiqueta, y los limpia en `finally`.

El supervisor `imp-03-quickjs.13` usa HTTP sobre IPC local para controlar Docker,
incluidos arranque, entrada y salida. Resuelve la precedencia
`DOCKER_CONTEXT`, `DOCKER_HOST` y contexto activo una vez por proceso, rechaza
TCP/SSH y rutas UNC remotas, y fija todas las conexiones al mismo endpoint. Un cambio
de contexto requiere reiniciar la API. Negocia la API Engine entre 1.41 y 1.45
con el rango declarado por `/version`; esto conserva compatibilidad de código
con Docker 20.10 del Sandbox. El cuarto ensayo remoto comprobó el arranque
del daemon y la carga de la imagen. La ejecución del caso completo sigue pendiente.

Las respuestas de control se limitan a 524288 bytes y tienen plazos absolutos.
Un pool de proceso conserva como máximo dieciséis conexiones IPC y cuatro libres;
no almacena respuestas ni reintenta mutaciones. El arranque registra primero dos
attachments separados: salida multiplexada y entrada. Así el EOF de la entrada
en Windows no cierra la lectura de salida. Se validan upgrade, framing, tamaño y
plazo; ambos canales se cierran ante fallo. Después del EOF se espera la salida
por Engine y se contrasta con la inspección independiente del contenedor.
Se mantienen la inspección de configuración antes de arrancar, la lectura de
estado/OOM y la eliminación forzada seguida de una observación HTTP 404. No se
siguen redirecciones. El cambio evita nuevos procesos CLI para cada consulta,
sin reutilizar cápsulas ni omitir controles. Referencias primarias:
[Engine API](https://docs.docker.com/reference/api/engine/),
[contextos](https://docs.docker.com/engine/manage-resources/contexts/) y
[esquema Engine 20.10](https://raw.githubusercontent.com/moby/moby/v20.10.24/api/swagger.yaml).
El pool y el cierre de conexiones siguen [Node HTTP Agent](https://nodejs.org/docs/latest-v24.x/api/http.html#class-httpagent).
La separación de entrada/salida se verificó sobre named pipes reales de Windows
y Docker, además de las pruebas de framing y cancelación del transporte.

SUBMIT conserva el digest inmutable obtenido en su inspección de admisión y lo
entrega al adaptador de esa ejecución mediante un contexto interno. Evita volver
a consultar la etiqueta de la imagen después de autorizar y admitir la solicitud.
No hay caché entre solicitudes: cada admisión vuelve a comprobar disponibilidad,
y cada caso crea, inspecciona y elimina una cápsula nueva. Si el digest desaparece,
la ejecución falla sin buscar otra imagen. Los consumidores directos sin contexto
siguen resolviendo la imagen al iniciar su adaptador. La fase privada
`imageResolve` mide la selección del digest, que puede venir de esta admisión;
la consulta real de disponibilidad permanece dentro de `submission.inspect`.

## Candidato Linux con runtime explícito y pareja preparada

El candidato local de [IMP-03-crun-api-local](../../docs/work/IMP-03-crun-api-local.md)
usa un motor Docker privado en Linux, cgroup v2 y el controlador `systemd`.
Registrar el runtime en ese motor requiere una ruta absoluta al ELF verificado,
sin wrappers. La API debe poder leer ese archivo y consultar su versión; no
instala runtimes ni cambia la configuración global de Docker. Las versiones
admitidas son `crun 1.31` y `runc 1.3.4`, con SHA-256 explícito del binario.

Después de preparar el motor, la imagen local fijada por digest y la migración
del registro operacional, configurar en el servidor `PRACTICE_RUNNER_PROVIDER=docker`
y el bloque completo `PRACTICE_DOCKER_RUNTIME`, `PRACTICE_DOCKER_RUNTIME_NAME`,
`PRACTICE_DOCKER_RUNTIME_VERSION`, `PRACTICE_DOCKER_RUNTIME_SHA256` y
`PRACTICE_DOCKER_STRATEGY` de `.env.example`. `cold` conserva creación por caso;
`prepared-pair-v1` habilita la pareja. La inspección es de solo lectura: verifica
motor, imagen, versión y hash, sin preparar cápsulas ni descargar dependencias.
Sin el bloque explícito se conserva Docker local anterior.

En `.10`, `kernel-controls.mjs` comprueba la hoja y el ancestro exterior también
en `cold` y en la continuación de casos 3–8; cada intento conserva una misma
frontera observada. El observador exige ejecutarse en el Linux del daemon y
rechaza Windows/daemons remotos cuando se selecciona el runtime explícito.
Docker Desktop genérico no acredita ese control exterior.

El puente registra el presupuesto restante, deadline, disparo del watchdog,
SIGKILL y avisos de salida/cierre mediante `watchdog-observation.cjs`. Es evidencia
privada; no representa la última instrucción física. Hay que reconstruir la
imagen de cápsula para incorporar esta instrumentación. Consultar el
[registro del incremento](../../docs/work/IMP-03-limites-watchdog-local.md) y el
[ensayo de un huésped por ejecución](../../docs/work/IMP-03-vm-por-ejecucion.md).

Desde `.13`, watchdog v2 inicia el retiro hasta 50 ms antes del vencimiento,
descontados del presupuesto restante. Conserva `deadlineMs=budgetMs`, registra
`retirementReserveMs` y `stopDeadlineMs`, y devuelve TIMEOUT sin lanzar el
worker cuando ya no queda ventana. El cierre se cobra por su tiempo observado,
sin recortar excesos. Esta reserva no garantiza tiempo real estricto.
Ante OOM, el supervisor valida y acumula una sola vez el tiempo, salida y
cgroups del paquete disponible antes de finalizar `UNKNOWN / MEMORY_LIMIT`;
si falta evidencia válida, no inventa duración ni controles. El
[registro físico .13](../../docs/work/IMP-03-candidato-fisico-13.md) fija los
artefactos y distingue ensayos locales de aceptación remota.

Desde `.12`, cada worker carga el mismo WASM fijado mediante el subpath público
CommonJS y arranca con `--v8-pool-size=1 --wasm-num-compilation-tasks=1`.
Cada caso conserva proceso, módulo, runtime y contexto nuevos. El arranque,
ejecución y cierre siguen consumiendo el mismo presupuesto acumulado de 3 s;
no se amplían memoria, CPU ni salida. Los probes nativos no reciben esos flags.

Una imagen de laboratorio puede fijar `ALUNZA_RUNNER_PROFILE=case-cost-v1`
para observar fases por fd4. `ALUNZA_RUNNER_OPTIMIZATION=baseline` conserva
el cargador/opciones originales solo junto con ese perfil confiable. Sin
perfil se usa la optimización normal; la entrada estudiantil no selecciona
ninguna de estas opciones. El perfil añade costo y sus datos son privados:
`COMPLETE` acredita la llegada de `workerExit`, no éxito de la solución.
Consultar el [A/B y sus límites de evidencia](../../docs/work/IMP-03-costo-por-caso.md)
y el [guion de Linux físico](../../docs/work/IMP-03-validacion-fisica.md).

La pareja contiene exactamente dos cápsulas nuevas de un solo uso, sin código
estudiantil mientras espera. Antes de crear cada una se confirma en PostgreSQL
la autorización del único despacho; antes de enviar entrada se comprueban la
asignación durable y el lease de ejecución. Ambas cápsulas deben compartir un
ancestro efectivo, por encima de sus hojas individuales, con memoria máxima de
2 GiB y CPU de hasta un núcleo. El pool verifica esa envolvente y los límites
individuales de 128 MiB, swap cero, 32 procesos y una CPU; los vuelve a comprobar
antes de enviar código. El arnés acredita por separado que los daemons también
están dentro de la envolvente común. Una configuración incompleta falla cerrada.

PostgreSQL admite como máximo una pareja activa o de reserva por motor. Las
solicitudes que esperan cuentan ese tiempo dentro de su plazo original; no hay
sustitución automática de runtime ni ejecución duplicada. Casos posteriores al
segundo se crean en frío con la misma identidad admitida. La pareja queda
asignada hasta persistir el resultado, comprobar permisos y cerrar la respuesta
HTTP; recién entonces se puede preparar la siguiente. Una pareja ociosa expira
y se retira sin una reposición continua.

La recuperación observa identidades y etiquetas inmutables, conserva el cupo
si una creación incierta devuelve 404 y no ejecuta código. Funciona con nuevas
admisiones deshabilitadas o sin la configuración de runtime vigente, usando el
contexto persistido y el motor correspondiente. El drenaje detiene preparación
y admisiones, espera operaciones y retira recursos propios; un fallo de limpieza
o de commit conserva el registro pendiente. Las pruebas unitarias verifican el
orden y los rechazos; la evidencia de aislamiento y del recorrido API/BD real
se registra por separado en el informe del candidato.

## Arranque del supervisor en Vercel Sandbox

La imagen exterior incluye Node en `/usr/local/bin/node` y los módulos del
supervisor en `/opt/alunza/supervisor`. Los módulos pertenecen a root y tienen
modo 0444. El usuario exterior `node` puede subir el JSON privado de cada caso a
`/vercel/sandbox`. La regla de sudo permite iniciar el bootstrap y ejecutar o
limpiar un caso mediante el driver. La API solicita `sudo: true` para esos tres
comandos. El código del alumno sigue ejecutándose dentro de su cápsula QuickJS.
[Contrato de ejecución del SDK](https://github.com/vercel/sandbox#sudo-access).

Desde la raíz, `npm run runner:prepare -- --sandbox-context` prepara el contexto
de construcción y comprueba los imports de los módulos. Para reutilizar una
cápsula ya medida, el mismo comando admite `--capsule-tar <archivo>`,
`--capsule-sha256 <hash>` y `--output <directorio>`. Tras construir con
`docker buildx build --platform linux/amd64` y cargar el OCI en Docker local,
`node scripts/runner-check-sandbox-image.mjs <repositorio-local>@sha256:<digest>`
verifica la ruta de Node con PATH restringido, la elevación, los módulos y la
limpieza de archivos privados. El contenedor de comprobación carece de socket
Docker del host y de los privilegios necesarios para iniciar Docker anidado.
La capacidad de Docker y cgroups en São Paulo se mide con el ensayo Vercel.

Desde `imp-03-quickjs.8`, el informe privado de campaña registra si terminó
el bootstrap y qué soporte de cuota y período de CPU anunció el daemon.
Un valor ausente queda como `null`. La inspección de la cápsula y la lectura
de sus cgroups siguen comprobando los límites efectivos.

`driverCommand` y `driverCleanupCommand` conservan por separado el código de
salida, la presencia de stdout/stderr y la coincidencia con el marcador fijo
del driver. El adaptador atribuye una fase al supervisor cuando coinciden el
código reservado para esa operación, el marcador exacto y stdout vacío.
`phase: null` indica que esa atribución carece de evidencia. El primer fallo
de la operación se conserva durante la limpieza. Los DTO públicos mantienen
sus diagnósticos y el resultado de cada caso se lee de su archivo privado.

En v9, si el driver confirma `START` (75), puede dejar un documento
`START_FAILURE` de versión 1 en la ruta del resultado. El adaptador hace a
lo sumo una lectura normal con lease vigente y un límite de 4096 bytes.
`driverStartFailure` contiene el estado HTTP recibido, la terminación del
intercambio y la categoría de causa reconocida por el supervisor. También
registra el estado del contenedor propio, si consta que arrancó y si Docker
detectó OOM. La consulta al Engine comparte el plazo de operación. Los valores
ausentes quedan explícitos y la limpieza conserva su presupuesto.

Solo la confirmación completa de Docker con HTTP 204 permite entregar la
entrada. Una lectura diagnóstica inválida o tardía deja `driverStartFailure`
en `null`. El caso conserva `UNKNOWN` y los indicadores del primer fallo.
El journal y el informe admiten exclusivamente el esquema cerrado del
diagnóstico. El archivo se elimina con la misma limpieza que el resultado
del caso.

## Frontera del retorno y regresión de la brecha

La batería contiene `forged-return-known-gap` en
`tests/runner/fixtures.mjs`. Su programa ficticio es:

```javascript
module.exports.solve = () => {
  require('node:fs').writeSync(3, '{"kind":"value","value":true}');
  process.exit(0);
};
```

El prototipo IMP-00.06 aceptaba ese valor como `SUCCESS` sin observar el retorno
normal de `solve`. La regresión conserva el programa original y ahora exige
`RUNTIME_ERROR/STUDENT_EXCEPTION`: `require` y `process` no existen en el guest.

Solo el worker Node confiable escribe fd3 después de que `callFunction` termina
sin excepción y un serializador privado valida el valor JSON. El marcador de
invocación identifica el protocolo; la garantía proviene de la frontera WASM y
de no exponer capacidades de Node, no de mantener secreto el marcador. Las
expectativas, el comparador y el diagnóstico continúan fuera de la cápsula.

Se fijan `quickjs-emscripten-core` y la variante
`@jitl/quickjs-wasmfile-release-sync` en 0.32.0. El build copia las dependencias
instaladas y el WASM a un contexto aislado de `.local`, y Docker construye sin
red. No hay `require`, módulos Node, npm arbitrario, temporizadores, DOM ni
loader de imports en el guest. `console.log/error` son callbacks acotados. Se
rechazan promesas, thenables, ciclos, BigInt, números no finitos, accesores y
objetos de prototipo no JSON. Las propiedades `toJSON` no reemplazan el retorno.
El serializador consulta la marca interna Promise de QuickJS en cada nodo,
incluidos retornos anidados y promesas con prototipo retirado. Los handles del
resultado de esa consulta se liberan sin disponer argumentos prestados. También
conserva comprobaciones intrínsecas de Map, Set, Date, RegExp, buffers, vistas,
primitivos envueltos y Error para que retirar su prototipo no los convierta en
objetos JSON vacíos aceptados. Estas regresiones no acreditan seguridad general
de todos los objetos o futuras versiones del motor.

Los probes OS ejecutan programas fijos del arnés para probar memoria nativa,
descendientes y controles de kernel. Solo herramientas locales seleccionan esos
probes mediante opciones de `runCapsule`; el contrato académico estricto no
expone esa selección ni ejecuta el código estudiantil directamente en Node.

El ensayo Docker del 26/09/2026 obtuvo 69/69 casos PASS y cero contenedores
restantes, incluyendo la brecha, límites, probes OS, cancelación y concurrencia.
Esto no acredita paridad remota ni aceptación de RF de negocio.

## Límites y diferencias explícitas

- La cápsula limita memoria total y descendientes a 134217728 bytes. El puente
  confiable también cuenta dentro de ese límite. Los 3000 ms se acumulan entre
  casos usando el reloj monótono del puente, fuera del worker estudiantil. Este
  reloj comienza antes de preparar y lanzar el worker y el puente mata su grupo
  de procesos al vencer el presupuesto restante. Incluye el inicio de Node/WASM
  dentro del worker; excluye arranque de Docker y transporte. La operación
  completa sigue acotada a 30 s en el host. La evidencia privada distingue ese
  tiempo de infraestructura, la vida del contenedor y la duración del puente;
  una respuesta ausente, incompleta o sin cgroups efectivos nunca concede éxito.
  stdout/stderr comparten 65536 bytes. Código y
  transporte del retorno tienen límites independientes de 65536 bytes.
- `execute` limita la operación a 30 s y la limpieza de cada cápsula tiene un
  presupuesto independiente de 10 s. Las etiquetas incluyen `executionId` y
  vencen a los 60 s. `cleanupDockerExecution` verifica nombre y etiquetas antes
  de eliminar solo cápsulas de esa ejecución; `getDockerAvailability` comprueba
  daemon, controladores e imagen local, sin crear ni descargar imágenes.
- Si se pierde o cancela la respuesta de creación, un 404 inmediato no acredita
  limpieza: el supervisor conserva incertidumbre hasta observar esa cápsula o
  vencer su etiqueta de 60 s. La API conserva el período de recuperación en BD
  y llama `sweepExpiredDockerExecutions` al arrancar y cada 15 s, incluso para
  apariciones tardías de ejecuciones ya finalizadas. El barrido exige nombre,
  etiqueta propia y vencimiento; una falla del daemon no acredita limpieza.
  Esta recuperación es eventual al volver el daemon, no una garantía absoluta
  de atomicidad distribuida entre una respuesta perdida y la creación remota.
- El puente PID1 usa UID0 y retiene `CAP_SETUID`, `CAP_SETGID` y `CAP_SETPCAP`
  para crear al alumno con UID diferente y capabilities cero. Desde `.11`
  conserva también `CAP_KILL` para enviar SIGKILL al proceso de UID10001:
  UID0 con capabilities recortadas no basta para esa señal entre identidades
  distintas ([Linux kill(2)](https://man7.org/linux/man-pages/man2/kill.2.html)).
  El hijo pierde también `CAP_KILL` mediante `setpriv --bounding-set=-all`;
  el chequeo de identidad exige los cinco conjuntos de capabilities en cero.
  El puente permanece en el namespace PID privado de la cápsula. Por ello no se
  acredita la propiedad de una cápsula enteramente sin privilegios. El alumno
  debe superar la comprobación de permisos antes de cargar su código.
- El kernel puede presentar excesos transitorios y la terminación tiene latencia
  de planificación. La evidencia no acredita el p95 completo del producto.
- Sandbox requiere manifiesto vigente, imagen exacta y presupuesto autorizado.
  Este corte admite un Sandbox por ensayo y reserva ocho solicitudes para
  limpieza. Una expiración automática no demuestra limpieza observada.
- La imagen exterior se prepara antes de ejecutar: no hay instalaciones ni
  descargas durante el trabajo estudiantil. Construirla localmente no prueba
  optimización VCR, importación de la cápsula, cgroups anidados ni paridad remota.

El adaptador Sandbox recibe una identidad estable y callbacks internos para
registrar correlación antes de crear, confirmar el ID de sesión recibido y
comprobar el lease antes de ejecutar. El transporte del SDK 3.2.2 reconoce
`/api/v3/sandboxes`, admite una sola creación y prohíbe reanudaciones, forks y
snapshots. La operación normal tiene hasta 30 s; la limpieza comparte un plazo
total de 40 s y puede recibir un deadline anterior desde la API.

El driver remoto guarda el resultado en un archivo privado de modo `0600`,
legible por el usuario del transporte de archivos. El adaptador lee por stream
con un máximo de 524288 bytes, valida el sobre completo y elimina los archivos.
El resultado privado no se imprime en stdout/stderr. Una cancelación o pérdida
del lease impide nuevos comandos y deriva la eliminación a la destrucción de
la VM. `timing.mjs` forma parte del paquete remoto junto al motor y driver.

`recoverVercelSandbox` solo observa y limpia una identidad previamente
reservada; no carga archivos ni ejecuta código. `PREPARED` acredita que no se
despachó creación. `UNKNOWN` con 404 sigue pendiente; una identidad de sesión
confirmada permite comprobar ausencia, siempre junto a cero snapshots.
El callback de recepción durable debe confirmarse antes del borrado de un
recurso descubierto. La función devuelve evidencia: el consumidor debe exigir
`cleanupVerified`, sin interpretar una resolución de Promise como aprobación.

El arnés de aceptación dispone de opciones internas excluyentes para descartar
la respuesta de una creación, observar el dispatch del comando antes de cancelar,
o observar el vencimiento natural. No se reciben desde HTTP ni se pasan desde
los adaptadores de producto. Solo la observación natural admite cleanup hasta
90 s; la ejecución sigue limitada a 30 s. Su lectura usa `resume:false` y exige
la misma sesión, estado `stopped` y timestamps del proveedor coherentes con el
TTL de 60000 ms. Esperar localmente o recibir 404 no demuestra ese vencimiento.
