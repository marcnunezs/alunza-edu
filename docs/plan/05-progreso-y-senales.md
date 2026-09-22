# IMP-05 — Progreso, señales y tablero deterministas

**Estado inicial: pendiente de implementación.** Esta fase depende de los intentos y la proyección mínima de [IMP-03](03-practica-y-ejecucion.md). Puede avanzar sin esperar a Azure OpenAI ni a la finalización de IMP-04. Fuentes: [progreso y señales](../../specs/14-progreso-y-senales.md), [guía del agente](../agent/08-progreso-y-senales.md), [API](../../specs/07-api-y-contratos.md) y [escenarios](../../specs/03-flujos-y-criterios-de-aceptacion.md).

## Resultado que podremos demostrar

El estudiante entiende cuántos ejercicios requeridos ha completado y qué evidencia lo acredita. El profesor consulta el tablero de su clase con datos reales y ve las tres señales, su causa y hechos. El administrador configura y activa versiones de reglas dentro de su organización. Caer o alterar el proveedor IA no cambia ningún cálculo.

Cobertura principal: **ALZ-RF-015, ALZ-RF-016, ALZ-RF-018 y ALZ-RF-026**. La revisión de señales y el detalle completo del estudiante se cierran en IMP-06. Esta fase reutiliza el progreso de RF-007, evitando implementar una segunda fórmula.

## Entradas y decisiones

- Intentos confirmados, diagnósticos, resultados visibles, versiones y eventos de servidor de IMP-03; pertenencias y publicación de IMP-01/02.
- DEC-005: eventos elegibles, duración de ventanas, consecutividad, firma de error, comparabilidad y episodios. Las fórmulas detalladas del spec son propuestas hasta su resolución, no decisiones pedagógicas ya aceptadas.
- DEC-004/006: orden estable, claves, transacciones, proyecciones y trabajo durable. DEC-008: perfil de medición de consultas y tablero.
- Fixtures independientes con reloj controlado y dos organizaciones; conservar SIG-01 a SIG-14, vinculados a sus PT. La parte de revisión de SIG-14 se integra completamente en IMP-06.
- Calidad: RNF-IA-01/05, RNF-CON-02, RNF-SEG-01/05, RNF-REN-01, RNF-USA-02/03/04 y RNF-MAN-02/04.

## Incrementos, en orden

| ID | Trabajo y resultado observable | Artefactos previstos | Comprobación al terminar |
| --- | --- | --- | --- |
| IMP-05.01 | Concretar eventos elegibles, orden de intentos y contratos de cálculo con ejemplos de negocio | DEC-005, schemas y fixtures/oráculos independientes | Polling no cuenta como actividad; timestamps cliente y duplicados no alteran ventanas; empates tienen desempate estable |
| IMP-05.02 | Ampliar el cálculo único de progreso a actividad/concepto y corte temporal | Funciones/consultas de dominio, proyecciones públicas y UI del estudiante | Sin requeridos, sin intentos, reutilización de ejercicio, múltiples conceptos, fallo oculto y éxito previo seguido de fallo |
| IMP-05.03 | Crear versiones inmutables de reglas, validador y servicio de activación | Migraciones, API y transacciones de reglas | Umbrales inválidos rechazados; activación concurrente no deja dos versiones vigentes incompatibles |
| IMP-05.04 | Implementar los tres evaluadores puros con reloj inyectado | Motor de `INACTIVITY`, `REPEATED_ERROR`, `STAGNATION` | SIG-01 a SIG-12 y fronteras adicionales; nunca inferencia de LLM ni uso de UNKNOWN como error pedagógico |
| IMP-05.05 | Persistir señales y episodios con deduplicación y recálculo durable | Repositorios, claves de episodio, worker y reconstrucción | SIG-13, dos workers concurrentes, reintento tras caída; recálculo idéntico no duplica ni reactiva una señal revisada |
| IMP-05.06 | Completar administración de reglas y visibilidad de parámetros efectivos | Formularios/listas de reglas por organización y auditoría | E1–E4 de HU-026; versión activada se refleja en nuevas evaluaciones, sin reescribir señales históricas |
| IMP-05.07 | Integrar tablero docente y progreso personal con filtros, corte y evidencia mínima de cada señal | Consultas/API y pantallas accesibles, Recharts cuando corresponda | Cifras iguales al oráculo, filtros antes de agregar, sin duplicar joins ni cruzar ámbitos; error de servicio distinto de cero |
| IMP-05.08 | Verificar reconstrucción, aislamiento, determinismo y recorrido de los cuatro RF | Jest, integración SQL/RLS, Cypress y evidencias | E1–E4 de HU-015/016/018/026; con la misma evidencia persistida y corte, mismos resultados ante IA caída o respuesta alterada; eventos reales de ayuda y medición del tablero comprobados |

## Fórmulas y estados que debe conservar la implementación

El denominador son las asignaciones requeridas de versiones concretas. El numerador son aquellas con algún intento confirmado que supera todas las verificaciones requeridas. RUN no completa ejercicios; repetir envíos no aumenta artificialmente el denominador ni el logro. Mostrar fracción, estado y porcentaje cuando sea calculable, sin llamarlo nota.

