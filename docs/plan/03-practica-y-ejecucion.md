# IMP-03 — Práctica técnica y ejecución controlada

Estado inicial: **pendiente de implementación**. Este plan propone el orden del trabajo; no acredita código, integración, pruebas ni aceptación. Las rutas de artefactos son orientativas y se adaptarán al árbol real del repositorio. La fase desarrolla ALZ-RF-007/009/010/011/014 y revalida la integración de ALZ-RF-008 construida en IMP-02.

## Resultado y demostración de la fase

Un estudiante inscrito abre una actividad publicada, modifica su borrador, ejecuta JavaScript y consulta un resultado temporal. Al enviar, confirma la acción y obtiene un intento persistido con diagnóstico determinista. Puede recuperar el intento después de recargar, copiarlo al editor y enviar una nueva versión sin perder la anterior. La lista de actividades refleja avance real basado en pruebas requeridas, incluidas las ocultas.

La demostración incluye una solución incorrecta, una correcta, una ejecución detenida por límite y un intento de acceder a datos ajenos. Se demuestra con la API NestJS, PostgreSQL con RLS, interfaz y ejecutor real; la IA no es una dependencia de este recorrido. El adaptador Docker acredita el recorrido local y Vercel Sandbox acredita la integración productiva cuando se ejecute en un entorno autorizado.

## Lecturas, entradas y dependencias

Leer [ejecución controlada](../../specs/13-ejecucion-controlada.md), [API](../../specs/07-api-y-contratos.md), [modelo](../../specs/06-modelo-de-datos.md), [progreso](../../specs/14-progreso-y-senales.md), [guía del ejecutor](../agent/06-ejecucion-segura.md) y [decisiones](../agent/12-decisiones-pendientes.md). Los requisitos y escenarios originales están en [RF](../../specs/02-requisitos-funcionales.md) y [aceptación](../../specs/03-flujos-y-criterios-de-aceptacion.md).

Entradas necesarias de IMP-01/02:

- Identidad verificada, perfiles y membresías activas; autorización por organización, clase y recurso; contexto transaccional de RLS probado con un rol sin `BYPASSRLS`.
- Una actividad publicada con asignaciones y versiones fijas, conceptos, pruebas visibles/ocultas y solución de referencia. La pertenencia a una organización no concede acceso a todas sus clases.
- Editor con plantilla, borrador local, estados de carga/error y recuperación comprobada; confirmación de envío aún por integrar.
- Contratos comunes, migraciones, auditoría mínima, correlación, CI y entorno local reproducible de IMP-00.
- Evidencia de los ensayos tempranos de IMP-00 sobre aislamiento y límites. Se revisan y repiten con el arnés definitivo; el prototipo no cierra esta fase.

| Decisión | Trabajo previo o dentro de la fase | Qué impide dar por aceptado si sigue pendiente |
| --- | --- | --- |
| DEC-002 | Registrar semántica de confirmación, admisión, cierre y acceso histórico; preparar carreras reproducibles | Envíos concurrentes al cierre e historial CLOSED sin interpretación ratificada |
| DEC-003 | Fijar unidades exactas, restricciones de función, mecanismo de límites y precedencia de diagnóstico con ensayos reales | Seguridad del ejecutor, fronteras y confidencialidad de pruebas ocultas |
| DEC-004 | Concretar DTO, idempotencia, reserva, resultado durable, reconciliación y orden de eventos | Confirmación fiable del intento y recuperación después de una caída |
| DEC-006/007 | Revisar diccionario de intentos/resultados y compatibilidad de runtime, SDK y herramientas | Esquema compartido o adaptador presentado como compatible sin evidencia |
| DEC-008 | Definir perfil de carga y medir ciclo completo desde Chile | Cumplimiento de p95 y elección de región por rendimiento |

Las elecciones rutinarias reversibles pueden registrarse y ejecutarse dentro de una futura tarea de implementación autorizada. No es necesario detener el trabajo local por credenciales ausentes; sí debe quedar pendiente la integración que las requiere. No se modifica AD-ARQ-001 para sortear un ensayo fallido.

