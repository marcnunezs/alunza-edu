# IMP-06.04 — campaña de cierre técnico local

**Diagnóstico offline del 03/11/2026 (`resumption-15`):** el [ciclo autorizado](IMP-06-governance-phase-plan.md) permitió un catálogo acotado del ETL secundario. Tras 10 aserciones nativas y 49 de protocolo aprobadas, una única lectura de cabeceras encontró cinco eventos, dos proveedores y cinco formas en 41,5 ms, con 1.511 bytes de salida y pérdidas declaradas cero. Se preservaron 13.676 archivos previos (516.783.488 bytes), ambos ETL y los paquetes congelados. La preparación v1 falló antes de compilar o leer ETL; v2 corrigió la comprobación de la dependencia Node externa al inventario, con ambas versiones conservadas.

Resultado: **HOLD_UNRESOLVED_SECONDARY_ETL**. Las fuentes oficiales fijadas permiten identificar parcialmente EventTrace y PerfInfo/Mark, pero no acreditan productor ni papel completo; opcode 80 permanece sin mapping aceptado. No se abrió el principal: cero pases nativos y administrados, cobertura sin evaluar. No se excluyó el secundario, se cambió el guard ni se repitió el lector congelado. Manifiesto final privado SHA-256 `f38228da53db1845ca7aebf47d713546c0b27301d1caa79e99352dab9704cd34`; evidencia en `.local/evidence/imp-06-closure/resumption-15/`.

Permanecen **9/17 contextuales y 0/1 CI final**, sensor y cierre pendientes. No hubo capturas, carga, PHASE, ON/OFF ni ABBA nuevos. La verificación funcional .07 continúa separadamente según su [registro](IMP-06-governance-phase.md); no acredita cierre .04. Antes de otra lectura condicionada falta procedencia independiente y mapping completo del catálogo ya conservado.

**Diagnóstico offline acotado del 02/11/2026 (`resumption-14`):** autorización posterior limitada a clasificación de inventario/cabeceras, separada de CSV. Se verificó integridad de 13.654 artefactos previos (513.009.164 bytes), con dos OpenTraceW→CloseTrace, cero ProcessTrace/TDH/payloads y cero reintentos. El principal declara 737 buffers de 64 KiB y 25.561,0131 ms; el adicional declara dos buffers de 128 KiB, dura 3,8435 ms e inicia 12,5693 ms después del fin principal. Ambas cabeceras declaran pérdidas cero, sin demostrar cobertura de eventos. El controlador declara solo el path consultado y no enumera staging, lo que explica el desacuerdo del inventario, no el productor del archivo.

Resultado: **procedencia inconclusa**. La posición temporal es compatible con tareas de stop/merge, pero no prueba proveedor, contenido o inocuidad. La propuesta privada v2 conserva `HOLD_UNRESOLVED_SECONDARY_ETL`; no se ejecutó el lector congelado, no se excluyó el archivo ni se aceptó el inventario revisado. Evidencia y hashes en `.local/evidence/imp-06-closure/resumption-14/`. Permanecen `RAW_INVENTORY_MISMATCH`, sensor/cierre pendientes, **9/17 y 0/1 CI final**; sin captura, carga, PHASE, ON/OFF ni ABBA nuevos.

Plan autorizado por el usuario el 01/11/2026. Complementa el
[registro de revisión](IMP-06-signal-review.md); no sustituye sus fallos históricos.
Aplica a RF-016/018/019, RNF-REN-01 y a las fronteras de sesión, autorización,
aislamiento y pruebas de las guías del repositorio. No inicia IMP-06.05–.07.

**Corte histórico tras la decimotercera reanudación (02/11/2026): cierre pendiente.**
El usuario completó la única captura secuencial manual. Se conservaron el RAW
esperado y las 24 muestras; controles de sesión, carga, hashes y limpieza
aprobaron. La validación offline congelada se detuvo con
`RAW_INVENTORY_MISMATCH`: staging contiene dos ETL y el contrato exige uno.
El archivo esperado coincide exactamente; el segundo mide 262144 bytes y
su nombre contiene `WPRC_Internal_Collector`. Su origen y significado aún
no están demostrados; no se excluye ni elimina.

El rechazo ocurrió antes de invocar los lectores ETL: **cobertura no evaluada**,
sin partición de estados, modificación de guardas, repetición o recaptura.
El paso manual del usuario está completo y no se pide otra captura.
Sensor y cierre pendientes; **9/17 campañas y 0/1 CI final**, con B intacto.
El siguiente trabajo es clasificar el archivo adicional mediante evidencia
de origen y metadatos antes de definir un protocolo offline revisado.

**Corte histórico tras la duodécima reanudación (02/11/2026): cierre pendiente.**
El usuario autorizó continuar con el siguiente trabajo. Se preparó y verificó
un protocolo privado de captura **File/Sequential**, con consultas de la sesión
antes y después de la carga y conservación obligatoria del archivo original.
Las pruebas focales y la preparación real sin captura aprobaron. La adquisición
real aún no se ejecutó: requiere una única ejecución manual elevada por los
privilegios que Windows exige para WPR. No se solicita una autorización nueva.

Se conservan las 24 muestras, 12 trabajadores, buffers de 64 KiB × 512 y guard
de 45 s. No se descarta el déficit histórico de 1874,632 ms ni se atribuye su
causa a una sobrescritura no demostrada. La retención y cobertura del nuevo
protocolo deben aprobar empíricamente antes de reconstruir estados. El sensor
sigue sin calificar; no hubo nueva carga, ON/OFF, ABBA, contextual ni CI.
**9/17 campañas y 0/1 CI final**, B y código ejecutable del producto intactos.

**Corte histórico tras la undécima reanudación (02/11/2026): cierre pendiente.**
El usuario completó la captura manual con PowerShell 7 elevado; las 24 muestras,
la carga y la limpieza aprobaron sus controles. Se resolvió la incompatibilidad
del lector con CSwitch v5 mediante Microsoft TraceEvent fijado y verificado.
La lectura completa demuestra **cobertura insuficiente**: el primer evento
scheduler comienza **1874,632 ms después** del primer bracket y las consultas
0 y 1 quedan íntegramente fuera del intervalo cubierto por esos eventos.
Se aplica la parada: no se reconstruyen estados ni descartan muestras, y no
se repite la captura. Sensor sin calificar, causa de PHASE-08 y cierre pendientes;
**9/17 campañas y 0/1 CI final**, sin nuevas campañas ni CI; el análisis no
añadió carga.
Código ejecutable y B permanecen intactos. El paso manual del usuario terminó.

**Corte histórico tras la décima reanudación (02/11/2026): cierre pendiente.**
El usuario autorizó continuar y ampliar el máximo a **17** campañas. Un único
diagnóstico acotado localizó **99,8836%** del tiempo de 46 llamadas lentas en
`NtQuerySystemInformation(8)`, sin distinguir todavía ejecución de espera.
El lector anterior conserva un autocoste de **16,057%** bajo esa carga;
no se propuso ni activó otra corrección sin causa demostrada. Windows denegó
la captura ETW con **`0x80070005`** y la instancia quedó inactiva.
Se preparó y verificó un comando privado de captura que requiere una acción
manual con permisos de administrador; aún no existe un ETL real validado.
No se calificó el sensor ni se retomó ON/OFF: **9/17 y 0/1 CI final**,
sin nuevas campañas contextuales, ABBA o CI. B del reporter y el código
activo permanecen intactos; se conservan todos los rechazos históricos.

## Candidato y protocolo

La referencia preserva DASH-03 corregido y todos los cambios anteriores. Antes
de editar se guardaron 774 hashes y 732 archivos de fuentes/documentación en
`.local/evidence/imp-06-closure/origin/`. La huella completa es
`28e0bb0ab598237c4394d0b6e526abbcb4ad99feea22915440673362797f695a`;
HEAD es `75708ceecf2ca755bd32fb4b04e77bcb8de310f4` y el árbol contiene cambios
previos sin commit. Los documentos Office se preservan sin modificación.

El candidato A de la campaña incorpora el arnés y la instrumentación optativa,
sin optimizaciones de producto. La huella de A se capturará tras verificar el
instrumental. La referencia anterior no equivale a A instrumentado. Cada corrida
congela código y documentos, registra huellas antes/después y conserva reportes
y fallos. Los archivos generados `apps/web/next-env.d.ts` y
`packages/contracts/openapi.json` se excluyen de la huella de fuentes; la huella
completa declara sus exclusiones por separado. No se hacen resets ni limpiezas
de cambios ajenos. TEST usa su lock exclusivo habitual.

| Etapa   | Comando/condición de avance                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| D_A     | `npm run test:e2e -- --phase-context --diagnostics`; reproducir PHASE-07, validar observación y localizar un mecanismo comprobable.              |
| B       | Registrar predicción y una sola corrección mínima; regresión que falle en A y apruebe en B.                                                      |
| D_B     | Mismo comando instrumentado; confirmar predicción y controles.                                                                                   |
| A/B/B/A | Cuatro `npm run test:e2e -- --phase-context` sin observación adicional; ambos A deben fallar como se predijo y ambos B aprobar 69 casos y gates. |
| CI B    | Una `npm run ci:verify` con diagnóstico desactivado y candidato congelado, incluida preparación de ayuda; 17/17 en una sola corrida.             |

El máximo original fue seis corridas contextuales y una CI final. El usuario
amplió después el máximo contextual a ocho, sin reiniciar el contador; la
cuarta reanudación al final de este registro conserva esa autorización y su parada.
La sexta reanudación registra la nueva ampliación autorizada a once, sin
reiniciar el contador ni eliminar condiciones de parada.
Si D_A no
reproduce o no permite explicar el mecanismo, la observación no es comparable,
B incumple la predicción, fallan los controles A/B o la CI, se detiene la
campaña y queda pendiente el cierre. No se repite hasta obtener verde.

## Contexto y medición preservados

Una sola invocación de Cypress ejecuta, en orden comprobado, los diez specs
completos: academic, dashboard, exercise-bank-governance, exercise-bank,
foundation, help, identity, materials, practice y progress-phase. Son 69 casos;
sus reportes propios no acreditan los 103 del E2E completo. Los modos anteriores
y la CI conservan su inventario.

PHASE-07 mantiene capacidad de 60 estudiantes, 201 intentos y 51 episodios,
primera navegación separada por perfil, 50 navegaciones seriales y 50 con un
navegador más tres lectores HTTP. Se conserva el cronómetro desde antes de
`cy.visit` hasta todas las aserciones, incluidas 50 señales; p95 nearest-rank
estrictamente menor de 3000 ms, cero errores y fondo válido. No se introducen
calentamientos, pausas, descartes, aumentos de pool/recursos ni cambios de cuota,
timeout o umbral. El prefijo reproduce contexto funcional, no el historial de
carga de las etapas anteriores de CI.

## Instrumentación y validez

`--diagnostics` solo se admite con `--phase-context`. El arnés transmite
`ALUNZA_TEST_DASHBOARD_TIMINGS=1`; en el resto de los modos transmite `0`.
La API rechaza la activación fuera de `ENVIRONMENT=test`; la web la compila
únicamente junto a `ALUNZA_E2E_BUILD=1`. No cambia rutas, cabeceras públicas,
DTO, cuerpos o respuestas. Se reutiliza `X-Request-Id`.

El navegador registra navegación, sesión, peticiones, consumo JSON, validación,
DOM comprobado y tareas largas disponibles. La recogida final ocurre después
de detener el cronómetro original. La API registra JWT, espera del pool,
preparación transaccional, consulta, validación y cierre; los spans anidados no
se suman. Un sensor de proceso registra CPU, memoria y event loop a 1 Hz; otro
registra CPU/memoria del anfitrión. Se declaran sensores ausentes, huecos,
truncamientos, desbordamientos y coste del observador. No se infieren muestras
ausentes como cero ni se atribuye CPU del anfitrión a un proceso particular.

Los reportes aplican listas permitidas: sin cuerpos, credenciales, identidad de
usuarios, parámetros SQL o URLs completas. Un UUID de correlación identifica
una petición o instancia de proceso; no identifica a un usuario. Los relojes
monotónicos del runner, navegador y API permanecen separados; el puente
runner/navegador conserva un intervalo de incertidumbre. UTC solo delimita
ventanas de sensores, sin restar relojes de máquinas para inferir latencia.
Respuesta→DOM incluye consumo, validación, React y aserciones; no es renderizado
puro. No se suman percentiles.

La elegibilidad causal requiere todas las peticiones críticas correlacionadas,
cero pérdidas, autocoste medido no mayor de 1% por perfil/proceso y sensores
usados en una atribución con huecos no mayores de 5% de su ventana. La calidad
de observación por sí sola no demuestra causa. Un p95 aprobado aislado tampoco
satisface la campaña causal ni sustituye CI.

Los artefactos propios son `.local/reports/imp-06/e2e-phase-context.json`,
`phase-browser-diagnostics.json` y `phase-context-diagnostics.json`; se conservan
copias por corrida en `.local/evidence/imp-06-closure/`. Los `.local` son
evidencia local ignorada por Git y pueden no existir en otra copia del proyecto.

## Primera D_A y parada

La primera ejecución contextual se ejecutó del `2026-11-01T20:59:34.566Z` al
`2026-11-01T21:14:45.534Z`. Cypress terminó a las `21:14:30.302Z`, usando
Chrome `156.0.8078.74` y Cypress `16.0.0`. El inventario incluyó los 69 casos y
los diez specs en el orden previsto: **60 aprobados, 1 fallido, 8 omitidos y
0 pendientes**. Los primeros nueve specs completos aprobaron, incluido DASH-03.
Esto no acredita los 69 casos ni el E2E completo de 103.

PHASE-01 falló al inicializar `createProgressPhaseHarness`: la lectura nueva de
`process.env.ALUNZA_TEST_DASHBOARD_TIMINGS` resolvía la función local `process`,
que ya existía en ese ámbito, en vez del objeto Node. El cierre `phase:loadStop`
recibió el mismo rechazo de inicialización y Cypress omitió PHASE-02 a PHASE-09.
Es una regresión introducida por el instrumental. **No se midió PHASE-07**:
no existe p95 de D_A y no se reprodujo ni explicó el p95 histórico de 3762,4 ms.

El informe diagnóstico quedó `invalid`, con cero perfiles y correlación N/D
(0 peticiones críticas requeridas, 0 correlacionadas). Las comprobaciones de
coste/cobertura por perfil no son evaluables sin ventanas; no demuestran que el
observador superara 1%. La CPU de Chrome/Next y de la VM no se midió; la del
anfitrión no permite atribuir consumo a esos procesos. El coste indirecto de
GC/planificación tampoco se acredita con autocostes directos.

