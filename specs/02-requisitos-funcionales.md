# Especificación de requisitos funcionales

**Proyecto:** Alunza — Tutor Universitario Inteligente para Programación I.  
**Base:** ERS 1.3, corte 02/09/2026 y revisión técnica 04/09/2026.  
**Estado de este archivo:** especificación documental; no acredita implementación ni pruebas ejecutadas.

## 1. Autoridad y uso

Este documento organiza los 27 requisitos funcionales del MVP sin cambiar sus identificadores. Todos son **Debe (Must)** según la ERS. La prioridad Crítica/Alta del backlog ordena la entrega; no convierte historias de prioridad Alta en opcionales.

Se utilizan las etiquetas siguientes:

- **Documentado:** obligación o regla sustentada en las fuentes originales.
- **Propuesta técnica:** precisión necesaria para construir o verificar el producto, todavía sin aprobación acreditada.
- **Pendiente:** decisión que las fuentes no cierran; no se interpreta como funcionalidad implementada.
- **Decisión resuelta para IMP-01:** precisión confirmada por el usuario durante este incremento, registrada en DEC-001; no equivale a prueba ejecutada ni aceptación académica.

La [ERS, secciones 1.2, 3.1, 3.2 y 5.2](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/Informe_ERS_Alunza.docx>) es la fuente principal. Los [casos de uso, secciones 1.1 y 2](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/Documento_Casos_de_Uso_Extendidos_Alunza.docx>), las [historias, hojas Historias y Escenarios](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/Plantilla_Historias_Usuario_Alunza.xlsx>) y el [Product Backlog](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/Product_Backlog_Alunza.xlsx>) completan los detalles. Las diferencias se registran en [fuentes y decisiones](00-fuentes-y-decisiones.md).

Los criterios concretos de prueba están en [flujos y aceptación](03-flujos-y-criterios-de-aceptacion.md). Los contratos técnicos, campos persistidos y controles se desarrollan en [API](07-api-y-contratos.md), [datos](06-modelo-de-datos.md), [IA](08-ia-y-procesamiento.md) y [seguridad](09-seguridad-y-privacidad.md).

## 2. Alcance y actores

**Documentado.** La plataforma web B2B cubre Programación I con JavaScript. El flujo central une configuración institucional, publicación, resolución, ejecución, envío, registro, diagnóstico, ayuda pedagógica, reintento, progreso y seguimiento docente. La demostración utiliza 2 organizaciones, 2 administradores, 2 profesores, 8 estudiantes, 3 clases, 10 ejercicios y 2 documentos por clase, con datos ficticios reproducibles.

Los actores funcionales son administrador de organización, profesor y estudiante. El ejecutor controlado y el servicio IA/RAG son colaboradores técnicos; no tienen facultad para decidir una calificación o intervención docente. El evaluador CAPSTONE y el equipo técnico son partes interesadas, sin agregar perfiles de acceso al producto.

**Documentado.** Quedan fuera del MVP: perfiles de apoderado, LMS completo, aplicaciones móviles nativas, SSO, pagos, detección automática de plagio o uso de IA, calificación automática de alto impacto y arquitecturas multiagente. La indexación se limita a material autorizado; el PDF sin texto extraíble se rechaza, sin OCR. Más idiomas de programación, integraciones LMS y administración institucional avanzada requieren una ampliación posterior de alcance.

## 3. Permisos funcionales

**Documentado.** Toda operación protegida valida identidad, estado ACTIVE, rol, organización y pertenencia a clase cuando corresponde. No basta con ocultar opciones en la interfaz: la API debe aplicar el control al recurso solicitado. El profesor accede a las clases autorizadas; el estudiante solo a sus clases y a su propia evidencia. El administrador opera dentro de su ámbito institucional autorizado.

