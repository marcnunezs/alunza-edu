# Plan de implementación para el agente

Usa este plan cuando el usuario solicite construir Alunza o un incremento que dependa de varias áreas. Lee primero [inicio](00-inicio-y-contexto.md), [alcance](../../specs/01-producto-y-alcance.md) y [plan de entrega original](../../specs/12-plan-de-entrega.md).

Las fases `IMP-00` a `IMP-08` son una secuencia técnica propuesta para el agente. No son nuevos sprints ni cambian las 27 HU, los 184 puntos, las 540 horas o las fechas académicas. No conviertas estimaciones documentales en avance real.

El [plan progresivo detallado](../plan/README.md) descompone estas fases en incrementos encargables por separado, con entregables, dependencias, comprobaciones, criterios de cierre y prompts. Para comenzar poco a poco, sigue su primer grupo IMP-00.01 a IMP-00.04. La [matriz de control](../plan/09-control-y-trazabilidad.md) mantiene cobertura funcional, decisiones y estado por ambiente.

## Regla de avance

Dentro del alcance autorizado, selecciona el primer resultado que falte y completa contratos, persistencia, API, interfaz y pruebas que necesite. Reutiliza lo existente. Si una parte está bloqueada por una decisión o dependencia externa, registra esa parte como pendiente y avanza capacidades independientes; no declares integrada la parte simulada.

La autorización para una fase concreta no implica que debas continuar todas las demás. Una solicitud de MVP completo sí exige persistir por las fases necesarias, sin cerrar el trabajo después del scaffold o del primer recorrido exitoso.

## Fases y condiciones de salida

| Fase | Trabajo concreto | Prerrequisitos y guías | Resultado que debes demostrar |
| --- | --- | --- | --- |
| IMP-00 Fundación | Fijar versiones compatibles, workspace, contratos públicos, API única, configuración local, CI inicial y health | [Fundación](02-fundacion-y-arquitectura.md), DEC-007 y preparación DEC-006 | Instalación/build local reproducible; web y API operables; comprobaciones reales, sin afirmar RF completos |
| IMP-01 Identidad y ámbito | Organizaciones, perfiles/membresías, invitaciones, JWT, estados, roles, auditoría mínima y RLS | [Backend](03-backend-y-api.md), [datos](04-datos-y-migraciones.md), [seguridad](09-seguridad-y-permisos.md); DEC-001 | Acceso permitido/denegado por rol y organización; último admin protegido; alta institucional completa solo al resolver permiso de aprovisionamiento |
| IMP-02 Estructura y contenido | Cursos, clases, asignación, códigos, inscripción, conceptos, versiones, pruebas, actividad y consulta de ejercicio | IMP-01; [frontend](05-frontend-y-ux.md), backend/datos; DEC-002/006 | Profesor publica, estudiante accede y ve solo pruebas visibles; datos/versiones y permisos efectivos |
| IMP-03 Práctica técnica | Ejecutor, RUN/SUBMIT, intento, diagnóstico, historial, reintento y avance mínimo real para listar actividades | IMP-02; [ejecución](06-ejecucion-segura.md); DEC-003/004 | Un flujo real publica→ejecuta→envía→persiste→reintenta; lista refleja intentos y completitud reales; errores y aislamiento probados; sin dependencia de IA |
| IMP-04 Ayuda contextual | Fuentes, versiones/generaciones, indexación, RAG, feedback y niveles de pista | Intentos persistidos de IMP-03; [IA/RAG](07-ia-y-rag.md); DEC-010 | Fuente autorizada visible, contratos estrictos, no evidencia y caída del proveedor sin perder resultado técnico |
| IMP-05 Evidencia determinista | Progreso, eventos, reglas versionadas, señales y tablero | IMP-03; [progreso/señales](08-progreso-y-senales.md); DEC-005 | Agregados coinciden con fixtures independientes; tres señales trazables; IA no interviene en cálculos |
| IMP-06 Gobierno y seguimiento completo | Detalle de estudiante, revisión de señal, gobierno del banco, visor de auditoría y CSV | IMP-02/03/05; IMP-04 para detalle integral de ayudas; backend/frontend/datos/seguridad | Cierre de flujos administrativos y docentes con permisos, historial y concurrencia verificables |
| IMP-07 Calidad transversal | Completar cobertura, adversariales, accesibilidad, integración, p95, recuperación y defectos | Todo componente afectado; [pruebas](10-pruebas-y-evidencias.md), [operación](11-operacion-y-entrega.md) | Cada RF/RNF tiene resultado comprobable o incumplimiento explícito; no hay defectos altos conocidos en la ruta crítica para aceptar entrega |
| IMP-08 Entrega reproducible | Demo canónica, manuales por rol, guía operativa, documentación final y candidato | IMP-07; DEC-008/009/011/012 según alcance de entrega | Otra persona reproduce la versión; comandos reales, evidencias vinculadas y estado de despliegue exacto |

