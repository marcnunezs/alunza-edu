# Requisitos para una demostración de ayuda con Azure

Corte: 19/11/2026. El usuario autorizó preparar Azure y realizar inferencia hasta
un máximo de USD 5. Después creó Azure for Students y mostró la suscripción
activa, con rol Propietario y beneficio estudiantil de USD 100. Ese crédito no
amplía el presupuesto autorizado. La autenticación CLI mediante WAM ya confirmó
la suscripción activa. Se comprobó cuota para GPT-4.1 mini y embeddings Global
Standard en `northcentralus`; el único recurso OpenAI S0 y sus dos deployments
devolvieron `Succeeded`. Tras corregir la consulta de recuperación, Azure05
aprobó la calibración con cobertura limitada: 1/3 positivos de validación y
cero falsos. Azure06 identificó una pista indebida dentro de una explicación;
Azure07 corrigió el esquema de solicitud y ya produjo ayuda `SUPPORTED`,
revisión `ACCEPT`, fuente original verificable y reintento `SUCCESS`.
Se conservan 310 recibos completos y US$0,004342 contabilizados entre todos
los ensayos. La comprobación de navegador pasó para alumno y profesor, con
fuente verificable y confirmación de lectura persistida. El
[guion Azure](demo-profesor-azure.md) reúne las rutas y el arranque;
el [guion TEST](demo-profesor-guion.md) permanece como respaldo. No se debe
volver a pedir esa misma autorización; primero se concreta y comprueba el perfil
que la ejecutará. Esta guía no crea recursos ni modifica los límites.
Conserva AD-IA-001 y distingue una demostración técnica de la aceptación docente.
El [registro de preparación con Students](../work/DEMO-azure-estudiantes-2026-11-19.md)
describe Azure CLI local y el nuevo LAB-EVAL separado de la demo TEST.

Para la presentación con Lenovo e internet compartido desde el teléfono,
Azure07 mantiene una ayuda sin consumir para la actividad reservada. La
recuperación, generación y revisión son reales; las reproducciones06–07 usan
los casos ya observados de05, sin atribuirles independencia nueva. La evidencia
TEST de navegador y la física del Ryzen tienen los alcances
descritos en [preparación de evaluación](preparacion-evaluacion-azure.md).

## Perfil compatible con el adaptador

La comprobación autenticada descarta la propuesta inicial de East US 2 por
política regional y GPT-4o por cuota cero. El perfil efectivo comprobado es
`northcentralus`, `gpt-4.1-mini` versión `2025-04-14` y
`text-embedding-3-small` versión 1, ambos Global Standard. El catálogo de esta
cuenta devuelve Legacy para el primero y cuota disponible; la documentación
pública lo describe como Deprecated. Se debe conservar esta discrepancia y
no asumir que cualquier cuenta puede usarlo.
La creación efectiva de ambos deployments terminó en `Succeeded`, con
`NoAutoUpgrade`. El tokenizer y API actuales lo admiten sin cambiar límites.
El descriptor efectivo Azure07 reserva hasta 129 llamadas y US$0,051074;
incluye 31 documentos, 30 consultas de calibración y dos ayudas. Sumado a los
US$0,002537 consumidos antes de07, su reserva conservadora total es US$0,053611.
Las tarifas Global verificadas son
de USD 0,0004/1000 tokens de entrada, USD 0,0016/1000 de salida y
USD 0,00002/1000 de embeddings. No es consumo observado. Los recibos están
en el [registro de preparación](../work/DEMO-azure-estudiantes-2026-11-19.md).

### Antecedente histórico de selección

La tabla y los párrafos siguientes conservan la propuesta anterior para explicar
esa selección; no son la configuración efectiva ni acreditan disponibilidad.

La propuesta inicial contemplaba un recurso Azure OpenAI con dos deployments:
uno de embeddings y otro compartido por generación y revisión. Sus modelos y
región se revisaron después de consultar la cuenta autenticada.

