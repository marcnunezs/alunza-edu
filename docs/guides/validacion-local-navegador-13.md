# Validación local de navegador y capacidad `.13`

Guía del arnés adjunto a **physical TEST**, preparada el 17/11/2026. El [registro del incremento](../work/IMP-03-navegador-capacidad-13.md) identifica las campañas aprobadas, los fallos conservados y las limitaciones; esta guía permite repetir el procedimiento, sin atribuir resultados nuevos. El [README del arnés](../../tests/e2e/physical/README.md) fija su alcance. La [campaña HTTP anterior](../work/IMP-03-api-fisica-13.md) corresponde a otro candidato de API.

Se conserva `local-vm` únicamente en local/test, con NestJS como única API de dominio. No cambia AD-ARQ-001 ni constituye despliegue, aprobación remota, contratación o aceptación académica. El navegador accede por túneles SSH en la LAN; ese perfil no representa Internet público.

## 1. Preparar el destino y fijar las identidades

El operador debe disponer de estos elementos antes de lanzar el arnés:

- Ryzen con Linux físico y KVM elegible, kit virgen `.13` verificado, broker y dependencias ya preparados. Runner, bundle, imagen y huésped permanecen congelados. Cada admisión crea una VM nueva; cada caso mantiene su cápsula nueva. Véase [operación del broker](../../infra/runner/linux-vm/README.md).
- Checkout y builds de API/web correspondientes a los hashes de la campaña, dependencias del lockfile, **Node 24.21.0 y npm 11.19.0**. Contracts debe estar compilado. Chrome y Cypress 16.0.0 deben estar disponibles en Lenovo. Un build nuevo exige volver a fijar su identidad.
- Proyecto Supabase **`alunza-edu-laboratorio-physical-test`**, con BD, red y volúmenes propios, migraciones incluidas `20261118012036_practice_local_vm_capacity.sql` y `20261118020356_academic_version_read_bounded_lookup.sql`, y fixtures ficticios. No reutilizar, borrar ni reinicializar el stack histórico. El seed canónico se conserva; los fixtures de campaña se agregan y luego se cierran sin borrar intentos.
- Credenciales TEST nuevas: firma, secreto JWT, claves API opacas, credencial del rol de aplicación y contraseña de fixtures. Una firma nueva no demuestra rotación de las claves opacas. Verificar consumidores y rechazo de la clave administrativa anterior mediante un acceso administrativo real; `supabase status` no acredita por sí solo la configuración de contenedores ya existentes. No imprimir valores ni activar TLS solo para rotar un certificado inactivo.
- API principal y réplica con la misma BD, hostId, kit y broker; runtime `alunza_app` sin superusuario ni BYPASSRLS. El UDS privado del broker no se usa para ejecuciones paralelas fuera del ledger de la API.
- Recibos previos de cero QEMU propios, cero recursos pendientes/inciertos, integridad de bases y propiedad de puertos/procesos. Ante retiro incierto, detener la campaña antes de admitir otra VM.

La preparación de servicios es explícita y pertenece al operador. Los comandos de campaña de esta guía **no** arrancan Docker, API, web, broker ni túneles. No usar `npm run test:e2e`, el launcher E2E general ni `phase-context` para este perfil adjunto.

En PowerShell, desde la raíz comprobada del checkout, fijar Node solo en este proceso:

```powershell
$alunzaNodeDir = Join-Path (Get-Location) '.tools/node-v24.21.0-win-x64'
$env:PATH = "$alunzaNodeDir;$env:PATH"
node --version
npm.cmd --version
```

Deben informar `v24.21.0` y `11.19.0`. En Ryzen, usar el binario preparado y verificado del paquete del operador, no el primero que encuentre otro PATH.

## 2. Mantener cinco accesos en loopback

| Puerto | Servicio                | Acceso de campaña           |
| ------ | ----------------------- | --------------------------- |
| 3300   | Web Next.js             | Navegador Lenovo            |
| 4300   | API NestJS principal    | HTTP, navegador y capacidad |
| 4301   | API NestJS réplica      | Carreras de capacidad       |
| 4302   | Control privado Node    | Tareas del arnés            |
| 18421  | Supabase Auth/API local | Sesiones reales             |

