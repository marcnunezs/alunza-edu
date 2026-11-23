# IMP-06.04 — Implementación y verificación de revisión docente

Fecha de inicio: 01/11/2026, America/Santiago. Estado: **implementado y con
focos locales aprobados; cierre integral pendiente**.
Última revisión, 02/11/2026, decimotercera reanudación: el usuario completó
la captura secuencial manual; 24 muestras, carga, sesión, hashes y limpieza
aprobaron. El lector congelado rechazó el inventario antes de leer ETL:
staging contiene el RAW esperado y otro archivo de 262144 bytes, frente a
uno exigido. Se conserva `RAW_INVENTORY_MISMATCH`, sin excluir archivos,
cambiar guardas o repetir. **Cobertura no evaluada**, sensor sin calificar
y cierre pendiente. El paso manual terminó; no se solicita otra captura.
**9/17 campañas y 0/1 CI final**, sin nuevo ensayo o cambio de producto.
El [registro de cierre](IMP-06-signal-review-closure.md) documenta la parada
y el pendiente de clasificar el ETL adicional antes de revisar el protocolo.

Revisión histórica, 02/11/2026, duodécima reanudación: protocolo de captura
secuencial preparado y verificado, aún no ejecutado. Incorpora QUERY antes y
después de la carga, retención obligatoria del RAW y comprobación de cobertura
de las 24 muestras; conserva los límites del diagnóstico y el fallo histórico.
Pruebas focales y preparación integrada sin captura: PASS. La única ejecución
manual elevada queda pendiente por los privilegios de Windows. No hubo nueva
carga, contextual, ON/OFF, ABBA ni CI: **9/17 y 0/1 CI final**. El sensor sigue
sin calificar y el cierre pendiente. B y producto intactos; el
[registro de cierre](IMP-06-signal-review-closure.md) conserva límites, resultados
y huellas. Las pruebas del protocolo no acreditan aún retención real ni causa.

Revisión histórica, 02/11/2026, undécima reanudación: el usuario completó la
captura manual y su muestreo de 24 lecturas fue válido. Un lector offline con
Microsoft TraceEvent fijado resolvió la incompatibilidad CSwitch v5; aprobó
62 aserciones focales y terminó la lectura del ETL conservado. Sin embargo,
la traza no cubre el comienzo: faltan eventos scheduler para las consultas
0 y 1, y el primer evento está 1874,632 ms después del primer bracket.
Se aplica la parada por evidencia incompleta, sin partición de estados,
descarte de muestras ni recaptura. **9/17 campañas y 0/1 CI final**, sin nuevo
candidato de producto, calificación del sensor, ON/OFF, ABBA ni CI.
El [registro de cierre](IMP-06-signal-review-closure.md) conserva resultados,
correcciones del lector, hashes y el pendiente técnico; el código activo y B
siguen intactos. El paso manual del usuario ya terminó.

Revisión histórica, 02/11/2026, décima reanudación: el usuario autorizó continuar
y ampliar el máximo a **17** campañas. Un diagnóstico acotado de 72 pares
localizó **99,8836%** del tiempo de 46 llamadas lentas en la consulta nativa
de CPU; aún falta separar ejecución y espera para justificar una corrección.
El autocoste original bajo carga fue **16,057%**, superior al límite 1%.
Windows denegó la captura ETW con **`0x80070005`** y la instancia quedó inactiva.
Se preparó y verificó un comando privado que requiere ejecución manual con
permisos de administrador; la captura real sigue pendiente. No se calificó
el sensor ni se retomó ON/OFF. **9/17** campañas y **0/1** CI final, sin
nuevas contextuales, ABBA ni CI; código activo y B del reporter intactos.
El [registro de cierre](IMP-06-signal-review-closure.md) conserva resultados,
límites, pruebas del paquete y los rechazos anteriores. El cierre sigue pendiente.
Solicitud: implementar únicamente el [plan autorizado](IMP-06-signal-review-plan.md).
Contrato: [diccionario incremental](IMP-06-signal-review-dictionary.md).

## Alcance y estado inicial

ALZ-RF/HU/CU/PT-019 E1–E4; UX-10/11; RNF-SEG-01/02/03/05,
RNF-USA-01–04, RNF-CON-02/04, RNF-REN-01/04 y RNF-IA-05.
Base: cierre local .03, episodios/revisión interna IMP-05 y árbol con cambios
previos que se conservan. No se modifican evidencias Office ni seed canónico.

El usuario resolvió solo matrícula activa; clases archivadas conservan consulta.
La revisión no añade estados, notas, intervenciones ni llamadas IA.

## Implementación

