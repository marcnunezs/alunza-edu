# 09 · Seguridad y privacidad

**Estado:** requisitos documentados, resolución institucional de IMP-01 y controles para los módulos posteriores. Esta especificación no acredita por sí sola resultados de pruebas, integración remota ni aceptación de seguridad; los registros de trabajo deben aportar esas evidencias.

**Documentado** corresponde a las fuentes de la línea base. **Propuesta** corresponde al diseño necesario para hacerlas verificables. **Pendiente** requiere definición institucional o validación técnica antes del hito indicado. Esta especificación no establece cumplimiento legal ni sustituye una revisión de los tratamientos de datos del piloto.

## 1. Fuentes y objetivos

- [ERS 1.3, §§2.4, 3.1, 3.3.2, 3.3.4 y 3.3.7](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/Informe_ERS_Alunza.docx>): JWT de Supabase Auth validado por NestJS; permisos por rol, organización y clase; RLS en tablas y Storage expuestos; secretos en servidor; ejecución aislada y salida IA validada.
- [Casos de uso extendidos, ALZ-CU-001/003/006/009/010/017/019/020–027](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/Documento_Casos_de_Uso_Extendidos_Alunza.docx>): autorización, inscripción, material oficial, intento durable, administración, auditoría y conservación de evidencias.

**Documentado:** la plataforma separa organizaciones y clases; solo usuarios `ACTIVE` operan; los datos de demostración son ficticios; los resultados deterministas prevalecen sobre IA; señales y progreso no son calificaciones ni decisiones académicas automáticas. El stack aprobado se conserva: Next.js en Vercel, NestJS en Azure Container Apps, Supabase para Auth/PostgreSQL/Storage/RLS/pgvector, Vercel Sandbox productivo y adaptador Docker local, Azure OpenAI mediante una interfaz configurable.

**Objetivo propuesto:** una cuenta o código estudiantil comprometido no debe otorgar acceso a otra organización, a compañeros, a pruebas ocultas, a secretos ni a infraestructura del servidor. La pérdida o demora del proveedor IA no debe destruir evidencia técnica ni atribuirle una evaluación que no realizó.

Referencias de implementación: [arquitectura](05-arquitectura.md), [modelo de datos](06-modelo-de-datos.md), [API](07-api-y-contratos.md), [IA/RAG](08-ia-y-procesamiento.md), [ejecución](13-ejecucion-controlada.md), [pruebas](10-calidad-y-pruebas.md) y [operación](11-operacion-y-despliegue.md).

## 2. Activos y límites de confianza

| Activo | Sensibilidad operativa propuesta | Acceso permitido |
| --- | --- | --- |
| Identidad, correo, membresías y rol | Restringido | Usuario sobre su perfil; administración sobre identidades de su organización; proyección mínima para docentes autorizados. |
| Código, intentos, resultados y progreso | Restringido educativo | Estudiante propietario y profesor autorizado de la clase. Ningún acceso global por tener rol administrativo. |
| Señales y evidencia de seguimiento | Restringido educativo | Profesor autorizado; revisión humana y evidencia explicable. No exposición a otros estudiantes. |
| Pruebas ocultas y resultados internos | Restringido técnico | Backend y ejecutor del trabajo correspondiente; docentes que gobiernan el ejercicio según permiso. |
| Material oficial y fragmentos | Institucional, con alcance de clase/actividad | Personal autorizado y estudiantes con acceso vigente al recurso o cita. Nunca públicos por defecto. |
| Auditoría y exportaciones | Restringido operativo | Administración de la organización, mediante campos permitidos. No incluye código o feedback completo. |
| Claves administrativas, credenciales de servicios y hashes de contraseña | Secreto | Supabase Auth o servicio estrictamente requerido; nunca sandbox estudiantil, navegador, repositorio, logs o documentos de demo. |
| Contraseña introducida, sesión Auth y prueba de invitación | Secreto del flujo de acceso | Navegador del titular y Auth, y bearer/prueba institucional en la API que corresponda. Sin logs, analítica, documentos de demo ni entrega al sandbox. La persistencia de sesión del SDK se concreta en §3.2. |
| Prompts y respuestas IA | Potencialmente sensibles | Backend y proveedor autorizado con contexto mínimo; vista al usuario solo después de validar y filtrar. |

Los siguientes datos se consideran no confiables: todo contenido del navegador; parámetros, IDs y filtros; código del estudiante; archivos cargados; stdout/stderr; texto recuperado por RAG; salidas del modelo; webhooks o callbacks no autenticados. Un archivo «oficial» puede contener instrucciones maliciosas y un JWT válido no demuestra permiso sobre un recurso.

Los límites a controlar son navegador → API, API → base de datos/Storage, API → ejecutor, API → proveedor IA y trabajos internos → recursos institucionales. Cada límite valida identidad, formato, alcance, volumen y resultado.

## 3. Autenticación y sesión

### 3.1 Requisitos documentados

