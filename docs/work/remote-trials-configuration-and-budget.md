# Configuraciones y presupuesto propuestos para ensayos reales

Fecha: **04/10/2026**. Preparado por Codex a solicitud del usuario. Estado:
**configuración local y estimación; destinos, cuotas y aprobación pendientes**.
No se han invocado modelos, creado recursos, publicado imágenes ni ejecutado
ensayos remotos durante esta preparación.

El alcance cubre LAB-EVAL de Azure OpenAI y el probe inicial de Vercel Sandbox
por separado. Afecta la preparación de ALZ-RF/HU/CU/PT-006/009/012/013,
RNF-REN-02/03/04 y RNF-IA-01/02/03/04; no acredita su aceptación ni modifica
sus contratos. Conserva DEC-003/008/010 pendientes de evidencia remota.

## Archivos preparados

| Archivo                                                                                           | Función                                                                                                                                               |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Propuesta pública](../../infra/preproduction/remote-trials.proposed.json)                        | Modelos, región, tipo de deployment, tarifas, dimensiones, recursos y reservas propuestas. Es un sidecar; no se pasa a `help:eval` ni `runner:probe`. |
| [Plan Azure con bolsas calculadas](../../infra/preproduction/help-evaluation.costed.example.json) | Compatible con el esquema actual de `help:eval`; aprobación, candidato y perfiles efectivos permanecen `null`.                                        |
| [Variables del consumidor](../../infra/preproduction/eval-provider.proposed.example.json)         | Plantilla sin secretos para `.local/eval-provider.json`; endpoint pendiente e identidad Azure CLI propuesta.                                          |
| [Plan Sandbox acotado](../../infra/preproduction/sandbox-probe.costed.example.json)               | Propone `iad1` y únicamente `probe:sandbox`; sigue deshabilitado, con `maxCost=0` y aprobación/destino/digest pendientes.                             |
| [Precios Azure](../../infra/preproduction/azure-retail-prices-2026-10-04.json)                    | Tres medidores oficiales, filtro reproducible, USD/unidad, IDs y fecha efectiva.                                                                      |
| [Carga Azure](../../infra/preproduction/azure-trial-workload-2026-10-04.json)                     | Conteos y tokens derivados del corpus y límites vigentes.                                                                                             |
| [Presupuesto Sandbox](remote-sandbox-cost-estimate.md)                                            | Estimación, exclusiones, recursos y campos pendientes del probe.                                                                                      |

La región, el tipo de deployment, las cuotas y la procedencia de precios se
conservan en el sidecar porque el esquema estricto del plan no acepta esos campos.
La referencia de aprobación debe cubrir también este documento y sus evidencias.
Los ejemplos previos se conservan.

## Azure OpenAI: candidato concreto para LAB-EVAL

Se propone un recurso en **`eastus2`**, API **`v1`**, con estos tres deployments:

| Fase       | Nombre propuesto        | Modelo/version de deployment          | Tipo             | Dimensión/tokenizer              | USD por millón de tokens entrada/salida |
| ---------- | ----------------------- | ------------------------------------- | ---------------- | -------------------------------- | --------------------------------------- |
| EMBEDDING  | `alunza-lab-embedding`  | `text-embedding-3-small`, versión `1` | `Standard`       | 1.536 dimensiones; `cl100k_base` | 0,022 / 0                               |
| GENERATION | `alunza-lab-generation` | `gpt-4.1-mini`, versión `2025-04-14`  | `GlobalStandard` | `o200k_base`                     | 0,40 / 1,60                             |
| REVIEW     | `alunza-lab-review`     | `gpt-4.1-mini`, versión `2025-04-14`  | `GlobalStandard` | `o200k_base`                     | 0,40 / 1,60                             |

