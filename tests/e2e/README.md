# Recorridos integrados de LAB — IMP-00.05, IMP-01 e IMP-02

## Perfil físico de ayuda `.13` — 18/11/2026

`node scripts/linux-vm-help-browser.mjs --manifest <archivo-privado>` ejecuta
`physical-help/help.cy.ts`: H01 fuente/ACK/reintento, H02 sin corpus y H03 fallo
de generación/recuperación/reintento. Se conecta al laboratorio físico ya
preparado; no arranca ni resemilla servicios. Usa seis SUBMIT, cuatro ayudas y
proveedores IA TEST. Está separado del inventario y launchers generales.
Se exigen tres casos aprobados, sin omisiones, y prueba SQL/VM de retiro.
[Preparación y cierre](../../docs/guides/validacion-local-ayuda-13.md),
[evidencia y límites](../../docs/work/IMP-04-ayuda-fisica-13.md).

## Inventario vigente y foco IMP-06.07 — 03/11/2026

El inventario actual compartido por ambos launchers contiene **125 casos / 18 specs**. Los conteos fechados de 95, 103 y anteriores conservan su corte histórico. `phase-context` mantiene exactamente sus **69 casos / 10 specs** y su orden; el foco nuevo no lo ejecuta.

`npm run test:e2e -- --governance-phase` exige seis casos `IMP06-PHASE-01`–`06`: evidencia/ayuda/revisión; gobierno/historia/CSV; rechazos/vacíos; permisos/revocación; concurrencia; recuperación y entrega privada. Cada caso crea su propio ámbito y correlaciona intentos HTTP/Docker reales, ayuda TEST entregada y señales realmente evaluadas. Los datos de capacidad se identifican por separado. La [matriz](../../docs/work/IMP-06-governance-phase-matrix.md) mantiene los 16 escenarios originales.

El informe `e2e-governance-phase.json` guarda candidato antes/después, instantes, ambiente, seis IDs/resultados y cobertura del inventario. Las capturas `imp06-governance-phase-{desktop,tablet,mobile}` se verifican a 1440×900, 768×1024 y 390×844. La igualdad visor/CSV se comprueba con escritores detenidos y filtros/corte comunes; la historia inmutable se separa de los deltas auditados esperados.

Ejecutar `npm run test:imp06:integration`, luego el foco Cypress y `npm run test:imp06:acceptance -- --since <ISO-UTC-del-inicio-del-ciclo>`, de forma serializada. El agregador exige fuentes idénticas y evidencia posterior al corte; no ejecuta CI. Con resultados funcionales aprobados y .04 pendiente, devuelve código **2** y aceptación bloqueada; evidencia incompleta/inválida o fallida devuelve **1**. El [registro](../../docs/work/IMP-06-governance-phase.md) acredita únicamente las ejecuciones que efectivamente terminen.

## Foco IMP-06.06 — Exportación de auditoría

`npm run test:e2e -- --audit-export` exige ocho casos `IMP06-AUDIT-EXPORT-01`–`08`: filtros aplicados/todas las páginas y CSV/JSON; vacío/hostiles; exceso; respuesta perdida y recarga idempotente; revocación/expiración; falla/entrega tardía/cambio de sesión; teclado/tres tamaños; primera navegación y 50 recorridos completos con 10.000 A/1.000 B, concurrencia uno, p95 <3000 ms. Auth/API/PostgreSQL y descarga de navegador son reales. Las fallas inducidas descartan o retrasan respuestas reales, sin fabricar éxitos.

Reportes `.local/reports/imp-06/e2e-audit-export.json`, `audit-export-ui-screenshots.json` y `audit-export-ui-performance.json`; capturas `imp06-audit-export-{desktop,tablet,mobile}`. El selector full suma estos ocho; `phase-context` mantiene exactamente sus 69 casos/diez specs. El [registro .06](../../docs/work/IMP-06-audit-export.md) distingue preparación de resultados realmente ejecutados. No ejecuta .04 ni .07 automáticamente.

## Foco IMP-06.05 — Auditoría

`npm run test:e2e -- --audit` ejecuta únicamente ocho casos `IMP06-AUDIT-01`–`08` con API/Auth/PostgreSQL reales en LAB TEST. Cubren filtros/corte/páginas, validación/vacío, permisos/revocación, archivo/inmutabilidad, respuesta tardía/caída API, teclado/tres tamaños, cambio de sesión y capacidad. El fixture funcional tiene 25 eventos A/11 B; capacidad 10.000 A/1.000 B, primera navegación separada y 50 muestras secuenciales, p95 <3000 ms.

Reportes: `.local/reports/imp-06/e2e-audit.json`, `audit-ui-screenshots.json` y `audit-ui-performance.json`. Capturas `imp06-audit-desktop/tablet/mobile` verifican 1440×900, 768×1024 y 390×844. El selector full incorpora el nuevo spec; el inventario congelado `phase-context` de .04 permanece en sus 69 casos/diez specs. No se ejecuta ese contexto ni CI integral como parte de .05. Ver [registro y límites](../../docs/work/IMP-06-audit-read.md).

**Corte histórico, 02/11/2026 (fecha cliente; `resumption-13`):** la captura
manual secuencial terminó con 24 muestras y controles de sesión/carga/limpieza
válidos. La única validación offline congelada rechazó el inventario:
`RAW_INVENTORY_MISMATCH`, dos ETL en staging frente a uno exigido. El RAW
esperado coincide; el archivo adicional de 262144 bytes queda por clasificar.
No se leyeron ETL ni se evaluó cobertura; no hubo repetición, descarte o
recaptura. El paso manual ya terminó. Sensor y cierre pendientes, B intacto;
**9/17 contextuales y 0/1 CI final**, sin nuevo E2E, ON/OFF, ABBA o CI.
Véase el [registro de cierre](../../docs/work/IMP-06-signal-review-closure.md).