| Fase                             | Propuesta                                                                                                       | Pendiente antes de usarla                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Embeddings                       | `text-embedding-3-small`, versión 1, dimensión 1536, deployment `alunza-demo-embedding`, tipo Standard/Regional | Disponibilidad y cuota de la suscripción; perfil e índice propios de Azure.                                        |
| Generación y revisión            | `gpt-4o`, versión `2024-11-20`, deployment `alunza-demo-generation`, tipo Global Standard                       | Disponibilidad, cuota, identidad exacta devuelta y ensayo real con los límites vigentes.                           |
| Región del recurso               | `eastus2` como propuesta para comprobar                                                                         | Confirmación del destino y sus condiciones; Global Standard no implica procesamiento exclusivamente en esa región. |
| Tokenizer de generación/revisión | `o200k_base`                                                                                                    | Mantenerlo ligado a la versión exacta y al manifiesto.                                                             |

Al consultar Microsoft el 19/11/2026, `gpt-4o` versión `2024-11-20` figura como
Legacy, con retiro previsto el 14/04/2027. Legacy permite crear deployments;
Deprecated restringe los nuevos clientes. El `gpt-4.1-mini-2025-04-14` del ejemplo
histórico del repositorio figuraba Deprecated, por lo que no fue la primera
propuesta. La creación y las respuestas reales posteriores acreditaron su uso
en esta suscripción, tal como se indica arriba. `text-embedding-3-small` figuraba
como GA.
Fuentes: [ciclo de vida](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-retirements)
y [calendario de retiro](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-retirement-schedule).

La matriz pública incluye GPT-4o 2024-11-20 Global Standard y embeddings
`text-embedding-3-small` Standard/Regional en `eastus2`. Esa tabla y un precio
publicado no acreditan capacidad o cuota para una cuenta concreta. Comprobarlos
en la suscripción antes de fijar el perfil.
Fuente: [disponibilidad por región y tipo de deployment](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure-region-availability?pivots=standard).

El [adaptador actual](../../packages/ai/src/azure-generation.ts) usa Chat
Completions v1, mensajes `system`/`user`, `response_format` con `json_schema`
estricto y `max_completion_tokens`. No envía `temperature`, `top_p` ni
`max_tokens`. El mapa de tokenización instalado reconoce
`gpt-4o-2024-11-20` como `o200k_base`. Microsoft incluye esa versión entre los
modelos compatibles con salidas estructuradas. Esta revisión de interfaz no
detectó un cambio obligatorio de código para proponerla; faltan las respuestas
reales y la comprobación de su identidad exacta, contenido y latencia.
Fuente: [salidas estructuradas y API v1](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs).

`gpt-5-mini-2025-08-07` es una alternativa GA cuyo tokenizer también reconoce la
dependencia instalada. Su razonamiento introduce otra variable para el ensayo:
el adaptador no configura `reasoning_effort`, y conserva 2048 tokens máximos de
salida de generación y 512 de revisión. Se debe comprobar la obtención de una
salida completa dentro de esos presupuestos y del plazo existente. No se ha
medido un fallo ni se propone ampliar esos límites. Si hiciera falta configurar
razonamiento, sería un cambio explícito de adaptador, perfil y pruebas antes de
congelar el candidato, no una sustitución improvisada para la presentación.
Fuente: [parámetros de modelos de razonamiento](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reasoning).

## Configuración requerida

Estos requisitos quedaron comprobados para el perfil congelado Azure07. La
credencial permanece exclusivamente en el backend local; los valores efectivos
y recibos se conservan en el expediente privado de la demo.