1. Supabase Auth emite el JWT y NestJS lo valida antes de comprobar rol, organización y pertenencia a clase.
2. El estado exacto de usuario es `INVITED`, `ACTIVE` o `DISABLED`; únicamente `ACTIVE` opera.
3. La autorización procede de datos controlados por servidor o `app_metadata`, nunca de `user_metadata` editable por el usuario.
4. `service_role` permanece exclusivamente en servidor. No hay una API de dominio paralela en Next.js.

### 3.2 Controles de identidad y sesión

- NestJS verifica firma, algoritmo permitido, emisor, audiencia, expiración, sujeto y `session_id` del token para el proyecto/ambiente configurado. Además comprueba que la sesión siga vigente en Auth. No basta con decodificar el JWT ni aceptar un `userId` enviado por el cliente.
- Cada operación de dominio consulta el estado vigente del perfil y las membresías requeridas. Un JWT emitido antes de una deshabilitación o cambio de rol no mantiene permisos antiguos. La verificación equivalente se conserva en RLS. La incorporación por invitación verifica sesión, destinatario y prueba institucional antes de crear el perfil o promover su estado de INVITED a ACTIVE; nunca reactiva una cuenta global DISABLED.
- El contexto de organización solicitado se valida contra las membresías; no basta con cambiar un encabezado, cookie o parámetro. Los recursos se buscan dentro del ámbito autorizado desde la primera consulta.
- El inicio de sesión, recuperación e invitación usan los mecanismos de Auth configurados para el ambiente. Se responde de forma que una persona no pueda enumerar cuentas ajenas ni averiguar si un correo pertenece a otra organización.
- Los callbacks y destinos de redirección se limitan a URLs aprobadas. No aceptar redirecciones arbitrarias enviadas por la solicitud.
- Tokens y sesiones viajan solo por HTTPS en entornos remotos. En IMP-01 el SDK de Supabase Auth persiste la sesión en el navegador y la renueva; sus tokens son accesibles a JavaScript. La API de dominio recibe bearer explícito y no autentica mediante cookies. Esta decisión exige proteger frente a XSS y no equivale a una sesión `HttpOnly`. Si un flujo posterior incorpora cookies, debe definir `Secure`, alcance mínimo, `SameSite` y defensa CSRF correspondientes.
- Cerrar sesión elimina la sesión local y solicita la invalidación de esa sesión en Auth. Las siguientes operaciones protegidas verifican la existencia vigente del par `session_id`/usuario además del JWT; la firma todavía válida no conserva acceso después de esa invalidación. El cambio de identidad o cierre descarta proyecciones privadas y cancela solicitudes pendientes de la interfaz.
- La demo no usa registro público irrestricto ni contraseñas compartidas publicadas. Las cuentas ficticias se aprovisionan mediante el procedimiento de inicialización acordado.

**Concreción de IMP-01:** el callback permitido es `/acceso/invitacion`. Recibe la prueba institucional y el desafío de Auth en el fragmento, limpia la URL y exige Continuar antes de verificar el desafío. La prueba permanece en memoria, sin almacenamiento persistente ni logs. La cuenta nueva establece contraseña de al menos 12 caracteres; incorporar una identidad con perfil activo existente no cambia su contraseña. La configuración local fija JWT y desafío Auth en 3600 segundos; este plazo no sustituye las 72 horas de la invitación institucional. La renovación del desafío solo procede con prueba institucional vigente y no extiende ese vencimiento.

**Pendiente fuera de este corte:** política institucional de recuperación, MFA para administradores y configuración de duración/cuotas de autenticación del ambiente remoto. No se añade autenticación federada al MVP, pues la ERS la sitúa en alcance futuro. Los cambios de rol y estado local no deben depender de esperar el vencimiento del JWT.

## 4. Autorización de negocio

Los nombres técnicos `ADMIN`, `TEACHER` y `STUDENT` representan administrador de organización, profesor y estudiante de las fuentes. DEC-001 fija para IMP-01 un rol por membresía y organización. Una identidad global puede pertenecer a varias organizaciones con roles diferentes. Los permisos se deniegan por defecto y se conceden por operación, recurso y ámbito.

| Operación o dato | Administrador | Profesor | Estudiante |
| --- | --- | --- | --- |
| Organización, usuarios, roles, cursos y asignación de clases | Gobierno dentro de su ámbito explícito | Consulta mínima necesaria; crea/administra sus clases según RF-002 | Sin gobierno; consulta de su pertenencia |
| Incorporación de estudiante | Invita/gestiona en su organización | Genera mecanismo de ingreso de su clase si está autorizado | Se incorpora a sí mismo con código o invitación válidos |
| Taxonomía, banco y fuentes institucionales | Gobierno según RF-023/024/025 | Gestiona ejercicios propios y materiales de sus clases; consulta banco compartido autorizado | Sin gobierno; recibe proyección publicada de su actividad y fuentes autorizadas |
| Publicación y cierre de actividad | No se presume permiso docente por el rol | Profesor asignado a la clase | Sin permiso |
| Ejecutar y enviar soluciones | No se presume acceso como estudiante | No suplanta envíos de estudiantes | Solo su actividad publicada y su identidad |
| Código, intentos, resultados y progreso | Sin lectura pedagógica general por defecto | Estudiantes de sus clases autorizadas | Solo propios |
| Pruebas ocultas | Solo si tiene permiso explícito de gobierno del ejercicio | Solo en el ejercicio que puede gobernar | Nunca definición, expectativas ni detalle interno |
| Señales y revisión | Configura reglas; no recibe detalle pedagógico general por defecto | Consulta y revisa las de su clase | Sin acceso a señales ajenas; la vista de señales personales no se añade sin requisito |
| Auditoría y CSV operativo | Organización autorizada y campos permitidos | Sin permiso administrativo implícito | Sin permiso |

