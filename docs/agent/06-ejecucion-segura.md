# Instrucciones para implementar la ejecución segura

Estado: instrucciones para un agente que escribirá código. Este archivo no acredita un ejecutor implementado ni pruebas ejecutadas. Los puertos, protocolos y nombres nuevos que se indican son propuestas de implementación, sujetos a DEC-003/004. Conserva la arquitectura AD-ARQ-001 y los límites documentados.

## 1. Lee y delimita el trabajo

Lee primero [fuentes y decisiones](../../specs/00-fuentes-y-decisiones.md), [ejecución controlada](../../specs/13-ejecucion-controlada.md), [arquitectura](../../specs/05-arquitectura.md), [datos](../../specs/06-modelo-de-datos.md), [API](../../specs/07-api-y-contratos.md) y [seguridad](../../specs/09-seguridad-y-privacidad.md). Consulta ALZ-RF-008/009/010/011/014, sus CU/PT y los escenarios E1–E4 en [requisitos](../../specs/02-requisitos-funcionales.md) y [aceptación](../../specs/03-flujos-y-criterios-de-aceptacion.md).

Relaciona cada entrega con RNF-REN-02, RNF-SEG-04 y RNF-CON-01/04 de [calidad](../../specs/10-calidad-y-pruebas.md). Coordina la integración posterior con [IA/RAG](07-ia-y-rag.md) y [progreso y señales](08-progreso-y-senales.md).

Antes de editar, inspecciona el código realmente existente, las instrucciones aplicables, el estado de Git y las herramientas disponibles. No presupongas archivos, servicios, credenciales ni comandos ya creados. Si existen adaptadores o contratos, compara sus invariantes con los specs y modifica solo lo necesario.

## 2. Resuelve las dependencias sin ampliar el alcance

| Decisión | Trabajo que puedes preparar | Condición para aceptar la capacidad dependiente |
| --- | --- | --- |
| DEC-003 | Puerto del ejecutor, fixtures, supervisor experimental y medición de límites | Fijar unidades, clasificación y protocolo; demostrar memoria total, plazo total y confidencialidad de pruebas ocultas. |
| DEC-004 | DTO propuestos, reserva idempotente y pruebas de concurrencia | Registrar contrato de ejecución, persistencia y reconciliación; publicar OpenAPI coherente. |
| DEC-002 | Validación de estados y prueba de carrera cierre–envío | Aplicar la resolución del 26/09/2026: admitidos antes del cierre pueden persistir después, con autorización vigente para entregar; rechazar nuevas admisiones posteriores y no inventar reapertura. |
| DEC-006/007 | Diseño de repositorios y selección reproducible de runtime | Resolver el modelo antes de la primera migración según su decisión y comprobar compatibilidad real de versiones. |
| DEC-008 | Instrumentación y perfil de medición | Medir regiones y recorrido completo desde Chile con carga y muestra registradas. |

Registra decisiones rutinarias y reversibles, como nombres internos o ubicación de fixtures, y avanza con ellas. Conserva el estado de propuesta cuando una decisión no tenga aprobación acreditada. Si una elección cambia permisos, requisitos o límites, prepara alternativas verificables y deja pendiente solo la parte dependiente; no cambies silenciosamente la línea base ni declares aceptación por disponer de un prototipo.

## 3. Construye el puerto y los dos adaptadores

Define un puerto de dominio para ejecutar JavaScript con adaptador productivo Vercel Sandbox y adaptador local Docker. Evita dependencias de SDK de proveedor en los servicios de intento, API o progreso. No ejecutes código estudiantil en el proceso de NestJS, el navegador como autoridad, un worker del backend o un `eval` del anfitrión.

Materializa el contrato propuesto de [spec 13](../../specs/13-ejecucion-controlada.md):

| Entrada confiable | Resultado interno |
| --- | --- |
| `executionId`, `requestId`, `exerciseVersionId`, `testsVersion`, `runnerVersion` | Identidad y versión que permitan reconstruir lo ejecutado. |
| `mode: RUN \| SUBMIT`, código limitado y `entrypoint` validado | `diagnosisCode`, resultados visibles y privados separados, `allRequiredPassed`. |
| Pruebas y límites cargados por el servidor | `stdout`, `stderr`, `outputTruncated`, `runtimeMs`, `lifecycleMs`. |
| Ámbito autorizado resuelto antes de la llamada | `terminationReason`, `infrastructureStatus`, región y consumo observado. |

Los nombres del puerto son una guía; conserva su semántica al adaptarlos al repositorio. Separa la respuesta privada del DTO público con una proyección explícita. No serialices automáticamente todo el resultado del adaptador.