La migración `20261101172048_signal_review.sql` incorpora la operación
autorizada `app_private.signal_review(uuid)`. Conserva el guard exclusivo del
worker y extrae un núcleo privado de captura; la revisión usa el presente,
sin borrar actor/sesión ni reutilizar un corte antiguo de continuación.
La transacción bloquea permisos y relojes en orden, captura la base inmutable,
registra revisión y auditoría única y sincroniza la proyección. Un lease vigente
produce conflicto recuperable. La política restrictiva de auditoría impide
falsificar SIGNAL_REVIEWED mediante permisos anteriores del rol de aplicación.

NestJS publica el PUT con cuerpo vacío estricto, correlación, validación dentro
de la transacción y readiness de la nueva función. Contratos/OpenAPI añaden
`reviewedByName` como etiqueta actual, sin alterar UUID/fecha originales.
Tablero y detalle comparten confirmación, cancelación, recuperación con GET
actual y limpieza de contenido al perder acceso. La actualización al presente
reinicia el corte y los cursores; confirmar no altera la consulta histórica.

## Verificación

Los resultados siguientes corresponden a ejecuciones locales reales. La CI
integral conserva sus fallos y no equivale a 17/17 aprobado. La inspección de entorno detectó runtime Node
global distinto al fijado; se usa scripts/use-node.ps1 para activar únicamente
en la shell el runtime local 24.21.0/npm 11.19.0, sin cambiar dependencias.

| Comprobación                      | Resultado comprobado                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contratos focales                 | 12/12 en 3 suites: revisión, tablero y detalle.                                                                                                       |
| Unidad API focal                  | 35/35 en revisión y app; build API y lint focal aprobados.                                                                                            |
| Unidad web                        | 83/83 en 12 suites; typecheck web/E2E y lint focal aprobados.                                                                                         |
| Resumen de rendimiento            | 3/3 pruebas unitarias del arnés aprobadas.                                                                                                            |
| Formato completo                  | `npm run format:check` aprobado.                                                                                                                      |
| HTTP/pgTAP E1–E4 y negativas      | Candidato final aprobado: 9/9 HTTP y 1311 aserciones SQL en 20 archivos, `2026-11-01T17:36:31.696Z`.                                                  |
| Actualización .03→.04             | Aprobada con candidato final, `2026-11-01T17:38:30.153Z`; hashes históricos iguales, readiness 503→200 y replay conservado.                           |
| Cypress revisión y regresiones    | Foco nuevo 8/8 aprobado sin omisiones, `2026-11-01T17:52:39.648Z`; CI2 repitió los ocho aprobados y terminó 101/103 globales.                         |
| Rendimiento API/UI                | Ocho perfiles API y dos UI aprobados; detalle y límites abajo.                                                                                        |
| CI completa 17 etapas             | CI2: 15 aprobadas, E2E falló y evaluación de ayuda no ejecutada dentro de esa corrida. Cierre integral pendiente.                                     |
| Regresión de tablero corregida    | Foco completo aprobado 8/8, sin fallos ni omisiones, `2026-11-01T19:57:58.493Z`; conserva revisión y cero PUT en consulta.                            |
| Evaluación de ayuda independiente | Aprobada `2026-11-01T20:17:04.225Z`: 234 muestras, cobertura 43/43, tres reanudaciones y cero llamadas externas; proveedor TEST.                      |
| Calificación PHASE-08             | Formato/lint/tipos, API 902, web 101 y preproducción 616 aprobados; ajuste posterior del guard 60/60 focales y controles estáticos. No equivale a CI. |
| D_A08 / D_B08                     | Observación calificada: A 67 PASS/2 FAIL esperados; B 69/69 y seis gates aprobados. Predicción instrumentada confirmada.                              |
| Nuevo ABBA_A1                     | Rechazado: 68 PASS/1 FAIL; PHASE-08 p95 2828,3 ms no reproduce el fallo. Sin B1/B2/A2 ni CI final.                                                    |

El primer intento del foco unitario de API falló en una aserción nueva de logs:
Jest restauraba el spy de stdout instalado en beforeAll. Se corrigió el propio
test para instalarlo durante el caso, siguiendo los casos vecinos; la repetición
aprobó 35/35. No se eliminó la comprobación de ruta normalizada ni de secretos.

La primera actualización .03→.04 aprobó con hashes iguales para los datos
preexistentes, incluidas ocho entregas, cuatro ayudas y una revisión histórica.
La revisión cruzada posterior detectó que la captura pública necesitaba también
el bloqueo de relaciones y cobertura que usa la finalización del worker ante
cambios DDL. Se incorporó antes de capturar y se añadió un noveno caso HTTP con
barrera real de cobertura. Por ese cambio se repitieron el foco y la actualización;
el primer resultado se conserva como antecedente, no como prueba del ajuste.

