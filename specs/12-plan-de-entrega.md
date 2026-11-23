# Especificación del plan de entrega

## Línea base, estado y referencias

Alunza se planificó para **18 semanas académicas, del 11/08/2026 al 17/12/2026**, con nueve sprints de dos semanas, S0 a S8. La línea base contiene **27 historias y 184 puntos planificados**. S0/S1 cerraron definición y documentación al 02/09/2026; la revisión técnica del 04/09/2026 actualizó arquitectura mediante AD-ARQ-001. Ninguno de esos cierres demuestra software implementado o aprobación docente. La fecha prevista de planificación/inicio de S2 en MIN-008 es el 08/09/2026; este documento no presupone que ese inicio haya ocurrido.

Fuentes: [ERS, apartado 4](../Evidencias%20CAPSTONE/Fase%201/Evidencias%20de%20proyecto/Informe_ERS_Alunza.docx), [Roadmap](../Evidencias%20CAPSTONE/Fase%201/Evidencias%20de%20proyecto/Roadmap_Agil_Alunza_2026.pptx), [Product Backlog](../Evidencias%20CAPSTONE/Fase%201/Evidencias%20de%20proyecto/Product_Backlog_Alunza.xlsx), [Sprint Backlog 2](../Evidencias%20CAPSTONE/Fase%201/Evidencias%20de%20proyecto/Sprint_Backlog_Alunza_Sprint_2.xlsx), [avance](../Evidencias%20CAPSTONE/Fase%201/Evidencias%20de%20proyecto/Documento_Avance_Sprint_1_Alunza.docx), [retrospectiva](../Evidencias%20CAPSTONE/Fase%201/Evidencias%20de%20proyecto/Resumen_Reunion_Retrospectiva_Alunza.docx), [MIN-008](../Evidencias%20CAPSTONE/Fase%201/Evidencias%20de%20proyecto/minutas/Minuta_08_Alunza_Semana_4_Sesion_B.docx) y [presentación, riesgos/capacidad](../Evidencias%20CAPSTONE/Fase%201/Evidencias%20de%20proyecto/Presentacion_Alunza_CAPSTONE_Fase1.pptx).

Este plan conserva las asignaciones históricas; las propuestas de secuencia, capacidad o aceptación no cambian los archivos originales. Se registran en [fuentes y decisiones](00-fuentes-y-decisiones.md), especialmente DEC-011. El alcance y exclusiones están en [producto](01-producto-y-alcance.md); la aceptación funcional en [requisitos](02-requisitos-funcionales.md) y [flujos](03-flujos-y-criterios-de-aceptacion.md).

## Objetivo de entrega y orden de prioridad

La unidad de entrega es una vertical verificable: administración acotada y acceso autorizado; profesor publica; estudiante escribe y ejecuta JavaScript; el sistema registra el intento y resultado técnico; muestra diagnóstico y ayuda con fuente cuando exista; el estudiante reintenta; el progreso y las señales deterministas aportan evidencia al profesor.

La ERS declara **Must los 27 RF**, salvo cambio de alcance registrado. Que el Roadmap sitúe mejoras visuales o filtros en Should no permite retirar las funciones o accesibilidad exigidas por RF/RNF. Chat docente, gamificación, adaptación/RAG avanzado y otras extensiones no desplazan el núcleo. LMS completo, app nativa, SSO, pagos, detección de plagio/uso de IA, perfiles de apoderado, calificación automática de alto impacto y arquitecturas multiagente permanecen fuera del MVP.

## Entregas por sprint

Los criterios de salida operativos de esta tabla desarrollan los resultados de la línea base; requieren evidencia futura conforme a [calidad](10-calidad-y-pruebas.md).