**Documentado:** el administrador gobierna recursos dentro de su ámbito, el profesor sigue sus clases y el estudiante accede a sus actividades y evidencia. **Resolución de IMP-01 — DEC-001:** gobierno operativo no concede acceso al contenido pedagógico individual. Una membresía ADMIN no acumula roles TEACHER/STUDENT en esa organización; los permisos de otra organización tampoco se trasladan a la seleccionada.

Reglas de protección:

1. Validar el estado de la organización, usuario y pertenencia además del rol.
2. El profesor asignado pertenece a la misma organización y debe tener perfil y membresía activos. Deshabilitar una membresía impide operar en esa organización, sin cambiar Auth ni otras membresías. Una cuenta global DISABLED no puede operar o incorporarse en ninguna organización. Una identidad ACTIVE puede resolver su propio perfil sin membresías operativas; esto no concede acceso institucional.
3. Impedir cambios que eliminen o deshabiliten al último administrador activo, incluidos cambios de rol concurrentes.
4. **DEC-001 resuelta para IMP-01:** un operador técnico concede a una identidad ACTIVE un permiso explícito de un uso para crear una organización. No exige ADMIN previo en otra organización. Creación, primer ADMIN, consumo y auditoría comparten transacción. El permiso no permite consultar otras organizaciones ni crea un superadministrador del producto.
5. El archivado de organización se bloquea mientras existan dependencias activas según RF-020, con la excepción confirmada del ADMIN ejecutor como única membresía ACTIVE. No admite otros miembros activos, invitaciones pendientes ni entregas pendientes que puedan activarlas. El ejecutor conserva membresía ADMIN y consulta administrativa del archivo, sin escrituras ni lectura pedagógica adicional. Clases y documentos ampliarán ese control cuando se incorporen; no se usa como borrado masivo de evidencias.
6. Un borrador no se filtra por búsquedas, endpoints alternativos, cachés o archivos. `CLOSED` bloquea nuevos envíos; la propuesta de consulta histórica se recoge en DEC-002.
7. La misma autorización se aplica a listas, detalle, agregados, descargas, exportaciones, recuperación vectorial y tareas asíncronas. El permiso para consultar una lista no autoriza todos los IDs posibles.

## 5. PostgreSQL, RLS y Storage

### 5.1 Defensa en persistencia

**Documentado:** las tablas y objetos Storage expuestos usan RLS por organización y clase además de autorización en NestJS.

**Propuesta de implementación:**

- Mantener las tablas de dominio en esquemas no expuestos al navegador para escrituras arbitrarias. NestJS usa un rol PostgreSQL propio, sin superusuario ni `BYPASSRLS`, con permisos mínimos y contexto de identidad derivado de un JWT validado.
- Establecer el contexto del actor y organización por transacción, no como estado persistente compartido de una conexión del pool. Limpiar el contexto al terminar. Nunca interpolar SQL ni usar un contexto suministrado sin validación por el cliente.
- Las políticas verifican `organization_id`, pertenencia vigente, clase y propiedad del estudiante según la entidad. Combinar `USING` y `WITH CHECK` en operaciones donde corresponda; impedir que una actualización cambie el ámbito o autor de una fila para evadir políticas.
- Un rol del frontend no recibe escritura directa en intentos, resultados, auditoría, reglas, membresías o permisos. RLS controla filas; privilegios de columnas, esquemas y proyecciones controlan campos sensibles.
- Si una tabla, vista o función se expone mediante la API de Supabase, aplicar una política de denegación por defecto y probar llamadas directas con roles anónimo y autenticado. Una vista expuesta usa seguridad del invocador o una proyección privada servida por NestJS; no debe ejecutarse accidentalmente como propietario y eludir RLS.
- Funciones privilegiadas son excepcionales, con permisos de ejecución mínimos, `search_path` fijo, entradas validadas y pruebas específicas. No usar funciones de conveniencia que otorguen consultas arbitrarias.
- La lectura de perfiles globales se limita a la proyección mínima del propio usuario o de miembros autorizados. La existencia de una identidad Auth no es visible para todas las organizaciones.
- Las claves foráneas compuestas del [modelo](06-modelo-de-datos.md) impiden referencias cruzadas aunque una validación de aplicación falle.