| Entrada              | Valor o comprobación necesarios                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cuenta y destino     | Suscripción activa, permiso para crear el recurso y deployments, región y cuota efectivamente disponibles. No se presume crédito gratuito ni elegibilidad.                                        |
| `AI_AZURE_BASE_URL`  | Endpoint real con la forma `https://RECURSO.openai.azure.com/openai/v1/`. El adaptador actual no acepta cualquier dominio de Foundry.                                                             |
| `AI_AUTH_MODE`       | Uno de `azure-cli`, `api-key` o `managed-identity`. Para trabajo local puede usarse la sesión Azure CLI autorizada; la identidad necesita permiso sobre el recurso.                               |
| Credencial           | Solo cuando corresponda: `AI_AZURE_API_KEY` o `AI_MANAGED_IDENTITY_CLIENT_ID`. Nunca en el navegador, Git, capturas o informes. No enviar claves por el chat.                                     |
| Perfil de embeddings | `AI_EMBEDDING_DEPLOYMENT`, `AI_EMBEDDING_MODEL`, `AI_EMBEDDING_DIMENSIONS` y `AI_CONFIGURATION_ID`, con valores efectivos y versionados.                                                          |
| Perfil de ayuda      | `AI_GENERATION_DEPLOYMENT`, `AI_GENERATION_MODEL`, `AI_GENERATION_CONFIGURATION_ID`, `AI_GENERATION_TOKENIZER`. En Azure07, la identidad comprobada en la respuesta es `gpt-4.1-mini-2025-04-14`. |
| Revisión             | `AI_VERIFICATION_DEPLOYMENT` y `AI_VERIFICATION_MODEL`; pueden señalar el mismo deployment/modelo de generación. Siguen siendo dos llamadas y dos fases contabilizadas.                           |
| Calibración          | `HELP_CALIBRATION_JSON`, `HELP_CALIBRATION_CORPUS_SHA256` y evidencia coincidente en el registro de evaluación de la base de datos. Un JSON fabricado o copiado de TEST no sirve.                 |
| Plan autorizado      | Destino, candidato congelado, corpus, etapas, precios, llamadas, tokens, importe máximo, responsable y expiración identificados.                                                                  |

La documentación oficial describe Azure CLI y el rol de inferencia
`Cognitive Services OpenAI User`; administrar recursos requiere además los
permisos pertinentes. La aplicación ya separa los modos de autenticación y
mantiene las credenciales en el consumidor servidor.
Fuente: [configuración de embeddings y autenticación](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/embeddings).

## Calibración auténtica antes de la ayuda

La [factoría real de ayuda](../../apps/api/src/help/help.ports.ts) exige
`help-evidence-2` de origen AZURE y evidencia confiable de la base de datos.
El registro comprueba coincidencia de corrida, artefacto y perfil de embeddings.
Cambiar el proveedor a AZURE, redactar un umbral o renombrar evidencia TEST no
satisface este control.

El mínimo técnico existente son cuatro casos: positivo y negativo para
calibración, y positivo y negativo de otro grupo para validación. Deben producir
embeddings de consulta, distancias y recibos reales con identidad de solicitud
del proveedor. Los contenidos y familias reservados para validación se
mantienen separados. El umbral se obtiene de la evidencia y debe cumplir las
reglas del arnés; si los casos no se separan, no se habilita ayuda forzándolo.

Esto es distinto de revisar las 47 fichas con un docente. El código no exige
47 aprobaciones para un piloto técnico, pero cuatro casos tampoco prueban calidad
pedagógica general. La revisión preliminar del usuario no se registra como
validación docente ni como evaluación de respuestas Azure. La
[guía de revisión](revision-docente-corpus.md) mantiene esas tareas y sus campos
humanos separados; su recomendación de revisión previa al gasto sigue vigente.

La ingestión de material docente autorizado es independiente de un intento.
Para solicitar ayuda, en cambio, primero deben quedar confirmados código,
intento, resultado determinista y eventos. IA/RAG conserva ese diagnóstico;
un reintento estudiantil genera evidencia nueva.

## Ensayo breve y presupuesto autorizado

El preparador estándar de evaluación crea 85 intentos y 45 materiales. No existe
un interruptor `--demo` que lo reduzca. El contrato permite un perfil menor. Su
orquestación local TEST y el perfil independiente Azure07 ya llegaron a
FUNCTIONAL con fuentes y calibración persistidas. Azure07 preparó 32 intentos,
31 fuentes y 30 casos técnicos, además del reintento posterior. No hace falta
iniciar las 200 ayudas de la campaña de latencia
para una demostración funcional; tampoco se puede declararla aprobada sin ellas.

La propuesta mínima inicial siguiente se conserva como antecedente. No es el
expediente vigente ni debe ejecutarse de nuevo para la presentación:

1. Fijar cuatro documentos breves, los cuatro casos de calibración/validación y
   un intento de demostración. Identificar archivos, hashes, clase y actividad
   antes de autorizar el perfil. Un documento propio puede formar parte de ese
   corpus si su uso no contamina la separación entre grupos.
2. Ingerir los cuatro documentos: cuatro llamadas de embeddings si cada uno
   cabe en un lote. Conservar el máximo de reintentos vigente y reservar su
   posible consumo o detenerse al agotar el presupuesto.
