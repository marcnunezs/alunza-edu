# IMP-07 · Calidad integral y preparación del candidato

Estado: **plan propuesto, sin ejecución acreditada**. Esta fase completa y reúne las comprobaciones que comienzan en IMP-00/01 y acompañan cada función. No concentra al final la seguridad, las pruebas, la accesibilidad ni la integración con servicios. Se conserva el alcance de 27 RF, 108 escenarios, 29 RNF y 6 ORG.

Consulta el [índice del plan](README.md), [AGENTS.md](../../AGENTS.md), los [criterios funcionales](../../specs/03-flujos-y-criterios-de-aceptacion.md), [calidad](../../specs/10-calidad-y-pruebas.md), [seguridad](../../specs/09-seguridad-y-privacidad.md), [operación](../../specs/11-operacion-y-despliegue.md) y la [guía de pruebas](../agent/10-pruebas-y-evidencias.md). Las matrices siguientes asignan trabajo; no sustituyen el texto de aceptación de esas fuentes.

## Resultado y demostración

Obtener una versión integrada cuya cobertura y límites sean comprobables. Al terminar, el equipo puede ejecutar los recorridos de los tres roles, reproducir fallas y explicar con evidencia qué requisito pasa, falla o está bloqueado. Ningún defecto conocido de severidad alta de la ruta crítica permite recomendar la aceptación del candidato.

La demostración une publicación, ejecución real, envío durable, diagnóstico, ayuda autorizada o degradación, reintento, progreso, señales y revisión. Incluye un acceso cruzado denegado, una carrera controlada y recuperación de una falla. El agente prepara y verifica; la aceptación del producto, revisión cruzada humana y evaluación CAPSTONE se registran solo cuando ocurran.

## Entradas, dependencias y decisiones

| Entrada | Condición para trabajar | Si falta |
| --- | --- | --- |
| Incrementos IMP-00 a IMP-06 | Contratos, migraciones y comportamiento integrado identificados por versión; defectos y pruebas anteriores accesibles | Auditar la parte disponible y devolver la brecha al incremento responsable. No usar mocks para cerrar una vertical incompleta |
| Pruebas desde IMP-00/01 | Checks de formato, lint, tipos, Jest, build, migraciones y aislamiento; Cypress desde el primer flujo observable | Completar el control faltante en su área antes de usar esta fase como verificación final |
| Preproducción temprana | Smoke híbrido preparado desde IMP-00 y ejecutado cuando exista configuración y autorización vigentes; ensayos reales de Sandbox y Azure OpenAI retomados en IMP-03/04 | Preparar datos, scripts y contratos localmente; registrar la comprobación remota concreta como pendiente, sin posponer toda integración deliberadamente a IMP-08 |
| DEC-001/002/004/005/006 | Permisos, publicación/historial, contratos, concurrencia, señales y datos con un oráculo definido | Asociar casos afectados a la decisión pendiente. Avanzar casos independientes; no aprobar semánticas supuestas |
| DEC-003/007/008/010 | Límites y unidades del ejecutor, compatibilidad real, perfil de carga y configuración/evaluación IA | Resolver con ensayos autorizados y resultados. Un patch elegido o documento escrito no demuestra compatibilidad, aislamiento ni p95 |
| DEC-009/011/012 | Alcance de recuperación/datos ficticios, freeze/capacidad y dataset canónico identificados | Mantener separadas demo ficticia, preparación de piloto y aceptación académica. No inventar política legal, fechas, horas ni acuerdos |

Todos los DEC se interpretan conforme al [registro de fuentes](../../specs/00-fuentes-y-decisiones.md) y su [guía de tratamiento](../agent/12-decisiones-pendientes.md). Verificar la autorización vigente antes de producir efectos externos; una autorización ya concedida no se solicita nuevamente. Esta planificación no autoriza por sí sola pruebas pagadas, publicaciones ni uso de datos reales.

## Incrementos ordenados

Los artefactos de esta tabla son **destinos propuestos** hasta comprobar el árbol real. Reutilizar suites, fixtures y reportes existentes. Cada incremento conserva su propia evidencia y puede corregir defectos dentro del alcance encargado.

