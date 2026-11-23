# Campañas Sandbox de IMP-03.07

La plantilla `sandbox-campaign.example.json` está **sin autorización**. Prepara el inventario y sus límites; no acredita una ejecución, aceptación, autorización humana ni costo observado. El probe anterior de IMP-00.06/IMP-00.08 conserva su manifiesto y límite de una creación. Esta campaña es una operación distinta.

El primer paso remoto propuesto es `sandbox-capability-campaign.example.json`: una creación, 36 llamadas máximas (28 normales + 8 reservadas para limpieza) y 40 s. Usa el caso mínimo correcto y exige las verificaciones efectivas del SDK, bootstrap Docker/cgroup y limpieza. Tiene UUID y aprobación propios, ambos independientes del permiso histórico del probe. Completar destino/candidato/tarifas y obtener la autorización de ese ensayo antes de ejecutarlo. Si revela una capacidad ausente, detenerse y recuperar sus recursos; todavía no ejecutar la campaña de 69 creaciones. Sólo después de revisar esa evidencia se propone autorizar las campañas ampliadas. Sumando ese ensayo inicial, cápsulas y API, el expediente contempla 278 creaciones y 20848 llamadas Vercel; el navegador opcional añade otras 4 creaciones y 352 llamadas.

## Preparación local

Para preparar un expediente después de publicar la imagen, usa `prepare` con un borrador sin aprobar, el recibo `publication-verified.json` y una carpeta nueva. El comando deriva `equipo/proyecto/repositorio@sha256:…` de la referencia verificada en VCR. Contrasta la ruta con la etiqueta publicada, el proyecto, el repositorio y los digests esperado y observado. Si el borrador ya fija equipo, proyecto o imagen, exige que correspondan al mismo destino. La salida incluye `campaign.draft.json` con un UUID nuevo y el candidato local, y `sandbox.env` con el mismo valor en `SANDBOX_IMAGE` y las variables públicas de destino. El token se configura por el canal de credenciales del operador.

```powershell
. ./scripts/use-node.ps1
$expediente = '.local/preproduction/imp-03-07'
node scripts/sandbox-campaign.mjs prepare "$expediente/capability.draft.json" "$expediente/publication-verified.json" "$expediente/capability-canonical"
node --env-file="$expediente/capability-canonical/sandbox.env" scripts/sandbox-campaign.mjs plan "$expediente/capability-canonical/campaign.draft.json"
```

`prepare` trabaja localmente y genera el manifiesto con `authorized: false`. La aprobación de ejecución corresponde al expediente nuevo. Cada recuperación usa el manifiesto exacto que originó su journal. Para preparar el despliegue de ACA, `targets.sandbox.image` del manifiesto de despliegue debe coincidir con `image` del expediente que se va a desplegar.

Desde la raíz y con Node 24.21.0 activo:

```powershell
node scripts/sandbox-campaign.mjs plan infra/preproduction/sandbox-campaign.example.json
node scripts/sandbox-campaign.mjs preflight infra/preproduction/sandbox-campaign.example.json
```

`plan` no carga credenciales ni SDK para efectuar llamadas. Muestra casos, creaciones, llamadas máximas, reserva de limpieza, duración máxima y costo estimado. `preflight` tampoco hace red: contrasta autorización referenciada, ventana de hasta 7 días, destinos exactos, versión construida y candidato local por SHA/hash de fuentes. Sale 2 si falta algo. El ejemplo deja fechas/destinos/tarifas/candidato vacíos, costo 0 y `authorized:false`; por eso nunca habilita `run`.

El inventario de cápsula usa los 58 programas canónicos de `tests/runner/fixtures.mjs`, seis probes de SO fijos y cuatro ensayos de ciclo de vida. Son 68 casos y 69 creaciones desechables: la concurrencia requiere dos entornos distintos. Los límites propuestos son 2508 llamadas al proveedor y 2770 s de duración secuencial máxima. La reserva es 8 llamadas de limpieza por cada creación autorizada, además de las llamadas normales. Una discrepancia de resultados o limpieza no verificada detiene la campaña.

