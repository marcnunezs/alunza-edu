# Recuperación de fuentes para la demostración — 19/11/2026

**Resultado final:** Azure07 produjo ayuda real `SUPPORTED`, revisión `ACCEPT`,
fuente verificable, lectura en navegador como alumno y profesor y reintento
`SUCCESS`. Las ayudas de presentación de Azure y TEST siguen reservadas sin
consumo. El acumulado de siete campañas es **US$0,004342 de los US$5**
autorizados, con 310 recibos completos y ninguno incierto. La calibración es
conservadora: 1/3 positivos y 0/3 negativos de validación aceptados. La revisión
docente sigue pendiente. El [guion Azure](../guides/demo-profesor-azure.md)
contiene las rutas y el arranque. Los apartados siguientes conservan también
las hipótesis, rechazos y correcciones anteriores; no son campañas nuevas
pendientes de ejecutar.

## Alcance autorizado

Corregir la representación de la consulta de recuperación y repetir la
validación con Azure para la demostración del 20/11. Se conserva el máximo
acumulado de US$5, la demo TEST preparada y todos los expedientes anteriores.
No cambia el proveedor, los límites por llamada, el ejecutor, el umbral por
decisión manual ni el criterio de aceptación de la calibración.

Trazabilidad: ALZ-RF/HU/CU/PT-006, -010, -012, -013 y -025;
RNF-IA-01/02/03/04 y RNF-CON-01/02/03. El resultado determinista y su
persistencia preceden a la ayuda. La revisión docente continúa pendiente.

## Diagnóstico y cambio previsto

Las campañas `azure-01` y `azure-02` terminaron con la calibración rechazada.
Sus 34 llamadas de embeddings quedaron contabilizadas: 3927 tokens de
entrada, 94 microUSD (US$0,000094), sin llamadas pendientes. No produjeron
ayuda generada ni un artefacto promovible.

`help-query-1` representa diagnóstico, conceptos, enunciado e identificadores
de pruebas visibles mediante JSON; excluye el código del intento. Por ello,
dos soluciones distintas con el mismo resumen técnico generan la misma
consulta. La hipótesis a verificar es que esa representación favorece el
contexto narrativo del ejercicio sobre la necesidad de aprendizaje.

La guía de [recuperación RAG de Microsoft](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/rag/rag-information-retrieval)
describe la reformulación cuando una consulta omite términos relevantes o
contiene palabras innecesarias. Aquí se aplica una construcción determinista
con datos ya autorizados; su calidad se comprobará mediante mediciones propias.

Se prepara `help-query-2`: texto determinista con intención pedagógica,
conceptos, fragmento acotado del código persistido, enunciado, diagnóstico
exacto y recuento de pruebas visibles. No deduce un diagnóstico nuevo ni
incorpora entradas, salidas esperadas, pruebas ocultas o identificadores.
Conserva 500 tokens como máximo y no añade llamadas al proveedor. Los
presupuestos internos son 200 tokens de código, 120 de enunciado y 40 de
conceptos; las etiquetas, marcas de fragmento y hechos públicos conservan
margen propio. Un enunciado largo no desplaza el código ni el diagnóstico.

La versión cambia las huellas de recuperación y exige un artefacto nuevo.
Los cambios previstos se concentran en `packages/ai/src/help.ts` y sus
pruebas. La API y los auxiliares se compilarán en un directorio privado;
los builds que usa el respaldo TEST se conservarán.

## Plan de verificación

- Pruebas de consulta: sensibilidad al código, campos autorizados,
  truncamiento, Unicode, límites, texto adversarial y artefactos incompatibles.
- Doce casos observados anteriormente pasan a desarrollo. Seis casos nuevos
  sellados por separado (tres positivos y tres negativos) se reservan para
  validar el candidato congelado. No se ajustará contra sus resultados.
- Expediente nuevo con presupuesto reservado, carry de 94 microUSD,
  ingestión, calibración y activación sólo si supera el criterio existente.
- Si se activa: ayuda real, fuente trazable, reintento y observación en
  navegador; conservar una ayuda sin consumir para la presentación.
- Auditoría final de consumo acumulado y disponibilidad del respaldo.