La primera ejecución del control negativo nuevo tuvo 8/9 HTTP aprobados y
falló al preparar la sustitución temporal de la función: el usuario de migración
no era su propietario. La función final quedó intacta y SQL no llegó a ejecutarse.
Se ajustó el arnés TEST para usar temporalmente el propietario interno y restaurar
sus privilegios; la corrida fallida se conserva en el historial de reportes.

La repetición aprobó el control negativo (commit prematuro sin protección),
restauró exactamente definición y permisos, y verificó que la función final
espera al escritor de cobertura antes de capturar. El corte persistido es
posterior a la liberación observada. También aprobaron las dos sesiones Auth
independientes y la conservación de proyección tras rollback/replay.

Comandos de los focos integrados: `npm run test:signal-review:integration`,
`npm run test:signal-review:upgrade`, `npm run test:e2e -- --signal-review` y
`npm run test:signal-review:performance`. Los cuatro están aprobados. Los reportes y sus corridas anteriores
se conservan en `.local/reports/imp-06/` y su subdirectorio `history`.

La actualización final conservó el hash
`acb54725b724ee235c9073bb695b3ef51a0aa94ba2e8cbf596efdc6a3d17ed40`
antes/después de aplicar .04 sobre .03. El reporte `signal-review-upgrade.json`
incluye conteos y hashes por tabla, revisión HTTP posterior y ausencia de grant
al helper privado. No se ejecutó migración remota.

### Navegador y rendimiento local

Chrome 156.0.8078.74, Cypress 16.0.0, Windows; Auth/NestJS/PostgreSQL de LAB TEST,
web de producción local y Docker para el SUBMIT funcional del fixture.
El foco de ocho recorridos aprobó sin pendientes ni omitidos. Las tres capturas
1440×900, 768×1024 y 390×844 conservaron sus dimensiones; inspección visual de
Codex confirmó diálogo/botones completos y foco visible. La comprobación de
teclado es automatizada; no acredita WCAG completa ni aceptación humana.

| Superficie                          | Muestras por perfil                | p95 serial (ms) | p95 carga 4 (ms) |
| ----------------------------------- | ---------------------------------- | --------------- | ---------------- |
| API primera revisión                | 50 + 50 episodios distintos        | 57,92           | 95,36            |
| API replay                          | 50 + 50 sobre los mismos episodios | 34,74           | 39,94            |
| UI confirmar → REVIEWED renderizado | 50 + 50 episodios distintos        | 276,50          | 1619,00          |

API reinició el servicio para cada superficie/perfil: primeras muestras separadas
de 1/4 solicitudes con p95 93,35/189,01 ms para primera revisión y
64,23/131,81 ms para replay. Total 210 solicitudes, 105 episodios, cero fallos,
105 revisiones y 105 auditorías verificadas. La huella completa inicial/final
fue `74e46d7390af813a02f9a5644d251cf6364b8b300bb8f9fdcdae6e2ab49d6d53`.

UI separó primeras muestras de 195,80/342,10 ms; son primeras del perfil con
servicios ya iniciados, no arranque frío. Mide desde confirmar hasta dos frames
tras renderizar REVIEWED. Carga cuatro significa un Chrome y tres clientes
HTTP de replay sobre episodios separados: 9324 requests de fondo, cero fallos,
pico tres y sin timeout. Se usaron 102 episodios nuevos para las 100 muestras
calientes y dos primeras; la preparación/navegación queda fuera de la latencia.
Ambas huellas UI quedaron estables. Los fixtures de capacidad usan resultados
canónicos deterministas explícitos; no acreditan 105 ejecuciones Docker ni
capacidad productiva o remota. Todas las muestras y errores se conservan.

Reportes: `signal-review-api-performance.json`, `signal-review-ui-performance.json`,
`e2e-signal-review.json` y `signal-review-ui-screenshots.json` en
`.local/reports/imp-06/`. El objetivo local es p95 <3000 ms con cero errores.

### CI integral

El primer `npm run ci:verify` terminó FAIL a las `2026-11-01T18:25:42.566Z`:
11 etapas aprobadas y fallo en la primera de tres series SUBMIT. Aprobaron
formato, lint, tipos, **2287 pruebas Jest**, ejecutor/fixtures, RUN e integración
**230/230 HTTP y 1311 aserciones SQL**. Las etapas posteriores no se ejecutaron
en esa corrida; no se presenta como CI 17/17.

