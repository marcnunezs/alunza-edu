# IMP-05 — Progreso, señales y tablero deterministas

**Estado inicial: pendiente de implementación.** Esta fase depende de los intentos y la proyección mínima de [IMP-03](03-practica-y-ejecucion.md). Puede avanzar sin esperar a Azure OpenAI ni a la finalización de IMP-04. Fuentes: [progreso y señales](../../specs/14-progreso-y-senales.md), [guía del agente](../agent/08-progreso-y-senales.md), [API](../../specs/07-api-y-contratos.md) y [escenarios](../../specs/03-flujos-y-criterios-de-aceptacion.md).

**Corte autorizado 02/10/2026, cierre técnico local 04/10/2026:** IMP-05.01–05.02
están implementados, integrados y probados sobre la base existente. La CI local
aprobó sus 17/17 pasos y las tres series SUBMIT consecutivas, con p95
secuencial/concurrencia cuatro de 1.827,90/3.792,36 ms, 1.824,69/3.250,55 ms y
1.945,19/3.297,92 ms, conservando 50 muestras por perfil, cero fallos y el gate
de 5.000 ms. Evidencia: [registro del corte](../work/IMP-05-progress.md),
[cierre y diagnóstico SUBMIT](../work/2026-10-04-submit-closure.md) y
[contrato incremental](../work/IMP-05-progress-dictionary.md). El estado inicial
anterior describe la planificación original.

Se conservan el FAIL histórico de 5.620,75 ms y el de la serie B diagnóstica de
5.271,86 ms. La aprobación posterior no demuestra una causa concreta de esas
demoras. Este cierre no acredita el candidato en Linux, Azure OpenAI ni Vercel
Sandbox remotos, producción o aceptación académica. Ese cierre conservó
IMP-05.03–05.08 pendientes; no cerró reglas, señales ni tablero docente.

**Corte autorizado 05/10/2026:** Marcelo aprobó DEC-005 D1–D5 y luego autorizó
comenzar IMP-05.03. .03 está **IMPLEMENTADO Y PROBADO EN FOCOS LOCALES** al
06/10/2026; CI17 queda pendiente al congelar el candidato FINAL. Evidencia
actual: 50 HTTP, 607 aserciones/12 archivos SQL, asesores y seis checks de
preservación; 55 unidades/tipos/lint previos se conservan por identidad de bytes,
sin atribuir otra ejecución a R5. La CI remota en GitHub sigue pendiente;
su [registro](../work/IMP-05-rules.md) y
[diccionario](../work/IMP-05-signal-rules-dictionary.md) concretan versiones y activación.
La [fuente aprobada](../work/DEC-005-2026-10-05.md) conserva la autoridad y el
artefacto original. .04–.08, revisión docente IMP-06 y aceptación académica
siguen pendientes. Aprobar D1–D5 fija semántica sin implementar evaluadores o episodios.

**Corte puro .04 autorizado y verificado, 13/10/2026:** los tres evaluadores, metadatos de regla y pruebas conjuntas E17/E22/parcial fiable quedan completados localmente con Node 24.21.0. [Registro y trazabilidad E/SIG](../work/IMP-05-evaluators-pure.md) conserva candidato, comandos, PASS/FAIL y límites. No añade dispatcher, DB, persistencia o worker. .03/CI17/reloj permanecen abiertos; .05-.08, RF-018 integrado y aceptación académica siguen pendientes.

**Corte IMP-05.05 autorizado, verificación previa al cierre del 25/10/2026:** implementación local de captura consistente,
episodios persistentes, worker y reconstrucción implementados y verificados
funcionalmente en TEST (17 casos de señales, 181 HTTP y 928 aserciones SQL).
En esa verificación, el cierre local seguía pendiente: la CI se detuvo en el gate SUBMIT;
IA/E2E/evaluación aprobaron por separado, sin convertir la CI en verde. El
[registro .05](../work/IMP-05-episodes.md) distingue las pruebas ejecutadas de las
pendientes; el [diccionario incremental](../work/IMP-05-episodes-dictionary.md)
describe persistencia y recuperación. Se mantienen fuera de este corte las UI,
rutas públicas de señales, revisión docente y servicios remotos.