**Corte histórico, 02/11/2026 (fecha cliente; `resumption-12`):** se preparó
un protocolo privado File/Sequential, con QUERY antes/después y retención del
RAW obligatorias para verificar la cobertura de las 24 muestras. Sus pruebas
focales y la preparación integrada sin captura aprobaron; la ejecución manual
elevada aún está pendiente por los privilegios de Windows. Se conservan los
límites y el déficit histórico de 1874,632 ms; no se atribuye su causa ni se
califica el sensor. No hubo nueva carga ni ejecución E2E, ON/OFF, ABBA o CI:
**9/17 contextuales y 0/1 CI final**. B y código ejecutable del producto intactos.
El [registro de cierre](../../docs/work/IMP-06-signal-review-closure.md) detalla
las pruebas, los hashes y la parada obligatoria ante falta de evidencia.

**Corte histórico, 02/11/2026 (fecha cliente; `resumption-11`):** el usuario
completó la captura manual ajena a E2E. Sus 24 lecturas, carga y limpieza
aprobaron, pero el ETL no cubre las consultas 0 y 1: el primer evento scheduler
es 1874,632 ms posterior al primer bracket. La lectura offline completa con
Microsoft TraceEvent fijado resolvió CSwitch v5 y confirmó esa falta de cobertura;
sus 62 aserciones focales no acreditan rendimiento ni CI. Se aplica la parada,
sin partición de estados, descarte de muestras ni recaptura. No se retomaron
ON/OFF o ABBA ni se ejecutó CI; siguen **9/17 contextuales y 0/1 CI final**,
con B y código ejecutable intactos. Véase el
[registro de cierre](../../docs/work/IMP-06-signal-review-closure.md).

**Corte histórico, 02/11/2026 (fecha cliente; `resumption-10`):** el diagnóstico
nativo validó **72 pares** y localizó la demora en la frontera de consulta,
sin calificar una corrección del sensor. No se retomó ON/OFF ni se ejecutaron
una nueva ABBA o CI. La autorización vigente mantiene **9/17** corridas
contextuales consumidas y **0/1** CI final. Se conserva B (`runnerUi: false`)
y el sensor anterior; TEST sigue detenido. WPR denegó la captura con
`0x80070005`, sin dejarla activa. El paquete manual elevado está preparado,
pero la captura ETL real y su análisis siguen pendientes de la acción del usuario.
Los cortes siguientes conservan su alcance histórico; véase el
[registro de cierre](../../docs/work/IMP-06-signal-review-closure.md).

**Contexto de cierre IMP-06.04, 01/11/2026:**
`npm run test:e2e -- --phase-context` ejecuta los diez specs completos desde
`academic.cy.ts` hasta `progress-phase.cy.ts`, en una sola invocación y con
orden/inventario verificados: **69 casos**. Su reporte es
`.local/reports/imp-06/e2e-phase-context.json`; no acredita los 103 casos completos.
`--phase-context --diagnostics` añade observación optativa exclusiva de TEST,
con reportes separados `phase-browser-diagnostics.json` y
`phase-context-diagnostics.json`. Mantiene reloj, primeras navegaciones, muestras,
carga y gates originales. La API rechaza el flag diagnóstico fuera de TEST.
El alcance vigente declara `diagnosticScope: 'dashboard+progress'`: cuatro perfiles,
tablero y progreso con concurrencias 1 y 4, cada uno con primera navegación
separada y 50 muestras. Los lectores conservan compatibilidad con reportes
históricos exclusivos del tablero; esa lectura no acredita observación de progreso.
La instrumentación está desactivada por defecto y requiere los flags de TEST
`ALUNZA_E2E_BUILD=1` y `ALUNZA_TEST_DASHBOARD_TIMINGS=1`. Conserva categorías de
ruta, identificadores técnicos de petición y tiempos; excluye URL completas,
queries, identidades, tokens y cuerpos. Separa superficie, perfil y relojes, y
califica pérdidas, correlación y coste del observador antes de interpretar datos.
Los comandos existentes y la CI conservan su inventario.

**Antecedentes hasta la quinta reanudación (histórico):** el
[registro de campaña](../../docs/work/IMP-06-signal-review-closure.md) conserva
las tres D_A anteriores; la última registró **68 PASS/1 FAIL/0 SKIP** y PHASE-07
p95 concurrente **3393 ms**. La corrección controlada `runnerUi: false` evita
dibujar el panel de Cypress durante las ejecuciones del launcher, conservando
las aserciones, medición, inventarios y reportes. Su regresión real aprobó en B.
La única D_B posterior aprobó **69/69**, 27 capturas y todos los gates:
PHASE-07 p95 serial/concurrente **1809,9/2428,1 ms**, con observación válida y
1070/1070 peticiones correlacionadas. Tras la parada anterior, una nueva
autorización fijó máximo **8** corridas contextuales globales. A1 se ejecutó sin
diagnóstico adicional y terminó **67 PASS/2 FAIL/0 SKIP/0 pendientes**. Los p95
serie/concurrencia 4 fueron **2213,7/4081,8 ms** en PHASE-07,
**1851,8/3110,1 ms** en PHASE-08 y **854,1/2701,7 ms** en PHASE-09. El fallo
adicional de PHASE-08 detuvo la campaña; su causa no está demostrada.
Fuentes y protocolo permanecieron congelados y se restauró B. El acumulado es
**5/8** contextuales consumidas, **1/4** corridas ABBA ejecutadas y **0** controles
ABBA conformes; **0/1** CI final. No se ejecutaron B1, B2 ni A2 y el cierre sigue
pendiente según el [registro de campaña](../../docs/work/IMP-06-signal-review-closure.md).