SUBMIT conservó 100 respuestas válidas y cero errores, pero p95 serial/concurrente
2395,34/5280,16 ms: el segundo excede el gate de 5000 ms. Las únicas cuatro
muestras concurrentes ≥5000 ms pertenecen al primer lote frío (5051,33;
5280,16; 5416,04; 5496,03); se conservan dentro del resultado. El p95 caliente
4566,51 ms no convierte el perfil completo en PASS. La demora observada se
concentra en ejecución/Docker; los percentiles anidados no se suman.

La comparación con .03 conserva mismo perfil y configuración del entorno,
pero distinto candidato/digest de imagen; no constituye un A/B causal. El
historial ya registraba variabilidad de este gate y no explica el fallo actual.
No se cambiaron runner, recursos, cuotas, frío, muestras ni umbrales, ni se
detuvieron servicios de otros proyectos.

Un único diagnóstico adicional con
`npm run test:practice:performance -- --submit --continuous-diagnostics`
aprobó a las `2026-11-01T18:31:50.777Z`: 100 respuestas válidas, cero fallos,
p95 2735,35/4239,40 ms y p95 del primer lote c4 3566,74 ms. Candidato,
configuración y limpieza permanecieron estables. El observador puede añadir
coste; este resultado separado no sustituye el gate ni demuestra causa del
pico anterior. Se ejecutó una única CI integral adicional para comprobar el
candidato completo, sin repetir indefinidamente hasta obtener PASS.
Los datos Docker del observador fueron parciales, con registros INVALID_DATA;
no se imputaron ceros ni se atribuyó a las cápsulas una causa no demostrada.

Los 774 archivos de código/documentación permanecieron idénticos durante CI1:
huella completa `7d114bcf6c1d8e1099af8a0a196d5f13910f7f20638f3d0539c7023c8bdbddad`;
huella de fuentes `3f4c4bfc108a9064127a3f7e5be8581acb4727c4cb8e62f571d99343dc8a733a`.
Evidencia aditiva: `.local/evidence/imp-06/ci-attempt-1.json`,
`ci-attempt-1-error.log`, `ci-attempt-1-submit-performance.json`,
`ci-attempt-1-frozen-result.json` y `submit-continuous-diagnostic.json`.
El registro se actualizó después de cerrar esas corridas y permaneció
congelado durante CI2.

La segunda `npm run ci:verify` terminó FAIL a las
`2026-11-01T19:51:11.286Z`: **15 etapas aprobadas**, E2E falló y la última
etapa de evaluación de ayuda no se ejecutó dentro de CI2. Aprobaron de nuevo
formato, lint, tipos, **2287 Jest**, ejecutor/fixtures, **230/230 HTTP y
1311 aserciones SQL**, RUN, integración IA y las tres series SUBMIT consecutivas.
Cada serie conservó 100 respuestas válidas y cero errores:

| Serie SUBMIT CI2 | p95 serial (ms) | p95 carga 4 (ms) |
| ---------------- | --------------- | ---------------- |
| 1                | 2381,88         | 4820,76          |
| 2                | 2325,94         | 4919,70          |
| 3                | 2470,98         | 4886,38          |

Cypress completo terminó **101/103**, cero pendientes y cero omitidos, a las
`2026-11-01T19:51:04.149Z`. Los ocho escenarios IMP06-REVIEW aprobaron otra vez;
la revisión UI tuvo p95 284,20/1396,30 ms, 50 muestras por perfil y cero errores.
El detalle docente aprobó sus perfiles con p95 748,00/1627,40 ms. Hubo dos fallos:

- **IMP05-DASH-03:** la prueba esperaba «Marcar revisada» después de comprobar
  que la señal era REVIEWED. El contrato .04 conserva responsable/fecha y
  no presenta una nueva acción para ese estado. Se corrigió la expectativa del
  test para exigir esos datos, ausencia del botón y cero PUT, conservando la
  comprobación positiva de acción para otra señal ACTIVE. No cambia producto.
  El foco completo de tablero aprobó 8/8 después de esa corrección, sin
  pendientes ni omitidos (`2026-11-01T19:57:58.493Z`).
- **IMP05-PHASE-07:** dashboard de capacidad con carga cuatro tuvo p95
  **3762,40 ms**, superior al gate **3000 ms**; 11/50 muestras alcanzaron
  al menos 3000 ms, con cero errores. Los tres lectores de fondo completaron
  950 solicitudes sin fallos. El perfil serial aprobó con 1267,60 ms.
  La huella permaneció estable. La revisión estática no encontró consultas
  adicionales antes de abrir evidencia; el nuevo nombre del responsable es
  null para las señales ACTIVE de este fixture. Hay más código cliente y un
  campo adicional, pero el reporte no separa red/renderizado ni demuestra
  causalidad. No se justifica una corrección de rendimiento acotada a .04
  con esta evidencia; no se relaja el umbral ni se descartan muestras.

