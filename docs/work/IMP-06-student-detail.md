# IMP-06.03 — Detalle docente de estudiante

Fecha: 27/10/2026, America/Santiago. Implementación del
[plan aprobado](IMP-06-student-detail-plan.md), limitada a ALZ-RF/HU/CU/PT-017
E1–E4 y UX-11. Este registro distingue implementación, pruebas observadas y
aceptación; no acredita despliegue ni aceptación humana/remota.

**Estado: cierre técnico local de IMP-06.03.** La CI final aprobó 17/17
etapas el 28/10 a las 02:00:29 UTC (27/10 en Santiago), con código y documentación
congelados hasta su término. Los fallos y repeticiones anteriores se conservan
por separado a continuación. IMP-06.04–.07 siguen pendientes.

## Implementación

La página `/clases/[classId]/estudiantes/[studentId]` se abre desde el tablero
y conserva filtros, paginación y corte al regresar. Reúne identidad mínima,
última actividad, progreso acumulado por actividad/concepto, observaciones del
período, intentos con código de solo lectura, ayudas entregadas y señales.
Las consultas no generan solicitudes de ayuda, ACK, actividad ni revisiones.

Las nueve rutas GET docentes tienen DTO estrictos en
`packages/contracts/src/student-detail.ts` y OpenAPI generado. El profesor
ACTIVE debe seguir asignado a la clase y el alumno pertenecer a su matrícula
CURRENT_ACTIVE. ADMIN no obtiene acceso pedagógico. Cada consulta usa
`DatabaseService.readAs` con el actor docente y vuelve a autorizar los permisos
actuales, también con cortes históricos. Las señales filtran al estudiante
antes de contar y paginar, incluida su frescura de procesamiento.

Solo se muestra ayuda con FEEDBACK_VIEWED o HINT_DELIVERED persistido hasta
`asOf`. Se excluyen preparaciones y presentaciones sin confirmación, incluso
por ID. Una revocación conserva metadatos y marca `available:false`, `help:null`.
Las referencias se reautorizan; la descarga valida hash/tamaño y repite la
autorización después de Storage. Código, diagnóstico y versión fijada se
conservan; pruebas ocultas solo aportan `hiddenChecksPassed`.

La migración `20261027182430_student_detail.sql` añade funciones y permisos
mínimos, sin tablas ni backfill. Reutiliza núcleos de progreso/observaciones y
mantiene los wrappers del tablero. El
[diccionario](IMP-06-student-detail-dictionary.md) detalla firmas, orden,
cursores y restricciones. No se añadieron dependencias ni cambios al lockfile.

## Verificación observada

Entorno: LAB TEST exclusivo, Windows, Node 24.21.0/npm 11.19.0,
Supabase 2.101.0 y Docker local. Los proveedores de embeddings/ayuda son TEST;
no se ejercitan Azure OpenAI ni Vercel Sandbox productivos.

- API focal: 31/31 pruebas entre `student-detail.spec.ts` y `app.spec.ts`;
  incluyen consultas sin escritura, UUID canónicos, proyección pública,
  corrupción de bytes y revocación entre las dos autorizaciones de descarga.
- Contratos .03 y progreso: 8/8 pruebas; filtros estrictos, microsegundos,
  entregas, coherencia de ámbito y resultados públicos.
- Web focal inicial: 31/31 pruebas en cinco archivos. Tipos y lint focales
  aprobados; ajustes posteriores se vuelven a validar en las suites finales.
- OpenAPI generado y tipos API aprobados.

Primer foco `test:student-detail:integration`: **5/7 HTTP**, sin ejecutar SQL
porque HTTP falló. `from` mal formado producía 500 al llegar al comparador de
microsegundos compartido; se añadió validación de formato antes de convertir a
BigInt y la regresión de contrato aprobó. La preparación de revocación de una
fuente recibió 403 porque usaba al profesor para una operación reservada a ADMIN;
se corrigió el actor del fixture, sin ampliar permisos de producto.
Se conservan los artefactos `student-detail-integration-attempt-1.json` y
`student-detail-integration-attempt-1-error.log` en `.local/reports/imp-06` y
`.local/evidence/imp-06`, respectivamente. No se convierte este intento en PASS.

El primer ensayo SQL independiente aprobó los 18 archivos anteriores y 46
aserciones del nuevo archivo, pero abortó al preparar ayuda: el fixture llamó
`help_fallback`, que no está concedida al rol de aplicación. Resultado observado:
FAIL, 19 archivos y 1172 aserciones antes del aborto, sin cierre TAP del archivo 019. El resumen separado queda en `student-detail-sql-attempt-1.json`; la
corrección pertenece al fixture y no amplía permisos de ejecución.

La repetición SQL independiente aprobó **19 archivos y 1216 aserciones**,
incluidas las 90 nuevas del detalle. Conserva informe y log `student-detail-sql-attempt-2`.

