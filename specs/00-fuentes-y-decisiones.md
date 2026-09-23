# Fuentes y decisiones de Alunza

Fecha de redacción: 2026-09-10. Estado: especificación documental para revisión e implementación. Este documento establece cómo interpretar los specs y dónde resolver las diferencias entre fuentes.

## Autoridad y estados

**Documentado** identifica compromisos expresos de la ERS 1.3 y de sus fuentes compatibles. **Propuesta técnica** concreta un requisito sin atribuir aprobación previa al equipo. **Pendiente** identifica una elección o contradicción cuya resolución afecta implementación o aceptación. «Debe» expresa el comportamiento esperado dentro del estado indicado, no que ese comportamiento exista.

La ERS 1.3, sección 5.7, se declara fuente principal de verdad técnica. AD-ARQ-001 y AD-IA-001 permanecen vigentes; cambiar proveedor o arquitectura requiere un nuevo registro formal. Los detalles compatibles de casos de uso e historias completan la ERS. Backlogs y roadmap determinan planificación; mockups y MER son antecedentes de diseño. Ante incompatibilidad, conservar el requisito de la ERS y registrar la discrepancia.

El cierre académico de Fase 1 es el 02/09/2026 y la revisión técnica es del 04/09/2026. Las portadas que conservan la fecha anterior no invalidan el registro de revisión 1.3. No se infiere avance de software a partir de fechas transcurridas.

## Inventario de fuentes utilizadas

Los vínculos apuntan a los originales del repositorio. Se leyeron el texto y las tablas de los documentos, todas las hojas de los tres XLSX y las diapositivas de ambas presentaciones. Los mockups y el MER se revisaron como imágenes. Las autoevaluaciones individuales no definen requisitos de producto.

| ID local | Fuente | Uso principal |
| --- | --- | --- |
| F01 | [Informe ERS Alunza](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/Informe_ERS_Alunza.docx>) | ERS 1.3: 27 RF, 29 RNF, 6 ORG, 4 parámetros, arquitectura y catálogos |
| F02 | [Acta de Constitución](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/Acta_de_Constitucion_Alunza.docx>) | Visión, equipo, alcance, presupuesto y criterios de aprobación |
| F03 | [Casos de Uso Extendidos](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/Documento_Casos_de_Uso_Extendidos_Alunza.docx>) | 27 CU, excepciones, reglas y trazabilidad |
| F04 | [Historias de Usuario](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/Plantilla_Historias_Usuario_Alunza.xlsx>) | Historias, escenarios, catálogos y criterios |
| F05 | [Product Backlog](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/Product_Backlog_Alunza.xlsx>) | 27 HU, prioridades, 184 puntos, dependencias y exclusiones |
| F06 | [Sprint Backlog 2](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/Sprint_Backlog_Alunza_Sprint_2.xlsx>) | 12 tareas y 60 horas planificadas |
| F07 | [Roadmap Ágil 2026](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/Roadmap_Agil_Alunza_2026.pptx>) | Nueve sprints, 18 semanas e hitos |
| F08 | [Presentación CAPSTONE Fase 1](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/Presentacion_Alunza_CAPSTONE_Fase1.pptx>) | Contexto y síntesis ejecutiva |
| F09 | [Avance Sprint 1](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/Documento_Avance_Sprint_1_Alunza.docx>) | Estado documental y trabajo trasladado a Sprint 2 |
| F10 | [Retrospectiva](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/Resumen_Reunion_Retrospectiva_Alunza.docx>) | Riesgos y acuerdos de mejora |
| F11 | [Minutas 01 a 08](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/minutas>) | Evolución de acuerdos; prevalece la ERS en contradicciones |
| F12 | [Mockups](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/mockups>) | Administración, profesor y estudiante; funcionalidad planificada |
| F13 | [MERALUNZA](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/MER/MERALUNZA.png>) y [descriptor DMD](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/MER/MER_ALUNZA.dmd>) | Modelo histórico; no equivale a migraciones del modelo actual |
| F14 | [Formativa grupal](<../Evidencias CAPSTONE/Fase 1/Evidencias grupales/1.4_APT122_FormativaFase1.docx>) | Contexto académico y definición del proyecto |
| F15 | [Guía de definición](<../Evidencias CAPSTONE/Fase 1/Evidencias grupales/1.5_GuiaEstudiante_Fase 1_Definicion Proyecto APT.docx>) | Contexto de la entrega académica |

No se usan copias de `_document_backups`, renders de `_document_update_work` ni archivos de trabajo como autoridad. El descriptor DMD por sí solo no contiene un esquema relacional completo. El archivo RAR se conserva como antecedente y no se presenta como migración validada.

## Decisiones documentadas vigentes

