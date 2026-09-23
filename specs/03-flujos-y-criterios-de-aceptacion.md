# Flujos y criterios de aceptación

**Estado:** diseño de aceptación; no hay pruebas ejecutadas ni resultados acreditados en este archivo.  
**Cobertura:** ALZ-RF-001 a ALZ-RF-027; ALZ-CU-001 a ALZ-CU-027; ALZ-PT-001 a ALZ-PT-027; 108 escenarios originales de historias, identificados E1 a E4 por historia.

**Interpretación institucional IMP-01:** DEC-001 fija un rol por membresía y distingue cuenta global de estado local. HU-021 E1 observa INVITED en la invitación durable y ACTIVE/DISABLED en la membresía aceptada; PATCH no omite aceptación. El archivo de HU-020 exceptúa al único ADMIN ejecutor y comprueba las dependencias implementadas. La cobertura/resultados de los doce escenarios HU-001/020/021 se registran en [IMP-01](../docs/work/IMP-01-identity.md); variantes con clases/documentos quedan para IMP-02/06. Esta nota conserva los identificadores y no atribuye aceptación humana.

## 1. Fuentes, convenciones y preparación

**Interpretación IMP-02:** el [registro del incremento](../docs/work/IMP-02-content.md) aplica las políticas confirmadas por el usuario a HU-002/003/004/008/022/023 y revalida HU-001/020/021. Resuelve los pendientes de este archivo sobre códigos, fechas, transiciones, archivo y borradores dentro de ese corte; los escenarios originales se conservan. RF-005/007/024 son parciales: no se acredita cierre frente a envíos reales, avance desde intentos ni gobierno completo del banco. Los resultados se consignan en el registro, sin atribuir aceptación humana.

Las obligaciones proceden de la [ERS 1.3](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/Informe_ERS_Alunza.docx>), los [casos de uso 1.2](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/Documento_Casos_de_Uso_Extendidos_Alunza.docx>) y las [historias, hoja Escenarios](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/Plantilla_Historias_Usuario_Alunza.xlsx>). Su prioridad y estado planificado se mantienen en el [Product Backlog](<../Evidencias CAPSTONE/Fase 1/Evidencias de proyecto/Product_Backlog_Alunza.xlsx>).

**Documentado** designa el comportamiento exigido por esas fuentes. **Propuesta técnica** designa ejemplos concretos de datos, precisiones y mecanismos de verificación redactados aquí; no acredita decisiones aprobadas. **Pendiente** identifica la información necesaria para cerrar un caso todavía ambiguo. La [especificación funcional](02-requisitos-funcionales.md) contiene las reglas compartidas y las [fuentes y decisiones](00-fuentes-y-decisiones.md) registran discrepancias.

**Propuesta técnica de diseño de prueba.** Las tablas convierten los escenarios genéricos E1 —flujo autorizado—, E2 —datos inválidos/incompletos— y E3 —permisos o aislamiento insuficiente— en entradas y observaciones concretas. E4 conserva el caso particular de cada historia. Se mantienen todos los identificadores originales. Los ejemplos de datos se usarán como fixtures reproducibles, no como datos reales ni resultados ya obtenidos.

Preparar la demo canónica documentada: 2 organizaciones, 2 administradores, 2 profesores, 8 estudiantes, 3 clases, 10 ejercicios y 2 documentos por clase. Las referencias «A» y «B» en este archivo son alias propuestos para distinguir las organizaciones de prueba. Incluir una segunda clase dentro de una misma organización para probar que pertenecer a la institución no concede acceso a todas las clases. Preparar estados ACTIVE, INVITED y DISABLED sin reemplazar el conjunto canónico por personas reales.

Para cada prueba se registra requisito, escenario, versión del producto, fixture, precondición, pasos, resultado esperado, resultado observado y evidencia. Una captura de interfaz no sustituye la comprobación de persistencia, aislamiento o ausencia de llamadas a IA. Los criterios funcionales siguientes se complementan con [calidad y pruebas](10-calidad-y-pruebas.md), [seguridad](09-seguridad-y-privacidad.md) y [UX](04-ux-y-accesibilidad.md).

## 2. Macroflujos documentados

| Identificador original | Propósito | Casos detallados |
| --- | --- | --- |
| ALZ-MF-001 | Autenticar usuario. | ALZ-CU-001 |
| ALZ-MF-002 | Gestionar clase e inscripción. | ALZ-CU-002, ALZ-CU-003 |
| ALZ-MF-003 | Gestionar banco de ejercicios. | ALZ-CU-004 |
| ALZ-MF-004 | Gestionar actividades. | ALZ-CU-005 |
| ALZ-MF-005 | Cargar material oficial. | ALZ-CU-006 |
| ALZ-MF-006 | Consultar actividades y ejercicios. | ALZ-CU-007, ALZ-CU-008 |
| ALZ-MF-007 | Ejecutar JavaScript. | ALZ-CU-009 |
| ALZ-MF-008 | Enviar solución y registrar intento. | ALZ-CU-010, ALZ-CU-011, ALZ-CU-014 |
| ALZ-MF-009 | Solicitar pista y retroalimentación contextual. | ALZ-CU-012, ALZ-CU-013 |
| ALZ-MF-010 | Consultar progreso personal. | ALZ-CU-015 |
| ALZ-MF-011 | Consultar tablero y evidencia agregada. | ALZ-CU-016, ALZ-CU-017 |
| ALZ-MF-012 | Revisar señales y evidencia. | ALZ-CU-018, ALZ-CU-019 |
| ALZ-MF-013 | Administrar organización y gobierno operativo. | ALZ-CU-020 a ALZ-CU-027 |

**Documentado.** El flujo vertical de aceptación es: administrador habilita estructura e identidades → profesor publica → estudiante abre, programa y ejecuta → estudiante envía → se persiste intento y evidencia técnica → se ofrece ayuda contextual → estudiante reintenta → progreso y señales se calculan con reglas → profesor revisa la evidencia y marca una señal. La falla de IA debe permitir completar el recorrido técnico y docente.

## 3. Acceso y preparación docente

### ALZ-CU-001 — Autenticar usuario

**Trazabilidad:** ALZ-RF-001 · ALZ-HU-001 · ALZ-PT-001.  
**Documentado. Actor/precondición:** administrador, profesor o estudiante con cuenta existente ACTIVE, sin sesión válida para iniciar sesión. La hoja Escenarios usa genéricamente «sesión válida» en E1; para inicio se aplica la precondición específica del caso de uso. Para cierre sí se requiere sesión iniciada.