## Incrementos en orden

Cada incremento debe dejar comportamiento verificable, una demostración acotada y evidencia. El estado inicial de los ocho es **pendiente**. Los prefijos identifican trabajo técnico, no nuevos RF ni sprints académicos.

| Incremento | Resultado observable | Artefactos propuestos | Comprobaciones para cerrar el incremento |
| --- | --- | --- | --- |
| IMP-03.01 Contrato de ejecución y admisión | Una solicitud autorizada identifica exactamente versión, modo y presupuesto; una solicitud inválida no inicia procesos | DTO públicos en `packages/contracts`; puerto `ExecutionInput/ExecutionResult`, tipos privados, fixtures y protocolo solo en API/runner; registro DEC-002/003/004 | Entradas malformadas, versión ajena, estado inactivo, cliente que aporta pruebas o aumenta límites; prueba de separación entre confirmación de interfaz, admisión y persistencia |
| IMP-03.02 Supervisor Docker | Una función válida devuelve resultado y una abusiva se detiene sin comprometer el anfitrión | Adaptador Docker local, arnés fijo, supervisor externo, canal de retorno, control de recursos y limpieza; instrucciones locales | Casos de los seis diagnósticos, red/archivos/secretos, memoria externa, procesos hijos, límites acumulados y protocolo falsificado; nunca `eval` del anfitrión |
| IMP-03.03 RUN completo | El botón Ejecutar recorre web → NestJS → Docker y muestra solo pruebas visibles con estado temporal | Ruta de ejecución, servicio de autorización/cupos, proyección pública, componentes de resultados y estados de error del editor | RUN no crea completitud ni habilita pistas sin intento; aislamiento por clase/actor; error o cuota conserva borrador; recarga no transforma resultado temporal en intento |
| IMP-03.04 SUBMIT durable | Confirmar Enviar crea un intento recuperable con resultado canónico, código, versiones y eventos | Reserva idempotente, ejecución SUBMIT, repositorios, transacción de confirmación, respuesta persistida, migración y recuperación de reservas | Cancelar confirmación no muta; prueba oculta fallida impide completar; fallo de commit no confirma ni inicia ayuda; duplicados y caída después de commit producen un único intento |
| IMP-03.05 Historial y reintento | El estudiante consulta detalle, compara evidencia visible y crea un nuevo intento desde una copia del anterior | Consultas autorizadas, orden estable, pantalla de historial/detalle, copia al editor, nueva clave para envío intencional | Original intacto; intento ajeno inaccesible; dos envíos intencionales conservan IDs distintos; reenvío de transporte conserva ID; actividad cerrada conserva borrador e historial permitido |
| IMP-03.06 Avance real en actividades | RF-007 presenta completados/requeridos y estados vacíos correctos después de enviar | Proyección mínima determinista por asignación/versiones, consulta de actividad, presentación accesible y eventos reutilizables por IMP-05 | RUN sin cambio; visible exitosa/oculta fallida sin incremento; éxito previo no se pierde tras error posterior; `0/0` distinto de `0/N`; consulta caída no se representa como cero |
| IMP-03.07 Vercel Sandbox y recuperación | El mismo recorrido y fixtures operan en el adaptador productivo, con cleanup ante fallos | Adaptador Sandbox, configuración efectiva 1 vCPU/2 GB, control de límites internos, reconciliador/recolector de huérfanos e instrumentación | Paridad Docker/Sandbox, pruebas adversarias en ambos, interrupción de API, fallo de proveedor, vencimiento y reintento; ejecución real autorizada, sin extrapolar resultados locales |
| IMP-03.08 Aceptación del recorrido | Otra persona puede reproducir publicar → ejecutar → enviar → consultar → reintentar con evidencia completa | Cypress del flujo, suites Jest/integración, fixtures adversarios, registro RF/PT/RNF, OpenAPI y guía operativa actualizados | Escenarios de la capacidad técnica de los cinco RF y regresión RF-008; ALZ-HU-010-E4 queda para revalidación integrada en IMP-04; secretos/tests ocultos ausentes; ciclo completo medido y pendientes registrados |