Los nombres son propuestas, no deployments creados. El consumidor declara
`gpt-4.1-mini-2025-04-14` como modelo exacto. Generación y revisión usan llamadas
y prompts separados aunque compartan modelo; la revisión docente sigue pendiente.
El identificador de configuración de generación/revisión es el mismo porque
así lo representa el consumidor actual; las huellas difieren por fase/deployment.
La versión del tokenizer de ingestión permanece
`js-tiktoken-1.0.21-cl100k_base`, independiente del tokenizer de generación.

Microsoft publica ambos tipos/modelos en `eastus2` y confirma structured outputs
para GPT-4.1 mini y API GA `v1`:
[disponibilidad](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure-region-availability),
[salida estructurada](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs).
La disponibilidad publicada no garantiza capacidad o cuota en una suscripción
concreta. `GlobalStandard` puede procesar fuera de `eastus2`; no acredita
residencia regional. Usar únicamente los datos ficticios del corpus LAB-EVAL.

Los precios se obtuvieron de la API pública oficial
[Azure Retail Prices](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices),
filtrada por `eastus2`, producto `Azure OpenAI` y los tres SKU del archivo de
evidencia. La unidad devuelta es `1K`: se multiplica por 1.000 para obtener el
precio por millón. La página de precios mostró valores dinámicos sin importe;
no se tomaron tarifas de OpenAI ni se supusieron descuentos de caché o Batch.
Embeddings **Standard** tiene tarifa 0,022, distinta de la tarifa global 0,020.

## Cuatro bolsas y techo global de Azure

Una ayuda completa reserva como máximo 500 tokens de embeddings, 8.000 de
entrada y 2.048 de salida para generación, y 8.000/512 para revisión. Cada llamada
redondea hacia arriba a microUSD mediante `evaluationCostMicroUsd`:

`ceil((inputTokens × inputMicroUsdPerMillion + outputTokens × outputMicroUsdPerMillion) / 1.000.000)`.

Esto produce **11 + 6.477 + 4.020 = 10.508 microUSD por ayuda**. Se reservan
límites máximos de entrada/salida, no un promedio de respuestas del modelo.

| Etapa       | Carga cubierta                                                                | Llamadas máximas | Tokens de entrada | Tokens de salida |  Reserva USD |
| ----------- | ----------------------------------------------------------------------------- | ---------------: | ----------------: | ---------------: | -----------: |
| INGESTION   | 45 materiales/chunks; hasta tres intentos de ingestión cada uno               |              135 |             4.032 |                0 |     0,000150 |
| CALIBRATION | Cuatro consultas; 500 tokens reservados por consulta                          |                4 |             2.000 |                0 |     0,000044 |
| FUNCTIONAL  | Una explicación y tres pistas                                                 |               12 |            66.000 |           10.240 |     0,042032 |
| EVALUATION  | 100+100 ayudas de rendimiento, 30 ayudas adversarias y candidatos de revisión |              706 |         3.840.500 |          591.360 |     2,437061 |
| **Global**  | Suma de las cuatro bolsas                                                     |          **857** |     **3.912.532** |      **601.600** | **2,479287** |

Los 45 chunks suman 1.344 tokens por pasada; cinco chunks requieren dos microUSD
y los restantes uno. El redondeo por llamada da 50 microUSD por pasada, 150 con
los tres intentos de ingestión admitidos. Las 200 ayudas de rendimiento reservan
600 llamadas y **US$2,101600** por sí solas; no son el total del ensayo.

En EVALUATION, las 230 ayudas reservan 690 llamadas. De los 12 candidatos
adversarios, uno falla el schema antes de embeddings; los otros 11 reservan
embeddings y cinco pueden llegar a revisión semántica: 16 llamadas adicionales.
Sin reintentos de ingestión, el máximo conservador es **767 llamadas** y
**US$2,479187**. Fallbacks y rechazos pueden reducir consumo; el cálculo no
predice calidad ni garantiza que las 200 ayudas resulten `SUPPORTED`.