**Flujo normal:** abre acceso → ingresa correo/contraseña → el sistema valida credenciales, estado y rol → crea sesión → redirige al inicio autorizado. Al cerrar sesión, la experiencia deja de permitir operaciones protegidas con esa sesión. **Postcondición:** acceso limitado a funciones y recursos autorizados, o sesión terminada.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-001-E1 | Cuenta ACTIVE con credenciales válidas; inicia sesión y luego la cierra. | Accede al inicio de su rol; después del cierre, una operación protegida exige autenticación. Repetir para los tres roles. |
| ALZ-HU-001-E2 | Correo mal formado, contraseña ausente o credenciales incorrectas; confirma acceso. | No obtiene acceso autorizado; recibe error corregible sin indicar datos sensibles de una cuenta existente. |
| ALZ-HU-001-E3 | Identidad intenta acceder por URL/API a clase u organización no autorizada. | No recibe datos del recurso ni facultades del otro rol. |
| ALZ-HU-001-E4 | Cuenta DISABLED; intenta iniciar sesión. | Acceso rechazado y registro de seguridad sin exponer datos sensibles. |

**Aceptación complementaria:** repetir E4 con INVITED; deshabilitar una cuenta previamente autenticada y comprobar que sus siguientes operaciones protegidas no se autorizan. La caducidad exacta de sesión y recuperación de contraseña se cierran en el contrato de autenticación; no se infiere un módulo nuevo.

### ALZ-CU-002 — Crear y administrar clase

**Trazabilidad:** ALZ-RF-002 · ALZ-HU-002 · ALZ-PT-002.  
**Documentado. Actor/precondición:** profesor autenticado con permiso de clase y curso de su organización disponible.

**Flujo normal:** abre formulario → ingresa nombre, curso y datos básicos → sistema valida campos y organización → guarda → sistema persiste profesor, curso y estado y genera código de ingreso controlado. Para editar, recupera la clase autorizada y valida nuevamente. **Postcondición:** clase recuperable con datos y mecanismo de incorporación coherentes.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-002-E1 | Profesor autorizado y curso A; crea y luego actualiza el nombre de clase. | Una clase persiste en A, mantiene curso/profesor/código y devuelve el nombre actualizado al recargar. |
| ALZ-HU-002-E2 | Falta nombre o curso obligatorio; intenta guardar. | Campos señalados; no aparece una clase incompleta ni se modifica la anterior. |
| ALZ-HU-002-E3 | Estudiante o profesor sin relación intenta crear/modificar esa clase. | Operación denegada; versión existente intacta; evento de autorización registrado cuando corresponde. |
| ALZ-HU-002-E4 | Clase archivada con historia; el profesor intenta modificarla. | Se impiden cambios operativos y se conserva su historial. |

**Pendiente:** catálogo de estados de clase y permisos de archivado; no reutilizar automáticamente el catálogo de estados de actividad.

### ALZ-CU-003 — Inscribirse en una clase

**Trazabilidad:** ALZ-RF-003 · ALZ-HU-003 · ALZ-PT-003.  
**Documentado. Actor/precondición:** estudiante ACTIVE con código o invitación vigente, dentro del ámbito permitido.

**Flujo normal:** elige unirse → ingresa código → sistema valida vigencia, clase y duplicidad → confirma → se registra membresía y aparece la clase en su inicio. **Postcondición:** una sola relación estudiante–clase, con acceso a publicaciones autorizadas.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-003-E1 | Código vigente de clase permitida; confirma inscripción. | Existe exactamente una membresía y puede abrir la clase y sus actividades publicadas. |
| ALZ-HU-003-E2 | Código ausente o inválido; confirma. | No se crea relación; mensaje solicita verificar el código. |
| ALZ-HU-003-E3 | Código corresponde a organización fuera del ámbito del estudiante. | No hay acceso ni membresía cruzada; respuesta no revela datos ajenos. |
| ALZ-HU-003-E4 | Código vencido o membresía ya existente; confirma. | Vencido: no inscribe. Duplicado: no crea otra relación y permite abrir la clase existente. |

**Pendiente:** duración, revocación y reutilización permitida del código colectivo frente a la invitación individual; no asumir que todos los códigos son de un solo uso.

### ALZ-CU-004 — Gestionar banco de ejercicios

**Trazabilidad:** ALZ-RF-004 · ALZ-HU-004 · ALZ-PT-004.  
**Documentado. Actor/precondición:** profesor autorizado, con clase y conceptos disponibles.

**Flujo normal:** crea/edita definición → completa enunciado, plantilla JavaScript, dificultad y conceptos → configura pruebas visibles/ocultas y límites → valida → guarda borrador. **Postcondición:** ejercicio íntegro, consultable y con pruebas coherentes; cambios a versiones publicadas conservan historia mediante ALZ-CU-024.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-004-E1 | Definición completa y pruebas válidas; guarda y recupera. | Enunciado, plantilla, dificultad, conceptos, pruebas y límites coinciden con lo guardado. |
| ALZ-HU-004-E2 | Falta enunciado, prueba mal formada o límite inválido; guarda. | Identifica el dato inválido y evita publicar/guardar una definición incoherente. |
| ALZ-HU-004-E3 | Ejercicio fuera del permiso del profesor; intenta editar. | Deniega la operación y conserva la versión existente. |
| ALZ-HU-004-E4 | Ejercicio con pruebas visibles y ocultas; se prepara su publicación. | Valida coherencia de ambas y protege detalles ocultos en las respuestas que recibe el estudiante. |

**Aceptación complementaria:** una prueba determinista incoherente impide habilitar el ejercicio; los límites declarados nunca pueden desactivar los topes del ejecutor. La sintaxis exacta de pruebas y el rango de dificultad pertenecen a [API y contratos](07-api-y-contratos.md).

### ALZ-CU-005 — Crear y publicar actividad

**Trazabilidad:** ALZ-RF-005 · ALZ-HU-005 · ALZ-PT-005.  
**Documentado. Actor/precondición:** profesor de clase con ejercicios válidos disponibles.

