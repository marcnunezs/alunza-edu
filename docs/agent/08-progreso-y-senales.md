# Instrucciones para implementar progreso, tablero y señales

Estado: instrucciones para escribir código y verificarlo después. La fórmula de progreso, tipos de señal, umbrales y estados son documentados; la interpretación precisa de eventos, secuencias, ventanas y episodios conserva estado de propuesta DEC-005. Este archivo no acredita consultas ni pruebas ejecutadas.

## 1. Lee la fuente y traza cada cambio

Lee [fuentes y decisiones](../../specs/00-fuentes-y-decisiones.md), [progreso y señales](../../specs/14-progreso-y-senales.md), [modelo de datos](../../specs/06-modelo-de-datos.md), [API](../../specs/07-api-y-contratos.md), [seguridad](../../specs/09-seguridad-y-privacidad.md) y [UX](../../specs/04-ux-y-accesibilidad.md). Usa ALZ-RF-015/016/017/018/019/026, sus CU/PT y escenarios E1–E4 de [requisitos](../../specs/02-requisitos-funcionales.md) y [aceptación](../../specs/03-flujos-y-criterios-de-aceptacion.md). La verificación debe cubrir RNF-IA-05, RNF-CON-02/04 y los controles de aislamiento de [calidad](../../specs/10-calidad-y-pruebas.md).

Consume únicamente evidencia confirmada del flujo de [ejecución segura](06-ejecucion-segura.md). Revisa [IA/RAG](07-ia-y-rag.md) para impedir que sus respuestas alimenten cálculos. Inspecciona consultas, servicios, migraciones y contratos existentes antes de escoger sus ubicaciones o reemplazarlos.

## 2. Establece los límites del módulo

Construye servicios y consultas deterministas sobre intentos, resultados, asignaciones, membresías, eventos y reglas versionadas. Cada cifra y señal debe explicar sus hechos e identidad de regla. La IA no calcula ni modifica progreso, señales, nota, confianza numérica o intervención. La revisión docente registra una acción humana y no prueba que un problema se resolvió.

Puedes separar puertos de lectura de evidencia, reloj, cálculo de progreso, evaluación de reglas, persistencia de episodios y revisión. Los nombres y separación exacta son propuestas reversibles; evita acoplar estos servicios al SDK de Azure OpenAI. Usa reloj inyectable para pruebas y tiempo UTC del servidor en producción. Una caché o vista materializada debe poder reconstruirse desde hechos persistidos y nunca ser fuente exclusiva de verdad.

| Dependencia | Instrucción de avance y aceptación |
| --- | --- |
| DEC-005 | Prepara fixtures y código aislado para las reglas propuestas; registra interpretación. Confirma eventos, duración de ventanas, consecutividad, empate, «mismo error», estancamiento y episodios antes de aceptar semántica de producto. |
| DEC-002 | Respeta publicación/cierre y ventana de actividad; no asumas reapertura o logros borrados por cierre. |
| DEC-004/006 | Coordina contratos de filtros, proyecciones, schema y transacciones; no cambies tipos o campos solo en frontend. |
| DEC-012 | Usa dataset y reloj reproducibles; conserva los conteos de demo y separa fixtures de frontera adicionales. |

Registra decisiones rutinarias reversibles y continúa el trabajo que no dependa de ratificación. No conviertas propuestas de reglas o permisos en decisiones aprobadas porque puedas expresarlas en SQL. Mantén bloqueada únicamente la aceptación de la parte pendiente y documenta la evidencia que permitirá cerrarla.

## 3. Implementa progreso desde asignaciones requeridas

