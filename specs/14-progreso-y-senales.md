# Progreso y señales docentes

Fecha inicial: 2026-09-10; resolución D1–D5: 05/10/2026. Fuentes: F01 ALZ-RF-015–019/026, RNF-IA-05 y F03 CU-015–019/026 del [inventario](00-fuentes-y-decisiones.md). **DEC-005 resuelta por el usuario:** eventos/progreso .01–.02 y D1–D5. Las fórmulas siguientes conservan la decisión aprobada.

**Estado vigente:** IMP-05.01–05.08 está implementado y tiene cierre técnico
local: progreso/eventos, reglas, evaluadores, persistencia/worker recuperable,
gobierno web, tablero/evidencia y aceptación transversal. El
[estado actual](../docs/estado-actual.md) concentra el alcance y sus pendientes;
el [cierre .08](../docs/work/IMP-05-acceptance.md) y su
[matriz](../docs/work/IMP-05-acceptance-matrix.md) registran pruebas y límites.
RF-017 tiene cierre técnico local en IMP-06.03. IMP-06.04 añade la revisión
pública autorizada, según su [contrato](../docs/work/IMP-06-signal-review-dictionary.md)
y [registro de pruebas](../docs/work/IMP-06-signal-review.md). Reutiliza base
inmutable y primer responsable/fecha, sin alterar D1–D5. Solo matrícula activa
y clase operativa; consultas históricas mantienen asOf. No se acredita despliegue,
validación remota ni aceptación docente/CAPSTONE.

## Cortes históricos de implementación

**Estado histórico al 13/10/2026:** .03 estaba implementada con validación
integral/CI17 pendiente; .04 había completado únicamente su
[alcance puro local](../docs/work/IMP-05-evaluators-pure.md). Adquisición,
persistencia/episodios .05, UI/tablero e integración eran posteriores a ese corte.

**Actualización histórica previa al cierre del 25/10/2026:** adquisición, persistencia y procesamiento
recuperable .05 están implementados y verificados funcionalmente en TEST.
El [registro .05](../docs/work/IMP-05-episodes.md) conserva pruebas, candidato y
fallos: en ese corte, el gate global SUBMIT impedía cerrar localmente el incremento y la
CI conjunta .03/.04/.05. Tablero, revisión docente, aceptación académica y
servicios remotos conservan sus pendientes. No cambian las fórmulas aprobadas.

**Cierre técnico local del 25/10/2026:** la CI conjunta .03/.04/.05 aprobó
17/17 pasos (`2026-10-26T00:35:22.681Z`): 2.110 unidades, 181 HTTP, 928
aserciones SQL en 13 archivos, 49/49 E2E y tres series SUBMIT de 100 respuestas
válidas cada una, conservando p95 <5.000 ms. La evaluación de ayuda TEST completó
234 muestras, 763 recibos y tres reanudaciones, sin llamadas externas.
El [registro .05](../docs/work/IMP-05-episodes.md) y la
[corrección de admisión y fixture temporal](../docs/work/2026-10-25-submit-admission.md)
conservan candidato, resultados y fallos anteriores. .05 quedó cerrado
localmente; en ese corte tablero, revisión docente, RF-018 integral, RF-019,
aceptación académica y validación remota permanecían pendientes. Este cierre no modifica
D1–D5 ni las fórmulas siguientes.

## Fuente de verdad

**Decisiones de presentación IMP-05.07, 26/10/2026:** el usuario eligió mostrar
todas las señales ACTIVE, diferenciando las históricas cuya acumulación terminó.
Los totales del tablero usan la matrícula actualmente inscrita y activa,
también al consultar un corte pasado; no reconstruyen el padrón histórico.
Las señales históricas autorizadas de estudiantes fuera de esa población se
conservan y se etiquetan, separadas de los totales vigentes. La lectura usa
episodios/evaluaciones persistidos y comunica su fecha y procesamiento;
no evalúa reglas ni publica alertas al abrir la pantalla. Véanse
[contrato incremental](../docs/work/IMP-05-dashboard-dictionary.md) y
[estado de verificación](../docs/work/IMP-05-dashboard.md).

