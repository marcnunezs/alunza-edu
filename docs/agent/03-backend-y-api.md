# Instrucciones para implementar backend y API

Este archivo guía al agente que implemente el código. No acredita endpoints, integraciones ni pruebas existentes. Aplica primero las instrucciones del usuario y las instrucciones de mayor prioridad. Usa los specs como contrato de producto y conserva la distinción entre requisitos documentados, propuestas y decisiones pendientes.

## Cuándo leer y qué consultar

Lee esta guía al crear o modificar una ruta de negocio, un servicio de aplicación, un contrato público, una integración o un trabajador. Lee las secciones pertinentes de estas fuentes antes de programar:

| Fuente | Para qué usarla |
| --- | --- |
| [Fuentes y decisiones](../../specs/00-fuentes-y-decisiones.md) | Autoridad documental y DEC-001/002/004/007. |
| [Requisitos funcionales](../../specs/02-requisitos-funcionales.md) y [aceptación](../../specs/03-flujos-y-criterios-de-aceptacion.md) | Identificar ALZ-RF, HU, CU y PT de cada operación. |
| [Arquitectura](../../specs/05-arquitectura.md) | Límites de NestJS, módulos y puertos. |
| [API y contratos](../../specs/07-api-y-contratos.md) | Rutas propuestas, DTO, errores, idempotencia y proyecciones. |
| [Datos](../../specs/06-modelo-de-datos.md) y [seguridad](../../specs/09-seguridad-y-privacidad.md) | Invariantes transaccionales y autorización real. |

Coordina cambios de persistencia con [datos y migraciones](04-datos-y-migraciones.md) y todos los permisos con [seguridad y permisos](09-seguridad-y-permisos.md). No copies el catálogo completo de rutas a otro documento: mantén su trazabilidad y actualiza el contrato ejecutable junto con la implementación.

Para integrar otros componentes, lee [fundación y arquitectura](02-fundacion-y-arquitectura.md), [frontend y UX](05-frontend-y-ux.md), [ejecución segura](06-ejecucion-segura.md), [IA y RAG](07-ia-y-rag.md) y [progreso y señales](08-progreso-y-senales.md) según el corte. Usa [decisiones pendientes](12-decisiones-pendientes.md) para registrar elecciones y [pruebas y evidencias](10-pruebas-y-evidencias.md) para el cierre.

## Responsabilidad y límites

1. Conserva Next.js como experiencia web y NestJS como API de negocio. Implementa identidad, autorización, dominio, auditoría y orquestación en NestJS; evita duplicarlas en Server Actions o Route Handlers de Next.js.
2. Conserva Node.js 24, NestJS 12 y TypeScript 5.x como familias documentadas. Antes de instalar, verifica compatibilidad y versiones exactas con documentación oficial, registra DEC-007 y fija el lockfile. No copies por inercia los valores de un generador ni sustituyas Jest por otra herramienta sin tratar la decisión.
3. Usa la distribución modular propuesta en arquitectura como punto de partida. Mantén el dominio libre de SDKs cloud. Los puertos de ejecución, generación, embeddings y almacenamiento reciben contratos explícitos; los adaptadores encapsulan proveedores.
4. Mantén progresos y señales independientes de IA. El navegador y el modelo no aportan diagnósticos canónicos, autoría confiable, permisos ni completitud.
5. Implementa contratos compartidos únicamente para información pública. Excluye pruebas ocultas, soluciones internas, secretos y credenciales de los paquetes que puedan llegar al frontend.

## Procedimiento por capacidad