Todos los listeners y forwards deben usar `127.0.0.1`. PostgreSQL 18422 permanece privado en Ryzen; no necesita forward al navegador. Mantener la clave y huella SSH previamente verificadas. Un ejemplo de forwarding, sustituyendo `RYZEN` por el alias verificado, es:

```text
ssh -N -T -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=yes -L 127.0.0.1:3300:127.0.0.1:3300 -L 127.0.0.1:4300:127.0.0.1:4300 -L 127.0.0.1:4301:127.0.0.1:4301 -L 127.0.0.1:4302:127.0.0.1:4302 -L 127.0.0.1:18421:127.0.0.1:18421 alunza@RYZEN
```

No usar `-g`, bindings públicos ni desactivar la comprobación de host. Registrar el proceso propio del túnel para retirarlo después. Si capacidad se ejecuta en Ryzen, sus dos API se consultan directamente por loopback.

## 3. Preparar los manifiestos privados

Crear tres archivos ordinarios separados para control, capacidad y navegador. En Linux pertenecen al usuario que ejecuta y tienen permisos `0600`; sus directorios privados, `0700`. Comparten `campaignId`, los siete pins, `webSourceDigest`, endpoints y `controlKey`; cada uno tiene un `outputDir` absoluto, distinto y **todavía inexistente**, válido en el sistema donde se ejecuta.

Esta plantilla muestra campos, no valores ejecutables:

```json
{
  "schemaVersion": 1,
  "campaignId": "UUID_NUEVO",
  "candidate": {
    "runnerVersion": "imp-03-quickjs.13",
    "capsuleImageId": "sha256:HASH_VERIFICADO",
    "runnerSourceDigest": "SHA256_VERIFICADO",
    "kitManifestSha256": "SHA256_VERIFICADO",
    "guestSha256": "SHA256_VERIFICADO",
    "apiSourceDigest": "SHA256_VERIFICADO",
    "brokerSha256": "SHA256_VERIFICADO"
  },
  "webSourceDigest": "SHA256_VERIFICADO",
  "endpoints": {
    "web": "http://127.0.0.1:3300",
    "api": "http://127.0.0.1:4300",
    "apiReplica": "http://127.0.0.1:4301",
    "auth": "http://127.0.0.1:18421",
    "control": "http://127.0.0.1:4302"
  },
  "controlKey": "64_HEXADECIMALES_ALEATORIOS_PRIVADOS",
  "statePath": "/ruta/privada/runtime-del-nuevo-test.json",
  "brokerSocket": "/ruta/privada/broker.sock",
  "outputDir": "/ruta/nueva/salida-de-este-comando"
}
```

Copiar las identidades de los artefactos realmente instalados. `statePath` y `brokerSocket` designan recursos de Ryzen; para el manifiesto de navegador, `outputDir` será una ruta absoluta Windows. No publicar el manifiesto: incluye la clave de control. No pasarla a `Cypress.env`, al cliente web ni a la línea de comandos.

El control acepta únicamente `POST /task` con campaignId, `x-alunza-control-key` y acciones enumeradas en el [contrato](../../scripts/linux-vm-browser-contract.mjs). No acepta SQL ni shell arbitrarios. Las tareas Node gestionan credenciales; al navegador solo llega la sesión Auth real del actor.

## 4. Ejecutar perfiles separados

Con servicios saludables, iniciar el control en Ryzen desde el checkout instalado, salvo que ya lo haya iniciado su controlador privado:

```sh
node scripts/linux-vm-browser-control.mjs --manifest /privado/bridge.json
```

No iniciar un segundo control sobre 4302. Antes de **cada** campaña, dejar transcurrir al menos 60 segundos desde la última admisión de la campaña anterior y comprobar que no queda trabajo activo. No elevar cuotas ni alterar las fechas para evitar `RATE_LIMITED`.