**Resolución parcial DEC-005 — IMP-05.01–05.02, 02/10/2026.** El usuario confirmó
la unidad de asignación/versiones, progreso acumulado por concepto al corte y
eventos semánticos deduplicados. El corte incluye published_at/submitted_at <=
asOf; no usa admisión ni autorización histórica. Los cálculos ordenan por
submitted_at y secuencia de ATTEMPT_SUBMITTED; el historial conserva attemptNumber.
FEEDBACK_VIEWED explícito cuenta también para fallback NO_EVIDENCE,
PROVIDER_UNAVAILABLE y UNKNOWN; solicitud/pista fallida sin lectura/entrega no.
La incorporación es referencia de clase, sin aplicarla a todas las actividades.
Las decisiones de ventanas, firma de error, comparabilidad, estancamiento,
episodios y reglas se resolvieron después mediante D1–D5, conservando este corte. Contrato y
evidencia del corte en el [diccionario](../docs/work/IMP-05-progress-dictionary.md)
y [registro](../docs/work/IMP-05-progress.md).

**Resolución DEC-005 D1–D5, 05/10/2026.** Marcelo aprobó la propuesta completa
con sus consecuencias de producto y luego autorizó IMP-05.03. La
[decisión y fuente aprobada](../docs/work/DEC-005-2026-10-05.md) conserva el
artefacto original y su traza de autoridad. Las reglas siguientes son normativas
para los incrementos correspondientes; aprobarlas no acredita implementación,
validación pedagógica ni aceptación del docente guía/CAPSTONE.

El tablero es una función interna de Alunza. Calcula agregados con consultas y reglas deterministas a partir de intentos, verificaciones y eventos autorizados. El LLM no calcula estas salidas. Toda cifra o señal debe poder remontarse a hechos persistidos y a su versión de regla.

El código ejecutado con «Ejecutar» ofrece práctica, pero solo «Enviar» genera el intento que puede completar un ejercicio. El historial es acumulativo; no convertir un error posterior en pérdida de un logro anterior sobre la misma versión de ejercicio asignado.

## Fórmula de progreso

Para un estudiante y ámbito autorizado:

```text
R = conjunto de ejercicios asignados requeridos en el ámbito
C = elementos de R con al menos un intento confirmado
    que supera todas las verificaciones deterministas requeridas
progreso = |C| / |R|, cuando |R| > 0
```

**Documentado:** mostrar numerador, denominador y falta de evidencia; un ejercicio se completa con todas las verificaciones requeridas; no presentar el progreso como calificación.

**Resuelto para IMP-05.01–05.02:** la unidad de conteo es la asignación `activity_exercise_id` con versión fija, no cualquier ejercicio parecido del banco. Reutilizar el mismo ejercicio en dos actividades genera dos obligaciones distintas. Para progreso por concepto, filtrar asignaciones por la versión del concepto asociada al ejercicio; una asignación se cuenta una vez dentro de cada concepto, aunque varias etiquetas coincidan. No sumar porcentajes de conceptos como total de clase.

| Situación | Numerador/denominador | Salida acordada |
| --- | --- | --- |
| No existen ejercicios requeridos | 0/0 | `ratio=null`, estado visual «Sin ejercicios requeridos» |
| Hay tres requeridos y ningún intento | 0/3 | `ratio=0`, estado visual «Sin intentos» |
| Uno de tres tiene todas sus pruebas superadas | 1/3 | `ratio=0.333333…`, porcentaje presentado 33 % y fracción visible |
| Una ejecución de práctica pasa todo lo visible, sin envío | Sin cambio | No completa la asignación |
| Pasa pruebas visibles pero falla una oculta requerida | Sin incremento | Sigue pendiente; no revela detalles ocultos |
| Un intento posterior falla tras un intento completo de esa asignación | Se conserva completado | Mostrar ambos intentos y logro previo |
| Un intento tiene UNKNOWN o error de infraestructura | Sin incremento | Evidencia técnica insuficiente; no atribuir error conceptual |