**Flujo normal:** crea título/tipo/fechas → selecciona y ordena ejercicios → sistema valida contenido y fechas → guarda DRAFT → publica → sistema habilita actividad para la clase. El cierre impide nuevos envíos y conserva evidencia. **Postcondición:** estado contractual y ejercicios ordenados persistidos.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-005-E1 | Actividad válida con dos ejercicios; publica. | Estado PUBLISHED y orden de ejercicios conservados; estudiantes inscritos pueden consultarla. |
| ALZ-HU-005-E2 | Borrador sin ejercicios o fechas inconsistentes; publica. | Permanece DRAFT; informa requisito faltante sin publicación parcial. |
| ALZ-HU-005-E3 | Profesor ajeno a la clase o estudiante; solicita publicar/cerrar. | Deniega cambio; actividad y evidencia sin modificación. |
| ALZ-HU-005-E4 | Actividad DRAFT, PUBLISHED o CLOSED; solicita transición. | Solo admite transiciones definidas, conserva uno de los tres estados y registra auditoría. Al cerrar, bloquea envíos. |

**Propuesta técnica/Pendiente:** probar DRAFT → PUBLISHED → CLOSED como secuencia inicial. Reapertura y retornos requieren decisión explícita. La separación de catálogo activo e historial cerrado depende de DEC-002. La prueba no puede afirmar validez de transiciones que aún no se han definido.

### ALZ-CU-006 — Cargar e indexar material oficial

**Trazabilidad:** ALZ-RF-006 · ALZ-HU-006 · ALZ-PT-006.  
**Documentado. Actor/precondición:** profesor con clase autorizada y PDF con texto, TXT o Markdown de hasta 10 MB.

**Flujo normal:** selecciona archivo/clase → valida formato, tamaño y permisos → confirma metadatos → extrae, limpia, fragmenta y genera embeddings → indexa → muestra estado, fragmentos y referencia. **Postcondición:** documento trazable en Storage/pgvector con metadatos y recuperación aislada.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-006-E1 | Fuente válida de clase A; confirma carga. | Se recupera por su clase, conserva referencia y usa fragmentos de 500 tokens, solapamiento 50 y top-k=5. |
| ALZ-HU-006-E2 | Archivo sin texto extraíble o metadatos obligatorios incompletos; carga. | Error accionable; no aplica OCR ni publica un índice utilizable inválido. |
| ALZ-HU-006-E3 | Solicita cargar o recuperar material de otra clase no autorizada. | No se almacena ni recupera como fuente propia; no hay fragmentos cruzados. |
| ALZ-HU-006-E4 | Formato no admitido o archivo mayor de 10 MB; carga. | Rechazo antes de indexar, con límite/formato indicado. |

**Aceptación complementaria:** simular falla de embeddings/indexación; mostrar estado controlado y permitir reintento; no exponer fragmentos parciales. Probar cada formato admitido y fronteras de tamaño según la unidad que fije el contrato técnico.

## 4. Resolución y aprendizaje del estudiante

### ALZ-CU-007 — Consultar actividades publicadas

**Trazabilidad:** ALZ-RF-007 · ALZ-HU-007 · ALZ-PT-007.  
**Documentado. Actor/precondición:** estudiante autenticado e inscrito en la clase.

**Flujo normal:** abre clase → lista publicaciones con estado/fecha → selecciona actividad → se validan permisos → muestra instrucciones/ejercicios ordenados → abre ejercicio. **Postcondición:** actividad correcta y avance observable, sin datos ajenos.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-007-E1 | Clase con actividad PUBLISHED e intentos propios; abre lista y detalle. | Ve actividad, fecha, instrucciones, orden y estado de avance coherentes. |
| ALZ-HU-007-E2 | Identificador o filtro de consulta inválido; solicita vista. | Error controlado, sin valores de avance fabricados ni cambio de datos. |
| ALZ-HU-007-E3 | Estudiante sin membresía solicita clase por URL/API. | No recibe publicaciones ni metadatos protegidos. |
| ALZ-HU-007-E4 | Clase sin PUBLISHED; abre lista. | Estado vacío accesible y comprensible, sin inventar progreso. |

**Pendiente DEC-002:** en actividad CLOSED con intentos previos, comprobar solo consulta histórica autorizada y bloqueo de nuevos envíos una vez confirmada esa interpretación.

### ALZ-CU-008 — Abrir ejercicio y preparar solución

**Trazabilidad:** ALZ-RF-008 · ALZ-HU-008 · ALZ-PT-008.  
**Documentado. Actor/precondición:** estudiante con ejercicio disponible en actividad autorizada.

**Flujo normal:** abre ejercicio → visualiza enunciado, dificultad, conceptos y plantilla → revisa pruebas visibles y límites → modifica solución → editor mantiene borrador local. **Postcondición:** contenido editable listo para ejecutar/enviar, sin exponer pruebas ocultas.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-008-E1 | Ejercicio disponible con plantilla; lo abre y edita. | Carga el ejercicio correcto y conserva el texto editable durante el flujo; muestra solo pruebas visibles. |
| ALZ-HU-008-E2 | Solicitud mal formada o recuperación de borrador falla. | Informa problema; en falla de borrador mantiene la plantilla original visible, sin afirmar haber recuperado el trabajo. |
| ALZ-HU-008-E3 | Solicita ejercicio de actividad no autorizada. | No devuelve enunciado protegido, pruebas ocultas ni datos internos. |
| ALZ-HU-008-E4 | Ejercicio archivado o actividad cerrada; intenta abrirlo para resolver. | Respeta indisponibilidad y explica el bloqueo; el acceso histórico se trata según DEC-002. |

**Pendiente:** cómo interactúa el archivado del banco con una versión ya referenciada por una actividad vigente. Debe conservarse la historia; no se presupone retirar actividades ya publicadas. La duración de conservación del borrador local necesita definición UX.

### ALZ-CU-009 — Ejecutar código JavaScript

**Trazabilidad:** ALZ-RF-009 · ALZ-HU-009 · ALZ-PT-009.  
**Documentado. Actor/precondición:** estudiante con ejercicio abierto; código dentro del formato y tamaño permitidos.

**Flujo normal:** selecciona ejecutar → valida entrada/sintaxis/límites → ejecuta pruebas en aislamiento → muestra resultado técnico normalizado. **Postcondición:** ejecución finalizada, recursos detenidos y resultado temporal visible; producción utiliza sandbox desechable con 1 vCPU/2 GB y proceso de 128 MB, 3 s y 64 KB de salida.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-009-E1 | Solución JavaScript válida; ejecuta. | Recibe resultado normalizado y pruebas visibles; el proceso termina y no accede a recursos no autorizados. |
| ALZ-HU-009-E2 | Código con sintaxis incorrecta o entrada fuera del contrato. | Sintaxis incorrecta produce SYNTAX_ERROR accionable; entrada inválida se rechaza antes de ejecutar. |
| ALZ-HU-009-E3 | Usuario sin acceso al ejercicio intenta ejecutarlo. | No se inicia ejecución autorizada ni se devuelven pruebas protegidas. |
| ALZ-HU-009-E4 | Proceso excede memoria, tiempo o salida establecidos. | Se detiene de forma controlada, respeta aislamiento y reporta diagnóstico del catálogo más motivo permitido; no expone secretos, anfitrión ni red no autorizada. |