**Quinta reanudación, corte histórico del 01/11/2026 (Santiago):** la causa de
PHASE-08 seguía sin atribuirse; el diagnóstico de navegador de aquella etapa solo cubría el
tablero. No se añadió un cambio de rendimiento. La regresión aislada de B obtuvo
dictamen **PASS**, con **2 PASS/1 FAIL centinela**; no acredita una repetición de
los 69 casos contextuales ni de los 103 completos. No hubo campañas nuevas:
siguen **5/8** contextuales consumidas, **1/4** corridas ABBA ejecutadas (A1 rechazada),
**0** controles conformes y **0/1** CI final. Reiniciar ABBA exige cuatro corridas
con solo tres restantes: un mínimo de **9** contextuales globales, sin otras
corridas diagnósticas, excediendo el máximo entonces autorizado. A1 no se reutiliza ni se
cambian los criterios para aceptarla. El
[registro de cierre](../../docs/work/IMP-06-signal-review-closure.md) conserva la investigación
y esta limitación; el cierre integral permanece pendiente.

**Sexta reanudación, corte histórico tras la parada de ABBA_A1:** la autorización
amplió el máximo global a **11** corridas contextuales. D_A08 tuvo observación
calificada en los cuatro perfiles, **3664/3664** peticiones correlacionadas y
**67 PASS/2 FAIL**: p95 concurrente **4481,2 ms** en PHASE-07 y **3356,7 ms** en
PHASE-08. D_B08 aprobó **69/69**, con observación calificada, **2253/2253**
peticiones correlacionadas y p95 concurrente **2777,2/2016,1 ms**, respectivamente.
Cumplió la predicción registrada: reducción del **86,26 %** del intervalo medio
desde el inicio del cronómetro hasta el efecto de sesión y del **87,71 %** de
la unión media de tareas largas observadas en progreso concurrente. Estos
resultados instrumentados no acreditan el cierre causal final.

La siguiente ABBA_A1, sin diagnóstico, terminó **68 PASS/1 FAIL/0 SKIP/0 pendientes**:
PHASE-07 concurrente falló con **3962 ms**, mientras PHASE-08 aprobó con
**2828,3 ms**. No reprodujo los dos fallos previstos para el control A y fue
rechazada, aunque conservó los **69 casos**, las **27 capturas** y las fuentes
congeladas. La secuencia se detuvo; B1, B2, A2 y la CI final no se ejecutaron.
Se restauró B y se detuvo TEST. El acumulado es **8/11** contextuales,
**1/4** corridas de esta ABBA ejecutadas y **0** controles conformes, con
**0/1** CI final. El cierre integral y la atribución causal final siguen pendientes
según el [registro de cierre](../../docs/work/IMP-06-signal-review-closure.md).
Los cortes anteriores conservan sus resultados y límites históricos.

PHASE-08 conserva las tres capturas originales de éxito. Si falla exclusivamente
su aserción p95 concurrente final, el [guard de capturas](progress-phase-capture.mjs)
permite ejecutar esos mismos tres recorridos después del fallo, con medición
completa y error original coincidente. No modifica reloj, muestras, gate ni
estado fallido, ni añade navegación medida. Otros fallos no habilitan esta
recuperación. La calificación del guard aprobó **60/60** pruebas unitarias.
Los dictámenes automáticos de los focos Chrome privados v1 y v2 permanecen
**FAIL**: v1 detectó incompatibilidad con los campos de error serializados;
v2 recuperó las tres capturas, pero su extractor no pudo verificar el error con
los campos supuestos del Module API; el resultado bruto no se guardó.
El suplemento offline de v2 acredita
únicamente la recuperación funcional con **1 FAIL original**, un intento,
una navegación, tres capturas y hashes estables, mediante log, probe y evidencia
guardada. No reclasifica los FAIL, no reconstruye el resultado bruto ausente y
no constituye otra campaña contextual ni aceptación de rendimiento.

**Auditoría posterior, 02/11/2026 (fecha cliente; `resumption-07`):** se recalcularon
los **18 p95** de D_A08, D_B08 y A1, conservando fuentes, oráculos y gates.
No se identificó un error semántico ni se demostró una fuga. ON/OFF cambia también
el flag compilado y trabajo diagnóstico cuyo efecto indirecto no queda acotado
por el autocoste; A1 no dispone de telemetría interna equivalente. La reconstrucción
de progreso halló tres lectores concurrentes durante el **99,989 %** del intervalo
interior en A1 y el **99,986 %** en D_A08. Las **15/15** pruebas privadas de
reconstrucción y contraejemplos aprobaron: tres peticiones de 1 ms dentro de una
ventana larga no prueban carga sostenida, aunque satisfagan el validador parcial.
Los reportes reales cumplen la cota necesaria reconstruida; no acreditan alineación
exacta con cada ventana UI. Falta evidencia comparable que distinga el efecto
indirecto del diagnóstico de la variación entre ejecuciones. Esta auditoría no
cambió fuentes, medición ni expectativas y no añadió campañas: siguen **8/11**
contextuales y **0/1** CI final, con parada y cierre pendiente según el
[registro de cierre](../../docs/work/IMP-06-signal-review-closure.md).

**Diagnóstico nativo, corte vigente del 02/11/2026 (fecha cliente; `resumption-10`):**
los **72 pares** válidos —12 sin carga inducida y 60 bajo carga— localizaron la frontera
`nativeQuery`, que concentró el **99,8836 %** del tiempo agregado de las llamadas
lentas del probe. Esto no demuestra el mecanismo interno de espera o planificación
ni acredita un sensor corregido. La captura WPR fue denegada con `0x80070005`
y no quedó activa. Se preparó un paquete manual elevado para **24 lecturas bajo
12 workers**, separado de E2E y de las campañas contextuales, con intervalos QPC
del hilo propio y lector offline de eventos CSwitch/ReadyThread. El payload de
captura todavía no se ha ejecutado: la lectura de un ETL real permanece pendiente
hasta la acción del usuario. La compilación y las pruebas sintéticas de los helpers
no sustituyen esa verificación ni la calificación de rendimiento. No se ejecutaron
nuevas ON/OFF, ABBA o CI; siguen **9/17** contextuales y **0/1** CI final, con B
preservado y cierre técnico pendiente según el
[registro de cierre](../../docs/work/IMP-06-signal-review-closure.md).

