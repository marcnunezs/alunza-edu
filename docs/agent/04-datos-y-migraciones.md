# Instrucciones para implementar datos y migraciones

Lee esta guía antes de crear tablas, SQL, repositorios, RLS, índices, seeds o proyecciones. Está dirigida al agente que escriba la implementación; no afirma que exista una base de datos ni que alguna migración se haya ejecutado. Las instrucciones superiores y del usuario prevalecen sobre esta guía.

## Fuentes y responsabilidad

Usa [modelo de datos](../../specs/06-modelo-de-datos.md) como diccionario lógico propuesto, [fuentes y decisiones](../../specs/00-fuentes-y-decisiones.md) para su estado, [arquitectura](../../specs/05-arquitectura.md) para conexiones y servicios, y [API](../../specs/07-api-y-contratos.md) para el mapeo público. Lee [seguridad](../../specs/09-seguridad-y-privacidad.md) al definir cualquier privilegio, vista, función o política.

La persistencia soporta los 27 RF: presta especial atención a ALZ-RF-003/010/011/014/019/021 por su idempotencia o concurrencia y a ALZ-RF-004/005/023/024/025/026 por su historia versionada. Comprueba aceptación con DAT-01 a DAT-10 del modelo y los [escenarios funcionales](../../specs/03-flujos-y-criterios-de-aceptacion.md).

Coordina servicios y transacciones con [backend y API](03-backend-y-api.md) y permisos con [seguridad y permisos](09-seguridad-y-permisos.md). No traslades el MER Oracle histórico a PostgreSQL de forma automática: consérvalo como antecedente y utiliza las entidades actuales del MVP.

Para definir contratos de evidencia consulta las guías de [ejecución segura](06-ejecucion-segura.md), [IA y RAG](07-ia-y-rag.md) y [progreso y señales](08-progreso-y-senales.md). Coordina scripts y recuperación con [operación y entrega](11-operacion-y-entrega.md), el tratamiento de DEC con [decisiones pendientes](12-decisiones-pendientes.md) y la evidencia con [pruebas](10-pruebas-y-evidencias.md).

## Preparación del esquema

1. Inspecciona migraciones, configuración local y esquema real si existen. Identifica el estado inicial y cambios del usuario. No asumas que el repositorio documental contiene infraestructura funcional.
2. Consulta DEC-006 antes de emitir la primera migración. Prepara un diccionario revisable con entidades, campos, nulabilidad, claves, invariantes y mapeos API. Si falta la revisión prevista, conserva el DDL como propuesta y continúa contratos, fixtures y reglas puras independientes; no afirmes que el modelo quedó aprobado.
3. Verifica la versión real de PostgreSQL, pgvector y CLI al preparar el ambiente. Conserva compatibilidad objetivo PostgreSQL 17 y el stack Supabase; registra diferencias y pruebas en DEC-007. No elijas dimensión vectorial hasta tratar DEC-010.
4. Agrupa migraciones por dependencias: identidad/organizaciones, estructura académica, contenido/versiones, práctica/evidencia, fuentes/feedback y reglas/señales/auditoría. Incluye persistencia operativa cuando la requiera cada flujo.
5. Mantén tablas, restricciones, privilegios, funciones, RLS e índices versionados. Define explícitamente cómo se relacionan y autorizan los objetos Storage; un bucket creado a mano sin procedimiento reproducible no satisface la inicialización.
6. Resuelve referencias cíclicas del diccionario con orden de creación y estrategia de restricciones explícita. No elimines una FK necesaria solo para que el primer script ejecute.

## Reglas al escribir DDL y repositorios

