# Especificación de calidad y pruebas

## Propósito, estado y fuentes

Definir cómo demostrar que Alunza satisface sus 27 requisitos funcionales, 29 requisitos no funcionales, 6 requisitos organizacionales y la vertical comprometida. Este archivo es un **plan de verificación**: no acredita pruebas ejecutadas, software integrado, velocidad empírica ni cumplimiento de metas. Al corte documental del 02/09/2026 y revisión técnica del 04/09/2026 esos resultados permanecen **N/D**.

Fuentes: [ERS 1.3, apartados 3.2–3.4](../Evidencias%20CAPSTONE/Fase%201/Evidencias%20de%20proyecto/Informe_ERS_Alunza.docx), [historias: 27 HU y 108 escenarios](../Evidencias%20CAPSTONE/Fase%201/Evidencias%20de%20proyecto/Plantilla_Historias_Usuario_Alunza.xlsx), [Acta, requisitos de aprobación](../Evidencias%20CAPSTONE/Fase%201/Evidencias%20de%20proyecto/Acta_de_Constitucion_Alunza.docx), [avance](../Evidencias%20CAPSTONE/Fase%201/Evidencias%20de%20proyecto/Documento_Avance_Sprint_1_Alunza.docx) y [retrospectiva](../Evidencias%20CAPSTONE/Fase%201/Evidencias%20de%20proyecto/Resumen_Reunion_Retrospectiva_Alunza.docx).

Se deben consultar [decisiones pendientes](00-fuentes-y-decisiones.md), [requisitos funcionales](02-requisitos-funcionales.md), [criterios de aceptación](03-flujos-y-criterios-de-aceptacion.md), [UX](04-ux-y-accesibilidad.md), [datos](06-modelo-de-datos.md), [contratos](07-api-y-contratos.md), [IA/RAG](08-ia-y-procesamiento.md), [seguridad](09-seguridad-y-privacidad.md), [operación](11-operacion-y-despliegue.md), [ejecución controlada](13-ejecucion-controlada.md) y [progreso/señales](14-progreso-y-senales.md). Una diferencia entre artefactos se resuelve explícitamente antes de usarla como oráculo de prueba.

## Estrategia y responsabilidades

| Nivel | Qué demuestra | Instrumentación prevista | Responsable primario |
| --- | --- | --- | --- |
| Unidad | Validadores, transiciones, reglas, cálculo de progreso, normalización y límites de contratos. | Jest y datos deterministas; reloj controlado para reglas temporales. | Autor del componente; Abraham coordina calidad. |
| Contrato | Compatibilidad entre web/API, ejecutor, RAG y datos; rechazo de esquemas y catálogos inválidos. | Esquemas tipados/validados y pruebas con respuestas válidas, inválidas y parciales. | Marcelo y Abraham. |
| Integración | Persistencia, autorización NestJS, RLS real, Storage, consultas, ingestión y adaptadores. | Entorno local reproducible y ambiente híbrido para comportamiento de proveedores. | Marcelo y Abraham. |
| Extremo a extremo | Comportamiento observable completo de administrador, profesor y estudiante. | Cypress en GitHub Actions y evidencia de versión candidata. | Benjamin; revisión cruzada. |
| Seguridad y fallas | Aislamiento real entre organizaciones/clases, sandbox y degradación. | Pruebas negativas/adversariales en entornos autorizados, fallas controladas y registros correlacionados. | Marcelo y Abraham; revisión del equipo. |
| Accesibilidad y usabilidad | Operación de flujos críticos con teclado, lectura, mensajes y diseño responsivo. | Matriz manual más comprobaciones automatizables, sin sustituir la evaluación manual. | Benjamin. |
| Rendimiento y costos | Cumplimiento de p95 y límites bajo un perfil declarado; consumo atribuible. | Herramienta de carga por elegir; tiempos de cliente y servidor, métricas de proveedores y costos medidos. | Abraham y Marcelo. |

La selección técnica vigente mantiene Jest, Cypress y GitHub Actions. No existe una meta documental de porcentaje de cobertura de líneas; **propuesta:** priorizar cobertura de invariantes y escenarios de riesgo sobre introducir un porcentaje arbitrario. Todo componente crítico debe recibir revisión de otro integrante y el conjunto de evidencias debe mostrar participación de los tres.