**Calificación del sensor, corte histórico del 02/11/2026 (fecha cliente; `resumption-09`):** el
candidato de lectura nativa de contadores conservó la corrección verificada por
**693** pruebas de preproducción, **55** aserciones nativas, **12** comparaciones
de contadores y casos de fallo inducido. Esa evidencia no acredita su calificación
de rendimiento. La calificación formal, ajena a las campañas contextuales,
rechazó el candidato: su autocoste bajo carga fue **28,607 %**, frente al
**28,888 %** del sensor anterior, ambos por encima del máximo **1 %**. En reposo
registraron **0,0543 %** y **0,098 %**, respectivamente. La cobertura y el reloj
aprobaron, sin errores de observación; los cinco procesos cerraron y las fuentes
permanecieron congeladas durante la calificación. No se atribuye el tiempo
transcurrido a CPU de un proceso a partir de las métricas compartidas del host.

Se archivaron **17 archivos** del candidato rechazado en
`.local/evidence/imp-06-closure/resumption-09/rejected-candidate`, se restauraron
las dos integraciones anteriores y se retiraron los cinco archivos nuevos del
sensor. Se conservan las dos pruebas adicionales que exigen contabilizar todo el
tiempo de captura y distinguirlo del retraso del callback. No se ejecutaron otra
comparación ON/OFF, corridas contextuales, una nueva ABBA ni CI. El acumulado
sigue en **9/16** y **0/1** CI final; las A1 rechazadas no se reclasifican y el
cierre permanece pendiente según el
[registro de cierre](../../docs/work/IMP-06-signal-review-closure.md).

**Calibración ON/OFF, corte histórico del 02/11/2026 (fecha cliente; `resumption-08`):** la nueva
autorización fijó un máximo finito de **16** corridas contextuales, con **8** ya
consumidas, y la secuencia prospectiva **OFF–ON–ON–OFF** sobre A. Se calificaron
**80/80** pruebas privadas offline: **23** del validador, **25** del observador
del host y **32** del analizador. CAL_OFF1 conservó los **69 casos**, los seis
perfiles con primera navegación separada y 50 muestras, y las **27 capturas
requeridas** dentro de **41 PNG archivados**. Terminó **68 PASS/1 FAIL**:
PHASE-07 concurrente registró **4150,8 ms** y PHASE-08 aprobó con **2838,3 ms**.

La corrida se rechazó porque el observador común del host consumió
**3101,2385/152303 ms = 2,0362294 %** en la ventana del tablero, por encima del
máximo **1 %**; progreso y reglas registraron **0,815 %** y **0,692 %**.
Esta observación no permite atribuir una causa de rendimiento. Se detuvo la
secuencia sin ejecutar ON1, ON2, OFF2, una nueva ABBA ni CI. El analizador rechazó
la serie incompleta con `LEDGER_COUNTERS_INVALID` y no creó `comparison.json`.
Las fuentes ejecutables permanecieron intactas; B quedó restaurado y TEST
detenido. El acumulado es **9/16** contextuales y **0/1** CI final. A1 conserva
su rechazo histórico y el cierre técnico local sigue pendiente según el
[registro de cierre](../../docs/work/IMP-06-signal-review-closure.md).

La [regresión aislada del runner](../cypress-runner/run.mjs) se ejecuta con
`node --experimental-vm-modules tests/cypress-runner/run.mjs <reporte-nuevo.json>`.
Requiere el Node/Chrome/Cypress instalados y sirve HTML solo en localhost, sin
TEST/BD. Está fuera del inventario de 103 casos y no se ejecuta automáticamente
como parte de ellos. El dictamen externo solo aprueba con panel ausente,
viewport 1280 × 900, reintento efectivo y exactamente **2 PASS/1 FAIL centinela**
en Cypress; ese fallo deliberado no se silencia ni acredita rendimiento. Rechaza
errores adicionales, omisiones o falta de integridad de la fuente. Los comandos
de ejecución interactiva conservan su propia configuración.

**Ampliación IMP-06.04, 01/11/2026:** `signal-review.cy.ts` incorpora ocho
casos `IMP06-REVIEW-01`–`08`; la suite completa exige **103 casos**. El foco
`npm run test:e2e -- --signal-review` exige todos los casos y las capturas de
confirmación en escritorio, tableta y móvil con dimensiones verificadas.
Informe: `.local/reports/imp-06/e2e-signal-review.json`.

| Caso            | Comprobación                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| IMP06-REVIEW-01 | Cancelar/Escape sin PUT; confirmación desde tablero, auditoría y evidencia conservadas, actualización al presente. |
| IMP06-REVIEW-02 | Detalle estudiantil, doble clic, repetición idempotente y primera identidad/fecha conservadas.                     |
| IMP06-REVIEW-03 | Vista histórica anterior a una revisión concurrente; recuperación de primera revisión y cortes separados.          |
| IMP06-REVIEW-04 | Deshabilitar docente o estudiante antes de confirmar; rechazo y retiro del contenido protegido.                    |
| IMP06-REVIEW-05 | Descartar respuesta real posterior al commit; recuperación mediante consulta vigente sin otro PUT.                 |
| IMP06-REVIEW-06 | Caída real de API antes del envío, error controlado, consulta de recuperación y confirmación posterior.            |
| IMP06-REVIEW-07 | Teclado, Escape y retorno de foco; tres tamaños; señales de matrícula histórica/clase archivada solo consultables. |
| IMP06-REVIEW-08 | Primera confirmación y 50 episodios nuevos por perfil, serial y bajo tres clientes de PUT idempotente.             |

El fixture conserva los datos canónicos y el evaluador de señales del tablero:
un SUBMIT Docker y cuatro resultados de capacidad explícitos por escenario
funcional. Para rendimiento utiliza resultados de capacidad y episodios
realmente evaluados; no acredita ejecuciones Docker masivas. El perfil UI mide
confirmación hasta REVIEWED renderizado y dos frames, con primera muestra
del perfil separada y 50 episodios distintos por perfil. Los servicios ya están
iniciados; esa primera muestra no mide un arranque frío. La carga cuatro significa un
Chrome y tres clientes de revisión idempotente sobre episodios separados,
no cuatro navegadores. Conserva IDs, errores, huella del candidato y p95
nearest-rank <3000 ms en `signal-review-ui-performance.json`. La preparación
de cada lote queda fuera de las muestras. Este inventario no acredita ejecución.