| ID | Resultado observable y trabajo acotado | Artefactos propuestos | Pruebas y condición de salida |
| --- | --- | --- | --- |
| IMP-07.01 | Auditar cobertura y concretar los casos que faltan: RF/HU/CU/PT, escenarios E1–E4, RNF/ORG y SEC | Matriz requisito–prueba–resultado–versión; inventario de defectos; fixtures independientes en los directorios vigentes | Los 27 RF y 108 escenarios tienen caso asociado y estado honesto. Identificar duplicados, vacíos, supuestos y evidencia obsoleta; no convertir conteos documentales en pruebas aprobadas |
| IMP-07.02 | Completar aislamiento y controles adversariales en todas las superficies | Pruebas de API/DB/Storage/vectores/CSV, revisión de secretos y ensayos del ejecutor; informe ligado a SEC-01 a SEC-14 | Identidades y roles reales, revocación con JWT anterior, rechazo de acceso cruzado y ausencia de filtración; límites y limpieza medidos por adaptador. La restauración SEC-12 se completa en IMP-07.07 |
| IMP-07.03 | Consolidar persistencia, concurrencia y verticales funcionales sin depender de IA para corregir el ejercicio | Suites Jest de dominio/contrato e integración; Cypress E2E-01 a E2E-06; pruebas de fallas controladas | Envío cancelado no actúa; práctica no equivale a envío; fallas transaccionales no invocan ayuda; idempotencia, cierre/admisión, versiones e historial coherentes. Revisión cancelada no modifica señal |
| IMP-07.04 | Revisar accesibilidad y comprensión de los flujos de los tres roles | Matriz de navegadores/dispositivos; checklist WCAG aplicable; observaciones y correcciones UX | Teclado, foco, lector, etiquetas, contraste, ampliación, editor, gráficos y mensajes comprobados; revisión manual junto con automatización. Registrar por separado evaluación interna y sesiones reales con usuarios |
| IMP-07.05 | Evaluar ayuda contextual y la separación entre IA y evidencia técnica | Corpus de evaluación ficticio; casos esperados; configuración/modelo/prompt/corpus versionados; rúbrica pendiente de definición humana | Cinco campos exactos, tres estados RAG, citas autorizadas y vigentes, pistas progresivas; rechazar salida extra/parcial, cita inventada e instrucciones maliciosas. Conservar diagnósticos, progreso y señales deterministas |
| IMP-07.06 | Medir rendimiento y consumo bajo un perfil reproducible, y corregir cuellos de botella comprobados | Protocolo DEC-008, muestras crudas, descomposición por etapas, costos medidos y reporte de resultados | p95 pantalla/API <3 s, ejecución completa <5 s e IA <12 s; proceso máximo 3 s por intento. Incluir errores/timeouts y separar frío/caliente; entorno, cuota y gasto autorizados antes de carga |
| IMP-07.07 | Ensayar recuperación y repetibilidad de CI/ambientes con la versión integrada | Guía de recuperación ejercitada, evidencia de arranque limpio/restauración, reportes CI asociados al commit | Reinicio de trabajador no duplica efectos; recuperar BD/Storage/citas y permisos; reconciliar intento con respuesta perdida; limpiar sandbox huérfano. Un build o dump SQL aislado no acredita recuperación |
| IMP-07.08 | Corregir regresiones restantes, cerrar el informe de calidad y preparar revisión del candidato | Informe de aceptación técnica propuesta, matriz final, limitaciones, defectos y evidencias para IMP-08 | Checks pertinentes aprobados sobre artefactos identificados; ausencia de defectos altos conocidos. Casos bloqueados/no ejecutados visibles; revisión y aceptación humanas pendientes o registradas con su autor real |

IMP-07.01 ordena el trabajo; .02 y .03 preceden la recomendación de candidato. .04 y .05 pueden avanzar en paralelo sobre contratos estables. .06 requiere integración funcional y perfil definido; .07 puede prepararse antes y ejecutarse sobre un conjunto coherente. .08 reúne resultados y corrige solo lo pendiente. Repetir suites tras cambios relevantes, fallas o dudas concretas; no ejecutar ciclos indiscriminados para producir más reportes.

## Matriz de los 29 RNF

Fuente de cada ID y criterio: [matriz de calidad de la ERS](../../specs/10-calidad-y-pruebas.md). «Inicio» es la fase que incorpora el control; el cierre integral en IMP-07 no elimina su prueba por incremento. Los estados iniciales de ejecución son **N/D** hasta enlazar resultados reales.