**Propuesta técnica:** superar 3 s se clasifica TIMEOUT. Para memoria/salida o fallos sin evidencia clasificable, usar UNKNOWN y motivo separado hasta validar el mapeo de [ejecución controlada](13-ejecucion-controlada.md); «límite excedido» no es un séptimo diagnóstico. Agregar pruebas de red, secretos, archivos del anfitrión, excepción de ejecución, prueba fallida y condición desconocida. Medir proceso y ciclo completo por separado según [calidad](10-calidad-y-pruebas.md).

### ALZ-CU-010 — Enviar solución y registrar intento

**Trazabilidad:** ALZ-RF-010 · ALZ-HU-010 · ALZ-PT-010.  
**Documentado. Actor/precondición:** estudiante con solución válida y ejercicio que admite envíos.

**Flujo normal:** elige enviar → solicita confirmación → estudiante confirma → valida estado y autorización → ejecuta pruebas → persiste intento/eventos/resultado → confirma registro y actualiza evidencia → puede solicitar IA/RAG. **Postcondición:** intento persistido, independiente de la disponibilidad de IA.

**Propuesta técnica — DEC-002:** distinguir confirmación del estudiante en la interfaz, admisión transaccional por el servidor y confirmación final de persistencia. Admitir solo mientras PUBLISHED; un envío admitido antes del cierre puede completar y persistirse después. Si el cierre precede a la admisión, rechazar y conservar borrador. Esta semántica de concurrencia permanece pendiente de ratificación; no equivale a confirmar durabilidad al admitir.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-010-E1 | Actividad PUBLISHED y código válido; confirma envío. | Se puede consultar un intento con identificador, código, fecha, resultado y eventos; su persistencia precede a toda solicitud de feedback. |
| ALZ-HU-010-E2 | Cierre antes de confirmar en la interfaz, entrada inválida o falla de persistencia transaccional. | No confirma registro; conserva borrador; ante persistencia fallida no invoca IA/RAG ni actualiza progreso como si se hubiera guardado. El cierre entre confirmación de interfaz y admisión se prueba según DEC-002. |
| ALZ-HU-010-E3 | Intenta enviar por otro estudiante o a clase no autorizada. | No crea intento ajeno ni revela datos de la actividad. |
| ALZ-HU-010-E4 | Intento persistido; falla proveedor de feedback. | Intento y resultado permanecen consultables y estado RAG es PROVIDER_UNAVAILABLE. |

**Aceptación complementaria:** instrumentar el orden «confirmación de persistencia → llamada IA/RAG» y simular fallo de persistencia comprobando cero invocaciones. No basta un mensaje visual de éxito. Según la propuesta DEC-002, probar por separado cierre previo a admisión —rechazo— y cierre posterior a admisión —puede completar y persistirse—; ambas pruebas deben registrar los instantes de admisión, cierre y persistencia.

### ALZ-CU-011 — Consultar resultado técnico

**Trazabilidad:** ALZ-RF-011 · ALZ-HU-011 · ALZ-PT-011.  
**Documentado. Actor/precondición:** estudiante con intento propio persistido.

**Flujo normal:** selecciona intento → recupera fecha, ejercicio y resultado autorizados → abre detalle técnico → muestra diagnóstico/evidencia visible → compara con intento anterior. **Postcondición:** interpretación basada en ejecución determinista, sin exposición de pruebas ocultas.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-011-E1 | Intentos de fixtures deterministas; consulta detalle y comparación. | Muestra SUCCESS, SYNTAX_ERROR, RUNTIME_ERROR, FAILED_TEST o TIMEOUT según evidencia; comparación refleja cantidades reales de pruebas visibles. |
| ALZ-HU-011-E2 | Identificador mal formado o solicitud de detalle no permitido de prueba oculta. | Error de validación o resumen permitido, sin entradas/salidas esperadas ocultas ni métricas inventadas. |
| ALZ-HU-011-E3 | Intento inexistente o perteneciente a otra persona. | Deniega acceso sin confirmar existencia ni exponer información. |
| ALZ-HU-011-E4 | Ejecutor devuelve condición no clasificada. | Usa UNKNOWN, conserva evidencia técnica y no inventa explicación. |

**Aceptación complementaria:** forzar texto IA que contradiga pruebas; el diagnóstico, completitud y señal determinista permanecen inalterados. No agregar códigos a los seis documentados.

### ALZ-CU-012 — Solicitar pista progresiva

**Trazabilidad:** ALZ-RF-012 · ALZ-HU-012 · ALZ-PT-012.  
**Documentado. Actor/precondición:** estudiante con intento registrado y acceso al ejercicio.

**Flujo normal:** solicita pista → sistema verifica intento y nivel disponible → confirma siguiente nivel → combina diagnóstico/reglas/contexto autorizado → muestra ayuda gradual y registra solicitud como evento. **Postcondición:** ayuda relacionada con evidencia y trazabilidad de uso.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-012-E1 | Intento propio y fuente pertinente; solicita niveles sucesivos definidos. | Las pistas corresponden al intento, aumentan ayuda gradualmente y no entregan de inmediato solución completa; cada solicitud queda trazada. |
| ALZ-HU-012-E2 | No existe intento persistido o se pide nivel inválido. | No genera pista atribuida a un intento inexistente; orienta al envío o informa nivel disponible. |
| ALZ-HU-012-E3 | Solicitud refiere a intento/material de otra clase o estudiante. | Deniega o excluye contenido no autorizado; no genera ayuda con evidencia ajena. |
| ALZ-HU-012-E4 | Recuperación filtrada sin fragmentos pertinentes. | Estado NO_EVIDENCE, sin citas inventadas; conserva ayuda técnica disponible. |

**Aceptación complementaria:** proveedor sin respuesta produce PROVIDER_UNAVAILABLE y no bloquea nuevo trabajo técnico. **Pendiente:** número y contenido de niveles y rúbrica para verificar gradualidad. La mera ejecución temporal no cumple «intento registrado»; se precisa ese mensaje antes de implementación.