## Primera medición: consulta v2

Candidato `7f86e235e3895b0788f84e314fc095f18fec1417e9414581efff75314bfa025f`.
Pasaron 477 pruebas en 19 suites de IA, API y preparación, más 14 pruebas
offline del arnés. Tipos, lint y formato correctos. La compilación privada
coincidió con 252 fuentes; los 324 archivos de runtime/infra del respaldo
permanecieron idénticos. El respaldo TEST conserva `help-query-1`, su
artefacto y la ayuda reservada 0/1; no fue reiniciado.

Campaña `azure-03`, run `9866bf65-f012-4dd1-9c27-16e0f5e70b61`:
20 intentos persistidos y 19 fuentes indexadas. La cuota de envíos detuvo
la preparación tras diez casos; se reanudó el mismo journal en la ventana
normal, sin ampliar la cuota ni duplicar los casos ya guardados.

La calibración terminó rechazada: 8/8 positivos de entrenamiento y 3/3 de
validación recuperados, pero también dos negativos de validación aceptados.
Umbral medido: `0.585289802839035`. El negativo de precedencia/tipos quedó
a distancia `0.383369844549768`, más cercano que cualquier positivo de la
reserva; el de dependencias globales quedó a `0.579274467084697`. Cambiar
solamente el umbral no separa esta muestra. Tanto el replay puro como el
replay desde recibos reproducen `CALIBRATION_INVALID`.

Todos los 18 trabajos de medición finalizaron y sus hashes coincidieron.
La campaña consumió 37 llamadas de embeddings, 5650 tokens y 130 microUSD.
Acumulado de las tres campañas: **71 llamadas, 9577 tokens y 224 microUSD
(US$0,000224)**; cero recibos inciertos o trabajos pendientes. Es contabilidad
del registro conservador, no una factura de Azure. No hubo generación ni
artefacto promovible. Los expedientes se conservan en `.local`.

## Siguiente corrección en preparación

Se evaluará una descripción determinista de hechos sintácticos del código
para distinguir el valor devuelto de cálculos, mensajes o llamadas aisladas.
El parser no ejecutará el código ni sustituirá el diagnóstico del ejecutor;
su análisis tendrá un límite menor que el código permitido y una salida
neutral ante sintaxis no soportada o entrada fuera de ese límite. Se
conservarán los 500 tokens y las tres fases de llamadas actuales.