| Sprint / semanas | Selección original | Puntos | Resultado que debe demostrarse |
| --- | --- | --- | --- |
| S0 / 1–2 | Descubrimiento y alineamiento | No estimados en el backlog de implementación | Problema, usuarios, visión, restricciones y riesgos registrados. Cierre documental histórico. |
| S1 / 3–4 | Definición y diseño | No estimados en el backlog de implementación | ERS, casos, historias, prototipos, backlogs y decisiones consolidados; validación operativa y con usuarios pendiente. |
| S2 / 5–6 | ALZ-HU-001, 002, 003, 020, 021 | 29 | Base híbrida local/desplegable, acceso por rol/estado/organización/clase, organizaciones/usuarios, clases e inscripción; evidencia RLS y validación temprana de Sandbox/IA-RAG según capacidad corregida. |
| S3 / 7–8 | ALZ-HU-004, 005, 008, 022, 023 | 32 | Estructura académica, conceptos, ejercicio con pruebas/versiones, actividad ordenada y consulta autorizada del ejercicio. Resolver prerrequisitos del banco, sin esperar toda la UI administrativa de S7. |
| S4 / 9–10 | ALZ-HU-007, 009, 010, 011, 014 | 34 | Primer incremento integrado: consultar actividad, ejecutar en sandbox, enviar/persistir, diagnosticar y reintentar con historial y telemetría mínima. |
| S5 / 11–12 | ALZ-HU-006, 012, 013, 025 | 34 | Fuentes autorizadas/indexadas, contrato IA válido, pistas progresivas, referencias visibles y degradación que conserva el flujo técnico. |
| S6 / 13–14 | ALZ-HU-015, 016, 018, 026 | 34 | Progreso explicable, panel autorizado, tres señales deterministas con reglas versionadas y evidencia. |
| S7 / 15–16 | ALZ-HU-017, 019, 024, 027 | 21 | Detalle de estudiante, revisión de señales, gobierno del banco y auditoría/CSV; consolidación y estabilización. Compatibilidad con el freeze requiere DEC-011. |
| S8 / 17–18 | Sin HU nuevas | 0 | Demo estable y ensayada, defensa, documentación final y contingencias; corregir defectos autorizados sin ampliar funciones. |

Suma S2–S7: 27 historias y 184 puntos. Los puntos son estimaciones relativas, no horas ni porcentaje ejecutado. Solo se compromete la selección del sprint inmediato tras revisar capacidad y dependencias; los horizontes siguientes mantienen su resultado pero pueden repriorizarse mediante control de cambios.

## Hitos CAPSTONE y evidencias de salida

| Semana | Ponderación académica | Evidencia esperada |
| --- | --- | --- |
| 4 | 20% | Fase 1: problema, alcance, ERS, backlog, arquitectura y prototipos documentados. El estado histórico es cierre interno documental, sin validación de prototipo ni implementación acreditada. |
| 10 | 20% | Informe de avance, repositorio con contribuciones y primer flujo técnico integrado demostrable; pruebas de persistencia, ejecución y aislamiento; riesgos y métricas realmente medidos. |
| 15 | 30% | Entrega final: informe, versión candidata, demo y congelamiento funcional. Resolver antes la tensión del trabajo S7 pendiente en DEC-011. |
| 17–18 | 30% | Defensa: demo ensayada, presentación coherente con lo implementado/probado, evidencias y plan de contingencia. |

Las ponderaciones no son porcentajes de avance ni duración. El paquete final debe incluir código y contribuciones revisables, requisitos y trazabilidad, arquitectura/modelo/decisiones, pruebas y resultados, guía local/despliegue, datos demo, manuales de roles, informe/presentación y guion. No etiquetar como «aprobado» un artefacto que solo fue redactado o revisado internamente.

## Sprint 2: plan existente y trabajo transferido

El Sprint Backlog tiene **12 tareas, 60 horas y 10 días visibles**. Su estado de origen es Planificado; las celdas de consumo diario inicializadas en cero no prueban que se hayan medido cero horas reales. Distribución: Marcelo 21 h, Abraham 20 h y Benjamin 19 h. La siguiente tabla transcribe las estimaciones sin incrementarlas.