| Operación | Administrador | Profesor | Estudiante |
| --- | --- | --- | --- |
| Iniciar/cerrar sesión | Propia cuenta | Propia cuenta | Propia cuenta |
| Organizaciones, usuarios y roles | Gobierno autorizado | Sin función asignada | Sin función asignada |
| Crear/configurar clase | Gobierno de cursos/clases y asignación | Clases autorizadas | Sin función asignada |
| Incorporarse con código | Sin función asignada | Sin función asignada | Su propia membresía |
| Crear/editar ejercicios | Gobierno del banco | Ejercicios autorizados | Sin función asignada |
| Propiedad, versiones, visibilidad y archivado del banco | Gobierno autorizado | Se respetan políticas del banco | Sin función asignada |
| Componer/publicar/cerrar actividad | Sin función docente asignada por este rol | Clases autorizadas | Sin función asignada |
| Cargar material oficial | Gobierno de fuentes | Clases autorizadas | Sin función asignada |
| Resolver, ejecutar, enviar y reintentar | Sin función estudiantil asignada | Sin función estudiantil asignada | Actividad publicada y propia solución |
| Pistas, retroalimentación y progreso personal | Sin función estudiantil asignada | Sin función estudiantil asignada | Intentos propios autorizados |
| Tablero, detalle de estudiante y revisión de señales | Sin función docente asignada por este rol | Clases autorizadas | Sin acceso a evidencia ajena |
| Taxonomía, reglas y auditoría operativa | Gobierno autorizado | Sin función asignada | Sin función asignada |

**Decisión resuelta para IMP-01 — DEC-001.** Cada membresía institucional tiene un único rol: `ADMIN`, `TEACHER` o `STUDENT`. Una identidad puede pertenecer a varias organizaciones y tener un rol distinto en cada una. La ausencia de función asignada implica denegación por defecto. Un rol administrativo no concede acceso al código, pistas o detalle pedagógico de todos los estudiantes ni combina facultades docentes o estudiantiles dentro de la misma organización.

**Decisión resuelta para IMP-01 — DEC-001.** Un operador técnico concede explícitamente a una identidad ACTIVE un permiso consumible para crear una organización. No exige administración previa de otra organización. Crear la organización consume ese permiso y asigna al creador como primer ADMIN en una misma transacción; el permiso no concede lectura ni gobierno de organizaciones existentes. El operador técnico no constituye un nuevo rol global del producto.

**Decisión resuelta para IMP-01 — DEC-001.** La identidad y el correo son globales; el rol y el estado de membresía son locales a cada organización. Deshabilitar una membresía retira sus permisos en esa organización sin deshabilitar Auth ni afectar pertenencias activas en otras. Una cuenta global DISABLED no opera en ninguna organización. Resolver la propia identidad ACTIVE no exige una membresía operativa: un inicio sin organizaciones no concede permisos institucionales.

## 4. Catálogos contractuales

**Documentado.** Los siguientes valores son cerrados y deben conservarse en todos los contratos:

| Concepto | Valores exactos | Uso |
| --- | --- | --- |
| Diagnóstico técnico | SUCCESS, SYNTAX_ERROR, RUNTIME_ERROR, FAILED_TEST, TIMEOUT, UNKNOWN | Exactamente un resultado normalizado del ejecutor; determina la evidencia técnica. |
| Estado RAG | SUPPORTED, NO_EVIDENCE, PROVIDER_UNAVAILABLE | Separa evidencia documental suficiente, ausencia de sustento e indisponibilidad/falla de generación. |
| Tipo de señal | INACTIVITY, REPEATED_ERROR, STAGNATION | Tres reglas deterministas del MVP. |
| Estado de señal | ACTIVE, REVIEWED | La revisión conserva la evidencia y el responsable. |
| Estado de actividad | DRAFT, PUBLISHED, CLOSED | La publicación habilita resolución y envíos; el cierre impide nuevos envíos. |
| Estado de usuario | INVITED, ACTIVE, DISABLED | Solo ACTIVE opera dentro de sus permisos. |

En IMP-01, el estado global de cuenta y el estado local de membresía conservan ese catálogo y se comprueban por separado. Antes de aceptar una invitación nueva, INVITED describe la invitación pendiente; no presupone que exista ya un perfil o una membresía. Los estados de invitación y entrega del [contrato API](07-api-y-contratos.md) describen ese proceso y no amplían el catálogo de usuario.