**Ampliación IMP-06.03, 27/10/2026:** `student-detail.cy.ts` incorpora siete
casos `IMP06-DETAIL-01`–`07`; la suite completa exige **95 casos**. El foco
`npm run test:e2e -- --student-detail` se integra en ambos launchers y exige
los siete casos aprobados, sin omisiones, y tres capturas con dimensiones
comprobadas. Informe: `.local/reports/imp-06/e2e-student-detail.json`.

| Caso            | Comprobación                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| IMP06-DETAIL-01 | Tablero → identidad/clase/progreso 1/3 → intento Docker, diagnóstico/fecha, ayuda/fuente y señal; snapshot sin mutación ni ACK. |
| IMP06-DETAIL-02 | Filtros y corte con microsegundos, retorno con cursor exacto, siete intentos en páginas de dos, errores y vacío.                |
| IMP06-DETAIL-03 | Roles/clase ajenos, retirada de código y ayuda visibles tras revocación; respuesta tardía descartada al cambiar filtros.        |
| IMP06-DETAIL-04 | Ayuda preparada y presentada sin ACK excluidas; corte de entrega y fuente retirada.                                             |
| IMP06-DETAIL-05 | Error 503 controlado de ayuda y caída real de API, intento conservado y recuperación.                                           |
| IMP06-DETAIL-06 | Teclado, descarga de fuente inline, Escape/restauración de foco en diálogos y capturas con contenido abierto en tres tamaños.   |
| IMP06-DETAIL-07 | Detalle listo: primera navegación separada y 50 muestras seriales más 50 con tres lectores HTTP.                                |

El fixture reutiliza cinco intentos del tablero: uno ejecutado por Docker y
cuatro resultados deterministas de capacidad explícitos. Añade dos envíos
Docker en la clase y uno de la misma persona en otra clase, manteniendo un
segundo alumno sin evidencia. La ayuda usa ingestión/Storage, generación TEST,
persistencia, presentación y ACK estudiantil reales; no acredita Azure.
Los snapshots incluyen código/resultados, pruebas/conceptos, ayuda y
`presented_at`, eventos, llamadas/recibos IA y episodios/revisiones de señales.
La preparación usa rutas anteriores a .03 para permitir el ensayo de upgrade.
Antes de generar sus cuatro ayudas, consulta el límite global del alumno y
espera hasta 65 segundos por capacidad real, con sondeo máximo de un segundo.
No altera fechas, cuotas ni datos anteriores; la tarea tiene un límite explícito
de 180 segundos y esta preparación queda fuera de las muestras de rendimiento.

`student-detail-performance.mjs` mide las nueve superficies HTTP con primera
petición/grupo separado de 50 muestras seriales y 50 a concurrencia cuatro.
La UI usa un Chrome más tres lectores HTTP sostenidos; no representa cuatro
navegadores. Cada perfil conserva errores y muestras, exige p95 <3000 ms y
no descarta fallas. Este inventario describe cobertura; no acredita ejecución.

**Ampliación IMP-06.02, 27/10/2026:** `exercise-bank-governance.cy.ts`
añade cinco casos `IMP06-GOV-01`–`05`; la suite completa exige **88 casos**.
`npm run test:e2e -- --bank-governance` usa Auth/API/PostgreSQL y SUBMIT Docker
reales de LAB TEST. El informe es `.local/reports/imp-06/e2e-bank-governance.json`.

| Caso         | Comprobación                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| IMP06-GOV-01 | Cancelación de gobierno/archivo sin petición, confirmación, auditoría, teclado/foco y tres tamaños de diálogo.                 |
| IMP06-GOV-02 | Nueva versión ADMIN, rechazo de tests contradictorios, archivo e intento real preservado con versiones/pruebas/conceptos/usos. |
| IMP06-GOV-03 | Conflicto ETag real, selección conservada y nueva revisión explícita.                                                          |
| IMP06-GOV-04 | Respuesta descartada después del commit y reconciliación con la misma clave/payload; una auditoría.                            |
| IMP06-GOV-05 | Revocación real entre revisar y confirmar; rechazo sin mutación y retirada de datos.                                           |

El fixture adicional crea ámbitos aislados sin alterar la demo canónica;
el snapshot usa IDs iniciales fijos y comparación independiente. El test HTTP
complementa fallo de auditoría y rollback con un trigger temporal limitado a
la organización recién creada, retirado al finalizar. Los escenarios de
transporte manipulan únicamente entrega de respuesta: la persistencia es real.
Este inventario no acredita ejecución; véase el [registro .02](../../docs/work/IMP-06-bank-governance.md).

**Ampliación IMP-06.01, 26/10/2026:** `exercise-bank.cy.ts` incorpora ocho
casos `IMP06-BANK-01`–`08`; el inventario completo exige **83 casos**. El foco
`npm run test:e2e -- --bank` usa Auth, NestJS y PostgreSQL/RLS reales de LAB
TEST. Escribe `.local/reports/imp-06/e2e-bank.json`; este inventario no
acredita una ejecución aprobada.

| Caso          | Comprobación                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| IMP06-BANK-01 | 25 ejercicios, paginación y conteo total; filtros combinados, reinicio de cursor, archivo y vacío.                          |
| IMP06-BANK-02 | 25 versiones y 25 asignaciones; versión actual visible fuera de la página histórica, filtros de usos y huellas sin cambios. |
| IMP06-BANK-03 | Profesor, estudiante y administrador ajeno rechazados; revocación retira lista y detalle con JWT previo.                    |
| IMP06-BANK-04 | Propietario deshabilitado identificable; organización, clase y ejercicio archivados conservan consulta administrativa.      |
| IMP06-BANK-05 | Respuesta real tardía descartada, caída real de API diferenciada de vacío y recuperación.                                   |
| IMP06-BANK-06 | Teclado nativo, retorno de foco, desplazamiento horizontal y seis capturas de lista/detalle en tres tamaños.                |
| IMP06-BANK-07 | Lista: primera navegación separada y 50 muestras calientes, p95 <3000 ms.                                                   |
| IMP06-BANK-08 | Detalle con historial/usos: navegación desde el banco, primera separada y 50 muestras calientes, p95 <3000 ms.              |