Segundo foco HTTP: **5/7**, sin SQL posterior. Las fechas inválidas ya devolvieron 422. Las nuevas comprobaciones de reasignación/descarga reutilizaban un ámbito
cuya ayuda había sido suprimida al retirar/deshabilitar al estudiante; la
restauración de permisos no debe resucitarla. Se aislaron los ámbitos y se añadió
la aserción de supresión permanente. Se conservan el informe y log `attempt-2`.
La preparación espera capacidad real de la cuota de ayuda, sin modificar fechas,
cuotas ni hechos; esa espera queda fuera de las mediciones de rendimiento.

`test:student-detail:upgrade` aprobó a las **18:41:12 UTC**: .02→.03,
readiness 503→200, ocho funciones con permisos mínimos y nueve rutas verificadas.
Los snapshots de 36 tablas distintas (38 entradas, dos alias repetidos de señales)
coinciden antes/después de migrar y después de las lecturas. Incluyen ocho
intentos, cuatro ayudas, seis eventos de ayuda y dos episodios. Huella común:
`23be5b9904b1e059d450fdae21e0303165b06e3338d68c4dcfef734aee6396ed`.
Informe: `.local/reports/imp-06/student-detail-upgrade.json`.

El tercer foco `test:student-detail:integration` aprobó a las **18:49:53 UTC**:
**7/7 HTTP y 19 archivos/1216 aserciones SQL**. Incluye aislamiento del mismo
alumno en dos clases, ADMIN/docentes ajenos, permisos actuales con JWT anterior,
retiro/deshabilitación/reasignación, filtros/cursor, ayuda solo entregada,
corrupción de Storage (503) y revocación tras leer Storage (404 sin bytes).
Los snapshots confirman ausencia de nuevos eventos, ayuda, llamadas IA o cambios
en evidencia. pgTAP prepara resultados/recibos sintéticos; HTTP usa envíos Docker
y el pipeline de ayuda TEST. Informe: `student-detail-integration.json`.

Primer foco Cypress, **18:58:10 UTC**: **5/7**, cero omitidos. DETAIL-01 comparaba
textualmente `Z` y `+00:00` del mismo instante; se conserva precisión mediante
comparación de microsegundos. DETAIL-06 se detuvo porque `cy.focus()` rechaza
`summary`; se verifica foco nativo y la activación real por teclado sin cambiar
el componente para acomodar al arnés. No se capturaron los tres tamaños en esta
corrida. Filtros, revocación con contenido abierto, respuesta obsoleta, ayuda
entregada/revocada, recuperación y ambos perfiles de rendimiento aprobaron.
Se conservan informe/log `e2e-student-detail-attempt-1` y los perfiles
`student-detail-ui-performance-attempt-1`/`student-detail-ui-load-attempt-1`.

`test:student-detail:performance` aprobó las nueve superficies API: **900 muestras
calientes y 45 consultas iniciales en 18 perfiles**, sin errores; 50 seriales y 50 a
concurrencia cuatro por superficie. Los 36 perfiles aprobaron el gate <3000 ms.
Mayor p95 caliente: **133,90 ms** (descarga concurrente); mayor p95 inicial:
**254,21 ms** (misma superficie). La API se reinicia entre perfiles, y la huella
de todos los archivos permaneció idéntica. Informe con cada muestra:
`.local/reports/imp-06/student-detail-api-performance.json`. Los datos incluyen
siete intentos de la clase y tres asignaciones requeridas; no es un ensayo de
capacidad productiva ni de proveedores remotos.

La segunda corrida Cypress aprobó a las **19:10:22 UTC: 7/7**, cero fallos,
pendientes u omitidos. Se comprobaron navegación/retorno con filtros y corte
exactos, paginación, evidencia Docker, ayuda TEST/cita/descarga, señales,
revocación con código/ayuda visibles, descarte de respuesta tardía y recuperación.
El recorrido por teclado incluye activación de `summary`, fuentes, diálogos,
Escape y retorno del foco al disparador. Las capturas 1440×900, 768×1024 y
390×844 aprobaron dimensiones y fueron inspeccionadas visualmente: contenido
legible, controles adaptados y ausencia de desbordamiento horizontal.

| Medición de pantalla    | Muestras c1 / c4 | p95 c1 / c4 (ms) | Primera navegación c1 / c4 (ms) | Resultado                              |
| ----------------------- | ---------------- | ---------------- | ------------------------------- | -------------------------------------- |
| Cypress inicial, 18:58  | 50 / 50          | 592,20 / 1177,80 | 691,30 / 422,20                 | Rendimiento PASS; recorrido global 5/7 |
| Cypress repetido, 19:10 | 50 / 50          | 614,20 / 1012,10 | 406,10 / 535,20                 | Rendimiento PASS y recorrido 7/7       |

