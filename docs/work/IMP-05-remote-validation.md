# IMP-05 · Preparación paralela de validación remota

Fecha: 02/10/2026. Estado: **preparación local verificable; ejecución real pendiente**.

Este carril acompaña IMP-05.01–05.02 sin bloquear progreso ni introducir IA en
sus cálculos. Conserva Azure OpenAI y Vercel Sandbox como proveedores definidos.
La preparación y los ejemplos no conceden permisos, no crean recursos y no
acreditan integración remota, seguridad productiva o aceptación CAPSTONE.

## Estado observado y límite de este corte

- El arnés `help:eval` está implementado y probado en TEST. Su ejecución Azure,
  calibración medida, rendimiento y revisión docente siguen pendientes según
  [IMP-04-evaluation](IMP-04-evaluation.md) y su
  [procedimiento vigente](IMP-04-evaluation-operations.md).
- `help:plan` conserva el plan histórico de ayuda. La validación actual utiliza
  `help:eval` con ingestión, calibración, recorrido funcional y evaluación.
- `runner:probe -- --adapter vercel` admite un Sandbox y el primer fixture.
  Los fixtures adversarios de SO y recuperación adicionales del mismo arnés se
  ejecutan únicamente con Docker; este probe remoto no cierra IMP-03.07.
- La API utiliza adaptadores Docker para RUN/SUBMIT y rechaza el ejecutor habilitado
  fuera de ambiente local. La integración productiva de Sandbox y los workers
  de materiales/ayuda en Azure Container Apps conservan trabajo posterior.
- La inspección de existencia no encontró `.local/preproduction/manifest.json`,
  `.local/help-evaluation.approved.json` ni `.local/eval-provider.json`. No se
  inspeccionaron valores de credenciales. Esto no demuestra que no existan recursos
  externos o otra configuración privada; sí impide acreditar un destino y
  presupuesto concretos con esos archivos esperados.

Se preparan dos ejemplos separados, compatibles con los validadores existentes:

| Ejemplo                                                                      | Precondiciones pendientes                                                                      | Operaciones habilitadas                             |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| [Azure](../../infra/preproduction/imp-05-ai-preparation.example.json)        | Candidato, autorización, precios, bolsas de presupuesto, perfiles y descriptor Azure           | Ninguna; campos pendientes `null`                   |
| [Sandbox](../../infra/preproduction/imp-05-sandbox-preparation.example.json) | SHA, team/project, región, imagen por digest, aprobador/referencia/vigencia y costo autorizado | Ninguna; `enabled=false`, lista vacía y `maxCost=0` |

Los límites técnicos del ejemplo Sandbox conservan los del ensayo existente:
un Sandbox, hasta 60 solicitudes y 1.800 s. No constituyen presupuesto aprobado;
`maxCost=0` impide despacho y `maxAiRequests=0` evita mezclar IA en este ejemplo.
No completar datos de autorización, precios o recursos con valores de fixtures.

## Preparación local y comandos sin proveedor

Usar Node 24.21.0/npm 11.19.0 y el lockfile vigente. Con dependencias y paquetes
compilados, desde la raíz Git:

```powershell
. ./scripts/use-node.ps1
npm run help:eval -- --mode plan --manifest infra/preproduction/imp-05-ai-preparation.example.json
npm run preprod:check -- infra/preproduction/imp-05-sandbox-preparation.example.json
```

`help:eval plan` es offline y declara los campos pendientes. `preprod:check` no
despacha proveedores: con este ejemplo el resultado previsto es salida **2** por
configuración/autorización pendiente, distinto de un ensayo fallido. Los informes
saneados de preproducción se guardan bajo `.local/reports/imp-00-06-08/`.

Para preparar una evaluación sin consumir IA, usar el ambiente local LAB-EVAL
según el [manual](IMP-04-evaluation-operations.md): `eval:environment prepare`,
`eval:serve`, `help:eval prepare` y `help:eval check`. La preparación crea datos
ficticios mediante APIs locales y ejecuta SUBMIT con Docker; no sustituye el
resultado técnico con un fixture. TEST y LAB-EVAL comparten listener operacional
4401 y deben ejecutar sus arneses por turnos.

Preparar la imagen Sandbox con `npm run runner:prepare -- --sandbox-context` y
construir desde `.local/runner-sandbox-build`. La imagen incluye la cápsula vigente
exportada; la publicación en un registro y la creación de Sandbox tienen gates
externos separados. Fijar el digest realmente publicado antes del probe, nunca
reutilizar como prueba remota el informe histórico de una imagen local.

Congelar un candidato por corrida. Las modificaciones de IMP-05 u otro carril
cambian su fingerprint: comprobar nuevamente candidato, corpus y configuración
antes de registrar autorización. Mantener la misma corrida/directorio/journal
para recuperar una operación; no crear claves nuevas ante respuestas inciertas.