El redondeo solo afecta presentación; conservar contadores enteros y calcular el cociente desde ellos. **Contrato IMP-05.01–05.02:** entero porcentual más fracción y texto accesible. `evidenceState` puede ser `NO_REQUIRED_EXERCISES`, `NO_ATTEMPTS`, `HAS_EVIDENCE`; estos son metadatos de vista del contrato incremental, no catálogos originales.

El filtro de fecha del tablero limita actividad observada e intentos listados. **Resuelto para IMP-05.01–05.02:** el progreso acumulado «al corte» conserva logros previos. Mostrar `asOf` y aclarar si la vista es acumulada o restringida a período. Un cambio de versión crea evidencia separada y no invalida resultados históricos en silencio.

## Eventos elegibles

**Resuelto para IMP-05.01–05.02:** `CLASS_JOINED`, `ACTIVITY_OPENED`, `EXECUTION_COMPLETED`, `ATTEMPT_SUBMITTED`, `HINT_DELIVERED` y `FEEDBACK_VIEWED` son eventos semánticos emitidos/validados en servidor. Registrar actor, organización, clase, actividad cuando corresponda, entidad, instante UTC y clave de deduplicación.

No usar el tiempo informado libremente por el navegador, solicitudes GET de polling, refrescos automáticos del tablero o llamadas del administrador como actividad del alumno. Una pista fallida no es `HINT_DELIVERED`. El evento de lectura debe vincularse a una apertura explícita y ser autenticado; un cliente que lo repite no puede generar cientos de hechos equivalentes.

El catálogo y la elegibilidad de eventos se concretan en el diccionario incremental de IMP-05.01–05.02. D1 fija ventanas y cobertura para inactividad. Las reglas que requieren intentos usan solo envíos persistidos; no ejecuciones temporales, respuestas del LLM ni solicitudes duplicadas.

## Reglas de señales

Cada señal conserva tipo, causa legible, hechos/IDs, fecha de cálculo, versión de regla, ventana y estado. Los tipos documentados son `INACTIVITY`, `REPEATED_ERROR`, `STAGNATION`; los estados, `ACTIVE` y `REVIEWED`.

**D1–D2 aprobadas.** Toda evaluación recibe corte `T`, versión explícita de
regla, hechos confirmados visibles en un snapshot consistente y fechas `<=T`.
Normalizar a UTC y conservar seis decimales; comparar microsegundos sin
redondear a milisegundos. Conservar revisión/snapshot de evidencia, IDs, digest
de entradas relevantes y contexto de cobertura/disponibilidad, incluyendo los
ledgers ordenados de activación/revisión y las bases revisadas.

Al confirmar una evaluación, el protocolo implementado en .05 debe revalidar
las entradas de forma compatible con sus productores; una revisión distinta
exige recalcular. `MAX(event_sequence)` solo
no prueba esa consistencia. Un commit ordinario tardío con fecha `<=T` produce
otra revisión para el mismo corte; conservar el cálculo anterior y anexar la
reconciliación, sin retrofechar hechos al instante de admisión ni aceptar fechas
del navegador. Backfill histórico verificable y corrección auditada quedan fuera
del MVP. La reproducibilidad exige iguales hechos y snapshot, además de `T`.

El ámbito incluye organización, clase y alumno; inactividad agrega actividad;
reglas de intentos agregan actividad, asignación y versión de ejercicio. Los
conceptos históricos filtran o explican: no unen carriles ni multiplican señales.
Seleccionar primero los últimos `N` SUBMIT confirmados ordenados por
`(submitted_at, ATTEMPT_SUBMITTED.event_sequence)` y después comprobar
comparabilidad; no saltar UNKNOWN, resultados incompletos o suites distintas.
RUN y envíos en otra asignación no ocupan posiciones en esa secuencia local.