| Tarea | Contenido de la fuente | Responsable | Horas | Dependencia operativa propuesta |
| --- | --- | --- | --- | --- |
| ALZ-TAR-001 | Base Next.js y NestJS, API de dominio única. | Marcelo | 4 | Versiones/resolución técnica de [arquitectura](05-arquitectura.md). |
| ALZ-TAR-002 | GitHub Actions y preview Vercel: lint, pruebas, build, secretos. | Abraham | 4 | Base ejecutable y acceso a ambientes; preparar CI desde el primer incremento. |
| ALZ-TAR-003 | Supabase local, PostgreSQL/pgvector, migraciones y Docker Compose. | Abraham | 4 | Configuración local/documentación y migraciones iniciales. |
| ALZ-TAR-004 | Organizaciones, usuarios, membresías, roles y aislamiento. | Marcelo | 6 | Modelo de [datos](06-modelo-de-datos.md) y resolución DEC-001. |
| ALZ-TAR-005 | Supabase Auth/JWT y estados `INVITED`/`ACTIVE`/`DISABLED`. | Marcelo | 6 | Modelo de identidad y base API. |
| ALZ-TAR-006 | Guardas NestJS y RLS en tablas/Storage expuestos. | Abraham | 5 | Identidad, organización, membresías y política de permisos. |
| ALZ-TAR-007 | Login y navegación por rol. | Benjamin | 5 | Contrato de acceso y estados; puede desarrollarse con contrato simulado, aceptación con API real. |
| ALZ-TAR-008 | Vista inicial de organizaciones. | Benjamin | 5 | Modelo, permisos y alta inicial resueltos. |
| ALZ-TAR-009 | Invitación, activación, deshabilitación y roles. | Marcelo | 5 | Auth/autorización y protección de último administrador. |
| ALZ-TAR-010 | Creación/configuración de clases. | Benjamin | 5 | Organización, profesor activo y autorización. |
| ALZ-TAR-011 | Inscripción idempotente con código vigente. | Benjamin | 4 | Clase, cuenta de estudiante y contrato de incorporación. |
| ALZ-TAR-012 | Pruebas RLS, secretos, despliegue híbrido y validación adversarial de Sandbox. | Abraham | 7 | Ambientes autorizados; controles reales disponibles; evidencia verificable. |

Compromisos transferidos por MIN-008/retrospectiva: **C-022**, Benjamin, frontend/navegación/estados; **C-023**, Marcelo, CI, previews, Auth/JWT, guardas, RLS, migraciones y entorno local; **C-024**, Abraham, validar Sandbox e IA/RAG en seguridad, latencia, costo, límites, región y fallbacks. El responsable del compromiso coordina su resultado; las tareas específicas pueden pertenecer a otro integrante, como TAR-002 de Abraham dentro del trabajo de CI.

**Brecha de capacidad:** C-024 incluye IA/RAG, pero las 12 tareas no reservan explícitamente una tarea/horas de validación RAG. TAR-012 sí menciona Sandbox y controles de seguridad. La retrospectiva exige además fijar límites de costo/latencia antes de integrar IA. **DEC-011, pendiente:** descomponer esa validación y decidir qué cabe en las 60 h, qué se reestima o qué se traslada mediante cambio de plan. No se da por absorbida en TAR-012 ni se convierte su existencia documental en prueba ejecutada.

## Dependencias y contradicciones que deben resolverse

La secuencia técnica propuesta es: identidad/ámbito y datos → contenido/versiones/publicación → ejecución/persistencia → ayuda contextual y cálculo determinista → panel/gobierno final → estabilización. La captura de auditoría debe acompañar cada operación desde su implementación, aunque el visor/CSV se acepte en S7. Las pruebas de aislamiento empiezan en S2 y continúan en cada componente; no esperan al sprint de interfaz administrativa.

| Situación documentada | Riesgo de lectura literal | Propuesta de resolución en DEC-011 |
| --- | --- | --- |
| HU-004 depende de HU-024 y HU-024 depende de HU-004; HU-004 está en S3 y HU-024 en S7. | Impide comenzar ejercicios hasta S7 o permite publicaciones sin base de versiones/propiedad. | Separar capacidades compartidas: modelo y reglas de versión/propiedad/visibilidad desde S3; UI y flujos completos de gobierno en S7. No declarar HU-024 terminada con solo sus prerrequisitos. |
| HU-006 ↔ HU-025 dentro de S5. | Dos historias esperan mutuamente su término. | Implementar primero entidad fuente/permisos/estados y pipeline común; después carga del profesor y gobierno/reindexación del administrador; aceptación de cada HU completa. |
| HU-018 ↔ HU-026 dentro de S6. | Señales sin regla versionada o administración sin motor que la use. | Modelo/versiones y validador de reglas → motor determinista → configuración/activación → panel y evidencia; aceptar conjuntamente las interacciones. |
| Hito final y freeze en semana 15; S7 conserva cuatro HU en semanas 15–16. | Incorporar funciones nuevas después del freeze o declarar entrega final con alcance sin aceptar. | Antes de semana 15 acordar qué debe estar integrado para el hito y la fecha exacta de freeze; priorizar completar el alcance comprometido antes de congelar. Semana 16 se dedica a estabilizar la misma selección según ERS, sin HU adicionales. Si no es viable, registrar ajuste de alcance/calendario con equipo y docente cuando corresponda. |
| Validación temprana Sandbox/RAG en S2 y funcionalidad integrada de ejecución/RAG en S4/S5. | Confundir un spike con historias completas o posponer toda evidencia hasta S5. | S2 reduce incertidumbre mediante ensayos acotados; S4/S5 integran y vuelven a comprobar los requisitos sobre la vertical real. |