1. Resuelve autorización vigente antes de consultar: estudiante propio, clase inscrita, actividad autorizada, o profesor asignado al consultar detalle. Un administrador de estructura no recibe por omisión código ni evidencia pedagógica de todos los alumnos.
2. Determina el conjunto `R` de asignaciones requeridas dentro del ámbito. Usa como unidad propuesta `activity_exercise_id` con versión fija, no el ID del banco ni el número de intentos. El mismo ejercicio asignado en dos actividades constituye dos obligaciones distintas.
3. Construye `C` como asignaciones de `R` que tienen al menos un intento confirmado con todas sus verificaciones deterministas requeridas completas y superadas. Usa el resultado canónico confiable del servidor. `RUN`, una reserva, pruebas parciales, `UNKNOWN` o una respuesta de IA no acreditan completitud.
4. Devuelve contadores enteros `completed=|C|`, `required=|R|` y `ratio=completed/required` cuando `required>0`. Si es cero, devuelve `ratio=null`; no `NaN`, infinito, 100 % o nota inventada.
5. Mantén logros acumulados de la misma asignación y versión: un fallo posterior no elimina el éxito previo. Conserva intentos y versión histórica. Cambiar versión genera evidencia separada y requiere una transición explícita; no recalifiques el pasado con los tests actuales.
6. Para conceptos, filtra asignaciones con la versión conceptual asociada al ejercicio y cuenta una vez por concepto. Evita duplicación por joins de etiquetas o fuentes. No sumes porcentajes conceptuales para obtener el progreso de clase.
7. Conserva numerador, denominador, `asOf`, estado de evidencia y vínculo autorizado a intentos. Redondea solo en presentación. Si se usa la propuesta visual, muestra entero porcentual y fracción accesible.

| Caso | Respuesta esperada bajo propuesta de vista |
| --- | --- |
| No hay requeridos | `0/0`, `ratio=null`, `NO_REQUIRED_EXERCISES`; «Sin ejercicios requeridos». |
| Hay tres requeridos y ningún intento | `0/3`, `ratio=0`, `NO_ATTEMPTS`; «Sin intentos». |
| Una asignación de tres completada | `1/3`, cociente sin redondear en API, `HAS_EVIDENCE`; 33 % con fracción visible. |
| Pasa práctica visible sin enviar | Sin incremento de completados. |
| Pasa visibles, falla una oculta requerida | Sin incremento y sin revelar detalles ocultos. |
| Falla después de haber completado la misma versión | Completitud preservada y ambos intentos consultables. |
| Falla infraestructura | No inferir error conceptual; mostrar estado operativo correspondiente. |

`NO_REQUIRED_EXERCISES`, `NO_ATTEMPTS`, `HAS_EVIDENCE` son metadatos propuestos de vista, no estados nuevos de diagnóstico/RAG/señal. El filtro de fecha limita actividad observada y listado de intentos; según la propuesta de spec 14, el progreso acumulado se calcula «al corte» sin borrar logros previos al inicio del período. Expón `asOf` y semántica del filtro; no cambies esa interpretación silenciosamente al implementar SQL.

## 4. Registra eventos semánticos elegibles

Implementa como propuesta los eventos `CLASS_JOINED`, `ACTIVITY_OPENED`, `EXECUTION_COMPLETED`, `ATTEMPT_SUBMITTED`, `HINT_DELIVERED` y `FEEDBACK_VIEWED`, emitidos o validados por servidor con actor, organización, clase, actividad cuando corresponda, entidad, instante UTC, versión de schema y clave de deduplicación. Registra la asociación que permite decidir si el evento es elegible para una actividad.

- No uses timestamps libres del navegador ni cuentes GET de polling, refrescos automáticos, sondeos o acciones de administrador como actividad del estudiante.
- Exige apertura explícita autenticada para eventos de lectura y deduplica repeticiones. Una pista fallida no constituye `HINT_DELIVERED`.
- Las reglas basadas en intentos usan envíos confirmados; no cuentan ejecuciones de práctica, solicitudes duplicadas ni mensajes del LLM.
- Coordina evento y operación de dominio en la transacción cuando corresponda. Si un evento se entrega mediante trabajo durable, garantiza deduplicación y reconstrucción verificables.
- Cierra en DEC-005 qué eventos reinician inactividad y cómo los eventos sin actividad se relacionan con su evaluación. No atribuyas actividad de una clase a todas las actividades por conveniencia.

## 5. Implementa las tres reglas y conserva su estado de propuesta

Los únicos tipos documentados son `INACTIVITY`, `REPEATED_ERROR`, `STAGNATION`; los estados son `ACTIVE`, `REVIEWED`. Cada señal conserva tipo, causa legible, hechos/IDs, fecha de cálculo, versión y parámetros de regla, ventana y estado. «No verificable» describe falta de evidencia para evaluar; no crea un tercer estado de señal.