Conservar exactamente los tipos `INACTIVITY`, `REPEATED_ERROR`, `STAGNATION` y los estados `ACTIVE`, `REVIEWED`. «No verificable» describe falta de evidencia de evaluación, no un tercer estado persistido de señal. Las ventanas y comparaciones detalladas se implementan bajo el estado de DEC-005:

- Inactividad: siete días sin eventos elegibles, con base que contempla inscripción/publicación/disponibilidad. No generar nuevas señales de una actividad futura o cerrada.
- Error repetido: tres intentos consecutivos comparables con el mismo error técnico dentro de catorce días. `SUCCESS` y `UNKNOWN` interrumpen la secuencia propuesta.
- Estancamiento: tres intentos comparables sin incremento de pruebas visibles superadas; no convertir un conteo incompleto en cero ni mezclar versiones de suites.

Para detalle exacto, utilizar el spec 14 y sus fixtures; no mantener una variante de las fórmulas en este plan. Si se modifica una decisión, actualizar conjuntamente fixture, contrato y código antes de aceptar el resultado.

## Persistencia y presentación

Cada señal guarda parámetros, versión de regla, corte temporal, evidencia y causa legible. El motor calcula; un caso de uso autorizado persiste. La misma evidencia con la misma regla conserva identidad al recalcular; evidencia nueva puede producir otro episodio bajo la política definida. El timestamp cambiante del worker no es una clave válida de deduplicación por sí solo.

Las consultas del tablero filtran por organización, clase, pertenencias y permisos antes de contar/agrupar. No multiplicar intentos por relaciones de conceptos o citas. Proyecciones y cachés se reconstruyen desde hechos persistidos y se prueban con contexto real RLS, incluyendo alternancia de usuarios.

La información de ayudas concedidas se obtiene de eventos reales si IMP-04 ya existe. Si se avanza esta fase antes de IA, un conjunto sin eventos de ayuda puede ser válido para ese fixture, pero no acredita que se haya integrado su captura. El cierre integrado del tablero debe comprobarse otra vez con ayudas reales después de IMP-04, en IMP-06/07.

En esa integración, revalidar también `INACTIVITY`: una entrega real `HINT_DELIVERED` o lectura explícita `FEEDBACK_VIEWED` elegible puede reiniciar `lastAt` conforme a DEC-005; una ayuda fallida no lo reinicia; polling y lecturas duplicadas no crean actividad adicional. La independencia del LLM se prueba manteniendo iguales hechos persistidos, regla y corte. Un evento nuevo legítimo puede cambiar la inactividad sin romper el determinismo.

La evidencia básica exigida por RF-018 debe estar disponible en esta fase; no diferir toda explicación hasta construir RF-017. El detalle completo del alumno y la acción de revisar pertenecen a IMP-06. El administrador de reglas no adquiere por ello permiso para leer evidencia pedagógica individual.

## Criterios de cierre

- [ ] E1–E4 de HU-015/016/018/026 están cubiertos, con sus RF/CU/PT y estado de las decisiones relevantes.
- [ ] El progreso reutiliza una fórmula única con numerador/denominador y estados honestos.
- [ ] SIG-01 a SIG-13 y fronteras adicionales tienen resultados reproducibles; el almacenamiento soporta la revisión idempotente que integra IMP-06.
- [ ] Reglas y señales conservan versión, parámetros y evidencia; activación y recálculo concurrentes son coherentes.
- [ ] El tablero tiene permisos efectivos y cifras contrastadas con un oráculo independiente.
- [ ] Con los mismos hechos persistidos, regla y corte, caída y salida adversa de IA no alteran cifras ni señales; no hay decisión pedagógica automática.
- [ ] Reconstrucción de proyecciones y cachés conserva resultados, con scripts y pruebas reales.
- [ ] La captura de eventos de ayuda y su efecto temporal en inactividad están integrados o pendientes hasta verificar IMP-04; entrega/lectura elegible, ayuda fallida y duplicados tienen pruebas diferenciadas, sin simulación presentada como historial real.

## Siguiente fase y encargo

Continuar con [IMP-06](06-gobierno-y-seguimiento.md) cuando estén las bases de seguimiento y las evidencias necesarias de ayuda. Las partes de gobierno del banco y auditoría pueden avanzar mientras se completa la rama IA.

Skills útiles: `nestjs-best-practices`, `supabase-postgres-best-practices` mediante su nombre disponible `supabase:supabase-postgres-best-practices`, `vercel:react-best-practices`, `vercel:shadcn`, `cypress-author` y `cypress-docs`.

```text
Implementa únicamente IMP-05 conforme a docs/plan/05-progreso-y-senales.md.
Parte de los intentos, versiones y progreso mínimo de IMP-03. Completa reglas,
cálculos, persistencia y pantallas con evidencia real. Respeta el estado de
DEC-005 y usa fixtures independientes; ninguna cifra ni señal depende de IA.
Si IMP-04 sigue pendiente, avanza lo independiente y registra la comprobación
de eventos de ayuda todavía necesaria. Entrega pruebas y pendientes sin iniciar
otras fases ni atribuir aceptación pedagógica a una revisión automática.
```