Se aplica la condición de parada por contexto incompleto y ausencia de medición
causal. **Consumido: 1 de 6 campañas contextuales y 0 de 1 CI final.** B, D_B,
ABBA y CI final no se ejecutaron. No se sustituye la campaña por focos separados
ni se repite D_A para buscar un resultado favorable. TEST se detuvo y liberó
su lock. No se declara cierre técnico local.

Los **783 archivos** del inventario completo mantuvieron la huella
`1aa2cedd81bd7f482cb90ca0501723bd88a11a0a1576401c8f1dad986134f991`;
las **627 fuentes**, la huella
`0bebd97455be4ecd98915108b42921c16114179dfb41135c8d484bfa1b0daae1`.
Ambos inventarios excluyeron únicamente los dos archivos generados indicados
arriba. El registro completo incluye documentos y artefactos Office sin cambios.
El HEAD no cambió. Las versiones, configuración, catálogo de imágenes y ocho
imágenes de los contenedores TEST observados se conservaron junto al candidato.

Evidencia en `.local/evidence/imp-06-closure/`: `campaign-ledger.json`,
`D_A-before-manifest.json`, `D_A-after-manifest.json`, `D_A-before/files/`,
`D_A-environment.json`, `D_A-running-images.json`, `D_A-context.json`,
`D_A-diagnostics.json`, `D_A-browser.json`, `D_A-console.log`, `D_A-error.log`
y los dos logs `D_A-phase-task-*`. El error de etiqueta del helper privado de
snapshot se conserva como `preflight-label-error.json`: ocurrió antes de iniciar
npm/TEST/Cypress y no fue una campaña contextual adicional.

## Verificación del instrumental y siguiente trabajo

Antes de D_A aprobaron formato, lint y tipos globales, **887 pruebas API,
88 web y 567 de preproducción**. Una revisión posterior endureció la validación
de spans y marcas obligatorias; sus 20 pruebas focales y formato/lint aprobaron
antes de congelar A. Esos resultados verifican contratos y controles del
instrumental, pero no sustituyen su ejecución integrada.

Después de conservar D_A se corrige exclusivamente la colisión de nombres del
fixture mediante una importación explícita del entorno Node. La regresión
unitaria ejecuta la fábrica real con dobles de Auth/PG, sin TEST ni conexiones:
diagnóstico apagado en suite completa, encendido en contexto y rechazo fuera
del contexto. La versión D_A produjo **3/3 fallos**, conservados en
`instrumentation-regression-before.log`. La corrección del instrumental no es
el candidato B ni una corrección del rendimiento de producto.
Tras importar `env as nodeEnvironment` y sustituir las dos lecturas, la misma
regresión aprobó **3/3**, con formato y lint focales aprobados y evidencia en
`instrumentation-regression-after.log`. Hasta ese corte no se ejecutó otra campaña contextual.
La suite completa de preproducción aprobó después **572 pruebas en 31 suites**;
también aprobaron el formato global y los 213 enlaces locales de los documentos
actualizados. Estas comprobaciones posteriores no son otra corrida E2E ni CI.

Al terminar ese corte, el cierre seguía necesitando una reproducción válida de PHASE-07 y una causa
comprobable, antes de la corrección controlada, ABBA y una CI 17/17. Retomar la
campaña exigía acordar un nuevo protocolo a partir de esta evidencia; esa
ejecución no reinicia automáticamente el presupuesto ni cambia el umbral.

## Reanudación autorizada con el arnés corregido

El usuario autorizó expresamente repetir D_A y continuar el plan conservando
aceptación y condiciones de parada. Se abrió un registro aditivo en
`.local/evidence/imp-06-closure/resumption-01/`, sin sobrescribir la primera D_A.
Antes de arrancar se comprobaron **784 archivos idénticos** a la última entrega
y la regresión del arnés volvió a aprobar **3/3**, sin conexiones externas.
No se modificaron código, contratos, consultas, pool, recursos, cuotas ni límites.

La D_A reanudada transcurrió del `2026-11-01T21:21:24.116Z` al
`2026-11-01T21:47:55.400Z`; Cypress terminó a las `21:47:40.303Z`.
Conservó los diez specs en el orden previsto y el inventario de 69 casos, pero
su ejecución fue **56 PASS, 3 FAIL, 10 SKIP, 0 pendientes**. Las omisiones no
constituyen cobertura ejecutada. Los ocho casos DASH aprobaron y el fixture de
fase ya pudo inicializarse; PHASE-01–06/08/09 aprobaron. PHASE-07 falló por p95.

| Superficie        | p95 serial (ms) | p95 concurrente (ms) | Lecturas de fondo válidas | Resultado        |
| ----------------- | --------------- | -------------------- | ------------------------- | ---------------- |
| Tablero PHASE-07  | 1842,5          | **3951,8**           | 963/963                   | FAIL concurrente |
| Progreso PHASE-08 | 1767,2          | 2909,8               | 2026/2026                 | PASS             |
| Reglas PHASE-09   | 587,3           | 822,7                | 1523/1523                 | PASS             |

Cada perfil conserva 50 muestras válidas, cero errores, primera navegación
separada y umbral estricto de 3000 ms. La carga concurrente mantiene un navegador
y tres lectores HTTP. En tablero, 16/50 muestras alcanzaron al menos 3000 ms.
Se reprodujo el incumplimiento histórico, sin demostrar todavía su causa.

### Fallos del contexto y parada de la reanudación

Los otros dos fallos afectan al control local de recuperación de la API:

- **IMP06-BANK-05:** falla `foundation:apiStart` tras comprobar la indisponibilidad.
  También falla el `afterEach` global y se omiten BANK-06–08.
- **FND-01:** falla `foundation:apiStart` en el `beforeEach`, antes de ejecutar el
  cuerpo del caso. Se omiten FND-02–08. Ambos hooks explican los diez omitidos.

El tercer arranque de API registra `LISTEN_COMPLETE` a **107143,86 ms**, con
**100417,17 ms** dentro de la importación. Los anteriores registraron 6423,46 y
5523,53 ms. La siguiente respuesta de salud registrada fue HTTP 200 a las
`21:33:01.310Z`. Los controles de cliente y readiness conservan su límite de
30 s. Un fallo de readiness no termina el hijo; los siguientes controles pueden
reutilizar el mismo proceso aún vivo. Esto es compatible con la cascada observada,
pero el error genérico no distingue timeout de cliente y HTTP 503 en cada rechazo.
No se demostró por qué se demoró la importación ni una relación causal entre
ese arranque y PHASE-07. No se aumenta el timeout para ocultar el fallo.

El diagnóstico final es **`invalid`, `causalEligible=false`**, exclusivamente por
`CONTEXT_INCOMPLETE` y `CONTEXT_UNEXPECTED_FAILURE`. Se aplica la condición de
parada: **sin B, D_B, ABBA, CI final ni otra repetición automática**. La
reanudación consumió una D_A; el historial conserva dos D_A y cero CI finales.
TEST terminó detenido y liberó su lock. IMP-06.04 conserva cierre técnico pendiente.

### Evidencia descriptiva y sus límites

La instrumentación sí recogió los dos perfiles completos: **1473/1473 peticiones
críticas correlacionadas**, todas HTTP 200, sin pérdidas ni huecos reportados
en las ventanas API/anfitrión. Los autocostes directos medidos fueron:

| Observador          | Serial  | Concurrente |
| ------------------- | ------- | ----------- |
| Navegador AUT       | 0,1432% | 0,0879%     |
| Controlador Cypress | 0,0137% | 0,0086%     |
| Fixture/lectores    | 0,0239% | 0,0121%     |
| Proceso API         | 0,1284% | 0,2819%     |
| Anfitrión           | 0,1523% | 0,2941%     |

Todos cumplen el máximo de 1%. Eso no convierte un contexto funcional incompleto
en una comparación causal válida ni mide costes indirectos de GC/planificación.

La lectura de navegador observa aumentos en arranque, intervalos fetch y tareas
largas, además del consumo de respuestas. La última validación→DOM tiene p95
76,9/116,3 ms serial/concurrente; no concentra toda la demora ni equivale a
renderizado puro. Los tiempos HTTP y las tareas largas pueden solaparse.

La API registra p95 de 410,33/841,99 ms para tablero y 497,34/814,73 ms para
señales. Los spans de consulta respectivos registran 394,75/819,57 ms y
481,01/764,99 ms. Estas poblaciones incluyen **51 peticiones por ruta/perfil**,
primera navegación más 50 medidas; no son exactamente la población del p95 UI.
La duración de consulta es tiempo de pared del cliente PostgreSQL, incluyendo
transporte y planificación; no demuestra por sí sola coste SQL. `db.action`
contiene consulta/parseo y no se suma a ellos. Tampoco se suman percentiles.

El pool no muestra cola sostenida en sus instantáneas: adquisición p95 concurrente
0,08 ms en tablero, 0,16 ms en señales y 0,11 ms en lecturas de fondo. Esas
instantáneas no constituyen monitorización continua. El proceso API utilizó en
promedio ponderado 5,53%/9,77% de un núcleo; el anfitrión compartido, con 12 CPU
lógicas, registró 68,88%/85,05% de ocupación media. No se midió consumo separado
de Chrome, Next, PostgreSQL o la VM para atribuir esa ocupación. Estos datos
orientan una investigación posterior; no seleccionan una corrección B demostrada.

### Huellas y siguiente evidencia necesaria

Durante toda D_A permanecieron idénticos **784 archivos**, huella completa
`9a7cb67b864b3a889c4eafa749c509157172b074166cd01030d3a3f78a664dfc`, y
**628 fuentes**, huella
`defec1961385150f402f3d6919a96ff99f9999b34268006fda0284d7a229559d`.
Se mantienen las dos exclusiones generadas declaradas y el mismo HEAD.

El directorio de reanudación conserva `authorization.json`, `campaign-ledger.json`,
los manifiestos/copia de A antes y después, versiones/imágenes y los reportes
`D_A-context.json`, `D_A-performance.json`, `D_A-browser.json`,
`D_A-diagnostics.json`, `D_A-error.log`, `D_A-cypress-failures.log` y
`D_A-api-startup.json`. La documentación se actualiza después de terminar D_A.

Siguiente trabajo: investigar y verificar la recuperación/arranque de API sin
ampliar límites; conseguir un prefijo completo y comparable; después localizar
el mecanismo de PHASE-07 y verificar una única corrección con D_B, ABBA y CI
17/17. No se inicia ese trabajo adicional bajo esta corrida detenida ni se
declara aceptación remota, humana o de IMP-06.05–.07.

## Segunda reanudación: corrección de carga y D_A completa

El usuario autorizó investigar el arranque, aplicar una corrección comprobada y
repetir D_A conservando límites y condiciones de parada. Se preservó el candidato
anterior en `.local/evidence/imp-06-closure/resumption-02/origin/`; sus 784 hashes
coincidían con la entrega previa. Esta reanudación añade una corrida contextual:
el historial suma **tres**, sin reiniciar el límite de seis ni ejecutar CI final.

### Mecanismo de arranque comprobado y alcance de la corrección

La revisión del control de procesos no encontró un doble arranque: las operaciones
están serializadas y un readiness fallido conserva el hijo vivo, conforme a su
prueba existente. El intervalo histórico de 100417,17 ms es tiempo de pared entre
marcas de importación, que incluye planificación y la emisión anterior; no
demuestra 100 s de CPU importando ni identifica por sí solo el recurso responsable.

Sí se comprobó trabajo innecesario: `materials-api.cjs` carga la API/configuración,
que importa el barrel `@alunza/ai`; este cargaba OpenAI y Azure Identity incluso
cuando TEST inyectaba proveedores locales. Un perfil aislado registró 4152,86 ms
para importar la API, con 1196,77 ms en el módulo Azure, incluidos 405,17 ms de
OpenAI y 782,96 ms de Identity. Son intervalos anidados, no sumables con el padre.
Este ensayo no reprodujo las condiciones del incidente de 100 s.

La única corrección de producto difiere esos SDKs hasta construir un adaptador
válido, mediante el helper privado
[azure-client.ts](../../packages/ai/src/azure-client.ts) y los tres adaptadores
existentes. Identity se carga solo para `azure-cli` o `managed-identity`.
Se conservan constructores síncronos, validación previa, clase real `APIError`,
selección de credenciales/clientId/scope, transporte/observadores, timeout y
reintentos. No se añade caché propia ni se desplaza inicialización al primer
request. No cambia proveedor, contrato público, límites, pool, recursos o cuotas.
Esta corrección de arranque **no es B de la campaña causal de PHASE-07**.

La [regresión en procesos nuevos](../../tests/ai/provider-startup.test.cjs),
incorporada a la suite habitual, verifica importación y rechazo de configuración
sin SDKs, construcción real con API key sin Identity y ambos modos Entra sin
solicitar tokens ni permitir red/subprocesos externos. Contra U produjo **7 fallos
esperados y 6 controles aprobados**; con R aprobaron **13/13**, incluidos en
**378 pruebas IA/14 suites**. También aprobaron **887 API/49 suites**, tipos y lint
globales. Formato detectó una diferencia en el nuevo test; tras formatear ese
archivo, aprobó el control global. Se conserva el log del aviso inicial.

La comparación descriptiva de importación en un proceso nuevo, sin perfilado,
registró **1216,96 ms U / 911,91 ms R**, **1142 / 688 módulos CommonJS** y
**196 / 0 archivos OpenAI**, **43 / 0 archivos Identity**. Los exports de API
permanecieron válidos. Son dos observaciones aisladas: la reducción de trabajo
está demostrada por la regresión, pero no se atribuye a ella todo el incidente
histórico ni se presenta esa pareja como p95 o prueba causal de PHASE-07.

### Resultado integrado de la nueva D_A

Corrida del `2026-11-01T22:03:04.371Z` al `2026-11-01T22:26:00.852Z`; Cypress
publicó su resultado a las `22:25:49.133Z`. Ejecutó los **69 casos/10 specs**
en el orden previsto: **68 PASS, 1 FAIL, 0 SKIP, 0 pendientes**. El único fallo
fue **IMP05-PHASE-07**. BANK-01–08, FND-01–08 y los ocho DASH aprobaron, junto
con las 27 capturas requeridas —3 tablero, 6 banco y 18 fase—.