Estas bolsas cubren una corrida del corpus vigente y los reintentos automáticos
de ingestión. Una repetición manual, nuevos casos, otro corpus, otras tarifas o
otro modelo exige recalcular y renovar la autorización. No se repiten llamadas
de estado incierto para aprovechar una reserva aparentemente libre.

## Cuotas y acceso: evidencia pendiente

La plantilla propone **Azure CLI** para el consumidor local. La identidad necesita
acceso de inferencia al recurso elegido; en ACA la alternativa será identidad
administrada configurada para ese destino. API key sigue admitida como alternativa
privada en servidor, sin incluir su valor en estos archivos.

Antes del ensayo, registrar por deployment nombre/modelo/version/tipo efectivos,
TPM y RPM asignados, cuota disponible y fecha de consulta. Microsoft asigna cuota
por suscripción/región/modelo/tipo y relaciona RPM con TPM; no se pueden tratar
como valores independientes a voluntad. Consultar las
[cuotas oficiales](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/quota).

El producto conserva una ayuda activa por estudiante/intento, cuatro por
organización, seis admisiones por minuto por estudiante y sesenta por organización;
el cliente aplica pacing de 60.100 ms cuando alcanza su ventana. Estas cuotas no
equivalen a TPM/RPM del proveedor y no se elevaron en esta preparación.

Una referencia de dimensionamiento, sin garantizar p95, es 20 ayudas/minuto:
cuatro carriles con 12 s por ayuda. Eso requiere aproximadamente 20 RPM y
10.000 TPM de entrada en embeddings, y 20 RPM con hasta 200.960/170.240 tokens
de entrada+salida por minuto en generación/revisión respectivamente. Es una
envolvente del arnés; Azure aplica su propio estimador y ventanas de rate limit.
Comprobar también la ráfaga inicial de cuatro solicitudes y la cuota compartida
si ambos deployments consumen la misma bolsa regional/modelo/tipo. No elevar
cuotas automáticamente ni eliminar esperas/fallbacks para mejorar las mediciones.

Con IDs reales y una sesión autorizada, estos comandos de **solo lectura**
permiten recoger configuración/cuota. No se ejecutaron en esta preparación:

```powershell
$trialSubscription = 'REPLACE_SUBSCRIPTION_ID'
$trialResourceGroup = 'REPLACE_RESOURCE_GROUP'
$trialAccount = 'REPLACE_AZURE_OPENAI_ACCOUNT'
az cognitiveservices account deployment list --subscription $trialSubscription --resource-group $trialResourceGroup --name $trialAccount --query "[].{name:name,model:properties.model,sku:sku,rateLimits:properties.rateLimits}" --output json
az cognitiveservices usage list --subscription $trialSubscription --location eastus2 --output json
```

