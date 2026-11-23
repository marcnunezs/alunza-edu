# Apagado de Kong y PostgREST del laboratorio físico

Este procedimiento opera exclusivamente el proyecto Docker
`alunza-edu-laboratorio-physical-test`, en su red privada con publicaciones en
loopback. Requiere Linux, Node 24.21.0, dependencias del lockfile, acceso al socket
Docker local y el estado privado del mismo destino TEST. No inicia servicios,
elimina contenedores, recrea volúmenes ni ejecuta migraciones.

## Antes del cierre

Finalizar la campaña conforme a
[la guía de navegador](validacion-local-navegador-13.md#5-límites-fallos-y-cierre):
comprobar retiro de VM, ledger sin pendientes ni recursos inciertos, preservar
intentos, cerrar los fixtures propios y detener API, réplica, web, control y
broker por identidad. Mantener PostgreSQL disponible durante esta comprobación.
No admitir trabajo nuevo mientras se apagan los servicios.

Usar rutas privadas nuevas para cada plan y recibo. El estado `runtime.json`
contiene credenciales: se lee localmente; no se adjunta a informes ni se imprime.
Los comandos siguientes se ejecutan desde la raíz del checkout en el Ryzen.

```sh
node scripts/local-service-stop.mjs plan --output /ruta/privada/cierre-plan-01.json
```

```sh
node scripts/local-service-stop.mjs stop --plan /ruta/privada/cierre-plan-01.json --runtime /ruta/privada/runtime.json --output /ruta/privada/cierre-recibo-01.json
```

Cada bloque es un comando. Las rutas son ejemplos y deben apuntar a los archivos
del destino TEST físico. También existen los alias
`npm run local:physical:services:plan -- ...` y
`npm run local:physical:services:stop -- ...`.

El plan fija identidades, imágenes, configuración, red, montajes, generación de
procesos y políticas de reinicio. Se vuelve a comprobar antes de actuar. Un
reinicio, cambio de configuración o plan ajeno exige investigar y generar un
plan nuevo; no editar un recibo para convertirlo en aprobado.

## Qué significa el resultado

Kong recibe SIGCONT mediante Docker para recorrer su ruta de parada manual y
luego el cierre del maestro Nginx mediante su comando nativo. PostgREST recibe
SIGTERM. El recibo distingue la solicitud de parada manual de una marca durable
verificada; no afirma haber probado el reinicio del daemon. No hay escalada
automática a SIGKILL y se conserva el plazo de
20 segundos. Las políticas originales se restauran y se comprueba que los
servicios sigan detenidos; un fallo de restauración queda como fallo.

El binario fijado de PostgREST 14.10, compilado con GHC 9.4.8 y ejecutado como PID1,
puede terminar con **255** por la ruta de interrupción del runtime. Ese valor se
conserva explícitamente como `expected-interrupt-255` únicamente al verificar
identidad, señal y mensaje actuales, generación sin reinicio, ausencia de OOM y
SIGKILL, salida dentro del plazo y desaparición de sus conexiones PostgreSQL.
Un 255 aislado, otra imagen, evidencia incompleta o conexiones pendientes falla.
La comprobación requiere inactividad previa; no acredita drenaje de solicitudes
HTTP en curso ni un reinicio del daemon Docker.

Después, detener Auth, Storage y PostgreSQL por identidad, conservando datos y
políticas; comprobar puertos cerrados, volúmenes y evidencia. Estos tres servicios
no están incluidos en este comando acotado. No sustituirlo por `supabase stop`
para inferir que hubo cierre ordenado de los dos servicios.

Los resultados físicos y sus limitaciones se conservan en
[el registro del incremento](../work/IMP-03-apagado-servicios-fisico.md).