| Perfil                | Denominador y comprobación                                                                         | Reloj                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| HTTP normal           | 20 RUN8 + 20 SUBMIT8, además de sus gates funcionales                                              | Envío HTTP hasta el último byte de respuesta                                                |
| Navegador             | Ocho escenarios funcionales, luego 20 RUN8 + 20 SUBMIT8                                            | Click efectivo; SUBMIT desde confirmación final, hasta resultado correlacionado renderizado |
| Capacidad controlada  | Seis tandas RUN/SUBMIT/mixtas, anchos 2 y 4: 18 ofertas, seis admisiones y doce rechazos esperados | Recibos de admisión/rechazo; fuera de p95                                                   |
| Capacidad sin barrera | Dos carreras mixtas entre las dos API: seis ofertas, dos admisiones y cuatro rechazos esperados    | Recibos de carrera; fuera de p95                                                            |

Los 24 ofrecimientos de capacidad deben crear solo ocho VMs, una por tanda; nunca más de una simultánea. `RUNNER_BUSY` exige HTTP 503 retryable, `Retry-After: 1` y ausencia de operación/reserva/intento/recurso del perdedor. Un replay conserva identidad y no crea otra VM. La UI conserva key y snapshot para el reintento manual, sin cola ni reenvío automático; la recuperación de respuesta incierta es un estado distinto.

La barrera controlada observa admisión anterior al commit y espera únicamente las respuestas HTTP de los contendientes, con liberación programada a más tardar a los 1200 ms desde observarla. Registra motivo y tiempo real; no es una garantía de tiempo real estricto. `barrier-release` solo desbloquea. Después se esperan **todas** las respuestas pendientes, se verifica evidencia privada de BD/broker y, con host y ledger inactivos, `barrier-cleanup` retira trigger y función. El ledger PENDING conserva la exclusión después del commit. Nunca ejecutar DROP mientras las peticiones están pendientes: puede bloquear la relación y contaminar la prueba. Una barrera nueva exige haber retirado la anterior. F08 libera tras el 503, antes de consultar ausencia de efectos, esperar Retry-After o recargar. La campaña fallida `capacity-01` queda preservada; este cambio de arnés no convierte sus resultados en aprobados.

Para las 40 normales HTTP se reutiliza la función [runLinuxVmApiCampaign](../../tests/integration/linux-vm-api.mjs), que **no tiene CLI propia**. El wrapper privado de este expediente existe en `B/http-campaign.mjs`, donde `B=/home/alunza/laboratorio/physical-browser-13-20261117`; requiere el estado TEST y los artefactos instalados de ese directorio. Una invocación del operador es:

```sh
/home/alunza/laboratorio/physical-browser-13-20261117/tools/node /home/alunza/laboratorio/physical-browser-13-20261117/http-campaign.mjs http-nueva-etiqueta
```

La etiqueta debe ser nueva; el wrapper rechaza salidas existentes. Es un auxiliar privado de este expediente, no un launcher portable versionado. Para otro directorio, preparar y revisar un wrapper equivalente con fixtures/Auth/observer reales; no ejecutar el wrapper histórico apuntando a otra BD por sustitución implícita.

Tras la ventana de cuota y con manifiestos propios, los comandos versionados son:

```sh
node scripts/linux-vm-capacity.mjs --manifest /privado/capacity.json
```

```powershell
node scripts/linux-vm-browser.mjs --manifest C:/privado/browser.json
```

F01 publica desde UI el ejercicio de dos visibles/seis ocultas, ejecuta RUN2 y SUBMIT8 sobre la misma versión y comprueba su intento en historial/progreso/detalle docente. Las mediciones RUN8 usan otro ejercicio con ocho visibles. No atribuir RUN8 y SUBMIT2+6 al mismo ejercicio. Los ocho estudiantes rotan; esta campaña de navegador admite como máximo nueve operaciones por estudiante, bajo la cuota habitual de diez por minuto.

Cada modo normal exige 20 muestras completas, ninguna fallida/omitida y p95 estrictamente menor a 5000 ms. No sumar relojes de componentes para sustituir HTTP o navegador. Login, navegación previa y arranque quedan separados; no se vacía la caché del host. Capacidad, recuperación, errores deliberados y TIMEOUT no entran en los percentiles normales.