**Cierre técnico local, 25/10/2026:** la CI final aprobó **17/17 pasos**
(`2026-10-26T00:35:22.681Z`, fecha local 25/10), cerrando .05 y la verificación
conjunta .03/.04/.05. Incluye 2.110 unidades, 181 HTTP, 928 aserciones SQL en
13 archivos y 49/49 E2E. Las tres series SUBMIT conservaron 100 respuestas
válidas cada una y p95 secuencial/concurrencia cuatro de 2.072,35/3.415,01 ms,
1.644,12/3.198,67 ms y 1.646,66/3.246,24 ms, con el gate p95 <5.000 ms intacto.
La evaluación de ayuda TEST completó 234 muestras, 763 recibos y tres
reanudaciones, sin llamadas externas. El [registro .05](../work/IMP-05-episodes.md)
y la [corrección SUBMIT y barrera temporal E2E](../work/2026-10-25-submit-admission.md)
conservan el candidato y los fallos anteriores. .06–.08, tablero, revisión
docente, RF-018 integral, RF-019, aceptación académica y validación remota
siguen pendientes; este cierre no acepta toda IMP-05.

**Cierre técnico local IMP-05.06, registrado el 26/10/2026:** administración
de reglas, lectura efectiva consistente y recuperación idempotente están
implementadas y verificadas. La CI terminó `2026-10-26T02:16:14.949Z`
(25/10 en Santiago) con **17/17 etapas**, 2.152 unidades, 184 HTTP, 957
aserciones SQL/14 archivos y 58/58 E2E, incluidos los nueve recorridos de reglas.
La activación desde UI se comprobó contra el motor y conservó la revisión
histórica. Las tres series SUBMIT aprobaron y se revisaron capturas completas
en tres tamaños. El [registro .06](../work/IMP-05-rules-ui.md) conserva
candidato, mediciones, fallos corregidos y límites. .07–.08, tablero,
revisión docente, aceptación académica y validaciones remotas siguen pendientes.

**Cierre técnico local IMP-05.07, 26/10/2026:** el tablero docente y la ampliación
del progreso personal están implementados y verificados con CI final
**17/17 PASS**, terminada `2026-10-26T19:42:31.499Z`.
RF-015 incorpora observación por período sin perder logros anteriores; RF-016
integra filtros, matrícula vigente, corte compartido y evidencia mínima;
RF-018 incorpora consulta e historia de los tres tipos de señal, conservando
`ACTIVE`/`REVIEWED` y la evidencia original. La presentación de fechas usa la
zona de la organización, también en las causas narrativas, sin alterar sus
instantes UTC. El [registro .07](../work/IMP-05-dashboard.md) identifica el
candidato, las pruebas y los límites. IMP-05.08, el detalle integral RF-017,
la revisión docente RF-019, la aceptación CAPSTONE y la validación remota
permanecen pendientes; este cierre no acepta toda IMP-05.

**Cierre técnico local IMP-05.08, 26/10/2026:** la verificación transversal de
RF/HU/CU/PT-015, 016, 018 y 026 está completada con CI final **17/17 PASS**,
según el [registro .08](../work/IMP-05-acceptance.md). La
[matriz de aceptación](../work/IMP-05-acceptance-matrix.md) enlaza los 16
escenarios E1–E4, SIG-01–14 y las fronteras DEC-005 aplicables al MVP con sus
pruebas y límites. Se verificaron reconstrucción, reconciliación de commits
tardíos, historia/revisión preservada, ayuda real TEST, permisos vigentes y el
recorrido administración de reglas → motor → consultas.

El fixture adicional de 60 estudiantes activos conserva un oráculo independiente
y permanece separado de la demo. Progreso personal, tablero y consulta de reglas
cumplen p95 <3 s en API y pantalla con 50 muestras calientes secuenciales y 50
bajo carga cuatro, primeras muestras separadas y cero errores. En pantalla,
carga cuatro significa un Chrome más tres lectores HTTP. La actualización
aditiva .07→.08 conserva 26 colecciones canónicas, DTO públicos al mismo corte
excluyendo únicamente `observedAt`, y el grafo de roles/ACL comprobado.

El cierre es técnico y local: RF-017 integral, la acción pública RF-019,
CAPSTONE, CI Linux y validaciones remotas siguen pendientes. La latencia de
ayuda renderizada en navegador conserva su pendiente de IMP-04. La inactividad
de siete días usa fixtures temporales explícitos; E23 con igual ancla tras
revisión está probado en cálculo puro, sin atribuirle una corrida durable;
E20/backfill permanece fuera del MVP. SQL015 no reproducida en 20 iteraciones
y el tercer SUBMIT de CI R1 con p95 de 5123.54 ms conservan causa no demostrada,
sin presentarlos como corregidos. Los cortes .01–.07 mantienen sus resultados
y pendientes históricos; el registro .08 establece el estado local posterior.