Fija mediante fixtures el contrato del ejercicio: JavaScript, función de entrada válida, argumentos JSON, retorno JSON y comparación estructural exacta. Las tolerancias numéricas solo existen cuando la versión del ejercicio las declara. Documenta si se aceptan funciones síncronas o asíncronas antes de publicar ejercicios. No añadas npm arbitrario, DOM, proyectos de varios archivos o acceso a servicios externos al MVP.

## 4. Impón límites reales y separados por capa

| Límite documentado | Instrucción de implementación | Prueba que debes obtener |
| --- | --- | --- |
| Sandbox: 1 vCPU y 2 GB RAM | Configura el entorno productivo y captura su configuración efectiva. | Registro del entorno real; la configuración del proveedor no prueba el límite del proceso. |
| Proceso estudiantil: 128 MB | Limita memoria total del proceso y descendientes, incluida memoria externa al heap. | Heap, buffers nativos, asignaciones repetidas y procesos hijos. `--max-old-space-size` por sí solo no acredita esta condición. |
| Programa: 3 segundos | Usa un supervisor externo al proceso estudiantil y un presupuesto acumulado para todo el intento. | Bucle infinito, bloqueo y varios casos cuyo total supera 3 s; termina también descendientes. No concedas 3 s nuevos por cada test. |
| Salida: 64 KB | Captura con tope antes de acumular en memoria de API; conserva truncamiento y motivo operativo. | Tormenta simultánea de stdout/stderr y frontera exacta según unidad acordada. |
| Ejecución completa: p95 <5 s | Mide aprovisionamiento, programa, limpieza, persistencia y respuesta. | Perfil reproducible con muestra, región, concurrencia y arranques fríos/calientes. |

La propuesta interpreta memoria como 128 MiB y salida como 64 KiB combinados stdout/stderr. Déjala marcada como propuesta hasta cerrar DEC-003; no anuncies cumplimiento de fronteras mezclando unidades. El límite propuesto del tamaño de código de la API es independiente del límite documentado de salida.

## 5. Implementa el ciclo de vida en este orden

1. Verifica identidad, cuenta y membresía activas, estudiante propio, organización, clase, actividad `PUBLISHED`, ventana habilitada y versión asignada. Deriva pruebas, límites y ámbito desde el servidor. Rechaza campos cliente que pretendan conceder éxito, aportar pruebas ocultas o aumentar recursos.
2. Reserva la idempotencia y admisión con clave, actor, ámbito, operación y hash de payload. Una clave repetida con otro código produce conflicto. Serializa la admisión respecto del cierre conforme a DEC-002. Una reserva pendiente no es un intento confirmado.
3. Crea un entorno desechable sin secretos, variables del anfitrión, volúmenes del anfitrión ni red no autorizada. Configura egreso denegado por defecto e identidad estudiantil sin privilegios. Mantén la credencial del proveedor fuera del entorno estudiantil.
4. Escribe código como archivo de datos con ruta generada por servidor. Nunca lo interpoles en comandos, rutas o líneas de shell. Prepara un arnés fijo y un supervisor que el estudiante no pueda modificar ni terminar.
5. Ejecuta cada prueba con estado limpio bajo el mismo presupuesto total. Transporta retornos por un canal controlado separado de stdout/stderr. El arnés no acepta texto impreso por el alumno como protocolo de resultado.
6. Aplica terminación de tiempo, memoria, salida y políticas; normaliza evidencia sin inventar éxito. Ejecuta limpieza en la ruta normal y ante excepción, desconexión o interrupción. Cierra descendientes y destruye el entorno.
7. Para `RUN`, devuelve exclusivamente el resultado público temporal de pruebas visibles. No completes progreso ni habilites pistas por una ejecución sin intento persistido.
8. Para `SUBMIT`, ejecuta todas las pruebas requeridas visibles y ocultas. Persiste intento, código, versión, resultado canónico confiable, eventos y respuesta idempotente en una transacción. Ejecuta Sandbox fuera de la transacción de base de datos. Solo tras commit confirma `201` y habilita feedback.
9. Si el commit falla, no confirmes envío ni llames recuperación, embeddings o generación; permite al cliente conservar editor y clave. Reconcilia reservas vencidas con la ejecución y el resultado durable antes de repetir efectos externos.
10. Añade detección y cierre de entornos huérfanos tras caída del backend. Registra correlación, versiones, región, duraciones, consumo, truncamiento y motivos seguros; no copies código ni pruebas a logs generales.

Un reintento deliberado usa nueva clave y conserva los intentos previos. Una retransmisión por fallo de red usa la misma clave y no crea otro intento. Mantén un resultado canónico por intento: el cliente no elige una ejecución anterior ni su resultado.

## 6. Conserva los diagnósticos exactos