## Gate y secuencia de Azure real

El ejemplo Azure debe convertirse en un manifiesto privado completo de LAB-EVAL
con proveedor `AZURE`. Requiere endpoint, autenticación, deployment y modelo
de cada fase EMBEDDING/GENERATION/REVIEW, dimensión de embeddings, tokenizer,
identidad de configuración, fingerprints, precios versionados, cuatro bolsas y
techo global de llamadas/tokens/costo. Un modelo TEST o una calibración TEST no
autoriza ni acredita Azure. Las variables `AI_*` permanecen solo en servidor.

La autorización efectiva debe cubrir destino, candidato, corpus, recursos,
operaciones, límites, aprobador/referencia y expiración reales. El manifiesto
durable restringe los bindings y etapas; se reserva presupuesto antes de cada
despacho. El [spec de operación](../../specs/11-operacion-y-despliegue.md) exige
autorización del Product Owner para servicios pagados. La solicitud condicionada
de avanzar no permite inventar esos datos ni usar el tope histórico como gasto
disponible. En este corte faltan los manifiestos concretos: no se ejecuta IA real.

Después de satisfacer ese gate, los comandos ejecutables son los siguientes;
los parámetros apuntan a archivos privados completos, no a los ejemplos. Preparar
la infraestructura local e iniciar el consumidor en una terminal:

```powershell
npm run eval:environment -- prepare
npm run eval:serve -- --provider-env .local/eval-provider.json
```

En otra terminal, con el mismo runtime, preparar y autorizar la corrida:

```powershell
$evaluationPlan = '.local/help-evaluation.approved.json'
$evaluationRunId = [guid]::NewGuid().ToString()
$evaluationDirectory = ".local/eval-runs/$evaluationRunId"
npm run help:eval -- --mode prepare --manifest $evaluationPlan --run-id $evaluationRunId --directory $evaluationDirectory
npm run help:eval -- --mode check --manifest $evaluationPlan --directory $evaluationDirectory
npm run help:eval -- --mode authorize --manifest $evaluationPlan --directory $evaluationDirectory
npm run help:eval -- --mode run --stage INGESTION --manifest $evaluationPlan --directory $evaluationDirectory
npm run help:eval -- --mode run --stage CALIBRATION --manifest $evaluationPlan --directory $evaluationDirectory
```

`authorize` registra el manifiesto y credencial operacional sin despachar IA.
Tras CALIBRATION, detener únicamente el consumidor propio y reiniciarlo con la
calibración Azure verificada de esa corrida antes de continuar. En la terminal
del consumidor, usar el UUID ya generado por el arnés; las variables PowerShell
no se comparten entre terminales:

```powershell
npm run eval:serve -- --provider-env .local/eval-provider.json --calibration .local/eval-runs/UUID-DE-LA-CORRIDA/calibration.json
```

En la terminal original del arnés, que conserva sus variables y el mismo
directorio, continuar:

```powershell
npm run help:eval -- --mode resume --stage FUNCTIONAL --manifest $evaluationPlan --directory $evaluationDirectory
npm run help:eval -- --mode resume --stage EVALUATION --manifest $evaluationPlan --directory $evaluationDirectory
npm run help:eval -- --mode report --manifest $evaluationPlan --directory $evaluationDirectory
```

El consumidor se mantiene en una terminal y el arnés se ejecuta en otra. Las
etapas comprueban explicación, pistas 1–3, ACK/replay, citas y rechazos, corpus
adversario y 100 ayudas seriales más 100 con concurrencia cuatro. Conservar todas
las muestras y fallbacks, plazo de 15 s, cuotas vigentes y p95 documental <12 s.
Registrar admisión→persistencia, tiempo cliente y espera por cuota por separado.
El reporte puede consultar recibos; debe capturarse antes de vencer la credencial.
Consumo/costo no observado sigue `null`, y la revisión docente permanece pendiente
hasta una participación real.

## Gate y secuencia de Sandbox real

El manifiesto privado debe pasar `loadManifest` y
`assertRemoteAuthorization(manifest, 'probe:sandbox')`: autorización habilitada,
operación permitida, referencia/aprobador, ventana vigente de hasta siete días,
`maxCost>0`, SHA y destino Sandbox completos. El probe exige exactamente un
Sandbox, al menos diez slots HTTP, `VERCEL_TOKEN` privado y coincidencia exacta
entre `RUNNER_SANDBOX_IMAGE` y la imagen por digest del manifiesto. No imprimir
credenciales, argumentos ocultos ni payloads del proveedor.