| ID original | Estado de la fuente | Decisión conservada |
| --- | --- | --- |
| AD-ARQ-001 | Definitiva, 04/09/2026 | Next.js en Vercel; NestJS en Azure Container Apps; Supabase; Vercel Sandbox productivo y adaptador Docker local |
| AD-IA-001 | Vigente | Azure OpenAI para generación y embeddings mediante interfaz configurable; recuperación con pgvector |
| ALZ-PAR-001 | Definido, no probado | Sandbox 1 vCPU/2 GB; proceso 128 MB/3 s/64 KB |
| ALZ-PAR-002 | Definido, no probado | Archivos hasta 10 MB; chunks 500 tokens, overlap 50, top-k 5 |
| ALZ-PAR-003 | Definido, no probado | p95 interfaz/API <3 s; ejecución completa <5 s; IA <12 s |
| ALZ-PAR-004 | Definido, no probado | WCAG 2.2 AA |

## Registro de decisiones adicionales

Los identificadores DEC son nuevos en estos specs. Ninguna fila constituye aprobación del Product Owner o del docente guía. Los responsables indicados son los roles propuestos para cerrar la decisión.

| ID | Diferencia o vacío | Tratamiento propuesto y criterio de cierre | Responsable / momento |
| --- | --- | --- | --- |
| DEC-001 | RF-020 permite crear organizaciones dentro de un ámbito; las fuentes no fijaban su concesión ni la relación entre cuenta y membresía | Resuelta para IMP-01 por instrucción del usuario: permiso técnico revocable de un solo uso, creación y primera membresía ADMIN atómicas. Exactamente un rol por membresía. Correo normalizado global; estado institucional independiente de Auth y de otras organizaciones. Archivo solo con el ADMIN ejecutor activo y sin otras dependencias/invitaciones/trabajos pendientes; conserva lectura administrativa. Invitación de 72 horas con reenvío que invalida el enlace anterior | Usuario, implementación local IMP-01; no atribuye aceptación académica |
| DEC-002 | ERS solo hace visible PUBLISHED; CU-007/014 contemplan historial CLOSED; el archivado de banco tiene efecto ambiguo sobre actividades vigentes | Proponer catálogo/resolución PUBLISHED e historial autorizado CLOSED. Confirmar admisión concurrente al cierre, fechas de disponibilidad y si archivar banco bloquea solo nuevas asignaciones o también resolución vigente. No admitir reapertura implícita | PO y UX, S3 |
| DEC-003 | Catálogo de seis diagnósticos carece de códigos para memoria, salida o fallas de infraestructura | Usar motivo operativo separado; TIMEOUT para plazo estudiantil, UNKNOWN cuando falta evidencia concluyente. Probar mecanismo real de límite total 128 MB y confidencialidad de tests ocultos | Backend y calidad, prototipo S2 |
| DEC-004 | Fuentes no fijan rutas HTTP, transacciones, colas, idempotencia ni serialización | Concretada para identidad institucional en 07 y OpenAPI: contexto transaccional, RLS de escritura, auditoría atómica, versiones, idempotencia de 24 h y vínculos persistentes; entrega Auth fuera de transacción mediante trabajo durable con lease y reconciliación. Contratos académicos/RAG pendientes conservan su alcance anterior | Backend, evidencia local IMP-01; S2–S5 para contratos restantes |
| DEC-005 | Umbrales de señales definidos, pero faltan eventos elegibles, ventana exacta y deduplicación | Aplicar propuesta de 14; fijar reloj, evidencias, desempates y versión de regla mediante fixtures reproducibles | Datos y PO, antes de S6 |
| DEC-006 | MER histórico carece de organizaciones, clases y gobierno del alcance ampliado | Diccionario institucional revisado técnicamente antes de la migración incremental IMP-01, conservando perfiles, membresías y migración de fundación. Revisión de FK, roles, estados, archivo, permisos, invitaciones, trabajos, idempotencia y auditoría en docs/work/IMP-01-dictionary.md. El modelo académico sigue sujeto a sus incrementos | Revisión técnica de implementación; no aceptación académica |
| DEC-007 | Stack incluye familias de versiones sin lockfile ni compatibilidad demostrada | Conservar Node 24/Nest 12/React 19/TS 5.x; fijar patches, versión Next.js, CLI, test runner y PostgreSQL real mediante arranque/build/CI | Backend y frontend, S2 |
| DEC-008 | No hay región elegida, perfil de concurrencia ni prueba p95 | Medir opciones disponibles desde Chile; definir muestra y carga; registrar límites/costos y resultado. No reemplazar arquitectura por falta de medición | Backend y calidad, S2–S6 |
| DEC-009 | Faltan retención, eliminación, base de tratamiento y residencia de datos de un piloto real | Demo ficticia. Definir política institucional, responsables, plazos y restauración antes de datos reales; sin afirmar cumplimiento legal | PO e institución, antes del piloto |
| DEC-010 | No hay deployment/modelo concreto, dimensión de embeddings, umbral de pertinencia ni niveles de pistas | Versionar configuración y corpus; validar relevancia/citas y contrato con proveedor inicial; especificar timeout y política de reintento | Datos e IA, S5 |
| DEC-011 | Dependencias circulares del backlog; S7 alcanza semana 16 pese a freeze semana 15; validación técnica S2 compite por 60 horas | Conservar planificación original y ordenar capacidades base antes de gobierno avanzado. Resolver capacidad y freeze como describe 12; registrar cambios sin duplicar puntos | PO y equipo, planificación de cada sprint |
| DEC-012 | Demo fija cantidades, pero no distribución exacta ni dataset versionado | Proponer distribución en 11; fijar fixtures, reloj y casos. Recrear exactamente 2 organizaciones, 2 administradores, 2 profesores, 8 estudiantes, 3 clases, 10 ejercicios y 6 documentos | Equipo, S2 y antes de demo |