- Usa los nombres físicos `snake_case` y mapea a `camelCase` en la API. Conserva sin renombrar las claves documentadas del payload RAG.
- Usa UUID del servidor y relaciona `profiles.id` con `auth.users.id`. No uses correo, fecha ni código de ingreso como clave primaria y no dupliques contraseñas de Auth.
- Usa `timestamptz` UTC para eventos y `date` para fechas académicas. Resuelve el desacuerdo de campos de clase bajo DEC-004 antes de crear contratos incompatibles.
- Mantén `organization_id` en entidades institucionales y `class_id` cuando el recurso pertenezca a clase. Define las claves únicas necesarias para FK compuestas por organización y, donde corresponda, clase. Un UUID de otra organización debe fallar también en persistencia.
- Define unicidad en el ámbito correcto: membresía, código de curso/clase, versión, posición de ejercicio y clave de operación. Separa identidad global de Auth de visibilidad institucional; una organización no consulta directorios globales de cuentas.
- Modela enums cerrados, contadores no negativos y relaciones de contadores válidas. No conviertas motivos operativos en diagnósticos ni la falta de evidencia en un tercer estado de señal.
- Usa `jsonb` solo para evidencia, parámetros o metadatos con esquema; conserva FK y atributos de autorización como relaciones comprobables.
- Aplica inmutabilidad a intentos confirmados, evidencia canónica, versiones publicadas o usadas, reglas activadas y auditoría. Crea nuevas versiones o reintentos para cambios legítimos; no reescribas historia para que un agregado coincida.
- Protege pruebas ocultas mediante esquema, grants y proyecciones. RLS por fila no basta para ocultar columnas ni expectativas de pruebas.
- Usa archivado o restricciones de borrado sobre entidades referenciadas. No propagues eliminación de organizaciones o catálogos a intentos, citas y auditoría con cascadas destructivas.
- Parametriza SQL y contexto transaccional. No permitas que un repositorio reciba SQL, rol o ámbito confiable desde el navegador.

## Implementa cada unidad de consistencia

| Operación | Pasos que deben confirmar juntos |
| --- | --- |
| Inscripción | Verificar token/digest y vigencia; consumir uso permitido; crear una sola membresía; conservar evento y auditoría requerida. |
| Cambio administrativo | Serializar por organización la protección del último administrador; aplicar rol/estado; guardar auditoría. |
| Publicación | Validar contenido y tests; fijar versiones, orden y requeridos; cambiar estado y auditar. |
| Admisión de envío | Validar pertenencia y disponibilidad; reservar clave/hash; conservar hora y versión de admisión conforme a DEC-002. La reserva todavía no es un intento. |
| Confirmación de intento | Vincular ejecución autorizada, intento, código, versión, resultado canónico, eventos y respuesta idempotente. Responder éxito solo después del commit. |
| Solicitud de feedback | Comprobar intento durable; reservar solicitud/nivel; crear trabajo durable en la misma transacción o un outbox equivalente acordado. |
| Activación de índice | Comprobar generación completa; cambiar el puntero de generación/versión activa; auditar. No publicar fragmentos parciales. |
| Activación de regla | Serializar por organización y tipo; cerrar vigencia anterior; activar nueva versión; auditar sin reescribir señales históricas. |
| Revisión de señal | Insertar la única revisión y cambiar `ACTIVE → REVIEWED`; conservar primer autor/fecha y evidencia; auditar una única acción efectiva. |

Ejecuta sandbox, embeddings, generación y entrega externa fuera de una transacción de base de datos abierta. El patrón durable debe permitir reintento sin duplicar el efecto lógico. Nunca devuelvas `201` o `202` apoyándote solo en memoria del proceso.

Para `operation_keys`, impón unicidad por actor, organización, operación y clave; compara hash de payload. Reconcilia reservas vencidas antes de reejecutar. Para `background_jobs`, implementa reclamación atómica, lease, reintentos acotados y finalización coherente con el resultado. Revalida alcance y permisos en el consumidor.

## Conservación y proyecciones

1. Vincula cada resultado canónico a la misma organización, clase, estudiante, actividad y versión del intento. Comprueba que `previous_attempt_id` pertenezca al mismo estudiante y ejercicio de actividad.
2. Guarda un evento semántico una sola vez con clave deduplicable y hora del servidor. Consulta [progreso y señales](../../specs/14-progreso-y-senales.md) para elegibilidad; GET, sondeos y telemetría arbitraria no constituyen aprendizaje.
3. Construye progreso desde intentos confirmados y pruebas requeridas. Cuenta ejercicios distintos, conserva numerador y denominador y devuelve ausencia de evidencia cuando el denominador sea cero. No uses cantidad de intentos ni una respuesta IA para completitud.
4. Conserva regla, parámetros, ventana y evidencia con cada señal. No recalcules su evidencia histórica al revisar o al activar otra regla. Coordina las precisiones de ventana y deduplicación con DEC-005.
5. Separa identidad de fuente, versión de binario y generación de índice. Reemplazar el contenido crea versión nueva; reindexar crea generación nueva. Solo una generación completa `READY` puede volverse recuperable, conforme a [IA/RAG](../../specs/08-ia-y-procesamiento.md).
6. Mantén referencias a fuentes y fragmentos existentes y realmente recuperados. Escribe JSON público y relación de citas de forma coherente o construye el primero desde la segunda. Conservar una cita histórica no exime de autorización vigente al abrirla.
7. Trata vistas y cachés como reconstruibles. Documenta origen, versión de cálculo y procedimiento de reconstrucción; incluye ámbito completo en claves de caché y evita compartir datos personales por CDN.

