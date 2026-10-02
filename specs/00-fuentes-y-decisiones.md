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
| DEC-002 | ERS solo hace visible PUBLISHED; CU-007/014 contemplan historial CLOSED; el archivado de banco tiene efecto ambiguo sobre actividades vigentes | Contenido/historial resueltos para IMP-02. El 26/09/2026 el usuario confirmó también SUBMIT: admisión anterior al cierre puede terminar y persistir después; admisión posterior se rechaza. Sin reapertura y con autorización vigente para entregar/consultar. Estado de implementación y pruebas en docs/work/IMP-03-submissions.md | Usuario, planificación y posterior implementación IMP-03; no acredita aceptación académica |
| DEC-003 | Catálogo de seis diagnósticos carece de códigos para memoria, salida o fallas de infraestructura | Usar motivo operativo separado; TIMEOUT para plazo estudiantil, UNKNOWN cuando falta evidencia concluyente. Probar mecanismo real de límite total 128 MB y confidencialidad de tests ocultos | Backend y calidad, prototipo S2 |
| DEC-004 | Fuentes no fijan rutas HTTP, transacciones, colas, idempotencia ni serialización | Concretada por incrementos en 07/OpenAPI: identidad, contenido, RUN/SUBMIT, materiales y ayuda. IMP-04.07/preparación .08 añade ledger universal previo a llamadas y listener operacional privado con autorización acotada por run/etapa; mantiene ACK, reautorización y no repetición incierta. Seguimiento conserva su incremento | Implementado y probado en TEST, 02/10/2026; [resultados del corte](../docs/work/IMP-04-evaluation.md), sin acreditar integración remota |
| DEC-005 | Umbrales de señales definidos, pero faltan eventos elegibles, ventana exacta y deduplicación | Aplicar propuesta de 14; fijar reloj, evidencias, desempates y versión de regla mediante fixtures reproducibles | Datos y PO, antes de S6 |
| DEC-006 | MER histórico carece de organizaciones, clases y gobierno del alcance ampliado | Diccionarios/migraciones incrementales de producto y relaciones privadas de evaluación: runs, etapas, bindings, propietarios, calibraciones y recibos de llamadas. RLS y claves compuestas conservan aislamiento; evaluación no concede lectura docente ni altera attempt_events. Agregados y seguimiento conservan sus incrementos | Persistencia, aislamiento y recuperación probados en TEST; [evidencia del corte](../docs/work/IMP-04-evaluation.md), no aceptación académica |
| DEC-007 | Stack incluye familias de versiones sin lockfile ni compatibilidad demostrada | Conservar Node 24/Nest 12/React 19/TS 5.x; fijar patches, versión Next.js, CLI, test runner y PostgreSQL real mediante arranque/build/CI | Backend y frontend, S2 |
| DEC-008 | No hay región elegida ni p95 remoto medido | IMP-04.08 fija preparación de 25 intentos × 4 ayudas en serie y 25 × 4 con concurrencia cuatro, cuotas vigentes y cuatro presupuestos más techo global. Separar admisión→persistencia, tiempo cliente y espera por cuota; conservar fallbacks y costos/uso desconocidos. Región/precios/resultados Azure aún pendientes | Preparación ejecutable probada en TEST: p95 admisión→persistencia 756/4.342 ms en serie/concurrencia cuatro; [evidencia](../docs/work/IMP-04-evaluation.md). No acredita p95 remoto ni cierre de IMP-04.08 |
| DEC-009 | Faltan retención, eliminación, base de tratamiento y residencia de datos de un piloto real | Demo ficticia. Definir política institucional, responsables, plazos y restauración antes de datos reales; sin afirmar cumplimiento legal | PO e institución, antes del piloto |
| DEC-010 | No hay deployment/modelo remoto elegido ni calibración Azure medida | Conserva límites de materiales, explicación y tres pistas, revisión adicional y algoritmo sin umbral prefijado. IMP-04.07/preparación .08 liga calibración a consultas, distancias, corpus y recibos persistidos del mismo run/origen/perfil, sin promover TEST a Azure; incorpora corpus/rúbrica adversarios. Configuración Azure y calidad pedagógica siguen pendientes | Contratos y arnés probados con proveedores TEST; [43 casos comprobados](../docs/work/IMP-04-evaluation.md). Calibración Azure, evaluación semántica/docente y CAPSTONE pendientes |
| DEC-011 | Dependencias circulares del backlog; S7 alcanza semana 16 pese a freeze semana 15; validación técnica S2 compite por 60 horas | Conservar planificación original y ordenar capacidades base antes de gobierno avanzado. Resolver capacidad y freeze como describe 12; registrar cambios sin duplicar puntos | PO y equipo, planificación de cada sprint |
| DEC-012 | Demo fija cantidades, pero no distribución exacta ni dataset versionado | Proponer distribución en 11; fijar fixtures, reloj y casos. Recrear exactamente 2 organizaciones, 2 administradores, 2 profesores, 8 estudiantes, 3 clases, 10 ejercicios y 6 documentos | Equipo, S2 y antes de demo |