La conexión concreta, el contexto de RLS y la gestión del pool deben demostrarse en la implementación. Si se opta por JWT del usuario hacia PostgREST, debe resolverse expresamente cómo se impide que ese mismo usuario omita las reglas de NestJS llamando escrituras directas; no se da por resuelto por tener RLS.

**Concreción institucional de IMP-01:** `alunza_app` usa contexto local de actor, sesión y organización por transacción. El helper `alunza_identity`, sin LOGIN ni BYPASSRLS, recibe únicamente las columnas de Auth necesarias para comprobar sesión y correo confirmado, con políticas que restringen esa consulta al actor/sesión. El bootstrap local aplica esos grants y políticas como propietario de Auth; un despliegue remoto debe provisionarlos y verificarlos expresamente. La migración de dominio por sí sola no acredita acceso remoto válido. Véase el [diccionario institucional](../docs/work/IMP-01-dictionary.md).

### 5.2 Credenciales de servicio y trabajos

`service_role` no se utiliza en el camino normal de CRUD de usuarios, aunque esté en servidor. Puede reservarse para tareas de mantenimiento o adaptadores que lo requieran, con autorización de trabajo explícita, entorno aislado y alcance construido desde registros confiables. Toda tarea transporta IDs mínimos y vuelve a comprobar el recurso, organización y permiso vigente antes de actuar o entregar su resultado.

Los consumidores de trabajos no aceptan una petición pública que elija arbitrariamente `organization_id`, ruta Storage, SQL, URL de callback o destinatario. Un cambio de permisos entre la solicitud y la entrega debe impedir una descarga o respuesta ya no autorizada. Los trabajos técnicos que deban conservar evidencia cerrarán con un estado seguro y auditable.

Las invitaciones institucionales de IMP-01 se registran con una entrega durable antes de contactar Auth. El consumidor comprueba organización activa, ADMIN autorizante vigente y lease; el correo y callback proceden de ese registro y de configuración permitida. Un reenvío por otro ADMIN vigente autoriza la nueva entrega; renovar el desafío conserva ese autorizante. La aceptación revalida destinatario, digest, generación y vigencia, de modo que un envío parcial o una revocación no concedan membresías. Solo se almacena el digest del secreto institucional; un fallo incierto del envío se representa como UNCERTAIN, sin simular entrega confirmada.

### 5.3 Archivos, descargas y citas

- Buckets privados. Ruta propuesta: `organizations/{organizationId}/classes/{classId}/sources/{sourceId}/versions/{versionId}/...`; la ruta facilita organización, pero no es un control de acceso suficiente.
- Metadatos de fuente y objeto coinciden en organización, clase, versión y propietario. El usuario no puede elegir una ruta de otra organización ni sobrescribir una versión citada.
- Descargas mediante API autorizada o URL firmada de duración corta. Una URL firmada actúa como credencial: no se incluye en logs, analítica, prompts ni documentos públicos. **Pendiente:** TTL concreto y mecanismo de revocación compatible con el proveedor antes del piloto.
- La fuente se vuelve a autorizar al abrir una cita. Conservar una referencia histórica no garantiza que pueda descargarse si se retiró el permiso.
- La recuperación filtra organización, clase, actividad y fuente antes de entregar fragmentos al modelo. Cada fragmento y cita se comprueba también contra el alcance de la solicitud.
- Pruebas ocultas, intentos y exportaciones no se publican en buckets abiertos ni en cachés públicas. Respuestas privadas no se comparten entre usuarios por una clave de caché incompleta.

## 6. Validación de entradas, archivos y salida web

**Documentado:** RNF-SEG-02 exige validar entradas, archivos y salidas estructuradas de IA. Se aceptan PDF con texto, TXT o Markdown de hasta 10 MB; PDF sin texto extraíble se rechaza sin OCR.

**Propuesta:**

1. Validar esquemas en el límite API, rechazar campos no permitidos y limitar cuerpo, número de elementos y longitudes. Los campos de seguridad —rol, autor, organización, diagnóstico confiable— no se actualizan mediante asignación masiva.
2. Validar tamaño durante la recepción, tipo permitido, extensión y contenido real; no confiar únicamente en nombre o `Content-Type`. El valor operativo exacto de «10 MB» se mantiene idéntico en UI/API/Storage y debe quedar definido en [IA/RAG](08-ia-y-procesamiento.md).
3. Rechazar PDF cifrado no procesable, malformado o sin texto, formatos no admitidos y contenido que exceda límites de extracción. El límite del archivo comprimido no reemplaza límites de memoria, páginas/texto extraído y tiempo del parser.
4. Procesar archivos en un componente con recursos limitados y sin privilegios. Mantenerlos no recuperables hasta completar validación e indexación. No ejecutar macros, scripts incrustados ni código de Markdown.
5. No seguir enlaces del documento ni descargar recursos remotos durante extracción. Una URL escrita en el archivo no autoriza una nueva solicitud de red.
6. Mostrar enunciados, material, código, stdout/stderr y feedback como texto o Markdown saneado. Deshabilitar HTML no confiable y URLs ejecutables; nunca insertar estos contenidos con HTML sin sanitizar.
7. Usar consultas parametrizadas. Validar campos de ordenación y filtros mediante listas permitidas, límites de paginación y ámbito obligatorio.
8. Generar nombres internos de archivo; el nombre original es una etiqueta. Bloquear traversal, rutas absolutas, caracteres de control y colisiones de objetos.
9. Mantener CSP, CORS y protección CSRF consistentes con el modelo de sesión. CORS permite únicamente orígenes aprobados por ambiente; no sustituye autenticación. Las operaciones con cookies que modifican estado requieren defensa CSRF; las llamadas con bearer token no deben aceptar credenciales ambientales de forma accidental.