El detalle de seguridad se ejecuta también contra los criterios `SEC-01` a `SEC-14` de [seguridad y privacidad](09-seguridad-y-privacidad.md): incluyen revocación efectiva con JWT previo, aislamiento de vistas/vectores/Storage, prompt injection, CSV seguro, invitaciones, restauración de permisos, CSRF/CORS/XSS y protección concurrente del último administrador. Esos controles desarrollan la verificación de RF/RNF y conservan su carácter propuesto cuando así lo indica el documento; no representan resultados ya aprobados.

## Datos, ambientes y oráculos

La demo canónica contiene **2 organizaciones, 2 administradores, 2 profesores, 8 estudiantes, 3 clases, 10 ejercicios JavaScript y 2 documentos por clase**: 12 perfiles y 6 documentos en total. Los datos son ficticios, versionados y reproducibles. Los ensayos negativos pueden crear fixtures adicionales aislados sin cambiar esos totales canónicos.

**Diseño de fixtures propuesto:** dos clases de una organización y una de la otra; cuentas activas y, en fixtures separados, invitadas/deshabilitadas; actividades borrador/publicadas/cerradas; archivos PDF textual, TXT, Markdown, inválidos y fuera de tamaño; intentos para cada diagnóstico; una secuencia para cada señal y otra que no alcance su umbral. El reparto concreto de miembros, cursos y ejercicios se fija con el seed en [operación](11-operacion-y-despliegue.md).

Los oráculos deben ser resultados esperados calculados desde fixtures independientes: pruebas deterministas para corrección técnica, consultas/reglas verificables para progreso y señales, pertenencias autorizadas para aislamiento y documentos identificados para referencias. No usar la respuesta del LLM como oráculo de corrección del ejercicio. No afirmar aislamiento productivo basándose solo en mocks o en el adaptador Docker local.

## Matriz funcional y aceptación

Cada `ALZ-PT-nnn` se vincula al `ALZ-RF-nnn`, `ALZ-HU-nnn` y `ALZ-CU-nnn` del mismo número. La hoja de historias aporta `ALZ-HU-nnn-E1` a `E4`: flujo autorizado, entrada inválida, permiso/aislamiento insuficiente y un caso particular. Se mantienen los **108 escenarios de origen**; las pruebas concretas pueden descomponerlos y añadir límites, concurrencia y fallas sin reemplazar sus identificadores. El estado inicial de todas las filas es **Planificado; ejecución N/D**.