## Resultado que podremos demostrar

El estudiante entiende cuántos ejercicios requeridos ha completado y qué evidencia lo acredita. El profesor consulta el tablero de su clase con datos reales y ve las tres señales, su causa y hechos. El administrador configura y activa versiones de reglas dentro de su organización. Caer o alterar el proveedor IA no cambia ningún cálculo.

Cobertura principal: **ALZ-RF-015, ALZ-RF-016, ALZ-RF-018 y ALZ-RF-026**. La revisión de señales y el detalle completo del estudiante se cierran en IMP-06. Esta fase reutiliza el progreso de RF-007, evitando implementar una segunda fórmula.

## Entradas y decisiones

- Intentos confirmados, diagnósticos, resultados visibles, versiones y eventos de servidor de IMP-03; pertenencias y publicación de IMP-01/02.
- DEC-005: eventos/progreso resueltos en .01–.02 y D1–D5 aprobadas el 05/10/2026 para ventanas, consecutividad, diagnóstico grueso, comparabilidad, estancamiento y episodios. Aplicar el spec normativo; autoridad de producto no acredita validación pedagógica.
- DEC-004/006: orden estable, claves, transacciones, proyecciones y trabajo durable. DEC-008: perfil de medición de consultas y tablero.
- Fixtures independientes con reloj controlado y dos organizaciones; conservar SIG-01 a SIG-14, vinculados a sus PT. La parte de revisión de SIG-14 se integra completamente en IMP-06.
- Calidad: RNF-IA-01/05, RNF-CON-02, RNF-SEG-01/05, RNF-REN-01, RNF-USA-02/03/04 y RNF-MAN-02/04.

## Incrementos, en orden

| ID | Trabajo y resultado observable | Artefactos previstos | Comprobación al terminar |
| --- | --- | --- | --- |
| IMP-05.01 | Concretar eventos elegibles, orden de intentos y contratos de cálculo con ejemplos de negocio | DEC-005, schemas y fixtures/oráculos independientes | Polling no cuenta como actividad; timestamps cliente y duplicados no alteran ventanas; empates tienen desempate estable |
| IMP-05.02 | Ampliar el cálculo único de progreso a actividad/concepto y corte temporal | Funciones/consultas de dominio, proyecciones públicas y UI del estudiante | Sin requeridos, sin intentos, reutilización de ejercicio, múltiples conceptos, fallo oculto y éxito previo seguido de fallo |
| IMP-05.03 | Crear versiones inmutables de reglas, validador y servicio de activación — verificación local conjunta .03/.04/.05 cerrada el 25/10/2026 | Migraciones, API, contratos/diccionario y transacciones de reglas | Rechazos estrictos y permisos; activación inmediata CAS/auditoría/replay sin dos vigencias incompatibles; evidencia en registros .03 y .05 |
| IMP-05.04 | Tres evaluadores puros con T explícito — alcance puro completado localmente el 13/10/2026 | INACTIVITY, REPEATED_ERROR y STAGNATION; [registro conjunto](../work/IMP-05-evaluators-pure.md) | SIG-01–12 y fronteras; E17/E22 y mismo parcial fiable; sin LLM, UNKNOWN pedagógico ni composición productiva nueva. Integración operacional reservada a .05 |
| IMP-05.05 | Persistir señales y episodios con deduplicación y recálculo durable — cierre técnico local el 25/10/2026 | Repositorios, claves de episodio, worker y reconstrucción | SIG-13, dos workers concurrentes, reintento tras caída; recálculo idéntico no duplica ni reactiva una señal revisada; CI conjunta 17/17 |
| IMP-05.06 | Administración de reglas y parámetros efectivos — cierre técnico local registrado el 26/10/2026; [registro](../work/IMP-05-rules-ui.md) y [plan ejecutado](../work/IMP-05-rules-ui-plan.md) | Consulta consistente, historial/detalle, creación/activación CAS y recuperación durable por organización | E1–E4 de HU-026 y puente UI/motor comprobados, historia intacta; CI 17/17, 58/58 E2E y revisión visual en tres tamaños |
| IMP-05.07 | Tablero docente y ampliación del progreso personal con filtros, corte e historia de señales — cierre técnico local | Consultas/API y tablas accesibles con evidencia mínima de solo lectura; [registro .07](../work/IMP-05-dashboard.md) | CI final 17/17; cifras contrastadas con oráculo, permisos, paginación, período y ayuda real en TEST; historia ACTIVE/REVIEWED y error de servicio separados de ausencia de datos; aceptación transversal .08 pendiente |
| IMP-05.08 | Verificación transversal de RF-015/016/018/026 — cierre técnico local | [Registro .08](../work/IMP-05-acceptance.md), [matriz](../work/IMP-05-acceptance-matrix.md), pruebas HTTP/SQL/Cypress, perfiles y actualización aditiva | CI final 17/17; 16 escenarios E1–E4 y SIG-01–14 trazados por nivel; reconstrucción, reconciliación, ayuda real TEST, aislamiento, capacidad de 60 activos y p95 <3 s en las tres superficies; límites y pendientes explícitos |