Realiza un ensayo técnico temprano de Sandbox y de los contratos RAG durante IMP-00/01 cuando exista autorización y configuración. Ese ensayo reduce incertidumbre y no cierra IMP-03/04. Inicia auditoría, aislamiento y pruebas desde la primera operación; IMP-06/07 completan cobertura, no posponen esos controles.

## Cobertura funcional de cierre

En esta tabla la fase indica el cierre principal, no la primera línea de código. Conserva siempre la relación con ALZ-HU, ALZ-CU y ALZ-PT del mismo número y los cuatro escenarios originales E1–E4.

| Requisito | Cierre principal | Comportamiento que debes integrar |
| --- | --- | --- |
| ALZ-RF-001 | IMP-01 | Sesión y operación según identidad, rol, estado y ámbito |
| ALZ-RF-002 | IMP-02 | Creación y configuración de clase |
| ALZ-RF-003 | IMP-02 | Inscripción válida, expirada, ajena y concurrente |
| ALZ-RF-004 | IMP-02 | Ejercicio con conceptos, versión, pruebas y límites |
| ALZ-RF-005 | IMP-02 | Composición, publicación y cierre de actividad |
| ALZ-RF-006 | IMP-04 | Carga docente e ingestión de material autorizado |
| ALZ-RF-007 | IMP-03 | Actividades publicadas y estado de avance calculado desde evidencia real; no valores simulados |
| ALZ-RF-008 | IMP-02 | Ejercicio, plantilla y pruebas visibles |
| ALZ-RF-009 | IMP-03 | Ejecución segura y resultado normalizado |
| ALZ-RF-010 | IMP-03 | Envío persistido antes de IA/RAG |
| ALZ-RF-011 | IMP-03 | Diagnóstico determinista consultable |
| ALZ-RF-012 | IMP-04 | Pistas progresivas de intento registrado |
| ALZ-RF-013 | IMP-04 | Feedback validado y sustentado por fuentes |
| ALZ-RF-014 | IMP-03 | Reintento con historial conservado |
| ALZ-RF-015 | IMP-05 | Progreso por actividad y concepto |
| ALZ-RF-016 | IMP-05 | Tablero de la clase autorizada |
| ALZ-RF-017 | IMP-06 | Detalle docente del estudiante |
| ALZ-RF-018 | IMP-05 | Tres señales deterministas con evidencia |
| ALZ-RF-019 | IMP-06 | Revisión idempotente de señal |
| ALZ-RF-020 | IMP-01 | Organización y aprovisionamiento dentro de ámbito explícito |
| ALZ-RF-021 | IMP-01 | Invitación, activación, rol y deshabilitación |
| ALZ-RF-022 | IMP-02 | Gobierno de cursos, clases y profesores |
| ALZ-RF-023 | IMP-02 | Taxonomía única, sin ciclos y versionada |
| ALZ-RF-024 | IMP-06 | Gobierno completo de propiedad, versiones, visibilidad y archivo |
| ALZ-RF-025 | IMP-04 | Visibilidad, reindexación y gobierno del corpus |
| ALZ-RF-026 | IMP-05 | Configuración y activación de reglas versionadas |
| ALZ-RF-027 | IMP-06 | Auditoría filtrada y CSV autorizado |

## Resuelve dependencias sin eliminar requisitos

- Para HU-004 ↔ HU-024, construye propiedad, visibilidad y versiones al crear el banco en IMP-02. Completa sus pantallas y gobierno en IMP-06; no marques RF-024 completo con el esquema únicamente.
- Para HU-006 ↔ HU-025, comienza por fuentes, permisos y pipeline compartido. Integra carga docente y gobierno administrativo sobre ese mismo servicio.
- Para HU-018 ↔ HU-026, implementa schema/validador/versiones de regla, luego motor, activación y presentación. No generes señales con umbrales invisibles hardcodeados.
- IMP-05 puede avanzar con la práctica técnica sin esperar al proveedor IA. Mantén desacopladas las reglas y su persistencia.
- Implementa en IMP-03 la proyección mínima de avance requerida por RF-007, usando la misma fórmula determinista de [progreso](../../specs/14-progreso-y-senales.md). Reutilízala en IMP-05, que completa filtros, conceptos y evidencia de RF-015; no declares RF-007 cerrado si su estado todavía es simulado.
- Trata freeze y capacidad como DEC-011. No reescribas el roadmap académico, retires Must o atribuyas acuerdos humanos para cuadrar una fecha.

## Cierra cada incremento

Selecciona los escenarios concretos y deriva resultados esperados desde los specs antes de programar. Implementa el comportamiento, valida transacciones y rechazos, conecta la interfaz que requiera el RF y ejecuta checks del área. Añade evidencia al [registro](14-plantillas-de-trabajo.md) y revisa el diff para detectar cambios ajenos.

Usa estados precisos: «parcial» si falta una capa requerida; «implementado» si existe el código; «probado localmente» si ejecutaste esa prueba; «integrado con proveedor» solo con evidencia real; «aceptado» únicamente cuando exista la aceptación correspondiente. Una revisión de agente no acredita firma del docente ni contribución de integrantes humanos.