`exercise-bank-fixture.mjs` crea una organización adicional por escenario sin
modificar el seed canónico. Usa 25 ejercicios, 25 versiones del ejercicio
principal y 25 asignaciones en 24 actividades: dos versiones distintas en la
misma actividad cuentan como dos usos. Antes del archivo hay 9 usos DRAFT,
8 PUBLISHED y 8 CLOSED. El fixture histórico cierra las actividades publicadas
antes de archivar la clase; conserva 9 DRAFT y 16 CLOSED. No desactiva triggers
ni presenta esta preparación privilegiada como operación pública de archivo.
La taxonomía avanza a v2; los ejercicios conservan sus enlaces a v1.

El arnés compartido `createExerciseBankHarness` permite a las pruebas HTTP
reutilizar estos datos y sesiones exclusivamente en Node. El navegador recibe
IDs, oráculos y sus sesiones ficticias de usuario, sin claves administrativas.
Las lecturas se comparan mediante huellas de ejercicios, versiones, relaciones,
actividades y auditoría del ámbito creado. Los datos aislados quedan bajo el
ciclo de vida de LAB TEST; `close()` no borra registros ni toca otros ámbitos.

Los perfiles UI guardan `exercise-bank-ui-list.json` y
`exercise-bank-ui-detail.json`, con muestras completas y fallos, primera
navegación separada, concurrencia uno y percentil nearest-rank. El recorrido
de detalle incluye abrir el banco y seleccionar el ejercicio, hasta que
resumen, versiones y usos estén listos. No representa arranque frío de
servicios ni rendimiento remoto. Las seis capturas `imp06-bank-{desktop,tablet,mobile}-{list,detail}`
usan 1440×900, 768×1024 y 390×844; el arnés comprueba dimensiones reales del PNG
y exige todas para completar la suite. El foco las guarda en
`.local/evidence/imp-06/screenshots`; una ejecución completa conserva el
directorio compartido `.local/evidence/imp-05/screenshots`. No acredita WCAG
completa ni aceptación humana.

**Ampliación IMP-05.08, 26/10/2026:** `progress-phase.cy.ts` añade nueve casos
`IMP05-PHASE-01`–`09`; el inventario completo exige **75 casos**. El foco
`npm run test:e2e -- --phase` utiliza los mismos servicios reales de LAB TEST
y produce `.local/reports/imp-05/e2e-phase.json`. El estado ejecutado y sus
límites se registran en [aceptación transversal](../../docs/work/IMP-05-acceptance.md)
y [matriz E/SIG](../../docs/work/IMP-05-acceptance-matrix.md).

| Caso           | Comprobación                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| IMP05-PHASE-01 | ADMIN activa regla → motor persiste → docente consulta causa → estudiante conserva progreso; mismos hechos al corte. |
| IMP05-PHASE-02 | Páginas de estudiantes/evidencia, filtros combinados, reinicio de cursor y corte consistente.                        |
| IMP05-PHASE-03 | Paginación de señales, intentos personales y versiones de reglas con más de una página real.                         |
| IMP05-PHASE-04 | Sin evaluación, pendiente, fallido, NO_MATCH comprobado y evidencia no disponible.                                   |
| IMP05-PHASE-05 | Respuestas reales demoradas, cambio de filtro y sesión; revocación retira datos.                                     |
| IMP05-PHASE-06 | Teclado real Tab/Shift+Tab/Escape, foco de diálogo y retorno, desplazamiento de tabla móvil; 18 capturas.            |
| IMP05-PHASE-07 | Tablero: primera navegación separada, 50 muestras calientes y 50 con tres lectores HTTP adicionales.                 |
| IMP05-PHASE-08 | Progreso personal: mismos dos perfiles y páginas reales.                                                             |
| IMP05-PHASE-09 | Consulta de reglas: mismos dos perfiles y páginas reales.                                                            |

`progress-phase-fixture.mjs` crea ámbitos adicionales aislados. Su perfil de
capacidad contiene 60 estudiantes activos, dos actividades con tres requeridos,
360 obligaciones, un logro, 201 intentos (51 del estudiante consultado), 51
episodios y 51 versiones de reglas. Los resultados de capacidad se preparan con
admisión, staging tipado y finalización canónicas; no representan 201 ejecuciones
Docker. Los episodios pasan por el procesador real. El perfil puente sí conserva
SUBMIT Docker y HELP TEST real. La demo canónica no cambia.

Las capturas `imp05-phase-{desktop,tablet,mobile}-{signals,signal-detail,evidence,table-right,rules,progress}`
exigen 1440×900, 768×1024 y 390×844 y comprobación del tamaño real de cada PNG.
`phase-ui-screenshots.json` y el resumen E2E fallan si falta una captura o sus
dimensiones son incorrectas. Las vistas muestran datos ficticios poblados.

`npm run test:imp05:performance` mide las tres APIs con páginas de 50 y segunda
página real: 50 muestras calientes secuenciales y 50 a concurrencia cuatro por
superficie; primeras peticiones después de reiniciar API se conservan aparte.
La UI conserva primeras navegaciones y 50+50 muestras por superficie, con un
Chrome y tres lectores HTTP durante carga cuatro. No son cuatro navegadores.
Los informes `phase-api-performance.json` y `phase-ui-performance.json` conservan
muestras completas, errores, huella del candidato y percentil nearest-rank.
Exigen cero errores y p95 <3000 ms; no modificar fuentes ni documentación durante
el perfil. Son mediciones locales, no acreditación de rendimiento remoto.