### Inactividad

La obligación documentada es siete días consecutivos sin eventos después de inscripción y antes del cierre. Implementa la propuesta bajo DEC-005 por estudiante/clase/actividad publicada:

1. Calcula `baselineAt=max(enrolledAt,publishedAt,opensAt si existe)`.
2. Calcula `lastAt=max(baselineAt, último evento elegible de esa actividad)`.
3. Evalúa con reloj UTC si `evaluationTime-lastAt >= 7×24 horas`, estudiante inscrito/activo y actividad habilitada para trabajar.
4. Guarda el evento de referencia o inscripción/publicación si nunca hubo eventos. Una actividad futura o cerrada no crea señales nuevas; preserva señales históricas.

No sustituyas «sin eventos» por «sin envíos». La duración de siete períodos de 24 horas frente a días de calendario local debe quedar explícita en DEC-005; los cambios de horario de Chile no pueden alterar el resultado de fixtures basados en instantes UTC.

### Error repetido

La obligación documentada es el mismo error técnico en tres intentos consecutivos dentro de 14 días. Bajo propuesta DEC-005:

1. Agrupa por estudiante, clase, asignación y versión de ejercicio.
2. Ordena por fecha de envío del servidor y desempate monotónico persistido; no confíes en orden de respuesta HTTP, timestamp cliente o UUID aleatorio para establecer consecutividad.
3. Toma los tres últimos intentos confirmados. Exige diagnóstico idéntico en `{SYNTAX_ERROR,RUNTIME_ERROR,FAILED_TEST,TIMEOUT}` y diferencia primero–último `<=14×24 horas`.
4. `SUCCESS` o `UNKNOWN` interrumpe la secuencia. Un fallo de infraestructura sin intento completo no acredita error repetido.

Para `FAILED_TEST`, la propuesta agrupa por diagnóstico grueso, no por un error conceptual inferido. Una firma determinista más específica exige DEC-005. No agrupes por texto libre de excepciones que varía o expone datos sensibles.

### Estancamiento

La obligación documentada es tres intentos de un ejercicio sin aumentar pruebas visibles superadas. Bajo propuesta DEC-005, toma los tres últimos intentos comparables de la misma asignación y versión de tests, con conteos visibles completos `p1,p2,p3`; genera señal si `p2<=p1` y `p3<=p2`, siempre que el último no complete el ejercicio.

No compares suites/versiones diferentes ni trates un conteo parcial como cero. Si falta evidencia completa, deja la evaluación no verificable sin crear señal. No sustituyas la comparación no creciente por «no supera el máximo histórico» sin ratificación: cambia los resultados. Error repetido y estancamiento pueden coexistir cuando ambas reglas conservan evidencia propia.

## 6. Persiste versiones, episodios y revisión idempotente

1. Crea versiones de reglas con autor, fecha, parámetros y vigencia. Valida datos y mantén inmutables versiones activadas. Serializa activación por organización/tipo; solo una versión es aplicable en cada instante y no se permiten intervalos incompatibles por concurrencia.
2. Evalúa con versión explícita y guarda esa identidad en la señal. Publicar nueva regla no reinterpreta ni modifica las señales existentes.
3. Construye una clave de episodio propuesta por estudiante, ámbito, tipo, versión de regla e identidad de evidencia. Para inactividad usa `lastAt`; para reglas de intentos usa IDs ordenados de los tres intentos. No incluyas la hora cambiante del job como única identidad de episodio.
4. Usa unicidad/transacción para que recalcular la misma evidencia conserve el registro existente, incluso en workers concurrentes. Una señal `REVIEWED` no vuelve a `ACTIVE` por recálculo idéntico.
5. Evidencia nueva puede crear episodio nuevo después de reevaluar. Conserva vínculo al previo del mismo estudiante/ámbito, sin ciclos. La agrupación visual entre episodios y control de repetición requieren DEC-005; no borres evidencia para reducir volumen.
6. Al revisar, verifica profesor asignado y ámbito actual; registra transición condicional `ACTIVE → REVIEWED`, una revisión única, fecha de servidor, responsable y auditoría en una transacción.
7. Si ya estaba revisada, devuelve su estado y conserva primer responsable/fecha. Dos solicitudes concurrentes no crean dos revisiones. Revisión no implica resolución, sanción, calificación o mejora de aprendizaje.