La salida RAG contiene exactamente los campos contractuales **diagnosis_code, explanation, hint, source_refs y status**. Todos deben validarse antes de mostrarse o persistirse. No incorpora puntaje numérico. UNKNOWN describe insuficiencia de evidencia técnica; NO_EVIDENCE describe insuficiencia de material documental. No son intercambiables.

**Propuesta técnica.** «Límite excedido», «envío inválido» y «señal no verificable», presentes como descripciones en documentos auxiliares, no crean nuevos valores de los catálogos. Se representan mediante motivos de error o indicadores de disponibilidad separados. El mapeo de diagnósticos se detalla en [ejecución controlada](13-ejecucion-controlada.md); los estados pedagógicos, en [IA y procesamiento](08-ia-y-procesamiento.md).

## 5. Reglas de negocio comunes

### 5.1 Publicación, cierre y conservación

**Documentado.** Una actividad contiene ejercicios ordenados, tipo diagnóstico o formativo, fechas y un estado. No se publica sin ejercicios válidos ni con fechas inconsistentes. La ERS establece que solo PUBLISHED es visible y admite envíos. Los casos ALZ-CU-007 y ALZ-CU-014 permiten revisar resultados e historial previo después del cierre. Las versiones de ejercicios ya utilizadas no se reescriben al editar una publicación.

**Propuesta técnica — DEC-002.** Interpretar «visible» como disponibilidad en el catálogo para resolver; las actividades CLOSED dejan de aceptar resolución y envíos, pero permiten consultar resultados históricos propios con autorización. Esta reconciliación debe confirmarse en [fuentes y decisiones](00-fuentes-y-decisiones.md).

**Propuesta técnica — DEC-002.** La secuencia inicial de trabajo será DRAFT → PUBLISHED → CLOSED. No se habilitan retornos o reapertura mientras su semántica no se defina. Después de la confirmación del estudiante en la interfaz, el servidor verifica el estado y admite transaccionalmente el envío solo mientras la actividad esté PUBLISHED. Un envío admitido antes del cierre puede terminar su ejecución y persistirse después; una solicitud que llega a admisión después del cierre se rechaza. La admisión no confirma al estudiante que el intento ya quedó guardado: esa confirmación requiere persistencia exitosa. Esta resolución de la carrera cierre–envío es una propuesta pendiente de ratificación, coherente con el contrato de arquitectura y API.

### 5.2 Ejecución, envío y reintento

**Documentado.** «Ejecutar» comprueba código y presenta un resultado técnico temporal. «Enviar» registra un intento y evidencia persistente. El intento contiene código, fecha, eventos y resultado técnico. Los reintentos crean registros nuevos; nunca sustituyen los anteriores. Cada ejecución usa aislamiento y límites. El estudiante no obtiene detalles de pruebas ocultas por interfaz, API, errores o retroalimentación.

**Documentado.** La persistencia del intento debe completarse antes de solicitar retroalimentación a IA/RAG. Si falla, el sistema no confirma el envío, no invoca IA/RAG y conserva el contenido editable. Una falla posterior de IA conserva el intento y el resultado técnico. El progreso se obtiene sin depender del LLM.

**Propuesta técnica.** Los reenvíos de una misma solicitud por problemas de red se distinguen de un reintento intencional mediante el mecanismo de idempotencia del [contrato API](07-api-y-contratos.md). Los envíos intencionales diferentes conservan identificadores distintos, incluso si ocurren en paralelo. No se recalifica el intento anterior mediante la nueva versión de un ejercicio.

### 5.3 Progreso

**Documentado.** Para una actividad o concepto, progreso = ejercicios completados / ejercicios requeridos. Un ejercicio queda completado cuando algún intento supera todas sus verificaciones deterministas requeridas. Un reintento fallido posterior no borra que existió un intento que cumplió dichas verificaciones. Para un concepto, se consideran los ejercicios requeridos etiquetados con él. La vista conserva numerador, denominador y acceso a evidencia de intentos.