**Discrepancias resueltas por autoridad documental:** la presentación y la minuta 06 usan «unknown» en ausencia de fuente. En los specs, `UNKNOWN` es exclusivamente diagnóstico técnico y `NO_EVIDENCE` es estado RAG. Un texto de HU que dice «límite excedido» no agrega un séptimo diagnóstico. «No verificable» no agrega un tercer estado de señal. Los mocks no autorizan consultas entre organizaciones.

## Resoluciones por incremento

**Resolución IMP-04.07 y preparación ejecutable IMP-04.08, 01/10/2026.** El
alcance autorizado incorpora fallos e inyección, continuidad de práctica y arnés
operable por etapas. Está implementado y probado en TEST, con cierre local de
CI el 02/10/2026 a las 04:14:41Z. IMP-04.08 alcanza únicamente su preparación
ejecutable: no se declara la fase completa aceptada. Los resultados se registran
en [IMP-04-evaluation](../docs/work/IMP-04-evaluation.md), sin acreditar Azure,
despliegue ni aceptación académica.

La corrida completa aprobó 17 pasos: 985 pruebas unitarias, 146 HTTP, 471
aserciones SQL, 27 pruebas de integración IA, 45 recorridos Cypress sin omisiones
y tres series SUBMIT consecutivas bajo el mismo límite. El run TEST
`73005846-0021-40b8-b54c-7ebeacbcb3a6` cerró 43/43 casos: 30 ayudas, 12 candidatos
y una comprobación determinista local de UNKNOWN mediante Jest. Conservó 234
muestras, 763 recibos y tres reanudaciones, sin llamadas externas. Sus perfiles
de 100 ayudas en serie y 100 con concurrencia cuatro obtuvieron p95
admisión→persistencia de 756 y 4.342 ms; estos resultados no miden Azure ni
demuestran calidad semántica o aceptación docente.

DEC-004/006 fijan un ledger privado común a todas las llamadas de IA, reserva
durable previa al despacho, recibos seguros y recuperación sin repetir llamadas
inciertas. La autorización de mantenimiento liga corrida, cuatro etapas,
destino/candidato, corpus, actor/ámbito, hash de archivo o intento, perfil y
presupuestos. Una credencial operacional permite consultar/iniciar/detener
únicamente ese run mediante listener loopback; no amplía permisos de dominio.
Las observaciones tardías conservan consumo sin habilitar publicación revocada.

DEC-008 concreta el perfil de 100 ayudas en serie y 100 con concurrencia cuatro,
con explicación y tres pistas por intento. Conserva cuotas y plazo de 15 s,
separa espera por cuota y latencia de ayuda completa, y exige precios y techos
por etapa/global explícitos; los datos no observados permanecen desconocidos.
DEC-010 exige procedencia comprobable de calibración y particiones reservadas,
sin umbral sintético de Azure ni promoción de artefactos TEST. LAB-EVAL se aísla
de DEV y TEST; los fixtures adversarios se separan de la demo. La evaluación
semántica/docente, CAPSTONE, configuración/región/precios Azure definitivos,
Vercel Sandbox IMP-03.07 y operación productiva ACA siguen pendientes. El
[diccionario](../docs/work/IMP-04-evaluation-dictionary.md) y el
[manual operacional](../docs/work/IMP-04-evaluation-operations.md) detallan el corte.

**Resolución IMP-04.01–04.03, 27/09/2026.** El usuario autorizó implementar el
corte de materiales con activación automática tras completar el índice y
reemplazo mediante una nueva versión. Fuente y ámbito se conservan; visibilidad
no permite reasignar una fuente a otra clase/actividad. La verificación local
queda separada del ensayo Azure real. DEC-004/006 se concretan en los contratos
de materiales, la migración incremental y el
[diccionario](../docs/work/IMP-04-materials-dictionary.md). La generación activa
solo cambia mediante publicación completa y atómica; una reindexación fallida
conserva la versión anterior y archivar impide una activación tardía.