| Protocolo / requisito | Comprobación principal y caso adverso | Evidencia mínima |
| --- | --- | --- |
| ALZ-PT-001 / ALZ-RF-001 | Acceso de `ACTIVE`, cierre de sesión, rechazo de credenciales inválidas, `INVITED` y `DISABLED`; denegación directa por rol/organización/clase. | Respuesta UI/API y prueba de que no se exponen datos ni se opera con sesión inválida. |
| ALZ-PT-002 / ALZ-RF-002 | Clase válida persistida; obligatorios; estudiante sin permiso; clase archivada sin cambios operativos. | Lectura posterior y estado previo intacto ante rechazo. |
| ALZ-PT-003 / ALZ-RF-003 | Código vigente inscribe una vez; inválido, vencido, repetido o concurrente no duplica membresía. | Conteo de membresías y respuesta controlada. |
| ALZ-PT-004 / ALZ-RF-004 | Guardar/recuperar ejercicio completo; rechazar pruebas incoherentes; proteger detalles ocultos. | Versión persistida, validaciones y payloads según actor. |
| ALZ-PT-005 / ALZ-RF-005 | Composición ordenada y transiciones permitidas `DRAFT`/`PUBLISHED`/`CLOSED`; registro de cambio; rechazo de transición inválida. | Estado servidor y visibilidad/envío coherentes, incluido intento directo a API. |
| ALZ-PT-006 / ALZ-RF-006 | Ingestión de fuente compatible y trazable; rechazo antes de indexar de formato no admitido, PDF sin texto o exceso de tamaño. | Metadatos, fragmentos e índice aislados; fallo visible. |
| ALZ-PT-007 / ALZ-RF-007 | Solo actividades autorizadas/publicadas en vista activa; estado vacío sin inventar progreso. | Comparación con fixtures de otras clases/estados; historial `CLOSED` sujeto a DEC-002. |
| ALZ-PT-008 / ALZ-RF-008 | Enunciado, conceptos, plantilla y pruebas visibles correctos; no revelar ocultas; explicar recurso no disponible. | Pantalla y payload sin material oculto o interno. |
| ALZ-PT-009 / ALZ-RF-009 | Ejecutar JavaScript aislado; verificar proceso 128 MB/3 s/64 KB y sandbox 1 vCPU/2 GB por separado; bloquear red/secretos/archivos ajenos. | Pruebas adversariales, resultado normalizado y evidencia de destrucción del sandbox. |
| ALZ-PT-010 / ALZ-RF-010 | Guardar intento y resultado antes de IA/RAG; falla transaccional no llama al proveedor; caída de IA conserva intento. | Orden de eventos/llamadas, lectura de intento y editor conservado ante error. |
| ALZ-PT-011 / ALZ-RF-011 | Seis diagnósticos exactos y reproducibles; condición no clasificable usa `UNKNOWN`. | Fixtures etiquetados y rechazo de categoría inventada. |
| ALZ-PT-012 / ALZ-RF-012 | Pistas progresivas sobre intento autorizado; no solución completa inmediata; sin fuente usa `NO_EVIDENCE`. | Nivel de ayuda, evidencia utilizada y ausencia de cita inventada. |
| ALZ-PT-013 / ALZ-RF-013 | Contrato de cinco campos, tres estados y fuente pertinente/autorizada; descartar salida incompleta sin bloquear intento. | Respuesta validada, referencia verificable y fallo controlado. |
| ALZ-PT-014 / ALZ-RF-014 | Reintento crea otro identificador y conserva historial; concurrencia mantiene identidad y orden verificable. | Intentos originales sin sobrescritura; distinguir reenvío de operación de un nuevo intento conforme al contrato. |
| ALZ-PT-015 / ALZ-RF-015 | Progreso = completados/requeridos por actividad/concepto; todas las pruebas requeridas determinan completitud. | Numerador/denominador trazables; sin división por cero ni nota inventada. |
| ALZ-PT-016 / ALZ-RF-016 | Agregados y filtros del panel coinciden con evidencia de la clase autorizada; clase sin eventos usa ceros/vacíos coherentes. | Consulta esperada independiente y estados UI. |
| ALZ-PT-017 / ALZ-RF-017 | Detalle coincide con intentos persistidos; estudiante fuera de clase u organización no revela datos ni existencia. | Resultados UI/API y prueba negativa de acceso por identificador. |
| ALZ-PT-018 / ALZ-RF-018 | Tres reglas exactas generan señal con causa, evidencia, fecha y versión; umbral no satisfecho no genera señal. | Fixtures de frontera temporal/conteo y comparación determinista. |
| ALZ-PT-019 / ALZ-RF-019 | `ACTIVE` pasa a `REVIEWED` con responsable y fecha; repetición conserva autor/fecha originales. | Historial y evidencia intactos, incluida repetición/concurrencia. |
| ALZ-PT-020 / ALZ-RF-020 | Crear/actualizar/archivar solo dentro del ámbito; validar unicidad; bloquear archivado con dependencias activas y eliminación física indebida. | Estado, auditoría y pruebas de ámbito según DEC-001. |
| ALZ-PT-021 / ALZ-RF-021 | Invitar/activar/deshabilitar/asignar rol; rechazo de correo duplicado, rol inválido y pérdida del último administrador activo. | Estado de cuenta, autorización efectiva y auditoría. |
| ALZ-PT-022 / ALZ-RF-022 | Códigos únicos, fechas coherentes y profesor activo de la organización; bloquear asignación cruzada. | Relaciones persistidas y ausencia de cambio ante rechazo. |
| ALZ-PT-023 / ALZ-RF-023 | Conceptos normalizados únicos, jerarquía sin ciclos y archivado conserva referencias históricas. | Restricciones, asociaciones e historial recuperable. |
| ALZ-PT-024 / ALZ-RF-024 | Nueva versión al editar publicación; referencia publicada conserva versión anterior; visibilidad no se amplía fuera de organización. | Versiones/usos, permisos y archivo sin pérdida de evidencia. |
| ALZ-PT-025 / ALZ-RF-025 | Visibilidad, indexación y reindexación autorizadas; recuperación nunca cruza organización/clase. | Fuente/fragmento/permiso y recuperación negativa con texto señuelo ajeno. |
| ALZ-PT-026 / ALZ-RF-026 | Validar parámetros/vigencia; crear/activar versión y conservar anterior; señales identifican regla aplicada. | Versiones, autor/fecha, auditoría y resultado previo sin reinterpretación silenciosa. |
| ALZ-PT-027 / ALZ-RF-027 | Filtros operativos y CSV dentro del ámbito; exportación auditable e íntegra. | Comparación con registros esperados y contenido sin secretos ni datos ajenos. |