**Documentado.** Cuando no existen ejercicios requeridos, el resultado es no calculable/sin evidencia, sin división por cero ni porcentaje inventado. Cuando existe un conjunto requerido pero no se registran intentos, la interfaz informa ausencia de intentos y evita inferencias pedagógicas. El progreso nunca se presenta como nota oficial.

**Propuesta técnica.** Si el denominador es positivo y no hay ejercicios completados, se muestra 0/D junto al estado descriptivo «sin intentos» cuando corresponda. Contar ejercicios distintos, no cantidad de envíos ni pruebas individuales. La pertenencia a un concepto y las verificaciones se fijan a la versión usada por la actividad para permitir reproducción histórica.

### 5.4 Señales y revisión humana

**Documentado.** El tablero y las señales se calculan de manera determinista desde intentos y eventos autorizados. La IA/RAG no calcula progreso, señales, calificaciones o decisiones de intervención.

| Tipo | Regla documentada | Evidencia mínima |
| --- | --- | --- |
| INACTIVITY | Siete días consecutivos sin eventos, después de la inscripción y antes del cierre de la actividad. | Inscripción, último evento o ausencia de eventos, período evaluado y estado de actividad. |
| REPEATED_ERROR | Mismo error técnico en tres intentos consecutivos dentro de 14 días. | Tres intentos ordenados, error técnico, fechas y ventana utilizada. |
| STAGNATION | Tres intentos del mismo ejercicio sin aumentar el número de pruebas visibles superadas. | Ejercicio, tres intentos y cantidad de pruebas visibles superadas en cada uno. |

Cada señal conserva tipo, causa, evidencia, fecha y versión de regla. La revisión cambia ACTIVE a REVIEWED, registra responsable y fecha, no elimina evidencia y es idempotente: repetirla conserva el responsable y la fecha originales. Si el profesor perdió acceso, el cambio se rechaza; si existe concurrencia, se recupera el estado vigente.

**Pendiente.** Precisar qué eventos interrumpen inactividad, la zona horaria y los límites de las ventanas, si «mismo error» se identifica por diagnóstico u otra firma, el ámbito de la secuencia de error repetido, cómo se deduplican señales y cuándo se recalculan. Las reglas propuestas deben preservar estos umbrales de línea base hasta registrar un cambio. «No verificable» es una condición de evidencia, no un tercer estado contractual.

### 5.5 Material y ayuda pedagógica

**Documentado.** Las fuentes admitidas son PDF con texto, TXT y Markdown de hasta 10 MB por archivo. La ingesta extrae, limpia, fragmenta, genera embeddings e indexa con organización, curso, clase, fuente y asociación a actividad cuando corresponda. Utiliza fragmentos de 500 tokens, solapamiento 50 y recuperación top-k=5, filtrada por permisos. No se publican fragmentos parciales de una ingesta fallida.

**Documentado.** Una pista requiere un intento registrado, aumenta gradualmente la ayuda y registra un evento de aprendizaje. No entrega la solución completa de inmediato. La retroalimentación parte del diagnóstico determinista y fuentes autorizadas; muestra documento y página o sección cuando estén disponibles. Sin contexto pertinente devuelve NO_EVIDENCE y source_refs vacío. Ante salida inválida o timeout de generación, ALZ-CU-013 establece PROVIDER_UNAVAILABLE y descarte de la respuesta. La explicación técnica sigue disponible.

**Pendiente.** Definir número y contenido pedagógico de niveles de pista, límite de solicitudes, política de reutilización y tratamiento de solicitudes simultáneas. La sugerencia de «ejecutar o enviar primero» de ALZ-CU-012 debe concretarse como envío con intento persistido para solicitar ayuda ligada a un intento; la ejecución temporal por sí sola no satisface esa precondición.

### 5.6 Gobierno y archivado

