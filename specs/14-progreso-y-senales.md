# Progreso y señales docentes

Fecha: 2026-09-10. Fuentes: F01 ALZ-RF-015–019/026, RNF-IA-05 y F03 CU-015–019/026 del [inventario](00-fuentes-y-decisiones.md). **Documentado:** fórmula, tres tipos de señal, umbrales y revisión. **Propuesta técnica DEC-005:** detalle de cálculo, ventanas, eventos, deduplicación y reevaluación.

## Fuente de verdad

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

**Propuesta:** la unidad de conteo es la asignación `activity_exercise_id` con versión fija, no cualquier ejercicio parecido del banco. Reutilizar el mismo ejercicio en dos actividades genera dos obligaciones distintas. Para progreso por concepto, filtrar asignaciones por la versión del concepto asociada al ejercicio; una asignación se cuenta una vez dentro de cada concepto, aunque varias etiquetas coincidan. No sumar porcentajes de conceptos como total de clase.

| Situación | Numerador/denominador | Salida propuesta |
| --- | --- | --- |
| No existen ejercicios requeridos | 0/0 | `ratio=null`, estado visual «Sin ejercicios requeridos» |
| Hay tres requeridos y ningún intento | 0/3 | `ratio=0`, estado visual «Sin intentos» |
| Uno de tres tiene todas sus pruebas superadas | 1/3 | `ratio=0.333333…`, porcentaje presentado 33 % y fracción visible |
| Una ejecución de práctica pasa todo lo visible, sin envío | Sin cambio | No completa la asignación |
| Pasa pruebas visibles pero falla una oculta requerida | Sin incremento | Sigue pendiente; no revela detalles ocultos |
| Un intento posterior falla tras un intento completo de esa asignación | Se conserva completado | Mostrar ambos intentos y logro previo |
| Un intento tiene UNKNOWN o error de infraestructura | Sin incremento | Evidencia técnica insuficiente; no atribuir error conceptual |

El redondeo solo afecta presentación; conservar contadores enteros y calcular el cociente desde ellos. **Propuesta:** entero porcentual más fracción y texto accesible. `evidenceState` puede ser `NO_REQUIRED_EXERCISES`, `NO_ATTEMPTS`, `HAS_EVIDENCE`; estos son metadatos propuestos de vista, no catálogos originales.

El filtro de fecha del tablero limita actividad observada e intentos listados; **propuesta:** no borra logros previos al calcular progreso acumulado «al corte». Mostrar `asOf` y aclarar si la vista es acumulada o restringida a período. Un cambio de versión crea evidencia separada y no invalida resultados históricos en silencio.

## Eventos elegibles

**Propuesta:** `CLASS_JOINED`, `ACTIVITY_OPENED`, `EXECUTION_COMPLETED`, `ATTEMPT_SUBMITTED`, `HINT_DELIVERED` y `FEEDBACK_VIEWED` son eventos semánticos emitidos/validados en servidor. Registrar actor, organización, clase, actividad cuando corresponda, entidad, instante UTC y clave de deduplicación.

No usar el tiempo informado libremente por el navegador, solicitudes GET de polling, refrescos automáticos del tablero o llamadas del administrador como actividad del alumno. Una pista fallida no es `HINT_DELIVERED`. El evento de lectura debe vincularse a una apertura explícita y ser autenticado; un cliente que lo repite no puede generar cientos de hechos equivalentes.

El catálogo final de eventos y qué acciones reinician inactividad deben cerrarse con DEC-005. Las reglas que requieren intentos usan solo envíos persistidos; no ejecuciones temporales, respuestas del LLM ni solicitudes duplicadas.

## Reglas de señales

Cada señal conserva tipo, causa legible, hechos/IDs, fecha de cálculo, versión de regla, ventana y estado. Los tipos documentados son `INACTIVITY`, `REPEATED_ERROR`, `STAGNATION`; los estados, `ACTIVE` y `REVIEWED`.

### Inactividad

**Documentado:** siete días consecutivos sin eventos después de la inscripción y antes del cierre de la actividad.

**Propuesta:** evaluar por estudiante/clase/actividad publicada. `baselineAt=max(enrolledAt, publishedAt, opensAt si existe)` y `lastAt=max(baselineAt, último evento elegible de esa actividad)`. Generar señal si `evaluationTime-lastAt >= 7×24 horas`, el estudiante sigue inscrito/activo y la actividad admite trabajo. Una actividad futura o cerrada no genera señales nuevas.

Guardar último evento o referencia a inscripción/publicación cuando no hay eventos. «Nunca envió» no es equivalente a siete días sin actividad si abrió el ejercicio o ejecutó práctica ayer. El reloj de evaluación es UTC; usar instantes elimina ambigüedades de cambios de horario local. La interpretación de días corridos por duración queda pendiente de confirmación en DEC-005.

### Error repetido

**Documentado:** el mismo error técnico en tres intentos consecutivos dentro de 14 días.

**Propuesta:** agrupar por estudiante, clase, asignación y versión de ejercicio. Ordenar por instante de envío del servidor y un desempate monotónico persistido. Revisar los tres últimos intentos confirmados; deben compartir diagnóstico en `{SYNTAX_ERROR,RUNTIME_ERROR,FAILED_TEST,TIMEOUT}` y tener diferencia entre primero y último `<=14×24 horas`. SUCCESS o UNKNOWN interrumpe la secuencia; UNKNOWN no se trata como error pedagógico. Un resultado de infraestructura sin intento completo tampoco acredita error repetido.