Los cinco arranques completos registraron `LISTEN_COMPLETE` a **4481,69 / 2587,87 /
2239,52 / 2828,82 / 2211,96 ms**. Sus intervalos de importación fueron
3935,05 / 2355,75 / 1988,75 / 2411,78 / 1970,88 ms; `app.init` quedó entre
158,05 y 387,84 ms. La recuperación funcionó en esta corrida con los mismos
controles de 30 s. No se reprodujo el incidente de 107 s, pero tampoco se
demostró retrospectivamente su causa completa.

| Superficie        | p95 serial (ms) | p95 concurrente (ms) | Fondo válido | Resultado        |
| ----------------- | --------------- | -------------------- | ------------ | ---------------- |
| Tablero PHASE-07  | 2019            | **3393**             | 950/950      | FAIL concurrente |
| Progreso PHASE-08 | 843             | 2869,4               | 1753/1753    | PASS             |
| Reglas PHASE-09   | 587,1           | 943,8                | 1566/1566    | PASS             |

Cada perfil conserva 50 muestras válidas y cero errores, sin descartes ni nuevos
calentamientos. En tablero, **16/50** navegaciones concurrentes alcanzaron 3000 ms;
las primeras navegaciones, 1008,9/2522,1 ms, se mantuvieron aparte. El fondo
concurrente tuvo tres lectores, concurrencia máxima tres y cero timeouts.

La observación terminó **`observed`, `causalEligible=true`, sin motivos de rechazo**:
**1460/1460 peticiones HTTP 200 correlacionadas**, cero pérdidas y cero huecos
reportados en las ventanas API/anfitrión. Los autocostes directos fueron:

| Observador          | Serial  | Concurrente |
| ------------------- | ------- | ----------- |
| Navegador AUT       | 0,1393% | 0,0883%     |
| Controlador Cypress | 0,0121% | 0,0159%     |
| Fixture/lectores    | 0,0165% | 0,0120%     |
| Proceso API         | 0,1443% | 0,2599%     |
| Anfitrión           | 0,1937% | 0,3021%     |

Todos cumplen ≤1%; persisten los límites de coste indirecto y sensores ausentes.
Durante la corrida se consultaron reportes ya publicados para informar progreso;
esas consultas externas no se usan como sensores ni como prueba de causalidad.

### Interpretación, parada y evidencia preservada

La elegibilidad observacional permite analizar, pero no demuestra un mecanismo
para B. La API muestra p95 serial/concurrente 425,45/780,94 ms en tablero y
549,05/811,53 ms en señales; los spans de consulta respectivos son
403,1/732,91 ms y 530,5/786,76 ms. Son 51 peticiones por ruta/perfil, primera más
50 medidas. El p95 de espera del pool concurrente es 1,52 ms en tablero y
0,08 ms en señales. La consulta mide pared del cliente PG, no ejecución SQL pura.

En navegador crecen varios intervalos: inicio→instalación del observador tiene
p95 230,2/592 ms; instalación→efecto de sesión, 275,8/658,2 ms; clase validada→
últimos headers, 1143,2/1866,1 ms; última validación→DOM, 89,5/120 ms.
El residual medio fuera de la unión de fetch es 494/1399,1 ms e incluye distintos
trabajos y esperas. Las tareas largas se solapan; no se suman percentiles ni se
denomina renderizado puro a estos intervalos. API utiliza en promedio concurrente
10,26% de un núcleo y el host compartido 87,95%; faltan CPU individual de
Chrome/Next/PostgreSQL/VM y atribución de código para aislar el mecanismo.

Se aplica la parada por **causa de PHASE-07 no demostrada**, aun con contexto y
observación válidos. No se selecciona B ni se ejecutan D_B, ABBA, otra D_A o CI
final. La corrección de carga permanece comprobada; IMP-06.04 mantiene el cierre
técnico local pendiente. La siguiente evidencia necesaria es localizar un
mecanismo de rendimiento y formular una predicción verificable, conservando
los presupuestos y el historial de campañas.

Durante toda D_A permanecieron idénticos **786 archivos**, huella completa
`8bbddf50eaf77087aea1f931e794811c7c2f8915ce6091bca3a64b1782855aae`, y
**630 fuentes**, huella
`f0955ec9026774d093c86c0860b9b9032002c6fd5eb5365619bea7094a16e40e`.
HEAD y las dos exclusiones generadas siguen iguales. TEST quedó detenido,
con lock liberado y sus puertos disponibles; los datos se conservaron.

`resumption-02/` contiene autorización, predicción U/R, perfil de importación,
regresión roja, suites/checks, comparación U/R, ledger y candidato recuperable;
además, versiones/imágenes, `D_A-context.json`, `D_A-performance.json`,
`D_A-browser.json`, `D_A-diagnostics.json`, `D_A-error.log`, `D_A-api-startup.json`,
resúmenes derivados y estado de detención. La documentación se actualizó solo
después de concluir D_A; las evidencias de las dos corridas anteriores permanecen.

## Tercera reanudación: corrección del arnés y D_B

El usuario autorizó investigar PHASE-07 con la evidencia de D_A, aplicar una
corrección comprobada y continuar sin ampliar los límites. La entrega anterior
conservaba sus 786 archivos sin cambios. Se preservaron las tres D_A y se
contabilizó un remanente de tres campañas contextuales sobre el máximo global
de seis; D_B más ABBA requerían cinco. No se reinició ese contador.

### Mecanismo localizado y única corrección controlada

Un foco exploratorio independiente reutilizó la capacidad, las cinco aserciones
de PHASE-07, la primera navegación separada, 50 navegaciones por perfil y tres
lectores HTTP. No añadió pausas, calentamiento, descartes ni un gate alternativo.
El muestreo CDP localizó trabajo en `Scroller._isFullyVisible`, el auto
desplazamiento del panel de comandos de Cypress. Su implementación lee
`offsetTop`, `scrollTop` y `clientHeight`; no corresponde a visibilidad del AUT.
Chrome se lanzaba sin ventana, pero el runner seguía dibujando ese panel.