**Documentado.** Los cambios administrativos conservan actor, fecha, acción, entidad e historial. No se permiten correos duplicados dentro de la organización según ALZ-CU-021; códigos de cursos/clases duplicados dentro de la organización; conceptos con nombre normalizado duplicado; relaciones cíclicas entre conceptos; asignaciones docentes a otra organización o a usuarios DISABLED; ni deshabilitar/quitar el rol al último administrador ACTIVE.

**Documentado.** Las organizaciones con dependencias activas no se archivan; con dependencias no se eliminan físicamente. El archivado de ejercicios o conceptos conserva referencias históricas y requiere tratar los usos vigentes. Editar un ejercicio publicado crea una versión nueva. Los cambios de visibilidad no cruzan organizaciones. Las reglas activas no se sobrescriben: se crea otra versión y se conserva la vigencia de las anteriores.

**Decisión resuelta para IMP-01 — DEC-001.** El ADMIN que ejecuta el archivo es la única membresía ACTIVE exceptuada del bloqueo: no debe haber otros miembros activos, invitaciones pendientes ni entregas pendientes que puedan activarlas. El archivo conserva esa membresía ADMIN para consulta administrativa de la organización archivada, sin escrituras ni acceso pedagógico adicional. Las referencias permanecen; las clases, documentos y demás dependencias que incorporen fases posteriores deben extender y verificar este bloqueo. Los cambios de rol o estado siguen sin poder retirar la última administración activa.

**Decisión resuelta para IMP-01.** Las invitaciones institucionales duran 72 horas. Un reenvío explícito invalida el enlace anterior y reinicia ese plazo; renovar el desafío de Auth dentro de una invitación vigente no amplía su vencimiento. La aceptación verifica identidad y correo del destinatario, vigencia y autorización institucional antes de crear o activar la membresía. Una identidad existente puede aceptar una invitación de otra organización sin duplicar su cuenta. Repetir una aceptación no duplica la relación ni reactiva una membresía deshabilitada posteriormente.

**Documentado.** La auditoría operativa se consulta por fecha, actor, acción y entidad, con paginación, limitada a la organización. La exportación genera CSV UTF-8 de la vista filtrada y registra la descarga. Incluye actor, fecha, acción, entidad, identificador y resultado; un resultado vacío genera encabezados, alcance y sello temporal, sin filas ficticias. Si supera el límite permitido, solicita reducir filtros.

**Concreción técnica de IMP-01.** El código de organización se recorta y normaliza a mayúsculas, con unicidad global; el correo se recorta y normaliza a minúsculas para identidad e invitaciones. Los límites exactos están en el [contrato API](07-api-y-contratos.md). Se mantiene una sola membresía por identidad y organización y una invitación pendiente por organización y correo.

**Pendiente.** Precisar normalización de los demás catálogos, límite de CSV, campos restringidos, estados de entidades no enumeradas y política de archivado de recursos académicos con uso vigente. Ninguna ambigüedad autoriza eliminación de historia.

## 6. Catálogo de requisitos

Todas las filas de esta sección son **Documentado**. Los detalles propuestos en las secciones anteriores conservan su etiqueta y no se incorporan implícitamente a la línea base.

### 6.1 Acceso y clase

| ID | Actor y obligación | Resultado y controles |
| --- | --- | --- |
| ALZ-RF-001 | Administrador, profesor y estudiante: autenticarse y operar según rol, estado, organización y clase. ALZ-HU-001 incluye iniciar y cerrar sesión segura. | Cuenta ACTIVE puede acceder dentro de sus permisos; INVITED, DISABLED y credenciales inválidas se rechazan sin datos sensibles. Cierre de sesión termina el uso autorizado de esa sesión. |
| ALZ-RF-002 | Profesor: crear y actualizar una clase con datos básicos y mecanismo de incorporación. | Persiste nombre, curso, profesor, estado y código de ingreso; valida obligatorios y organización. Niega creación/modificación a estudiante o profesor sin permiso. Una clase archivada conserva historia e impide cambios operativos. |
| ALZ-RF-003 | Estudiante: incorporarse a clase mediante código o invitación válida. | Valida vigencia y clase, registra una membresía, agrega la clase al inicio. Código inválido/vencido no inscribe; duplicado no crea otra relación y permite abrir la existente. |

