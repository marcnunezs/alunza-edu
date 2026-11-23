# Guías de implementación para agentes de IA

Estas instrucciones convierten los specs de Alunza en un procedimiento para
escribir, integrar y verificar código. Se prepararon el 10/09/2026 y se mantienen
para trabajar sobre el repositorio existente. Consulta primero el
[estado actual](../estado-actual.md); la guía por sí sola no acredita resultados
de pruebas ni aceptación de una capacidad.

Empieza por [AGENTS.md](../../AGENTS.md). En una herramienta que no cargue ese archivo automáticamente, adjúntalo o indícale al agente que lo lea. Los specs determinan qué construir; estas guías indican cómo abordar el trabajo sin duplicar o cambiar esos requisitos.

## Documentos

| Guía | Resultado esperado al usarla |
| --- | --- |
| [00 Inicio y contexto](00-inicio-y-contexto.md) | Identificar repositorio, estado real, alcance y lecturas necesarias |
| [01 Plan de implementación](01-plan-de-implementacion.md) | Elegir una entrega con dependencias y cobertura claras |
| [02 Fundación y arquitectura](02-fundacion-y-arquitectura.md) | Preparar workspace, módulos, contratos y ejecución local |
| [03 Backend y API](03-backend-y-api.md) | Implementar operaciones de dominio y errores con autorización |
| [04 Datos y migraciones](04-datos-y-migraciones.md) | Construir persistencia versionada, íntegra y aislada |
| [05 Frontend y UX](05-frontend-y-ux.md) | Construir flujos por rol, editor y estados accesibles |
| [06 Ejecución segura](06-ejecucion-segura.md) | Implementar supervisor, pruebas y adaptadores del ejecutor |
| [07 IA y RAG](07-ia-y-rag.md) | Implementar corpus, ayuda contextual y fallbacks verificables |
| [08 Progreso y señales](08-progreso-y-senales.md) | Implementar fórmulas, eventos, reglas y evidencia |
| [09 Seguridad y permisos](09-seguridad-y-permisos.md) | Aplicar y probar límites de acceso en todas las capas |
| [10 Pruebas y evidencias](10-pruebas-y-evidencias.md) | Convertir escenarios en comprobaciones y registrar resultados reales |
| [11 Operación y entrega](11-operacion-y-entrega.md) | Preparar CI, entornos, demo, despliegue y recuperación |
| [12 Decisiones pendientes](12-decisiones-pendientes.md) | Tratar los doce DEC sin inventar aprobaciones ni detener trabajo independiente |
| [13 Prompts de implementación](13-prompts-de-implementacion.md) | Dar una instrucción completa al agente para iniciar, continuar o revisar |
| [14 Plantillas de trabajo](14-plantillas-de-trabajo.md) | Registrar tarea, decisión, evidencia y traspaso de contexto |
| [15 Skills recomendadas](15-skills-recomendadas.md) | Elegir skills disponibles y candidatas verificadas según la tarea, con sus límites para Alunza |

## Cómo iniciar

Lee el [estado actual](../estado-actual.md), delimita el alcance solicitado y
elige el [prompt](13-prompts-de-implementacion.md) correspondiente. El proyecto
ya tiene una base funcional: inspecciona el código y su último registro antes
de seleccionar el siguiente resultado pendiente. El prompt de fundación sirve
para una base realmente ausente, no para reiniciar el repositorio al retomar.

El [plan](01-plan-de-implementacion.md) usa fases técnicas `IMP-00` a `IMP-08`. No reemplazan sprints, RF, HU ni estimaciones del CAPSTONE. Las 27 historias siguen siendo obligatorias salvo cambio de alcance explícito.

Para trabajar poco a poco, utiliza el [desglose exhaustivo por fases](../plan/README.md), con incrementos, entregables, dependencias, pruebas y prompts de alcance acotado. Su [matriz de control](../plan/09-control-y-trazabilidad.md) permite registrar qué se implementó, probó e integró realmente.

Los specs fijan requisitos y contratos; la documentación de arquitectura explica
estructura y responsabilidades; el plan organiza trabajo y dependencias; los
registros de `docs/work` acreditan cambios y pruebas por candidato. El estado
actual enlaza esas fuentes sin sustituirlas. Conserva los cortes históricos y
consulta el último estado explícito antes de tratar un pendiente antiguo como
una decisión que deba preguntarse de nuevo.

## Mantenimiento

Mantén los valores, catálogos y reglas de producto en [specs](../../README.md). Referencia esas fuentes desde estas guías y actualiza la instrucción afectada si cambia el contrato. Un ejemplo o propuesta de esta carpeta no convierte una decisión pendiente en aprobada.

No crees carpetas, scripts, servicios o registros solo para reproducir ubicaciones
propuestas por una guía. Inspecciona y reutiliza lo existente; añade artefactos
cuando la tarea los necesite. Las [plantillas](14-plantillas-de-trabajo.md)
indican qué registros generar cuando haya trabajo real que documentar.