DEC-010 fija para este corte el límite de archivo decimal, extracción acotada en
proceso separado, fragmentación 500/50 con localizadores y top-k=5 filtrado por
ámbito. Azure OpenAI permanece como proveedor inicial; la configuración de
embeddings es independiente de generación. El primer procesamiento fija el
perfil de modelo/dimensión/configuración del ambiente, incluso si después falla;
migrar ese perfil requiere trabajo explícito posterior. El corpus canónico de
DEC-012 incorpora seis documentos ficticios, dos por clase. El
[registro de materiales](../docs/work/IMP-04-materials.md) mantiene las pruebas y
pendientes sin atribuir aceptación humana, costos ni resultados remotos.
IMP-03.07 conserva su validación remota pendiente. El corte de ayuda se concreta
en la resolución siguiente, sin acreditar Azure real.

**Resolución IMP-04.04–04.06, 27/09/2026.** El usuario autorizó implementar
explicación separada y tres pistas por intento propio confirmado, también después
del cierre mientras exista acceso. SUCCESS y fallos operativos no admiten pistas
correctivas; estos últimos reciben explicación determinista sin proveedor.
DEC-004 fija admisión durable, idempotencia, checkpoints, plazo absoluto 15 s,
lease 10 s/renovación 3 s, despacho registrado sin repetición incierta y ACK
idempotente de presentación. DEC-006 incorpora solicitudes, feedback, contexto,
llamadas y eventos separados de `attempt_events`, claves compuestas y RLS, así
como citas de versiones históricas y supresión por toda fuente utilizada.
DEC-010 fija niveles concepto/pregunta/siguiente paso parcial, consulta 500 tokens,
contexto 5.000, entrada 8.000, salidas 2.048/512 y segunda llamada de verificación.
La calibración elige el menor umbral observado que maximiza cobertura sin
negativos y comprueba grupos reservados; no hay umbral sintético para Azure.
Se documentan límites reversibles y pruebas en el [registro de ayuda](../docs/work/IMP-04-help.md)
y su [diccionario](../docs/work/IMP-04-help-dictionary.md). La integración remota,
calibración medida, operación ACA, evaluación docente y aceptación CAPSTONE siguen
pendientes. Esta resolución amplía las concreciones por módulo de la tabla;
no cierra seguimiento docente ni los incrementos IMP-04.07–04.08.

**Resolución de planificación IMP-03.04–03.06, 26/09/2026.** Ante la pregunta
sobre envíos concurrentes al cierre, el usuario eligió «Guardar los admitidos
antes del cierre (recomendado)». DEC-002 queda resuelta para SUBMIT: la admisión
del servidor se serializa con el cierre; un envío admitido antes puede terminar
y persistirse después; nuevas admisiones posteriores se rechazan. Confirmar en
la interfaz no equivale a admisión ni a persistencia. Se conserva la ventana
vigente y la autorización actual para entregar, recuperar o consultar el
resultado. El [plan de envíos, historial y avance](../docs/work/IMP-03-submissions-plan.md)
concreta el corte local. El usuario autorizó posteriormente «implementa este
plan». DEC-004/006 se concretan para envíos en su
[diccionario](../docs/work/IMP-03-submissions-dictionary.md), contratos y migración
incremental: reserva privada, intento inmutable, evidencia canónica, eventos,
idempotencia de 24 horas con vínculo permanente y recuperación sin reejecución.
El [registro de implementación](../docs/work/IMP-03-submissions.md) distingue
resultados locales y pendientes. Las referencias a SUBMIT pendiente en los
cortes históricos siguientes describen su estado anterior a esta decisión.