Ambos perfiles conservaron cero errores. Cada corrida tiene copias separadas
`student-detail-ui-performance-attempt-N` y `student-detail-ui-load-attempt-N`.
El perfil c4 representa un Chrome más tres lectores HTTP, con servicios ya
iniciados y ayuda previamente entregada; no mide la latencia de generación de
ayuda ni cuatro navegadores. La huella completa del ensayo API fue
`238c293fcffe2210e50295f8235acb07847c5c2ecc71afadf67e28eac4400752`;
este registro se actualizó después de terminar la medición.

El candidato previo a CI contiene **599 archivos de fuentes**, con huella
`2309beea421f83ece9224b340a331c9382a3a231a315bb2049a8b498ee746464`.
`format:check` completo y `git diff --check` aprobaron antes de congelar; el
lockfile conserva sus bytes anteriores. La comprobación de artefactos del build
E2E no encontró secretos ni canarios de adaptadores privados.

La primera CI terminó FAIL a las **19:14:47 UTC**, tras aprobar formato, lint y
tipos. Tres pruebas de contratos fallaron: la nueva representación OpenAPI del
JSON recursivo contenía referencias relativas sin trasladar a componentes, y
dos selectores antiguos incluían rutas docentes dentro de ayuda personal o
gestión de materiales. Se corrigieron las referencias generadas y se delimitaron
los selectores conservando sus conteos y aserciones. Los cuatro archivos de
pruebas afectados aprobaron **22/22** en los focos posteriores. Se conservan
`ci-student-detail-attempt-1.json` y `ci-student-detail-attempt-1-error.log`;
esta corrida no se presenta como CI aprobada. Las correcciones se hicieron
después de finalizar la corrida, sin editar durante su ejecución.

El segundo candidato conserva 599 archivos de fuentes, con huella
`d514ee5f39ebf49960753b72caa652cecf88a36c853b82332e1029ea97953bd3`.

La segunda CI terminó FAIL a las **19:51:39 UTC**, en la etapa 14. Aprobó
2259 pruebas Jest en seis grupos, 221/221 HTTP y 1216 aserciones SQL en 19
archivos. Sus tres series SUBMIT conservaron 100 muestras cada una y cero
errores funcionales; p95 concurrentes **3575,54 / 4135,30 / 8116,25 ms**.
La tercera excedió el gate de 5000 ms, con nueve respuestas concurrentes por
encima del umbral. La demora se concentró en ejecución y fases Docker; los
percentiles de fases se solapan y no se suman. Limpieza, imagen, candidato y
entorno permanecieron estables. No se demostró causa térmica, de carga externa
o regresión del detalle, ni se cambiaron recursos, runner o umbrales.
Se conservan `ci-student-detail-attempt-2.json`, su log y las tres series
`ci-student-detail-attempt-2-submit-N.json`.

La tercera CI terminó FAIL a las **20:10:27 UTC**, durante integración:
**220/221 HTTP**, incluidos los siete nuevos aprobados. SIG-14 excedió el
límite de 30 s de un proceso de mantenimiento. El arnés descartaba la salida
acumulada al vencer el plazo, por lo que no identificó cuál de los cuatro hijos
ni su fase. La revisión no encontró una fuga de conexión o bloqueo de pipes
demostrado. Se conservan el informe CI3 y sus logs general/de integración.

Un diagnóstico posterior mediante `node scripts/signals-integration.mjs`,
con preload temporal exclusivamente en `.local`, aprobó a las **20:17:03 UTC**:
**17/17 HTTP de señales y 19 archivos/1216 aserciones SQL**. Conservó el límite
de 30 s y todas las aserciones. Los hijos check/helper/rebuild/report duraron
**1715,46 / 1286,41 / 2363,83 / 2262,24 ms**, con exit 0 y stderr vacío.
La observación registró fases/importación/cierre y cantidades de salida, sin
argumentos privados ni contenido. El timeout no se reprodujo; su causa sigue
sin demostrarse. Informe `signals-maintenance-diagnostic-1.json` y eventos
`signals-maintenance-diagnostic-1.jsonl`. La CI siguiente se ejecutó sin preload.

La cuarta CI terminó FAIL a las **21:23:39 UTC**, con **15/17 etapas aprobadas**.
Conservó 2259 Jest, 221 HTTP, 1216 SQL y aprobó IA TEST. Las tres series SUBMIT
consecutivas aprobaron con 300 respuestas válidas y cero errores:

| Serie de CI4 | p95 serial (ms) | p95 concurrencia 4 (ms) |
| ------------ | --------------- | ----------------------- |
| 1            | 2259,20         | 4344,52                 |
| 2            | 1984,26         | 4231,03                 |
| 3            | 2183,19         | 3928,75                 |