La propuesta mantiene 27 HU y 184 puntos como fotografía de origen. Cualquier movimiento, división de esfuerzo, nueva estimación o modificación de salida requiere una revisión identificable. Las decisiones DEC-001 de ámbito administrativo y DEC-002 de historial cerrado son prerrequisitos de aceptación de sus flujos, no excusas para crear permisos o estados nuevos silenciosamente.

## Preparación y definición de terminado

### Definition of Ready — propuesta operativa

Una historia puede comprometerse cuando tiene actor/ámbito claros, RF/HU/CU/PT vinculados, criterios verificables incluyendo rechazo/falla, datos de prueba, contratos/dependencias identificados, responsable y revisor previstos, tamaño compatible con capacidad y decisiones bloqueantes resueltas. Para tareas con proveedor deben existir ambiente, credenciales gestionadas, cuota y presupuesto autorizado. Para una pantalla deben estar descritos flujo, estados y criterios accesibles en [UX](04-ux-y-accesibilidad.md).

Los 108 escenarios base sirven de punto de partida; los textos genéricos requieren concretar fixtures y resultados antes de implementarse como pruebas. Una historia con dependencia circular no está lista hasta acordar una descomposición por capacidades verificables.

### Definition of Done — línea base y aplicación

La ERS define terminado como **cambio revisado, probado, documentado y desplegable en el ambiente acordado**. Roadmap/avance añaden pruebas RLS/Sandbox, evidencia y revisión cruzada. Para aplicarlo a cada incremento:

1. Comportamiento integrado satisface los criterios de la historia y sus estados adversos; no basta un mockup ni un endpoint aislado si el criterio requiere un flujo.
2. Autorización, RLS y protección de datos se prueban donde corresponde. Las modificaciones del ejecutor incluyen pruebas de límites/aislamiento; las de IA, contrato y degradación.
3. Pruebas pertinentes, formato/lint/build y revisión de otro integrante cuentan con evidencia. Las fallas conocidas se registran, no se ocultan como escenarios omitidos.
4. Contratos, migraciones, guía operativa, requisitos y decisiones cambian de forma consistente. El seed sigue siendo reproducible y ficticio.
5. El incremento se puede desplegar en el ambiente acordado y demostrar desde una versión identificada; resultados de pruebas enlazados al commit/candidato.
6. La historia se acepta expresamente en la revisión con evidencia. El estado «implementado» no sustituye «probado» o «aceptado».

Las condiciones completas del MVP incluyen ausencia de defectos conocidos de severidad alta en la ruta crítica, aislamiento entre organizaciones/clases, determinismo, ayuda sustentada/fallback, tres señales, demo canónica y contribuciones comprobables de los tres integrantes. Su verificación está en [calidad](10-calidad-y-pruebas.md).

## Cadencia, responsables y control del avance

Marcelo es Product Owner y responsable primario de backend/integración; Benjamin de UX/UI, frontend/documentación; Abraham de datos, IA/RAG/calidad. La ERS establece facilitación Scrum rotativa: Benjamin en S0, Abraham en S1 y Marcelo en S2, repitiendo el ciclo desde S3. La facilitación concreta de una retrospectiva no sustituye la responsabilidad técnica ni acredita una nueva asignación permanente.

En planificación se revisan objetivo, capacidad real y bloqueos; diariamente se actualizan horas consumidas/restantes e impedimentos; en Sprint Review se demuestra, mide y decide aceptación/repriorización; en retrospectiva se registran acciones con responsable y plazo. Los riesgos se revisan además antes de semanas 10 y 15.