**Pendiente:** límites de código y cuerpos generales, tiempo de parseo, límite de texto extraído y mecanismo de inspección de archivos. Los límites del proceso estudiantil sí están fijados en la ERS y no se sustituyen por estos parámetros.

## 7. Ejecución de JavaScript no confiable

**Documentado, RNF-SEG-04 y ALZ-PAR-001:** producción usa Vercel Sandbox desechable, 1 vCPU y 2 GB por entorno; el proceso estudiantil tiene 128 MB, 3 segundos y 64 KB de salida. No recibe secretos, archivos del anfitrión ni red no autorizada. Desarrollo usa adaptador Docker. El p95 de respuesta completa de ejecución es menor a 5 segundos en demo como objetivo aún no probado.

**Propuesta de controles obligatorios para implementar ese contrato:**

- Ningún código estudiantil se ejecuta con `eval`, importación dinámica o procesos del servidor NestJS/Next.js. El adaptador usa solo el entorno aislado seleccionado.
- Cada ejecución recibe exclusivamente código de esa solicitud, versión de runtime, arnés y pruebas necesarias. No montar repositorios, credenciales cloud, sockets Docker ni directorios del anfitrión.
- Separar el tamaño del sandbox del límite interno del proceso. Configurar 2 GB en el entorno no acredita que el estudiante esté limitado a 128 MB.
- Restringir red por defecto en el entorno que ejecuta código; instalaciones o preparación requeridas se realizan antes, con dependencias fijadas. El proceso estudiantil no dispone de una herramienta para desactivar el aislamiento.
- Aplicar límites de tiempo, memoria, salida y procesos derivados; no basta con limitar el heap de JavaScript si quedan allocations, subprocesos o archivos sin control. Medir las condiciones adversariales del contrato.
- Capturar y truncar la salida sin crecer memoria indefinidamente; conservar un indicador de truncamiento y motivo técnico separado del diagnóstico.
- Eliminar el sandbox al finalizar, cancelar o fallar; disponer de limpieza de ejecuciones huérfanas. Identidad, región, duración, motivo y consumo se conservan como metadatos operativos sin secretos.
- Generar resultados canónicos en infraestructura controlada. El navegador no decide las pruebas superadas; la IA no puede marcar un intento correcto.

El detalle del arnés, protocolos, estados y pruebas se especifica en [ejecución controlada](13-ejecucion-controlada.md). La equivalencia de controles entre Docker local y Vercel Sandbox debe verificarse; éxito local por sí solo no acredita aislamiento productivo.

## 8. Protección de IA y recuperación documental

**Documentado:** IA/RAG recibe resultados normalizados y devuelve `diagnosis_code`, `explanation`, `hint`, `source_refs`, `status`; los únicos estados son `SUPPORTED`, `NO_EVIDENCE`, `PROVIDER_UNAVAILABLE`. No incluye puntaje. Una salida malformada no puede corromper progreso, señales ni datos fuente.

**Propuesta:**

1. Tratar código, comentarios, enunciados recuperados y texto de fuentes como datos, no como instrucciones para cambiar permisos, buscar otras clases, revelar secretos o ignorar el contrato.
2. El modelo no recibe credenciales, cookies, JWT, pruebas ocultas completas, listas de alumnos ni herramientas con capacidad de consultar arbitrariamente la base de datos. El acceso documental lo resuelve el backend antes de invocar al proveedor.
3. Enviar identificadores opacos y el mínimo código/contexto necesario para la pista. No añadir nombres, correos o datos institucionales a un prompt cuando no cumplen una función pedagógica necesaria.
4. Validar el esquema completo, valores permitidos, longitudes y referencias. Rechazar campos extra que simulen permisos, notas, acciones administrativas o puntajes. El `diagnosis_code` generado no puede reemplazar el resultado determinista persistido.
5. Exigir que `source_refs` corresponda a fuentes y fragmentos realmente recuperados y autorizados. Un enlace o identificador inventado por el modelo no se convierte en una descarga válida.
6. Ante evidencia insuficiente devolver `NO_EVIDENCE`; ante proveedor no disponible devolver `PROVIDER_UNAVAILABLE`. Los mensajes al estudiante no incluyen trazas o errores internos del proveedor.
7. Guardar versión de prompt, modelo, esquema y referencias para reproducibilidad. No registrar sistemáticamente prompts completos o respuestas crudas en logs generales; los artefactos de evaluación usan datos ficticios y control de acceso.
8. La IA no tiene permisos de escritura sobre intentos canónicos, resultados técnicos, progreso, reglas, señales, membresías o auditoría. Persistir una pista validada no concede capacidad de ejecutar acciones.