Los probes de SO observan UID/capabilities, permisos/entorno/archivos de solo lectura, OOM propio y de descendientes, pids y egreso DNS/IPv6/UDP. Son programas confiables incorporados en la cápsula. No se agregan capacidades al código estudiantil ni se admiten rutas de ejecución desde HTTP. La paridad usa las mismas aserciones canónicas que Docker; requiere ejecutar y conservar cada resultado Vercel, no copiar la evidencia local.

Los cuatro ensayos de ciclo de vida deben distinguir cancelación, dos ejecuciones concurrentes, pérdida deliberada de una respuesta de creación real y vencimiento natural de una VM dedicada. El último deja vencer el TTL de 60 s antes de observar y limpiar; su ventana exclusiva de 90 s no cambia el límite operativo de 30 s + 10 s de la API ni el presupuesto estudiantil de 3000 ms. No se acepta esperar 60 s como prueba de vencimiento sin observar el estado del proveedor.

## Manifiesto y costos

Preparar un manifiesto privado con UUID nuevo para cada campaña. Completar `teamId`, `projectId`, región, imagen por digest, versión runner, candidato por commit/sourceDigest y etapas exactas. El candidato se calcula con el mismo inventario de fuentes de `scripts/quality-coverage.mjs`. No introducir tokens en JSON. `approval` identifica `approvedBy`, `reference` y `approvedAt`; estos campos deben referenciar una autorización efectiva del responsable, no una aprobación inventada por la herramienta. `authorized:true` sin esos campos no habilita la operación.

Las tarifas son **entradas explícitas**: moneda, región, CPU por vCPU/h, memoria por GB/h, cargo por creación, quantum de facturación de memoria, URL fuente y fecha consultada. La herramienta no presume que las tarifas históricas siguen vigentes. Modela 1 vCPU/2 GB y 60 s por creación, redondeando memoria al quantum indicado, y exige `maxCost` suficiente. El cálculo excluye ACA/API, ACR, logs, BD, suscripciones, impuestos y otros recursos. No es un corte automático de facturación. Antes de autorizar, sumar reservas de todas las campañas y otros servicios del expediente; no tratar el tope general del proyecto como permiso de gasto.

Separar una campaña de cápsulas de otra de API/recuperación/rendimiento, con UUID distintos. Las primeras reservan creaciones y llamadas en un journal local; la API aplica su cuota durable en BD. No existe un contador único entre ambos y se rechaza mezclarlos en un manifiesto. `maxRequests` cuenta llamadas Vercel; las peticiones HTTP de cliente a ACA aparecen como `clientRequests` en un inventario separado.

Las etapas `api`, `recovery` y `performance` pasan por `scripts/sandbox-api-campaign.mjs`, que valida su `config` y fixtures antes de actuar. Una etapa seleccionada sin arnés implementado bloquea toda la ejecución antes de gastar. Reiniciar ACA exige una operación aprobada y destino exactos; no se deduce permiso de recuperación desde una autorización de cápsulas.

El helper `scripts/sandbox-aca-control.mjs` contrasta revisión/ambiente/candidato y observa la única réplica API lista antes de una interrupción. Tras el comando fijo verifica, durante hasta 60 s, una réplica nueva o un incremento de `restartCount` del contenedor de esa misma revisión, nuevamente listo. Un diagnóstico `UNKNOWN` no prueba por sí solo reinicio. El contador retornado identifica invocaciones CLI, no todas las peticiones internas que la CLI efectúa. La forma de esos campos procede del [contrato REST de réplicas ACA](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/container-apps-revision-replicas/list-replicas?view=rest-resource-manager-containerapps-2025-07-01).

`sandbox-api-campaign.example.json` prepara esas tres etapas con 208 creaciones, 18304 llamadas Vercel y 12000 s como máximos. Las configuraciones de destino están incompletas, `allowedOperations` vacío y `authorized:false`; no autoriza interrumpir ACA. Las dos campañas completas suman 277 creaciones y 20812 llamadas Vercel, además de las peticiones HTTP a ACA y observaciones de BD inventariadas por el arnés. El operador puede seleccionar un alcance menor antes de autorizar, conservando las cuotas derivadas de sus casos.