**Resolución IMP-03.01–03.03, 26/09/2026.** El usuario autorizó RUN local integrado
y confirmó que una ejecución admitida antes del cierre puede terminar; nuevas
admisiones quedan bloqueadas, y responder exige acceso vigente. No resuelve la
carrera SUBMIT/cierre. DEC-003/007 incorporan QuickJS/WASM dentro de la cápsula
Docker, manteniendo JavaScript síncrono/JSON, límites y proveedores. DEC-004/006
incorporan reserva operativa, respuesta idempotente de 24 horas y recuperación sin
reejecución automática, sin persistir fuente ni crear intentos. El código y la
evidencia real se registran en [IMP-03](../docs/work/IMP-03-practice.md).
Los 3000 ms acumulados los mide el supervisor confiable externo al proceso
estudiantil, desde antes de lanzarlo; el arranque y transporte de Docker se
registran por separado. El plazo operativo es de 30 segundos más 10 de limpieza,
sin ampliar el presupuesto estudiantil. DEC-008 dispone de un perfil local de
50 muestras secuenciales y 50 con concurrencia cuatro; no acredita rendimiento
del despliegue híbrido ni resuelve sus regiones o planes.

**Resolución de implementación IMP-02, 23/09/2026.** El usuario confirmó el plan de contenido/editor: DEC-002 queda resuelta para DRAFT→PUBLISHED→CLOSED sin reapertura, ventana inclusiva al inicio/exclusiva al término, consulta histórica autorizada y archivo de banco que bloquea nuevas asignaciones sin alterar publicaciones. ADMIN archiva clases tras cerrar publicaciones; códigos colectivos duran hasta siete días y se revocan al archivar. Borradores locales duran treinta días desde última edición y sobreviven al cierre de sesión, separados por cuenta/organización/clase/asignación/versión. Sigue pendiente la carrera con SUBMIT real de IMP-03. DEC-004/006 se concretan para este corte en [API](07-api-y-contratos.md), OpenAPI y [diccionario revisado](../docs/work/IMP-02-dictionary.md): fechas civiles startDate/endDate, autorización académica transaccional, versiones inmutables, permisos por operación y auditoría. DEC-012 se concreta parcialmente con doce identidades, tres clases y diez ejercicios; seis documentos quedan para materiales. La [evidencia IMP-02](../docs/work/IMP-02-content.md) distingue implementación, pruebas locales y aceptación académica pendiente.

Evidencia de implementación del 10/09/2026: [fundación local](../docs/work/IMP-00-foundation.md), [CI/Cypress](../docs/work/IMP-00.05-ci-y-cypress.md) y [ensayos IMP-00.06–IMP-00.08](../docs/work/IMP-00.06-08-ensayos.md). El último registro acota DEC-003/004/006/007/008/009/010/012 con resultados y brechas por entorno. Para el ensayo, el usuario fijó 128 MiB = 134217728 bytes y 64 KiB = 65536 bytes; los 3000 ms son acumulados por ejecución. La evidencia local no modifica la autoridad de las fuentes, acredita aceptación humana ni convierte parámetros o RF completos en aprobados. Las integraciones remotas y decisiones de negocio pendientes conservan su estado.

## Referencias técnicas externas

Consulta de contraste: 10/09/2026. Solo precisan riesgos de implementación; no cambian el alcance ni acreditan pruebas del proyecto.

- [Guía oficial de migración NestJS](https://docs.nestjs.com/migration-guide): compatibilidad de Nest 12, ESM y mínimos del generador. Se conserva Jest de la ERS aunque los valores por defecto del generador difieran.
- [Versiones de Node.js](https://nodejs.org/en/about/previous-releases): referencia para fijar un patch soportado de la familia 24.
- [RLS de Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security): permisos, políticas y protección de vistas; [changelog](https://supabase.com/changelog) para revisar cambios antes de instalar.
- [Vercel Sandbox](https://vercel.com/docs/sandbox), [configuración 1 vCPU/2 GB](https://vercel.com/changelog/vercel-sandbox-now-supports-1-vcpu-2-gb-configurations) y [políticas de salida de red](https://vercel.com/changelog/advanced-egress-firewall-filtering-for-vercel-sandbox): referencia del entorno, sin sustituir pruebas de límites internos.

## Control de cambios y cobertura

Una modificación debe indicar fecha, autor real, motivo, fuente o decisión, estado, RF/HU/CU/PT/RNF afectados, impacto en datos/API/pruebas y efecto sobre horas, costos e hitos. Las propuestas aceptadas deben actualizar todos los contratos que dependan de ellas. Conservar identificadores originales y un registro de evidencia por versión.

La [matriz funcional](02-requisitos-funcionales.md), los [escenarios](03-flujos-y-criterios-de-aceptacion.md) y la [matriz de calidad](10-calidad-y-pruebas.md) son los puntos de comprobación de cobertura. La revisión de Markdown verifica coherencia documental; la aceptación del software requiere ejecutar las pruebas allí definidas.
