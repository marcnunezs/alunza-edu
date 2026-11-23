# IMP-03.07 — RUN/SUBMIT, Vercel Sandbox y recuperación

Corte iniciado el 03/11/2026 y verificado localmente el 04/11/2026, America/Santiago.
**La aceptación de IMP-03.07 en preproducción está bloqueada.** El 12/11/2026
Vercel confirmó que la plataforma garantiza los recursos de la microVM y carece
de delegación soportada para los límites del contenedor anidado.
[Respuesta de soporte y decisión pendiente](#respuesta-del-ingeniero-de-vercel-del-12112026).

## Preparación del primer ensayo el 10/11/2026

Se creó `alunza-preprod` en el equipo Vercel elegido en Chrome. La consulta
posterior confirmó cero despliegues y ausencia de repositorio Git conectado.
El usuario eligió un presupuesto de planificación de **USD 1,00**. Para la VM
se reservaron USD 0,01 y para la imagen y cargos asociados, USD 0,99.
Con las tarifas Pro de São Paulo (`gru1`), una creación y hasta 60 s de CPU
activa y memoria cuestan aproximadamente USD 0,004904. El ensayo admite una VM,
36 llamadas y una ventana operativa de 40 s. [Tarifas regionales de Sandbox](https://vercel.com/docs/sandbox/pricing#regional-pricing).

La imagen exterior `linux/amd64` se construyó y exportó en formato OCI. Su
manifiesto local tiene digest `sha256:8f08a1dc9b8e4f2366ece2887b8ca48a10829769784d5ab2a6b17ddf5894553f`.
Las siete capas gzip y la configuración suman **253.237.664 bytes**. Se comprobó
el hash de cada descriptor. Una ejecución local con UID 65534, la red deshabilitada
y el sistema de archivos de solo lectura verificó Node 24.21.0, el cliente y el
daemon Docker 20.10.24 y el SHA-256 de la cápsula incluida. El arranque del
daemon anidado y los límites efectivos en Vercel corresponden al ensayo remoto.

Se recomienda conservar la imagen en VCR hasta **siete días desde su publicación**
y retirarla antes si ya se revisó la evidencia y finalizó la limpieza. Tomando
0,253237664 GB decimales como referencia, USD 0,10/GB-mes y prorrateo lineal
sobre 30 días, la imagen costaría USD 0,00591 en siete días. Sumada la VM, el
ensayo costaría USD 0,01081. Si se presupuesta un mes entero, el total sube a
USD 0,03023. El volumen facturable y el prorrateo efectivos requieren datos de
Vercel. [Tarifas](https://vercel.com/pricing) y [definición de tamaño OCI para los límites de VCR](https://vercel.com/docs/container-registry/limits-and-pricing).

El directorio privado `.local/preproduction/imp-03-07/` contiene el archivo
`sandbox-linux-amd64.oci.tar`, la evidencia `image-local.json` y los cálculos
en `presupuesto.json`.

El 10/11/2026 se publicó la imagen en el repositorio privado `practice-runner`
de `alunza-preprod`. VCR devolvió el estado `ready` para `linux/amd64`. La
etiqueta `imp-03-quickjs.6-8f08a1dc9b8e` y la inspección independiente de
Docker Buildx devolvieron el mismo digest que el manifiesto local. VCR informó
253.239.294 bytes, incluidos los 1.630 bytes del manifiesto. El precio efectivo
de almacenamiento se comprobará con la facturación del proveedor.

La evidencia privada `publication-verified.json` conserva el ID de la imagen,
el digest y el instante de publicación. `capability.draft.json` usa la referencia
por digest dentro del proyecto y conserva `authorized: false`. La publicación
creó cero VM. La fecha recomendada de revisión y retiro es el 17/11/2026 a las
15:33 de Santiago, o antes si el ensayo y su limpieza ya están verificados.

## Resultado del primer ensayo de capacidad el 10/11/2026

El usuario autorizó una VM, hasta 36 llamadas y 40 s de operación en `gru1`,
con USD 0,01 presupuestados para Sandbox. El manifiesto aprobado vinculó esa
autorización a la imagen publicada y al candidato `b12fb6f`, con digest de fuentes
`a5e74c722c2281bd87903beaaaa93ffbb755eaf6d97efcc9bdac295e161b46d4`, estable
antes y después del ensayo. Una credencial OIDC del proyecto permitió el acceso.

**El caso `sync-json-success` falló con `UNKNOWN / PROVIDER_FAILURE`.** El
proveedor informó 1 vCPU, 2048 MB, región `gru1`, `persistent: false`, `deny-all`
y un TTL de 31.341 ms, igual al solicitado. El caso duró 14.935 ms. El journal
acredita un único POST de creación y cuatro llamadas de limpieza. Se registró el
ID de sesión y la prueba `ABSENT_AND_ZERO_SNAPSHOTS` para esa misma sesión, con
cero recursos pendientes. El costo facturado queda sin observar.

El fallo ocurrió antes de despachar la carga de archivos. El ensayo no alcanzó
el arranque de Docker, la comprobación de cgroups ni la ejecución del programa.
La proyección del arnés conserva la referencia de imagen solicitada, pero no la
referencia devuelta en la creación ni los indicadores de snapshot de origen. La
traza auxiliar preparada para esta corrida filtró `api.vercel.com`, mientras que
el SDK 3.2.2 usa `vercel.com/api`. Por eso no registró la respuesta de creación.
Tras la corrida se conservó el lanzador original en `execute-capability.as-run.mjs`.
Se corrigió localmente el filtro de la traza y se comprobó con metadatos sintéticos
que distingue referencia literal, digest, indicadores de snapshot y número de rutas.
La comparación de metadatos y la preparación local del paquete son puntos de
investigación. Ninguno quedó identificado como causa del fallo.

El resumen privado está en `.local/reports/imp-03-07/capability-remote.json`.
El informe original y el journal permanecen en
`.local/evidence/imp-03-07/a892c5ab-ea3e-420b-abad-33bd147fa824/`. La única
creación autorizada se consumió. Antes de proponer otra, conviene verificar
localmente que el diagnóstico distingue el rechazo de la imagen o snapshots,
la lectura de archivos y el empaquetado del SDK. La campaña ampliada permanece
pendiente y la imagen sigue sujeta a la revisión de retención del 17/11/2026.

## Diagnóstico local del rechazo previo a la carga

El 10/11/2026 se comprobaron los hashes del informe y del journal originales.
El digest solicitado coincide con el del manifiesto publicado en VCR. En
`imp-03-quickjs.6`, `sandbox.image !== image` compara la referencia completa.
El SDK 3.2.2 entrega el texto que recibió del proveedor. El journal conserva
la referencia solicitada.

Se ejecutaron nueve reproducciones con el adaptador compilado, el SDK instalado
y respuestas en memoria. Cada variante cambió un solo campo. El control se detuvo
deliberadamente al llegar a la primera escritura de los cinco archivos (`fs/write`).

| Respuesta simulada de creación                                                           | Resultado local                                                                    | Llamadas simuladas normales + limpieza |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------- |
| Referencia corta exacta, snapshots omitidos y `cwd` absoluto                             | Alcanzó `fs/write`                                                                 | 2 + 4                                  |
| Mismo repositorio y digest, con prefijo de equipo/proyecto o referencia VCR completa     | La comparación literal rechazó ambas formas                                        | 1 + 4                                  |
| Otro repositorio con el mismo digest, digest distinto o imagen omitida                   | La comprobación de imagen rechazó cada variante                                    | 1 + 4                                  |
| `sandbox.currentSnapshotId` presente o `session.sourceSnapshotId` presente, por separado | La comprobación de snapshots rechazó cada variante                                 | 1 + 4                                  |
| Referencia exacta y `session.cwd` relativo                                               | Pasó la comprobación de metadatos. El SDK rechazó el directorio al preparar el TAR | 1 + 4                                  |

La igualdad literal es la primera hipótesis a investigar. El expediente de VCR
contiene dos formas de identificar el mismo artefacto. El patrón remoto de una
llamada normal y cuatro de limpieza también se reprodujo con snapshots y con el
directorio relativo. Cero snapshots tras la eliminación describe el estado final.
Los datos históricos disponibles no permiten escoger entre estas causas. La
limpieza comenzó 4 ms después del recibo, a los 11,637 s del inicio de la campaña.

La traza auxiliar local distingue ahora una referencia publicada con prefijo, otra
referencia con el mismo digest, un digest distinto y una imagen ausente o sin digest.
Registra por separado la presencia de los dos campos de snapshot y si el directorio
es absoluto. La clasificación es diagnóstica. El adaptador conserva sus condiciones
de admisión. Pasaron las 62 pruebas focales de adaptador y transporte. Las nueve
reproducciones hicieron cero llamadas externas. El reproductor `replay.mjs` y su
informe `resultados.json` están en `.local/reports/imp-03-07/diagnostico-previo/`.

## Segundo ensayo de capacidad el 10/11/2026

Se ejecutó el mismo candidato y la misma imagen en `gru1` con autorización de
una creación adicional, hasta 36 llamadas, 40 s de operación y USD 0,01 para
Sandbox. El ensayo tuvo un UUID y un journal propios. La traza leyó la respuesta
de creación y capturó los predicados del adaptador al producirse la excepción,
antes de la normalización a `UNKNOWN / PROVIDER_FAILURE`.

**`IMAGE_MATCHES` fue el único predicado falso.** La solicitud envió
`practice-runner@sha256:…`. Vercel respondió con la forma
`<equipo>/alunza-preprod/practice-runner@sha256:…`. La traza confirmó la
igualdad de esta segunda cadena con la referencia del artefacto publicado sin
el host del registro. El digest completo coincidió. Ambos campos de snapshot
estaban ausentes, el directorio de la sesión era absoluto y Vercel devolvió
cero rutas. Se observaron 1 vCPU, 2048 MB, red `deny-all`, `persistent: false`
y un TTL efectivo de 39.830 ms, igual al solicitado. `sync-json-success` quedó
en `FAIL` antes de la carga de archivos. La causa quedó demostrada para este
segundo ensayo. El primero conserva su evidencia y su límite de atribución.

La creación devolvió HTTP 200, al igual que la parada y la eliminación. La
consulta del mismo Sandbox devolvió 404 y la consulta de snapshots confirmó
cero para ese nombre. Se contrastó el ID del recibo con la prueba durable de
limpieza. El resultado fue **una VM creada, cinco llamadas en total, cero VM
pendientes y cero snapshots** para esta campaña. El costo efectivo queda
pendiente de facturación.

El resumen verificado está en `.local/reports/imp-03-07/capability-remote-02.json`.
La traza privada se conserva en `.local/preproduction/imp-03-07/capability-02/`
y el journal original en `.local/evidence/imp-03-07/2adf8a3b-a596-4be9-9955-8c6b0d227c9c/`.
En ocho controles locales posteriores, enviar y recibir la referencia exacta de
equipo, proyecto, repositorio y digest observada en la creación permitió alcanzar
`fs/write`. Cambiar el equipo, proyecto, repositorio o digest, o introducir un
snapshot actual o de origen, conservó el rechazo antes de la carga. Los resultados
están en `.local/reports/imp-03-07/diagnostico-posterior-02/resultados.json`.
Esta forma de la referencia permite preparar la siguiente validación manteniendo
la guarda estricta. Demostrar el arranque real de Docker y sus límites efectivos
sigue pendiente.

## Corrección local de la preparación de campañas el 10/11/2026

El comando `prepare` de `scripts/sandbox-campaign.mjs` toma un borrador y el
recibo de publicación verificado. Deriva la forma `equipo/proyecto/repositorio@digest`
que se observó en la respuesta del segundo ensayo y la escribe tanto en `image`
como en `SANDBOX_IMAGE`. Genera un UUID nuevo y registra el candidato local.
El ejemplo de uso está en la [guía de campañas](../../infra/preproduction/SANDBOX-CAMPAIGNS.md).

Se preparó el expediente `.local/preproduction/imp-03-07/capability-canonical/`
con la imagen publicada. El plan local validó una creación en `gru1`, 36 llamadas
y 40 s de operación. El preflight comprobó la coincidencia del destino y del candidato
y señaló los requisitos de aprobación, ventana y credencial para un futuro ensayo.
Los dos ensayos consumidos conservan sus manifiestos y sus journals originales.

Pasaron 22 pruebas de preparación, 14 de transporte con el SDK 3.2.2 y 115 de
regresión de campañas, recuperación y parámetros de preproducción. La prueba
con la referencia correcta llegó a `fs/write`. Las variaciones de equipo,
proyecto, repositorio, digest o snapshot fueron rechazadas antes de esa carga.
Esta corrección se verificó localmente. La validación del arranque de Docker
en Vercel sigue pendiente.

## Tercer ensayo de capacidad el 10/11/2026

Se ejecutó el candidato `b12fb6f`, con digest de fuentes
`e13e6ac92a93a2f849651dd458895f0cc5bd8c9f252d48d72c00ed205870de5c` estable
durante el ensayo. Se autorizó una VM en `gru1`, 36 llamadas, 40 s de operación
y USD 0,01 de presupuesto Sandbox. El manifiesto y `sandbox.env` identificaron
la misma imagen por equipo, proyecto, repositorio y digest.

**La corrección de la referencia funcionó.** La creación devolvió HTTP 200 y
la referencia recibida coincidió literalmente con la solicitada. Pasaron todos
los predicados de identidad, recursos, red y snapshots. La carga del supervisor
(`fs/write`) devolvió HTTP 200.

El siguiente POST pidió ejecutar `node /vercel/sandbox/remote-init.mjs` con
`sudo: true`. Vercel devolvió **HTTP 400 `executable_not_found`** antes de abrir
el flujo de salida del comando. El bootstrap no llegó a ejecutar `dockerd`,
`docker info` ni `docker load`. La cápsula registró cero tiempo de ejecución
estudiantil. El caso `sync-json-success` terminó en `UNKNOWN / PROVIDER_FAILURE`.
La respuesta identifica el fallo de despacho del ejecutable. La resolución exacta
de los binarios en el entorno remoto queda por diagnosticar.

La inspección local de las siete capas OCI, con los enlaces y eliminaciones de
capas anteriores resueltos, ubicó Node en `/usr/local/bin/node`, el cliente Docker
en `/usr/bin/docker` y el daemon en `/usr/sbin/dockerd`. Los tres archivos tienen
modo 0755 y su cargador ELF está presente. La imagen carece del binario `sudo`.
Su `PATH` declarado incluye `/usr/local/bin`. El error remoto no distingue entre
la resolución de `node` y el mecanismo usado por Vercel para `sudo: true`.
El siguiente diagnóstico local es validar las invocaciones del supervisor y del
driver con la ruta absoluta de Node y revisar los requisitos de elevación.

El journal registró 3 llamadas normales (crear, subir, iniciar comando) y 4 de
limpieza. La parada y eliminación devolvieron HTTP 200, la consulta posterior
al Sandbox exacto devolvió 404 y la lista de snapshots para ese nombre quedó
vacía. La prueba durable `ABSENT_AND_ZERO_SNAPSHOTS` corresponde al ID de sesión
confirmado. Resultado final del ensayo: **una creación, 7 llamadas, cero VM
pendientes y cero snapshots**. El costo facturado queda pendiente de observación.

El resumen está en `.local/reports/imp-03-07/capability-remote-03.json`. La
traza está en `.local/preproduction/imp-03-07/capability-canonical/` y el
journal en `.local/evidence/imp-03-07/43222d6c-984a-457b-b7d5-e50568bd93bb/`.

## Corrección local del arranque después del tercer ensayo

Se reprodujo la dependencia del PATH en la imagen del ensayo. Con
`PATH=/usr/bin:/bin` el nombre `node` no resuelve y `/usr/local/bin/node`
ejecuta Node 24.21.0. La imagen también carecía de sudo. El único HTTP 400
observado en Vercel no distingue qué ejecutable faltó.

El candidato `imp-03-quickjs.7` usa la ruta absoluta para los tres comandos.
El supervisor y sus imports se incorporan a la imagen en un directorio de
root. Solo se sube el JSON de cada caso. La política sudo del usuario `node`
permite el arranque, la ejecución y la limpieza por esos puntos de entrada.
El cliente Docker y el daemon vienen preparados en la VM. La cápsula interna
conserva los bytes del ensayo anterior (SHA-256
`f95f58daabcf795a79e5a855e38b17b693bc972e7dc87daf52e8414bd3158580`).

Se reprodujo además que Docker 20.10 devuelve código 0 a
`docker info --format '{{json .}}'` con un socket inexistente. El JSON incluye
`ClientInfo` y `ServerErrors`, y carece de `ServerVersion`. El bootstrap debe
esperar a que responda el daemon antes de evaluar sus controles de cgroup.
La regresión conserva el rechazo cuando el servidor responde y faltan límites.

En Docker local se verificó el artefacto `linux/amd64`
`sha256:03eef7a921c7f6367a104ae6341648466783db6212a2b7cb5cf0b642f80890b9`.
Las once capas comprimidas y la configuración suman 254367961 bytes. La prueba
entró al bootstrap como root desde el usuario `node` con PATH reducido,
llegó al plazo de espera del daemon en un contenedor aislado y limpió
archivos de root mediante el driver. La misma regla rechazó ejecutar Node
con argumentos genéricos. En la VM futura, el modo de elevación real lo
determina el servicio de Vercel. La evidencia de Docker local está en
`.local/reports/imp-03-07/supervisor-v7-local.json`.

Pasaron 270 pruebas del runner y 885 de los arneses de preproducción ejecutados
localmente. También pasaron tipos, lint y formato. El candidato de fuentes
es `ba009be4a0e0302b93ecce15becbab10c86b80422ed524caa68e3b1175ef1c1a`.

Con ese corte local se preparó la propuesta de publicar el digest nuevo y
probar Docker y cgroups en una VM de `gru1`. La propuesta privada está en
`.local/preproduction/imp-03-07/capability-supervisor-v7/release-proposal.json`.
Modela USD 0,004904 para la VM y USD 0,005935 para siete días de imagen
completa, con presupuestos propuestos de USD 0,01 para cada concepto.
[Tarifas de Vercel](https://vercel.com/pricing).

## Cuarto ensayo de capacidad el 10/11/2026

VCR publicó la imagen privada `linux/amd64` a las 18:45 de Santiago. El
recibo `ready` y la creación en São Paulo (`gru1`) identificaron el digest
`sha256:03eef7a921c7f6367a104ae6341648466783db6212a2b7cb5cf0b642f80890b9`.
La campaña autorizó una creación, 36 llamadas y 40 s de operación. El ensayo
se ejecutó de 18:46:33 a 18:46:49 con `imp-03-quickjs.7`, commit `b12fb6f` y
digest de fuentes `ba009be4a0e0302b93ecce15becbab10c86b80422ed524caa68e3b1175ef1c1a`,
estable antes y después.

**El supervisor arrancó el daemon Docker y cargó la imagen interna en Vercel.**
La VM informó 1 vCPU, 2048 MB, red `deny-all`, cero rutas, persistencia
desactivada y un TTL efectivo de 39.826 ms, igual al solicitado. El bootstrap
terminó con código 0, `ready: true`, Node 24.21.0, un identificador de imagen
válido y stderr vacío. Para llegar a ese resultado, el daemon tuvo que informar
Linux con cgroup v2 y soporte de límites de memoria, swap y procesos.

**El caso terminó en `FAIL`, con diagnóstico `UNKNOWN / PROVIDER_FAILURE`.**
Vercel aceptó la carga de la entrada privada y el despacho del driver con
HTTP 200. El adaptador registró `CAPSULE_EXECUTION / REMOTE_CAPSULE_FAILURE`
antes de leer el archivo de resultado. Esa comprobación rechaza un código de
salida distinto de cero o cualquier contenido en stdout o stderr. La traza
conservada deja abierta la condición exacta. El caso duró 15.650 ms y registró
0 ms de ejecución estudiantil. Quedan por demostrar la ejecución correcta de
un caso y la aplicación efectiva de los límites al proceso estudiantil.

El journal y la traza coinciden en **una creación y nueve llamadas**. Cinco
corresponden a la creación, el bootstrap, la carga de entrada, la ejecución y
la limpieza de archivos. Las otras cuatro pararon y eliminaron la VM (HTTP 200),
consultaron la misma sesión (404) y comprobaron sus snapshots (HTTP 200).
La prueba durable `ABSENT_AND_ZERO_SNAPSHOTS` coincide con la sesión confirmada.
El ensayo terminó con cero VM pendientes y cero snapshots.

El proveedor informó 8.135 ms de CPU activa y 12.215 ms de aprovisionamiento.
El presupuesto autorizado fue USD 0,01 para la VM y USD 0,01 para la imagen.
El modelo de planificación estimó USD 0,004904 para la VM y USD 0,005935 por
siete días de imagen, USD 0,010839 en total. El importe facturado sigue sin
observarse. La revisión de retención de esta imagen corresponde al 17/11/2026
a las 18:45 de Santiago.

El informe verificado está en `.local/reports/imp-03-07/capability-remote-04.json`.
El informe original y el journal están en
`.local/evidence/imp-03-07/380ab7f6-7365-461b-b82c-7e8521a67c93/`. La traza
`run-transport-1794347209053.json` y el recibo de publicación están en
`.local/preproduction/imp-03-07/capability-supervisor-v7/`. La campaña quedó en
`NOT_ACCEPTED`. El siguiente paso es distinguir localmente las condiciones de
fallo del driver antes de plantear otra ejecución. La aceptación de RUN/SUBMIT
y las campañas ampliadas siguen pendientes.

## Plan de diagnóstico y corrección del driver del 11/11/2026

El journal del cuarto ensayo sitúa la reserva del comando de ejecución a las
21:46:42.752 UTC y la de limpieza de archivos a las 21:46:43.872 UTC. Los
1120 ms entre ambas reservas acotan el fallo. El adaptador recibió la
respuesta del comando y rechazó su código de salida o el contenido de sus
canales antes de pedir el resultado privado. Los 0 ms del resultado
`UNKNOWN` dejan sin medir el tiempo estudiantil.

Como control, el 11/11 se ejecutó `sync-json-success` desde `execute` con
`DockerAdapter`, runner `imp-03-quickjs.7` y Docker local 29.7.2. Devolvió
`SUCCESS / COMPLETED` y acreditó limpieza. También pasaron las 20 pruebas
locales de `remote-driver.test.cjs` y `vercel-transport.test.cjs`. Sigue
pendiente el recorrido entre los dos comandos del supervisor en la VM.

1. **Distinguir la condición de rechazo.** En el adaptador, leer el código
   de salida y registrar únicamente si stdout o stderr contienen datos.
   En el driver, asociar cada fallo a una fase fija mediante un código de
   salida reservado. Aprovechar las fases de `timing.mjs` para Docker y cubrir
   también la lectura de entrada y la escritura, cambio de propietario y
   limpieza del resultado. Conservar por separado el primer fallo y la
   evidencia de limpieza. Interpretar el código como fase del driver solo
   cuando esté acompañado de su marcador fijo. Obtener los indicadores de la
   respuesta que el SDK ya recibió, sin peticiones de logs adicionales. La
   salida válida sigue siendo silenciosa. La
   evidencia privada debe excluir texto de los canales, mensajes del sistema,
   código, argumentos, resultados y pruebas ocultas.
2. **Reproducir el recorrido de la imagen.** Usar un Linux local desechable
   con Docker 20.10/API 1.41 y las mismas imágenes. Lanzar bootstrap y driver
   como comandos separados, con el usuario y sudo de la imagen publicada.
   Comprobar primero que el segundo proceso puede abrir el socket y resolver
   la imagen. Durante la creación, comprobar el soporte de cuota de CPU
   (`CpuCfsQuota`, `CpuCfsPeriod`) y el resultado de solicitar
   `NanoCpus=1000000000`. El bootstrap del cuarto ensayo confirmó memoria,
   swap y procesos. Docker 20.10 puede rechazar la creación con `NanoCPUs`
   cuando el kernel o el montaje de cgroups carece de soporte CFS.
   [Validación de recursos de Moby 20.10.24](https://github.com/moby/moby/blob/v20.10.24/daemon/daemon_unix.go#L482-L484).
3. **Corregir la primera fase que falle.** Contrastar creación, inspección,
   canales de entrada y salida, arranque, estado final y entrega del archivo
   0600 al usuario que lo lee. Exigir el resultado determinista y la
   eliminación verificada de la cápsula y los archivos. Añadir una regresión
   del fallo reproducido. Con el SDK 3.2.2 y transporte simulado, cubrir
   salida no cero, éxito con stdout, éxito con stderr y éxito silencioso,
   con centinelas de privacidad. Mantener un despacho por ejecución y los
   límites de CPU, memoria, tiempo y salida.
4. **Validar el candidato en Vercel.** Si el fallo aparece únicamente en el
   proveedor, usar el candidato instrumentado para identificar la fase antes
   de atribuir la causa. Si cambia el driver incluido en la imagen, publicar
   y verificar el nuevo digest. Con un expediente y una autorización propios,
   ejecutar solo `sync-json-success` en una VM de São Paulo. Para aceptar el
   ensayo se exige `SUCCESS`, lectura y validación del resultado privado,
   límites efectivos de la cápsula, ausencia de la VM confirmada y cero
   snapshots. Un ensayo que solo identifique la fase fallida sigue siendo
   diagnóstico. La validación vertical de RUN/SUBMIT y el perfil de carga
   corresponden a las etapas siguientes.

## Instrumentación y verificación local del driver

El supervisor `imp-03-quickjs.8` distingue el primer fallo de ejecución y el
fallo de limpieza. El adaptador registra el código de salida y la presencia de
datos en stdout y stderr. Solo atribuye una fase si el código está reservado
para esa operación, stdout está vacío y stderr coincide exactamente con el
marcador fijo. La observación proviene de la respuesta ya recibida por el SDK
3.2.2. El informe y el journal de campaña guardan estos indicadores privados y
excluyen el contenido de los canales. La respuesta pública conserva los seis
diagnósticos existentes.

En el contenedor local construido con el nuevo supervisor se provocaron tres
fallos controlados. Un archivo `0600` inaccesible produjo `INPUT_READ`, JSON
inválido produjo `INPUT_DECODE` y un socket Docker ausente produjo
`ENGINE_RESOLVE`. Se comprobó el marcador exacto, stdout vacío y la retirada
de los archivos. La entrada privada de un caso ejecutado correctamente se
elimina y su resultado se entrega por archivo `0600` al usuario que lo subió.
El bootstrap informa los booleanos CFS que devuelve el daemon, o `null`
cuando la respuesta omite el valor o lo presenta con otro tipo.

Se reconstruyeron las dos imágenes en huéspedes VirtualBox sin tarjeta de red
ni carpetas compartidas, con 1 vCPU, 2048 MB y Docker 20.10.24/API 1.41.
El archivo `capsule.tar` de ambas tenía el SHA-256 `f95f58daabcf…`. Para
reproducir el servicio, se situó el daemon en un cgroup hijo con controlador de
memoria. Docker detectó memoria, swap, PIDs y los dos indicadores CFS. Las
primeras pasadas con almacenamiento vacío agotaron la espera del daemon y
el plazo de importación. Se importó la misma cápsula una vez en un volumen
privado, se comprobó su ID de configuración `sha256:96ffff38bde1…`, se detuvo
el daemon y se usó un clon del volumen por huésped.

| Imagen probada                         | Bootstrap con la cápsula precargada                            | Driver  | Tiempo estudiantil |
| -------------------------------------- | -------------------------------------------------------------- | ------- | ------------------ |
| v7 del cuarto ensayo (`03eef7a921c7…`) | 29,75 s                                                        | 9,50 s  | 2333 ms            |
| v8 instrumentada (`a05753737430…`)     | 14,95 s con el daemon disponible tras vencer la primera espera | 11,34 s | 2134 ms            |

En las dos imágenes, el segundo proceso abrió el socket Unix, el contenedor
se creó y el retorno de QuickJS fue `{ "sum": 5 }`. El driver salió con código
0 y ambos canales vacíos. El usuario `node` leyó el resultado con UID/GID 1000
y modo `0600`. Dentro de la cápsula se observaron `cpu.max=100000 100000`,
`memory.max=134217728`, `memory.swap.max=0` y `pids.max=32`. La limpieza
retiró entrada, resultado y contenedores. Son tiempos de invocaciones locales;
la medición del p95 desde Chile y las pruebas de agotamiento de los límites
siguen pendientes. El fallo del driver del cuarto ensayo continúa sin una fase
atribuible.

Pasaron las 306 pruebas del runner, las 886 de preproducción local y las 8 de
integración del servicio de proveedor de la API. Dos corridas anteriores de
preproducción agotaron el timeout de Jest en la preparación del candidato. La
suite completa y los 22 casos de preparación pasaron al repetirlos con el timeout
habitual. El informe local es `.local/reports/imp-03-07/driver-v8-local.json`.

## Quinto ensayo en São Paulo del 11/11/2026

El usuario autorizó la publicación privada de v8 y un único `sync-json-success`
en `alunza-preprod`, `gru1`, con hasta 36 llamadas, 8 reservadas para limpieza,
40 s de operación, TTL máximo de 60 s y presupuesto total de USD 0,02.
VCR confirmó `ready` para `linux/amd64` y el digest `sha256:a05753737430…`.
La estimación del expediente fue USD 0,010839 incluidos siete días de imagen.
El importe facturado sigue pendiente. La revisión de la imagen corresponde al
18/11/2026 a las 22:49 de Santiago.

La VM confirmó 1 vCPU, 2048 MB, `persistent:false`, `deny-all` y un TTL de
35.450 ms. El bootstrap terminó correctamente y Docker declaró `CpuCfsQuota`
y `CpuCfsPeriod` activos. El driver completó la creación, la inspección previa
y la apertura de los dos canales de la cápsula. En la fase `START`, devolvió
el código 75, stdout vacío y el marcador fijo en stderr. Esa fase corresponde
a `POST /containers/{id}/start` mediante el socket Unix de Docker. El driver
exige HTTP 204 para avanzar al envío de la entrada. La evidencia disponible
deja indeterminados tanto el estado HTTP como un posible fallo de transporte.
El diagnóstico público fue `UNKNOWN / PROVIDER_FAILURE`. Los 0 ms del resultado
de contingencia dejan sin medir el tiempo estudiantil.

El caso duró **19,6 s**. El proveedor informó 7706 ms de CPU activa y 11.200 ms
de VM aprovisionada. El journal registró un único despacho de creación y
9 llamadas, 5 de operación y 4 de limpieza. El comando de limpieza de archivos
salió con código 0 y ambos canales vacíos. El journal vinculó la misma sesión
confirmada con `ABSENT_AND_ZERO_SNAPSHOTS` y cero snapshots. El candidato de
fuentes se mantuvo estable y la campaña quedó en `NOT_ACCEPTED`.
[Informe saneado del quinto ensayo](../../.local/reports/imp-03-07/capability-remote-05.json).

El próximo diagnóstico local consiste en ejercitar la petición de arranque
con una respuesta distinta de 204 y con interrupción del socket. Registrar
únicamente el estado HTTP o una categoría fija del fallo permitiría distinguir
ambos casos sin copiar cuerpos de error ni datos de la cápsula. El fallo del
cuarto ensayo conserva su causa indeterminada. La validación de RUN/SUBMIT,
recuperación y p95 en preproducción sigue pendiente.

## Plan para resolver el fallo de START del quinto ensayo

El driver exige un HTTP 204 completo de Docker para pasar de `START` a
`SEND`. El código 75 y el marcador fijo sitúan el fallo entre esos dos puntos.
La entrada estudiantil seguía en el supervisor. El proceso de la cápsula pudo
haber arrancado aunque se perdiera la confirmación. Entre la reserva del
comando del driver y la de limpieza de archivos transcurrieron 1136 ms; ese
intervalo incluye operaciones fuera del POST. La imagen v8 ya completó el
mismo caso en Docker 20.10.24/API 1.41 local con la cápsula precargada.
La especificación del Engine distingue 204, 304 (ya iniciado), 404 (ausente)
y 500 (error del servidor). [Contrato de Docker 20.10.24](https://github.com/moby/moby/blob/v20.10.24/api/swagger.yaml#L6125-L6144).

1. **Conservar las dos observaciones del arranque.** En
   `infra/runner/docker-engine.mjs`, capturar el estado HTTP tan pronto como
   se reciban las cabeceras. Clasificar aparte si hubo una respuesta válida,
   una respuesta incompleta o inválida, un error del socket, una cancelación
   o un plazo vencido. Así un 500 seguido de un cuerpo truncado
   conserva ambos hechos. Un 204 completo sigue siendo el único paso a
   `SEND`. Si el daemon devuelve una causa reconocible de cgroup, montaje o
   permisos, el supervisor puede reducirla en memoria a una categoría fija
   respaldada por un caso de prueba. Los demás valores quedan indeterminados.
2. **Observar el contenedor antes de retirarlo.** Ante `START` fallido, y
   solo con tiempo disponible, consultar una vez el contenedor propio ya
   creado e inspeccionado. Conservar si se encontró, su estado, si consta
   inicio y si Docker registró OOM. Un fallo de observación deja esos datos
   desconocidos. Conservar el primer fallo, impedir otro arranque o envío y
   dar prioridad al tiempo reservado para la limpieza. La consulta usa el
   socket interno de Docker.
3. **Llevar la evidencia hasta el informe.** Mantener el código 75 y el
   marcador fijo. En esa rama se propone escribir un documento de diagnóstico
   privado `0600` en la ruta del resultado, distinguido por tipo y versión,
   con un máximo de 4 KiB. El adaptador lo leería una vez por stream si el
   lease y el plazo siguen vigentes. Validaría un esquema cerrado antes de
   incorporar los campos al journal y al informe. La lectura consumiría una
   llamada normal del presupuesto. Un archivo ausente, malformado o tardío
   conserva `START` y el diagnóstico público `UNKNOWN`. El protocolo debe
   impedir que este documento pueda contarse como resultado estudiantil.
   Mantener separados el resultado de limpieza de archivos y la evidencia de
   eliminación de la VM. Excluir texto del daemon, rutas, argumentos y salida
   de la cápsula.
4. **Probar las decisiones en local y corregir la causa reproducida.** Extender
   las pruebas de Engine, driver, transporte SDK y campaña. Incluir 204 válido,
   304/404/500, conexión perdida antes y después de las cabeceras, cancelación
   y plazo agotado. Cubrir un contenedor observado en marcha tras perderse el
   acuse, un fallo simultáneo de limpieza, un archivo diagnóstico inválido y
   centinelas de privacidad. Verificar un único POST de arranque y que cada
   fallo deje la entrada sin enviar. Si aparece un error de comunicación
   reproducible, corregir esa ruta y añadir la regresión. Si aparece 404,
   contrastar identidad y ciclo de vida. Ante 500, contrastar el estado
   observado y la categoría de Docker con el mismo perfil de aislamiento.
   Verificar el candidato con `sync-json-success` en Docker 20.10/API 1.41,
   retorno esperado en archivo privado, cgroups efectivos y limpieza. Las
   dos suites de base de Engine y conexión ejecutadas durante este análisis
   pasaron sus 90 pruebas. Las nuevas aserciones quedan por implementar.
5. **Verificar el candidato en São Paulo.** Preparar el digest, el expediente
   y el costo del candidato una vez que pase la verificación local. Proponer
   un único `sync-json-success`, una VM y el mismo presupuesto de tiempo,
   recursos y llamadas, con autorización propia. Aceptar la capacidad solo
   al comprobar `SUCCESS`, resultado privado correcto, límites efectivos y
   ausencia de la VM y de snapshots. Si persiste un fallo exclusivo de
   Vercel, usar la nueva evidencia para corregir la causa o documentar la
   capacidad pendiente con el proveedor. Las admisiones de usuarios siguen
   deshabilitadas hasta la validación correspondiente. La vertical RUN/SUBMIT,
   recuperación y p95 conservan sus criterios de aceptación independientes.

## Diagnóstico de START en el candidato v9

`imp-03-quickjs.9` conserva el estado HTTP de Docker en cuanto llegan las
cabeceras y registra por separado cómo terminó el intercambio. Un HTTP 500
con cuerpo truncado puede distinguirse de un 500 completo o del cierre del
socket antes de recibir cabeceras. El texto del daemon se reduce en memoria
a una categoría conocida de cgroup, montaje o permiso cuando corresponde.

El supervisor admite una consulta al ID inmutable del contenedor después de
comprobar la coincidencia de ID y etiquetas en la preinspección. La limita a
500 ms y deja un margen de 500 ms antes del plazo normal. Si faltan identidad,
tiempo o respuesta, el estado queda indeterminado. Un acuse incierto sigue
impidiendo tanto repetir el arranque como entregar la entrada de QuickJS.

Para un fallo `START` confirmado, la ruta privada del resultado puede contener
un documento `START_FAILURE` de versión 1, modo `0600` y propiedad del usuario
que subió el caso. El adaptador lee como máximo 4096 bytes y valida un esquema
cerrado antes de proyectarlo como `driverStartFailure` en el informe y el
journal. Un documento inválido o una lectura tardía conservan el diagnóstico
público del fallo. El SDK 3.2.2 dispone de una sola lectura normal para esa
observación, incluyendo fallos de red o respuestas 503. El presupuesto de
limpieza es independiente.

El candidato final `sha256:c356719e0558…` completó dos controles en un
huésped Linux aislado con Docker 20.10.24/API 1.41 y una copia precargada
de la cápsula `f95f58daabcf…` del quinto ensayo. El positivo obtuvo el retorno
esperado en un archivo privado `0600`. Desde dentro de la cápsula se observaron
134217728 bytes de memoria, swap cero, 32 procesos y cuota de una CPU.
El negativo retiró temporalmente el permiso de ejecución de `runc` en el
huésped de prueba. El driver salió con código 75 y recibió un HTTP 400 completo.
El contenedor siguió en `created`, con `hasStarted=false` y `oomKilled=false`.
El mensaje recibido dejó `runtimeCause=null`. El arnés comprobó la restauración
del runtime y la retirada de archivos y contenedores en ambos casos.

La primera pasada del arnés esperaba HTTP 500 para ese fallo. La observación
con Docker real motivó admitir categorías reconocidas de error en todo el
intervalo 4xx/5xx y comprobar el resultado de nuevo sin fijar el estado HTTP
en el observador. También se reprodujeron una pérdida de lease durante la
reserva de lectura y un cierre de la VM durante la validación posterior. El
adaptador revalida la autoridad antes del despacho y de aceptar el diagnóstico,
y cancela el stream cuando se inicia la limpieza.

Pasaron 357 pruebas del runner, 890 de preproducción local y 973 de la API,
además de tipos, compilación de la API, lint y formato. El ensayo inducido
verifica el diagnóstico del candidato. La causa del quinto ensayo remoto
permanece abierta. [Informe local de v9](../../.local/reports/imp-03-07/start-v9-local.json).

## Sexto ensayo en São Paulo del 11/11/2026

Se publicó `imp-03-quickjs.9` en el repositorio privado de `alunza-preprod`.
VCR confirmó `ready` para `linux/amd64` y el digest previsto
`sha256:c356719e0558…`. La autorización comprendió una VM en `gru1`, un
único caso `sync-json-success`, 36 llamadas (ocho reservadas para limpieza),
40 s de operación y TTL máximo de 60 s. El máximo autorizado fue USD 0,02.
La estimación de USD 0,010839 incluye siete días de imagen y el importe
facturado sigue pendiente. La revisión de almacenamiento corresponde al
18/11/2026 a las 23:38 de Santiago.
[Expediente del sexto ensayo](../../.local/preproduction/imp-03-07/capability-start-v9/release-proposal.json).

La VM confirmó 1 vCPU, 2048 MB, `persistent:false`, `deny-all` y un TTL de
39.817 ms. El bootstrap terminó correctamente y Docker anunció cuota y período
de CPU. El driver terminó en `START` con código 75. El diagnóstico privado
registró una respuesta HTTP 500 completa y `runtimeCause=CGROUP`. El contenedor
permaneció en `created`, con `hasStarted=false` y `oomKilled=false`. El driver
se detuvo antes de enviar el código estudiantil y el diagnóstico público fue
`UNKNOWN / PROVIDER_FAILURE`. El controlador y la operación concreta que
Docker intentó aplicar siguen indeterminados. El quinto ensayo conserva su
propia evidencia, limitada a la fase `START`.

El caso duró 16.707 ms. Vercel informó 7797 ms de CPU activa y 12.640 ms de VM
aprovisionada. El journal acredita una única reserva y un único despacho de
creación. Se consumieron seis llamadas de operación y cuatro de limpieza.
La limpieza de archivos salió con código 0 y ambos canales vacíos. El journal
vinculó el ID de la sesión confirmada con `ABSENT_AND_ZERO_SNAPSHOTS` y cero
snapshots. La fuente del candidato se mantuvo estable. La campaña terminó en
`FAIL / NOT_ACCEPTED`.
[Informe saneado del sexto ensayo](../../.local/reports/imp-03-07/capability-remote-06.json).

## Diagnóstico diferencial del sexto ensayo

Volvimos a verificar por SHA-256 el archivo OCI, sus 11 capas, la cápsula
interior y los cinco módulos del supervisor. El manifiesto coincide con el
recibo del registro privado y con la imagen confirmada por la sesión en
`gru1`. El contexto tenía siete archivos. La imagen publicada incluye
Docker 20.10.24, containerd 1.6.20 y runc 1.1.5 de Debian.
[Verificación del artefacto](../../.local/preproduction/imp-03-07/root-cause-investigation/lineage.json).

La estación Windows usaba Docker Desktop 29.7.2 sobre WSL2. Al inicio había
30 contenedores, 28 de ellos en ejecución, distribuidos entre cuatro proyectos.
Los siete de Alunza principal y los ocho del laboratorio estaban en ejecución
y utilizaban redes distintas. La inspección no encontró montajes compartidos
entre proyectos ni el socket de Docker montado en ellos. En un proceso hijo,
redirigimos únicamente su cliente Docker a una tubería inexistente. La
consulta de versión pasó de éxito a fallo. Las mismas 51 pruebas del SDK
3.2.2 pasaron en ambos controles con HTTP simulado. En el ensayo real,
el supervisor arrancó un daemon en la propia microVM y usó su socket Unix.
Así se descarta una colisión directa con los servicios de la estación.
[Control de transporte](../../.local/preproduction/imp-03-07/root-cause-investigation/transport-ab.json).
[Docker en una microVM de Vercel](https://vercel.com/i/docker-sandbox).

En Docker 20.10, la consulta de capacidades de cgroup v2 comprueba los
controladores visibles y la presencia de interfaces como `memory.swap.max`.
Al arrancar el contenedor, runc aún debe crear el subgrupo, incorporar el
proceso y aplicar los controles de recursos y de dispositivos. El padre
predeterminado de Moby con el driver `cgroupfs` es `/docker`. El proceso
de `dockerd` puede pertenecer a otro grupo. El diagnóstico `CGROUP` de v9
agrupa errores de esas operaciones y descarta el texto libre del motor.
[Capacidades en Moby 20.10](https://github.com/moby/moby/blob/v20.10.24/pkg/sysinfo/cgroup2_linux.go).
[Selección del padre](https://github.com/moby/moby/blob/v20.10.24/daemon/oci_linux.go#L739-L761).
[Implementación de runc en Debian](https://sources.debian.org/src/runc/1.1.5%2Bds1-1%2Bdeb12u1/libcontainer/process_linux.go/).

Ejecutamos el mismo caso `sync-json-success` con la cápsula fijada por digest
en el Docker Desktop compartido. Devolvió `{"sum":5}` en 189 ms de tiempo
estudiantil. El proceso observó `memory.max=134217728`, `memory.swap.max=0`,
`pids.max=32` y `cpu.max=100000 100000`. El supervisor eliminó el recurso
y una consulta independiente por la etiqueta exclusiva de ejecución encontró
cero contenedores. [Prueba en el Docker Desktop de la estación](../../.local/preproduction/imp-03-07/root-cause-investigation/desktop-case.json).

En un huésped VirtualBox con un único vCPU, 2048 MiB, sin interfaces de red
externas, carpetas compartidas ni socket del anfitrión, repetimos el caso
con el motor incluido en v9. Los cambios se aplicaron dentro de ese huésped.
Estas observaciones proceden de la primera serie con el padre predeterminado.

| Condición antes del arranque                                                                    | Observación en el huésped                                               | Resultado del supervisor v9                    |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------- |
| Padre vacío y escribible, incluidos dos controles con controladores inicialmente deshabilitados | Docker habilitó los controles necesarios                                | Resultado esperado y cuatro límites efectivos  |
| Máximo de descendientes del padre igual a cero                                                  | Crear un hijo de prueba dio `EAGAIN`                                    | Misma firma de seis campos que en São Paulo    |
| Padre ocupado por un proceso de prueba, sin controladores delegados                             | Crear un hijo vacío funcionó. Habilitar memoria en el padre dio `EBUSY` | Misma firma de seis campos que en São Paulo    |
| Montaje del padre de solo lectura                                                               | Crear un hijo de prueba dio `EROFS`                                     | HTTP 500, `runtimeCause=null`                  |
| Restauración después de cada una de las tres restricciones                                      | Tres ejecuciones con retorno correcto                                   | Cuatro límites efectivos y limpieza verificada |

Los errores `EAGAIN`, `EBUSY` y `EROFS` son resultados de operaciones de
control en el huésped local. El sexto ensayo remoto conservó solo la categoría
`CGROUP`. Las dos reproducciones exactas permiten priorizar la inspección del
padre efectivo de las cápsulas y de sus ancestros. También sigue siendo posible
un rechazo en otra fase de runc, por ejemplo al aplicar la política de
dispositivos. [Reglas de delegación de cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html#controlling-controllers).

Probamos una corrección dentro del huésped. Dejamos el padre predeterminado
con el máximo de descendientes en cero y configuramos el daemon privado con
`cgroup-parent` apuntando a un subárbol vacío y delegable del laboratorio.
El caso obtuvo `{"sum":5}` con los cuatro límites efectivos. Al terminar, la
operación de control en el padre original seguía dando `EAGAIN`. La prueba
de recuperación del padre ocupado consistió en trasladar el proceso de
prueba a su grupo de servicio y volver a habilitar la delegación.
[Evidencia del padre dedicado](../../.local/preproduction/imp-03-07/root-cause-investigation/guest-tests/dedicated.json).

En total se completaron 14 ejecuciones del supervisor en tres arranques de
la misma VM local. Siete devolvieron el valor esperado y siete provocaron
el fallo previsto. Cuatro de esos fallos coincidieron campo por campo con el
sexto ensayo remoto. El padre dedicado funcionó en dos arranques. En el último
se midieron los cuatro límites tanto dentro de la cápsula como en su subgrupo
durante la ejecución. En el primer arranque con ese padre, la muestra exterior
había captado la aplicación parcial de los límites. La prueba de montaje en
solo lectura confirmó ese modo para `dockerd`, `containerd` y su shim.
[Comprobación desde la cápsula y desde su grupo](../../.local/preproduction/imp-03-07/root-cause-investigation/guest-tests/namespace.json).

Las 14 limpiezas dejaron cero cápsulas. El contenedor auxiliar usado para
exportar la imagen se retiró sin arrancarlo. Al cierre había cero VM de
diagnóstico registradas y cero discos de trabajo. Los 30 ID preexistentes
seguían presentes. Los 28 contenedores que estaban en ejecución conservaron
su hora de arranque, contador de reinicios y salud. Un servicio ajeno a
Alunza, ya en ciclo de reinicios al inicio, pasó de 127 a 140. Su configuración
se conservó. Esta investigación efectuó cero operaciones de Vercel.
[Informe y recibos del diagnóstico](../../.local/reports/imp-03-07/cgroup-differential-v9-local.json).

Para preproducción, la siguiente comprobación es identificar el padre efectivo
del Docker anidado, la ocupación directa, los controladores delegados, el
límite de descendientes y el modo del montaje visto por el daemon. Un
observador de solo lectura puede tomar esa muestra con el usuario de v9.
Un estado inaccesible conserva la incertidumbre. Si Vercel proporciona un
subárbol delegable dentro de los recursos asignados, se puede comprobar allí
la corrección con el mismo caso y los cuatro límites medidos en la cápsula.
Si faltan permisos o el origen sigue ambiguo, el expediente para soporte ya
identifica la región `gru1`, el instante del sexto ensayo, las versiones de
Docker y runc, las dos condiciones reproducidas y la respuesta HTTP. La
pregunta para Vercel es qué subárbol admite el Docker interno de una imagen
privada y qué controladores y políticas de dispositivos puede aplicar.
[Observador de cgroup de solo lectura](../../.local/preproduction/imp-03-07/root-cause-investigation/observe-cgroup.mjs).

## Séptimo ensayo en São Paulo del 12/11/2026

Se reutilizó la imagen privada v9 fijada al digest `sha256:c356719e0558…` en
`alunza-preprod`. Vercel confirmó una VM en `gru1`, 1 vCPU, 2048 MB,
`persistent:false`, red `deny-all` y un TTL efectivo de 39.843 ms. Tras
arrancar el Docker de la imagen se ejecutó el observador como usuario sin
privilegios. El ensayo hizo cero ejecuciones estudiantiles.

El observador confirmó la identidad de `dockerd`. Ambos procesos compartían
los espacios de nombres de cgroup y de montaje. La raíz visible correspondía
a un subárbol de cgroup v2, montado en lectura y escritura. Contenía procesos
directos y cero descendientes. Los controladores `cpu`, `memory` y `pids`
estaban disponibles y `cgroup.subtree_control` estaba vacío. Los límites de
profundidad y número de descendientes indicaban `max`. La comprobación de
acceso como usuario del observador devolvió permiso de escritura denegado.

El daemon arrancó sin un padre o driver explícitos. En esta imagen faltaban
la configuración estándar del daemon y systemd. De esos datos y de los
valores predeterminados de Moby 20.10 se infieren `cgroupfs` y el padre
`/docker`. La inspección directa encontró ausentes `/docker`,
`/system.slice` y `/alunza-capsules`. La topología observada concuerda con
el caso local de un padre ocupado sin controladores habilitados para los
hijos. La operación exacta de runc y el error del kernel del sexto ensayo
continúan indeterminados. [Observación saneada](../../.local/preproduction/imp-03-07/capability-observer-v9-07/observation.json).

Un nombre de grupo distinto, por sí solo, deja pendiente la delegación.
El resultado motivó la consulta a Vercel sobre la delegación de controladores
para el Docker anidado de una imagen privada. La medición de los límites en la cápsula remota,
la vertical RUN/SUBMIT y su p95 siguen pendientes.

El journal registró un único despacho de creación y 12 llamadas a Sandbox.
Se usaron dos para el inventario inicial, cuatro para la operación, cuatro para la
limpieza y dos para el inventario final. Se confirmó el cierre de la sesión,
la ausencia de la VM y cero snapshots asociados. Ambos inventarios completos
del proyecto registraron cero VM y cero snapshots. El máximo autorizado fue
USD 0,02. La estimación para una VM durante 60 s fue USD 0,004904, sin
publicación adicional de imagen. El importe facturado sigue pendiente.
[Informe del séptimo ensayo](../../.local/reports/imp-03-07/capability-remote-07.json).

### Consulta a soporte de Vercel del 12/11/2026

Se abrió un caso privado en la categoría Vercel Sandbox para `alunza-preprod`
en `gru1`. Se solicitó al equipo confirmar qué padre y controlador de Docker
permiten imponer 128 MiB de memoria, cero swap y un máximo de 32 tareas a
la cápsula y todos sus descendientes dentro de la VM de 2 GB. La consulta
incluye qué procesos del subárbol observado deben permanecer en su grupo.

El asistente automático de Vercel indicó que el proveedor gestiona los
límites de la VM. El ejemplo que propuso traslada solo la terminal que lo
ejecuta y deja sin resolver los demás procesos observados en el grupo padre.
El portal confirmó el caso abierto con severidad 3, pendiente de respuesta
de soporte. La aceptación de los límites internos sigue pendiente. La consulta
supuso cero creaciones de Sandbox.
[Comprobante privado del caso](../../.local/preproduction/imp-03-07/capability-observer-v9-07/support-receipt.jpg).

### Respuesta del ingeniero de Vercel del 12/11/2026

Según la respuesta privada de soporte compartida por el responsable del proyecto,
Vercel admite Docker como proceso privilegiado dentro de la microVM. La asignación
de 1 vCPU y 2048 MB se aplica a la VM completa. Para contenedores anidados, Vercel
no ofrece un padre de cgroup delegado, un driver recomendado ni una garantía de
`memory.max`, `memory.swap.max` o `pids.max`. El SDK asigna 2048 MB por vCPU.
Usar una VM por carga protege la separación entre cargas, pero deja pendiente
el límite agregado de 134217728 bytes dentro de la VM.
[Procesos privilegiados en Sandbox](https://vercel.com/docs/sandbox/concepts/runtimes#system-privileged-processes) y [recursos de la VM en el SDK](https://vercel.com/docs/sandbox/sdk-reference).

Soporte revisó las solicitudes de dos sesiones e identificó el HTTP 500 en
el Docker Engine del huésped. En los runtimes administrados reprodujo la
secuencia: el grupo visible contiene procesos de Sandbox, el kernel impide
delegar memoria a sus hijos y el contenedor que exige memoria falla al arrancar.
Los cambios de driver, de espacio de nombres y de padre no resolvieron el fallo.

En un experimento propio, el ingeniero obtuvo límites de memoria, CPU y PID al
reorganizar los grupos del huésped, incluido el proceso de inicio de Sandbox.
Indicó que el procedimiento carece de soporte, depende de cada arranque y
solo se ensayó en runtimes administrados. Quedaron fuera de ese ensayo nuestra
imagen privada Debian con Docker 20.10.24 y la comprobación de swap. Esta
respuesta aporta evidencia sobre el proveedor, sin añadir una ejecución de Alunza.

**Decisión pendiente.** Mantener deshabilitadas las admisiones remotas. Antes
de otro ensayo, identificar un mecanismo soportado que limite la memoria total
del proceso estudiantil y todos sus descendientes, incluida la memoria nativa,
y permita verificar swap y PID. Si exige otra plataforma para el ejecutor,
presentar esa alternativa para decisión formal sobre AD-ARQ-001. La aceptación
requiere observar los límites efectivos con el candidato elegido, además de la
paridad, recuperación y p95 ya previstos.
[Contrato de ejecución y unidades](../../specs/13-ejecucion-controlada.md) y [autoridad de las decisiones](../../specs/00-fuentes-y-decisiones.md).

## Contrato implementado

NestJS selecciona el proveedor mediante `PRACTICE_RUNNER_PROVIDER`. Los puertos
internos comparten las proyecciones públicas existentes; endpoints, diagnósticos,
límites estudiantiles, DEC-002 y persistencia anterior a IA/RAG se conservan.
Docker sigue siendo el ejecutor local. Preproducción admite Vercel únicamente
con contexto de campaña aprobado y credencial privada del servidor.

La imagen inspeccionada y su versión se guardan con cada admisión. La limpieza
se dirige al proveedor persistido, incluso si cambia la selección para nuevas
admisiones. Una reserva antigua sin contexto conserva su significado Docker;
no se inventa identidad remota para ella.

El SDK permanece fijado en **3.2.2**. El runner incorporó en
**`imp-03-quickjs.6`** el protocolo remoto mediante archivo privado. Se
corrigen el import omitido de `timing.mjs` y la identificación de la URL real
`/api/v3/sandboxes`. La guardia permite una creación, impide reanudación,
bifurcación, snapshots y nuevas sesiones, y comprueba la identidad de cada
recurso observado. Los ensayos de transporte usan el SDK instalado con fetch
simulado; no acreditan capacidad real del proveedor.

La VM es nueva por ejecución, con imagen por digest, 1 vCPU/2048 MB,
`persistent:false`, egreso denegado, cero puertos y ningún secreto estudiantil.
Cada caso utiliza una cápsula limpia. La salida privada se escribe con permisos
0600, se lee con límite de 524288 bytes antes de acumular, se valida y se elimina;
no se imprime en los logs del proveedor. El comparador permanece fuera del
intérprete estudiantil. Estas opciones siguen la [referencia oficial del SDK](https://vercel.com/docs/sandbox/sdk-reference).

## Persistencia y recuperación

La migración `20261104023230_practice_sandbox_lifecycle.sql` añade contexto a
las reservas existentes y dos tablas en `app_private`:

| Tabla               | Responsabilidad                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `sandbox_campaigns` | Contexto inmutable, vencimiento y contadores de creaciones/llamadas; reserva de ocho llamadas de limpieza por creación permitida. |
| `sandbox_resources` | Ejecución y ámbito, correlación/nombre únicos, ID de sesión remota, estados y prueba durable de limpieza.                         |

Las referencias mantienen organización/clase y relación comprobable con RUN o
SUBMIT. El rol de aplicación carece de acceso directo a las tablas; utiliza
funciones privadas acotadas. El observador de campaña expone únicamente
metadatos operacionales, sin código, tests, tokens ni identidades estudiantiles.

Creación: `PREPARED → UNKNOWN → CONFIRMED`. Limpieza:
`PENDING → VERIFIED`. El cambio a `UNKNOWN` y la cuota se confirman antes del
único POST. Una respuesta perdida nunca autoriza repetirlo. El recibo tardío de
un ID puede asociar el recurso a su correlación, pero no restaura el lease de
un trabajador antiguo ni permite ejecutar.

`NOT_DISPATCHED` solo cierra una reserva que sigue en `PREPARED`, serializando
con la autorización del POST. Una creación confirmada necesita prueba de
ausencia del mismo recurso y cero snapshots. Un 404 de creación incierta, un
TTL vencido o un 401/403 no satisfacen esa prueba. Las transiciones y la
finalización verifican estas condiciones también en PostgreSQL.

Los reconciliadores continúan con admisiones deshabilitadas o campaña vencida.
Nunca ejecutan código: recuperan resultados ya persistidos o conservan
`UNKNOWN` operacional; observan, detienen y eliminan recursos propios. La
incertidumbre retiene el cupo y produce un aviso operacional. No se purga el
registro de un recurso pendiente al vencer el replay. Si la BD no acepta
identidad o prueba de limpieza, el recurso conserva su estado pendiente; no se
declara limpieza inmediata durante una caída de persistencia.

## Plazos y despliegue preparado

Los presupuestos son 3000 ms estudiantiles acumulados, 134217728 bytes de
memoria y 65536 bytes de salida combinada. Operación inicial: 30 s; operación y
limpieza inicial: 40 s; lease: 60 s; recuperación: hasta 30 s por intento;
TTL de VM: hasta 60 s. Los deadlines se comparten entre bootstrap, comandos y
transporte. El ensayo explícito de vencimiento natural tiene una ventana
independiente de observación; no amplía el presupuesto de la API.

ACA recibe token por `secretRef`, campaña por volumen secreto, mínimo de una
réplica mientras requiere recuperación y 60 s de gracia. `rolloutId` permite
crear una revisión de configuración conservando el digest. La salud no crea
Sandboxes. Para retirar el candidato se deshabilitan admisiones, se conserva
la revisión capaz de recuperar hasta cero pendientes y después se vuelve a la
revisión compatible anterior, sin borrar el registro operacional.

## Campañas y reproducción

La [guía de campañas](../../infra/preproduction/SANDBOX-CAMPAIGNS.md) contiene
plantillas denegadas por defecto, variables, costos y procedimientos. Cápsulas
y API utilizan campañas distintas: journal durable local para las primeras y
contadores PostgreSQL para la segunda. Las llamadas HTTP del cliente de prueba
se cuentan por separado de las llamadas Vercel.

El inventario de cápsulas cubre fixtures compartidos, probes OS confiables,
cancelación, concurrencia, pérdida de respuesta de creación y vencimiento
natural. Las etapas API cubren RUN/SUBMIT, idempotencia, historial/progreso,
interrupción de ACA y 50 solicitudes secuenciales más 50 concurrentes por modo.
El pacing conserva diez solicitudes por minuto y actor y queda fuera del tiempo
HTTP medido. La VM estudiantil siempre es nueva. El reinicio se acredita con
reemplazo de réplica o incremento observado de `restartCount`, no con un
diagnóstico `UNKNOWN` aislado. El recorrido Cypress tiene configuración separada
y no modifica el arnés local ni el protocolo de diagnóstico detenido.

Comandos locales, desde la raíz y con Node 24.21.0:

```powershell
. ./scripts/use-node.ps1
npm run test:sandbox:integration
npm run test:sandbox:upgrade
npm run test:runner
npm run test -w @alunza/api
npm run test:preproduction
node scripts/sandbox-campaign.mjs plan infra/preproduction/sandbox-campaign.example.json
```

Los comandos de integración usan exclusivamente LAB TEST. `plan` no ejecuta
red. `preflight` debe permanecer bloqueado con las plantillas sin aprobar;
`run` requiere el expediente completo y autorización vigente.

## Evidencia y pendientes

La primera regresión focal pasó 302/303: la expectativa antigua excluía contexto
de admisión. Se actualizó para exigir el nuevo contrato sin alterar el código
estudiantil. Después aprobaron las suites focales y la suite completa de API:
968 pruebas en 54 suites en ese corte. Tras añadir las últimas regresiones de
enrutamiento y limpieza sin despacho, aprobaron otras 56 pruebas focales en
cinco suites. La verificación final se registra junto con el candidato en
`.local/reports/imp-03-07/`; los cortes intermedios conservan sus propios hashes,
sin presentarlos como una única ejecución sobre el árbol final.

Persistencia: 232 aserciones SQL (69 nuevas), cinco carreras con 16 comprobaciones,
seis comprobaciones de upgrade con reservas antiguas vivas y diez pruebas unitarias
del repositorio. Los comandos publicados `test:sandbox:integration` y
`test:sandbox:upgrade` se ejecutaron también y aprobaron: sus informes privados
son `database.json` y `upgrade.json` dentro de `.local/reports/imp-03-07/`.
El informe anterior `.local/reports/imp-03/sandbox-persistence.json` conserva
comandos y hashes del alcance. La regresión integrada completa aprobó 260 HTTP
en 21 suites y 1582 aserciones SQL en 23 archivos, incluyendo caída real de la
BD exclusiva LAB TEST. Sus servicios quedaron detenidos al finalizar.

Runner: 247 pruebas en 11 suites con transporte simulado, sin red; además, el
probe real Docker aprobó 69 casos, con cero fallos y cero contenedores propios
pendientes. Se preparó el contexto aislado de imagen Sandbox y su `capsule.tar`
sin publicarlos. Ningún resultado local acredita Sandbox real.

Pasaron los tipos del monorepo, build de API/runner/web y compilación de
`main.bicep` con Bicep 0.48.1. La CLI portátil se obtuvo por el procedimiento
[oficial de Microsoft](https://learn.microsoft.com/azure/azure-resource-manager/bicep/install),
con firma Authenticode válida, sin despliegue. La revisión de artefactos se
intentó antes de generar el build web y falló por ausencia de `.next/static`;
después del build aprobó los 45 artefactos públicos. Los archivos Office y
`next-env.d.ts` previos se conservaron; la regeneración temporal de tipos de
Next se restauró al contenido original. Los controles finales de formato,
lint y campañas se detallan en el informe local. La suite de preparación final
aprobó 854 pruebas en 43 suites; la revisión focal final del arnés API/ACA aprobó
47 pruebas y el arnés de navegador seis, sin abrir navegador ni conectarse a
servicios remotos. Formato y lint generales aprobaron. La matriz IMP-07.01 quedó
consistente, sin errores ni advertencias, preservando el baseline histórico.

La imagen local de API `alunza-lab-api:imp-03-07-candidate` se construyó desde
`infra/Dockerfile`, lockfile y base fijada por digest. Se conserva su identidad
en el informe local; no se publicó en un registro. En el corte del 04/11/2026
aún faltaban la publicación de la imagen externa Sandbox y la verificación
de su digest en el destino autorizado.

Al cierre local del 04/11/2026 faltaban destinos Vercel/ACA/Supabase inequívocos, región, imágenes publicadas por
digest, credenciales privadas y presupuesto aprobado. No se encontró un proyecto
Vercel llamado Alunza en la consulta conectada disponible; no se asignaron otros
proyectos por suposición. No se ejecutaron publicación, migración remota ni
campañas. La disponibilidad de Docker/cgroups anidados, aislamiento efectivo,
paridad remota, limpieza cloud y p95 desde Chile siguen pendientes. El primer
ensayo propuesto usa autorización propia para una creación, 36 llamadas y
40 s; no reutiliza el permiso histórico del probe. Los costos no se estiman
numéricamente hasta conocer región y tarifas vigentes. La aceptación de ayuda
con proveedor IA real conserva su expediente y dependencias separados.

IMP-03.07 no queda cerrado hasta esa evidencia remota. El bloqueo de IMP-06.04,
las campañas ETL y la CI integral conservan su estado; este incremento no los
reanuda ni modifica sus requisitos.