El cliente de las etapas API utiliza `ALUNZA_SANDBOX_API_FIXTURES_FILE`, `ALUNZA_SANDBOX_API_DATABASE_URL` de rol limitado y `ALUNZA_SANDBOX_API_DATABASE_CA_FILE` para observar el ciclo durable con TLS. El archivo privado contiene únicamente cuentas/datos ficticios del destino, incluidos sus tokens efímeros; no se publica. El cliente API no necesita recibir `VERCEL_TOKEN`: ese secreto permanece en ACA. El preflight verifica localmente estructura/destino/configuración privada antes de cualquier llamada, sin atribuir permisos o conectividad no probados.

La etapa API exige que el primer actor tenga una actividad con un único ejercicio requerido, progreso inicial `NO_ATTEMPTS` de 0/1 e historial vacío. Verifica que RUN y SUBMIT fallido no completen el ejercicio, que el primer SUBMIT correcto cambie a 1/1 y que replay/reintento no aumenten ese conteo. No reutilizar para ella la fixture ya consumida por otra campaña. El navegador requiere su propia fixture inicial vacía. Las respuestas, ejecuciones y sesiones distintas se contrastan con el ledger y los límites de llamadas; los logs remotos y el proveedor IA real requieren evidencia adicional de sus expedientes.

La etapa `browser-vertical` se incluye deshabilitada y usa `kind:api` con `fixtures:["browser-vertical"]`. Al seleccionarla, completar los orígenes web/API y `ALUNZA_SANDBOX_BROWSER_FIXTURES_FILE`, además de la observación de BD limitada. Añadir 4 creaciones, 352 llamadas Vercel (320 normales + 32 de limpieza), 240 peticiones cliente y 600 s al presupuesto de esa campaña. El preflight recalcula el inventario y rechaza cuotas insuficientes; activar el booleano no amplía automáticamente la autorización. El arnés de navegador no usa capturas/video que puedan conservar código o tokens.

## Configuración ACA y activación posterior

La API usa `PRACTICE_RUNNER_PROVIDER=vercel` y `PRACTICE_RUNNER_ENABLED` para admisión. `SANDBOX_TEAM_ID`, `SANDBOX_PROJECT_ID`, `SANDBOX_REGION` y `SANDBOX_IMAGE` deben coincidir con el manifiesto. El acceso desde ACA usa `VERCEL_TOKEN` server-side mediante `secretRef`; la identidad administrada de Azure no es una credencial Vercel. No copiar ese token al frontend, logs, capas de imagen ni al Sandbox.

`main.bicep` recibe el JSON privado como parámetro seguro `sandboxCampaign`, lo monta como Secret en `/var/run/alunza-sandbox/campaign.json` y define `SANDBOX_CAMPAIGN_FILE`. El contenido no es un token, pero contiene aprobación, destinos y candidato privados. La API conserva `DATABASE_URL`/CA mediante sus propios secretRefs. El Job antiguo mantiene `VERCEL_TEAM_ID`/`VERCEL_PROJECT_ID`/`RUNNER_SANDBOX_*` y autorización independientes.

La plantilla mantiene una réplica cuando hay admisión, recuperación explícita (`sandboxRecoveryEnabled`) o configuración Vercel para recuperar. Usa 60 s de gracia de terminación y máximo 1 réplica. Esto introduce consumo de ACA que debe presupuestarse aparte. Live/ready conservan sus controles HTTP y no crean Sandbox: un health check nunca es permiso para un probe pagado.