Para `FAILED_TEST`, «mismo error» significa mismo diagnóstico grueso en esta propuesta, sin inferencia conceptual del LLM. Decidir si se necesita una firma determinista más específica es parte de DEC-005. No agrupar por texto libre de excepciones porque puede contener variaciones o datos sensibles.

### Estancamiento

**Documentado:** tres intentos de un ejercicio sin aumentar la cantidad de pruebas visibles superadas.

**Propuesta:** usar los tres últimos intentos comparables de la misma asignación y versión de tests, con conteos visibles completos. Sea `p1,p2,p3` el conteo de pruebas visibles superadas: generar señal si `p2<=p1` y `p3<=p2`, siempre que el último intento no complete el ejercicio. No comparar versiones o suites diferentes. Si el arnés no terminó las pruebas necesarias, la evaluación queda no verificable, sin crear señal.

Esta interpretación de «sin aumentar» exige ratificación en DEC-005: otras interpretaciones, como no superar el máximo histórico, producen resultados distintos. Evitar elegirlas implícitamente en SQL. Error repetido y estancamiento pueden coexistir si cada regla tiene su evidencia; la UI muestra causas diferenciadas.

## Ejemplos de aceptación de reglas propuestas

| Fixture | Datos de entrada | Resultado esperado |
| --- | --- | --- |
| SIG-01 | Último evento hace 6 días 23:59:59 | Sin INACTIVITY |
| SIG-02 | Último evento exactamente hace 7 días; actividad abierta | INACTIVITY con referencia a ese evento |
| SIG-03 | Nunca actuó; inscrito hace 10 días pero actividad publicada hace 2 | Sin INACTIVITY |
| SIG-04 | Actividad cerrada, siete días sin eventos | Sin señal nueva; conservar historial anterior |
| SIG-05 | FAILED_TEST, FAILED_TEST, FAILED_TEST en 14 días exactos | REPEATED_ERROR |
| SIG-06 | Misma secuencia, diferencia 14 días y 1 segundo | Sin REPEATED_ERROR |
| SIG-07 | FAILED_TEST, SUCCESS, FAILED_TEST | Sin REPEATED_ERROR |
| SIG-08 | FAILED_TEST, UNKNOWN, FAILED_TEST | Sin REPEATED_ERROR |
| SIG-09 | Pruebas visibles superadas 1,1,1 de 3 | STAGNATION |
| SIG-10 | Conteos 1,2,2 de 3 | Sin STAGNATION en esos tres intentos |
| SIG-11 | Conteos 2,1,1 de 3 | STAGNATION bajo propuesta no creciente |
| SIG-12 | Conteos 1,1,1 pero suites/versiones distintas | No verificable; sin señal |
| SIG-13 | Reejecutar cálculo con la misma evidencia y regla | Mismo registro; sin duplicación |
| SIG-14 | Dos solicitudes de revisión simultáneas | Una transición, un primer revisor/fecha; ambas observan REVIEWED |

Son pruebas diseñadas, no ejecutadas. Complementan ALZ-PT-015/018/019/026 y no sustituyen sus identificadores.

## Versionado, deduplicación y revisión

Los parámetros pertenecen a versiones inmutables con autor, fecha y vigencia. Publicar una versión no modifica señales existentes ni su interpretación. Solo una versión por tipo/organización está vigente en cada instante. La activación concurrente debe impedir intervalos de vigencia incompatibles.

**Propuesta de episodio:** clave formada por estudiante, ámbito, tipo, versión de regla e identidad de ventana/evidencias. Para inactividad, usar `lastAt` de referencia; para reglas de intentos, los IDs ordenados de los tres intentos. Mientras no cambien, recalcular es idempotente, incluso si cambia la hora del trabajo.

Una señal REVIEWED no se reactiva por recalcular la misma evidencia. Evidencia nueva puede generar un nuevo episodio después de reevaluar; conservar vínculo al anterior y evitar spam visual. La política de agrupación entre episodios se valida en DEC-005.

Marcar revisada registra responsable y fecha de servidor en transacción. Si ya fue revisada, devolver su estado conservando primer revisor y fecha. La revisión no implica «problema resuelto», mejora de aprendizaje ni borrado de hechos. No agregar estados automáticos RESOLVED o DISMISSED al catálogo.

## Agregados del tablero

**Propuesta mínima:** estudiantes inscritos/activos, última actividad observable, intentos por diagnóstico, asignaciones completadas/requeridas, fallas frecuentes por concepto, ayudas concedidas y señales por tipo/estado. Mostrar filtros activos y fecha de cálculo.

Cada agregado utiliza el mismo conjunto autorizado que su detalle y evita duplicar intentos por joins con conceptos o fuentes. Los totales no revelan información de organizaciones ajenas. Para consultas vacías mostrar ausencia de datos; para infraestructura caída mostrar error, no cero ni ausencia de evidencia académica.

La verificación compara agregados con un cálculo independiente de fixtures, prueba aislamiento entre las tres clases de demo y confirma que borrar una caché y reconstruir conserva resultados. Una respuesta del modelo modificada o caída completa de Azure OpenAI debe dejar las mismas cifras y señales.