Las ambigüedades no son resultados aprobados: por ejemplo, la expresión «límite excedido» de E4 de HU-009 no autoriza un séptimo diagnóstico. Se aplican los seis códigos de ERS y el detalle técnico acordado en [ejecución](13-ejecucion-controlada.md). Las decisiones pendientes deben quedar asociadas a cualquier caso bloqueado.

## Matriz de los 29 requisitos no funcionales

| ID | Ensayo / revisión | Criterio de aceptación de la línea base |
| --- | --- | --- |
| RNF-REN-01 | Medir pantallas principales; separar instrumentación de API según ALZ-PAR-003. | p95 de pantallas <3 s en demo; perfil y concurrencia declarados. La línea base también fija interfaz/API <3 s. |
| RNF-REN-02 | Ejecución completa incluyendo creación/cierre de sandbox, proceso, persistencia y respuesta. | Proceso máximo 3 s; p95 completo <5 s en demo. |
| RNF-REN-03 | Feedback IA con proveedor, corpus, timeout y muestra registrados. | p95 <12 s; objetivo aún no demostrado. |
| RNF-REN-04 | Demoras y fallas simuladas de ejecución, RAG y LLM. | Carga visible termina en éxito, error controlado o tiempo excedido. |
| RNF-SEG-01 | JWT inválido/vencido y acceso directo por rol, organización, clase y recurso; RLS/Storage. | Toda operación protegida valida autorización real en servidor; ningún acceso cruzado. |
| RNF-SEG-02 | Entradas, archivos y salidas IA inválidas/incompletas. | Rechazo antes de usar o persistir datos incompatibles. |
| RNF-SEG-03 | Revisar repositorio, historial relevante, compilados, previews y configuración. | Secretos por variables/gestor de entorno; no incluidos en repositorio ni cliente. |
| RNF-SEG-04 | Pruebas adversariales de sandbox y aislamiento RLS; memoria, tiempo, salida, red y filesystem. | Entorno desechable 1 vCPU/2 GB; proceso 128 MB/3 s/64 KB; sin secretos/archivos/red no autorizados. |
| RNF-SEG-05 | Inspección de errores, logs, respuestas y navegación cruzada. | Sin secretos, trazas sensibles ni datos de otra organización/clase. |
| RNF-USA-01 | Escritorio, tableta y móvil según matriz registrada. | Navegación y lectura esenciales responsivas; editor optimizado para escritorio. |
| RNF-USA-02 | Checklist WCAG 2.2 AA aplicable a los tres roles y flujos críticos. | Teclado, foco, etiquetas, contraste, estructura y mensajes conformes; revisión manual además de automatización. |
| RNF-USA-03 | Revisar gráficos, pruebas, señales, estados y validaciones sin depender del color. | Texto o equivalente accesible comunica cada estado/resultado. |
| RNF-USA-04 | Provocar errores de acceso, publicación, archivos, ejecución, envío e IA. | Mensaje explica qué ocurrió y una acción válida para el usuario. |
| RNF-CON-01 | Inyectar falla de persistencia y observar proveedor/cliente. | Ninguna llamada IA/RAG, ningún envío confirmado y código editable conservado. |
| RNF-CON-02 | Modelo devuelve salida malformada o intenta cambiar resultado/progreso/señal. | Invariantes de datos, progreso y señales intactos; salida inválida descartada. |
| RNF-CON-03 | Caída, demora o ausencia de evidencia RAG/IA. | Flujo técnico continúa y admite reintento posterior de ayuda con estado seguro. |
| RNF-CON-04 | Publicar–ejecutar–enviar–registrar–seguir. | Pruebas de integración automatizadas en CI y evidencia en candidato. |
| RNF-POR-01 | Arranque local desde entorno limpio y despliegue híbrido siguiendo documentación. | Docker Compose, Supabase CLI/adaptador local y configuración Vercel/Supabase/Azure/Sandbox reproducibles sin secretos expuestos. |
| RNF-POR-02 | Recrear demo con comandos documentados. | Datos ficticios canónicos y guion repetible, sin correcciones manuales ocultas. |
| RNF-POR-03 | Inspeccionar salud y correlación durante inicio, operación y falla. | Identificador por intento, duración, región, consumo, truncamiento, errores y estado de proveedores disponibles. |
| RNF-MAN-01 | Revisión de módulos y dependencias. | Dominio, infraestructura, ejecución e IA separados; sin acoplamiento circular crítico. |
| RNF-MAN-02 | Pruebas de contratos web/API, ejecutor y modelo. | Esquemas/tipos y rechazo de incompatibles. |
| RNF-MAN-03 | Inspección de CI y revisiones. | Formato, lint, pruebas y revisión de cambios relevantes por otro integrante. |
| RNF-MAN-04 | Revisión del registro de decisiones. | Motivos/consecuencias actualizados para arquitectura, ejecución, RAG, proveedor y despliegue. |
| RNF-IA-01 | Inyectar texto que contradice pruebas técnicas. | Prevalece resultado determinista y no se altera la completitud. |
| RNF-IA-02 | Probar cinco campos, seis diagnósticos, tres estados, extras y valores inválidos. | Contrato estricto sin puntaje numérico; salida inválida rechazada. |
| RNF-IA-03 | Ingestión, fragmentación y recuperación de fuentes autorizadas. | PDF textual/TXT/Markdown hasta 10 MB; 500 tokens/50 de solapamiento; top-k=5; filtros y fuente visible. |
| RNF-IA-04 | Corpus sin sustento, ambiguo o solo con material ajeno. | `NO_EVIDENCE`; sin cita ni conclusión documental inventada. |
| RNF-IA-05 | Revisar cálculo e interfaz de progreso y señales. | Regla/evidencia visibles y decisión pedagógica humana; sin sanción o calificación automática. |