Cypress terminó **94/95**, cero pendientes u omitidos. Los siete casos del
detalle docente aprobaron. PHASE-02 consumió mediante un alias general una
consulta anterior del tablero al comprobar el nuevo corte histórico: el alias
mezclaba las lecturas auxiliares de opciones y los resultados filtrados.
La corrección del arnés debe correlacionar filtros/cursor/corte y conservar las
aserciones de respuesta y pantalla; no se encontró un fallo semántico del corte
en el frontend. Su validación posterior se registra en los focos siguientes.
El reporte completo vigente de Cypress está en `.local/reports/imp-01/e2e.json`;
la copia específica es `e2e-student-detail-ci-attempt-4.json`, con su log separado.
El reporte genérico antiguo de `imp-06/e2e.json` no representa esta corrida.

En CI4, la pantalla del detalle aprobó 50/50 muestras c1/c4 y cero errores:
p95 **894,90 / 1460,20 ms**, primera navegación **414,90 / 888,50 ms**.
Las tres capturas también aprobaron. Se conservan las copias
`student-detail-ui-{performance,load,screenshots}-ci-attempt-4.json`.
El build y la comprobación de artefactos aprobaron sin valores privados ni
canarios de adaptadores de servidor. La evaluación de ayuda no se ejecutó en CI4.

Las CI2, CI3 y CI4 conservaron la huella completa de **753 archivos**
`6d6e86d8df100339cd139bc0c3b6d909a16599d49bc020265eb8be4893264726`.
La comparación final de CI4 registró cero archivos cambiados antes de estas
ediciones documentales y de la corrección del arnés. Los resultados de corridas
distintas no se combinan para atribuir una CI 17/17.

La primera validación de la correlación, `test:e2e -- --phase`, terminó a las
**21:37:49 UTC: 7/9**, cero pendientes u omitidos. PHASE-02 confirmó el corte
histórico y falló después en una nueva espera del reset: la navegación canceló
la consulta del componente anterior, por lo que no había respuesta que leer.
Se sustituyó únicamente esa espera añadida por URL vacía y el resultado visible
original `1/360`; se mantienen las comprobaciones de consultas, cortes y páginas.
PHASE-07 registró **3376,30 ms** en p95 concurrente del tablero de capacidad,
sobre 3000 ms, con 50 muestras válidas y cero errores; las otras cinco
combinaciones superficie/concurrencia aprobaron. En CI4 ese perfil obtuvo
2951,30 ms. Las medianas fueron 2291,00 y 2323,70 ms respectivamente, con cinco
y dos muestras sobre 3 s. No se demostró una causa del cambio en la cola de
latencias; no se modificó el producto, la carga ni el umbral. Se conservan
`phase-correlation-attempt-1.json`, su log, sus perfiles y la comparación CI4.

La segunda validación focal aprobó a las **21:49:16 UTC: 9/9**, sin fallos,
pendientes u omitidos. Verificó corte histórico, reset, las 201 evidencias sin
duplicados y las demás regresiones de fase. Los seis perfiles conservaron 50
muestras cada uno y cero errores; p95 serial/concurrente del tablero
**1489,00/2861,70 ms**, progreso **638,60/1404,40 ms** y reglas
**455,00/1053,80 ms**. Se conservan informe/log/perfiles
`phase-correlation-attempt-2`, separados del foco fallido. Esta aprobación no
demuestra que la variación previa de latencia esté resuelta.

El candidato corregido contiene **599 archivos de fuentes**, huella
`dd15df61b046cbbd19fd57e98840ddfc3e51dfd4a16d4fb865e3282aefb187f5`.
Los cambios posteriores a CI4 se limitan al arnés PHASE-02 y este registro;
no alteran comportamiento del producto, muestras ni umbrales.

La quinta CI terminó FAIL a las **22:53:48 UTC**, con **15/17 etapas aprobadas**:
2259 pruebas Jest, 221/221 HTTP, 19 archivos/1216 aserciones SQL, RUN,
las tres series SUBMIT y la integración IA TEST aprobaron. Cada serie SUBMIT
conservó 100 respuestas válidas, cero errores y candidato/entorno estables:

| Serie de CI5 | p95 serial (ms) | p95 concurrencia 4 (ms) |
| ------------ | --------------- | ----------------------- |
| 1            | 3350,52         | 4077,18                 |
| 2            | 2156,59         | 4755,75                 |
| 3            | 2119,62         | 3943,69                 |

Cypress terminó a las **22:53:41 UTC: 94/95**, sin pendientes u omitidos.
PHASE-02 y los siete casos DETAIL aprobaron. El único fallo fue PHASE-07:
el tablero de capacidad a concurrencia cuatro obtuvo **3003,80 ms** de p95,
frente al límite estricto de 3000 ms, con 50 muestras válidas y cero errores.
Su mediana fue 2270,20 ms y tres muestras alcanzaron o superaron 3000 ms.
Las otras cinco combinaciones superficie/concurrencia aprobaron. El umbral,
las muestras y el fallo se conservan; no se presenta como PASS por su cercanía
al límite ni se atribuye todavía una causa. Los informes y logs de CI5 son
independientes de CI4 y de los dos focos PHASE posteriores.