**Pendiente, DEC-009/010:** condiciones concretas de tratamiento del proveedor, región, retención de solicitudes, usos secundarios permitidos y configuración para el piloto. No afirmar que el proveedor no retiene o no utiliza datos sin comprobar la configuración y acuerdo aplicables. El MVP no incorpora detección de plagio, atribución de uso de IA ni sanciones automatizadas.

## 9. Auditoría, logs y exportación

### 9.1 Auditoría de dominio

**Documentado:** cambios administrativos, configuración de reglas, revisión de señales y exportaciones deben ser trazables. CU-027 define consulta por fecha, actor, acción y entidad, con actor, fecha, acción, entidad, identificador y resultado; CSV UTF-8 de la vista filtrada.

**Propuesta:** registrar al menos invitación/activación/deshabilitación, cambio de rol, asignación docente, archivado, publicación/versionado, cambio de visibilidad, indexación, activación de regla, revisión de señal, denegación relevante y consulta/exportación de auditoría. Cada evento conserva organización, actor humano o servicio, instante UTC, acción, entidad, resultado y correlación.

- Los cambios de negocio y su auditoría se confirman juntos donde compartan base de datos. El fallo de auditoría requerida impide declarar exitosa la mutación.
- Las operaciones de solo consulta registran un evento operativo separado sin incluir el contenido consultado. Una exportación registra solicitud, filtros autorizados, filas y resultado de generación/entrega; no afirma que el destinatario leyó un archivo porque fue generado.
- No almacenar contraseñas, tokens, nombres de objetos firmados completos, código, respuestas de alumnos, prompts completos o pruebas ocultas en auditoría. Usar identificadores y cambios seguros permitidos.
- Los usuarios no pueden modificar o eliminar eventos de auditoría. La cuenta que escribe tiene permiso de inserción acotado; lectura administrativa es una proyección filtrada. La restauración y una eventual política de retención preservan trazabilidad.

### 9.2 Logs técnicos

Correlacionar solicitud, intento, ejecución y proveedor mediante IDs; registrar latencia, estado, región, consumo y truncamiento cuando corresponda. Los logs no deben revelar datos de otras organizaciones, trazas sensibles o secretos, conforme a RNF-SEG-05. El acceso operativo a logs queda separado de los roles de la aplicación.

Propuesta: aplicar redacción de encabezados `Authorization`, cookies, claves y cuerpos sensibles antes de enviar registros a cualquier servicio; devolver al usuario un mensaje seguro y un identificador de correlación. Limitar acceso y retención de logs por ambiente. Las métricas generales no contienen nombres, correos, código o contenido de fuentes.

### 9.3 CSV operativo

La exportación utiliza una lista de campos permitidos; no serializa tablas completas ni ofrece una descarga global de estudiantes. Reaplica filtros y ámbito en servidor. Se limita en filas/tamaño y solicita acotar filtros si supera el límite configurado. La presentación de un resultado vacío se define en la especificación funcional.

Sanear caracteres de control, separar y escapar campos CSV correctamente y neutralizar celdas interpretables como fórmulas por aplicaciones de planilla. La descarga usa nombre seguro y tipo de contenido adecuado. Si es asíncrona, el objeto es privado, expira y se vuelve a autorizar al entregar; nunca se permite que un parámetro elija destinatarios externos.

## 10. Privacidad, menores y ciclo de vida

**Documentado:** la demo usa datos ficticios y la evidencia de progreso se presenta como descriptiva, no como calificación. La documentación no demuestra una política institucional de privacidad aprobada ni define plazos de retención.

**Propuesta para el MVP y su preparación:**