## Trazabilidad de requisitos organizacionales

La ERS §3.4 contiene además seis requisitos organizacionales. Su evidencia operativa debe verificarse en los hitos; esta matriz conserva sus identificadores y no declara resultados.

| ID | Obligación documentada | Evidencia de aceptación |
| --- | --- | --- |
| ORG-001 | Repositorio compartido sin secretos ni datos personales reales. | Acceso del equipo, revisión de historial/configuración y fixtures ficticios. |
| ORG-002 | Los tres integrantes aportan código, pruebas, documentación y revisión técnica. | Relación de tareas, commits, revisiones y resultados por integrante; cantidad de commits aislada no demuestra contribución suficiente. |
| ORG-003 | Mantener alineados ERS, historias, casos, Roadmap, arquitectura y pruebas. | Revisión de consistencia por hito, decisiones registradas y enlaces requisito–evidencia actualizados. |
| ORG-004 | Scrum ligero y congelamiento de funciones en semana 15. | Backlog/revisiones, control de cambios y resolución explícita de DEC-011 sobre freeze/S7. |
| ORG-005 | Demo canónica ficticia y reproducible. | Recrear 2 organizaciones, 2 administradores, 2 profesores, 8 estudiantes, 3 clases, 10 ejercicios y 2 documentos por clase; probar aislamiento entre organizaciones. |
| ORG-006 | Decisiones pedagógicas o de alto impacto permanecen bajo responsabilidad humana. | Interfaz, contratos, reglas y guion sin sanción ni calificación automática por IA. |

## Ensayos de la vertical y resistencia a fallas

**E2E-01, vertical técnica:** administrador prepara acceso; profesor publica; estudiante abre, ejecuta una solución con fallo conocido, envía, consulta el intento y reintenta con solución correcta; el profesor ve los datos del mismo intento. Validar que el resultado de ejecutar en el editor no equivale automáticamente a un envío confirmado.