Los **774 archivos** permanecieron idénticos durante CI2: huella completa
`f99d216503a44657a1f754f518d9199798bee263a55815472e611a9ad9ec7599` y la misma
huella de **617 fuentes** de CI1. Copias de evidencia en
`.local/evidence/imp-06/`: `ci-attempt-2.json`, `ci-attempt-2-e2e.json`,
`ci-attempt-2-error.log`, `ci-attempt-2-e2e-error.log`,
`ci-attempt-2-frozen-result.json`, `ci-attempt-2-submit-1.json` a `-3.json`,
`ci-attempt-2-phase-ui-performance.json`,
`ci-attempt-2-signal-review-ui-performance.json` y
`ci-attempt-2-student-detail-ui-performance.json`.

El ajuste posterior solo al test DASH-03 y a la documentación generó una
huella nueva; no se atribuye a ella una CI integral aprobada. Se ejecutaron
`npm run test:e2e -- --dashboard` y `npm run test:help:evaluation` por separado,
con resultados aprobados conservados sin sumarlos como una corrida CI 17/17.
El código de producto permanece igual al candidato de los focos y de CI2.

La evaluación de ayuda terminó a las `2026-11-01T20:17:04.225Z`: **234 muestras,
cobertura 43/43**, 763 recibos y tres reanudaciones. Sus dos perfiles completaron
100/100 ayudas cada uno y aprobaron los objetivos servidor/API. Usó el proveedor
TEST y cero llamadas externas; la latencia visible en navegador permanece
`blocked-no-browser-evidence`, sin acreditar Azure ni calidad pedagógica o
aceptación humana. TEST se detuvo y liberó su lock al terminar.

Código y documentación permanecieron congelados durante ambos focos finales,
incluida toda la preparación y evaluación de ayuda: **774 archivos idénticos**,
huella completa `e3d1e713df28db591a2379f895fa13e5aac6637f4701ef6a05449e9cc84e1286`;
**617 fuentes**, huella
`a3668d5925f09b575b0e3dc37f99552f83ec56685a18e786e97e385aba60a88a`.
La única fuente distinta de CI2 es `tests/e2e/dashboard.cy.ts`; los otros once
cambios son documentos. Se conserva `final-checks-frozen-before.json` y
`final-checks-frozen-result.json` en `.local/evidence/imp-06/`, junto con
`final-e2e-dashboard.json`, `final-help-evaluation-test.json`,
`final-help-evaluation-measurements.json` y `final-help-evaluation-ledger.json`.
La actualización documental de este cierre se hizo después de las pruebas;
formato y enlaces locales se verificaron, sin alterar producto ni umbrales.

**Trabajo pendiente para cierre integral:** resolver y verificar PHASE-07
con evidencia suficiente, preservando su p95 fallido y los antecedentes de
SUBMIT. No se declara causa ni CI 17/17 aprobada y no se inicia IMP-06.05–.07.

### Campaña posterior de cierre técnico

El [protocolo de cierre autorizado](IMP-06-signal-review-closure.md) añadió el
modo contextual de 69 casos y observación optativa exclusiva de TEST. D_A terminó
el `2026-11-01T21:14:45.534Z`: **60 PASS, 1 FAIL, 8 SKIP**, con los diez specs
en el orden previsto. Los ocho casos de dashboard, incluido DASH-03, aprobaron.
Una colisión de nombres introducida en el instrumental (`process.env` frente
a la función local `process`) impidió inicializar PHASE-01; el cierre del fixture
también falló y PHASE-07 quedó omitido. No hay un nuevo p95 ni causa demostrada
del fallo histórico.

Los 783 archivos completos y 627 fuentes quedaron idénticos durante D_A, con
huellas y versiones recuperables en su registro. La observación es inválida por
falta de perfiles/contexto; los costes por perfil son N/D. Se detuvo la campaña
conforme al plan: una corrida contextual, sin B, D_B, ABBA ni CI final. Después
se corrige el instrumental con regresión unitaria, conservando el fallo original;
esa corrección no acredita rendimiento ni cierre integral. El protocolo enlazado
detalla pruebas, artefactos y siguiente evidencia necesaria.