La pantalla del detalle aprobó en CI5: 50/50 muestras seriales/concurrentes,
cero errores, p95 **622,80/1339,20 ms** y primeras navegaciones
**820,40/921,80 ms**. Las capturas de los tres tamaños también aprobaron.
El build y el control de artefactos aprobaron sin valores privados ni canarios
de adaptadores de servidor. Se conservan `ci-student-detail-attempt-5.json`,
`e2e-student-detail-ci-attempt-5.json`, sus logs y los perfiles
`student-detail-ui-*-ci-attempt-5` y `phase-ui-*-ci-attempt-5`.

La CI se detuvo antes de evaluar ayuda. Se ejecutó por separado
`npm run test:help:evaluation`, manteniendo todo el candidato congelado desde
el comienzo de CI5. Aprobó a las **23:12:46 UTC**, proveedor TEST, **234 muestras**,
**43/43 casos cubiertos**, cero llamadas externas y tres reanudaciones verificadas.
Las series serial/concurrente conservaron 100/100 ayudas exitosas, sin fallback;
p95 hasta persistencia **678/2819 ms** y hasta respuesta API **804,97/3036,89 ms**,
ambos bajo el objetivo de ayuda de 12000 ms. Sigue pendiente la latencia de ayuda
visible en navegador (`BROWSER_RENDER_EVIDENCE_UNAVAILABLE`) y la evaluación
pedagógica humana. Informes `help-evaluation-student-detail-attempt-1.json` y
`help-measurements-student-detail-attempt-1.json`; los informes previos de .02
se copiaron antes de su actualización. Este PASS separado no convierte CI5 en 17/17.

La comparación final a las **23:12:57 UTC** confirmó cero archivos cambiados
en los **753 archivos** del inventario: huella completa
`44a6ccf85da532f05a8e14122b23538738ebbbd9cff8bc51ffc185881c5ddab6`.
Las 599 fuentes conservaron la huella `dd15df61b046cbbd19fd57e98840ddfc3e51dfd4a16d4fb865e3282aefb187f5`.
El código y la documentación permanecieron congelados durante toda CI5,
incluida la preparación y ejecución posterior de evaluación de ayuda;
este registro se actualiza después de comprobar ambas huellas.

El diagnóstico SQL posterior terminó a las **23:19:19 UTC**. Comparó cuatro
variantes actuales/anteriores mediante ocho pares alternados por variante:
**64 mediciones y ocho calentamientos**, con el fixture oficial de 60 alumnos,
201 intentos, 360 requeridos y 51 señales. Los JSON resultaron idénticos.

| Mediana SQL (ms)       | Actual | Anterior |
| ---------------------- | ------ | -------- |
| Procesamiento, wrapper | 52,27  | 56,68    |
| Procesamiento, NULL    | 37,62  | 43,76    |
| Tablero                | 89,89  | 89,32    |
| Señales                | 83,81  | 85,45    |

Los ocho planes anidados confirmaron estimaciones distintas y un Hash Join
en lugar de Nested Loop en el ámbito de procesamiento; el núcleo actual usó
784 buffers frente a 1840, sin lecturas físicas ni temporales. No se observó
regresión material SQL serial; este diagnóstico no equivale al perfil UI c4
ni explica su cola de latencias. Los clones temporales conservaron propietario,
SECURITY DEFINER/INVOKER, configuración y roles llamantes originales. El rollback
dejó idénticos hechos de 68 tablas, funciones, roles y permisos.
Informe `student-detail-sql-ab.json` y planes/snapshots en
`.local/evidence/imp-06/sql-ab/`.

Se conservan dos fallos de preparación del diagnóstico: el primero rechazó
Node global antes de medir; el segundo completó las 64 mediciones pero el rol
local no pudo cargar `auto_explain`. La recuperación comprobó primero su rollback
y capturó únicamente los planes mediante la cuenta técnica local, manteniendo
los roles de aplicación durante las consultas. No se repitieron ni descartaron
tiempos, ni se cambiaron permisos permanentes.

El diagnóstico de navegador terminó a las **23:30:56 UTC: 8/9**, con el mismo
fallo PHASE-07 y las otras cinco combinaciones de rendimiento aprobadas. La
instrumentación temporal conservó las aserciones, 50 muestras por perfil,
tres lectores y límite de 3000 ms. Registró 102 navegaciones (100 calientes),
cero errores de observación/desbordamientos y p95 serial/concurrente
**1076,50/3141,70 ms**; cuatro muestras concurrentes alcanzaron 3000 ms.
Los tres lectores tuvieron 1018 respuestas y cero fallos.