| ID fuente | Inicio | Cierre principal | Evidencia y criterio que debe quedar verificable |
| --- | --- | --- | --- |
| RNF-REN-01 | IMP-00 instrumentación; cada pantalla | IMP-07.06 | Muestras desde acción hasta contenido utilizable, API por separado, versión/red/carga declaradas; p95 pantalla/API <3 s |
| RNF-REN-02 | IMP-00 ensayo; IMP-03 integración | IMP-07.02/.06 | Proceso ≤3 s totales y p95 completo <5 s con preparación, ejecución, persistencia, respuesta y cierre; no medir solo el proceso |
| RNF-REN-03 | IMP-00 ensayo; IMP-04 integración | IMP-07.05/.06 | Ayuda visible con Azure OpenAI y corpus/configuración declarados; p95 <12 s |
| RNF-REN-04 | IMP-00 estados; cada integración | IMP-07.03/.06 | Cargas terminan en éxito, error seguro o tiempo excedido ante demora de API, ejecución, RAG o LLM |
| RNF-SEG-01 | IMP-01 | IMP-07.02 | JWT, estado, rol, organización, clase y propiedad verificados en servidor; RLS/Storage con roles efectivos; ningún acceso cruzado |
| RNF-SEG-02 | IMP-00 contratos; IMP-02/04 contenido | IMP-07.02/.05 | Entradas, archivos y salida IA incompatibles rechazados antes de su uso/persistencia; validación runtime y renderizado seguro |
| RNF-SEG-03 | IMP-00 | IMP-07.02/.07 | Revisión de repo, historial pertinente, bundles, previews y entornos sin secretos expuestos; credenciales separadas y de alcance mínimo |
| RNF-SEG-04 | IMP-00 ensayo; IMP-03 integración | IMP-07.02 | Entorno 1 vCPU/2 GB y proceso 128 MB/3 s/64 KB comprobados por separado; red/archivos/secretos inaccesibles y limpieza real |
| RNF-SEG-05 | IMP-00 errores/logs; cada función | IMP-07.02/.03 | Respuestas, auditoría y logs sin secretos, pruebas ocultas ni datos ajenos; referencias/cachés/CSV con ámbito correcto |
| RNF-USA-01 | IMP-01 primeras pantallas | IMP-07.04 | Flujos esenciales responsivos en matriz registrada; editor optimizado para escritorio con límites de uso documentados |
| RNF-USA-02 | IMP-00 componentes; cada pantalla | IMP-07.04 | Checklist WCAG 2.2 AA aplicable y revisión manual de funciones principales, incluida navegación por teclado y foco |
| RNF-USA-03 | IMP-02/03 estados y resultados | IMP-07.04 | Estados de pruebas, gráficos, progreso y señales comprensibles mediante texto/equivalente accesible además del color |
| RNF-USA-04 | IMP-01; cada operación | IMP-07.03/.04 | Fallas de acceso, publicación, archivos, ejecución, envío e IA explican resultado y siguiente acción válida |
| RNF-CON-01 | IMP-03 | IMP-07.03 | Falla al persistir impide confirmar envío e invocar ayuda sobre ese intento; el código permanece editable |
| RNF-CON-02 | IMP-04 | IMP-07.03/.05 | Respuesta IA malformada/contradictoria no corrompe datos, progreso ni señales; se descarta con estado seguro |
| RNF-CON-03 | IMP-04 | IMP-07.03/.05 | Sin evidencia, demora o caída del proveedor conservan el flujo técnico y admiten reintentar ayuda sin crear intento |
| RNF-CON-04 | IMP-01 integración; IMP-03 vertical | IMP-07.03/.08 | Publicar–ejecutar–enviar–registrar–seguir automatizado en CI y demostrado sobre candidato integrado |
| RNF-POR-01 | IMP-00 | IMP-07.07; IMP-08 | Arranque limpio y despliegue híbrido mediante documentación/versiones reales; evidencia separada local/remota |
| RNF-POR-02 | IMP-01 seed; ampliado en cada fase | IMP-07.07; IMP-08.02 | Recreación exacta de demo ficticia sin correcciones manuales ocultas ni duplicados |
| RNF-POR-03 | IMP-00 | IMP-07.06/.07 | Salud y correlación por operación/intento, región, duración, consumo, truncamiento y estado de proveedores; fallas observables |
| RNF-MAN-01 | IMP-00 | IMP-07.01/.08 | Revisión de dependencias: dominio, infraestructura, ejecución e IA separados, sin ciclo crítico ni API de negocio duplicada |
| RNF-MAN-02 | IMP-00 | IMP-07.03/.05 | Contratos web/API/ejecutor/IA validados; tipos y esquemas coinciden y rechazan valores incompatibles |
| RNF-MAN-03 | IMP-00 | IMP-07.07/.08 | Formato/lint/tipos/build/pruebas según scripts reales y revisión por otro integrante con evidencia; revisión del agente se identifica como tal |
| RNF-MAN-04 | IMP-00 | IMP-07.01/.08 | Registro de decisiones actualizado sobre arquitectura, ejecución, RAG, proveedor y despliegue con motivos, consecuencias y estado real |
| RNF-IA-01 | IMP-03 resultado; IMP-04 ayuda | IMP-07.03/.05 | Texto que contradice las pruebas no cambia diagnóstico, pruebas superadas ni completitud |
| RNF-IA-02 | IMP-00 contrato; IMP-04 integración | IMP-07.05 | Contrato estricto de cinco campos, seis diagnósticos y tres estados; no admite puntaje ni campos extras |
| RNF-IA-03 | IMP-04 | IMP-07.02/.05 | PDF textual/TXT/Markdown hasta 10 MB; chunks 500 tokens, overlap 50, top-k 5 y filtros previos por ámbito; fuente visible y válida |
| RNF-IA-04 | IMP-04 | IMP-07.05 | Corpus ausente, insuficiente o exclusivamente ajeno produce NO_EVIDENCE, sin cita inventada |
| RNF-IA-05 | IMP-03 avance; IMP-05/06 seguimiento | IMP-07.03/.05/.08 | Progreso/señales trazables a reglas y hechos; revisión humana, sin sanción ni calificación automática |