## Fórmulas y estados que debe conservar la implementación

El denominador son las asignaciones requeridas de versiones concretas. El numerador son aquellas con algún intento confirmado que supera todas las verificaciones requeridas. RUN no completa ejercicios; repetir envíos no aumenta artificialmente el denominador ni el logro. Mostrar fracción, estado y porcentaje cuando sea calculable, sin llamarlo nota.

Conservar exactamente los tipos `INACTIVITY`, `REPEATED_ERROR`, `STAGNATION` y los estados `ACTIVE`, `REVIEWED`. «No verificable» describe falta de evidencia de evaluación, no un tercer estado persistido de señal. Las ventanas y comparaciones detalladas se implementan bajo el estado de DEC-005:

- Inactividad: siete días sin eventos elegibles, con base que contempla inscripción/publicación/disponibilidad. No generar nuevas señales de una actividad futura o cerrada.
- Error repetido: escoger primero los tres últimos confirmados, después comprobar comparabilidad y diagnóstico grueso igual dentro de [T−14 días,T], extremos inclusivos. `SUCCESS` y `UNKNOWN` interrumpen de modo verificable.
- Estancamiento: escoger primero los tres últimos confirmados, comparar conteos visibles completos no crecientes por pares y excluir último allRequiredPassed=true; sin plazo temporal adicional, ceros fabricados ni mezcla de suites.

Para detalle exacto, utilizar el spec 14 y sus fixtures; no mantener una variante de las fórmulas en este plan. Si se modifica una decisión, actualizar conjuntamente fixture, contrato y código antes de aceptar el resultado.

## Persistencia y presentación

Cada señal guarda parámetros, versión de regla, corte temporal, evidencia y causa legible. El motor calcula; un caso de uso autorizado persiste. D4 agrupa testigos/evaluaciones inmutables en un episodio continuo; recálculo idéntico no duplica ni reactiva REVIEWED. No cumple/no verificable/no evaluable corta acumulación sin cambiar estado. Testigo nuevo fuera de base revisada o nueva regla puede abrir otro episodio vinculado; recorrer prefijos y fronteras, conservar snapshot/revisión, reconciliar commits tardíos y usar checkpoint durable. El timestamp del worker no es identidad válida. Estos mecanismos pertenecen a .05 y no se implementan por autorizar .03.

Las consultas del tablero filtran por organización, clase, pertenencias y permisos antes de contar/agrupar. No multiplicar intentos por relaciones de conceptos o citas. Proyecciones y cachés se reconstruyen desde hechos persistidos y se prueban con contexto real RLS, incluyendo alternancia de usuarios.

En .07, el agregado usa la matrícula activa vigente y conserva el progreso
acumulado hasta `asOf`; `from` limita la observación de actividad, intentos y
pistas. La última actividad se observa al corte, aunque sea anterior a `from`.
El listado de señales conserva por defecto todos los episodios `ACTIVE`,
incluidos los históricos, y permite consultar `REVIEWED` sin cambiar su estado.
La evidencia docente es mínima y de solo lectura; no habilita el detalle
integral ni la acción de revisión de IMP-06.

La información de ayudas concedidas se obtiene de eventos persistidos.
IMP-05.08 verificó el circuito real de API/persistencia de ayuda TEST, incluida
generación indisponible y contradictoria, manteniendo iguales hechos, regla y
corte al contrastar progreso/señales. El proveedor TEST no acredita Azure
remoto. Las mediciones de pantalla .08 cubren progreso, tablero y reglas;
no cierran la latencia documental de ayuda en navegador pendiente de IMP-04.