No hubo solicitudes ni recursos hacia el nuevo detalle de estudiante. Cada
navegación realizó una lectura de identidad, clase, organización, tablero y
señales; las diez precargas RSC observadas pertenecían a rutas existentes.
Las tareas largas aumentaron con carga y parte de la demora apareció antes
de solicitar identidad, cuando aún no existían filas o enlaces de alumnos.
Esto no demuestra causa térmica, del pool, SQL o JavaScript específico.
El informe instrumentado sirve para diagnóstico, no para acreditar cierre.
El archivo de prueba se restauró byte por byte; la huella completa antes/después
coincidió: `32d16f9ccf5b536076d9985ebc527da35e64ef2f080ca20b13ec9ced2ba79e46`.
Informe, análisis, log y manifiesto:
`.local/evidence/imp-06/phase07-ui-diagnostic-2026-10-27T23-21-17-267Z*`.

La cadena observada permite un ajuste acotado en `class-dashboard.tsx`:
organización y tablero se consultan en paralelo después de validar clase,
docente activo y filtros. El hook de organización permanece en el padre para
no añadir lecturas al paginar; la vista y el formulario esperan su zona horaria.
Reintentar organización recarga también el tablero activo, evitando reutilizar
evidencia anterior al fallo. No se alteran consultas SQL, cálculos, permisos,
precargas, muestras o umbrales. Formato, lint, tipos web y 16 pruebas unitarias
existentes aprobaron; su efecto de rendimiento requiere medición.

PHASE-05 incorpora además dos órdenes adversos: organización 503 después de
recibir un tablero real 200, recuperación con ambas respuestas reales nuevas,
y organización recuperada mientras el tablero renovado sigue pendiente y
termina 403. Exige ausencia de métricas anteriores durante la espera y tras el
rechazo; usa cifras independientes del fixture y conteos exactos de consultas.
Conserva sus escenarios originales de revocación y los nueve IDs del foco.
Formato, lint y tipos E2E aprobaron; el recorrido integrado queda pendiente.

El foco normal `npm run test:e2e -- --phase`, sin instrumentación, aprobó a las
**23:44:58 UTC: 9/9**, cero pendientes u omitidos, incluida la nueva regresión
de recuperación y rechazo de PHASE-05. Los seis perfiles conservaron 50 muestras
cada uno y cero errores; las 18 capturas del foco también aprobaron.

| Pantalla | p95 serial (ms) | p95 concurrencia 4 (ms) |
| -------- | --------------- | ----------------------- |
| Tablero  | 1044,90         | 2937,10                 |
| Progreso | 934,00          | 1479,40                 |
| Reglas   | 462,80          | 1179,40                 |

El tablero conservó tres lectores, pico de tres solicitudes y 908 respuestas
de fondo sin fallos. La comparación final a las **23:45:06 UTC** confirmó
idénticas huellas completa
`b418621cd8f4c3432b23523dc10f0fb8ca4488dd1333185a9656fcafc6a0f961`
y de 599 fuentes
`57ae889ec6307319af0378c0d82a8a2192f79638f5fe83fe905efcbc40a4f51d`.
Se conservan informes, perfiles y logs `phase-parallel-loading-attempt-1-*`
y `phase-parallel-loading-freeze-{start,end}.json`. El PASS no identifica una
causa única de la variación previa; acredita este perfil normal del ajuste
de carga, con sus fallos anteriores preservados.

La sexta CI terminó FAIL a las **23:55:02 UTC**, durante la preparación de
integración. Aprobó sus primeras nueve etapas, incluidas **2259 pruebas Jest en
seis grupos**, formato, lint, tipos, ejecutor Docker y fixtures académicos.
Las migraciones de TEST se aplicaron, pero la API no alcanzó HTTP 200 en
`/health/ready` dentro del límite existente de 30 s. El único marcador de su
arranque fue `MATERIALS / IMPORTS_START`; no llegó a `IMPORTS_COMPLETE`.
Los casos HTTP/SQL de esa corrida no se ejecutaron. No se atribuye este fallo
de preparación al ajuste de carga del navegador ni se cambia el timeout.
Se conservan `ci-student-detail-attempt-6.json`, su informe de integración y
los logs general/de integración separados.