- Recoger solo nombre de presentación, correo necesario para la cuenta, pertenencia académica y evidencia de las funciones requeridas. No añadir RUT, domicilio, biometría, fecha de nacimiento, salud, antecedentes familiares o contactos de apoderados sin un requisito y fundamento institucional específicos.
- Diseñar el acceso de manera que el estudiante vea su propia evidencia y el docente la de su clase. Evitar rankings públicos, perfiles de riesgo generales o inferencias de capacidades permanentes.
- Si participan menores, definir previamente con la institución el responsable de autorizaciones, comunicaciones y atención de solicitudes. No asumir edad, capacidad de consentimiento o autorización de apoderado a partir de la existencia de una cuenta.
- Usar datos ficticios en desarrollo, previews, CI, capturas y evaluaciones de IA. No copiar la base de producción para pruebas ordinarias.
- Mantener inventario de destinatarios: Vercel para frontend/ejecución, Azure para API/IA y Supabase para datos/Auth/Storage, según la arquitectura. Determinar qué categorías salen hacia cada servicio y la región efectiva del ambiente.
- Proponer exportación o corrección de datos personales mediante un proceso institucional autorizado. Esta necesidad no convierte RF-027, que es operativo, en una exportación irrestricta de código e información pedagógica.
- Definir eliminación o anonimización consistente de tablas, objetos, fragmentos, vectores, cachés, prompts almacenados y respaldos según política aprobada. La pseudonimización de un ID no garantiza anonimato si el código o un documento identifica al alumno.
- Antes de retirar una fuente o usuario, resolver las referencias históricas con una regla explícita: preservar evidencia mínima autorizada, redactar lo necesario y registrar la operación. No prometer borrado inmediato de todas las copias si la política de respaldo no puede cumplirlo.

**Pendiente, DEC-009, antes de datos reales:** revisión legal e institucional de finalidad, base aplicable, información a usuarios, participación de menores, encargados/proveedores, transferencias/regiones, retención, atención de solicitudes e incidentes. La especificación no fija normas vigentes ni presupone cumplimiento. Este pendiente no bloquea la demo con datos ficticios, pero sí la decisión de usar datos reales sin resolverlo.

## 11. Secretos, ambientes y respuesta operativa

**Documentado:** secretos en variables de entorno, nunca repositorio; separación de componentes/ambientes y registros correlacionables.

**Propuesta:**

1. Inventariar cada secreto con servicio, propósito, ambiente y responsable; archivos de ejemplo contienen únicamente nombres y placeholders. Variables públicas de Next.js no incluyen credenciales privilegiadas.
2. Separar credenciales de local, preview, demo y producción. Una preview no conecta a datos reales ni dispone de claves de producción.
3. Limitar permisos de despliegue y de las identidades de los servicios. La cuenta de migraciones puede tener más permisos que la API, pero no se entrega a procesos de ejecución estudiantil.
4. Revisar dependencias y cambios de configuración mediante CI y revisión cruzada. Tratar hallazgos explotables en autenticación, aislamiento o ejecutor como bloqueo de lanzamiento hasta corregirlos o retirar el flujo afectado.
5. Rotar credenciales expuestas, invalidar sesiones cuando corresponda y verificar usos; borrar una cadena del último commit no resuelve su exposición en historial o logs.
6. Disponer de acciones para pausar nuevas ejecuciones, llamadas IA, carga documental o invitaciones sin destruir intentos ya persistidos. Registrar el incidente y mantener el flujo técnico disponible cuando la degradación sea segura.
7. Respaldar y probar restauración de datos junto con políticas RLS, permisos, funciones, objetos y referencias del índice. Restaurar datos sin sus permisos no se considera recuperación completa.

**Pendiente:** responsables de incidentes, canales internos, objetivos de recuperación y disponibilidad de respaldos en los servicios contratados. Se concretan en [operación](11-operacion-y-despliegue.md), sin prometer prestaciones de un plan no verificado.

## 12. Amenazas y verificaciones prioritarias

| Amenaza concreta | Control requerido | Evidencia de prueba |
| --- | --- | --- |
| Estudiante A cambia ID y obtiene intento del estudiante B | Propiedad + pertenencia vigente + RLS + proyección | API y consulta directa expuesta niegan acceso; no filtran el código en errores. |
| Profesor consulta clase de otra organización | Alcance derivado de membresía + FK/RLS | Matriz de dos organizaciones, incluida búsqueda, agregados y CSV. |
| Usuario deshabilitado conserva token válido | Consulta de estado actual en API y RLS | Token previo deja de autorizar sin esperar vencimiento. |
| Administrador se otorga gobierno global mediante payload | Lista de campos, permiso explícito de bootstrap | Cambio de ámbito o rol no permitido rechazado y auditado. |
| Dos administradores se deshabilitan simultáneamente | Serialización de invariantes | Al menos un administrador activo permanece. |
| Código estudiantil intenta leer secretos, abrir red o agotar recursos | Sandbox desechable, mínimos permisos y límites internos | Pruebas adversariales productivas y locales con medición del cierre. |
| Alumno manipula pruebas superadas enviadas por navegador | Resultado canónico generado por servidor | Payload falso no aumenta progreso ni crea `SUCCESS`. |
| Archivo o fuente contiene prompt injection | Extracción limitada, contexto autorizado y modelo sin herramientas privilegiadas | No hay acceso cruzado, revelación de secretos ni cambios de reglas/resultados. |
| Modelo inventa una fuente o salida con puntaje | Esquema estricto y validación de referencias | Salida rechazada/degradada; resultado técnico y progreso conservados. |
| HTML o código malicioso en Markdown/stdout/feedback | Renderizado seguro, sanitización y CSP | No se ejecutan scripts ni URLs peligrosas al visualizar. |
| Bucle de ejecuciones o pistas agota cuota | Límites por usuario/organización y concurrencia | Respuesta controlada sin gasto ilimitado ni degradación de otras organizaciones. |
| CSV abre una fórmula controlada por el usuario | Escapado y neutralización de fórmulas | Exportación de valores adversariales no ejecuta fórmulas al abrirse. |
| URL firmada o caché filtra documentos | URL corta, cacheo privado, autorización al emitir | Otro usuario no obtiene objeto por lista/API y no recibe respuesta privada cacheada. |

