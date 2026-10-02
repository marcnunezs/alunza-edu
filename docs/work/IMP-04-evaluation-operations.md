# IMP-04.08 — Operación del arnés de evaluación

Estado al 02/10/2026: **arnés completo implementado y probado en TEST**. Estos comandos
describen el flujo disponible; no constituyen evidencia de una corrida ni
autorización para gastar en Azure. Resultados y fallos se registran en
[IMP-04-evaluation](IMP-04-evaluation.md). El
[diccionario](IMP-04-evaluation-dictionary.md) explica permisos, ledger y estados.

## Destinos y precondiciones

| Destino  | Proyecto                      | API/web   | Supabase | Listener operacional            |
| -------- | ----------------------------- | --------- | -------- | ------------------------------- |
| DEV      | `alunza-edu-laboratorio`      | 4200/3200 | 174xx    | Deshabilitado                   |
| TEST     | `alunza-edu-laboratorio-test` | 4300/3300 | 184xx    | 4401 solo en el arnés exclusivo |
| LAB-EVAL | `alunza-edu-laboratorio-eval` | 4400/3400 | 194xx    | 4401, únicamente loopback       |

TEST y LAB-EVAL comparten el puerto operacional del perfil y no se ejecutan al
mismo tiempo. LAB-EVAL conserva datos en `.local/lab-evaluation-workspace`; su
preparación no resetea DEV ni TEST. No reutilizar una base cuyo perfil de
embeddings pertenezca a otro modelo/dimensión. El cambio de perfil requiere
otra instancia EVAL aislada y una nueva autorización; no se migra el índice en
caliente ni se reinicializa este destino para cambiar una corrida aprobada.

Activar el runtime portable en la PowerShell que ejecutará los comandos:

```powershell
. ./scripts/use-node.ps1
node --version
npm --version
npm run build
npm run help:eval -- --mode plan
```

El ejemplo [help-evaluation.example.json](../../infra/preproduction/help-evaluation.example.json)
es incompleto a propósito. `plan` es offline; identifica configuración faltante
y no crea servicios, trabajos ni llamadas. `npm run help:plan` conserva el plan
histórico de IMP-04.04–04.06; el flujo ejecutable nuevo usa `help:eval`.

Antes de ejecutar hay que concretar candidato, perfiles/modelos/deployments,
tokenizer, región/destino Azure, precios versionados, límites por etapa/global,
autor/referencia de aprobación y expiración reales. No llenar una aprobación con
datos inventados. El ejemplo no incluye secretos y el perfil TEST no autoriza Azure.

Las huellas por fase se calculan con la misma función que usa el consumidor:
destino, deployment, autenticación, modelo/configuración, dimensión o tokenizer,
y versiones de consulta/prompt/schema según corresponda. `plan/check` rechaza
una huella que no corresponda al descriptor Azure declarado; no la sustituye
silenciosamente. Los precios quedan ligados a la autorización y no forman parte
de la identidad del proveedor.

## Ambiente, consumidor y preparación de datos

La infraestructura se prepara antes de iniciar consumidores. En una terminal:

```powershell
npm run eval:environment -- prepare
npm run eval:serve -- --provider-env .local/eval-provider.json
```

`eval:environment prepare` provisiona el destino local aislado, aplica migraciones
y seed sin reset. `eval:serve` inicia la API y listener desde la configuración
privada de ese destino. `--web` agrega la interfaz en 3400. El archivo opcional
`--provider-env` contiene solo variables `AI_*` del servidor; debe corresponder
a los perfiles aprobados y nunca se publica ni se copia a `NEXT_PUBLIC`. Al
comenzar todavía puede faltar la calibración: ingestión/calibración son etapas
previas a generar ayuda sustentada. Ctrl+C detiene los consumidores propios y
conserva la base/recibos.

En otra terminal, usando el mismo runtime y el manifiesto completo privado:

```powershell
$evaluationRunId = [guid]::NewGuid().ToString()
$evaluationDirectory = ".local/eval-runs/$evaluationRunId"
$evaluationPlan = '.local/help-evaluation.approved.json'
npm run help:eval -- --mode prepare --manifest $evaluationPlan --run-id $evaluationRunId --directory $evaluationDirectory
npm run help:eval -- --mode check --manifest $evaluationPlan --directory $evaluationDirectory
```