El usuario autorizó repetir D_A con el arnés corregido. La reanudación terminó
el `2026-11-01T21:47:55.400Z`, con fuentes/documentación congeladas: **56 PASS,
3 FAIL y 10 SKIP**. PHASE-07 sí se ejecutó y volvió a incumplir el gate:
p95 serial/concurrente **1842,5/3951,8 ms**, 50 muestras válidas por perfil y
963 lecturas concurrentes sin errores. La instrumentación correlacionó
1473/1473 peticiones y sus autocostes directos quedaron por debajo de 1%.

Sin embargo, BANK-05 y el hook previo a FND-01 fallaron al recuperar la API,
provocando diez omisiones. Un arranque tardó 107143,86 ms, con 100417,17 ms en
importación; su causa no está demostrada. El diagnóstico quedó inválido por
contexto incompleto/fallos adicionales y se aplicó la parada autorizada: sin
B, D_B, ABBA ni CI final. No se atribuye a ese arranque la causa de PHASE-07.
La [evidencia de reanudación](IMP-06-signal-review-closure.md) conserva todos los
perfiles, huellas, controles del observador y límites. El cierre sigue pendiente.

Una segunda reanudación autorizada investigó el arranque y corrigió la carga
anticipada de SDKs de IA: validación sin proveedores y construcción síncrona
con las mismas credenciales, transporte, errores y límites. La regresión pasó
de 7 fallos esperados/6 controles aprobados a 13/13; aprobaron 378 pruebas IA,
887 API, tipos, lint y formato. No se afirma que ese trabajo evitable explique
por sí solo el intervalo histórico de importación de 100,4 s.

La nueva D_A terminó el `2026-11-01T22:26:00.852Z` con **68 PASS, 1 FAIL y 0 SKIP**.
Banco y fundación aprobaron; cinco arranques API registraron 2,21–4,48 s, bajo
el mismo control de 30 s. PHASE-07 falla solo en el perfil concurrente: p95 serial/concurrente
**2019/3393 ms**, 50 muestras válidas por perfil, cero errores y 950 lecturas
de fondo válidas. La observación fue válida: 1460/1460 peticiones correlacionadas.
Los 786 archivos completos y 630 fuentes permanecieron congelados. La evidencia
se conserva en `resumption-02/` dentro del directorio de cierre; el protocolo
enlazado distingue la corrección de arranque de la causa pendiente de PHASE-07.
No se ejecutaron B, D_B, ABBA ni CI final; IMP-06.04 mantiene cierre pendiente.

### Corrección del arnés y D_B favorable — 01/11/2026

La [tercera reanudación](IMP-06-signal-review-closure.md) localizó trabajo costoso
en el panel de comandos de Cypress, que seguía renderizándose en Chrome sin
ventana. La única corrección de rendimiento es `runnerUi: false` en el launcher.
Una regresión real falló en A y aprobó en B: panel ausente, viewport y reintento
conservados, con un fallo centinela que Cypress sigue reportando. Los focos CPU
A/B respaldan la reducción del trabajo del controlador, pero su coste no está
calificado para aceptación y no sustituyen campañas contextuales.

La única D_B terminó el `2026-11-01T23:19:50.544Z` con **69 PASS/0 FAIL/0 SKIP**,
diez specs en orden y 27 capturas verificadas. PHASE-07 registró p95 serial/
concurrente **1809,9/2428,1 ms**, frente a 2019/3393 ms en D_A. Los seis perfiles
de tablero, progreso y reglas conservaron 50 muestras válidas, primeras
navegaciones separadas y cero errores; todos los gates aprobaron. La media
residual concurrente fuera de fetch bajó de 1399,062 a 448,154 ms (**67,968%**),
cumpliendo la predicción. La observación fue válida, con **1070/1070 peticiones
correlacionadas**, sin pérdidas/huecos reportados y autocostes ≤1%.

Durante D_B quedaron congelados 789 archivos y 633 fuentes. También aprobaron
formato/lint y **572 pruebas de preproducción/31 suites**; el nuevo verificador
rechazó correctamente un fallo inducido de lectura de integridad. Los reportes,
huellas y límites completos están en `resumption-03/` y en el registro enlazado.

La tercera reanudación se detuvo con **4/6 campañas contextuales usadas**: quedaban dos,
pero ABBA completo requiere cuatro. No se abrevia ni amplía el protocolo; ABBA
sigue 0/4 y CI final 0/1. D_B favorable no acredita repetibilidad causal, 103 E2E
ni CI 17/17. **El cierre técnico local de IMP-06.04 permanece pendiente.**

### Ampliación a ocho campañas y parada en A1 — 01/11/2026