3. Medir las cuatro consultas de calibración/validación: cuatro llamadas de
   embeddings, sin generación ni revisión en esta etapa.
4. Solo con el artefacto real admitido, solicitar una ayuda: una consulta de
   embeddings, una generación y una revisión. Comprobar persistencia, referencia
   y ayuda visible, o registrar la degradación real.
5. Cerrar el consumo y conservar los recibos y resultados. Una ayuda aislada no
   estima un p95 ni acredita aceptación pedagógica.

Son **11 llamadas nominales** bajo esas condiciones, no un mínimo garantizado ni
una corrida ya preparada. Un quinto documento propio agrega al menos su
ingestión; más fragmentos, reintentos o ayudas cambian la reserva. El perfil debe
mantener límites por etapa y globales. Con cuatro documentos de calibración y un
quinto apunte separado para la demo, una ayuda suma 12 llamadas nominales y dos
ayudas suman 15. Los reintentos deben estar previstos en la reserva, sin elevar
los límites del producto. El registro y las reservas de TEST no autorizan Azure.

Precios históricos de la propuesta descartada, consultados el 19/11/2026 para
`eastus2`, USD, consumo; no se usan para contabilizar Azure07:

| Medidor                         | Precio por 1000 tokens |
| ------------------------------- | ---------------------- |
| GPT-4o 1120 Global, entrada     | USD 0,0025             |
| GPT-4o 1120 Global, salida      | USD 0,01               |
| text-embedding-3-small Regional | USD 0,000022           |