La disponibilidad tiene inicio inclusivo y cierre exclusivo, programado o
efectivo. DRAFT, actividad futura/cerrada, alumno deshabilitado o sin inscripción
vigente no abren ni amplían episodios actuales de ninguno de los tres tipos.
Un SUBMIT admitido antes del cierre puede confirmarse después y conservar
historial/progreso; no crea un episodio nuevo cuando la actividad ya cerró.
Una consulta histórica usa permisos actuales y reproduce elegibilidad/snapshot
original sin publicar alertas presentes ni mover el puntero operativo.

Los resultados de cálculo distinguen cumple, no cumple, no evaluable y no
verificable, con sus motivos. No evaluable describe trabajo no habilitado; no
verificable describe evidencia/cobertura insuficiente o incoherente. No son
estados de señal ni permiten inferir ausencia de dificultad.

### Inactividad

**Documentado:** siete días consecutivos sin eventos después de la inscripción y antes del cierre de la actividad.

**D1 aprobada:** `baselineAt=max(enrolledAt,publishedAt,opensAt si existe)`.
`coverageSince` es el comienzo comprobado del tramo continuo con todos los
capturadores elegibles operativos; `observableSince=max(baselineAt,coverageSince)`.
`lastAt=max(observableSince,último occurredAt elegible de la actividad hasta T)`.
La línea base cumple a `T-lastAt>=7×24 horas` (604.800 segundos), con ámbito
habilitado. Cobertura desconocida o un hueco no reconstruible impide afirmar
ausencia: reiniciar el tramo observable después del hueco y guardar el motivo.
La fecha nominal de una migración no acredita su instalación/cobertura real.

Guardar referencia de baseline/cobertura y último evento. El tramo de silencio
se identifica por ámbito, regla, `lastAt` y época de cobertura; eventos empatados
conservan fuentes/IDs ordenados sin crear otra pausa ni reabrir REVIEWED. Un
evento exactamente en T reinicia lastAt. No inventar orden global entre ledgers
que solo tienen secuencias locales. «Nunca envió» no equivale a siete días sin
actividad: RUN completo o lectura explícita elegible puede reiniciar el silencio.
No excluir silenciosamente actividad completa mientras siga abierta.

### Error repetido

**Documentado:** el mismo error técnico en tres intentos consecutivos dentro de 14 días.

**D1–D2 aprobadas:** con la línea base N=3, seleccionar los tres últimos SUBMIT
confirmados antes de verificar comparabilidad. Exigir la misma asignación,
versión de ejercicio, hash de suite, conjunto/total visible y perfil determinista
(runner, límites y schema/normalización de resultado compatibles). No buscar
una subserie anterior cuando el último grupo no sea comparable.

Exigir resultados canónicos con infraestructura OK y el mismo diagnóstico en
`{SYNTAX_ERROR,RUNTIME_ERROR,FAILED_TEST,TIMEOUT}`. La firma MVP es versión de
firma más `diagnosisCode`; puede agrupar pruebas o errores conceptuales distintos.
No usar texto libre, código, consola, IA o tests ocultos como firma visible.
SUCCESS/UNKNOWN confirmado ocupa posición e interrumpe: es verificable para
esa interrupción y no cumple. Una falla sin intento confirmado no ocupa posición.
Un diagnóstico técnico confiable puede acreditar repetición sin ejecutar todos
los tests; no acredita por ello conteos de estancamiento.

Exigir `T−14×24 horas<=t1<=t2<=t3<=T`, ambos extremos inclusivos. Esta ventana
anclada al corte sustituye explícitamente la anterior propuesta `t3−t1<=14 días`.
Una tripleta envejecida deja de cumplir y corta acumulación aunque conserve sus
IDs. Su señal histórica mantiene estado/hechos. La causa expresa los envíos,
fechas y diagnóstico grueso sin afirmar mismo concepto ni dificultad personal.

### Estancamiento