## 5. Límites, fallos y cierre

Se mantienen las dos capas: **una vCPU/2147483648 bytes por VM**, y **134217728 bytes, 3000 ms totales y 65536 bytes de salida acumulada** para el trabajo estudiantil. No hay presupuesto nuevo por caso. Los plazos operativos de 30 s, limpieza de 40 s y TTL externo de 60 s no amplían los 3 s estudiantiles. El timeout SQL sigue en 2 s. La liberación automática a los 12 s de la barrera TEST es un fallo de campaña, no una extensión del producto.

Conservar primeras muestras, lentas, errores y campañas incompletas. No sobreescribir `outputDir`, repetir automáticamente ni completar un denominador fallido con otra corrida favorable. Un fallo se investiga y cualquier repetición lleva nueva etiqueta. Un resumen offline o un código de salida favorable aislado no acredita aceptación física.

Al terminar o interrumpir:

1. Detener nuevas ofertas. Mantener API/reconciliador/broker disponibles hasta retirar o identificar el trabajo propio. Si queda limpieza incierta, bloquear nuevas admisiones y conservar la evidencia; no borrar el ledger para liberar el puesto.
2. Verificar `active=0`, `uncertain=0`, `ledger.pending=0` y registros CLOSED con limpieza verificada; contrastar QEMU, overlays/scratch propios e integridad de bases. Restaurar la membresía revocada de F06 y retirar la barrera TEST; el cierre/shutdown del control incluye esa restauración.
3. Cerrar fixtures sin borrar intentos y retirar solo procesos/túneles propios por identidad. En este expediente el operador dispone de `B/process-control.py stop web`, `stop replica`, `stop api` y `stop control`; broker tiene controlador privado separado. Esos auxiliares no se distribuyen como launcher genérico. No usar señales por nombre global ni borrar volúmenes históricos.
4. Detener únicamente contenedores del nuevo proyecto cuando la auditoría permita hacerlo, conservando sus volúmenes. Para Kong y PostgREST usar el [procedimiento de cierre físico](apagado-servicios-fisicos.md), manteniendo PostgreSQL vivo hasta comprobar retiro de conexiones. Registrar el estado final y los fallos de cierre, aunque el perfil de latencia haya pasado.
5. Respaldar por allowlist protocolos, filas, casos, resúmenes, recibos saneados, pins y fuentes exactas. Conservar `protocol.json`, `requests.jsonl`, `cases.jsonl`, `summary.json` y `control-events.jsonl` cuando existan. Excluir `runtime.json`, manifiestos con `controlKey`, `.env`, claves de firma/SSH, contraseñas, tokens y diagnósticos crudos con secretos. Verificar SHA256 del archivo y de sus miembros tras copiarlo. Los volúmenes preservados no equivalen por sí solos a una restauración ensayada.

Los captures iniciales `integration-01` y `campaign-tools-01` contienen la clave de firma local `supabase/signing_keys.json`; **sus tar originales permanecen privados y no se exportan**. El auxiliar privado `B/backup-evidence.py` genera derivados bajo `sanitized-sources`, omite esa clave y conserva un manifiesto filtrado y procedencia con hashes originales y omisiones. No reetiqueta la identidad del candidato ni modifica los originales. Los fixtures sintéticos de pruebas se conservan solo tras revisión y allowlist de hash exacto, con clasificación/offset/hash sin imprimir sus valores. Un capture posterior que ya excluya la clave mantiene su propia identidad. Los recibos saneados de diagnóstico y fallos se preservan por nombres explícitos; el respaldo no filtra por éxito ni acredita aceptación.

Capturas automáticas, vídeo, reintentos de Cypress y Cypress Cloud están deshabilitados en la [configuración focal](../../tests/e2e/physical/cypress.config.cjs). Esta guía no ordena arrancar servicios ni establece resultados nuevos: la aceptación se registra después de revisar recibos, integridad y retiro del candidato realmente ejecutado.