Los límites de cuotas, concurrencia y exportación son propuestas cuya cifra se acuerda antes de las pruebas de carga; no se presentan como parámetros documentados. Se configuran y prueban con los objetivos de rendimiento, sin reemplazar los límites del ejecutor fijados por la ERS.

## 13. Criterios de aceptación

| ID | Criterio verificable | Trazabilidad principal |
| --- | --- | --- |
| SEC-01 | JWT ausente, alterado, vencido, de otro emisor/ambiente, sesión revocada o cuenta `INVITED`/`DISABLED` no accede a operaciones institucionales. La incorporación de una invitación valida sesión y prueba antes de activar una cuenta INVITED; nunca reactiva DISABLED. | ALZ-RF-001; RNF-SEG-01 |
| SEC-02 | Matriz negativa por rol/organización/clase/propietario cubre API, DB expuesta, vistas, Storage, búsqueda vectorial, agregados y CSV. No existe ruta alternativa que amplíe acceso. | RNF-SEG-01/05; ALZ-RF-006/016/017/025/027 |
| SEC-03 | Deshabilitar una membresía, retirarla o cambiar su rol revoca la autorización afectada aunque conserve JWT anterior, sin alterar otras membresías ni Auth. Una cuenta global DISABLED no opera en ninguna organización. | ALZ-RF-001/021/022 |
| SEC-04 | El estudiante no obtiene pruebas ocultas, soluciones internas, código ajeno ni metadatos sensibles por payload, errores, logs visibles o citas. | ALZ-RF-008; RNF-SEG-05 |
| SEC-05 | Archivos inválidos, mayores al límite, sin texto o de otro ámbito fallan con causa segura; una indexación parcial no aparece en RAG. | ALZ-RF-006/025; RNF-SEG-02; RNF-IA-03 |
| SEC-06 | Evidencia de sandbox 1 vCPU/2 GB y de proceso 128 MB/3 s/64 KB; sin acceso a secretos, archivos anfitrión ni red no autorizada; limpieza incluso con error. | RNF-SEG-04; ALZ-PAR-001 |
| SEC-07 | Instrucciones maliciosas en código o fuentes no cambian permisos, consultan otras clases ni escriben progreso, señales o diagnóstico técnico. | RNF-IA-01/05; RNF-CON-02 |
| SEC-08 | Salida IA malformada, diagnóstico contradictorio o fuente inventada se rechaza/degrada, conserva intento y resultado, y nunca crea un puntaje. | RNF-SEG-02; RNF-CON-01/02/03; RNF-IA-02/04 |
| SEC-09 | Auditoría conserva actor/acción/entidad/resultado; CSV UTF-8 tiene ámbito y campos permitidos, neutraliza fórmulas y registra entrega o fallo sin exponer datos pedagógicos completos. | ALZ-RF-019/020–027 |
| SEC-10 | Invitación/código vencido, revocado, de otro destinatario o repetido no crea membresías indebidas; autenticación y consumo de recursos aplican cuotas configuradas. | ALZ-RF-001/003/021; control propuesto contra abuso |
| SEC-11 | Repositorio, bundle del frontend, sandbox, errores y logs carecen de secretos; las credenciales de cada ambiente tienen alcance documentado. | RNF-SEG-03/04/05 |
| SEC-12 | Restaurar el ambiente de prueba recupera datos y permisos coherentes; pruebas de aislamiento siguen pasando y las fuentes mantienen referencias válidas. | RNF-POR-01; control propuesto de recuperación |
| SEC-13 | Casos XSS en Markdown/stdout/feedback, solicitud CSRF cuando aplicable y origen CORS no autorizado no ejecutan acciones protegidas ni scripts. | RNF-SEG-02/05; controles web propuestos |
| SEC-14 | Dos cambios administrativos concurrentes no dejan la organización sin administrador activo y conservan auditoría de las acciones efectivas. | ALZ-RF-021 |

Toda evidencia debe identificar commit, ambiente, cuentas ficticias, recurso, solicitud, resultado esperado/obtenido y fecha, con secretos redactados. Esta tabla define criterios, no resultados de ejecución; redacción de specs, políticas previstas o una captura de configuración no acreditan por sí solas la aceptación de seguridad. Los registros de trabajo deben distinguir controles institucionales, módulos posteriores e integración remota. Véase [calidad y pruebas](10-calidad-y-pruebas.md).