**Documentado:** tres intentos de un ejercicio sin aumentar la cantidad de pruebas visibles superadas.

**D2–D3 aprobadas:** escoger primero los últimos tres confirmados, sin filtrar
para recuperar comparables. Exigir la comparabilidad anterior, infraestructura
OK, diagnóstico distinto de UNKNOWN y cobertura completa de la misma suite
visible. Contadores reales `0<=pi<=visibleTotal`, con total positivo; incompletitud,
total cero o incoherencia son no verificables, sin señal y sin sustituir por cero.

Cumple exactamente `p2<=p1 && p3<=p2` salvo que el último `allRequiredPassed=true`.
Sin plazo temporal adicional. No usar máximo histórico ni solo igualdad. `1,1,1`
y `2,1,1` cumplen; `1,2,2` y `2,1,2` no. `3,3,3` visibles con último
allRequiredPassed=false puede cumplir; no revelar detalle oculto. Un éxito previo
conserva progreso y no suprime por sí solo una tripleta posterior; la causa no
afirma ejercicio pendiente ni pérdida de aprendizaje. Asignaciones opcionales
también pueden aportar evidencia técnica. Error repetido y estancamiento pueden
coexistir, con causas independientes y sin suma de gravedad o nota.

## Ejemplos de aceptación de reglas aprobadas

| Fixture | Datos de entrada | Resultado esperado |
| --- | --- | --- |
| SIG-01 | Último evento hace 6 días 23:59:59 | Sin INACTIVITY |
| SIG-02 | Último evento exactamente hace 7 días; actividad abierta | INACTIVITY con referencia a ese evento |
| SIG-03 | Nunca actuó; inscrito hace 10 días pero actividad publicada hace 2 | Sin INACTIVITY |
| SIG-04 | Actividad cerrada, siete días sin eventos | Sin señal nueva; conservar historial anterior |
| SIG-05 | Últimos tres FAILED_TEST entre T−14 días y T, con primero en el extremo incluido | REPEATED_ERROR |
| SIG-06 | Misma secuencia, primero un segundo antes de T−14 días | Sin REPEATED_ERROR |
| SIG-07 | FAILED_TEST, SUCCESS, FAILED_TEST | Sin REPEATED_ERROR |
| SIG-08 | FAILED_TEST, UNKNOWN, FAILED_TEST | Sin REPEATED_ERROR |
| SIG-09 | Pruebas visibles superadas 1,1,1 de 3 | STAGNATION |
| SIG-10 | Conteos 1,2,2 de 3 | Sin STAGNATION en esos tres intentos |
| SIG-11 | Conteos 2,1,1 de 3 | STAGNATION bajo comparación no creciente aprobada |
| SIG-12 | Conteos 1,1,1 pero suites/versiones distintas | No verificable; sin señal |
| SIG-13 | Reejecutar cálculo con la misma evidencia y regla | Mismo registro; sin duplicación |
| SIG-14 | Dos solicitudes de revisión simultáneas | Una transición, un primer revisor/fecha; ambas observan REVIEWED |

Estos fixtures fijan oráculos normativos; su mera descripción no acredita
ejecución. Complementan ALZ-PT-015/018/019/026. Conservar expected e identificadores SIG-01–SIG-14;
preparar SIG-07 con SUCCESS canónico y SIG-12 como negativo sintético de
comparabilidad. Los ejemplos E01–E24 de la [fuente D1–D5](../docs/work/DEC-005-2026-10-05.md)
incluyen fronteras a un microsegundo, cobertura, commits tardíos, prefijos,
éxito acumulado y revisión. La [matriz .08](../docs/work/IMP-05-acceptance-matrix.md)
identifica la cobertura pura, SQL, HTTP y de interfaz ejecutada en .04–.08.
E20/backfill sigue fuera del MVP; E23 tiene cobertura pura y de persistencia
relacionada, sin atribuir una corrida durable específica de dos eventos nuevos
con timestamp idéntico tras REVIEWED. El reloj de siete días es sintético,
complementado por captura real de eventos. La acción pública de revisión sigue
pendiente de IMP-06.