Se distinguen especificado, aprobado, implementado, probado y evidenciado. No se calcula velocidad desde puntos planificados ni desde cierres documentales S0/S1. Para S2 la fórmula del archivo es consumo + restante − estimado; el restante calculado tiene mínimo cero y la desviación conserva el exceso. **Propuesta de mejora pendiente:** durante seguimiento estimar también esfuerzo restante real, para que la previsión no suponga automáticamente que gastar una hora completa una hora de trabajo.

## Riesgos y respuestas

| Riesgo / disparador | Responsable | Respuesta y evidencia exigida |
| --- | --- | --- |
| Alcance opcional antes del núcleo; hito/freeze incompatible con HU pendientes. | Marcelo | Repriorizar, resolver DEC-011 y registrar cambio; no retirar Must sin acuerdo trazable. |
| Falla adversarial de ejecución o filtración entre organizaciones/clases. | Marcelo + Abraham | Corregir aislamiento y repetir prueba antes de aceptar el flujo afectado; no compensar con advertencias en UI. |
| RAG/Sandbox supera costo, p95, cuotas o límites disponibles. | Abraham + Marcelo | Medir temprano, registrar región y consumo, limitar volumen/ejercicios; conservar AD-ARQ-001 salvo decisión formal nueva. |
| Diagnóstico/cita incorrecta o salida sin contrato. | Abraham | Casos etiquetados, esquema y referencias validadas; `UNKNOWN`, `NO_EVIDENCE` o `PROVIDER_UNAVAILABLE` solo según su semántica. |
| Ausencia de vertical integrada en semana 10. | Marcelo | Integración continua, cambios pequeños y demostración temprana; resolver bloqueos antes de ampliar funciones. |
| Datos personales o secretos en repo/logs/previews. | Equipo | Datos ficticios, permisos y secretos solo servidor; corrección y evidencia conforme a [seguridad](09-seguridad-y-privacidad.md). |
| Más del 40% de carga en una persona, disparador de la presentación. | Equipo | Revisar capacidad semanal y redistribuir con revisión cruzada. Acordar si la medición usa horas planificadas/reales del período antes de aplicarla. |
| Prototipos no validados, editor inaccesible o mensajes que revelan datos ajenos. | Benjamin | Ensayar flujos y matriz accesible desde S2; corregir antes de aceptar cada pantalla, sin esperar S8. |
| Validación IA/RAG transferida sin capacidad explícita en S2. | Marcelo + Abraham | Estimar, asignar y decidir alcance del ensayo; preservar las 60 h como plan original y registrar variación. |
| Falla del proveedor durante demo. | Abraham + Marcelo | Ensayar degradación que conserve intento/resultados; disponer de evidencias fechadas para explicar lo comprobado sin fingir una respuesta en vivo. |

## Costos, cambios y entrega final

La estimación histórica es **CLP 4.585.000**, compuesta por CLP 265.000 directos y 540 h valorizadas a CLP 8.000/h (CLP 4.320.000). Las 540 h son esfuerzo planificado total del equipo, no horas consumidas. Todo servicio pagado requiere registro de proveedor, unidad, consumo, límite y autorización del Product Owner según la fuente; este plan no contrata ni despliega servicios. Los límites operativos y mediciones se mantienen en [operación](11-operacion-y-despliegue.md).

Un cambio de alcance, arquitectura, prioridad, presupuesto, calendario o propiedad registra motivo, alternativas, impacto en RF/HU/CU/PT, esfuerzo, riesgos y decisión del equipo; involucra al docente guía cuando corresponda. La arquitectura y proveedor inicial ya están definidos; la validación operativa no reinicia su selección sin decisión formal.

Antes de la defensa se ensaya el guion con los 12 perfiles, 2 organizaciones, 3 clases, 10 ejercicios y 6 documentos de demo; se comprueba aislamiento, una ejecución fallida/correcta, reintento, fuente válida, ausencia de evidencia, proveedor indisponible y revisión de señal. Se conserva una versión candidata identificable, resultados de pruebas, instrucciones de arranque, despliegue/recuperación y limitaciones conocidas. Publicación, infraestructura y manejo de contingencias se concretan en [operación](11-operacion-y-despliegue.md), sin presentar datos simulados como ejecución productiva.