### ALZ-CU-013 — Generar retroalimentación contextual con fuente

**Trazabilidad:** ALZ-RF-013 · ALZ-HU-013 · ALZ-PT-013.  
**Documentado. Actor/precondición:** estudiante con intento registrado y autorización sobre los documentos aplicables.

**Flujo normal:** solicita feedback → recupera resultado/diagnóstico y fragmentos autorizados → genera cinco campos → valida → muestra explicación y fuente → estudiante abre documento/página o sección disponible. **Postcondición:** respuesta validada y trazable, o fallback explícito conservando evidencia técnica.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-013-E1 | Intento y fuente pertinentes; solicita feedback. | SUPPORTED con diagnosis_code, explanation, hint, source_refs y status válidos; la fuente existe, está autorizada y su ubicación visible corresponde al fragmento usado. |
| ALZ-HU-013-E2 | Contexto insuficiente, dato de entrada inválido o tiempo vencido. | Sin contexto: NO_EVIDENCE y source_refs vacío. Entrada inválida: rechazo controlado. Timeout de proveedor: PROVIDER_UNAVAILABLE, sin perder intento. |
| ALZ-HU-013-E3 | Contexto incluye documentos de otra organización/clase. | Recuperación y referencias excluyen esos documentos; no se muestra ni persiste su texto como feedback autorizado. |
| ALZ-HU-013-E4 | Respuesta incompleta o con campos/valores inválidos. | Descarta respuesta, muestra fallback PROVIDER_UNAVAILABLE y no bloquea intento, progreso ni reintento. |

**Aceptación complementaria:** rechazar estado fuera de catálogo, diagnóstico no reconocido, score extra o referencia inexistente. Comprobar que la respuesta IA nunca modifica el diagnóstico determinista ni calcula calificaciones/señales. Ver batería específica en [IA y procesamiento](08-ia-y-procesamiento.md).

### ALZ-CU-014 — Reintentar ejercicio

**Trazabilidad:** ALZ-RF-014 · ALZ-HU-014 · ALZ-PT-014.  
**Documentado. Actor/precondición:** estudiante con intento previo; actividad admite nuevos envíos.

**Flujo normal:** vuelve al editor → carga copia editable de solución anterior → modifica/ejecuta → recibe resultado temporal → envía → sistema crea intento distinto y actualiza progreso/evalúa señales. **Postcondición:** historia previa intacta y nuevo intento trazable.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-014-E1 | Intento previo fallido; modifica y envía solución nueva. | Ambos intentos son consultables, con códigos/resultados propios; el nuevo puede cambiar la evidencia de progreso. |
| ALZ-HU-014-E2 | Actividad se cierra o nuevo envío incumple validación. | Impide nuevo envío y conserva historial/contenido editable; no sobrescribe el intento anterior. |
| ALZ-HU-014-E3 | Intenta copiar/reintentar una entrega ajena. | No recibe código ajeno ni crea intentos atribuidos a otra persona. |
| ALZ-HU-014-E4 | Hay otro envío activo; realiza otro envío intencional. | Cada intento válido tiene identificador único; el historial conserva orden por fecha sin sobreescrituras. |

**Aceptación complementaria:** un reintento sin mejoras también persiste y puede contribuir a STAGNATION. **Propuesta técnica:** distinguir reintento intencional de repetición de la misma solicitud de red con idempotencia; resolver empates de fecha con orden estable en el contrato.

### ALZ-CU-015 — Consultar progreso personal

**Trazabilidad:** ALZ-RF-015 · ALZ-HU-015 · ALZ-PT-015.  
**Documentado. Actor/precondición:** estudiante autenticado con acceso a su clase; puede consultar también cuando aún no existe evidencia.

**Flujo normal:** abre progreso → calcula desde intentos autorizados → filtra actividad/concepto → muestra completados, requeridos, errores, pistas y estado → abre evidencia de intentos. **Postcondición:** fórmula reproducible y no presentada como nota.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-015-E1 | Actividad con 3 ejercicios requeridos, 2 completados; consulta y filtra. | Muestra 2/3; por concepto restringe numerador/denominador a ejercicios requeridos etiquetados. Intentos repetidos no inflan numerador. |
| ALZ-HU-015-E2 | Filtro inválido o falla de carga. | Error controlado; no muestra una proporción inventada ni confunde error de consulta con ausencia de actividad. |
| ALZ-HU-015-E3 | Consulta progreso de otro estudiante/clase. | No devuelve evidencia ni agregados ajenos. |
| ALZ-HU-015-E4 | No hay ejercicios requeridos; consulta. | Estado no calculable/sin evidencia, denominador 0 y ausencia de división por cero o porcentaje fabricado. |

**Aceptación complementaria:** un intento que supera todas las verificaciones requeridas completa el ejercicio; pasar solo pruebas visibles no basta si falla una requerida oculta. Si después falla un reintento, el completado anterior permanece. Sin intentos, explicar falta de evidencia; la presentación 0/D es propuesta técnica del documento funcional.

## 5. Seguimiento docente

### ALZ-CU-016 — Consultar tablero de clase

**Trazabilidad:** ALZ-RF-016 · ALZ-HU-016 · ALZ-PT-016.  
**Documentado. Actor/precondición:** profesor autenticado con relación autorizada a la clase.

**Flujo normal:** abre tablero → valida relación → selecciona actividad/concepto/período → agrega evidencia de ese ámbito → muestra actividad, completitud, fallas, conceptos y señales. **Postcondición:** agregados descriptivos que coinciden con datos fuente.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-016-E1 | Clase con intentos conocidos; consulta y cambia filtros. | Conteos y proporciones coinciden con los registros del filtro; puede seguir la evidencia al detalle. |
| ALZ-HU-016-E2 | Período invertido/filtro inválido o consulta falla. | No carga agregados inválidos; informa campos corregibles o error con acción de recuperación. |
| ALZ-HU-016-E3 | Profesor solicita clase no autorizada, incluso de su organización. | No devuelve estudiantes, agregados ni señales de esa clase. |
| ALZ-HU-016-E4 | No existen intentos ni eventos en el período. | Muestra ceros para conteos observables y estados vacíos; no deduce desempeño sin datos. |

**Aceptación complementaria:** apagar proveedor IA y repetir consulta; los agregados deterministas son iguales para los mismos datos y reglas.

### ALZ-CU-017 — Consultar detalle de estudiante