| Evidencia | Diagnóstico documentado | Motivo operativo propuesto |
| --- | --- | --- |
| Protocolo completo y todas las verificaciones requeridas del modo pasan | `SUCCESS` | `COMPLETED` |
| Sintaxis inválida atribuible al código | `SYNTAX_ERROR` | `STUDENT_SYNTAX` |
| Excepción atribuible al código con evidencia confiable | `RUNTIME_ERROR` | `STUDENT_EXCEPTION` |
| Ejecución finalizada y una o más verificaciones fallidas | `FAILED_TEST` | `ASSERTION_FAILED` |
| Presupuesto estudiantil total de 3 s superado | `TIMEOUT` | `EXECUTION_DEADLINE` |
| Evidencia inconclusa, memoria/salida excedida o fallo operativo sin otra atribución confiable | `UNKNOWN` | `MEMORY_LIMIT`, `OUTPUT_LIMIT`, `POLICY_DENIED`, `RUNNER_FAILURE`, `PROVIDER_FAILURE` |

Implementa la precedencia propuesta en spec 13 con fixtures de fallos concurrentes: sintaxis previa al lanzamiento; terminación forzada; excepción estudiantil; pruebas fallidas; éxito únicamente al completar el protocolo. Una creación fallida de Sandbox o falta de credenciales no constituye error del estudiante. Un HTTP 504 de infraestructura no equivale a diagnóstico `TIMEOUT`; usa el contrato de API para operaciones no admitidas y registra la falla operativa si la ejecución ya fue admitida.

No añadas `MEMORY_ERROR`, `OUTPUT_ERROR` ni otros diagnósticos. Mantén separados estados operativos y diagnóstico técnico. Nunca devuelvas `SUCCESS` cuando hay pruebas omitidas, protocolo falsificado o ejecución parcial.

## 7. Protege las pruebas ocultas hasta la interfaz y RAG

Implementa y demuestra separación de permisos de sistema entre supervisor/comparador y proceso estudiantil. El aislamiento del Sandbox frente al anfitrión no oculta automáticamente archivos legibles dentro del entorno.

- Mantén definiciones, resultados esperados y comparadores ocultos fuera de archivos o scopes accesibles al alumno. Transmite solo los argumentos necesarios del caso y compara el retorno fuera de su control.
- Impide lectura de procesos ajenos, canales del supervisor, archivos de control y manipulación de futuros casos. Un proceso hijo debe quedar prohibido o incluido en los mismos límites aprobados.
- Considera que la función puede observar los argumentos recibidos de una prueba oculta. Suprime stdout/stderr y mensajes derivados de esos casos en respuestas públicas y en contexto de IA; también stacks, rutas, nombres reveladores y resultados esperados.
- Construye el agregado público permitido, como `hiddenChecksPassed`, sin detalles privados. Comprueba interfaz, API, respuestas de error, logs, exportaciones y feedback.
- Valida la solución de referencia y al menos una incorrecta antes de permitir publicar una versión de ejercicio. Conserva hash de suite, versión del arnés y evidencia de validación.

Si no puedes demostrar la separación real, deja RF-008/009/011 sin aceptar y documenta el impedimento concreto. Continúa módulos independientes; no reemplaces esta prueba por un mock ni llames seguro al prototipo.

## 8. Prepara y ejecuta la aceptación futura

Estos son casos a implementar y ejecutar durante el trabajo de código; no son resultados obtenidos por este documento.

| Grupo de fixtures | Casos mínimos y observación |
| --- | --- |
| Diagnóstico | Solución correcta, sintaxis, excepción, assert fallido, timeout, evidencia incompleta y múltiples fallos con precedencia. |
| Recursos | Justo debajo, en y por encima de cada límite; buffers externos; procesos descendientes; tormenta stdout/stderr; varios tests que agotan el presupuesto conjunto. |
| Aislamiento | Red/DNS no autorizados, variables/archivos ajenos, escritura del arnés, introspección, procesos hijos y acceso a canales del supervisor. |
| Confidencialidad | Intento de imprimir argumentos ocultos, leer expectativas, alterar comparador, falsificar `passed=true` y extraer secretos mediante stacks. |
| Ciclo de vida | `process.exit`, sockets abiertos, cancelación, caída de API, fallo del proveedor y recogida de huérfanos. |
| Dominio | Ejecución temporal sin progreso; envío con pruebas ocultas fallidas; commit fallido sin llamadas RAG; cierre concurrente y reenvíos idempotentes. |
| Paridad | Mismos fixtures en Docker y Sandbox con diagnósticos, redacción segura, contadores y versión del arnés equivalentes. Las métricas de infraestructura pueden variar. |

Entrega código del puerto, adaptadores y supervisor; contratos y proyección pública; integración con intentos; fixtures y pruebas; procedimiento de ejecución/limpieza; y evidencia de aceptación enlazada a RF/PT/RNF. Registra comandos reales, versiones, entorno, resultados y pruebas pendientes. Solo una ejecución real en cada adaptador puede sustentar su seguridad y paridad; no extrapoles los resultados de Docker a producción.