La única corrección de rendimiento es
[`runnerUi: false`](../../scripts/cypress-run.mjs), una opción
[oficial de Cypress](https://docs.cypress.io/app/references/troubleshooting#disable-the-command-log).
Conserva producto, permisos, RLS, corte histórico, aserciones, reloj, fixture,
perfiles, recursos, pool, timeouts, cuotas, umbrales e inventarios. No modifica
SQL, contratos o frontend ni vacía la cola de comandos. La observación de
referencias retenidas no demuestra una fuga ni el coste causal de esa retención.
Las hipótesis sobre consultas, prefetch y evaluación de módulos no se usaron
para introducir correcciones adicionales.

La [regresión real](../../tests/cypress-runner/run.mjs) captura las opciones del
launcher mediante VM y ejecuta Cypress/Chrome contra HTML local. En A hubo
**1 PASS/2 FAIL**: panel presente, reintento correcto y fallo centinela deliberado.
En B hubo **2 PASS/1 FAIL**, únicamente el centinela: el panel desapareció y
el reintento siguió funcionando. El dictamen externo de B aprobó; no se ocultó
el fallo bruto de Cypress. Ambas variantes conservaron tres casos, cero
omisiones, un intento por caso, un reintento de comando real, viewport
1280 × 900 e integridad de la fuente. Estos casos están fuera de los 103 E2E.

La revisión corrigió también el verificador nuevo para que una excepción al
releer la fuente siempre produzca `failed`. Un control negativo de esa lectura
final devolvió código 1 aun con los dos casos funcionales aprobados y el
centinela esperado. Es una salvaguarda común a A/B, no otra optimización.
Formato y lint globales aprobaron; preproducción aprobó **572 pruebas/31 suites**.
Tras esa salvaguarda aprobaron sintaxis, formato y lint focales y el control
negativo. No se ejecutaron de nuevo suites de API o SQL por este cambio del arnés.

### Comparación exploratoria y límites

La predicción registrada antes de B exigía retirar el panel y reducir al menos
40% el tiempo ponderado de muestras del controlador. Se ejecutó un único foco
equivalente sobre B; ambos focos mantuvieron las fuentes congeladas.

| Perfil      | Controlador A (ms muestreados) | Controlador B (ms muestreados) | Reducción | Referencias a documentos previos A/B |
| ----------- | -----------------------------: | -----------------------------: | --------: | -----------------------------------: |
| Serial      |                      18215,697 |                      10854,340 |   40,412% |                                50/50 |
| Concurrente |                      41133,251 |                      15136,468 |   63,201% |                              101/101 |

`_isFullyVisible` acumuló 5598,220/17724,487 ms en A y dejó de aparecer entre
los principales frames en B; esa ausencia no equivale a medir cero trabajo de
toda la categoría. El fondo conservó tres lectores, pico tres, 971/601 lecturas
válidas A/B y cero fallos/timeouts. Cada foco completó las 102 navegaciones.

Los perfiles A tuvieron una muestra inválida cada uno; B serial fue `observed`
y B concurrente `partial`, con una muestra inválida. El autocoste del perfilador
no está calificado bajo el 1%. Son muestras exclusivas ponderadas, no utilización
de CPU del proceso ni evidencia de aceptación. Los dos focos no son campañas
contextuales, no reproducen el prefijo de 69 casos y no sustituyen D_B/ABBA/CI.
La mejora del arnés tampoco explica cada milisegundo ni todos los fallos históricos.

### Resultado de D_B con observación habitual

La única D_B comenzó el `2026-11-01T22:59:20.025Z` y terminó a las
`23:19:50.544Z`: **69 PASS, 0 FAIL, 0 SKIP y 0 pendientes**, diez specs en el
orden previsto y **27/27 capturas** —3 tablero, 6 banco y 18 fase—. Se ejecutó
sin perfilador de CPU, con el diagnóstico optativo habitual de TEST.

| Superficie        | p95 serial D_B (ms) | p95 concurrente D_B (ms) | Fondo válido | Resultado |
| ----------------- | ------------------: | -----------------------: | -----------: | --------- |
| Tablero PHASE-07  |              1809,9 |               **2428,1** |      560/560 | PASS      |
| Progreso PHASE-08 |              1001,1 |                   1388,7 |      735/735 | PASS      |
| Reglas PHASE-09   |               578,2 |                    745,8 |    1260/1260 | PASS      |

Los seis perfiles conservaron 50 muestras válidas, cero errores y sus primeras
navegaciones aparte; en tablero fueron 889,7/1706,6 ms. Ninguna de las 50
navegaciones concurrentes del tablero alcanzó 3000 ms; el máximo fue 2707,1 ms.
El p95 concurrente pasó de **3393 a 2428,1 ms**. La media residual fuera de la
unión de intervalos fetch pasó de **1399,062 a 448,154 ms**, una reducción de
**67,968%**, superior al 20% previsto. La definición reproduce el valor anterior
de D_A sin cambiar relojes ni sumar spans o percentiles; no es renderizado puro.
Sus medias por bloques de diez navegaciones en B fueron 449,89/463,79/442,68/
430,95/453,46 ms, sin reproducir el crecimiento anterior de ese residual.

La calidad quedó **`observed`, `causalEligible=true`, sin motivos de rechazo**:
**1070/1070 peticiones correlacionadas**, cinco GET críticos por navegación,
cero pérdidas reportadas y cero huecos en las ventanas observadas API/anfitrión.

| Observador          | Autocoste serial | Autocoste concurrente |
| ------------------- | ---------------: | --------------------: |
| Navegador AUT       |          0,1736% |               0,1356% |
| Controlador Cypress |          0,0128% |               0,0127% |
| Fixture/lectores    |          0,0082% |               0,0128% |
| API                 |          0,1459% |               0,2565% |
| Anfitrión           |          0,1289% |               0,1884% |

Todos cumplen ≤1%; siguen ausentes CPU individual de navegador, web y VM y no
se atribuye CPU compartida a esos procesos. El análisis conservado en
`D_B-comparison.json` verificó la predicción, contexto, muestras originales,
frescura de reportes, correlación, capturas y huellas. Las consultas externas
de progreso no se presentan como sensores ni como prueba causal.

### Huellas, parada y siguiente evidencia pendiente

Durante D_B permanecieron idénticos **789 archivos**, huella completa
`5a97f6f80b25f38ff3f8beb48c75c02749fdafecb0e86ba9fb0f8f185a80b21d`, y
**633 fuentes**, huella
`512e1169edd8d989f556adfb153f1c5700db9a61c547f095f40740c467a8fb0d`.
HEAD y las dos exclusiones generadas siguen iguales. La variante A recuperable
con el mismo verificador final tiene huella
`e2f7e438139f5b982330bed0db245943e807b58f4ef9bc69012c2d706f1a5832`;
no se renombra con ella la D_A histórica. A/B difieren únicamente por el launcher
controlado; se conserva su versión anterior sin reset ni sobrescritura ajena.

**La secuencia se detiene por presupuesto insuficiente para ABBA completo:**
se han consumido **4/6 campañas contextuales**, quedan **2** y ABBA requiere
**4**. No se inicia una comparación abreviada ni se amplía el máximo. ABBA
permanece **0/4** y la CI final **0/1**; no hay 17/17 ni aceptación de los 103 E2E
en esta reanudación. D_B respalda el mecanismo y aprueba su predicción, pero no
sustituye la repetibilidad causal exigida. **IMP-06.04 conserva cierre técnico
local pendiente.** El prefijo tampoco reproduce todo el historial de carga de CI.

TEST quedó detenido, con lock liberado, datos conservados y puertos
3300/4300/18421/18422 disponibles. `resumption-03/` conserva autorización,
predicción, focos CPU A/B, regresión roja/verde y control negativo, checks,
variantes recuperables, versiones/imágenes, reportes D_B, análisis, ledger y
estado de parada. La documentación se actualizó después de concluir las pruebas.

## Cuarta reanudación: ABBA detenido en A1 — 01/11/2026

El usuario autorizó ampliar el máximo de **6 a 8 campañas contextuales** para
completar ABBA y ejecutar una única CI final solo si sus controles aprobaban.
Las cuatro campañas anteriores siguen consumidas. La parada por presupuesto
de la tercera reanudación se conserva como antecedente, sin reclasificar D_B
ni reiniciar el contador. No se autorizaron cambios de gates o condiciones de parada.

### Preparación y congelamiento

Se verificaron los 789 archivos de la entrega anterior, con HEAD
`75708ceecf2ca755bd32fb4b04e77bcb8de310f4`, y se conservaron versiones
recuperables A/B. Su única diferencia controlada es `runnerUi: false` en
`scripts/cypress-run.mjs`; DASH-03 y todos los cambios anteriores permanecen.
El protocolo auxiliar privado aprobó **77 comprobaciones offline**, incluidos
controles negativos, y se contrastó con los formatos reales de D_A/D_B y CI.
Estas comprobaciones no son campañas contextuales ni prueban rendimiento.

El orquestador, validador, autorización, referencia y bytes A/B quedaron
sellados antes de A1 con huella de protocolo
`2dfb2b3060213c383ed5fc478e453262a25a6b8fe658d08fc68f9690470c23c9`.
El orden A1/B1/B2/A2, el presupuesto y la prohibición de continuar tras un
control rechazado se comprobaron antes de lanzar cada etapa. El control A
exigía 68 PASS/1 FAIL, exclusivamente PHASE-07 concurrente; los otros cinco
perfiles debían aprobar. No se modificó este criterio después de ver resultados.

### Única ejecución de esta reanudación

`npm run test:e2e -- --phase-context` comenzó el
`2026-11-01T23:42:36.195Z` y terminó el `2026-11-02T00:09:03.910Z`
(01/11/2026 en Santiago). Diagnóstico desactivado, sin perfilador ni sensores
adicionales. Se ejecutaron los **diez specs en el orden previsto y los 69 casos**:
**67 PASS, 2 FAIL, 0 SKIP y 0 pendientes**, con salida 1. Fallaron
`IMP05-PHASE-07` y `IMP05-PHASE-08` por sus aserciones originales de p95 <3000 ms.

| Superficie        | p95 serial (ms) | p95 concurrente (ms) | Fondo válido | Gate                       |
| ----------------- | --------------: | -------------------: | -----------: | -------------------------- |
| Tablero PHASE-07  |          2213,7 |           **4081,8** |      931/931 | FAIL concurrente esperado  |
| Progreso PHASE-08 |          1851,8 |           **3110,1** |    1902/1902 | FAIL concurrente adicional |
| Reglas PHASE-09   |           854,1 |               2701,7 |    3846/3846 | PASS                       |

Los seis perfiles conservaron **50 muestras válidas**, primeras navegaciones
separadas y cero errores de navegación. Sus primeras navegaciones fueron
947,1/3126,1 ms en tablero, 735/2466,2 ms en progreso y 553/468 ms en reglas
(serie/concurrencia 4). Los tres archivos de carga conservaron sus muestras
originales válidas, tres lectores y duración suficiente para cada perfil.
El validador recalculó p95 nearest-rank sin redondear para decidir los gates;
los valores de la tabla solo se redondean para lectura.

El inventario de capturas quedó en **24/27**: tablero 3/3, banco 6/6 y fase
15/18. PHASE-08 falló en la medición antes de sus tres capturas de progreso;
las capturas realizadas aprobaron sus controles. El dictamen rechazó
`CAPTURES_INCOMPLETE`, `CONTEXT_RESULT_MISMATCH`,
`PROFILE:progress/4:GATE_MISMATCH` y `CONTROL:expectedErrorConfirmed`.
Este último control exigía exactamente una aserción de latencia fallida; el log
conserva dos. El fallo de PHASE-07 sí se reprodujo, pero el fallo adicional y
las capturas incompletas impiden aceptar A1 como control del protocolo.

### Integridad, parada y evidencia pendiente

La huella completa A antes/después fue
`9a7e232e04dd0690d8338e27ed88dac3272e7b2e4129f9410111770699265359`
para **789 archivos**; la huella de **633 fuentes** fue
`68a576cc6fa5e6526932fdbc4e3b755e5c8396de5b0201b41d6b734d4ce23a6b`.
El protocolo privado también permaneció idéntico. Se verificaron las mismas
versiones e imágenes que D_B, incluido Chrome 156.0.8078.74 y Cypress 16.0.0.
Las dos exclusiones generadas habituales se registran aparte. Las huellas
corresponden al candidato con la documentación posterior a D_B; no renombran
el candidato de aquella corrida histórica.

Se restauró B comprobando exclusivamente los bytes conocidos del launcher,
con SHA-256 `c0a34f6db96db9936f6e4163eb155986950661848869342af2918e8c3d73421e`.
No hubo otra corrección, repetición ni cambio de parámetros. **ABBA queda en
1/4 ejecuciones y cero controles conformes; B1, B2 y A2 no se iniciaron.**
El consumo global es **5/8 campañas contextuales**, con tres sin usar, y
**0/1 CI final**. El saldo de presupuesto no autoriza ignorar esta parada.

La corrida sin diagnóstico no permite atribuir la causa nueva de PHASE-08 ni
afirmar que B la resuelve. La regresión y D_B favorables anteriores se conservan,
pero no sustituyen ABBA completo ni CI 17/17. **El cierre técnico local de
IMP-06.04 sigue pendiente.** Antes de otra campaña falta explicar el rechazo
del control A1 y establecer un contexto comparable; no se repite hasta verde.
El prefijo tampoco acredita los 103 E2E ni todo el historial de carga de CI.

`resumption-04/` dentro de `.local/evidence/imp-06-closure/` conserva autorización,
protocolo sellado, pruebas offline, versiones A/B, entorno, manifiestos,
reportes originales, cargas, log saneado, dictamen, ledger y restauración.
La documentación se actualiza después de terminar A1 y restaurar B.

## Quinta reanudación: investigación de PHASE-08 — 01/11/2026

El usuario pidió investigar PHASE-08, aplicar una corrección comprobada y
continuar conservando el máximo global de ocho campañas y las condiciones de
parada. Se auditó A1 frente a D_A/D_B, el recorrido web/API y el arnés, sin
iniciar otra campaña contextual. **La causa de PHASE-08 sigue sin atribución
demostrada; no se aplicó una segunda corrección de rendimiento.**

### Evidencia comprobada y límites de la atribución

La recomputación nearest-rank coincidió exactamente con los reportes de los
18 perfiles históricos comparados. En progreso concurrente, A1 conserva
**50/50 muestras válidas**, cinco de ellas ≥3000 ms, en los índices 12, 27, 29,
44 y 45 (base cero). Su máximo fue 3376,2 ms, menor que el máximo de D_A
(3788,8 ms): el fallo no se explica por un único extremo aislado.

| Progreso concurrente   |    D_A |    D_B |     A1 |
| ---------------------- | -----: | -----: | -----: |
| p95 navegador (ms)     | 2869,4 | 1388,7 | 3110,1 |
| Mediana navegador (ms) | 2092,8 |  932,6 | 2470,0 |
| Muestras ≥3000 ms      |   1/50 |   0/50 |   5/50 |

En A1, las **1902 lecturas HTTP de progreso** fueron válidas, con HTTP 200,
cero fallos y cero timeouts; mediana 189,15 ms, p95 362,23 ms y máximo
595,66 ms. Los lectores son tres bucles seriales cerrados, sin reintentos ni
pausas añadidas. La navegación también incluye sesión, bootstrap, peticiones,
validación, DOM y ejecución de los comandos Cypress. Los lectores no miden esa
cadena completa: **no se restan sus percentiles ni se atribuye la diferencia
a renderizado puro**. La comparación histórica tampoco es un nuevo A/B controlado.

La degradación no se limita a progreso: en reglas concurrentes, la media por
bloques de diez navegaciones sube aproximadamente de 774/792 ms a 2363/2410 ms
en los dos últimos bloques. Es una pista para investigar trabajo compartido del
navegador/arnés o del entorno; no identifica una causa. A1 no tiene observación
de CPU, colas o intervalos críticos que permita discriminar esas alternativas.

La revisión del montaje de progreso no encontró una petición duplicada
inevitable ni polling propio: la consulta filtrada está deshabilitada al inicio,
los detalles se montan al abrirse y los efectos cancelan al desmontar. La API
realiza una transacción de lectura con una RPC. Esto no acredita que SQL o el
pool sean inocuos, ni que una posible optimización SQL resuelva A1.

### Brecha concreta de diagnóstico y corrección existente

El flag diagnóstico actual no basta para estudiar PHASE-08. En
`tests/e2e/progress-phase.cy.ts`, el colector de navegador solo se activa para
`dashboard`; los lectores y agregadores también restringen sus trazas a esa
superficie. La lista permitida de `apps/api/src/http/phase-diagnostics.ts` y la
clasificación web no incluyen `/api/v1/me/progress`. Los marcadores de contenido
y spans específicos son de tablero. La observación válida anterior de D_A/D_B
no se extiende retrospectivamente a progreso.

El mismo `measure()` cronometra los tres recorridos. El panel de Cypress que
motivó B es una hipótesis común compatible con las mediciones, pero los focos
CPU anteriores solo estudiaron un recorrido equivalente al tablero. No prueban
qué parte de los 3110,1 ms de PHASE-08 procede del reporter ni su causa exclusiva.
La opción `runnerUi` está documentada por la
[API oficial de Cypress](https://docs.cypress.io/app/references/module-api#Options);
no se introdujo una opción alternativa ni una nueva dependencia.

Se ejecutó una sola vez la regresión existente sobre B:

```text
node --experimental-vm-modules tests/cypress-runner/run.mjs .local/evidence/imp-06-closure/resumption-05/runner-regression-B.json
```

El dictamen externo fue **PASS**, con **2 PASS/1 FAIL centinela deliberado** en
Cypress, sin omitidos ni pendientes. Chrome confirmó panel ausente, un reintento
efectivo, viewport 1280×900 y reporte del error centinela. La fuente permaneció
idéntica. **Verifica la corrección B ya existente; no es una nueva corrección ni
una prueba de latencia de PHASE-08, una campaña de 69 casos o un E2E de 103.**
No se inició TEST para esta regresión.

### Decisión y siguiente evidencia necesaria

La investigación y la regresión conservaron los **789 archivos**, huella
`09afe6f41222e482d82401dc55793451d3306d0e06c0a4e049cdab54f12e8ca3`,
y HEAD `75708ceecf2ca755bd32fb4b04e77bcb8de310f4`. B sigue activo con el mismo
hash de launcher; no se modificaron producto, medición, gates, recursos, pool,
timeouts ni cuotas. La documentación se actualizó después de la regresión.

Se mantiene **5/8 campañas consumidas y 0/1 CI final**, sin ejecuciones nuevas.
A1 continúa rechazado: no se cambia su oráculo ni se lo reutiliza como primer
control conforme. Un ABBA nuevo requiere **cuatro** campañas frente a **tres**
disponibles, es decir, un mínimo global de **nueve** aun sin nuevos diagnósticos.
**El cierre completo no cabe en el límite vigente de ocho.** No se inicia una
secuencia abreviada ni la CI para eludir esa condición.

Falta observación específica de PHASE-08 con correlación completa, relojes
separados, pérdidas y autocoste calificados; después, un mecanismo reproducible,
una intervención mínima con regresión roja/verde y comparación equivalente.
La aceptación conserva ABBA completo y CI 17/17 sobre candidato congelado.
`resumption-05/` conserva manifiestos, análisis descriptivo y su procedencia,
regresión B y dictamen `inconclusive-cause-stop-retained`. Los reportes previos
no se sobrescriben y **IMP-06.04 conserva cierre técnico local pendiente**.

## Sexta reanudación: observación de PHASE-08 y nuevo ABBA — 01/11/2026

El usuario autorizó instrumentar y calificar PHASE-08, demostrar su causa,
comprobar una corrección y ampliar el límite necesario para ABBA y CI.
Antes de ejecutar se fijó un máximo global de **once campañas**: cinco
consumidas más D_A08, D_B08 y cuatro controles nuevos A–B–B–A; una CI final
condicionada. El A1 de la cuarta reanudación permanece rechazado y consumido.
Los nuevos controles A debían reproducir **ambos** fallos concurrentes,
PHASE-07 y PHASE-08, con 67 PASS/2 FAIL; B debía aprobar 69/69 y los seis gates.
Se exigieron 27 capturas y cero omitidos/pendientes en todas las etapas.

### Instrumentación y calificación previas

El scope explícito `dashboard+progress` añade progreso serial y concurrente:
cuatro perfiles diagnósticos, cada uno con primera navegación y 50 medidas.
El navegador clasifica la ruta existente de progreso y comprueba su resumen
y 50 filas; la API añade `progress.query`, `progress.parse` y
`progress.responseParse`. Se conserva `X-Request-Id`, la transacción, errores,
cancelación, respuestas, permisos y las listas de datos permitidos. No se
añaden rutas, cabeceras, SQL, migraciones ni dependencias. El flag conserva
su nombre histórico, es optativo y se rechaza fuera de TEST.

Lectores, colectores y agregador separan superficie, concurrencia e instancia
de proceso; no sobrescriben progreso con tablero. El lector admite reportes
históricos de tablero, pero el productor nuevo exige los cuatro perfiles:
un scope ausente, desconocido o incompleto no acredita esta campaña.

Para conservar el contexto después de un fallo final de p95 en PHASE-08,
`afterEach` recupera únicamente sus tres capturas originales, después de
cerrar la medición y la carga. No vuelve a navegar, no cambia muestras ni
aserciones y conserva el fallo original. El guard exige las 50 muestras válidas,
primera válida, p95 y mensaje exacto del error; admite la serialización real
de Cypress de `actual`/`expected` como números, strings canónicos o ausentes.

La calificación global aprobó formato, lint, tipos, **902 pruebas API**,
**101 web** y **616 de preproducción**, con 792 archivos congelados. Después
del ajuste del guard solo cambiaron ese helper y su prueba: **60/60 focales**,
lint, formato y tipos E2E aprobados. No se suman esas ejecuciones como una CI.
El agregador aprobó 25/25 focales y la compatibilidad histórica; el validador
privado, 95/95 casos offline. Los tests previos de progreso se conservaron.

Se preservan también los fallos de calificación: los primeros tests nuevos
API corrigieron una expectativa de fixture antes de obtener el rojo pertinente
y 30/30 verdes; el primer foco real de capturas rechazó campos serializados
por Cypress. El segundo produjo las tres capturas y conservó el fallo, pero
su dictamen externo falló al buscar campos no garantizados del Module API.
**Ambos reportes de capturas siguen FAIL.** Un suplemento offline independiente
acreditó exclusivamente recuperación funcional mediante log con el error y
stack originales, probe, un intento, una navegación, tres PNG y hashes estables.
No se guardó el resultado bruto del Module API; no se afirma validación de esa
estructura ni rendimiento a partir del foco sintético. No hubo una tercera corrida.

### Candidatos congelados y resultados

Los 792 archivos, incluidos 636 de fuentes, quedaron congelados durante cada
campaña. HEAD permaneció `75708ceecf2ca755bd32fb4b04e77bcb8de310f4`.
El único cambio A/B siguió siendo `runnerUi: false` en el launcher; la nueva
instrumentación y el guard son comunes. Se conservaron versiones, imágenes,
fixtures, recursos, pool, timeouts y cuotas, con TEST exclusivo.

| Huella              | A                                                                  | B                                                                  |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Fuentes             | `cf1fc1cece3c0b131f42d1e93fce22e8dec9ae8f6b9ae8c9ef590d271a97f44a` | `2a26ba0312c9a59d748c0ac53eddf45d3705b934e356003e4bb7dab5220cd8a1` |
| Inventario completo | `8b8c48e0f0c9fbe1802fca95740402cd6a8fed532140d7c253d1d9909207ba74` | `30d2ec6de7fe08186106c7b1e59bdb935ef49c70acd69e73049e80dd67ffd84c` |

| Perfil, p95 ms       | D_A08, diagnóstico | D_B08, diagnóstico | Nuevo ABBA_A1, sin diagnóstico |
| -------------------- | -----------------: | -----------------: | -----------------------------: |
| Tablero serial       |             2231,3 |             1467,4 |                         1744,9 |
| Tablero concurrente  |    **4481,2 FAIL** |             2777,2 |                **3962,0 FAIL** |
| Progreso serial      |             1741,2 |              914,9 |                         1484,8 |
| Progreso concurrente |    **3356,7 FAIL** |             2016,1 |                **2828,3 PASS** |
| Reglas serial        |              725,8 |              721,3 |                          581,6 |
| Reglas concurrente   |              885,3 |              897,3 |                         1065,6 |

D_A08 terminó 67 PASS/2 FAIL y calificó como control A; D_B08 terminó
69 PASS/0 FAIL y calificó como B. Ambos conservaron los 69 casos, orden,
27 capturas, primeras navegaciones, 50 muestras por perfil, cargas válidas
y huellas antes/después. Ninguno equivale al E2E completo de 103 casos.

La correlación fue **3664/3664** en D_A08 y **2253/2253** en D_B08, sin
pérdidas ni motivos de rechazo. Todos los autocostes directos por perfil
y proceso fueron ≤1%; incluso sumando conservadoramente AUT y runner si
comparten proceso, el máximo fue **0,2611%**. En progreso concurrente A,
API costó 0,4300% y host 0,6878%. No acredita ausencia de perturbación indirecta.
CPU de Chrome, Next.js y VM sigue N/D; no se atribuye CPU compartida del host
a esos procesos. La ventana formal del host en ese perfil omite los primeros
339,4 ms y últimos 60,5–60,6 ms, con muestras que delimitan sus bordes; no hay
huecos calificados superiores al 5%. La sincronización por navegación tiene
incertidumbre máxima 0,6 ms, sin estimación posterior de deriva.

### Hipótesis, predicción y límite causal

En las 50 navegaciones concurrentes de progreso A, la petición API de progreso
tuvo media 226,68 ms y p95 338,07 ms; la espera máxima del pool fue 0,432 ms.
El intervalo DOM→fin de aserciones tuvo media acotada 41,700–41,716 ms y p95
60,2 ms: no sostiene una cola posterior al DOM de segundos. La mayor ampliación
se observó antes del primer fetch de dominio y durante navegación/sesión.
Estos datos no justifican una optimización SQL ni identifican CPU del reporter.

La hipótesis comprobable fue trabajo compartido del reporter durante ese
arranque. Se reutilizó su corrección mínima B y la regresión real de Chrome
ya preservada: hashes de los tres archivos de prueba y ambos launchers idénticos,
rojo en A y verde externo en B, con reporter ausente, viewport y reintentos
conservados y fallo centinela visible. No se volvió a ejecutar ni se la presentó
como prueba de rendimiento. El muestreo CPU histórico siguió siendo exploratorio.

Antes de D_B08 se registró una predicción de reducción mínima del 50% en
dos medias de progreso concurrente, calculadas por navegación antes de agregar:

| Métrica, ms                                             |       A |      B | Reducción |
| ------------------------------------------------------- | ------: | -----: | --------: |
| Cota superior inicio runner→efecto de sesión            | 1518,72 | 208,65 |    86,26% |
| Unión de tareas largas observadas en toda la navegación |  755,46 |  92,84 |    87,71% |

Los dos umbrales se cumplieron, junto con 69/69 y los seis gates. La segunda
métrica no se limita al tramo previo al fetch ni representa CPU atribuible al
reporter. No se restaron percentiles ni se denominó renderizado puro a un
residual. La comparación instrumentada confirmó la predicción y habilitó ABBA;
**no completó por sí sola la demostración causal exigida**.

### Parada conservada y evidencia faltante

El nuevo A1 terminó **68 PASS/1 FAIL**, sin omitidos ni pendientes, con 27/27
capturas, seis perfiles completos, cargas válidas y fuentes congeladas.
PHASE-07 reprodujo su fallo, pero PHASE-08 tuvo p95 **2828,3 ms**, por debajo
del gate original. Sus 50 muestras son válidas y solo una alcanza 3000 ms,
frente a siete en D_A08 y ninguna en D_B08. La primera, separada, fue 1627 ms;
sus 1922 lecturas de fondo fueron válidas. A1 **no cumple** la expectativa
prospectiva de dos fallos; no se lo reclasifica como control conforme.

El validador registró `CONTEXT_RESULT_MISMATCH`,
`PROFILE:progress/4:GATE_MISMATCH` y `CONTROL:expectedErrorConfirmed`.
La secuencia se detuvo automáticamente; **B1, B2, A2 y CI no se ejecutaron**.
B se restauró el `2026-11-02T02:23:45.152Z`; TEST quedó detenido y sus datos
conservados. Son **8/11 campañas consumidas**, tres sin usar, y **0/1 CI final**.
El presupuesto restante no autoriza eludir esta condición de parada.

No se puede atribuir la diferencia entre A instrumentado y A sin diagnóstico
a un mecanismo concreto con estos datos: quedan por explicar reproducibilidad
y comparabilidad, incluida posible perturbación indirecta de la observación
o variación del entorno. No se añadió calentamiento, descarte, otro ajuste de
rendimiento ni repetición para obtener verde. **La causa final y el cierre
técnico local de IMP-06.04 permanecen pendientes**, con ABBA completo y CI
17/17 aún requeridos. No se acredita integración remota ni aceptación humana.

`resumption-06/` conserva autorización, protocolo, candidatos recuperables,
calificación y fallos, manifiestos, versiones/imágenes, reportes de las tres
campañas, cargas y logs saneados, predicción previa y comparación con hashes,
ledger, restauración y `stop-assessment.json`. Los inventarios de capturas
de D_A08/D_B08 acreditan nombres/dimensiones al generarse; no se afirma disponer
de un archivo retrospectivo de sus PNG. Se archivaron los 41 PNG finales de A1,
incluidos los 27 obligatorios. La documentación e índices se actualizan
después de las pruebas; no son modificaciones del candidato dentro de una corrida.

## Séptima reanudación: comparabilidad D_A08–A1 — 02/11/2026

El usuario pidió investigar la no reproducción de PHASE-08, verificar su
comparabilidad con D_A08 y continuar manteniendo aceptación y parada. Se
auditó la evidencia preservada y el código de colectores, compilación,
fixtures, carga y medición. La entrega inicial coincidió exactamente con los
792 archivos de la sexta reanudación; B permaneció activo y TEST detenido.
**No hubo otra campaña ni corrección de rendimiento sin causa demostrada.**
El rechazo de A1 y los reportes originales se conservan.

### Comparabilidad comprobada y sus límites

D_A08 y A1 conservan los mismos 792 hashes, congelados durante sus corridas.
D_B08 difiere únicamente en el launcher. Coinciden versiones registradas de
Node/npm, paquetes, Chrome y nueve IDs de imágenes; también orden de diez
specs, 69 casos, primeras separadas y 50 medidas por perfil. Los **18 p95**
se recalcularon exactamente: no hay error de nearest-rank ni cambio de umbral.

Coincide `capacity` de los tres reportes, omitiendo solo los IDs de actividad
y concepto. Es el oráculo esperado declarado por el fixture; las aserciones
HTTP/UI corroboran sus agregados comprobados, incluidos progreso 1/6,
51 intentos y 50 filas. No constituye un snapshot completo observado de BD.
El fixture regenera identificadores y fechas; el fondo consulta `c.asOf`,
mientras la navegación abre la ruta sin corte fijado. No se encontró
divergencia funcional, pero no se preservaron snapshots físicos, planes SQL
o estados de caché idénticos. `environment-audit.json` enlaza por hash
24 artefactos y seis fuentes coincidentes con los candidatos de campaña.

La diferencia explícita D_A08→A1 es diagnóstico ON→OFF. El mismo flag entra
en la compilación web y activa hooks, observadores y exportación. Igualdad de
fuentes no acredita igualdad binaria ni neutralidad de la observación. A1
tampoco conserva telemetría interna equivalente de navegador, API y host.
Seis consultas acotadas a registros Windows de energía/procesador/térmica no
encontraron eventos en las ventanas de las tres corridas; no prueba estabilidad
ni descarta cambios no registrados. No se habilitó nueva instrumentación.

### La caída del p95 es real; el fondo no desapareció

| Progreso concurrente                  | D_A08 ON | D_B08 ON | ABBA_A1 OFF |
| ------------------------------------- | -------: | -------: | ----------: |
| Media UI, ms                          |  2566,27 |  1239,19 |     2210,49 |
| p95 UI, ms                            |   3356,7 |   2016,1 |      2828,3 |
| Muestras ≥3000 ms                     |     7/50 |     0/50 |        1/50 |
| HTTP de fondo válidos                 |     1829 |      756 |        1922 |
| Media HTTP de fondo, ms               |   214,25 |   249,80 |      175,22 |
| p95 HTTP de fondo, ms                 |   371,43 |   384,81 |      320,75 |
| Solicitudes/s sobre ventana reportada |    13,78 |    11,71 |       16,63 |
| Interior con tres peticiones activas  | 99,9858% | 99,9877% |    99,9890% |

El rango 48 de 50 produce exactamente los p95 conservados. A1 tuvo máximo
3022 ms, pero una sola muestra sobre el umbral no hace fallar ese percentil.
La primera navegación sigue aparte. La diferencia A1−D_A08 es −528,4 ms en
p95 y −355,78 ms en media: diferencias descriptivas entre corridas, no efectos
causales estimados ni una prueba estadística de independencia de las muestras.

Se reconstruyeron intervalos HTTP en su propio reloj, agrupando eventos
simultáneos y comprobando ausencia de solapamiento de un mismo lector. Las
nueve cargas tienen muestras físicas válidas y una envolvente de solicitudes
al menos tan larga como la suma de navegaciones. En progreso, los mayores
huecos entre peticiones del mismo lector fueron 0,5084 ms en D_A08 y 0,2445 ms
en A1. No aparece pérdida sostenida de fondo que explique el PASS. El arnés
fija tres bucles cerrados, no QPS idéntico: A1 responde y procesa más solicitudes
por segundo. La duración reportada incluye los fingerprints inicial/final;
no es únicamente tiempo con HTTP activo.

Las medias HTTP también disminuyeron en tablero un 20,22% y reglas un 22,36%,
además del 18,22% de progreso. Hay variación más amplia, sin origen demostrado.
D_B08 mejoró la UI mientras la media HTTP de progreso aumentaba frente a D_A08:
no se equipara mejora de UI con mejora de backend ni se restan percentiles
para inferir tiempo de red o renderizado.

### Alcance del autocoste y comprobaciones offline

El coste directo AUT+runner de progreso concurrente D_A08 sumó 125,5 ms en
51 navegaciones. Mide ejecución delimitada, no toda la gestión de microtareas,
trabajo nativo de observadores, asignaciones, GC o transporte entre procesos.
ON añade una reacción por fetch y observadores; el flag compilado ejecuta
marcas incluso durante el prefijo sin colector. La recogida posterior al
cronómetro, serialización y escrituras entre perfiles pueden alterar el contexto
siguiente sin entrar en el gate anterior. El fallo de PHASE-07 vuelve a exportar
su diagnóstico desde `afterEach`. **No se demostró el efecto de esas rutas.**

`finish()` desconecta observadores y restaura fetch/hook; el spec libera el
colector. Los perfiles conservan datos planos y acotados, sin fuga demostrada.
La recuperación de capturas ocurre después de PHASE-08 y no explica su p95.
La calificación histórica conserva su significado de integridad y autocoste
directo; no se amplía retrospectivamente a neutralidad total.

El auditor privado aprobó **15/15 pruebas offline**: continuidad, huecos,
bordes, empates, solapamientos, entradas inválidas y sanitización. Se comprobó
un límite del validador histórico con un contraejemplo sintético: tres
solicitudes de 1 ms, pico tres y duración declarada larga pasan sus controles
de resumen, aunque no sostienen carga durante las navegaciones. El auditor
detecta que esa envolvente de 1 ms no cubre su suma temporal. No se modificó
ningún reporte histórico; las cargas reales sí pasan el control adicional.

La envolvente y la ocupación interior no sustituyen el alineamiento de cada
navegación con los lectores: A1 no conserva esas marcas de navegador.
El contraejemplo del validador privado tampoco es una causa de A1.
No se debilitaron ni sustituyeron los criterios de aceptación.

### Decisión y evidencia necesaria para continuar

La evidencia descarta un error de cálculo y no muestra cambios funcionales
o desaparición del fondo. **No permite decidir si la diferencia provino del
diagnóstico, del entorno o de su interacción con el reporter.** Falta un
contrafactual que separe esos factores, con compilación, datos/cortes, carga
y estado del anfitrión documentados, y perturbación de la observación evaluada
más allá del contador directo. Un foco sintético no sustituiría ese contexto
ni acreditaría aceptación de 69/103 casos.

Sin un mecanismo demostrado que habilite una corrección y una secuencia
comparable, se mantiene la parada: no se repite A hasta obtener el fallo,
no se acepta A1 retrospectivamente ni se usa CI como sustituto. Consumo
**8/11 campañas y 0/1 CI final**; tres corridas restantes tampoco completan
cuatro controles nuevos de ABBA. Ampliar presupuesto por sí solo no resolvería
la brecha causal. IMP-06.04 conserva cierre técnico local pendiente;
.05–.07, proveedores remotos y aceptación humana siguen separados.

`resumption-07/` conserva manifiesto inicial, `comparability-audit.json`,
comparador y hashes de entrada, `load-audit.mjs` con tests/log, contraejemplo
marcado sintético, `environment-audit.json`, `host-history.json` y verificación
final de entrega. Solo se actualizan artefactos privados y documentación;
producto, arnés ejecutable, medición y corrección B permanecen intactos.
No se iniciaron servicios TEST, focos de navegador ni campañas.

## Octava reanudación — comparación ON/OFF detenida (02/11/2026)

El usuario autorizó realizar una comparación controlada y conservar las
condiciones de parada. Sobre la ampliación previamente autorizada se fijó,
antes de medir, un máximo finito de **16 contextuales**: ocho consumidas,
cuatro calibraciones y cuatro controles nuevos ABBA; CI final **0/1**,
condicionada. El contador no se reinició. No se presupuestó otra corrección
ni otra D_B. Los siete lugares ahora restantes no autorizan repetir una
campaña rechazada o reanudar automáticamente una serie incompatible.

### Diseño y controles registrados antes de ejecutar

Las cuatro calibraciones usarían **A con reporter presente**, mismo prefijo
de diez specs/69 casos y orden **OFF–ON–ON–OFF**. El tratamiento es el paquete
diagnóstico completo, incluido el flag compilado, los observadores y su
efecto durante el prefijo. Un sensor externo común del anfitrión a 1 Hz se
añadió al orquestador privado en ambas condiciones; no se cambió el código
del producto, arnés ejecutable, cronómetro, fixture ni gates.

La variable primaria registrada fue la **media de las 50 navegaciones de
progreso concurrente por campaña**, con primera navegación y p95 separados.
Se compararían ON1–OFF1 y ON2–OFF2 y ambos ON con una interpolación de los
OFF usando los puntos medios reales de sus ventanas de carga. Se exigió
coherencia de signos y separación de los rangos de medias de campañas;
discordancia implica inconclusión. Son cuatro unidades experimentales, no
200 réplicas independientes. Este diseño no excluye deriva no lineal,
arrastre ni variación ambiental no medida; tampoco prueba equivalencia.

La validez de una calibración admite cualquiera de los resultados de los dos
gates concurrentes estudiados, conservando sus aserciones `<3000 ms`. Exige
los otros cuatro gates, 69 casos ejecutados, 27 capturas, primeras y 50
muestras válidas, y los errores originales exactos si falla un gate. No
reclasifica A1 ni sustituye la aceptación de ABBA. Cada carga debe conservar
intervalos físicos válidos, envolvente suficiente y al menos 95% de su
interior común con tres lectores activos; no se fija QPS constante.

El sensor común se calificó sobre las envolventes de las tres cargas
concurrentes. Coste síncrono medido, incluidos ambos bordes conservadoramente,
dividido por la suma de las 51 navegaciones: **≤1% por perfil**. Se exigieron
cero pérdidas/fallos, huecos acumulados ≤5% y divergencia observada entre
reloj de pared y monotónico ≤20 ms. No son ventanas exactas por navegación
ni prueba de neutralidad indirecta. No se atribuye CPU compartida a procesos
ni se hace atribución del anfitrión en perfiles seriales.

Las 29 instancias de contenedores ajenas a TEST se preservaron; su inventario
codificado por hash debía coincidir antes/después. Inventario constante no
significa carga constante ni exclusividad del anfitrión. Se conservaron
hashes crudos de compilados y PNG posteriores a la corrida; no se normalizan
IDs de build para declarar igualdad binaria ni se afirma identidad física
de bases recreadas con el mismo fixture.

La preparación aprobó **80 pruebas offline**: 23 del validador de calibración,
25 de calidad del sensor y 32 del analizador. Incluyen rechazo de fallos
funcionales, datos incompletos, pérdida/coste/relojes, carga discontinua,
fronteras exactas y análisis discordante o incompleto. El auditor de cargas
previo también se reejecutó con **15/15 PASS**. Son verificaciones del
instrumental, no una CI integral ni nuevas campañas contextuales.

### Resultado único: CAL_OFF1

Corrida desde `2026-11-02T05:14:29.322Z` hasta
`2026-11-02T05:37:26.297Z`, con diagnóstico del producto **OFF** y observador
externo común. Terminó **68 PASS/1 FAIL**, sin pendientes ni omitidos; el
único fallo fue la aserción original de PHASE-07 concurrente.

| Superficie | p95 serial (ms) | p95 concurrente (ms) | Resultado concurrente |
| ---------- | --------------: | -------------------: | --------------------- |
| Tablero    |          1809,3 |               4150,8 | FAIL                  |
| Progreso   |          1496,9 |               2838,3 | PASS                  |
| Reglas     |           491,7 |               2589,8 | PASS                  |

Cada perfil conserva primera navegación y 50 muestras válidas, sin errores
de carga. Progreso concurrente: media **2233,814 ms**, primera **1480,9 ms**.
La carga sostuvo tres lectores en **99,98857%** del interior común; tablero
**99,99634%** y reglas **99,96669%**. Los seis perfiles, orden y 69 casos,
27 capturas requeridas, ausencia de diagnóstico interno y congelamiento
aprobaron sus controles. Se archivaron **41 PNG frescos** y **657 hashes de
artefactos compilados**. El inventario externo y las versiones permanecieron
iguales. Esto no convierte la corrida en calibración aceptada.

### Motivo de parada y auditoría independiente

| Ventana concurrente | Autocoste medido / suma UI (ms) | Fracción | Calificación |
| ------------------- | ------------------------------: | -------: | ------------ |
| Tablero             |              3101,2385 / 152303 | 2,03623% | FAIL         |
| Progreso            |             922,3539 / 113171,6 | 0,81500% | PASS         |
| Reglas              |              591,3026 / 85408,8 | 0,69232% | PASS         |

El tablero supera en **1578,2085 ms** el presupuesto de 1523,03 ms. La auditoría
independiente recalculó contadores, bordes, denominador, huecos y relojes sin
llamar al calificador. Coinciden. Excluir la captura inferior daría 2,03542%,
excluir ambos bordes 2,03476%, y usar toda la ventana de carga 2,00566%:
ninguna sensibilidad elimina el fallo; **no se aplicaron esas alternativas**.

En esa ventana, 154 capturas tuvieron mediana 1,5093 ms, p95 139,8659 ms y
máximo 456,242 ms; once superiores a 100 ms suman 2043,7444 ms. Son tiempos
transcurridos alrededor de `hostSnapshot`, no tiempo de CPU atribuible al
sensor. No separan llamadas nativas, desalojo del proceso u otras causas;
no demuestran que `os.cpus` ni el diagnóstico causaran PHASE-08.
Hubo cero pérdidas/fallos del sensor, huecos 1,4823% y divergencia 1,23975 ms
en tablero: el rechazo se debe al coste, no a falta de cobertura o reloj.

La CPU compartida de progreso fue 86,101% sobre 12 procesadores lógicos;
es un dato descriptivo de la envolvente y no una atribución a Chrome/API.
Aunque progreso califica por separado, el protocolo exige las tres ventanas;
no se acepta parcialmente la campaña ni se descarta el perfil fallido.

La secuencia se detuvo automáticamente antes de **ON1/ON2/OFF2**. El
analizador rechazó el ledger incompleto (`LEDGER_COUNTERS_INVALID`, salida 1)
y no escribió `comparison.json`. No existe contraste ON/OFF completo que
permita separar diagnóstico y entorno. El nuevo PASS de PHASE-08 tampoco
reclasifica A1 ni satisface los controles A exigidos para el cierre.

### Estado y procedencia

**9/16 campañas consumidas; 0/1 CI final.** No se inició nuevo ABBA ni CI.
El siguiente trabajo técnico es calificar una captura del anfitrión que
cumpla el presupuesto bajo carga, distinguiendo coste medido de espera de
planificación, antes de registrar una nueva serie comparable. No se aplicó
una optimización especulativa ni se repitió hasta obtener verde. Se mantienen
la causa definitiva y el cierre técnico local pendientes.

`resumption-08/` conserva autorización, diseño, helpers/tests/logs, manifiesto
de 792 archivos y protocolo sellado
`e4c519b521725d814b7c99a5c9dc4403bd9f1c5d26f2331a6a102302102a64fb`.
La huella completa A antes/después fue
`0a30651e2600c5df5b4e458703fa37b5e404824cebbaaa6d2e0efea278212394`;
su fuente `b7b06d199c7fce69bab13827d8a92a774f19ed7c4315462d34dd38a51b5e7395`.
Se conservaron `CAL_OFF1-*`, sensor crudo, calificación y
`host-stop-audit.json`, ledger y registro de rechazo del análisis incompleto.
El launcher B se restauró con SHA256
`c0a34f6db96db9936f6e4163eb155986950661848869342af2918e8c3d73421e`.
TEST quedó detenido y los cambios anteriores se preservaron. La documentación
se actualizó después de la corrida; no hubo cambios ejecutables persistentes.

## Novena reanudación — corrección del sensor no calificada (02/11/2026)

El usuario pidió investigar y corregir el autocoste, calificar bajo carga y
retomar ON/OFF conservando límites y parada. Se verificaron los 792 hashes de
la entrega anterior. Se mantuvo el máximo **16**, con nueve campañas ya
consumidas: cuatro calibraciones nuevas más cuatro controles ABBA exigirían
**17**. No se redujeron réplicas, reutilizaron corridas rechazadas ni amplió
el presupuesto. La investigación y calificación siguientes son locales,
sin TEST/Cypress, y no consumen ni acreditan campañas de 69 casos.

### Diagnóstico acotado y candidato

Una ejecución registrada antes de medir conservó **120 capturas** por lector
con 12 trabajadores de CPU propios. Alternó el orden del snapshot original
y una copia instrumentada equivalente, dos lecturas por tick, únicamente
para localizar costes. No hubo calentamiento ni descarte. Los 120 snapshots
originales acumularon 25126,9023 ms; la copia instrumentada, 23111,2944 ms,
de los cuales **23101,8398 ms (>99,9%)** correspondieron a `os.cpus()`.
Memoria, metadatos JS, reducción y residual sumaron menos de 10 ms. La CPU del
proceso fue una observación paralela de resolución limitada, nunca una resta
al coste transcurrido. Esto localiza una frontera costosa, sin atribuir cada
pausa del historial ni distinguir bloqueo nativo de espera del planificador.

La [fuente exacta de Node 24.21.0](https://github.com/nodejs/node/blob/v24.21.0/deps/uv/src/win/util.c#L500-L601)
consulta contadores con `NtQuerySystemInformation` y después modelo/frecuencia
en el registro por procesador. Se descartó la hipótesis específica de
`CallNtPowerInformation`, ausente en esa versión. El sensor solo usa conteo
y tiempos: se formuló una corrección de lectura de contadores sin metadatos.

El candidato usó un módulo N-API síncrono en el **mismo proceso**, sin sampler
auxiliar ni caché de observaciones. Conservó clase de consulta, layout x64,
truncamiento de cada contador por CPU y suma exacta, incluido `irq`. No se
sustituyó por otra definición de CPU. Rechazaba errores, tamaños, grupos,
contadores y artefactos incompatibles, sin ceros inventados. Se verificaban
hashes de fuente/binario y Node 24.21.0/x64 antes de cargar; la carga inicial
formaba parte del intervalo medido. La preparación nativa quedaba fuera de
la captura y solo se activaba para diagnóstico.

Se usó el compilador MSVC existente y headers/import library oficiales con
SHA256 fijado desde los [checksums de Node](https://nodejs.org/download/release/v24.21.0/SHASUMS256.txt).
No se añadieron paquetes npm ni se alteró el lockfile. La consulta es una API
de Windows cuya disponibilidad/layout requieren comprobación; no se declaró
compatibilidad universal. Véase la [documentación de Microsoft](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntquerysysteminformation).

Antes de calificar, aprobaron **693 pruebas de preproducción en 33 suites**,
**55 aserciones C**, 12 comparaciones reales con lecturas anterior/posterior,
lint y formato. Una regresión con fallo inyectado en la dependencia de
inventario CPU falló en A y aprobó en el lector nuevo; no fue una avería real
del registro ni prueba del mecanismo de rendimiento. Los checks C verificaron
truncamientos, límites numéricos y ausencia de modificación de salidas ante
rechazo. La calificación privada aprobó 18 pruebas offline y el analizador
ON/OFF adaptado, 44; este último nunca se ejecutó sobre campañas reales.
Estas pruebas acreditan aspectos funcionales, **no el autocoste ni la CI**.

### Única calificación bajo carga

El protocolo se registró antes de los procesos: A anterior y B candidato,
en procesos nuevos simultáneos por perfil, 1 Hz, primera y última capturas
incluidas. Hubo 60 s sin carga inducida y 120 s con 12 trabajadores propios.
El denominador del coste fue el menor entre duración nominal y ventana real
primera→última; **no existía duración UI** en esta calificación aislada.
Se mantuvieron coste ≤1%, huecos ≤5%, divergencia de relojes ≤20 ms,
cero pérdidas/errores, carga compartida medida ≥80%, skew inicial ≤100 ms
y solapamiento ≥95%. No se descontó CPU ni se trasladó trabajo a otro proceso.

| Perfil                   |      Anterior A: autocoste |     Candidato B: autocoste | Resultado B |
| ------------------------ | -------------------------: | -------------------------: | ----------- |
| Sin carga inducida, 60 s |      58,773 ms / 0,097955% |     32,6029 ms / 0,054338% | PASS        |
| Carga, 120 s             | 34666,1215 ms / 28,888435% | 34328,5889 ms / 28,607157% | **FAIL**    |

Cada perfil sin carga produjo 61 muestras; bajo carga hubo 118 por lector,
todas retenidas. La carga compartida fue **90,881% en A y 90,880% en B**,
con 12 procesadores lógicos. En ambos, los huecos acumulados fueron 3,203075%;
la divergencia fue 2,4143 ms y 2,6570 ms. Los inicios coincidieron y se
solaparon 120197 ms. Hubo cero fallos/pérdidas del colector; los retrasos de
cadencia permanecen visibles como huecos. Los 12 trabajadores y los cinco
procesos propios terminaron correctamente. Las 16 huellas permanecieron
congeladas. El único motivo de rechazo fue `load:B:HOST_OBSERVER_COST`.

Una auditoría independiente recalculó tiempos, carga, huecos, relojes y hashes
sin llamar al calificador y confirmó el resultado. Otra revisión comprobó
las rutas: A llama `hostSnapshot` con `os.cpus()` y B toma el lector nativo,
sin fallback accidental en Windows. **Eliminar metadatos no resolvió el
criterio.** Ambas rutas conservan `GetSystemInfo` y la consulta nativa de
contadores; el resultado no identifica qué espera interna produce la demora
ni demuestra una causa de PHASE-08. La mediana/p95 del candidato bajo carga
fue 314,2069/580,2722 ms por captura, máximo 646,5453 ms.

### Parada, retirada y siguiente evidencia

No se hizo una segunda calificación, otra optimización, una repetición hasta
verde ni una campaña contextual. ON/OFF, nuevo ABBA y CI permanecen sin
iniciar. El candidato rechazado no quedó activo: se archivaron **17 archivos**
con hashes, incluidas fuentes, documentos de referencia, binario y manifiesto;
se restauraron `scripts/e2e.mjs` y `scripts/phase-observation.mjs` a sus hashes
iniciales y se retiraron únicamente cinco archivos introducidos en esta tarea,
tras comprobar ausencia inicial, ruta dentro del repositorio y copia íntegra.
No se usó reset, restore Git ni limpieza general.

Se conservaron dos pruebas nuevas en `phase-observation.test.mjs`: una captura
lenta mantiene todo su coste elapsed aunque CPU no avance, y un callback
tardío conserva su hueco sin convertirlo en coste de captura ni inventar datos.
El sensor activo anterior y la corrección B del reporter permanecen intactos.
La corrección solicitada **no quedó calificada**; el siguiente trabajo es
localizar la demora en la ruta nativa y distinguirla de planificación bajo
carga antes de proponer otra corrección y protocolo. El límite global sigue
siendo **9/16 contextuales, 0/1 CI final**, con cierre técnico local pendiente.

`resumption-09/` conserva `initial-manifest.json`, diagnóstico por componentes,
protocolo y cuatro reportes crudos de calificación, veredicto rechazado,
`qualification-stop-audit.json`, verificaciones nativas/unitarias,
`withdrawal-plan.json` y la copia `rejected-candidate/`. La fuente del candidato
rechazado fue `c3a97e67ed94b6cbf8a711bee3687cbd0bb4dab5c7097d21c47ced442712e042`;
su binario, `8e076bf2e3c174701822366ed97d925d25fb9874a3a56425832df2d239e297a7`.
La retirada posterior no modifica el veredicto ni los hashes de los archivos
archivados; no se interpreta la falta actual del candidato en la ruta activa
como pérdida de su evidencia.

Tras la retirada, la versión activa aprobó **647 pruebas de preproducción en
32 suites**, incluidas las dos nuevas comprobaciones temporales. Es el
resultado final de esa suite, distinto de las 693 pruebas del candidato
archivado; ninguno sustituye calificación de rendimiento ni CI 17/17.

## Décima reanudación — consulta nativa localizada, captura pendiente (02/11/2026)

El usuario autorizó continuar la investigación y ampliar el máximo contextual
a **17**. Se preservó el acumulado **9/17**, sin reinterpretar los rechazos.
Las ocho plazas restantes corresponden a cuatro ON/OFF nuevas y cuatro ABBA
nuevas, condicionales a una corrección demostrada y un sensor calificado.
No incluyen nuevas D_A/D_B; si fueran necesarias deberá contabilizarse su
presupuesto antes de ejecutarlas. La CI final sigue **0/1**. Los diagnósticos
privados siguientes no ejecutan TEST/Cypress ni acreditan aceptación E2E.

### Frontera demostrada y límite de atribución

Se verificó la entrega anterior de **792 archivos** y se congeló el diagnóstico
antes de ejecutar. El módulo privado conservó la fórmula por CPU de Node
24.21.0, incluido truncamiento e IRQ, y separó siete etapas con QPC.
La instrumentación de hilo propio se habilitó y restauró en cada captura;
los tiempos de CPU y ciclos permanecieron separados del tiempo transcurrido.
La carga inicial del módulo, lecturas de contadores y limpieza se conservaron.

Una sola ejecución produjo **12 pares sin carga inducida y 60 con 12
trabajadores propios**, a 1 Hz, alternando el orden original/sonda. Todas las
muestras, incluidas primera y última, permanecen. Los criterios se registraron
antes de medir: carga compartida ≥80%, huecos ≤5%, deriva ≤20 ms y al menos
seis llamadas lentas, tres por orden. La atribución a una etapa exigía ≥90%
del tiempo lento agregado y ≥90% en al menos 90% de esas llamadas.

| Resultado bajo carga                                     |                                                                  Valor comprobado |
| -------------------------------------------------------- | --------------------------------------------------------------------------------: |
| Pares y llamadas lentas                                  |                                                 60 pares; 46 lentas, 23 por orden |
| Consulta nativa / tiempo completo de las llamadas lentas |                                         10031,8593 / 10043,5464 ms = **99,8836%** |
| Dominio por llamada                                      |                                                 46/46; mínimo individual 98,1882% |
| Autocoste del lector original                            |                                              9470,7324 / 58982 ms = **16,05699%** |
| CPU compartida medida                                    |                                                 92,2673% original; 92,2531% sonda |
| Huecos y divergencia de reloj                            |                                            411 ms / 58982 ms = 0,6968%; 0,9573 ms |
| Limpieza y congelación                                   | Tres procesos, 12 trabajadores, códigos cero; 20 entradas y 792 archivos intactos |

Una auditoría independiente recalculó el resultado desde los datos crudos.
La frontera localizada es `NtQuerySystemInformation` con clase 8. Los 620
cambios de contexto dentro de esa etapa y los bits `Executive`/`WrDispatchInt`
no expresan duraciones ni separan Running/Ready/Waiting. Los ceros de CPU del
hilo tienen resolución limitada y no prueban ausencia de ejecución. Tampoco
se deduce de este ensayo una causa de PHASE-08 ni neutralidad diagnóstica.

La inspección estática de `KernelBase.dll` local, versión 10.0.26100.9949,
confirmó que `GetSystemTimes` también invoca `NtQuerySystemInformation(8)`.
No se adoptó esa alternativa a ciegas: reutiliza la frontera costosa y altera
la definición original de contadores. No se cambiaron cadencia, recursos,
prioridad, afinidad, pool, cuotas, timeouts ni umbrales para aprobar.
No hay una nueva corrección compatible y comprobada ni sensor calificado.

### Captura necesaria y bloqueo real de Windows

Se preparó un perfil WPR limitado a `CSwitch` y `ReadyThread`. Un único
intento sin elevación falló con **Access is denied, `0x80070005`**; el estado
posterior confirmó la instancia inactiva. No se obtuvo ETL, no hubo carga en
ese intento y no se reintentó ni solicitó elevación automática. Los archivos
`etw-probe/capability-20261102T1823574523363/` conservan error, estado y limpieza.

El paquete privado [Invoke-SensorTrace.ps1](../../.local/evidence/imp-06-closure/resumption-10/etw-run/Invoke-SensorTrace.ps1)
y sus [instrucciones](../../.local/evidence/imp-06-closure/resumption-10/etw-run/README.md)
quedaron preparados para **una sola ejecución manual desde PowerShell 7 como
administrador**. Verifica 26 archivos congelados y tres binarios del sistema,
usa el Node ya instalado y no instala ni cambia configuración. Registra
24 lecturas a 1 Hz con 12 trabajadores sintéticos, con guard de captura a
45 s y limpieza limitada a su propia instancia y procesos. El ETL y los
metadatos quedan privados. Un marcador persistente impide repetir el inicio.

La carga hereda el token elevado: esa diferencia está declarada y **no permite
afirmar comparabilidad con las corridas de usuario normal**. El paquete no
ejecuta la aplicación ni TEST, ON/OFF, ABBA o CI. El futuro análisis deberá
validar pérdidas, cobertura, QPC, identidad y vida del hilo antes de reconstruir
estados. Los eventos ambiguos, incompletos o contradictorios impiden atribuir
tiempos; Running indica hilo planificado, no CPU exclusiva. El lector solo
se comprobó con fixtures hasta este corte; el ETL real sigue pendiente.

### Verificaciones realmente ejecutadas

- Diagnóstico: **24/24** pruebas offline; sonda nativa v2 **102** aserciones y
  dos comprobaciones funcionales, incluida restauración del profiling.
- Sonda v3 para ETW: **125** aserciones nativas y dos lecturas funcionales en
  procesos nuevos; conserva PID/TID propios y QPC exacto por etapa.
- Ayudante de captura: **12/12** pruebas offline, sin iniciar carga ni captura.
- Lector ETW: **49** fixtures C y **16** del wrapper aprobados; el único paso
  por la API real usó un ETL vacío y verificó su rechazo, no una traza válida.
- Controlador: parser PowerShell sin errores y dos pruebas de limpieza de
  procesos propios aprobadas, por timeout y excepción posterior al arranque.
- Paquete final: hashes y perfil WPR validados sin captura ni carga; preparación
  Node `--prepare` aprobada, sin cargar el módulo ni crear trabajadores.

Los fallos de compilación y versiones previas de helpers se conservaron; las
correcciones se comprobaron antes del diagnóstico o de preparar la captura.
Las **647 pruebas de preproducción** pertenecen al cierre de la reanudación 09;
no se presentan como repetidas en este corte. Ningún foco sustituye CI 17/17.

### Huellas, parada y continuación condicionada

`resumption-10/` conserva autorización, protocolo, pares crudos, resumen,
auditoría independiente, inspección de la DLL y todos los fallos. La fuente
congelada durante el diagnóstico fue
`0cf71bfed9087dab3e3c6eb3aaa6204721744f34260c5b874dc6f2c50dccda09`.
Después solo se actualizaron siete documentos; el código ejecutable permanece
intacto. El inventario del candidato también incluye `tests/e2e/README.md`,
por lo que su huella final refleja ese cambio documental.
El binario v2 medido es
`60a19fe12ab3b6123cfdb65b264fc109e6f0d50f74d096a3108f64172df64e11`;
el v3 preparado para captura,
`2567a7a15d3aa23a55d9faad6375977fb681cd4c1a9ee8a5a14536aea9ec3628`.
El paquete manual quedó sellado con SHA256
`023f33270f480ceae0cbec33fb6b59a465af7e835405340744f57e0fe9b15bdb`;
la validación sin captura está en `etw-run/capture-20261102T1840086571515/`.

Se detienen las etapas dependientes por evidencia causal incompleta y permiso
de captura denegado. Tras la acción manual se analizará el ETL conservado,
sin repetir automáticamente. Solo una corrección demostrada, una regresión
A rojo/B verde y su calificación bajo carga con usuario normal permitirán
retomar cuatro ON/OFF y cuatro ABBA nuevas; luego, si todo aprueba, una CI
17/17 congelada. Se mantienen todas las condiciones de parada y la evidencia
histórica. **IMP-06.04 sigue pendiente, 9/17 contextuales y 0/1 CI final**;
no se inicia IMP-06.05–.07, despliegue ni aceptación humana/remota.

## Undécima reanudación — captura recibida, cobertura insuficiente (02/11/2026)

El usuario completó el comando manual desde PowerShell 7 elevado. Antes, la
ejecución con Windows PowerShell 5 se había detenido por `#requires`; otra
con PowerShell 7 sin elevar terminó con
`ADMINISTRATOR_REQUIRED_NO_START_OR_LOAD`, **cero intentos de captura y sin
carga**. Tras el reinicio se habían comprobado el paquete, los tres binarios
de Windows y los 792 archivos de la entrega, todos intactos. No se reinstaló
software ni modificó configuración del sistema desde el agente.

La captura manual efectiva quedó en
`resumption-10/etw-run/capture-20261102T1920274043987/` con estado
`trace-saved-and-session-stopped-analysis-pending`. Hubo un inicio exitoso,
24,873 s desde invocación de inicio hasta invocación de parada, cierre de WPR
exitoso y sesión confirmada inactiva. El guard terminó con código cero,
sin cancelación ni duración ambigua. El paso manual del usuario está completo;
los análisis siguientes son offline sobre ese único ETL conservado.

### Integridad y muestreo

Una auditoría independiente verificó los 21 hashes del controlador, los 26
archivos del paquete y tres binarios del sistema, más protocolo, readiness y
fuentes antes/después. Recalculó los controles desde `trace-raw.json`:

| Control                  | Resultado                                                                 |
| ------------------------ | ------------------------------------------------------------------------- |
| Muestras y carga         | 24 lecturas, 12 trabajadores propios; primera y última conservadas        |
| Ventana y CPU compartida | 23039 ms; 87,4830%                                                        |
| Huecos y deriva          | 157 ms = 0,68145%; 0,89087 ms                                             |
| Consultas lentas         | 23 superiores a 10 ms; consulta nativa total 5312,2452 ms                 |
| Limpieza                 | Dos procesos y 12 trabajadores cerrados con código cero                   |
| Controlador              | Cero pérdidas reportadas antes de detener; ETL guardado y sesión inactiva |

Estos controles acreditan el muestreo y la limpieza, **no la cobertura de los
eventos ETW ni la calificación del sensor**. La carga heredó el token elevado;
no se compara ese rendimiento con los perfiles anteriores de usuario normal.
El metadato `workloadInheritsElevatedToken` del controlador se serializó como
`SwitchParameter`; `controllerElevated` y readiness sí son booleanos `true`.
La auditoría registra esa diferencia sin modificar el artefacto capturado.

### Fallo del lector y corrección offline

El lector TDH congelado rechazó la traza tras un evento scheduler, con
`TDH_SCHEMA_UNAVAILABLE`. Una copia diagnóstica conservó el rechazo y expuso
solo metadatos: **1168 (`ERROR_NOT_FOUND`), opcode 36, CSwitch v5, 28 bytes**.
Sus 49 aserciones C aprobaron; no se adivinaron offsets ni cambió la aceptación.
El error indica esquema no encontrado, según
[TdhGetEventInformation](https://learn.microsoft.com/en-us/windows/win32/api/tdh/nf-tdh-tdhgeteventinformation).
El código 1223 de `ProcessTrace` fue la cancelación deliberada posterior al
fallo del consumidor, no otra avería independiente.

Se preparó un lector privado con **Microsoft.Diagnostics.Tracing.TraceEvent
3.2.8**, fuente y DLL coincidentes con commit
`a4f670e3e728bea7576d19e9ef3be1771fbe394d`. Se usaron los accessors tipados del
[parser oficial fijado](https://github.com/microsoft/perfview/blob/a4f670e3e728bea7576d19e9ef3be1771fbe394d/src/TraceEvent/Parsers/KernelTraceEventParser.cs),
sin copiar layouts ni añadir dependencias al producto. El soporte de v5 procede
de la ruta de compatibilidad de esa biblioteca para versiones superiores a 2;
no equivale a disponibilidad del esquema TDH. La salida retiene QPC exacto,
orden de callbacks y únicamente eventos del TID propio dentro de su vida
acreditada; no expone identidades ajenas, nombres, comandos ni payloads.

La primera versión del nuevo lector se detuvo **antes de procesar eventos**
por un guard incorrecto: esperaba que la unión devuelta por `OpenTrace`
conservara los flags de entrada. La
[fuente oficial](https://github.com/microsoft/perfview/blob/a4f670e3e728bea7576d19e9ef3be1771fbe394d/src/TraceEvent/ETWTraceEventSource.cs)
documenta que Windows restablece ese campo. La v2 separó ese valor reservado
del reloj de la cabecera y verificó la configuración RAW en la fuente/DLL
fijadas, frecuencia y ancla nativa exacta. Se preservaron fuentes, paquete y
fallo v1. La v2 aprobó **62 aserciones** de colector, filtros, sanitización y
regresión del guard; no son un oráculo binario independiente del parser.

Una lectura completa posterior sobre el mismo ETL obtuvo **832160 eventos
totales**, **831451 scheduler** —553504 CSwitch v5/28 bytes y 277947 ReadyThread
v2/8 bytes—, cero formas no soportadas y **668 eventos propios**. Los conteos
por CPU y callbacks coinciden. Cabecera nativa y biblioteca coinciden en QPC
a 10 MHz y pérdidas reportadas 0/0; el ancla nativa `5583017157` aparece
exactamente una vez. Entradas, fuentes y DLL permanecieron congeladas.

### Cobertura rechazada y parada

La cabecera del ETL de salida indica **RELOG + SEQUENTIAL**, 261 buffers de
128 KiB y 34209792 bytes. El colector original usó buffers circulares de
64 KiB: comparar 261 con 512 o leer pérdidas cero no demuestra ausencia de
sobrescritura. Véanse las definiciones de
[cabecera](https://learn.microsoft.com/en-us/windows/win32/api/evntrace/ns-evntrace-trace_logfile_header)
y [buffers de la sesión](https://learn.microsoft.com/en-us/windows/win32/api/evntrace/ns-evntrace-event_trace_properties).
El examen directo de los eventos resuelve el gate sin atribuir una causa
específica a la ausencia de datos:

- Primer bracket: QPC `5564270837`; primer evento scheduler disponible:
  `5583017157`. Faltan eventos para el inicio de **1874,632 ms**.
- Las consultas **0 y 1 terminan íntegramente antes** del primer evento.
  El inventario completo de 24 consultas no tiene cobertura scheduler.
- Los primeros eventos de las 12 CPU también son posteriores al comienzo,
  con diferencias de 1,875 a 7,875 s. Los extremos posteriores no recuperan
  el inicio ni prueban continuidad interior.

Una segunda auditoría recalculó los 24 brackets y las comprobaciones globales
y por CPU. **`decoderComplete=true` describe la lectura del archivo disponible;
`globalWindowCovered=false` y `causalAccepted=false` mantienen el rechazo.**
No se reconstruyen estados Running/Ready/Waiting, no se interpreta ausencia
como ejecución continua y no se descartan las dos primeras consultas. No se
presenta una partición parcial como aceptación ni se atribuye automáticamente
el defecto a sobrescritura circular, al kernel o a PHASE-08.

Se detienen las etapas dependientes por evidencia incompleta. No se hizo otra
captura, carga sintética, calificación, ON/OFF, ABBA, campaña contextual ni CI
durante el análisis. **9/17 contextuales y 0/1 CI final; cierre técnico local
pendiente.** La siguiente medición necesitará un mecanismo que conserve y
demuestre la ventana completa, con lector compatible verificado; no se inicia
automáticamente ni modifica umbrales, recursos del producto o condiciones de
parada. El sensor todavía no tiene una corrección comprobada.

### Evidencia preservada

`resumption-11/` conserva `initial-manifest.json`, la cabecera nativa,
`coverage-audit.json`, las versiones del lector y sus verificaciones. El ETL
original tiene SHA256
`6411e8ab6e315e2e10e4815f9e6e21412541835d8a1182871385880423e8ca69`;
el resultado v2,
`5561eba5bb85298b991e54f07acbba54644e04ae2d522fd45fc605621205dd41`;
su paquete,
`472874141931925b08ef4b68d0ccafe2426030752d97e5580cbfc3fe7dbbb42a`;
y la auditoría de cobertura,
`04c78cf2caa78c8ae16e2921622e4a21ea9999f460d8f723000a9131cd5e3aba`.
Se conservaron fallos de compilación/preparación y lecturas rechazadas, sin
sobrescribir la evidencia anterior. Solo se actualizan los siete documentos
de estado/seguimiento tras las verificaciones. Código ejecutable, B del
reporter y archivos generados se preservan. Las 647 pruebas del corte 09 no
se presentan como repetidas aquí; ninguna comprobación offline sustituye la
CI integral ni acepta IMP-06.04 o los incrementos siguientes.

## Duodécima reanudación — protocolo secuencial preparado (02/11/2026)

Alcance autorizado: resolver la retención verificable de la ventana del diagnóstico,
conservar el fallo anterior y preparar **un único intento manual**. Es una
corrección del protocolo de adquisición; no demuestra todavía la causa del
autocoste ni una corrección del sensor. Todo el código auxiliar está bajo
`.local/evidence/imp-06-closure/resumption-12/`; no cambia la aplicación,
el reporter B, los contratos, el pool, las cuotas ni los umbrales de rendimiento.

### Cambio y predicción que falta comprobar

La fuente cambia de Memory a File, con `MaximumFileSize=256 MB` y
`FileMode=Sequential` explícitos. Se conserva 64 KiB × 512 buffers y se pide
retener la fuente previa al merge en un staging propio. El nombre efectivo
del collector se comprueba en WPR; un helper nativo permite exclusivamente
`ControlTrace QUERY` sobre esa sesión propia, antes de crear carga y después
de terminarla. Sus respuestas deben demostrar modo, límites, destino, identidad,
reloj QPC y pérdidas cero. Estadísticas ausentes causan rechazo, no cero pérdidas.

La predicción es que la fuente original secuencial cubra las **24 muestras**,
incluidas las primeras. Se exige el archivo anunciado por QUERY, retenido y
finalizado tras stop, sin cap alcanzado ni pérdidas, y lectura completa con
el gate global original de extremos. El archivo combinado no sustituye esa
prueba. El perfil usa `DeletePreMergedTraceFiles=false`, bajo un elemento
documentado para uso interno: WPR aceptó el XML, pero solo el archivo real
retenido podrá acreditar el efecto. Su ausencia detendrá el trabajo.

Se preservan 24 lecturas a 1 Hz, 12 trabajadores, helper de 40 s y watchdog de
grabación de 45 s, sin calentamiento ni descartes. Se requiere 1 GiB libre y
un guard observa el tamaño de esta captura cada 500 ms, con límite agregado
de 256 MiB. Ese guard está sujeto a demora del planificador y no es una cuota
del filesystem. El cap nativo del collector es distinto del límite agregado.
La comprobación offline del tamaño ocurre antes de añadir salidas del lector;
no acredita el tamaño final de esos archivos de análisis.

Cualquier fallo de propiedad, modo, pérdida, archivo, reloj, límites, limpieza,
hash o cobertura rechaza el resultado. Un marcador permanente limita a un
intento; no hay repetición automática. El lector nuevo contrasta metadatos
nativos y Microsoft TraceEvent 3.2.8 fijado, sin particionar estados todavía.

### Verificación efectivamente realizada

| Frontera                     | Resultado y alcance                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Helper QUERY nativo          | 115 aserciones sintéticas; compilación MSVC /W4 /WX; ninguna consulta real.                                                                                                                      |
| Benchmark adaptado           | 20/20 pruebas offline; Memory rechazado y Sequential aceptado; siete dependencias nativas v3 copiadas exactamente, sin repetir las 125 aserciones heredadas.                                     |
| Controlador                  | 32/32 casos de rutas, perfil, límites y cierre; más 2 casos de limpieza del helper. Los hijos de prueba solo esperaron, sin carga de CPU.                                                        |
| Lector offline               | 72 aserciones del colector C#, 65 de protocolo y 12 nativas; cinco scripts PowerShell con sintaxis válida. No son un oráculo independiente de cada accessor binario de TraceEvent.               |
| Contraste histórico negativo | Una lectura nativa offline coincidió con los 831451 eventos scheduler del lector anterior, formas y conteos/extremos por CPU. Hashes intactos; RELOG y déficit de 1874,632 ms siguen rechazados. |
| Preparación integrada        | PowerShell 7.6.9 instalado, runtime Node 24.21.0, hashes, perfil aceptado por WPR y preparación del benchmark: PASS, cero start, cero consultas nativas y cero carga.                            |

Paquete privado congelado: **51 archivos**, SHA-256
`539df11cae3e558ff48379a47c0cc7580e1c8e49c93722ef783a7385284821e1`.
Lector: **28 archivos**, SHA-256
`4e01cc64fbd9f155761e04a1f93ed5f93e234420ffb4edbf6f93f918528a5b58`.
El manifiesto inicial verifica los **792 archivos** del corte anterior y los
artefactos generados conservados. `preflight-result.json`, los manifiestos de
build, los reportes focales y `final-delivery-manifest.json` conservan las huellas.
No se ha registrado una captura nueva ni se ha consumido otra contextual.

### Pendiente y parada

Queda una ejecución manual elevada del nuevo controlador privado; la denegación
previa `0x80070005` impide realizarla desde la sesión normal del agente. Después
se leerá el RAW sin elevación y se decidirá según la cobertura real. Un fallo
se conserva y detiene la secuencia; no se repite hasta verde.

El token elevado y el I/O del archivo son diferencias del diagnóstico y no
establecen neutralidad o equivalencia con corridas anteriores. Aun con cobertura
completa, faltarán causa demostrada del sensor, corrección mínima y calificación
con autocoste <=1% bajo carga. Solo entonces procederán la comparación controlada
OFF–ON–ON–OFF, ABBA completa y una CI 17/17; permanecen **9/17 y 0/1 CI final**.
No hay aceptación causal, calificación del sensor ni cierre técnico local.

## Decimotercera reanudación — captura retenida y parada por inventario (02/11/2026)

El usuario ejecutó el controlador preparado y entregó el resultado
`trace-saved-and-session-stopped-analysis-pending` de
`resumption-12/etw-run/capture-20261102T2014038955625`.
El análisis comprueba los artefactos existentes; no inicia otra captura,
carga, contextual, ON/OFF, ABBA o CI. Se conservan todos los paquetes
congelados y el código de producto, incluido B.

### Controles comprobados sobre la captura existente

| Control              | Resultado                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integridad inicial   | 792 archivos del corte 12 y 93 artefactos privados previos intactos; 51 archivos del paquete, 3 binarios del sistema y 28 hashes del resultado verificados.                                                   |
| Ciclo de captura     | Un start, propiedad demostrada, sesión inactiva tras stop, watchdog exit 0, sin ambigüedad; start→invocación stop 25015,3556 ms.                                                                              |
| Sesión antes/después | Sequential; flags CSwitch/Dispatcher; 64 KiB × 512 buffers; cap 256 MB; misma sesión, archivo y QPC. Pérdidas declaradas cero en ambas consultas; buffers escritos 7→711. La cabecera final ETL no fue leída. |
| Muestreo y carga     | 24/24 muestras válidas y 24 consultas lentas; CPU compartida 87,45659%; huecos 119/22998 ms = 0,51744%; deriva 0,96704 ms. Dos procesos propios y 12 trabajadores terminaron con código 0.                    |
| Archivos             | RAW declarado de 48300032 bytes, presente y hash correcto; segundo ETL de 262144 bytes no declarado en raw-artifacts. Ambos conservados.                                                                      |
| Tamaño de captura    | 97646544 bytes al auditar. Supera el snapshot del controlador en 3182 bytes, explicados exactamente por result.json (3157) y complete.json (25); inferior al límite 256 MiB.                                  |

La suma de tiempo `nativeQuery` fue 4760,0036 ms. Localiza la frontera
medida, pero no explica ejecución frente a espera ni acredita el autocoste
del observador en los perfiles de PHASE. Se conservan las diferencias de
token elevado y grabación a disco; no se declara equivalencia con A/B.

### Resultado del lector congelado

Se invocó una sola vez `Read-Capture.ps1`, sin elevación, con PowerShell
7.6.5. Salió con código 1 y `RAW_INVENTORY_MISMATCH`. El predicado requiere
exactamente un ETL bajo staging y coincidencia exacta con el RAW declarado.
La ruta coincide; la cantidad observada es dos. Esta discrepancia explica
**el rechazo del inventario**, no la causa de la demora del sensor.

La ejecución se detuvo antes de crear `offline-analysis`, ejecutar el lector
nativo o Microsoft TraceEvent. **Cero lecturas ETL, cobertura desconocida**,
sin estado reconstruido ni causa demostrada. La presencia del RAW no prueba
por sí sola finalización, pérdidas finales cero o cobertura completa.
No se cambió el guard, no se descartó el archivo adicional y no hubo retry.

La evidencia privada nueva queda en `resumption-13/initial-manifest.json`,
`offline-read-attempt.json`, `capture-integrity.json` y `method-review.json`.
La revisión independiente confirmó la cantidad y la coincidencia de ruta;
sus controles tampoco atribuyen identidad o semántica al ETL adicional.
El manifiesto final conserva huellas de ambas fuentes y del rechazo.

RAW declarado SHA-256:
`7f0a5b3ee34348e0a285526f500c70cd97ff74f58d199e53dbd87e6b8446f582`.
Paquete de captura y lector mantienen respectivamente
`539df11cae3e558ff48379a47c0cc7580e1c8e49c93722ef783a7385284821e1` y
`4e01cc64fbd9f155761e04a1f93ed5f93e234420ffb4edbf6f93f918528a5b58`.

### Parada y siguiente trabajo

El paso manual está completo; **no se solicita otra captura**. Se mantiene
la parada en el inventario. El trabajo siguiente deberá comprobar origen
y metadatos del segundo archivo antes de definir cómo validar su presencia
en un protocolo offline revisado. El nombre que contiene no basta para
considerarlo inocuo, excluirlo o atribuirle contenido. El resultado congelado
sigue rechazado y cualquier nueva verificación tendrá evidencia separada.

Aún faltan cobertura completa, causa y corrección demostradas del sensor,
calificación bajo carga con autocoste <=1%, comparación OFF–ON–ON–OFF, ABBA
y CI integral 17/17. Se conservan **9/17 contextuales y 0/1 CI final**.
No se acredita calificación, aceptación causal ni cierre técnico local.