### 6.2 Contenido y actividades

| ID | Actor y obligación | Resultado y controles |
| --- | --- | --- |
| ALZ-RF-004 | Profesor: crear, editar y consultar ejercicios con enunciado, plantilla, dificultad, conceptos, pruebas y límites. | Guarda y recupera una definición completa; pruebas inconsistentes y límites inválidos se rechazan. Mantiene la protección de pruebas ocultas y la versión anterior ante edición no autorizada. |
| ALZ-RF-005 | Profesor: componer actividad con ejercicios ordenados y controlar DRAFT, PUBLISHED y CLOSED. | Valida título, tipo, fechas y contenido mínimo; publicar habilita la clase autorizada; cerrar bloquea envíos y conserva evidencia. No publica una actividad vacía. |
| ALZ-RF-006 | Profesor: cargar material oficial y extraer, fragmentar, indexar y asociar metadatos a clase/actividad. | Muestra estado de ingesta, fragmentos y referencia; solo admite fuentes compatibles; una falla permite reintentar sin recuperación entre clases. |

### 6.3 Experiencia del estudiante

| ID | Actor y obligación | Resultado y controles |
| --- | --- | --- |
| ALZ-RF-007 | Estudiante: consultar actividades publicadas y su avance. | Lista exclusivamente clases y actividades autorizadas, con estado, fecha e instrucciones; maneja vacío sin inventar progreso. El comportamiento histórico de CLOSED requiere DEC-002. |
| ALZ-RF-008 | Estudiante: abrir un ejercicio y visualizar enunciado, conceptos, plantilla y pruebas visibles. | Carga ejercicio correcto, dificultad, límites y editor; conserva borrador local. No muestra pruebas ocultas o datos internos. Si falla recuperación del borrador, informa y mantiene la plantilla. |
| ALZ-RF-009 | Estudiante: ejecutar JavaScript en un entorno controlado. | Valida código y límites, corre pruebas, devuelve uno de seis diagnósticos y evidencia permitida. Detiene consumos fuera de límites y bloquea recursos no autorizados. |
| ALZ-RF-010 | Estudiante: enviar solución y registrar intento con código, fecha, eventos y resultado técnico. | Confirma registro solo tras persistencia del intento. IA/RAG se invoca después de persistir; su caída posterior no pierde el resultado. El caso de uso bloquea el envío si la actividad se cerró antes de la confirmación del estudiante y conserva borrador; la carrera con una ejecución ya admitida requiere DEC-002. |
| ALZ-RF-011 | Sistema/estudiante: presentar diagnóstico técnico determinista del intento. | Muestra código contractual y evidencia visible reproducible; UNKNOWN conserva evidencia sin inventar causa. La IA no puede corregir el resultado de las pruebas. |
| ALZ-RF-012 | Estudiante: solicitar pistas progresivas vinculadas al intento. | Verifica intento y nivel disponible, aumenta la ayuda gradualmente y registra solicitud. Sin evidencia autorizada usa NO_EVIDENCE; sin proveedor usa PROVIDER_UNAVAILABLE. |
| ALZ-RF-013 | Sistema/estudiante: generar retroalimentación contextual con evidencia técnica y RAG autorizado. | Valida los cinco campos, los tres estados RAG y referencias; muestra documento/ubicación; no agrega score. Descarta salida inválida y preserva el intento. |
| ALZ-RF-014 | Estudiante: reintentar ejercicio sin perder historia. | Copia solución anterior al editor, produce resultado temporal al ejecutar y un intento nuevo al enviar; conserva identificadores distintos e historial incluso en concurrencia. |
| ALZ-RF-015 | Estudiante: consultar progreso explicable por actividad y concepto. | Muestra completados/requeridos y evidencia de intentos, filtros, errores y pistas. Denominador cero produce estado no calculable. No representa una calificación. |

### 6.4 Seguimiento docente