**E2E-02, vertical con fuente:** incorporar documento oficial, indexar, enviar un intento, obtener ayuda `SUPPORTED`, abrir la referencia autorizada y aplicar una pista; el profesor conserva la decisión de intervención. La fuente no modifica el resultado técnico.

**E2E-03, degradación:** repetir el flujo sin documento pertinente y con proveedor indisponible; esperar respectivamente `NO_EVIDENCE` y `PROVIDER_UNAVAILABLE`. Reintentar ayuda no crea una nueva solución ni borra evidencia. Simular salida malformada, timeout y respuesta que contradice pruebas; verificar el rechazo controlado definido en contratos.

**E2E-04, aislamiento:** desde cada rol de organización A intentar leer/modificar recursos, fuentes, Storage, intentos, señales y CSV de B; repetir entre clases no autorizadas dentro de A. Las pruebas se realizan también directamente sobre API y vías expuestas de datos/Storage, sin depender de ocultar botones.

**E2E-05, reglas y revisión:** con reloj controlado construir inactividad de 7 días, mismo error técnico en 3 intentos consecutivos dentro de 14 días y 3 intentos del ejercicio sin aumentar casos visibles superados. Probar valores inmediatamente antes/en/después del umbral, cambio de regla, duplicados de eventos y revisión repetida. El detalle de ventana, orden y deduplicación sigue [progreso/señales](14-progreso-y-senales.md).

**E2E-06, actividad y edición concurrentes:** cambiar estado a `CLOSED` antes de un nuevo envío, publicar una versión y editar su ejercicio fuente, repetir una solicitud de envío y enviar otra solución legítima. Deben respetarse permisos y versiones, sin historial sobrescrito ni incremento duplicado de progreso. La semántica exacta de concurrencia se prueba contra [API](07-api-y-contratos.md), sin inferirla desde la interfaz.

## Protocolo de rendimiento y costo

Los p95 son objetivos de demostración y no promesas de producción. Antes de medir, Abraham/Marcelo registran versión, región de cada servicio, plan/cuota, cliente/red, tamaño de corpus, fixtures, estado de caché, concurrencia, mezcla de operaciones, cantidad de muestras y timeouts. Esos valores permanecen **pendientes**; una medición sin perfil no verifica RNF-REN.

**Propuesta de método:** separar arranque frío de ejecución caliente, medir cada recorrido con reloj monotónico, conservar muestras crudas y calcular p95 por operación sobre un método declarado. Reportar además cantidad/porcentaje de errores, timeouts y muestras excluidas con motivo; no reducir artificialmente el p95 descartando fallas. Medir desde la acción hasta contenido utilizable para pantalla, desde la solicitud hasta respuesta completa para ejecución y desde petición de ayuda hasta resultado visible para IA. La descomposición por etapas explica latencia sin sustituir la medición completa.

Registrar creación/cierre del sandbox, tiempo del proceso, persistencia y respuesta; distinguir 2 GB del entorno de 128 MB del proceso. La prueba local no verifica por sí sola región, costo o latencia del sandbox productivo. Si se incumple un límite, registrar defecto/decisión, ajustar el volumen autorizado o corregir implementación y repetir la prueba afectada. No cambiar silenciosamente AD-ARQ-001 o la meta de ERS.

Costo: registrar proveedor, unidad facturada, consumo, finalidad, gasto real y conversión monetaria real. La línea base es **CLP 265.000 de costos directos**; los límites por operación/proveedor y alertas deben definirse antes de pruebas pagadas o integración IA. Los precios opcionales históricos no son una cotización actual. No se ejecutan pruebas de carga sin presupuesto, cuotas y ambiente autorizado definidos.

## Evaluación IA/RAG y validación con usuarios

El corpus de prueba debe incluir casos con fuente pertinente, sin fuente, fuente revocada o fuera de ámbito, referencias incorrectas, texto con instrucciones maliciosas y resultados técnicos contradictorios. Para cada caso registrar ejercicio, intento, evidencia técnica, documentos/fragmentos autorizados, resultado esperado y versión de prompt/modelo/configuración. Verificar citas contra los documentos originales y evitar pruebas que dependan de que el LLM repita una frase exacta.