**Ampliación IMP-05.07, 26/10/2026:** `dashboard.cy.ts` añade ocho casos
`IMP05-DASH-01`–`08`; el inventario completo contiene **66 casos**.
`npm run test:e2e -- --dashboard` ejecuta el foco con servicios reales de LAB
TEST y guarda `.local/reports/imp-05/e2e-dashboard.json`. La presencia de este
inventario no acredita ejecución aprobada.

| Caso          | Comprobación                                                                  |
| ------------- | ----------------------------------------------------------------------------- |
| IMP05-DASH-01 | Oráculo de clase, conceptos, filtros y evidencia; incluye SUBMIT Docker real. |
| IMP05-DASH-02 | Período/corte, validación, vacío y recuperación del conjunto actual.          |
| IMP05-DASH-03 | Tipos de señales, revisión histórica y ACTIVE con acumulación interrumpida.   |
| IMP05-DASH-04 | Alternancia de roles y revocación de permisos retiran evidencia.              |
| IMP05-DASH-05 | Caída real de API diferenciada de cero y recuperación.                        |
| IMP05-DASH-06 | Lectura de fallback y pista entregada con ACK real deduplicado.               |
| IMP05-DASH-07 | Progreso personal con intentos fallidos y logro previo acumulado.             |
| IMP05-DASH-08 | Teclado, tres tamaños de pantalla y medición de navegación.                   |

El fixture Node crea ámbitos ficticios adicionales aislados, sin alterar los
conteos del seed canónico. Los resultados canónicos preparados para fronteras
se identifican como fixtures; el puente de repetición/estancamiento ejecuta el
motor real y la inactividad de siete días usa historia sintética explícita.
La revisión se prepara mediante el helper TEST existente, sin publicar una
acción docente de RF-019. Los secretos permanecen en Node; el navegador usa
sesiones ficticias y las rutas públicas autorizadas.

Las capturas `imp05-dashboard-desktop/tablet/mobile` conservan las dimensiones
1440×900, 768×1024 y 390×844. El arnés verifica el tamaño real del PNG y registra
`dashboard-ui-screenshots.json`. La medición UI conserva la primera navegación
separada y 50 siguientes por perfil: secuencial, y un navegador con tres
clientes HTTP adicionales concurrentes. Este segundo perfil no representa
cuatro navegadores. El perfil API independiente conserva 50 muestras
secuenciales y 50 a concurrencia cuatro, además de muestras frías separadas;
se ejecuta con `npm run test:dashboard:performance`. Estos perfiles locales no acreditan
rendimiento remoto ni conformidad WCAG completa.

**Ampliación IMP-05.06, 25/10/2026:** `signal-rules.cy.ts` incorpora nueve
casos `IMP05-RULES-01`–`09`; el inventario completo pasa a **58 casos**.
`npm run test:e2e -- --rules` ejecuta exclusivamente esos nueve casos con
Auth, NestJS y PostgreSQL reales de LAB TEST. El resultado se escribe en
`.local/reports/imp-05/e2e-rules.json`; este inventario no acredita una ejecución
aprobada, cuyo resultado registra el informe del candidato.

| Caso           | Recorrido y comprobación                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IMP05-RULES-01 | Crear/activar tres tipos, cancelar, reemplazar versión y conservar historia, autores, vigencias y auditoría.                                                  |
| IMP05-RULES-02 | Validar vacíos, negativos, fracciones, conteo insuficiente y exceso int4; corregir sin perder formulario ni vigente.                                          |
| IMP05-RULES-03 | Denegar profesor, estudiante y ADMIN ajeno; organización archivada conserva lectura administrativa.                                                           |
| IMP05-RULES-04 | Otro administrador activa primero; conflicto obliga a recargar y confirmar otra vez con expectativa nueva.                                                    |
| IMP05-RULES-05 | Interrumpir la entrega de respuestas después del commit real, refrescar permisos y recargar; misma clave/payload y consulta de vigente tras replay histórico. |
| IMP05-RULES-06 | Historial de 105 versiones: efectiva fuera de primera página, paginación y reinicio de filtro.                                                                |
| IMP05-RULES-07 | Caída real de API distinta de falta de configuración; fallo de almacenamiento local impide enviar mutación.                                                   |
| IMP05-RULES-08 | Activación por UI → motor real → episodio con regla nueva, revisión/historia y tres intentos originales intactos.                                             |
| IMP05-RULES-09 | Pantalla con 105 versiones, primera navegación separada y 50 siguientes con servicios ya iniciados; teclado y tres tamaños de pantalla.                       |

`signal-rules-fixture.mjs` mantiene un registro Node de los ámbitos ficticios
creados por esa corrida y rechaza otros destinos. Prepara versiones mediante
las RPC reales bajo `alunza_app`; el puente de señales confirma tres SUBMIT
por API/Docker, procesa con el motor existente y usa la función de revisión
exclusiva de TEST. El navegador recibe solo configuración y resultados
booleanos/conteos de verificación, nunca credenciales administrativas, código
ni evidencia pedagógica individual. No habilita endpoints nuevos de prueba en
la aplicación.

Los casos 02/04 disparan programáticamente el control existente de actualizar
acceso mientras el diálogo permanece abierto y esperan el GET `/me` real.
Verifican conservación del formulario y de la expectativa CAS durante
revalidación; no acreditan un clic físico detrás del diálogo ni una renovación
real de token de Auth.
El caso 05 sí fuerza la renovación real usando el patrón de SUBMIT: cambia
solo `expires_at` local, conserva el refresh token y dispara la comprobación
de visibilidad del SDK. Exige HTTP 200 del intercambio Auth y del GET `/me`,
con pendiente conservado; después recarga y reconcilia con la clave original.