**Trazabilidad:** ALZ-RF-017 · ALZ-HU-017 · ALZ-PT-017.  
**Documentado. Actor/precondición:** profesor autorizado y estudiante inscrito en esa clase.

**Flujo normal:** selecciona estudiante → verifica relación profesor/clase/estudiante → filtra actividad/concepto → recupera intentos/evidencia → abre intento o señal. **Postcondición:** última actividad, pruebas, pistas, errores, conceptos y señales coinciden con la evidencia persistida del ámbito.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-017-E1 | Estudiante de su clase con intentos; abre detalle y un intento. | Datos corresponden a esa persona y clase, con fechas/resultados e historial sin alteraciones. |
| ALZ-HU-017-E2 | Filtro mal formado o filtro válido sin evidencia. | Mal formado: error corregible. Sin evidencia: estado vacío/sin evidencia, sin contenido fabricado. |
| ALZ-HU-017-E3 | Sesión sin rol docente autorizado solicita detalle. | Deniega sin exposición de información personal ni código. |
| ALZ-HU-017-E4 | Estudiante pertenece a otra clase u organización. | No revela existencia ni datos personales y no mezcla evidencia de sus otras clases. |

### ALZ-CU-018 — Revisar señales explicables

**Trazabilidad:** ALZ-RF-018 · ALZ-HU-018 · ALZ-PT-018.  
**Documentado. Actor/precondición:** profesor con clase autorizada y eventos/intentos evaluables. El sistema aplica reglas deterministas versionadas.

**Flujo normal:** abre señales → aplica/recupera reglas sobre evidencia autorizada → filtra tipo/estado → abre señal → ve regla, fecha, causa, contexto y evidencia. **Postcondición:** señal explicable disponible para juicio docente, sin calificación automática.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-018-E1 | Fixtures que cumplen cada regla; evalúa y consulta señales. | Emite INACTIVITY, REPEATED_ERROR o STAGNATION con causa, evidencia, fecha y versión de regla; estado inicial ACTIVE. |
| ALZ-HU-018-E2 | Filtro inválido o evidencia asociada dejó de estar disponible. | Filtro inválido: rechazo corregible. Evidencia ausente: indica que no se puede verificar y evita conclusiones. |
| ALZ-HU-018-E3 | Profesor intenta consultar/evaluar evidencia de clase ajena. | No lista señales ni evidencia del ámbito no autorizado. |
| ALZ-HU-018-E4 | Eventos no cumplen umbral configurado; recalcula. | No crea señal y conserva evidencia de evaluación determinista verificable. |

**Propuesta técnica de fixtures:** probar inactividad a 6 días y al cumplir 7 días desde último evento/inscripción, excluyendo períodos previos a inscripción y posteriores a cierre; error repetido con 2 intentos frente a 3 del mismo error en 14 días, y un error distinto que rompe consecutividad; estancamiento con pruebas visibles superadas 1,1,1 frente a 1,1,2 en el mismo ejercicio. La zona horaria, fronteras inclusivas, firma de error y cadencia están pendientes en [reglas funcionales](02-requisitos-funcionales.md). No introducir un estado contractual «no verificable».

### ALZ-CU-019 — Marcar señal como revisada

**Trazabilidad:** ALZ-RF-019 · ALZ-HU-019 · ALZ-PT-019.  
**Documentado. Actor/precondición:** profesor de clase y señal ACTIVE.

**Flujo normal:** abre señal → ve estado/regla/evidencia → solicita marcar revisada → confirma → sistema verifica permiso → actualiza a REVIEWED con responsable y fecha. **Postcondición:** revisión trazada sin borrar evidencia ni producir sanción.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-019-E1 | Señal ACTIVE autorizada; confirma revisión. | Persiste REVIEWED, responsable y fecha; causa, regla y evidencia originales siguen consultables. |
| ALZ-HU-019-E2 | Identificador inválido o cambio concurrente. | Rechazo controlado o recarga del estado vigente; no corrompe la señal. |
| ALZ-HU-019-E3 | Profesor perdió acceso antes de confirmar. | Cancela actualización y no revela datos protegidos adicionales. |
| ALZ-HU-019-E4 | Señal REVIEWED; repite acción. | Operación idempotente: conserva autor y fecha de revisión originales y no duplica el cambio de dominio. |

**Aceptación complementaria:** cancelar la confirmación conserva ACTIVE. Los registros de intentos de operación pueden existir sin duplicar la revisión original.

## 6. Administración institucional

### ALZ-CU-020 — Administrar organizaciones

**Trazabilidad:** ALZ-RF-020 · ALZ-HU-020 · ALZ-PT-020.  
**Documentado. Actor/precondición:** administrador con sesión vigente y permiso de gobierno sobre el ámbito autorizado.

**Flujo normal:** lista organizaciones permitidas → crea/edita nombre, código, estado → valida obligatorios, unicidad y permisos → confirma → persiste y audita. Para archivar, comprueba dependencias activas. **Postcondición:** cambio autorizado, trazable y aislado.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-020-E1 | Administrador autorizado y datos únicos válidos; crea, actualiza y archiva una entidad sin dependencias activas. | Cada cambio persiste y registra actor, fecha, acción y entidad; listado mantiene su ámbito. |
| ALZ-HU-020-E2 | Código duplicado o falta nombre; guarda. | Rechazo con campo identificado; entidad anterior intacta. |
| ALZ-HU-020-E3 | Administrador A intenta consultar/modificar B sin autorización. | Deniega y no entrega datos de B. |
| ALZ-HU-020-E4 | Organización contiene usuarios, clases o documentos; solicita eliminar. | Bloquea eliminación física y presenta alternativa de archivado; si las dependencias están activas, también bloquea archivar e informa qué debe resolverse. |

**Pendiente:** creación inicial/ámbito de administración de organizaciones. La precondición requiere un permiso real; no presume acceso global por el simple rol.

### ALZ-CU-021 — Administrar usuarios y roles

**Trazabilidad:** ALZ-RF-021 · ALZ-HU-021 · ALZ-PT-021.  
**Documentado. Actor/precondición:** administrador de organización activa, con permiso sobre identidades.