## Versionado, deduplicación y revisión

**D5 aprobada, alcance .03:** versiones por organización/tipo, con autor,
createdAt, schema/algoritmo, parámetros y vigencia. Crear no activa. Parámetros y
algoritmo de una versión activada son inmutables; cualquier cambio exige otra.
Línea base: inactivityDays=7; repeatedErrorAttempts=3/repeatedErrorWindowDays=14;
stagnationAttempts=3. Días enteros positivos y conteos enteros >=2; rechazar
ausentes, cero/negativos, fracciones, extras, tipos incorrectos, algoritmo/schema
desconocido y valores no representables. .03 usa int4: días 1–2.147.483.647,
conteos 2–2.147.483.647; es límite de representación, no umbral pedagógico.
N distinto de 3 requiere oráculos propios antes de habilitar evaluación; SIG y
línea base mantienen N=3. No se aceptan scripts/fórmulas arbitrarias de cliente.

La activación es inmediata a hora servidor A, con vigencia `[A,B)`: nueva versión
rige en A y anterior deja de regir en B. No admite fecha cliente, retroactividad
ni programación futura. Serializar `(organizationId,type)` y exigir versión
vigente esperada: una activación concurrente gana y la otra observa conflicto.
Repetir la misma activación conserva A y auditoría efectiva única. Otros tipos y
organizaciones no comparten ese bloqueo. Sin regla vigente de un tipo no hay
señales de ese tipo; no presentarlo como ausencia de dificultad.

Desde A se evalúa con nueva versión; los episodios anteriores dejan de acumular
y preservan parámetros, hechos y estado. Evidencia todavía vigente puede abrir
otro ACTIVE vinculado bajo la nueva regla, incluso con los mismos intentos y un
antecedente REVIEWED. Registrar causa «nueva versión de regla» sin reactivar el
episodio anterior. El corte .03 conserva su ledger de activación; por sí solo
no ejecuta evaluadores ni crea señales. .05 procesa esos cambios y .06 añade
gobierno web y lectura del conjunto efectivo. Contrato/API/DDL en el
[diccionario .03/.06](../docs/work/IMP-05-signal-rules-dictionary.md).

**D4 aprobada; persistencia .05 implementada y cierre técnico local verificado según
el [registro](../docs/work/IMP-05-episodes.md):** separar episodio, testigo y
evaluación. El testigo usa ámbito/tipo/regla más tramo de silencio o IDs ordenados
de los N intentos; el episodio usa su primer testigo cualificado. Anexar nuevas
evaluaciones inmutables en el mismo ACTIVE durante el tramo continuo, conservando
causa/evidencia inicial, instante en que cumplió y calculatedAt del procesamiento.
La evaluación identifica snapshot/revisión, algoritmo,
T y frontera. Recálculo idéntico no duplica ni aumenta contador; un tick sin cambio
no anexa otra copia. Maduración, expiración, activación/revisión o reconciliación
sí son cambios semánticos. Los IDs del testigo no sustituyen reevaluar la ventana.

Pasar a no cumplir/no verificable/no evaluable corta acumulación con instante y
motivo internos; no cambia ACTIVE/REVIEWED. Si vuelve a cumplir, abrir otro
episodio vinculado sin ciclos. REVIEWED conserva primer revisor/fecha ante replay;
un testigo nuevo fuera de la base revisada y no procesado globalmente puede abrir
otro ACTIVE vinculado. No decidir novedad solo por submittedAt>reviewedAt: un
commit tardío puede aportar evidencia anterior a esa fecha que no estaba en la base.