Los 128 MB/64 KB y 10 MB requieren su interpretación exacta en bytes conforme a DEC-003/010 antes de fijar fronteras. Se prueban casos por debajo, en y por encima; no se sustituye el límite total por un flag del heap. Los 3 segundos corresponden al trabajo estudiantil total del intento, no a una nueva cuota por prueba. La prueba local y la del proveedor conservan resultados independientes.

## Matriz de los 6 ORG y coordinación humana

Fuente: [requisitos organizacionales](../../specs/10-calidad-y-pruebas.md) y [plan de entrega original](../../specs/12-plan-de-entrega.md). Las responsabilidades primarias documentadas orientan la coordinación: Marcelo, backend/integración y PO; Benjamin, frontend/UX/documentación; Abraham, datos/IA/calidad. No constituyen nuevas asignaciones aceptadas ni horas comprometidas.

| ID fuente | Trabajo desde el inicio | Verificación en esta fase y entrega |
| --- | --- | --- |
| ORG-001 | IMP-00: repositorio compartido, secretos externos y datos ficticios | IMP-07.02/.08 y IMP-08: acceso real del equipo, revisión de historial/configuración y evidencia saneada |
| ORG-002 | Todas las fases: tareas y revisión cruzada con autoría real | IMP-07.08: relacionar contribuciones de los tres integrantes en código, pruebas, documentación y revisión. El agente no firma ni atribuye su trabajo a personas; contar commits no basta |
| ORG-003 | Cada cambio: mantener ERS/HU/CU/arquitectura/pruebas alineados | IMP-07.01/.08 y cada hito: coherencia y enlaces a evidencia por versión; cambios de alcance registrados, nunca ocultos en tests |
| ORG-004 | Planificación: revisar capacidad y cambios, resolver DEC-011 | IMP-07.08/IMP-08: conservar el freeze de semana 15 como línea base y resolver la tensión con S7 mediante decisión humana trazable; no reprogramar fechas en este plan |
| ORG-005 | IMP-01 a IMP-06: ampliar un seed ficticio canónico | IMP-07.07/IMP-08.02: reproducir 2 organizaciones, 2 admins, 2 profesores, 8 estudiantes, 3 clases, 10 ejercicios y 2 documentos por clase; demostrar aislamiento |
| ORG-006 | IMP-03 a IMP-06: separar evidencia, ayuda y decisión pedagógica | IMP-07.03/.05/.08: revisar contratos, textos y guion sin notas, sanciones ni intervención automática; revisión de señal efectuada por persona autorizada |

El agente puede preparar el paquete y corregir inconsistencias técnicas. Debe conservar pendientes las revisiones humanas y las aceptaciones del PO, docente guía o comisión que falten. Se coordina con esos roles sin enviar mensajes externos ni inventar participación o aprobación. El cumplimiento académico se evalúa con la evidencia del [plan CAPSTONE](../../specs/12-plan-de-entrega.md), no por la fecha del calendario o por terminar estos archivos.

## Protocolo común de evidencia