La comparación final a las **23:55:29 UTC** confirmó cero cambios en los
753 archivos: huella completa
`af87a2ed73b0d341f56cf8e4600538a6e116fb68c18926922297af4ecddcc128`;
las 599 fuentes conservaron `57ae889ec6307319af0378c0d82a8a2192f79638f5fe83fe905efcbc40a4f51d`.
El diagnóstico de importación terminó a las **23:58:12 UTC: 3/3 PASS**.
Tres procesos nuevos de Node 24.21.0 cargaron los siete módulos exactos del
entrypoint, sin invocar configuración, fábrica API, proxies ni DB, con el
mismo límite parental de 30 s. Las importaciones duraron
**5237,58 / 1157,04 / 1184,27 ms**, concentradas en `app.js`; los tres hijos
terminaron naturalmente con exit 0 y stderr vacío. Las fuentes permanecieron
idénticas. Informe y fases individuales en
`.local/reports/imp-06/ci6-import-diagnostic/`.
El bloqueo no se reprodujo y no se demostró causa de disco, CPU o antivirus;
esta prueba de importación tampoco acredita por sí sola readiness HTTP.
La comparación de inventarios CI5→CI6 encontró únicamente cambios en el
componente de tablero, PHASE-05 y este registro; no hubo cambios adicionales
en fuentes API ni archivos eliminados. Se mantienen los límites existentes.

La séptima CI terminó FAIL el **28/10 a las 00:27:54 UTC** (27/10 en Santiago),
con **11/17 etapas aprobadas**. Aprobó 2259 Jest, **221/221 HTTP**, **1216
aserciones SQL en 19 archivos** y RUN. La observación de readiness obtuvo HTTP
200 a las 00:18:47 UTC; el bloqueo de importaciones de CI6 no se reprodujo.
RUN conservó 100 respuestas válidas y cero errores, con p95 serial/concurrente
**1521,63/2616,05 ms** y limpieza/candidato/entorno estables.

La primera serie SUBMIT tuvo **100 respuestas válidas, cero errores** y p95
**2413,41/4198,15 ms**, ambos bajo 5000 ms. Falló exclusivamente la comprobación
`environmentUnchanged:false`; limpieza, imagen y candidato permanecieron
estables. La CI se detuvo y no ejecutó las series siguientes ni las etapas
posteriores. Se conservan `ci-student-detail-attempt-7.json`, informes de
integración/RUN/SUBMIT y el log de esta corrida, sin reclasificarla como PASS.
La comparación final de los 753 archivos a las **00:28:31 UTC** fue idéntica:
`0b98521a2f3d22b99d9fc26cf87df621fa20ffa8389710aef21ce7a64d2025ef`;
las 599 fuentes mantuvieron `57ae889ec6307319af0378c0d82a8a2192f79638f5fe83fe905efcbc40a4f51d`.

El diagnóstico Docker posterior fue de solo lectura. A las **00:31:19 UTC**,
la configuración y la huella de cargas coincidían de nuevo con la instantánea
inicial: 12 CPU, 16520081408 bytes, Docker 29.7.2 y 8 contenedores de laboratorio
más 22 de otros ámbitos. Los contenedores TEST están excluidos de esa comparación.
La ventana del fallo no devolvió eventos; la consulta ampliada recuperó 255,
todos posteriores a las 00:31:09 UTC. No demuestra ausencia de cambios durante
el ensayo. Al no haberse persistido la instantánea final, la causa histórica
quedó inconclusa. Informes saneados en `ci7-environment-diagnostic/`; no se
modificaron contenedores, configuración ni DB.

Se añadió únicamente `finalEnvironmentManifest` al informe del arnés de
rendimiento, junto a la instantánea inicial ya existente. La comparación,
perfiles, umbrales y limpieza siguen intactos. Formato, lint y sintaxis aprobaron;
se verificará su captura en un foco SUBMIT con fuentes y documentación congeladas.

Ese foco aprobó el **28/10 a las 00:38:06 UTC**: 100 respuestas válidas,
cero errores, p95 serial/concurrente **3200,49/4380,93 ms**. Ambas instantáneas
quedaron guardadas y coincidieron; también aprobaron limpieza, imagen y candidato.
La huella completa de 753 archivos fue idéntica antes/después:
`4d6e1e9349038e699fac05414a86b9040cc6f5fef8614726c94cf4f3186606ba`;
las 599 fuentes conservaron
`b04d76eac9d9741d6a880261c3d69ac56c59022c6633067e2e58678529c494e1`.
Se conservan informe/log `submit-environment-recheck-attempt-1` y las
instantáneas `submit-environment-recheck-freeze-{start,end}.json`.
Este resultado verifica la captura añadida y ese perfil; no identifica la causa
histórica de CI7 ni sustituye las tres series consecutivas de la CI completa.

### CI final y cierre local

La octava CI, iniciada a las **00:38:55 UTC**, aprobó **17/17 etapas** a las
**02:00:29 UTC del 28/10/2026** (27/10 en Santiago). Formato, lint, tipos y
**2259 pruebas Jest en seis grupos** aprobaron. También aprobaron preparación,
diagnóstico y ejecución Docker, fixtures, integración IA TEST, build web/API
y revisión de artefactos públicos sin secretos ni canarios de servidor.

La integración real aprobó **221/221 HTTP** y **1216 aserciones SQL en 19 archivos**.
RUN tuvo 100 muestras, cero errores y p95 serial/concurrente **1441,75/2599,72 ms**.
Las tres series SUBMIT consecutivas aprobaron, cada una con 100 muestras,
cero errores, 100 trazas completas y cero rechazos:

| Serie de CI8 | p95 serial (ms) | p95 concurrencia 4 (ms) |
| ------------ | --------------- | ----------------------- |
| 1            | 3533,10         | 3898,57                 |
| 2            | 2107,00         | 4259,03                 |
| 3            | 2315,21         | 3968,45                 |

Todos los perfiles conservaron limpieza, candidato, imagen y entorno. Los
manifiestos inicial/final de cada serie coinciden y quedaron persistidos.

Cypress aprobó **95/95 casos**, incluidos **7/7 del detalle docente**, sin
fallos, pendientes ni omitidos. La pantalla de .03 tuvo 50 muestras por perfil,
cero errores y p95 serial/concurrente **637,70/1270,10 ms**. Sus tres capturas
1440×900, 768×1024 y 390×844 aprobaron y se inspeccionaron visualmente: contenido
legible, ajuste de texto y controles al ancho disponible. Copias de las imágenes:
`.local/evidence/imp-06/ci-attempt-8/screenshots/`.

Los seis perfiles heredados de pantallas también aprobaron, con 50 muestras
cada uno y cero errores: tablero **1246,50/2993,90 ms**, progreso
**686,90/983,30 ms** y reglas **422,80/564,80 ms**. El valor del tablero concurrente
queda registrado sin redondearlo al límite de 3000 ms. Esta observación local
no determina una causa única de las variaciones de corridas anteriores.

La evaluación de ayuda aprobó a las **02:00:22 UTC**: proveedor TEST,
**234 muestras**, cobertura completa **43/43** y **cero llamadas externas**.
Sus perfiles serial/concurrente tuvieron 100 respuestas SUPPORTED cada uno,
cero fallbacks, p95 hasta persistencia **674/2640 ms** y hasta respuesta API
**765/2795,68 ms**, bajo 12000 ms. Conserva
`BROWSER_RENDER_EVIDENCE_UNAVAILABLE`: estos perfiles no prueban latencia de
generación de ayuda visible en navegador ni aceptación pedagógica humana.
La pantalla docente mide la consulta de ayuda ya entregada.

La comparación final se tomó a las **02:00:36 UTC**, antes de cualquier edición
documental de cierre. Los **753 archivos** conservaron exactamente la huella
`901d8eaa8a14e7fabae8797f4bb5b35410f26d1c88f5e9066ba1cb935a297387`,
sin archivos cambiados. Las **599 fuentes** mantuvieron
`b04d76eac9d9741d6a880261c3d69ac56c59022c6633067e2e58678529c494e1`.
La congelación abarcó toda la CI, incluida preparación y evaluación de ayuda.

Informes preservados en `.local/reports/imp-06/`:
`ci-student-detail-attempt-8.json`, integración/RUN y `submit-1/2/3` de la misma
corrida; `e2e-student-detail-ci-attempt-8.json`; perfiles
`student-detail-ui-*-ci-attempt-8` y `phase-ui-*-ci-attempt-8`;
`help-evaluation-student-detail-ci-attempt-8.json` y
`help-measurements-student-detail-ci-attempt-8.json`.
`ci-student-detail-attempt-8-report-monitor.json` conserva el índice y las
revisiones de informes; `student-detail-ci-freeze-{start,inventory,end}-attempt-8.json`
conserva la comparación. Las CI1–CI7 permanecen FAIL con sus diagnósticos propios;
sus resultados no se sumaron para obtener este PASS integral.

El cierre se limita a IMP-06.03. Los focos de actualización .02→.03,
integración y rendimiento API indicados arriba complementan esta CI. Las
ediciones posteriores solo actualizan documentación; no constituyen otra CI.

## Alcance de evidencia y límites

El fixture combina intentos Docker reales con cuatro intentos deterministas
heredados para capacidad/paginación. La ayuda TEST se genera, presenta y confirma
desde el circuito estudiantil para preparar los hechos; las consultas docentes
comparan snapshots de intentos, ayudas, eventos, progreso y episodios y no hacen
llamadas IA. El mismo alumno participa en dos clases y se comprueba aislamiento.

Los perfiles ejecutados usan 50 muestras seriales y 50 con carga cuatro, primeras
consultas separadas y objetivo p95 <3 s. En UI la carga cuatro significa un
navegador Chrome y tres lectores HTTP; no cuatro navegadores ni tráfico remoto.
Las capturas de escritorio/tableta/móvil complementan el recorrido por teclado.

IMP-06.04–.07 (revisión, auditoría/CSV y aceptación integrada), aceptación
humana/CAPSTONE, CI Linux y proveedores/despliegues remotos siguen pendientes.
Los antecedentes y resultados de .01/.02 se conservan en sus registros propios.