**Flujo normal:** busca usuario o inicia invitación → define correo, estado y roles autorizados → valida formato, organización y combinaciones → confirma → crea invitación o actualiza identidad → audita. **Postcondición:** estado/roles coherentes y organización con administración activa.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-021-E1 | Correo nuevo y rol permitido; invita, activa y luego deshabilita una cuenta de prueba. | Se observan INVITED, ACTIVE y DISABLED según operaciones válidas, con auditoría; solo ACTIVE opera. |
| ALZ-HU-021-E2 | Correo duplicado/mal formado o rol no permitido. | No duplica identidad ni asigna rol inválido; conserva estado anterior y ofrece tratar identidad existente cuando procede. |
| ALZ-HU-021-E3 | Administrador A intenta gestionar usuario/roles de B. | Deniega y conserva aislamiento. |
| ALZ-HU-021-E4 | Solo queda un administrador ACTIVE; intenta deshabilitarlo o quitar su rol. | Bloquea ambas operaciones y mantiene administración activa. |

**Aceptación complementaria:** verificar control del último administrador bajo operaciones concurrentes. **Pendiente:** canal y expiración de invitación, combinaciones de roles y reutilización de una identidad Auth en varias organizaciones.

### ALZ-CU-022 — Administrar cursos, clases y asignaciones

**Trazabilidad:** ALZ-RF-022 · ALZ-HU-022 · ALZ-PT-022.  
**Documentado. Actor/precondición:** administrador y profesores dentro de una organización activa.

**Flujo normal:** selecciona/crea curso → configura código, nombre, período, clase y profesor → valida unicidad, fechas y pertenencia → guarda relaciones → registra cambio. **Postcondición:** estructura académica consistente y autorizada.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-022-E1 | Profesor ACTIVE de A y fechas coherentes; crea curso/clase y asigna. | Relaciones recuperables dentro de A con código único y auditoría. |
| ALZ-HU-022-E2 | Código duplicado, fechas incoherentes o profesor DISABLED. | No guarda relaciones inválidas y explica dato a corregir. |
| ALZ-HU-022-E3 | Usuario sin permiso intenta modificar curso/clase. | No cambia la estructura ni devuelve información fuera de alcance. |
| ALZ-HU-022-E4 | Profesor pertenece a B; administrador A intenta asignarlo a clase A. | Rechazo por aislamiento; la asignación existente permanece. |

### ALZ-CU-023 — Administrar taxonomía de conceptos

**Trazabilidad:** ALZ-RF-023 · ALZ-HU-023 · ALZ-PT-023.  
**Documentado. Actor/precondición:** administrador de organización activa.

**Flujo normal:** lista conceptos activos/archivados y referencias → define nombre, descripción y relaciones → valida unicidad/ciclos → confirma creación, edición o archivado → guarda versión y auditoría. **Postcondición:** taxonomía disponible sin romper historia.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-023-E1 | Concepto nuevo con relaciones acíclicas; crea y luego edita. | Se conserva versión anterior, nueva definición y registro de cambio dentro de organización. |
| ALZ-HU-023-E2 | Nombre normalizado duplicado o relación que crea ciclo. | Rechaza y señala concepto/relación conflictiva sin alterar taxonomía previa. |
| ALZ-HU-023-E3 | Usuario sin permiso o concepto fuera del ámbito. | No puede modificar ni enumerar taxonomía protegida ajena. |
| ALZ-HU-023-E4 | Concepto usado por ejercicios/actividades; solicita eliminar. | Permite tratamiento por archivado o reemplazo controlado conservando referencias históricas; no borra la historia. |

**Pendiente:** algoritmo de normalización y criterio de reasignación frente a confirmación de archivado. Probar una relación consigo mismo y un ciclo indirecto cuando el contrato esté cerrado.

### ALZ-CU-024 — Gobernar banco reutilizable de ejercicios

**Trazabilidad:** ALZ-RF-024 · ALZ-HU-024 · ALZ-PT-024.  
**Documentado. Actor/precondición:** administrador autenticado con organización y taxonomía disponibles.

**Flujo normal:** selecciona/crea ejercicio → consulta propietario, versión, visibilidad, conceptos y usos → modifica contenido/políticas → valida propiedad, pruebas y alcance → publica versión o archiva → conserva versiones referenciadas y audita. **Postcondición:** banco gobernado con historia inmutable.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-024-E1 | Ejercicio autorizado; modifica propiedad/visibilidad permitida o archiva. | El cambio permitido es recuperable y auditado; versiones/usos históricos continúan disponibles en su contexto. |
| ALZ-HU-024-E2 | Pruebas inconsistentes o política inválida; confirma. | No publica versión incoherente ni cambia las referencias anteriores. |
| ALZ-HU-024-E3 | Intenta ampliar visibilidad fuera de organización o gobernar ejercicio ajeno. | Rechaza sin fuga de contenido ni cambio de propietario/visibilidad. |
| ALZ-HU-024-E4 | Versión referenciada por actividad PUBLISHED; solicita editarla. | Crea versión nueva; la actividad conserva referencia y contenido de la versión anterior. |

**Aceptación complementaria:** comparar antes/después un intento antiguo para comprobar que diagnóstico, código, pruebas y conceptos usados no se reescriben. Tratamiento del archivado sobre disponibilidades vigentes pendiente según ALZ-CU-008.

### ALZ-CU-025 — Gobernar materiales para IA/RAG

**Trazabilidad:** ALZ-RF-025 · ALZ-HU-025 · ALZ-PT-025.  
**Documentado. Actor/precondición:** administrador de organización/curso activos con fuente admitida.

**Flujo normal:** selecciona curso, clase, archivo y visibilidad → valida formato/tamaño/metadatos/permisos → carga o reindexa → fragmenta/indexa con aislamiento → consulta versión, fecha, estado y fragmentos. **Postcondición:** fuente gobernada, recuperable solo en su ámbito autorizado.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-025-E1 | Material autorizado válido; carga y consulta estado. | Metadatos, versión, fecha y fragmentos coherentes; configuración 500/50/top-k=5 aplicada. |
| ALZ-HU-025-E2 | Más de 10 MB, formato distinto o archivo sin texto. | Rechazo con causa accionable y sin índice utilizable creado. |
| ALZ-HU-025-E3 | Usuario sin permiso intenta gobernar material o ampliar su alcance. | Deniega y mantiene visibilidad/índice anterior autorizado. |
| ALZ-HU-025-E4 | Fuente pertenece a B; se intenta recuperar o reasignar a A. | Filtros de organización/clase la excluyen y se audita la acción indebida. |

**Aceptación complementaria:** falla de indexación conserva estado fallido, no publica fragmentos parciales y permite reintentar; una reindexación exitosa no mezcla fragmentos de versiones incompatibles. Precisar la publicación de versiones en [IA](08-ia-y-procesamiento.md).