**Discrepancias resueltas por autoridad documental:** la presentación y la minuta 06 usan «unknown» en ausencia de fuente. En los specs, `UNKNOWN` es exclusivamente diagnóstico técnico y `NO_EVIDENCE` es estado RAG. Un texto de HU que dice «límite excedido» no agrega un séptimo diagnóstico. «No verificable» no agrega un tercer estado de señal. Los mocks no autorizan consultas entre organizaciones.

## Referencias técnicas externas

**Resolución de implementación IMP-02, 23/09/2026.** El usuario confirmó el plan de contenido/editor: DEC-002 queda resuelta para DRAFT→PUBLISHED→CLOSED sin reapertura, ventana inclusiva al inicio/exclusiva al término, consulta histórica autorizada y archivo de banco que bloquea nuevas asignaciones sin alterar publicaciones. ADMIN archiva clases tras cerrar publicaciones; códigos colectivos duran hasta siete días y se revocan al archivar. Borradores locales duran treinta días desde última edición y sobreviven al cierre de sesión, separados por cuenta/organización/clase/asignación/versión. Sigue pendiente la carrera con SUBMIT real de IMP-03. DEC-004/006 se concretan para este corte en [API](07-api-y-contratos.md), OpenAPI y [diccionario revisado](../docs/work/IMP-02-dictionary.md): fechas civiles startDate/endDate, autorización académica transaccional, versiones inmutables, permisos por operación y auditoría. DEC-012 se concreta parcialmente con doce identidades, tres clases y diez ejercicios; seis documentos quedan para materiales. La [evidencia IMP-02](../docs/work/IMP-02-content.md) distingue implementación, pruebas locales y aceptación académica pendiente.

Evidencia de implementación del 10/09/2026: [fundación local](../docs/work/IMP-00-foundation.md), [CI/Cypress](../docs/work/IMP-00.05-ci-y-cypress.md) y [ensayos IMP-00.06–IMP-00.08](../docs/work/IMP-00.06-08-ensayos.md). El último registro acota DEC-003/004/006/007/008/009/010/012 con resultados y brechas por entorno. Para el ensayo, el usuario fijó 128 MiB = 134217728 bytes y 64 KiB = 65536 bytes; los 3000 ms son acumulados por ejecución. La evidencia local no modifica la autoridad de las fuentes, acredita aceptación humana ni convierte parámetros o RF completos en aprobados. Las integraciones remotas y decisiones de negocio pendientes conservan su estado.

Consulta de contraste: 10/09/2026. Solo precisan riesgos de implementación; no cambian el alcance ni acreditan pruebas del proyecto.

- [Guía oficial de migración NestJS](https://docs.nestjs.com/migration-guide): compatibilidad de Nest 12, ESM y mínimos del generador. Se conserva Jest de la ERS aunque los valores por defecto del generador difieran.
- [Versiones de Node.js](https://nodejs.org/en/about/previous-releases): referencia para fijar un patch soportado de la familia 24.
- [RLS de Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security): permisos, políticas y protección de vistas; [changelog](https://supabase.com/changelog) para revisar cambios antes de instalar.
- [Vercel Sandbox](https://vercel.com/docs/sandbox), [configuración 1 vCPU/2 GB](https://vercel.com/changelog/vercel-sandbox-now-supports-1-vcpu-2-gb-configurations) y [políticas de salida de red](https://vercel.com/changelog/advanced-egress-firewall-filtering-for-vercel-sandbox): referencia del entorno, sin sustituir pruebas de límites internos.

## Control de cambios y cobertura

Una modificación debe indicar fecha, autor real, motivo, fuente o decisión, estado, RF/HU/CU/PT/RNF afectados, impacto en datos/API/pruebas y efecto sobre horas, costos e hitos. Las propuestas aceptadas deben actualizar todos los contratos que dependan de ellas. Conservar identificadores originales y un registro de evidencia por versión.

La [matriz funcional](02-requisitos-funcionales.md), los [escenarios](03-flujos-y-criterios-de-aceptacion.md) y la [matriz de calidad](10-calidad-y-pruebas.md) son los puntos de comprobación de cobertura. La revisión de Markdown verifica coherencia documental; la aceptación del software requiere ejecutar las pruebas allí definidas.