## RLS e índices

Implementa autorización de aplicación y defensa en persistencia conforme a [seguridad y permisos](09-seguridad-y-permisos.md). Usa el rol de aplicación sin `BYPASSRLS` y contexto verificado local a cada transacción. No uses `service_role` como conexión ordinaria de CRUD ni evalúes políticas solo como propietario de las tablas.

Prueba `USING`, `WITH CHECK`, grants, funciones y vistas con las identidades que realmente los utilizarán. Incluye el cambio malicioso de organización, autor o clase de una fila. Comprueba que el pool no conserve contexto de otra solicitud.

Crea los índices candidatos del modelo cuando respalden consultas implementadas y restricciones necesarias. Examina planes y latencias con RLS activada. En recuperación vectorial filtra permisos dentro de la consulta; no sustituyas aislamiento por obtener top-k global y ocultar resultados después. No agregues índices a todas las columnas sin evidencia ni mezcles dimensiones/modelos de embeddings.

## Migración y datos ficticios reproducibles

1. Diseña instalación vacía y actualización desde la versión anterior. Añade nuevas migraciones para cambios ya aplicados; conserva el historial existente y registra compatibilidad con servicios que puedan desplegarse por separado.
2. Cuando cambie un contrato compartido, prepara expansión y posterior contracción. No borres una columna usada por una versión activa de la API o del trabajador.
3. Antes de ejecutar una migración, identifica ambiente, destino y alcance autorizado. No confundas el entorno local desechable con un servicio compartido. Preparar código de migración no equivale a autorizar un despliegue o una eliminación de datos.
4. Define recuperación verificable según la operación: reversión cuando sea segura o restauración/avance correctivo cuando no lo sea. No prometas una reversión que recupera datos eliminados sin respaldo probado.
5. Implementa seed determinista e idempotente de exactamente 2 organizaciones, 2 administradores, 2 profesores, 8 estudiantes, 3 clases, 10 ejercicios y 6 documentos, dos por clase. Usa la distribución propuesta de [operación](../../specs/11-operacion-y-despliegue.md) y registra DEC-012.
6. Usa identidades y corpus ficticios, IDs estables y reloj controlado para evidencia temporal. Mantén fixtures adversariales adicionales fuera del conteo de la demo. No incrustes contraseñas, claves cloud o tokens utilizables en el repositorio.
7. Proporciona comandos reales comprobados para migrar, inicializar, verificar conteos y reconstruir proyecciones. Si un comando aún no existe, descríbelo como entregable pendiente; no lo anuncies como ejecutado.

DEC-009 mantiene pendiente retención y eliminación para un piloto real. Continúa la demo ficticia sin inventar una política legal; no apliques borrado irreversible ni incorpores datos reales bajo una suposición de cumplimiento.

## Pruebas y cierre de la capacidad

Entrega migraciones y diccionario coherentes, repositorios con transacciones explícitas, pruebas de integridad/RLS, seed y procedimiento de reconstrucción. Demuestra en el ambiente autorizado:

- Instalación vacía, actualización aplicable y seed repetido sin duplicados ni cambios de conteos canónicos.
- Rechazo por DB de relaciones cruzadas entre organizaciones/clases, más restricciones de autoría, versión y resultado canónico.
- Dos inscripciones, envíos o revisiones concurrentes sin duplicar efectos; misma clave con otro payload produce conflicto.
- Cambios administrativos concurrentes conservan al menos un administrador activo.
- Fallo del commit impide IA/RAG; falla posterior de IA conserva intento y resultado.
- Edición y archivado conservan versiones históricas, citas e intentos; índice parcial nunca aparece en recuperación.
- Reconstrucción del progreso y señales coincide con fixtures, incluido denominador cero.
- Lectura por rol real, vistas expuestas y Storage no revelan datos ajenos ni pruebas ocultas.

Asocia evidencia a DAT-01…DAT-10, RF/PT, commit y ambiente. Distingue pruebas locales de restauración o validación productiva pendientes. No declares terminado el modelo por tener un diagrama ni una migración que solo pasa con privilegios de propietario.