Se declara Acorn 8.19.0 como dependencia runtime exacta de `@alunza/ai`;
la instalación omite scripts y sólo cambia esa dependencia en el lockfile.
La configuración fija ECMAScript 2022. El análisis opcional se limita a
2048 bytes, 512 tokens, 32 niveles y 512 nodos. Los literales de expresión
regular se rechazan antes de su validación/compilación por el parser.
Estos topes no reducen ni amplían el tamaño de código admitido por Alunza.
La [documentación oficial de Acorn](https://github.com/acornjs/acorn/blob/master/acorn/README.md)
describe el AST y la configuración de sintaxis; esta incorporación no
ejecuta el programa ni acredita su corrección.

Los 18 casos ya observados pasan a desarrollo. La siguiente validación se
sellará de nuevo antes de medir. Se conserva el fallo, sin cambiar etiquetas
ni relajar el criterio de calibración. La demo Azure todavía no está lista;
la aceptación docente continúa pendiente.

`help-query-3` ya implementa los hechos sintácticos con presupuestos de
140 tokens para hechos, 100 para código, 80 para enunciado y 40 para
conceptos. Las frases conservan funciones completas o indican que se
omitieron hechos. Los retornos de funciones anidadas no se atribuyen a la
función exterior. Comentarios, cadenas y propiedades llamadas `return`
no se convierten en instrucciones. Los artefactos v1 y v2 se rechazan.

La verificación focal pasó **20 suites y 495 pruebas** (IA 394, API 21,
preparación 80), además de tipos, lint y formato. Una selección inicial
demasiado amplia de preproducción se interrumpió tras un timeout de 5000 ms;
no se acredita esa corrida. El caso afectado pasó aislado en 1,545 s con el
mismo timeout y aserciones, sin demostrar por ello una causa concluyente.
Se conservaron ambos registros. Los 324 archivos originales del respaldo
permanecieron idénticos. El nuevo build privado contiene 253 fuentes y
326 artefactos; el build query v2 anterior se conserva.

Para la presentación Azure, el ejemplo de suma calcula `a + b` dentro de
un bloque sin devolverlo. El reintento correcto usa la expresión de una
función flecha. El diagnóstico inicial esperado del **arnés de Alunza** es
`RUNTIME_ERROR`, porque el resultado `undefined` no cumple su contrato;
omitir `return` no lanza por sí mismo una excepción en JavaScript. Esta
aclaración operativa queda separada del apunte. El respaldo TEST conserva
su ejemplo anterior. Ningún caso ni etiqueta de calibración se modifica
por este ajuste de la presentación.

## Segunda medición: consulta v3

Candidato `f03062ce9bd4708531fa70205d4e50953a87e5e36b3fd09a4ad14f47fadff16b`,
run `f748cd9f-0386-4dbd-a0a8-4bfba1087092` (`azure-04`). El arnés pasó
16 pruebas offline. Se guardaron los 26 intentos, se respetaron dos ventanas
de cuota y se indexaron 25 fuentes; todos los 24 trabajos de calibración
finalizaron con recibos completos.

La calibración volvió a rechazarse. En el entrenamiento (11 positivos y
7 negativos), el negativo de precedencia/tipos quedó a
`0.362730760104112`, por debajo de todos los positivos (mínimo
`0.415928656807214`). No existe un umbral de entrenamiento que acepte un
positivo sin aceptar ese negativo. Los dos replays reproducen
`CALIBRATION_INVALID`; no se seleccionó política, de modo que la aceptación
de validación es **no evaluable**, no un resultado aprobado con cero falsos.
Las distancias de los 18 pares compartidos bajaron, pero no mejoró su
separación. No hubo generación ni artefacto promovible.

Consumo acumulado: **120 llamadas de embeddings, 18698 tokens y
429 microUSD (US$0,000429)**; cero llamadas inciertas o trabajos pendientes.
Se conservaron fuentes, etiquetas, intentos y recibos. Los consumidores de
Azure04 se apagaron ordenadamente; TEST permanece disponible.

El análisis de consultas observa todavía 66–67 tokens de narrativa y
aproximadamente 93 de etiquetas en los casos problemáticos. El siguiente
ajuste reducirá ese ruido y dará prioridad a los hechos y conceptos,
conservando una muestra literal mínima del código propio. Usar sólo hechos
colapsaría varias consultas distintas; no se eliminará el control que
rechaza hashes compartidos entre entrenamiento y validación ni se añadirán
identificadores para eludirlo. El contexto completo y el diagnóstico de
generación se conservan. Este es un nuevo candidato por medir, no una
aprobación de la demo Azure.

`help-query-4` conserva los hechos y conceptos como núcleo de la consulta
cuando el análisis sintáctico está disponible, junto con un prefijo literal
del código de hasta 32 tokens. En esa representación omite la narrativa,
diagnóstico serializado, infraestructura y contadores. Cuando el análisis
no está disponible conserva la representación acotada anterior. Valida
todo el contexto antes de escoger una rama; generación y revisión mantienen
el código completo, el diagnóstico exacto y el resto de datos autorizados.
No cambia el contrato HTTP, el parser, el proveedor ni el criterio de
calibración. Su eficacia todavía necesita medición.

La verificación de query4 pasó **20 suites y 498 pruebas**. En los 24 casos
ya observados, las consultas se reducen a 67–121 tokens y no presentan
colisiones entre las particiones anteriores. Quedan 22 consultas distintas:
dos pares históricos idénticos están dentro del entrenamiento y no eluden
el control entre particiones. Este cotejo no genera embeddings ni acredita
mejora en distancias. El respaldo mantiene sus 324 archivos originales.

## Tercera medición: consulta v4 y primer ensayo generativo

El candidato `a3794f01926d3cae37d2a8fc1587efc2cf82610accd743ef9c78a5a245964043`
se midió en `azure-05`, run `9c6fe53f-6f9b-446b-8b86-249b07bfebf4`.
Se prepararon 32 intentos respetando tres esperas de cuota, se indexaron
31 documentos y se completaron los 30 casos. La validación nueva quedó
sellada antes de congelar el candidato. El arnés pasó 16 pruebas offline.

La calibración **pasó**: umbral `0.440626924990724`, 24 casos de desarrollo
y seis de validación. Aceptó **1/3 positivos y 0/3 negativos** de validación.
Es recuperación conservadora, no cobertura amplia ni aceptación docente.
El artefacto auténtico
`c3f41516e5757d07e085bad00ff7b6f2c4bbe37691c74ff3ee15ffb89bdd2a8c`
se persistió y activó mediante reinicio ordenado de los consumidores.

La ayuda de ensayo recuperó el fragmento correcto del apunte a distancia
`0.287831194567631`. Azure devolvió HTTP 200 y el modelo esperado
`gpt-4.1-mini-2025-04-14`, con 1228 tokens de entrada y 229 de salida.
Sin embargo, el adaptador rechazó esa salida con `INVALID_OUTPUT`, antes de
la revisión independiente. Se persistió `PROVIDER_UNAVAILABLE`, sin citas
ni exposición de la respuesta rechazada. La evidencia existente conserva
uso y fallo, pero no distingue la condición concreta de rechazo; no se
atribuye una causa no observada. No hubo validación Azure en navegador.

El acumulado de los cinco expedientes es **183 llamadas y 1476 microUSD
(US$0,001476)**, con cero recibos inciertos o pendientes. El coste procede
del ledger a las tarifas verificadas, no de una factura de Azure. Se detuvo
la autorización de azure-05 y se conservaron su artefacto, fallo y datos;
la ayuda de presentación quedó sin consumir. TEST sigue reservado 0/1.

El siguiente ensayo añadirá motivos internos de rechazo enumerados, sin
guardar texto del proveedor ni cambiar las validaciones. Repetirá el mismo
corpus y consulta v4: será una reproducción de la medición ya observada,
no otra validación inédita. No se ajustarán fuentes, etiquetas ni umbral
para resolver el fallo de generación.

## Reproducción y causa concreta del rechazo

Se añadió `rejectionReason`, un enum interno de 18 motivos. El adaptador
conserva uso y rechazo; el worker valida de nuevo ese enum antes de guardarlo
junto a `failure` y `usage`. No almacena texto rechazado, no cambia el error
público `INVALID_OUTPUT`, no repite llamadas y no modifica los validadores.
Pasaron **7 suites y 217 pruebas focales**, tipos, lint y formato. Una primera
invocación de tests apuntó a una ruta inexistente; se conservó su registro y
la suite real se ejecutó separadamente con sus 14 pruebas aprobadas.

El candidato `46b6feda775a39d263acecfd51efb71ebef37a3ec38e96c9239a2603414b1ce5`
se ejecutó en `azure-06`, run `81ba8868-8853-424a-a74e-a8eaaffbbd0c`.
El arnés pasó 18 pruebas offline. Conservó literalmente el corpus anterior
y comprobó igualdad de las 30 consultas, prompts, parser y límites.
Es una **reproducción con casos ya observados**, no nueva validación
independiente. Los 32 intentos y 31 documentos se prepararon con nuevas
identidades, respetando la cuota sin duplicar intentos previos.

La calibración volvió a pasar y se activó su artefacto auténtico
`7f156990cef4b42dfa54f429ec1106382c0d95455198ac141e081836023ea57c`.
El nuevo ensayo recuperó la fuente a distancia `0.287911151733775`, pero
la generación volvió a degradar. Esta vez quedó registrada la causa exacta:
**`KIND_MISMATCH` en FEEDBACK**, por una pista no vacía cuando se pidió sólo
explicación. Azure respondió HTTP 200 con el modelo correcto, 1244 tokens
de entrada y 234 de salida. No llegó a REVIEW ni al navegador.

El acumulado es **246 llamadas y 2537 microUSD (US$0,002537)**, todas
contabilizadas, cero inciertas y cero trabajos pendientes. Azure06 quedó
STOPPED; su artefacto, datos y respuesta degradada se conservan. Las ayudas
de presentación de Azure06 y TEST siguen sin consumo.

La corrección siguiente exigirá `hint` vacío en el esquema de generación
para FEEDBACK. La validación local seguirá rechazando incumplimientos;
no se borrará ni reparará una pista recibida. HINT y revisión conservarán
su comportamiento. La política de solicitud de generación tendrá identidad
propia nueva, sin cambiar consulta, prompts ni contrato RAG de cinco campos.

## Azure07: explicación válida, fuente y reintento

Se implementó `help-generation-request-2`: sólo la generación de FEEDBACK
exige `hint` igual a cadena vacía en su esquema estricto. HINT 1–3, revisión,
validadores y contrato público permanecen iguales. El adaptador sigue
rechazando una respuesta que incumpla el esquema; no recorta ni repara texto
recibido. La política cambia el fingerprint de GENERATION y la factoría para
impedir reanudar un checkpoint incompatible. EMBEDDING y REVIEW mantienen sus
fingerprints. El uso de `enum` es compatible con las
[salidas estructuradas documentadas por Microsoft](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs).

Pasaron **14 suites con 373 pruebas** del cambio final: 247 de IA, 46 de API
y 80 de preparación; también tipos, lint y formato focales. El arnés07 pasó
**19 pruebas offline** sin proveedor. Se conservan los recibos privados
`feedback-policy-verification/receipt.json` y
`run-preparation/offline-v7-check-receipt.json`. La comprobación de preservación
comparó las 30 consultas, prompts, parser y límites antes de congelar07.

El candidato
`8f17005f35d60c7c3d501611516df47b47556c043adf7365017120dcde838133`
se midió en `azure-07`, run `d6c041ff-f74a-4c1d-9529-87d83001cb1e`, con
17 entradas congeladas y compilación privada B07. Conserva literalmente el
corpus05: **reproducción de casos ya observados**, no otra validación
independiente ni ajuste de etiquetas para aprobar. Preparó 32 intentos,
respetando tres esperas normales de cuota; indexó 31 documentos y completó
30 casos. La calibración volvió a producir umbral `0.440626924990724`, con
24 casos de desarrollo y seis de validación: **1/3 positivos aceptados y
0/3 negativos aceptados**. Se activó el artefacto auténtico
`7587a8a0155e979fa7a27c23220522bba9642bfc75f4ecb85668b7c00904cd8a`
mediante reinicio ordenado, sin fabricar evidencia ni bajar el criterio.

La solicitud `73caa830-88b5-4892-8e67-579d1a65cdbc` terminó en `SUCCEEDED`,
con feedback `34aef55b-7759-4259-8b4c-3063afdedd68`, `SUPPORTED` y pista vacía.
La revisión independiente devolvió `ACCEPT/SUPPORTED`. Embeddings, generación
y revisión respondieron HTTP 200; las dos últimas confirmaron
`gpt-4.1-mini-2025-04-14`. Se mantuvo el diagnóstico persistido `RUNTIME_ERROR`.
La fuente original citada tiene SHA-256
`d34b1c2c7cde94ec2df34682feb75f9c626556beb4ea5242c36c9e1c8eb123a5`
y el fragmento corresponde a «Líneas 1–41». No se atribuye validación docente
al apunte sintético.

El nuevo intento `5f3b27e8-c809-42ac-b193-f08fbe73dc61` terminó en
`SUCCESS`, con infraestructura `OK`, sin alterar el intento original
`c55b47b9-4834-4b0d-8c19-1b54c5c59689`. Ambos conservan un evento de envío
y otro de finalización. El código inicial devuelve `undefined`; el
`RUNTIME_ERROR` deriva del contrato de retorno de Alunza, no de una excepción
nativa causada simplemente por omitir `return`.

## Navegador y auditoría de cierre

El observador congelado inicial terminó con `BUTTON_NOT_READY` y se conservó
en `browser/runs/74177e0f-26eb-4b4e-8227-c84cd4f35bd1/observation.json`.
Sus comprobaciones HTTP pasaron, sin HELP, SUBMIT ni ACK nuevos. El diagnóstico
separado confirmó que los botones estaban habilitados, pero la entrega de
mouse/teclado del auxiliar no los activaba. También se identificó un bloqueo
del evento legítimo de apertura de actividad en su allowlist. No se cambió
código de la interfaz ni se atribuyó una causa de producto no demostrada.

Una revisión separada `v7-r1` permitió exclusivamente la apertura de la
actividad de ensayo por su alumno y activó los botones reales del DOM tras
esperar dos cuadros de pintura. No alteró contenido, estado de la aplicación
ni envió manualmente la confirmación de lectura. Pasaron **4 comprobaciones**:
ayuda, fuente original y reintento persistidos; contenido visible del alumno;
contenido visible del profesor; reserva y evidencia original intactas. Las
huellas del texto visible coinciden con la respuesta persistida. La interfaz
emitió **un ACK HTTP 200** a las `2026-11-19T19:48:10.814605Z` y un evento de
apertura de actividad; hubo **0 HELP, 0 SUBMIT y 0 llamadas de proveedor**
nuevas. El informe es
`browser/runs/cb6af420-4a48-4995-b9ab-f2597c600b40/observation.json`, con sus
capturas. Su modo es `DOM_AUTOMATION`: acredita el contenido y los manejadores
reales, no interacción de mouse/teclado, formulario de login ni latencia.

La auditoría de solo lectura
`operation/final-review-azure07-1795117755844.json` correlaciona ese informe
con los recibos auténticos del proveedor, el artefacto de calibración, la
fuente READY del ámbito correcto y el ACK único. Confirma ambos entornos
saludables, cero trabajos pendientes y las ayudas de presentación Azure y
TEST en **0/1**. Los 324 archivos del runtime original TEST y los 326
artefactos privados B07 mantienen sus hashes. La documentación de cierre se
actualiza después de medir; los archivos congelados de la medición se
conservan.

El reinicio controlado posterior cerró los consumidores sin errores y mantuvo
el grant activo. Volvió a `READY` con la misma calibración, ayuda, ACK, fuente,
reintentos, coste y reservas; no operó el respaldo TEST ni generó inferencias.
Lo acreditan `operation/restart-verification07-1795117888726.json` y
`operation/final-review-azure07-1795117860170.json`. La captura posterior
`browser/runs/72ea47f1-3550-45fa-a77a-bedf83d5483e/teacher-explanation-source.png`
encuadra explicación y cita juntas; su observación de solo lectura pasó sin
ACK adicional ni otra mutación. Se comprobó el reinicio de consumidores,
no un reinicio completo de Windows.

El cierre documental pasó formato focal, `git diff --check` de los archivos
afectados y comprobación de 160 enlaces locales en seis documentos. No se
recompiló sobre el runtime TEST ni se ejecutó una suite general que alterara
los servicios de presentación.

El ledger acumulado registra **310 llamadas COMPLETED, 47.648 tokens de
entrada, 795 de salida y 4342 microUSD (US$0,004342)**, sin llamadas inciertas,
en despacho ni costes faltantes. Incluye los seis expedientes anteriores.
Es cálculo con uso observado y tarifas fijadas, no una factura conciliada
de Azure. El plan07 reserva conservadoramente US$0,051074; sumado al consumo
anterior de US$0,002537, son US$0,053611, dentro del máximo global de US$5.
No se confunde reserva con consumo ni se amplía el presupuesto del estudiante.

Los límites se conservan: consulta 500 tokens, corpus 2500, contexto
compartido 5000, entrada por llamada 8000, generación 2048, revisión 512 y
plazo interactivo de 15 s, sin reintentos del SDK. El ejecutor Docker del
Lenovo mantiene 128 MiB, 3 s y 64 KiB; declarar versión `.13` no acredita
la VM física individual ni su capa de 2 GiB. No hubo despliegue de Alunza,
exposición pública del Ryzen ni nuevos recursos Azure en este incremento.

Quedan la presentación humana y revisión docente, la ampliación de cobertura
de recuperación con evaluación independiente y la medición integral de
latencia Azure. No se declara aceptación pedagógica general ni cierre
productivo de IMP-04.08. La ayuda reservada de presentación vence el
20/11/2026 a las 23:59 de Santiago; reiniciar no renueva esa vigencia.