1. Selecciona un corte funcional completo: enumera RF/PT, actor, recurso, estados de entrada y resultado esperado. Lee sus escenarios de éxito, rechazo, vacío y fallo; no implementes un CRUD genérico y lo des por equivalente al caso de uso.
2. Inspecciona código, configuración y decisiones existentes. Reutiliza convenciones comprobadas. Distingue código real, mocks y adaptadores pendientes antes de modificar archivos.
3. Define el DTO de entrada, salida y error, el permiso por operación y la proyección de datos. Usa `/api/v1`, `camelCase`, UUID y fechas UTC donde sean instantes, según la propuesta DEC-004. Conserva las cinco claves `snake_case` del contrato RAG.
4. Añade validación en el límite de la API. Rechaza campos desconocidos, filtros u órdenes fuera de lista permitida, números no finitos y nulabilidad no declarada. Deriva actor y ámbito desde identidad verificada y relaciones actuales; un ID del payload solo identifica un recurso solicitado.
5. Implementa autenticación y autorización antes de consultar datos sensibles o invocar proveedores. Filtra el recurso, lista, conteo y agregado por su ámbito desde la consulta inicial. No recuperes todas las filas para filtrarlas después de paginar.
6. Implementa el caso de uso en un servicio de aplicación. Explicita sus reglas puras, transacción, auditoría obligatoria y efectos externos. Ejecuta los efectos externos fuera de transacciones de base de datos.
7. Aplica idempotencia, control de versión y exclusión donde corresponda. Devuelve el recurso realmente confirmado; no conviertas reservas, tareas en memoria o respuestas del proveedor en persistencia acreditada.
8. Publica o genera OpenAPI con esquemas, permisos, ejemplos seguros y errores. Comprueba que las respuestas reales coincidan con los DTO consumidos por el frontend.
9. Ejecuta las pruebas pertinentes del corte con identidades ficticias de dos organizaciones. Registra qué rutas, fallos y carreras quedaron demostrados y qué integración aún depende de un servicio real.

## Secuencias críticas

### Sesión, membresías y gobierno

- Integra inicio, renovación, invitación y cierre con Supabase Auth. Valida el JWT en NestJS y consulta estado vigente; no guardes contraseñas ni emitas un token de dominio alternativo.
- Para ALZ-RF-002/003/021/022, valida curso, clase, estado y pertenencia institucional. Acepta códigos o invitaciones mediante consumo e inscripción atómicos, sin duplicar la membresía.
- Para ALZ-RF-020, implementa el gobierno del ámbito existente y prepara el contrato de aprovisionamiento. No habilites creación global para cualquier `ADMIN`; DEC-001 debe definir el permiso para cerrar esa función. El seed de dos organizaciones sirve a la demo y no reemplaza el requisito.
- Para ALZ-RF-021, serializa los cambios de rol y deshabilitación que afecten al último administrador activo. Confirma la auditoría con el cambio efectivo.

### Contenido, publicación y cierre

- Para ALZ-RF-004/005/023/024, valida conceptos, dificultad y contrato de pruebas; conserva versiones utilizadas. Publica solo contenido válido y fija versiones, orden y conjunto requerido dentro de la transacción.
- Impide reaperturas implícitas y cambios silenciosos en el conjunto evaluado de una actividad publicada. Las políticas de historial `CLOSED`, ventana de disponibilidad, archivado y admisión concurrente requieren DEC-002.
- Diseña una función explícita de admisión y una prueba de carrera entre enviar/cerrar. La propuesta de conservar una ejecución ya admitida debe quedar identificada como propuesta hasta resolver DEC-002; no inventes otro momento de corte.

### Ejecución, envío y feedback

1. Para ALZ-RF-009, valida identidad, pertenencia, publicación y versión. Ejecuta mediante el puerto aislado las pruebas visibles. Una ejecución de práctica no confirma un intento ni aumenta el progreso.
2. Para ALZ-RF-010/011/014, reserva la idempotencia y registra admisión con versión y hora del servidor. Ejecuta de nuevo las pruebas requeridas con el código recibido; no aceptes un `executionId` anterior ni resultados calculados en el navegador como comprobante.
3. Recibe evidencia normalizada desde el supervisor de confianza conforme a [ejecución controlada](../../specs/13-ejecucion-controlada.md). Rechaza resultados incoherentes antes de persistirlos.
4. Confirma intento, código, resultado canónico, eventos y respuesta idempotente en una transacción. Conserva todos los reintentos deliberados como filas distintas. Solo tras el commit responde `201` y permite solicitar IA/RAG.
5. Si falla el commit, devuelve un error recuperable y no invoques IA/RAG. Permite reconciliar la misma clave sin duplicar el intento ni afirmar que fue guardado.
6. Para ALZ-RF-012/013, crea un trabajo durable después de verificar intento y resultado persistidos. Devuelve `202` únicamente si la solicitud y su trabajo quedaron guardados. Valida la salida conforme a [IA y procesamiento](../../specs/08-ia-y-procesamiento.md).
7. Conserva intento y resultado ante demora o falla de IA. Distingue ciclo del trabajo (`QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`) de los tres estados pedagógicos RAG.

### Trabajos, consultas y exportaciones