El usuario amplió el límite global de seis a ocho para completar ABBA y autorizó
una CI final solo si sus controles aprobaban. Las cuatro campañas previas
siguen consumidas. El protocolo auxiliar pasó 77 comprobaciones offline y se
selló antes de ejecutar; A/B difieren únicamente por `runnerUi: false`.

La única corrida, A1 sin diagnóstico, terminó el `2026-11-02T00:09:03.910Z`
(01/11 en Santiago): **67 PASS/2 FAIL/0 SKIP/0 pendientes**, diez specs completos
en orden. PHASE-07 reprodujo el fallo esperado con p95 serial/concurrente
**2213,7/4081,8 ms**, pero PHASE-08 también falló con **1851,8/3110,1 ms**.
PHASE-09 aprobó con **854,1/2701,7 ms**. Cada perfil mantuvo 50 muestras válidas,
primera navegación separada y cero errores; las cargas de fondo fueron válidas.
Las capturas quedaron en **24/27**, con fase 15/18. El control requería un único
fallo de PHASE-07 y fue rechazado; no se relajó el criterio después de la corrida.

Los 789 archivos, 633 fuentes y protocolo permanecieron congelados; se verificó
entorno y se restauró B con su hash conocido, conservando los cambios anteriores.
**ABBA: 1/4 ejecutado, cero controles conformes; B1/B2/A2 y CI no iniciados.**
Consumo global **5/8**, saldo tres y **0/1 CI final**. Se aplica la parada aunque
quede presupuesto. Sin diagnóstico en A1 no se atribuye causa a PHASE-08 ni
se afirma que B lo resuelva. La evidencia está en `resumption-04/` y en la
[cuarta reanudación del registro de cierre](IMP-06-signal-review-closure.md).
Falta explicar el rechazo de A1 antes de plantear otra campaña; IMP-06.04
conserva cierre técnico local pendiente.

### Investigación de PHASE-08 y límite de continuación — 01/11/2026

La quinta reanudación auditó las muestras y el código de A1 frente a D_A/D_B.
Los p95 de los 18 perfiles comparados se recalcularon exactamente. Progreso
concurrente tuvo cinco de 50 navegaciones ≥3000 ms en A1, frente a una en D_A y
cero en D_B; sus 1902 solicitudes HTTP de fondo fueron válidas y sin timeouts.
También se degradó la medición de reglas. Estos datos no permiten atribuir el
fallo a SQL, al pool, al navegador o al reporter de Cypress.

Se identificó la brecha de observación: los colectores de navegador, rutas API
y agregadores del modo diagnóstico cubren tablero, no PHASE-08. Activar ese
flag sin ampliar y calificar los sensores no resolvería la atribución pendiente.
Se mantuvo la corrección B existente; su regresión real volvió a aprobar con
panel ausente, reintento y viewport conservados, y el fallo centinela reportado
(2 PASS/1 FAIL deliberado). No prueba rendimiento ni sustituye 69/103 E2E.

Los 789 archivos permanecieron congelados durante la investigación y regresión.
No se aplicó otra corrección sin mecanismo demostrado ni se ejecutaron campañas
contextuales o CI. El consumo permanece **5/8 y 0/1 CI**. A1 sigue rechazado;
reiniciar ABBA exige cuatro campañas con solo tres disponibles, mínimo global
nueve sin contar nuevos diagnósticos. El cierre no cabe bajo las restricciones
vigentes. La [quinta reanudación](IMP-06-signal-review-closure.md) conserva
hipótesis, evidencia faltante y artefactos en `resumption-05/`, sin reclasificar
fallos ni atribuir un cierre técnico local.

### Instrumentación calificada y nueva parada de ABBA — 01/11/2026

La sexta reanudación amplió el máximo autorizado a once campañas, manteniendo
las cinco consumidas y una CI final condicionada. Se añadieron diagnóstico de
progreso, sus tres spans API, correlación y costes por superficie/perfil, y un
guard que recupera las tres capturas originales después del fallo final de p95
sin cambiar medición, navegación ni resultado. La configuración sigue limitada
a TEST y desactivada por defecto. No cambian contratos, SQL, recursos o cuotas.

D_A08 calificó con 67 PASS/2 FAIL y correlación 3664/3664; p95 concurrentes
4481,2 ms en tablero y 3356,7 ms en progreso. D_B08 aprobó 69/69, seis gates
y correlación 2253/2253; p95 respectivos 2777,2 y 2016,1 ms. Todos los costes
directos exigidos fueron ≤1%, sin pérdidas. La única diferencia A/B fue la
corrección existente `runnerUi: false`, con regresión real previa verificada
por hashes. Su predicción registrada antes de B se cumplió: demora media hasta
el efecto de sesión −86,26% y unión media de tareas largas −87,71% en progreso
concurrente. No se atribuye CPU ni se completa causalidad con esa comparación sola.