La prueba de entrega perdida modifica a 503 únicamente una respuesta real ya
confirmada por el servidor. El replay llega al servicio real; no se sustituye
una respuesta exitosa. El patrón está documentado en
[interceptar respuestas reales](https://docs.cypress.io/api/commands/intercept).

El perfil UI conserva muestras y p95 nearest-rank en
`.local/reports/imp-05/rules-ui-performance.json` y una copia por ejecución en
`.local/reports/imp-05/history`, mediante el escritor estándar de informes.
Mide navegación autenticada
hasta parámetros e historial listos, con concurrencia uno; no equivale al
perfil API de concurrencia cuatro ni al rendimiento remoto. Un error impide
declarar completo el perfil.
`firstNavigationMs` es la primera navegación del caso, con servicios ya
iniciados; no representa un arranque frío de los servicios.

Se toman tres capturas explícitas de datos ficticios a 1440×900, 768×1024 y
390×844, dentro de `.local/evidence/imp-05/screenshots`, para revisión visual.
La [ventana nativa de Chrome headless](https://docs.cypress.io/api/node-events/browser-launch-api)
se amplía a 1920×1440 con escala uno para alojar los viewports sin recortarlos.
El caso comprueba dimensiones DOM y ausencia de desbordamiento horizontal;
el [evento posterior a la captura](https://docs.cypress.io/api/node-events/after-screenshot-api)
verifica las dimensiones reales del PNG y falla si no coinciden. Las registra
en `rules-ui-screenshots.json` y su historial dentro del directorio de informes.
Se mantiene desactivada la captura automática de fallos y el video. Las
[capturas de viewport](https://docs.cypress.io/api/commands/screenshot) y las
aserciones de teclado/etiquetas no certifican por sí solas WCAG 2.2 AA.

**Actualización IMP-05.01–05.02, 02/10/2026:** el arnés completo incluye ahora
49 casos exigidos: FND, IMP01, IMP02, IMP03, IMP04 e IMP05. La ejecución dirigida
`npm run test:e2e -- --progress` exige exactamente IMP05-01–IMP05-04, sin omisiones:
filtros/evidencia, corte/recuperación, permisos y aperturas explícitas deduplicadas.
Su informe está en `.local/reports/imp-05/e2e-progress.json`; el completo conserva
el informe histórico y añade `.local/reports/imp-05/e2e.json`. Ambos prueban
servicios locales reales y no acreditan integración Azure/Sandbox ni WCAG completa.

`npm run test:e2e` prepara servicios locales aislados del laboratorio y ejecuta `foundation.cy.ts`, `identity.cy.ts` y `academic.cy.ts` con Cypress 16.0.0. Conserva los ocho casos FND y añade ocho recorridos institucionales y ocho de contenido/editor. Sus resultados no equivalen a aceptación humana ni despliegue remoto.

| Entorno  | Proyecto Supabase             | Web / API       | Auth / PostgreSQL / correo  |
| -------- | ----------------------------- | --------------- | --------------------------- |
| LAB DEV  | `alunza-edu-laboratorio`      | `3200` / `4200` | `17421` / `17422` / `17424` |
| LAB TEST | `alunza-edu-laboratorio-test` | `3300` / `4300` | `18421` / `18422` / `18424` |

El arnés usa `.local/lab-integration-workspace`. Los archivos de estado y reportes históricos de otros proyectos no autorizan su uso como destino. Las guardas comprueban el proyecto exacto, Auth y la URL PostgreSQL completa antes de conectar; rechazan DEV, servicios originales y overrides de conexión. `local-isolation.test.cjs` verifica contextos, configuración Supabase DEV/TEST y puertos publicados de Compose sin iniciar servicios.

| Caso      | Resultado esperado                                                                             |
| --------- | ---------------------------------------------------------------------------------------------- |
| FND-01    | Estado web y rutas live/ready disponibles                                                      |
| FND-02–04 | Administrador, profesor y estudiante: login real, organización A, sesión tras recarga y logout |
| FND-05    | Credenciales incorrectas rechazadas sin vista privada                                          |
| FND-06    | Organización B y UUID inexistente producen 404 indistinguibles, sin datos ajenos               |
| FND-07    | Caída real de API retira perfil/organización; reintento recupera datos autorizados             |
| FND-08    | Estado informa API inaccesible y se recupera al comprobar otra vez                             |

El script orquestador proporciona `ALUNZA_TEST_STATE`, `ALUNZA_TEST_API_URL`, `ALUNZA_E2E_CONTROL_URL` y `ALUNZA_E2E_CONTROL_KEY` al proceso Node. La configuración solo acepta web `127.0.0.1:3300`, API `127.0.0.1:4300` y Auth `127.0.0.1:18421` del proyecto `alunza-edu-laboratorio-test`. Las tareas usan POST `/api/stop` y `/api/start`, autenticados con `x-alunza-e2e-key`; esperan `{ok:true}` después de completar la operación. `afterEach` restaura la API incluso si una aserción falla. El orquestador conserva responsabilidad sobre arranque y limpieza final de procesos.

La contraseña ficticia llega al test mediante `cy.env()` y se utiliza directamente dentro del callback con logging deshabilitado. No se incluyen credenciales administrativas en la configuración del navegador. La API nueva reemplaza `Cypress.env()`, eliminado en la versión 16. [Referencia oficial de cy.env](https://docs.cypress.io/api/commands/env)

El intercept de soporte solo desactiva el log de XHR/fetch; no define cuerpos, estados ni respuestas exitosas simuladas. [Supresión de logs documentada](https://docs.cypress.io/api/commands/intercept#Disabling-logs-for-a-request)

Video y screenshots automáticos están deshabilitados. El hook Node `after:run` escribe `.local/reports/imp-01/e2e.json` con IDs estáticos, estados, conteos y duración, sin el objeto completo de ejecución, errores ni stacks. Un fallo anterior al hook debe ser registrado como error de infraestructura por el orquestador. [Evento after:run](https://docs.cypress.io/api/node-events/after-run-api)

La comprobación de tipos usa `tsc --project tests/e2e/tsconfig.json`; sus tipos Cypress/Mocha permanecen separados de Jest. No se usan esperas fijas, Cypress Cloud, `cy.prompt`, snapshots de sesión ni aprobaciones académicas implícitas.