- Usa el mecanismo durable propuesto en DEC-004: adquisición atómica, lease, vencimiento, reintentos acotados y deduplicación. Recupera trabajos interrumpidos después de un reinicio; no prometas entrega mediante una cola únicamente en memoria.
- Transporta IDs mínimos. Revalida recurso, versión y permisos al ejecutar y antes de publicar o entregar resultados. Serializa trabajos y cron que puedan competir entre réplicas.
- Sirve progreso y señales según [progreso y señales](../../specs/14-progreso-y-senales.md), con evidencias y denominador explícitos. Usa las proyecciones autorizadas de estudiante o profesor.
- Para ALZ-RF-027, exporta únicamente campos operativos y filtros autorizados, en CSV UTF-8. Escapa el formato, neutraliza fórmulas y audita solicitud y entrega o fallo. Una exportación vacía conserva encabezados; no exportes tablas completas.

## Contratos que no debes confundir

| Situación | Tratamiento exigido por el contrato |
| --- | --- |
| Programa estudiantil con error | Respuesta de ejecución procesada con diagnóstico; no error HTTP 500 por el error del alumno. |
| `TIMEOUT` del programa | Diagnóstico técnico distinto del plazo de infraestructura HTTP 504. |
| IA sin proveedor | Feedback degradado `PROVIDER_UNAVAILABLE`; no pérdida de intento ni cambio de diagnóstico. |
| Misma clave y mismo payload | Mismo recurso; si sigue en curso, conflicto recuperable con `Retry-After`. |
| Misma clave y otro payload | Conflicto; no sobrescribir ni crear otro efecto. |
| Edición sobre ETag anterior | `412 PRECONDITION_FAILED`; no pérdida silenciosa de cambios. |
| ID ajeno no consultable | Respuesta segura equivalente a recurso inexistente, sin revelar existencia. |
| Dato privado | Proyección mínima y `Cache-Control: no-store`, sin caché compartida incompleta. |

Consulta el catálogo íntegro de [API](../../specs/07-api-y-contratos.md). No agregues valores a diagnóstico, RAG, actividad, usuario o señal para describir errores operativos.

## Decisiones y trabajo que puede avanzar

| Decisión | Acción del agente |
| --- | --- |
| DEC-001 | Prepara permiso y escenarios de aprovisionamiento y roles; continúa con autorización de los ámbitos definidos. No concedas privilegio global por defecto. |
| DEC-002 | Prepara política explícita y prueba reproducible de cierre/admisión. No cierres RF-005/010 ni expongas historial adicional con una regla no resuelta. |
| DEC-004 | Registra las elecciones reversibles de serialización, DTO y operación. Resuelve `startsAt/endsAt` frente a `startDate/endDate` de clase antes del esquema ejecutable; conserva fechas académicas como fechas si ese es el modelo elegido. |
| DEC-004/009 | Mantén límites de cuerpo, longitud, paginación y retención de claves como configuración propuesta. No atribuyas aprobación a 24 horas o a los límites sugeridos. |
| DEC-007 | Verifica compatibilidad real y registra patches, gestor de paquetes y workspace. Una elección reversible compatible puede documentarse sin pedir autorización repetitiva. |

Si una decisión altera alcance, arquitectura, seguridad o comportamiento pedagógico, presenta una opción concreta con su impacto y atiende la resolución del usuario. Continúa tareas independientes mientras falta esa resolución; no bloquees todo el backend por una operación pendiente.

## Evidencia y criterio de cierre

Entrega código modular, DTO y OpenAPI coherentes, adaptadores separados, configuración de ejemplo sin secretos y pruebas del corte funcional. Identifica explícitamente cualquier stub o simulación restante.

Antes de declarar la capacidad terminada, demuestra el caso permitido y las variantes inválida, ajena e inactiva. Para mutaciones críticas demuestra además concurrencia, idempotencia, fallo de persistencia y auditoría atómica. Para envío prueba que el proveedor IA no se llama antes del commit y que la caída posterior no altera resultado ni historial. Verifica reinicio del trabajador para cualquier `202` durable implementado.

No cierres solo porque el controlador responde o compila. Cierra cuando los RF/PT del corte estén trazados a evidencia ejecutada, la ruta use persistencia y autorización reales del ambiente de prueba, las decisiones aplicables estén tratadas y los errores permitan al cliente conservar trabajo y reconciliar el resultado.