Recorrer cada prefijo confirmado y fronteras temporales con checkpoint durable y
exclusión/revalidación de entradas; no mirar solo la última tripleta tras caída,
pues puede ocultar una mejora intermedia. No retroceder el puntero operativo ni
volver a publicar por reconstrucciones o testigos ya procesados. Reconstrucción
histórica conserva identidades/hechos y versión aplicable en T; distinguir
reconstructedAt de calculatedAt original. La consistencia y recuperación .05
se verificaron localmente; .08 añade reconstrucción de proyecciones ausentes y
alteradas, replay y lectura pública al mismo corte con ámbitos vecinos intactos.
El [registro .08](../docs/work/IMP-05-acceptance.md) conserva los resultados;
escribir este contrato no acredita por sí solo implementación ni aceptación académica.

Marcar revisada registra responsable y fecha de servidor en transacción. Si ya fue revisada, devolver su estado conservando primer revisor y fecha. La revisión no implica «problema resuelto», mejora de aprendizaje ni borrado de hechos. No agregar estados automáticos RESOLVED o DISMISSED al catálogo.

Este último comportamiento es la obligación de RF-019. .05 materializa la base
inmutable y transición para pruebas internas; .07 permite leer su historia.
Ni la función de fixture ni la lectura de una señal publican la acción de
revisión. IMP-06.04 incorpora el PUT autorizado y la confirmación docente desde
tablero/detalle, con matrícula CURRENT_ACTIVE, auditoría única y conservación
del corte histórico; su [registro](../docs/work/IMP-06-signal-review.md) separa
implementación, pruebas locales y aceptación pendiente.

## Procesamiento y reconstrucción implementados

El worker NestJS utiliza carriles, trabajos con lease/token y checkpoints
durables en PostgreSQL. `SIGNALS_WORKER_ENABLED` está desactivado por defecto;
habilitarlo procesa hechos capturados, no crea cobertura retroactiva. El
[diccionario de episodios](../docs/work/IMP-05-episodes-dictionary.md) concreta
capturadores, vectores/revisiones, reintentos, deadlines y recuperación.

Capturar, calcular y confirmar son fases separadas. La confirmación revalida
las entradas; un commit tardío con fecha anterior a T puede exigir otra
evaluación del mismo corte, con vínculo de reconciliación y cálculo previo
intacto. La revisión humana conserva su primera base; novedad no significa
simplemente `submittedAt > reviewedAt`. Publicar otra versión de ejercicio
conserva las asignaciones e intentos anteriores y no vuelve comparables los
últimos N de suites incompatibles.

El mantenimiento `signals:rebuild` ofrece `plan/check/rebuild/report` sobre un
ámbito y destino local explícitos. Reproduce snapshots originales y verifica
digests antes de reparar proyecciones. No reconstruye trabajos, mueve
checkpoints, reasigna testigos ni publica episodios pasados. Una discrepancia
de evidencia detiene la reparación; ausencia o alteración de un derivado no
autoriza cambiar hechos canónicos para hacerlo coincidir.

## Agregados del tablero

**Contrato implementado .07, conservado en .08:** matrícula vigente activa,
última actividad observable, intentos por diagnóstico, completados/requeridos,
desgloses por actividad/concepto, pistas entregadas y episodios por tipo/estado.
Mostrar filtros, `asOf` y `observedAt`. El
[diccionario del tablero](../docs/work/IMP-05-dashboard-dictionary.md) y los
contratos [dashboard.ts](../packages/contracts/src/dashboard.ts),
[progress.ts](../packages/contracts/src/progress.ts) y
[progress-observation.ts](../packages/contracts/src/progress-observation.ts)
definen los campos ejecutables sin duplicar aquí todos los DTO.

El total docente cuenta obligaciones estudiante/asignación requerida de la
matrícula actualmente activa, incluso en una consulta histórica. El alumno
de progreso personal se deriva de la sesión, sin suplantación desde el cliente.
Actividad y concepto delimitan el conjunto antes de contar o paginar; los
porcentajes conceptuales no se suman. Un alumno sin matrícula vigente queda
fuera de los totales, pero sus episodios históricos autorizados permanecen
identificados como fuera de esa población.