El recibo local de la consulta pública está en
`.local/demo-azure-20261119/public-retail-prices-gpt4o-verified.json`:
tres medidores, sin página siguiente y sin llamadas de inferencia. La fuente es
la [API pública de precios de Azure](https://prices.azure.com/api/retail/prices?currencyCode=USD&%24filter=armRegionName%20eq%20%27eastus2%27%20and%20productName%20eq%20%27Azure%20OpenAI%27%20and%20%28skuName%20eq%20%27gpt%204o%201120%20Inp%20glbl%27%20or%20skuName%20eq%20%27gpt%204o%201120%20Outp%20glbl%27%20or%20skuName%20eq%20%27text-embedding-3-small-regional%27%29).

Como cálculo ilustrativo, 100.000 tokens de entrada de chat, 20.000 de salida y
100.000 de embeddings suman **USD 0,4522**, sin impuestos. Es una hipótesis de
volumen, no una cotización de la demo ni una medición de gasto. El total incluye
la entrada y salida de ambas fases de chat; no se omite el verificador.

El **techo de USD 5 para inferencia fue autorizado por el usuario** el 19/11/2026.
Se materializó en planes y autorizaciones duraderas con precio, destino,
fases y reservas concretos, incluyendo el consumo histórico. Ese importe no constituye por sí
solo un límite duro de facturación de Azure. Los presupuestos
y alertas de Cost Management avisan; por sí solos no detienen el servicio.
Fuente: [presupuestos de Azure](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets).
Todo ensayo adicional debe conservar el perfil efectivo, sus reservas y el
alcance autorizado. No contratar capacidad aprovisionada ni ampliar límites para
acomodar el ensayo.

## Pasos de implementación del perfil reducido

La preparación TEST vigente se ejecutó con
`.local/demo-profesor-20261119/evaluation-demo-03.mjs`. Reutiliza los contratos y
funciones existentes, conserva el registro histórico y no modifica las reglas de
admisión. Su expediente está en `evaluation-ledger-03` bajo el mismo directorio;
los expedientes anteriores `evaluation-ledger` y `evaluation-ledger-02` se
conservan detenidos, con sus resultados y fallos.

| Paso                        | Función o contrato reutilizable                                                              | Evidencia que debe conservarse                                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Preparar destino            | `readState`, `testContext` o `evaluationContext`, comprobación explícita de puertos/proyecto | Identidad del destino; nunca credenciales en el informe. Azure debe usar LAB-EVAL y su índice propio.                                                                          |
| Crear alcance por API       | `EvaluationClient.product`, `EvaluationJournal.intent`, `evaluationCalibrationCases`         | Clase de calibración separada, cuatro actividades/ejercicios y cuatro intentos reales; expectativas autorales y diagnósticos observados diferenciados.                         |
| Fijar materiales e intentos | `evaluationMaterialBindingSchema`, `evaluationCaseBindingSchema`                             | Hash, actor, organización, clase, actividad, operación UPLOAD/REINDEX y máximo de operaciones; HELP vinculado a un intento ya confirmado.                                      |
| Congelar y comprobar        | `candidateFingerprint`, `evaluationPlanSchema`, `assertEvaluationReady`                      | Inventario de fuentes, huella, presupuesto por etapa, perfiles y expiración; conservar preimágenes si luego cambia documentación.                                              |
| Registrar autorización      | `authorizeEvaluation`                                                                        | Manifiesto duradero y capability privada. Usar esta función de mantenimiento; no insertar resultados o artefactos a mano.                                                      |
| Ingerir                     | `EvaluationClient.operations` para INGESTION y API de materiales                             | Trabajos SUCCEEDED, fuentes READY, hashes y recibos COMPLETED. El apunte queda separado de los casos reservados para validación.                                               |
| Calibrar                    | Inicio de CALIBRATION, worker existente, `waitForCalibration`                                | Cuatro observaciones y recibos del proveedor efectivo; artefacto `help-evidence-2` producido y comprobado por el servidor.                                                     |
| Habilitar una ayuda acotada | Inicio de FUNCTIONAL, configuración del artefacto y API/UI normales de ayuda                 | Un binding por intento y consumo reservado; activar el artefacto del mismo run en la API antes de pedir ayuda, tanto en TEST como en Azure. Preservar diagnóstico e historial. |
| Conservar y cerrar          | Estado y recibos por el listener de operaciones                                              | Cero trabajos en vuelo al detener servicios; capacidad reservada identificada si se reanuda al día siguiente; cierre definitivo al terminar o expirar.                         |

El plan conserva los campos canónicos de latencia porque su esquema es estricto,
pero EVALUATION tiene presupuesto cero y esa campaña no se inicia. No se afirma
que un ensayo breve haya satisfecho sus 200 muestras. Para comprobar la lógica
sin servicios se pueden validar formas, sumas de reservas, hashes, aislamiento
de bindings y selección exclusiva de etapas. Los recibos, la persistencia y la
calibración requieren la ejecución local TEST o la posterior corrida Azure;
una prueba offline no los sustituye.

El 19/11/2026 la preparación 03 llegó a FUNCTIONAL con cinco reindexaciones
completas y cuatro observaciones nuevas de calibración: nueve recibos TEST
COMPLETED y cero llamadas Azure. Reutilizó cuatro intentos de calibración
persistidos y los mismos archivos/versiones; las reindexaciones las solicitó el
ADMIN canónico por el endpoint de mantenimiento, que permite esa operación sobre
fuentes READY. El ADMIN no descargó contenido pedagógico. Dos intentos FAILED_TEST
nuevos corresponden a un ejercicio que describe explícitamente la función de
suma solicitada.

La comprobación local previa y posterior a esa medición usó la consulta real
`buildHelpQuery`, el mapeo del proveedor TEST cargado y distancias de pgvector:
ambos intentos de demostración y los positivos obtuvieron distancia cero;
los negativos, aproximadamente 0,1671 y 0,3580. El umbral medido se mantuvo en
cero. Esto verifica un fixture determinista; no acredita similitud semántica ni
calibración Azure.

El historial explica por qué se preparó la corrida 03. La corrida 01 conservó
una ayuda `PROVIDER_UNAVAILABLE / CONFIGURATION_MISSING` antes de activar su
artefacto y otra `NO_EVIDENCE` después: la consulta y la fuente producían vectores
TEST distintos. Terminó con diez recibos. La corrida 02 intentó reindexar fuentes
READY como docente y recibió HTTP 403 antes de crear trabajos o recibos; se
detuvo con cero recibos. No se modificaron los resultados anteriores, las
autorizaciones inmutables ni las reglas para hacer pasar esos casos.

Al completar la preparación 03 quedaron dos bindings FUNCTIONAL de una operación
cada uno: ensayo y presentación reservada. Su activación en la API y el ensayo
de ayuda se registran por separado en el [trabajo de la demo](../work/DEMO-profesor-2026-11-19.md).
La segunda ayuda no se solicita durante la preparación. El intento inicial de
la presentación está preparado y debe explicarse así; el usuario puede pedir
su ayuda y enviar después un reintento nuevo. Las tres pistas adicionales no
están autorizadas por esos bindings de una sola operación.

La huella ejecutada y las preimágenes de los cuatro documentos que pueden
actualizarse al cerrar se conservan en `evaluation-source-snapshot-03.json` y
`source-at-grant-03`, respectivamente. La documentación posterior distingue ese
candidato del estado final del checkout.

Una base TEST con corridas históricas conserva la exigencia de registro aunque
se desactive `EVALUATION_ENABLED`. Resolverlo requiere bindings válidos y la
etapa correspondiente; no borrar corridas ni desactivar el control. En este
perfil el run permanece RUNNING en FUNCTIONAL para reanudar mañana, con expiración
`2026-11-21T02:59:00Z`, y el lanzador comprueba su recibo `ledger-owner.json`.
Conservar una autorización no significa dejar trabajos ni puertos abiertos.

## Mostrar un documento propio

El usuario eligió funciones y `return` y no dispone de apunte propio. Se preparó
un apunte ficticio provisional en
`.local/demo-azure-20261119/apunte-funciones-return.md`, pendiente de indexación
Azure y validación docente. No se atribuye su autoría al profesor ni se sustituye
con él el material TEST ya identificado por hash.

El flujo de producto ya existe: un docente ACTIVE y autorizado abre su clase o
actividad, entra en **Materiales**, selecciona **Cargar material**, indica título
y ámbito y carga PDF con texto, TXT o Markdown, hasta 10.000.000 bytes. No admite
DOCX ni añade OCR a un PDF escaneado. Para una demostración breve conviene un TXT
o Markdown corto, con un concepto y ejemplo que respalden el ejercicio elegido.

La carga guarda el original en Storage privado y crea un trabajo. Esperar
**Completado / Disponible**, equivalente a la publicación de una generación
READY utilizable. Si no hay embeddings configurados, el archivo guardado por sí
solo no prueba que esté indexado. El entorno Azure debe tener su propio perfil;
no se mezclan vectores TEST con embeddings reales.

Después, un estudiante de esa clase envía su solución, consulta el resultado
persistido y pide ayuda. **Fuentes de esta ayuda** permite comprobar la referencia
y abrir la versión original bajo permisos vigentes. En LAB-EVAL el archivo y su
ámbito deben formar parte del perfil autorizado antes de consumir inferencia:
no subir documentos arbitrarios después para eludir esa vinculación.

Una fuente cargada no garantiza `SUPPORTED`. Si no ofrece sustento suficiente,
corresponde `NO_EVIDENCE`; una dependencia fallida produce
`PROVIDER_UNAVAILABLE`. Ninguno modifica la corrección técnica ni habilita una
solución completa.

## Qué se puede enseñar hoy con TEST

TEST permite mostrar interfaz, permisos, archivo original, trabajo de ingestión,
intento persistido, ayuda, referencias y reintento usando proveedores controlados.
Sus embeddings y textos de ayuda son deterministas: no demuestra comprensión
semántica de un documento nuevo, generación Azure ni su coste o latencia.
Identificarlo expresamente en la presentación y conservar Azure como pendiente.

La preparación local permite terminar el guion, elegir el documento, revisar los
casos y comprobar el recorrido TEST sin consumir inferencia Azure.
La puesta en marcha posterior de LAB-EVAL se documenta en
[operación de evaluación](../work/IMP-04-evaluation-operations.md). No copiar sus
comandos de ejecución hasta concretar el perfil correspondiente a la autorización
ya otorgada.

La compatibilidad Azure se revisó mediante código, documentación pública y el
mapa local de tokenizer; no se ha llamado a esos modelos. La preparación TEST
descrita sí ejecutó sus casos y produjo evidencia local identificada. La
activación de una suscripción, sus recursos y cuota, la integración y calibración
medidas con Azure y la aceptación docente siguen pendientes. El techo de USD 5
ya autorizado no implica que esos requisitos estén resueltos ni que se haya
consumido inferencia.