No agregues `RESOLVED`, `DISMISSED` ni estados automáticos. No otorgues al modelo, a un job de recálculo o al cliente permiso de revisar en nombre del docente.

## 7. Integra las consultas de tablero y detalle

Implementa los contratos propuestos de `/me/progress`, `/classes/{id}/dashboard`, `/classes/{id}/students/{userId}/progress`, `/classes/{id}/signals`, `/signals/{id}/review` y gobierno de reglas de spec 07. Mantén consultas y detalle bajo el mismo ámbito autorizado; filtra antes de agregar, contar y paginar.

Expón estudiantes inscritos/activos, última actividad observable, intentos por diagnóstico, completados/requeridos, fallas frecuentes por concepto, ayudas concedidas y señales por tipo/estado. Incluye filtros activos y fecha de cálculo. Cada cifra debe abrir evidencia compatible, sin ampliar permisos ni revelar otras clases/organizaciones. Un admin de reglas no adquiere por ese permiso acceso al detalle del alumno.

Evita multiplicar intentos por joins de conceptos o referencias RAG. Una consulta vacía muestra ausencia de datos; dependencia caída muestra error, no cero ni ausencia de evidencia académica. Valida RLS/proyecciones expuestas además de autorización NestJS. Si se utiliza caché, incluye ámbito, filtros, corte y versión necesarios para no compartir resultados entre usuarios o reglas incompatibles.

## 8. Ejecuta fixtures de aceptación al implementar

Conserva los identificadores SIG-01–SIG-14 del [spec 14](../../specs/14-progreso-y-senales.md) y vincúlalos a ALZ-PT-015/018/019/026. Son pruebas futuras, no evidencia ejecutada de este documento.

| Fixture | Resultado obligatorio bajo las reglas propuestas |
| --- | --- |
| SIG-01/02 | A 6 días 23:59:59 no hay `INACTIVITY`; a 7 días exactos en actividad abierta sí, con evento de referencia. |
| SIG-03/04 | Inscripción antigua con publicación hace 2 días no genera inactividad; cierre impide señal nueva sin borrar anterior. |
| SIG-05/06 | Tres `FAILED_TEST` en 14 días exactos generan `REPEATED_ERROR`; 14 días y 1 segundo no. |
| SIG-07/08 | `FAILED_TEST,SUCCESS,FAILED_TEST` y `FAILED_TEST,UNKNOWN,FAILED_TEST` interrumpen repetición. |
| SIG-09/10/11 | Conteos `1,1,1` y `2,1,1` generan `STAGNATION`; `1,2,2` no. |
| SIG-12 | Conteos iguales con suites/versiones distintas no permiten verificar estancamiento ni crear señal. |
| SIG-13/14 | Recálculo idéntico no duplica; revisión concurrente conserva una transición y el primer revisor/fecha. |

Añade casos de empate de timestamps con orden estable, eventos duplicados, ayudas fallidas, actividad futura, alumno deshabilitado, cambios de horario, últimas pruebas incompletas, último intento exitoso, versiones de reglas concurrentes, episodios nuevos y aislamiento entre las tres clases de demo. Para progreso, verifica denominador cero, ausencia de intentos, asignación repetida en dos actividades, múltiples conceptos, práctica sin envío, fallo oculto y éxito anterior a un fallo posterior.

Compara agregados contra un cálculo independiente de fixtures, no contra la misma consulta o función bajo prueba. Reconstruye vistas/cachés desde hechos y comprueba que los resultados se conservan. Cambia deliberadamente respuestas del modelo y simula caída completa de Azure OpenAI: deben permanecer las mismas cifras, reglas y señales.

Entrega servicios/consultas, contratos, esquema y transacciones coordinadas, eventos elegibles, versiones/fixtures, pruebas de concurrencia y permisos, y evidencia enlazada a requisitos. Registra comandos y resultados reales, versión de regla y reloj usados, decisiones pendientes y capacidades sin probar. No marques un RF aceptado por disponer solo de vistas con datos simulados o de tests aún no ejecutados.