La proyección `secretRef`/`path` del volumen y la gracia pertenecen al [contrato ARM de Container Apps 2025-07-01](https://learn.microsoft.com/en-us/azure/templates/microsoft.app/2025-07-01/containerapps?pivots=deployment-language-bicep). La preparación local no demuestra que la revisión se haya desplegado ni que los permisos de cuenta estén vigentes.

Después de preparar y revisar candidato/imagen/configuración/migración, activar únicamente en preproducción con autorización vigente. `run` no despliega ni crea infraestructura por sí solo:

```powershell
# Solo cuando el manifiesto privado corresponde a la autorización vigente.
node scripts/sandbox-campaign.mjs run .local/preproduction/sandbox-campaign.json
```

El journal privado se crea con exclusividad antes de la primera operación y sincroniza cada reserva antes del dispatch. Un journal existente deniega otro arranque: después de caída o respuesta incierta, reconciliar los nombres exactos y sus snapshots; no borrar el archivo para repetir una campaña. El reporte conserva candidato, resultados seguros, duraciones y consumo disponible, nunca código, pruebas ocultas, cuerpos de respuesta ni tokens. Costos facturados quedan N/D hasta evidencia del proveedor.

Si el supervisor v9 informa `START` con código 75, revisar `driverStartFailure`
en el caso y el journal. `httpStatus` registra las cabeceras recibidas y
`outcome` indica cómo terminó el intercambio. `containerState`, `hasStarted`
y `oomKilled` corresponden a una observación acotada previa a la limpieza.
`runtimeCause` conserva una categoría reconocida por el supervisor. Un valor
`null` o un estado `unknown` deja esa observación indeterminada. La lectura
del archivo consume como máximo una llamada de operación. Conservar la
evidencia de archivo y VM por separado y mantener `UNKNOWN` si faltó el
acuse de arranque. La evidencia de cierre sigue vinculada al ID de la sesión.

Para continuar únicamente la limpieza de una campaña de cápsulas interrumpida:

```powershell
node scripts/sandbox-campaign.mjs recover .local/preproduction/sandbox-campaign.json
```

`recover` no ejecuta fixtures ni crea VM. Exige el mismo manifiesto autorizado que quedó ligado al journal por hash, los destinos exactos y la credencial actual de ese destino. Puede operar después de la expiración para limpiar; no exige que el checkout actual sea el candidato original, ni concede nueva admisión. Cada correlación se guarda antes del POST y cada ID confirmado antes de continuar con el recurso. La recuperación reutiliza esos nombres/owner/campaignId/IDs exactos mediante `recoverVercelSandbox`; no enumera recursos ajenos. Una creación incierta seguida de 404 permanece pendiente, pues no acredita ausencia definitiva.

Se conserva el journal y se abre sólo para añadir reservas, receipts y resultados. Cada llamada de recuperación consume, con `fsync` previo, la cuota agregada aún disponible; no se repone al reiniciar el comando. Cada intento de limpieza tiene además un máximo de 8 llamadas y 10 s. Un lock IPC local exclusivo cubre ejecución y recuperación: named pipe en Windows o socket abstracto en Linux, sin listener TCP; el kernel libera el lock si muere el proceso. No copiar ni compartir el journal entre equipos durante la campaña. La cuota agotada, una identidad no confirmada, un journal incompleto o un formato anterior sin contexto inmutable requieren revisión; no borrar registros ni ampliar el manifiesto para eludir el bloqueo. La salida es 2 si quedan pendientes o falta contexto verificable. La recuperación autónoma de la API conserva su propio ledger en BD.

Para rollback, deshabilitar admisiones manteniendo proveedor/credencial/campaña y una réplica hasta terminar recuperación. Verificar ausencia de VMs y snapshots antes de revocar el token o retirar configuración. Restaurar digest/configuración compatibles y verificar salud; no hacer reset de BD. La expiración deniega nuevo trabajo, pero no sustituye observación y limpieza. El cierre de IMP-06.04/rendimiento y la aceptación remota/humana conservan sus bloqueos hasta evidencia real correspondiente.

Para activar o deshabilitar configuración conservando el mismo digest/SHA, elegir un `rolloutId` nuevo de hasta 8 caracteres alfanuméricos en minúscula. El renderer lo valida; Bicep lo incorpora al sufijo de revisión. Esto permite una revisión de configuración nueva sin reconstruir el artefacto. El valor vacío conserva el sufijo histórico `r-<12sha>`.