**Propuesta de revisión humana:** valorar pertinencia de la ayuda, fidelidad a la fuente, explicación comprensible y progresión de pista sin entregar inmediatamente la solución. Rúbrica, tamaño del conjunto y umbral agregado de calidad pedagógica están pendientes antes de S5. No hay en las fuentes un porcentaje de precisión de IA, mejora de aprendizaje o ahorro docente ya medido o comprometido.

**Propuesta de validación UX:** estudiantes intentan incorporarse, resolver, enviar, comprender un fallo y usar una pista; profesores publican y explican una señal; administradores resuelven una validación de acceso. Registrar tareas completadas, errores de navegación, ayudas necesarias y problemas de comprensión con datos ficticios. La muestra y umbral de aceptación se acuerdan con el equipo/docente guía; un ensayo interno de mockup no se presenta como estudio con usuarios.

## Indicadores y lectura correcta

| Indicador | Meta / criterio | Contexto y estado inicial |
| --- | --- | --- |
| Cobertura de trazabilidad | 27 RF/HU/CU/PT relacionados; 108 escenarios E1–E4 preservados. | Cobertura documental existente; pruebas implementadas/ejecutadas/aprobadas N/D. |
| Aceptación funcional | Cumplir criterios aplicables de los 27 RF Must; documentar bloqueos y defectos. | No equivale a 27 tareas iniciadas ni a cantidad de commits. |
| Latencia | Pantallas/API p95 <3 s; ejecución completa <5 s; IA <12 s; proceso ≤3 s. | Perfil/muestra declarados; resultado N/D. |
| Seguridad del núcleo | Sin acceso cruzado; aislamiento y límites verificados; sin secretos expuestos. | Resultado N/D; un solo acceso indebido invalida el control afectado. |
| Defectos críticos de aceptación | Sin errores conocidos de severidad alta en la ruta crítica. | Exigido por Acta; inventario/evaluación de defectos N/D. |
| Reproducibilidad | Arranque y demo canónica desde instrucciones/versiones declaradas. | Resultado N/D; no sustituir por captura de una máquina preparada manualmente. |
| Accesibilidad | WCAG 2.2 AA en funciones principales. | Matriz y revisión pendientes; análisis automático aislado no prueba conformidad. |
| Consumo | Mantener gasto directo dentro de CLP 265.000 y límites previamente definidos. | Gasto efectivo no acreditado por el presupuesto referencial. |
| Progreso del proyecto | Historias aceptadas, horas reales y velocidad con evidencia. | 184 puntos planificados; horas reales/velocidad global N/D. Los ceros de S2 son entradas iniciales de planificación. |
| Impacto pedagógico / utilidad | Validar hipótesis de comprensión y apoyo docente. | Sin meta porcentual ni resultado acreditado; estudio y rúbrica propuestos. |

## Registro de evidencia y cierre

**Plantilla propuesta por ejecución:** ID de protocolo/escenario y requisitos; fecha; responsable/revisor; versión o commit; ambiente; datos/seed; precondiciones; pasos/entrada; resultado esperado; resultado observado; estado; adjuntos; defecto o decisión relacionada. Estados propuestos: No ejecutado, Aprobado, Fallido, Bloqueado y No aplicable justificado. Un escenario bloqueado o no ejecutado nunca cuenta como aprobado.

Los reportes deben guardar resultados de CI, pruebas, métricas crudas y evidencias de fallas sin secretos ni datos personales reales. Las capturas complementan las comprobaciones; no sustituyen prueba de persistencia, aislamiento o orden de llamadas.

**Clasificación de defectos propuesta:** alta cuando hay acceso cruzado, pérdida/corrupción de intentos, ejecución insegura, resultado técnico alterado por IA o bloqueo de la vertical; media cuando una función comprometida falla con alternativa segura; baja cuando afecta presentación sin impedir el flujo. El equipo confirma la severidad con impacto observable; seguridad/pérdida de datos no se rebajan para liberar una versión.

Para cerrar un incremento se exige revisión cruzada, pruebas pertinentes aprobadas, documentación actualizada y evidencia del comportamiento integrado. Para la entrega MVP se añaden la demo canónica, los tres roles, las tres señales, RAG con fuente y degradación, aislamiento, límites, accesibilidad, reproducibilidad y criterios del Acta. Las [puertas de entrega](12-plan-de-entrega.md) deciden aceptación con esos resultados, no con fechas cumplidas o porcentajes visuales.