| ID | Actor y obligación | Resultado y controles |
| --- | --- | --- |
| ALZ-RF-016 | Profesor: visualizar tablero interno con actividad, avance, fallas, conceptos y señales. | Agrega evidencia de clase autorizada y filtros por actividad, concepto o período; presenta carga, vacío y error. No incorpora inferencias IA al cálculo. |
| ALZ-RF-017 | Profesor: consultar detalle de estudiante con intentos, resultados y evidencia de progreso. | Verifica relación profesor–clase–estudiante; muestra última actividad, pruebas, pistas, errores, conceptos y señales del ámbito. Si el estudiante no pertenece a la clase, no revela existencia ni datos. |
| ALZ-RF-018 | Sistema/profesor: generar y revisar señales explicables de inactividad, error repetido y estancamiento. | Aplica los tres umbrales documentados y conserva causa, evidencia, fecha y versión. Filtra tipo/estado; sin umbral cumplido no crea señal; sin evidencia verificable evita conclusiones. |
| ALZ-RF-019 | Profesor: marcar una señal como revisada. | Cambio ACTIVE → REVIEWED con responsable y fecha; confirmación, autorización e idempotencia. No elimina la evidencia ni modifica autor/fecha ante repetición. |

### 6.5 Administración y gobierno

| ID | Actor y obligación | Resultado y controles |
| --- | --- | --- |
| ALZ-RF-020 | Administrador: crear, actualizar y archivar organizaciones dentro del ámbito autorizado. | Valida nombre, código, estado, unicidad y permisos; audita. Dependencias activas bloquean archivado; dependencias impiden eliminación física. |
| ALZ-RF-021 | Administrador: invitar, activar/deshabilitar usuarios y asignar roles autorizados. | Valida correo, organización, rol y combinaciones; evita duplicados y pérdida del último administrador ACTIVE; registra cada cambio. |
| ALZ-RF-022 | Administrador: mantener cursos/clases y asignar profesores de la misma organización. | Guarda código, nombre, período, clase y relaciones; exige códigos únicos y fechas coherentes. Rechaza identidad docente deshabilitada o de otra organización. |
| ALZ-RF-023 | Administrador: crear, editar y archivar conceptos. | Valida nombre normalizado único, descripción y relaciones sin ciclos; conserva versiones/referencias. En un concepto en uso, trata reasignación o confirmación controlada sin borrar historia. |
| ALZ-RF-024 | Administrador: gobernar propiedad, versión, visibilidad y archivado del banco reutilizable. | Muestra propietario, conceptos, versión, visibilidad y usos; conserva versión referenciada al editar una publicada. Niega ampliar visibilidad fuera de organización. |
| ALZ-RF-025 | Administrador: gobernar fuentes, visibilidad, indexación y aislamiento de material RAG. | Valida PDF con texto/TXT/Markdown ≤10 MB y metadatos; informa versión, fecha, fragmentos y estado. Permite reindexar fallos sin publicar fragmentos parciales ni cruzar organizaciones/clases. |
| ALZ-RF-026 | Administrador: configurar, versionar y activar reglas deterministas. | Valida parámetros y vigencia; registra autor, fecha y versión utilizada; al activar, cierra vigencia anterior conservando historia. No sobrescribe versión activa ni acepta umbrales negativos/inconsistentes. |
| ALZ-RF-027 | Administrador: consultar auditoría y exportar registros operativos autorizados en CSV. | Filtra fecha, actor, acción y entidad, pagina y exporta vista autorizada en UTF-8; audita descarga y preserva integridad. Maneja vacío y límite de exportación con respuestas verificables. |

## 7. Trazabilidad íntegra

**Documentado.** Cada requisito conserva relación uno a uno con historia, caso de uso y prueba del mismo número. Los 27 grupos están planificados; las fuentes no acreditan que las pruebas hayan sido ejecutadas.