IMP-03.01/02 construyen el núcleo técnico comprobable que hace posible el primer recorrido vertical de IMP-03.03. No se marca RF-009 completo por disponer solamente del puerto o de fixtures. Se puede iniciar el adaptador Sandbox al estabilizar ese núcleo para detectar diferencias pronto; su aceptación requiere el recorrido persistente de IMP-03.04 y la batería completa de IMP-03.07.

## Contratos que deben quedar resueltos

### RUN, SUBMIT y diagnóstico

`RUN` ejecuta exclusivamente las verificaciones visibles del modo y devuelve resultado temporal. `SUBMIT` ejecuta todas las verificaciones requeridas visibles y ocultas, y crea evidencia confirmada. El backend deriva ejercicio, tests, límites, actor y ámbito; no toma del navegador un resultado aprobado ni una ejecución anterior como autoridad del envío.

La respuesta interna separa resultados privados de la proyección pública e identifica `executionId`, `exerciseVersionId`, `testsVersion` y `runnerVersion`. Se conservan duración estudiantil, ciclo completo, motivo operativo y estado de infraestructura. La API nunca serializa automáticamente el objeto completo del adaptador.

| Diagnóstico exacto | Evidencia necesaria | Límite de interpretación |
| --- | --- | --- |
| `SUCCESS` | Protocolo completo y todas las verificaciones requeridas del modo superadas | Un RUN exitoso no completa la asignación |
| `SYNTAX_ERROR` | Error de sintaxis atribuible al código | Entrada HTTP inválida se rechaza antes de ejecutar |
| `RUNTIME_ERROR` | Excepción estudiantil con evidencia confiable | Un fallo del proveedor no es error del alumno |
| `FAILED_TEST` | Ejecución terminada con alguna verificación fallida | No revela entradas, resultados esperados ni mensajes de casos ocultos |
| `TIMEOUT` | Presupuesto estudiantil total de 3 s excedido | No equivale al timeout HTTP o de aprovisionamiento |
| `UNKNOWN` | Evidencia inconclusa o terminación sin atribución concluyente | Memoria/salida/infraestructura se detallan como motivos operativos separados |

La precedencia propuesta del [spec 13](../../specs/13-ejecucion-controlada.md) se valida con fallos concurrentes en DEC-003. No se agregan diagnósticos para memoria, salida o proveedor ni se devuelve éxito parcial.

### Presupuestos y protección del ejecutor

| Capa | Obligación | Evidencia a guardar |
| --- | --- | --- |
| Entorno productivo | Vercel Sandbox 1 vCPU y 2 GB | Configuración efectiva del proveedor y versión del adaptador |
| Código estudiantil | 128 MB de memoria total, incluidos recursos externos al heap y descendientes | Medición y mecanismo de imposición; no basta `--max-old-space-size` |
| Tiempo estudiantil | 3 s acumulados para todo el intento, no por prueba | Supervisor externo, reloj medido y fixture de varios tests que agotan juntos el plazo |
| Salida estudiantil | 64 KB, captura limitada antes de acumular en API | Fronteras y tormenta simultánea de stdout/stderr, truncamiento y causa |
| Ciclo completo | Objetivo p95 <5 s | Aprovisionamiento, ejecución, limpieza, persistencia y respuesta; región, muestra, concurrencia y arranques fríos/calientes |

128 MiB y 64 KiB combinados son una interpretación **propuesta**, pendiente DEC-003; no se intercambian MB/MiB o KB/KiB durante la prueba. El límite propuesto del código fuente es otro contrato y no sustituye el de salida.

El arnés carga código como datos y no lo interpola en comandos o rutas. El proceso estudiantil carece de secretos, volúmenes del anfitrión, red no autorizada y privilegios sobre el supervisor. Cada caso se ejecuta con estado limpio. Se prohíben procesos hijos o se someten al mismo presupuesto y limpieza demostrados.