Conservar la semántica de `INACTIVITY`: una entrega real `HINT_DELIVERED` o lectura explícita `FEEDBACK_VIEWED` elegible puede reiniciar `lastAt` conforme a DEC-005. La lectura autenticada de un fallback también es elegible; una solicitud o pista fallida sin entrega/lectura no lo reinicia. Polling y lecturas duplicadas no crean actividad adicional. La independencia del LLM se prueba manteniendo iguales hechos persistidos, regla y corte. Un evento nuevo legítimo puede cambiar la inactividad sin romper el determinismo.

La evidencia básica exigida por RF-018 debe estar disponible en esta fase; no diferir toda explicación hasta construir RF-017. El detalle completo del alumno y la acción de revisar pertenecen a IMP-06. El administrador de reglas no adquiere por ello permiso para leer evidencia pedagógica individual.

## Criterios de cierre

- [x] E1–E4 de HU-015/016/018/026 están trazados y verificados localmente, con sus RF/CU/PT y límites en la [matriz .08](../work/IMP-05-acceptance-matrix.md).
- [x] El progreso reutiliza una fórmula única con numerador/denominador y estados honestos, verificada en IMP-05.01–05.02.
- [x] El corte IMP-05.01–05.02 tiene cierre técnico local con CI 17/17 aprobada el 04/10/2026 y conserva sus antecedentes fallidos.
- [x] IMP-05.05 y la verificación local conjunta .03/.04/.05 cerraron con CI 17/17 el 25/10/2026; se conservan los fallos previos y los pendientes de la fase completa.
- [x] IMP-05.06 tiene cierre técnico local con CI 17/17 y E1–E4 de HU-026 comprobados; la activación desde UI conserva historia y revisión del motor.
- [x] IMP-05.07 tiene cierre técnico local con CI final 17/17 según el [registro .07](../work/IMP-05-dashboard.md); no implica el cierre transversal .08 ni aceptación CAPSTONE.
- [x] IMP-05.08 tiene cierre técnico local con CI final 17/17 según el [registro .08](../work/IMP-05-acceptance.md), que conserva candidato, resultados y antecedentes fallidos.
- [x] SIG-01–14 y fronteras DEC-005 aplicables al MVP tienen pruebas identificadas por nivel; E23 conserva su límite puro y E20/backfill queda fuera de alcance. SIG-14 verifica soporte de revisión idempotente/concurrente, sin implementar la acción pública RF-019.
- [x] Reglas y señales conservan versión, parámetros y evidencia; activación y recálculo concurrentes preservan historia y revisión.
- [x] El tablero tiene permisos vigentes y cifras contrastadas con un oráculo independiente, incluida capacidad de 60 estudiantes activos y paginación.
- [x] Con los mismos hechos persistidos, regla y corte, indisponibilidad y salida contradictoria del proveedor TEST no alteran cifras, señales ni diagnóstico; no hay decisión pedagógica automática.
- [x] Reconstruir proyecciones derivadas conserva lecturas públicas, hechos, historia y checkpoints; reconciliar commits tardíos conserva las evaluaciones anteriores.
- [x] Captura real de ayuda TEST, entrega/lectura elegible, ayuda fallida y duplicados tienen pruebas diferenciadas; la inactividad temporal sintética está identificada como tal.
- [x] API y pantalla de progreso personal, tablero y reglas cumplen el perfil local de 50 calientes secuenciales y 50 bajo carga cuatro, con primeras muestras separadas, cero errores y p95 <3 s.
- [x] La actualización aditiva .07→.08 conserva 26 colecciones canónicas, DTO al mismo corte excluyendo únicamente `observedAt`, y grafo de roles/ACL, sin cambiar fórmulas ni permisos de producto.

Estos criterios acreditan el alcance técnico local de IMP-05. Se mantienen los
pendientes y límites del corte .08; no equivalen a aceptación CAPSTONE ni a
validación remota o del renderizado de ayuda.

## Siguiente fase y encargo

Las bases locales de progreso, señales, tablero y ayuda TEST quedan verificadas
en .08. El siguiente alcance previsto es [IMP-06](06-gobierno-y-seguimiento.md),
incluidos RF-017 integral y RF-019 público; requiere su propio encargo,
implementación y aceptación. Este cierre no inicia automáticamente otra fase.

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