`prepare` requiere la API ya iniciada. Crea ejercicios, actividades e intentos
ficticios mediante APIs y actores autorizados; no inserta resultados técnicos
sintéticos ni llama a IA. Mantener el mismo `--run-id` y directorio al recuperar
una preparación interrumpida. El journal guarda claves antes de cada petición.
`check` contrasta plan, datos preparados y fingerprint del candidato sin llamar
proveedores. Cambiar código, corpus, configuración o presupuesto exige revisar
el candidato/autorización; no se conserva una aceptación de otra versión.

## Autorización y cuatro etapas

```powershell
npm run help:eval -- --mode authorize --manifest $evaluationPlan --directory $evaluationDirectory
npm run help:eval -- --mode run --stage INGESTION --manifest $evaluationPlan --directory $evaluationDirectory
npm run help:eval -- --mode run --stage CALIBRATION --manifest $evaluationPlan --directory $evaluationDirectory
```

`authorize` utiliza la conexión de mantenimiento únicamente para registrar el
manifiesto inmutable y el hash de una credencial específica del run. No despacha
IA. `run/resume` usa sesiones de producto y esa credencial; no necesita la clave
de mantenimiento. Las llamadas pagadas solo se permiten con el run y etapa
vigentes, binding/permiso válido y reserva de presupuesto confirmada.

La credencial operacional vence con la autorización: después de `expiresAt`
también se rechazan las consultas de estado, recibos y parada. Capturar los
recibos antes de vencer conserva la evidencia en el reporte local, que sigue
disponible para lectura sin conectarse al listener. Esa lectura no renueva
presupuesto ni autorización. Los consumidores mantienen el registro de recibos
tardíos y bloquean nuevos despachos aunque la credencial ya haya vencido.

La ingestión publica archivos/versiones autorizados completos. La calibración
registra embeddings de consultas, distancias reales y recibos, valida las
particiones reservadas y produce `calibration.json`. Antes de FUNCTIONAL se
reinicia el consumidor con ese artefacto verificado de origen Azure. En la
terminal del consumidor, Ctrl+C y luego:

```powershell
npm run eval:serve -- --provider-env .local/eval-provider.json --calibration .local/eval-runs/UUID-DE-LA-CORRIDA/calibration.json
```

Sustituir `UUID-DE-LA-CORRIDA` por el run preparado. No usar un artefacto TEST en
LAB-EVAL. Si se solicitan todas las etapas de una vez sin reiniciar el consumidor,
el arnés se detiene con `CALIBRATION_CONSUMER_RESTART_REQUIRED` después de guardar
la etapa; ese punto se recupera con el mismo journal.

```powershell
npm run help:eval -- --mode resume --stage FUNCTIONAL --manifest $evaluationPlan --directory $evaluationDirectory
npm run help:eval -- --mode resume --stage EVALUATION --manifest $evaluationPlan --directory $evaluationDirectory
```

FUNCTIONAL comprueba explicación, pistas 1–3, replay de solicitud/ACK, citas y
descargas originales/ajenas. EVALUATION ejecuta el corpus adversario y los
perfiles fijados de 100 ayudas en serie y 100 con concurrencia cuatro. No ocupa
dos carriles del mismo estudiante ni eleva cuotas. Una pista fallback conserva
su muestra y detiene la progresión de ese intento: no se finge acceso al nivel
siguiente. Los casos de revisión de candidatos se identifican por separado de
la ayuda entregada al estudiante.

## Recuperación, seguimiento y cierre

```powershell
npm run help:eval -- --mode status --manifest $evaluationPlan --directory $evaluationDirectory
npm run help:eval -- --mode resume --manifest $evaluationPlan --directory $evaluationDirectory
npm run help:eval -- --mode stop --manifest $evaluationPlan --directory $evaluationDirectory
npm run help:eval -- --mode report --manifest $evaluationPlan --directory $evaluationDirectory
```