Las pruebas ocultas requieren separación adicional dentro del sandbox: comparador, expectativas y archivos de control no son legibles ni modificables por el alumno. Los argumentos entregados a su función sí pueden observarse durante la ejecución; por tanto, stdout/stderr y mensajes derivados de casos ocultos se suprimen de API, interfaz, errores, logs generales y contexto de IA. El canal de retorno no confía en texto impreso como `passed=true`. Se prueban falsificación, introspección de procesos, modificación de casos futuros y extracción por stacks.

### Admisión, transacciones e idempotencia

1. La interfaz pide confirmación antes de enviar. Cancelar conserva el editor y no crea reserva ni intento.
2. El servidor valida identidad y permisos vigentes, actividad/ventana/versiones y límites; reserva admisión e idempotencia de forma atómica respecto del cierre.
3. La ejecución externa sucede fuera de una transacción de BD larga. La reserva identifica la operación, pero no significa intento guardado.
4. Al finalizar SUBMIT se confirma en una transacción el intento, código, resultado canónico, versiones, eventos y respuesta idempotente. Solo después se comunica registro exitoso.
5. Una ayuda sobre ese intento podrá invocar recuperación, embeddings de consulta o generación únicamente después del commit. En esta fase se establece y prueba esa frontera; la ingestión docente independiente de IMP-04 no requiere intento.
6. Si se pierde la respuesta tras commit, repetir clave/payload recupera el mismo resultado. Si el payload cambia con la misma clave, se devuelve conflicto. Un reintento intencional lleva nueva clave.
7. Al vencer una reserva o caer el backend, un proceso durable reconcilia el resultado y los efectos ya ejecutados antes de repetirlos. No se presume entrega exactamente una vez ni se usa una cola en memoria como garantía.

La propuesta DEC-002 admite solo mientras la actividad está PUBLISHED; una admisión anterior al cierre puede terminar y persistirse después, mientras una posterior se rechaza. Se registran por separado confirmación del estudiante, admisión, cierre y commit. Su aceptación sigue pendiente de la decisión correspondiente; el plan no la ratifica.

### Proyección mínima para RF-007

La unidad propuesta es la asignación requerida con versión fija. `completed` cuenta asignaciones con al menos un intento confirmado que supera todas las pruebas requeridas; `required` cuenta obligaciones del ámbito. Mostrar ambos contadores y calcular el cociente sin redondear la evidencia base. Con cero requeridos el cociente es nulo; con requeridos y sin intentos es cero con estado de falta de intentos.

Un éxito queda conservado para esa asignación aunque un intento posterior falle. Un cambio de versión no hereda éxito silenciosamente. Esta proyección se reutiliza en IMP-05 para conceptos, filtros, tablero y señales; no se implementa una segunda fórmula. Una consulta fallida presenta error operativo, no evidencia académica vacía.

## Cobertura de aceptación y riesgos

| RF y trazabilidad del mismo número | Cobertura obligatoria E1–E4 y complemento |
| --- | --- |
| ALZ-RF-007 · HU/CU/PT-007 | Publicación con avance real; filtro inválido; clase ajena; lista vacía. Acceso histórico CLOSED según DEC-002 |
| ALZ-RF-009 · HU/CU/PT-009 | Ejecución válida; sintaxis/entrada inválida; usuario sin acceso; límites. Añadir red, memoria externa, descendientes y protocolo |
| ALZ-RF-010 · HU/CU/PT-010 | Intento durable; cierre/validación/commit fallido; autor o clase ajenos; caída posterior de ayuda. E4 exige revalidación integrada con IMP-04 |
| ALZ-RF-011 · HU/CU/PT-011 | Diagnósticos y comparación visibles; solicitud oculta/ID inválido; intento ajeno; UNKNOWN. Probar que datos de IA no pueden modificar el resultado |
| ALZ-RF-014 · HU/CU/PT-014 | Nuevo intento conserva anterior; cierre/invalidez; copia ajena; concurrencia intencional. Distinguir duplicado de transporte |
| Regresión ALZ-RF-008 · HU/CU/PT-008 | Plantilla y borrador; recuperación fallida; recurso ajeno; archivo/cierre conforme a DEC-002 |