El nuevo A1 sin diagnóstico terminó 68 PASS/1 FAIL: tablero concurrente
3962,0 ms falló, pero progreso concurrente 2828,3 ms aprobó y no reprodujo
el fallo previsto. Conservó los 69 casos, 27 capturas, cargas y fuentes.
Se activó la parada automática, sin B1/B2/A2 ni CI; B restaurado y TEST
detenido. Consumo **8/11 y 0/1 CI final**, sin reclasificar ningún A1 histórico.
Falta explicar la reproducibilidad/comparabilidad antes de otra campaña;
la demostración causal requerida, ABBA completo y CI 17/17 siguen pendientes.

La [sexta reanudación del registro de cierre](IMP-06-signal-review-closure.md)
detalla calificación, fallos conservados del foco de capturas y su suplemento
funcional limitado, muestras, relojes, candidatos, predicción y artefactos de
`resumption-06/`. Las actualizaciones documentales son posteriores a las pruebas.

### Auditoría de comparabilidad D_A08–A1 — 02/11/2026

La séptima reanudación confirmó los mismos 792 archivos A, versiones e imágenes
registradas, contexto y métrica. Los 18 p95 se recalcularon exactamente; A1
conserva p95 de progreso concurrente 2828,3 ms, con una de 50 muestras ≥3000 ms,
frente a siete en D_A08. Coinciden los oráculos declarados, corroborados por las
aserciones HTTP/UI acotadas; no equivale a un snapshot físico idéntico de BD.

La reconstrucción de las nueve cargas y las 15/15 pruebas privadas del auditor
descartan una pérdida sostenida del fondo: progreso tuvo tres peticiones activas
en el 99,9858% del interior de D_A08 y el 99,9890% de A1. La tasa efectiva fue
mayor en A1. También bajaron las medias HTTP de tablero y reglas: la variación
no se limita a progreso. Un contraejemplo sintético confirmó que pico tres y
duración total no bastan por sí solos; las muestras reales pasan la comprobación
adicional de envolvente, sin afirmar alineamiento exacto por navegación.

El diagnóstico ON/OFF también cambia el flag de compilación web. El autocoste
directo ≤1% no acota toda perturbación de colas, GC, observadores o exportación
entre perfiles. A1 carece de telemetría equivalente para separar esos efectos
del estado del host. Seis consultas acotadas a registros Windows no aportaron
eventos ni una causa; su ausencia no prueba estabilidad. No se demostró una fuga
ni una alteración funcional de medición, consultas o respuestas.

Se conserva la comparación instrumentada favorable a B, pero no acredita la
reproducción requerida sin diagnóstico. La parada sigue vigente: **8/11 y
0/1 CI**, sin nuevas campañas ni B1/B2/A2. No se cambió el criterio de A1 ni
se aplicó otra corrección sin mecanismo demostrado. La
[séptima reanudación](IMP-06-signal-review-closure.md) conserva métodos,
evidencia, límites y lo necesario para plantear una continuación comparable.

### Cobertura de aceptación

| Escenario | Oráculo y evidencia comprobada en los focos                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HU-019-E1 | PUT real, responsable/fecha del servidor, una revisión/auditoría, hashes de intentos/resultados/ayuda/eventos intactos; confirmación desde tablero y detalle.                   |
| HU-019-E2 | UUID/body/query inválidos, ámbitos ajenos y estado concurrente; histórico anterior sigue ACTIVE sin datos futuros del revisor; lease ocupado no se roba.                        |
| HU-019-E3 | Revocación con JWT previo, matrícula retirada/deshabilitada, perfil inactivo, archivo y reasignación mientras espera un lock; rechazo y retiro de contenido protegido en UI.    |
| HU-019-E4 | Dos sesiones del docente y replay conservan primer resultado; pérdida de respuesta después del commit se recupera por lectura; reconstrucción no reactiva el episodio revisado. |

Cancelación por botón/Escape exige cero PUT y cero cambio persistido. El fallo
inyectado al insertar auditoría exige rollback de episodio, revisión, snapshot,
evento y proyección. La actualización conserva datos .03, ayudas TEST entregadas
y revisión privada histórica, sin fabricar auditoría retroactiva.

## Límites

Solo datos ficticios y servicios locales. Azure, Sandbox productivo, despliegue,
CI Linux y aceptación docente/CAPSTONE no se acreditan con estas pruebas.
Los incrementos IMP-06.05–.07 permanecen fuera del encargo.