Solo después de ese gate y de publicar la imagen dentro de autorización vigente:

```powershell
npm run runner:probe -- --adapter vercel --manifest .local/preproduction/manifest.json
```

El adaptador comprueba recursos efectivos 1 vCPU/2 GB, `deny-all`, runtime y
Docker anidado con cgroup v2/controladores de memoria/swap/pids. Si faltan, falla
cerrado y registra el impedimento DEC-003; no sustituye arquitectura ni amplía
límites. Conserva las dos capas: Sandbox y proceso 128 MiB/3 s/64 KiB. Observar
stop/delete efectivo y remanentes; el TTL no prueba limpieza.

Si el probe se ejecuta desde el Job manual ACA, también deben pasar `azure:job`
y `probe:sandbox`; desplegar recursos exige aparte `azure:deploy` y artefactos
por digest. No se necesita desplegar toda la plataforma para la evaluación Azure
desde LAB-EVAL. `maxCost` del probe es un límite acordado, no un corte automático
de facturación: registrar consumo/cargos y detener nuevas operaciones al techo.

El smoke de capacidad no acepta la vertical productiva. IMP-03.07 debe integrar
RUN/SUBMIT en API, reservas y persistencia, reconciliación/recolector, paridad
completa Docker/Sandbox, límites/adversarios/pruebas ocultas y fallos/cancelación.
Medir desde Chile el recorrido completo; el tiempo estudiantil no acredita p95.

## Fixtures y evidencia de este corte

Los [eventos y orden](../../fixtures/progress/events-and-order.json) y
[progreso temporal](../../fixtures/progress/temporal-progress.json) incluyen
polling/refresco, timestamp cliente, transporte duplicado, lectura explícita de
fallback autenticado, ACK, ámbitos, corte y desempate estable. Los contadores se
comparan con aritmética independiente en
[progress-fixtures.test.cjs](../../tests/progress-fixtures.test.cjs), sin llamar a
la consulta SQL ni a IA. `CLASS_JOINED` es base de clase y no actividad atribuida
a todos los ejercicios; RUN no completa asignaciones. La ordenación usa instante
de envío y secuencia del evento, conservando `attemptNumber` histórico.

[SIG-01–SIG-14](../../fixtures/progress/signals-proposed.json) conserva estado
`PROPOSED`: ventanas, comparabilidad, episodios y revisión no se implementan ni
aceptan por validar fixtures. SIG-13/14 describen los oráculos de identidad y
primer revisor; la prueba de fixtures no simula ni acredita concurrencia de BD.
Estas entradas complementan ALZ-PT-015/018/019/026 para incrementos posteriores.

Verificaciones ejecutadas con el runtime portable Node 24.21.0:

| Comprobación                                                                                                    | Resultado observado                                                                         |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Jest aislado para `tests/progress-fixtures.test.cjs`, con `roots=tests` y VM modules                            | **39/39 aprobadas**; aritmética de fixtures, catálogo propuesto y denegación de manifiestos |
| `node scripts/evaluation-cli.mjs --mode plan --manifest infra/preproduction/imp-05-ai-preparation.example.json` | Salida 0; seis campos pendientes, `remoteCalls=0`, tokens/costo desconocidos                |
| `node scripts/preprod.mjs check infra/preproduction/imp-05-sandbox-preparation.example.json`                    | Salida nativa **2** prevista; configuración/autorización pendientes, sin red                |

También aprobaron ESLint focal del test, Prettier en los siete archivos y
`git diff --check` del ámbito. Se comprobaron diez enlaces locales de este
registro, ninguno roto.

La primera invocación aislada de Jest omitió `roots=tests`: encontró paquetes
duplicados en `.local/lock-resolution` y falló el import de un validador, con
38/39 pruebas aprobadas. La repetición corrigió únicamente el ámbito de búsqueda
de esa invocación; no borró archivos ni alteró aserciones. Esta prueba no acredita
SQL/RLS, API, interfaz, evaluadores de señales, concurrencia o proveedores reales.

En este carril no se han llamado Azure ni Vercel, publicado imágenes, creado
recursos, cambiado configuración remota o gastado presupuesto. Los costos
remotos observados siguen desconocidos.

## Preparación de configuraciones y costos del 04/10/2026

La [propuesta de ensayos y presupuesto](remote-trials-configuration-and-budget.md)
concreta modelos/región/tipos de deployment propuestos, tarifas Azure oficiales,
cuatro bolsas y techo global calculados, variables del consumidor y estimación
del probe Sandbox. Los destinos, cuotas y aprobación efectiva siguen pendientes;
los ejemplos originales conservan su denegación. La preparación no acredita
ningún ensayo real ni altera el trabajo pendiente de IMP-03.07/IMP-04.08.