Cada resultado enlaza ID de prueba y requisito, versión/commit, ambiente, adaptador, seed/corpus/reloj, entrada, esperado independiente, observado, comando real, autor/revisor real, adjuntos y defecto/DEC. Estados: No ejecutado, Aprobado, Fallido, Bloqueado o No aplicable justificado. Un caso que no arrancó no cuenta como ejecutado; un caso bloqueado no cuenta como aprobado.

Para E2E-01 a E2E-06 conservar lecturas posteriores y aserciones en servicios reales donde la garantía lo exija. Cubrir la vertical técnica, ayuda con fuente, degradación, aislamiento, reglas/revisión y concurrencia según [calidad](../../specs/10-calidad-y-pruebas.md). Las capturas complementan estas pruebas; no prueban por sí solas persistencia, aislamiento o consumo.

La evaluación IA conserva ejemplos con fuente pertinente, revocada, ajena, inexistente, ambigua o maliciosa; no usa una frase exacta del LLM como oráculo. La rúbrica, tamaño de muestra y umbral pedagógico se definen en DEC-010; no se inventa un porcentaje de precisión ni de mejora del aprendizaje. Las pruebas automáticas de accesibilidad tampoco acreditan por sí solas WCAG 2.2 AA.

Para demostrar determinismo frente a IA, mantener los mismos hechos persistidos, versión de regla y corte. Probar por separado la incorporación de una ayuda realmente entregada o leída: un evento elegible puede cambiar inactividad conforme a DEC-005; una ayuda fallida o polling duplicado no genera actividad adicional.

Para rendimiento declarar versión, región de cada servicio, plan, red/cliente, corpus, caché, concurrencia, mezcla, muestra y timeouts antes de medir. Conservar muestras crudas y fallas; separar frío/caliente. Una medición local informa el desarrollo; las metas de demo requieren el recorrido del ambiente híbrido. El consumo se registra por proveedor y unidad; el presupuesto histórico no equivale a gasto medido o autorización ilimitada.

Skills útiles durante la futura implementación: `cypress-author`/`cypress-docs` al crear o corregir Cypress; `security-best-practices` en una tarea explícita de seguridad; `security-threat-model` si se encarga el análisis de amenazas; `gh-fix-ci` para checks fallidos de PR. Leer solo las necesarias y disponibles conforme al [registro de skills](../agent/15-skills-recomendadas.md); sus ejemplos no sustituyen los contratos de Alunza.

## Checklist de cierre

- [ ] Cada RF/HU/CU/PT y los 108 escenarios tienen estado y evidencia, con los 29 RNF y 6 ORG cubiertos por una comprobación o pendiente explícito.
- [ ] SEC-01 a SEC-14 y E2E-01 a E2E-06 cuentan con resultados del ambiente correspondiente; las pruebas locales y de proveedor se distinguen.
- [ ] No quedan defectos altos conocidos en la ruta crítica para recomendar aceptación; los restantes tienen impacto y próximo trabajo registrado.
- [ ] Accesibilidad manual, calidad de ayuda, p95/costo y restauración tienen resultados reales o incumplimientos visibles; no se confunden con configuración propuesta.
- [ ] El candidato conserva arquitectura, contrato RAG, diagnósticos, reglas, límites, historia y permisos de la línea base.
- [ ] CI y evidencia identifican los mismos artefactos/candidato; revisión cruzada humana y aceptación están registradas o pendientes con claridad.
- [ ] No se modificaron specs, se omitieron tests o se rebajaron defectos para conseguir un resultado favorable.

Si un punto obligatorio falla, cerrar el trabajo realizado como parcial y devolver la brecha al área responsable. **Siguiente paso:** [IMP-08, entrega y operación](08-entrega-y-operacion.md), con el candidato y el informe de calidad; puede prepararse su documentación antes, pero no declarar aceptada una entrega con requisitos obligatorios sin verificar.

## Prompt para encargar un incremento

> Trabaja únicamente el siguiente incremento pendiente de IMP-07 en docs/plan/07-calidad-integral.md. Inspecciona primero AGENTS.md y el estado real del repositorio. Identifica su ID, requisitos, casos, decisiones y ambiente; reutiliza las pruebas existentes y completa el resultado acotado con evidencia verificable. Corrige los defectos del alcance encargado y ejecuta los checks proporcionales. Distingue mocks, integración local y proveedores reales; comprueba autorizaciones vigentes antes de efectos externos. No inventes aprobación humana, mediciones ni cobertura. Entrega cambios, comandos ejecutados, resultados, bloqueos concretos y el siguiente incremento, sin iniciar IMP-08 ni publicar por esta instrucción.