`from ≤ asOf ≤ hora del servidor`, con extremos inclusivos y microsegundos.
El inicio filtra observaciones e intentos del período; completitud y última
actividad consideran toda la historia hasta el corte. Sin inicio, el período
abarca esa historia. `technicalFailures` cuenta los cuatro diagnósticos de
fallo técnico verificable; un resultado no verificable o UNKNOWN se distingue
de fallo técnico y de éxito. Un diagnóstico canónico puede ser verificable sin
cobertura visible completa: `visiblePassed/visibleTotal` son null cuando no
hay conteos completos, nunca ceros inventados. Pistas entregadas son eventos
deduplicados de entrega real; una solicitud fallida no aumenta ese contador.

Los agregados anteceden a la paginación. Cada cursor está ligado a actor,
ámbito, filtros, corte y orden; las páginas siguientes conservan el `asOf`
resuelto por el servidor. Cada respuesta tiene un snapshot consistente, pero
el cursor no congela commits tardíos entre peticiones ni reemplaza permisos
actuales. La API debe rechazar filtros o cursores incompatibles.

El listado de señales incluye por defecto todos los episodios ACTIVE
cualificados hasta T, aunque hayan dejado de acumular; REVIEWED y ALL son
filtros disponibles. `ALL` no amplía el catálogo persistido. Revisión e
interrupción posteriores a T no se proyectan hacia el pasado. La última
evaluación corresponde al episodio y su regla hasta ese corte, sin tomar una
evaluación del sucesor ni prometer cálculo exactamente en T.

Estado, condición, verificabilidad y frescura son dimensiones distintas.
`ACTIVE` no afirma condición vigente; `REVIEWED` no afirma solución del problema.
`processing.status` distingue UP_TO_DATE, PENDING, FAILED y NOT_EVALUATED,
con frontera, fechas, carriles y tipos sin regla. La frescura refleja el control
operativo actual, por lo que hechos confirmados tarde pueden dejar PENDING una
lectura histórica. Los contadores `currentStudents/historicalStudents` cuentan
episodios de esas poblaciones, no personas únicas. Una referencia ausente se
presenta como no verificable, sin ocultar el episodio.

La evidencia docente mínima contiene contexto, fechas, diagnóstico,
completitud y resultados visibles agregados; excluye código, consola, pruebas
ocultas, contenido RAG y snapshots internos. El profesor debe estar asignado y
vigente; ADMIN de reglas no obtiene lectura pedagógica. Estos GET no ejecutan
reglas ni registran actividad estudiantil, entrega/lectura de ayuda o revisión.

Cada agregado utiliza el mismo conjunto autorizado que su detalle y evita duplicar intentos por joins con conceptos o fuentes. Los totales no revelan información de organizaciones ajenas. Para consultas vacías mostrar ausencia de datos; para infraestructura caída mostrar error, no cero ni ausencia de evidencia académica.

IMP-05.08 optimiza frescura y resúmenes sin cambiar estas fórmulas ni los DTO.
La aceptación local contrasta cifras con oráculos de fixtures, reconstrucción,
commit tardío, baja de matrícula, HELP/ACK reales con proveedor TEST y generación
contradictoria efectivamente invocada. La respuesta del modelo no altera el
diagnóstico, progreso o cálculo reproducido; un ACK elegible sí puede cambiar
la actividad observada legítimamente. Esto no acredita una caída remota Azure
ni calidad pedagógica. El fixture de capacidad prepara 201 resultados canónicos,
no 201 ejecuciones Docker; su puente SUBMIT/ayuda se prueba por separado.

Los límites y resultados vigentes están en la [matriz .08](../docs/work/IMP-05-acceptance-matrix.md)
y el [estado actual](../docs/estado-actual.md). La intermitencia SQL015 conserva
esperado 2 y causa no demostrada pese a veinte iteraciones sin reproducción;
no se presenta como corregida. Estas concreciones no cambian los 27 RF ni los
108 escenarios funcionales y no autorizan iniciar IMP-06.