| Requisito | Historia | Caso de uso | Prueba prevista |
| --- | --- | --- | --- |
| ALZ-RF-001 | ALZ-HU-001 | ALZ-CU-001 | ALZ-PT-001 |
| ALZ-RF-002 | ALZ-HU-002 | ALZ-CU-002 | ALZ-PT-002 |
| ALZ-RF-003 | ALZ-HU-003 | ALZ-CU-003 | ALZ-PT-003 |
| ALZ-RF-004 | ALZ-HU-004 | ALZ-CU-004 | ALZ-PT-004 |
| ALZ-RF-005 | ALZ-HU-005 | ALZ-CU-005 | ALZ-PT-005 |
| ALZ-RF-006 | ALZ-HU-006 | ALZ-CU-006 | ALZ-PT-006 |
| ALZ-RF-007 | ALZ-HU-007 | ALZ-CU-007 | ALZ-PT-007 |
| ALZ-RF-008 | ALZ-HU-008 | ALZ-CU-008 | ALZ-PT-008 |
| ALZ-RF-009 | ALZ-HU-009 | ALZ-CU-009 | ALZ-PT-009 |
| ALZ-RF-010 | ALZ-HU-010 | ALZ-CU-010 | ALZ-PT-010 |
| ALZ-RF-011 | ALZ-HU-011 | ALZ-CU-011 | ALZ-PT-011 |
| ALZ-RF-012 | ALZ-HU-012 | ALZ-CU-012 | ALZ-PT-012 |
| ALZ-RF-013 | ALZ-HU-013 | ALZ-CU-013 | ALZ-PT-013 |
| ALZ-RF-014 | ALZ-HU-014 | ALZ-CU-014 | ALZ-PT-014 |
| ALZ-RF-015 | ALZ-HU-015 | ALZ-CU-015 | ALZ-PT-015 |
| ALZ-RF-016 | ALZ-HU-016 | ALZ-CU-016 | ALZ-PT-016 |
| ALZ-RF-017 | ALZ-HU-017 | ALZ-CU-017 | ALZ-PT-017 |
| ALZ-RF-018 | ALZ-HU-018 | ALZ-CU-018 | ALZ-PT-018 |
| ALZ-RF-019 | ALZ-HU-019 | ALZ-CU-019 | ALZ-PT-019 |
| ALZ-RF-020 | ALZ-HU-020 | ALZ-CU-020 | ALZ-PT-020 |
| ALZ-RF-021 | ALZ-HU-021 | ALZ-CU-021 | ALZ-PT-021 |
| ALZ-RF-022 | ALZ-HU-022 | ALZ-CU-022 | ALZ-PT-022 |
| ALZ-RF-023 | ALZ-HU-023 | ALZ-CU-023 | ALZ-PT-023 |
| ALZ-RF-024 | ALZ-HU-024 | ALZ-CU-024 | ALZ-PT-024 |
| ALZ-RF-025 | ALZ-HU-025 | ALZ-CU-025 | ALZ-PT-025 |
| ALZ-RF-026 | ALZ-HU-026 | ALZ-CU-026 | ALZ-PT-026 |
| ALZ-RF-027 | ALZ-HU-027 | ALZ-CU-027 | ALZ-PT-027 |

## 8. Condiciones para cerrar esta especificación

**Pendiente.** Antes de comprometer los contratos afectados, resolver con registro trazable: DEC-002; transiciones/reapertura de actividad; límites de entrada/código/exportación de los módulos posteriores; normalización de sus catálogos; semántica temporal y deduplicación de señales; niveles de ayuda; condiciones de archivado de recursos académicos; y efecto de editar contenidos sobre ejercicios ya asignados. El ámbito administrativo inicial, un rol por organización, identidad global/estado local, vigencia de invitaciones institucionales y excepción del administrador ejecutor al archivar quedan resueltos para IMP-01 según DEC-001; su resolución no acredita los resultados de prueba.

Las decisiones técnicas deben mantener los 27 identificadores y actualizar conjuntamente esta especificación, [flujos de aceptación](03-flujos-y-criterios-de-aceptacion.md), [datos](06-modelo-de-datos.md), [API](07-api-y-contratos.md), [pruebas](10-calidad-y-pruebas.md) y [plan de entrega](12-plan-de-entrega.md). No se da por terminado un requisito solo por documentarlo o asignarle sprint.