Referencias de sintaxis:
[deployments](https://learn.microsoft.com/en-us/cli/azure/cognitiveservices/account/deployment?view=azure-cli-latest#az-cognitiveservices-account-deployment-list),
[usage](https://learn.microsoft.com/en-us/cli/azure/cognitiveservices/usage?view=azure-cli-latest#az-cognitiveservices-usage-list).
Si `rateLimits` no aparece, contrastar el deployment en Foundry/Portal y conservar
la evidencia; no convertir un valor ausente en cero o cuota suficiente.
Consultar cuota de suscripción requiere `Cognitive Services Usages Reader` en
ese ámbito, según la guía oficial. Esta preparación no concede roles.

## Conversión a CLP y reserva propuesta

Para planificar se fija explícitamente el **supuesto de 1.000 CLP/US$**. Es un
factor presupuestario, no una cotización vigente ni la conversión efectiva de
una tarjeta. Debe sustituirse por la conversión aplicable antes de aprobar gasto.

| Ensayo                                        | Importe calculado USD | CLP bajo ese supuesto, redondeado hacia arriba | Reserva propuesta CLP |
| --------------------------------------------- | --------------------: | ---------------------------------------------: | --------------------: |
| Azure, cuatro etapas con reserva de ingestión |              2,479287 |                                          2.480 |             **5.000** |
| Sandbox, CPU/memoria 60 s y una creación      |             0,0028406 |                                              3 |             **1.000** |
| **Reservas separadas**                        |                     — |                                              — |             **6.000** |

La reserva propuesta es mayor que los conceptos calculados para dejar margen de
conversión; **no es gasto aprobado**. Los límites técnicos del plan Azure siguen
siendo los de sus cuatro bolsas y su techo USD, aunque se aprobara una reserva
CLP mayor. Las reservas no cubren suscripción Pro, publicación/almacenamiento
de imagen, red no medida, impuestos, comisiones, infraestructura nueva ni
corridas adicionales. Esos conceptos requieren cotización y límite propios.
El presupuesto referencial histórico del proyecto no acredita saldo disponible.

## Completar el destino y dejar el ensayo autorizado

1. Confirmar recurso Azure, endpoint, región/tipos/modelos/versiones y nombres
   reales de deployments. Completar privadamente `.local/eval-provider.json`
   desde la plantilla, sin sobrescribir configuración existente. Los nombres
   propuestos se sustituyen si el recurso ya tiene deployments compatibles.
2. Completar los perfiles del plan privado con `id`, `model`, `dimensions` solo
   en EMBEDDING, tarifas y la huella calculada por
   `evaluationProviderFingerprint` de `@alunza/ai`. Usar endpoint/deployment/auth
   efectivos y `o200k_base` en GENERATION/REVIEW; no pegar la huella de TEST.
   `profiles` y `azure` siguen nulos en el ejemplo porque falta ese endpoint.
3. Revisar precios/cuotas y el corpus exacto. Congelar el candidato después de
   terminar modificaciones; calcular `candidateFingerprint` mediante el arnés.
   No usar el SHA anterior como huella del árbol que contiene cambios locales.
4. Registrar aprobación real del Product Owner, referencia, expiración, destino,
   candidato/corpus/perfiles y estas cuatro bolsas/techo global. Para Sandbox,
   además team/proyecto, imagen publicada por digest, SHA, inicio/vencimiento
   máximo siete días, límites y operación `probe:sandbox`. El monto autorizado
   de ambos ensayos permanece pendiente.
5. Seguir [la secuencia LAB-EVAL](IMP-04-evaluation-operations.md) y
   [el probe Sandbox](remote-sandbox-cost-estimate.md). Capturar recibos, uso,
   latencias, fallbacks y limpieza; registrar consumo/costo desconocido como
   desconocido. Los límites del arnés detienen nuevos despachos; no son un corte
   automático de facturación del proveedor.

Todo servicio pagado requiere autorización del Product Owner conforme a
[operación](../../specs/11-operacion-y-despliegue.md#costos-y-aprobación-operativa).
La preparación solicitada no concede autorización para crear deployments,
publicar imágenes o efectuar llamadas de inferencia.

## Verificación de esta preparación

Con Node 24.21.0 aprobaron la lectura de seis JSON, los esquemas del plan Azure
y del manifiesto Sandbox, la aritmética independiente de medidores/costos/bolsas,
los once hashes de fuentes y trece enlaces locales. La plantilla con endpoint
pendiente se rechaza; un descriptor solo en memoria permitió comprobar modelos,
dimensión, tokenizers y cálculo de huellas sin crear cliente ni hacer red.
`help:eval plan` declara cuatro pendientes y cero llamadas; el gate Sandbox
rechaza despacho porque sigue deshabilitado y sin monto/aprobación. Se comprueban
también formato y whitespace en el ámbito al cierre. No es una corrida LAB-EVAL
ni un resultado Azure/Sandbox. Las cuotas efectivas, credenciales, calibración
real, calidad docente y p95 remoto conservan estado pendiente.