### ALZ-CU-026 — Configurar y versionar reglas de señales

**Trazabilidad:** ALZ-RF-026 · ALZ-HU-026 · ALZ-PT-026.  
**Documentado. Actor/precondición:** administrador autorizado para configurar señales.

**Flujo normal:** consulta versiones/parámetros → define umbrales/vigencia → valida línea base → guarda versión → activa → cierra vigencia anterior → audita. **Postcondición:** versión vigente con autor, fecha, parámetros e historial; las señales identifican la versión aplicada.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-026-E1 | Configuración válida con umbrales documentados; crea y activa versión. | Nueva versión vigente; anterior conservada; autor/fecha/vigencia verificables; nuevas señales referencian versión aplicable. |
| ALZ-HU-026-E2 | Intenta sobrescribir versión activa o vigencia inconsistente. | Exige versión nueva/rechaza vigencia; evidencia calculada y configuración previa intactas. |
| ALZ-HU-026-E3 | Profesor, estudiante o administrador fuera del ámbito cambia reglas. | Deniega y conserva parámetros/versiones. |
| ALZ-HU-026-E4 | Umbral negativo, incompleto o inconsistente; publica. | Rechazo con parámetros identificados y configuración anterior todavía vigente. |

**Pendiente:** rangos permitidos y política de recálculo al activar reglas. Los valores 7 días, 3 intentos y ventana de 14 días son la línea base; no se cambian solo porque exista formulario de configuración. Ninguna activación debe reescribir la versión citada por evidencia histórica.

### ALZ-CU-027 — Consultar auditoría y exportar registros operativos

**Trazabilidad:** ALZ-RF-027 · ALZ-HU-027 · ALZ-PT-027.  
**Documentado. Actor/precondición:** administrador con permiso de auditoría y sesión vigente.

**Flujo normal:** define fecha/actor/acción/entidad → valida y aplica ámbito → consulta con paginación → lista actor, fecha, acción, entidad, identificador y resultado → exporta vista filtrada como CSV UTF-8 → registra descarga. **Postcondición:** salida autorizada e íntegra, con trazabilidad de consulta/exportación.

| Escenario | Dado / cuando | Entonces verificable |
| --- | --- | --- |
| ALZ-HU-027-E1 | Filtros válidos con registros de A; consulta y exporta. | La consulta y CSV contienen registros del mismo filtro/ámbito, columnas operativas acordadas y auditoría de exportación. |
| ALZ-HU-027-E2 | Fechas inválidas o consulta excede límite de exportación. | Identifica error o solicita acotar filtros; no genera CSV parcial presentado como completo. |
| ALZ-HU-027-E3 | Filtro intenta acceder a B o dato restringido. | Deniega consulta o excluye campo restringido según contrato; registra intento y no exporta información ajena. |
| ALZ-HU-027-E4 | Filtros válidos sin filas; solicita CSV. | Archivo UTF-8 con encabezados, alcance y sello temporal; sin filas ficticias ni datos de otra organización. |

**Pendiente:** columnas exactas, tamaño máximo, contenido de alcance/sello temporal y paginación deben fijarse en [API](07-api-y-contratos.md) y [datos](06-modelo-de-datos.md). Verificar tratamiento seguro de celdas CSV y exclusión de secretos/código/prompts en [seguridad](09-seguridad-y-privacidad.md).

## 7. Aceptación integrada y fallas transversales

**Propuesta técnica de guion.** Ejecutar estos recorridos sobre los fixtures, conservando los identificadores de intentos, fuentes, reglas y organizaciones para comprobar cada enlace. Las obligaciones observadas corresponden a los requisitos documentados.

| Recorrido | Acción y variación | Resultado obligatorio |
| --- | --- | --- |
| Publicación a seguimiento | Crear clase/ejercicio/actividad; publicar; inscribir; ejecutar; enviar; consultar resultado y tablero. | Solo usuarios autorizados recorren el flujo; el intento y sus pruebas explican los agregados. |
| Recuperación pedagógica | Enviar resultado fallido, solicitar pista/feedback, abrir fuente, reintentar con mejora. | Fuente autorizada y cinco campos válidos; nuevo intento distinto; progreso derivado de pruebas, sin nota IA. |
| IA indisponible | Desactivar generación después de persistir un intento. | PROVIDER_UNAVAILABLE; intento, resultado, reintento, progreso y tablero continúan operables. |
| Corpus insuficiente | Solicitar ayuda con corpus vacío/no pertinente de esa clase. | NO_EVIDENCE, referencias vacías, explicación técnica conservada y ausencia de citas inventadas. |
| Persistencia indisponible | Fallar guardado durante envío. | No confirma intento, no llama IA/RAG, no inventa progreso y conserva editor. |
| Aislamiento | Repetir consultas/mutaciones con clase B o segunda clase de A no autorizada. | API, datos, Storage, RAG, tableros y CSV niegan datos ajenos. |
| Cierre mientras se trabaja | Profesor cierra antes de que el estudiante confirme envío; agregar carrera antes/después de admisión del servidor según DEC-002. | Envío aún no admitido: rechazo y borrador conservado. Propuesta pendiente: admitido mientras PUBLISHED puede terminar y persistirse tras cierre; solo entonces se confirma guardado. |
| Evidencia histórica | Editar ejercicio publicado y activar otra versión de regla. | Actividad/intento/señal previos conservan las versiones que sustentan su evidencia. |
| Señal y revisión | Crear fixture de regla cumplida, abrir evidencia y revisar dos veces. | Señal explicable; segunda revisión no cambia responsable ni fecha originales. |
| Interfaz accesible y falla | Repetir flujo por teclado, con carga lenta, vacío y error. | Mensajes accionables, foco visible, estado comprensible y ausencia de dependencia exclusiva del color. |

## 8. Criterio de cierre

La aceptación de cada ALZ-PT-NNN requiere ejecutar sus cuatro escenarios originales y los complementos que cubren obligaciones no representadas por ellos, registrar resultados reales y revisar las fallas. Las pruebas negativas se realizan tanto desde interfaz como directamente contra las operaciones protegidas. Las propuestas pendientes deben quedar acordadas antes de declarar aprobado su comportamiento específico.

Los 108 escenarios enumerados son **especificados/planificados**, no «aprobados», «implementados» ni «probados». La evidencia futura debe enlazarse desde [calidad y pruebas](10-calidad-y-pruebas.md) y el [plan de entrega](12-plan-de-entrega.md), manteniendo la relación con las fuentes originales.