Los IDs completos de escenarios se conservan en el [spec de aceptación](../../specs/03-flujos-y-criterios-de-aceptacion.md); las comprobaciones adicionales no los reemplazan. Vincular los resultados a RNF-REN-02, RNF-SEG-04, RNF-CON-01/04 y demás controles de seguridad, uso y calidad aplicables del [plan de pruebas](../../specs/10-calidad-y-pruebas.md).

| Riesgo | Ensayo o tratamiento antes de aceptar |
| --- | --- |
| Sandbox no permite imponer el presupuesto interno real | Repetir ensayo de IMP-00 con código adversario y mecanismo final. Registrar impedimento DEC-003; no aceptar ejecutor productivo ni sustituir arquitectura implícitamente |
| Entorno aislado pero pruebas privadas extraíbles | Ensayar archivos, procesos, stdio, stacks y canal de control; revisar proyección pública extremo a extremo |
| Caída deja duplicados, pérdida de resultados o entornos vivos | Inyectar fallos antes/después de reserva, ejecución y commit; comprobar reconciliación y recolector con correlación durable |
| La carrera con cierre cambia el significado del envío | Comparar los órdenes posibles con timestamps de servidor; registrar decisión y alinear UI/API/BD |
| El arranque del proveedor impide p95 | Medir recorrido completo y documentar DEC-008; el tiempo del programa aislado no prueba la meta |

## Condición de cierre y siguiente fase

- [ ] Los escenarios de la capacidad técnica de los cinco RF están implementados y registrados; RF-008 no presenta regresiones. ALZ-HU-010-E4 conserva pendiente su revalidación con la ayuda real de IMP-04, sin bloquear el avance de esa fase ni dar por aceptada anticipadamente esa integración.
- [ ] RUN y SUBMIT recorren las capas reales; historial y avance provienen de persistencia, no de datos simulados.
- [ ] Docker y Sandbox tienen evidencia separada de aislamiento, límites, confidencialidad y limpieza; una integración ausente permanece pendiente.
- [ ] Duplicados de transporte y reintentos intencionales cumplen contratos distintos; commit fallido no confirma ni invoca ayuda.
- [ ] Los seis diagnósticos y sus motivos conservan semántica; fallas operativas no se atribuyen al estudiante.
- [ ] Pruebas de API/RLS rechazan acceso entre organizaciones, clases y estudiantes; se verificaron también DTO, logs e interfaz.
- [ ] Contratos OpenAPI, migraciones, instrucciones y evidencia reflejan el estado real; DEC y p95 pendientes no aparecen como aprobados.
- [ ] Se realizó una demostración repetible del recorrido y se documentaron defectos que impiden aceptación.

Tras contar con intentos y resultados confiables se habilitan dos ramas: [IMP-04 Ayuda contextual](04-ayuda-contextual.md) e IMP-05 Evidencia determinista. IMP-05 puede desarrollarse sin esperar al proveedor de IA. Si solo falta validar Sandbox, se puede avanzar sobre evidencia local identificada como tal; la práctica productiva continúa pendiente.

## Prompt de inicio acotado

```text
Lee AGENTS.md, docs/plan/03-practica-y-ejecucion.md y las guías de ejecución,
backend, datos y pruebas que correspondan. Inspecciona Git y el código actual.
Implementa únicamente el primer incremento pendiente de IMP-03 dentro de las
dependencias disponibles. Antes de editar, identifica su ID, RF/HU/CU/PT,
archivos, contratos, escenarios y decisiones que afectan aceptación.
Conserva RUN/SUBMIT, los seis diagnósticos, los dos niveles de recursos,
el aislamiento de pruebas ocultas y la persistencia anterior a ayuda RAG.
Prueba la ruta real y los rechazos/fallos pertinentes. No presentes mocks ni
resultados Docker como prueba de Sandbox. Registra supuestos y evidencia;
resuelve detalles reversibles y continúa trabajo independiente si falta una
decisión o integración. Al cerrar, informa qué quedó implementado, probado
y pendiente, y el siguiente incremento. No inicies otra fase por omisión.
```