`resume` reconcilia el servidor antes de continuar el journal; no crea otra clave
para repetir una respuesta incierta. Un despacho sin resultado no es autorización
para otra llamada. `stop` bloquea nuevos despachos/publicaciones; las respuestas
ya enviadas pueden registrar consumo tardío. No borrar recibos para recuperar
presupuesto ni reiniciar automáticamente una corrida detenida.

El journal usa un bloqueo de proceso y un guardia exclusivo `.lock.recovery`
para recuperar un propietario terminado. Si el recuperador se interrumpe dejando
ese guardia, el siguiente arranque falla cerrado: no lo elimina automáticamente.
Antes de retirarlo manualmente, un operador debe inspeccionar los PID y los
procesos propietarios de esa corrida, confirmar que ninguno sigue activo y
conservar una copia del guardia para diagnóstico. Retirar únicamente el guardia
de la corrida verificada; no borrar el journal, sus claves ni otros bloqueos.
Las renovaciones de sesión comparten una sola petición por actor y serializan
las escrituras del vault; un token renovado no se entrega antes de guardarlo.
La sustitución atómica de JSON reintenta únicamente bloqueos transitorios
`EPERM/EACCES/EBUSY`: hasta seis intentos sobre el mismo temporal y destino,
con esperas de 25/50/100/200/400 ms. No borra el destino ni repite acciones de
producto. Si agota el límite, conserva el archivo anterior y el temporal para
diagnóstico; debe resolverse el bloqueo antes de reanudar.

El directorio contiene sesiones y credencial privadas, journals, manifiesto
autorizado, calibración, reporte y paquete de revisión. No adjuntar el directorio
completo como artefacto público. El reporte seguro conserva IDs/hash/perfiles,
tiempos, fallbacks y recibos permitidos; omite código, materiales, candidatos,
prompts y secretos. Uso/costo desconocido se mantiene nulo. El paquete docente
mantiene campos sin completar hasta que una persona real registre su revisión;
regenerar un reporte no acredita ni reemplaza esa aceptación.

`report.json` contiene la proyección más reciente y `reports/<timestamp>-<uuid>.json`
conserva cada reporte anterior con `recordedAt`. `--mode report` intenta consultar
los recibos del listener y genera otra proyección; no es una lectura offline.
Si la credencial venció o el listener no responde, señala
`receiptEvidence=UNAVAILABLE` y deja consumo/costo en `null`. La evidencia previa
sigue en `reports/` y puede leerse directamente sin credenciales ni conexión.
El candidato, proveedor, perfiles y corpus del reporte corresponden al
manifiesto autorizado de esa corrida, aunque el plan editable ya haya cambiado.

La observación de transporte conserva el primer despacho y los intentos de
admisión. Si se pierde una respuesta y se reanuda sin una observación completa,
`clientMs` es `null`; la pausa del operador no se incluye en el percentil. Una
repetición de ACK conserva la medición completa que ya existía. Cada perfil
indica `clientObservedCount` y `clientMissingCount`; los percentiles del cliente
usan sólo observaciones finitas, sin interpretar un dato faltante como cero.

Los reportes de integración conservan cada arranque, su fase, duración y fallo
seguro, además de observaciones de memoria y contadores acumulados de CPU del
host. En Windows la carga media no está disponible y figura como `null`.
Las mediciones SUBMIT conservan los mismos datos por perfil y todas sus muestras;
la instrumentación no cambia el timeout ni el umbral de aceptación.

Detener consumidores con Ctrl+C; cuando ya no se necesiten servicios locales:

```powershell
npm run eval:environment -- stop
```

## Verificación local separada

`npm run test:help:evaluation` es la entrada de la corrida controlada TEST del
arnés; `npm run test:help:integration` verifica HTTP/SQL/recuperación de ayuda y
`npm run test:e2e` la regresión de producto. Requieren propiedad exclusiva de
TEST y se coordinan con los demás trabajos. Los resultados deben registrarse
solo después de ejecutarlos. Ni estas pruebas ni `plan/check/prepare` acreditan
Azure, p95 remoto, calidad semántica, aceptación docente/CAPSTONE o producción.
