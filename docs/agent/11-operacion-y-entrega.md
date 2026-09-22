# Instrucciones para operación y entrega

## Cuándo aplicar y qué leer

Aplica este manual al preparar entorno local, scripts, CI, configuración, demo, observabilidad, recuperación o una versión para desplegar. Lee el [AGENTS.md](../../AGENTS.md), [arquitectura](../../specs/05-arquitectura.md), [operación](../../specs/11-operacion-y-despliegue.md), [plan de entrega](../../specs/12-plan-de-entrega.md), [seguridad](../../specs/09-seguridad-y-privacidad.md) y [pruebas y evidencias](10-pruebas-y-evidencias.md).

Los specs partieron de un repositorio documental. Inspecciona el estado actual antes de actuar; los scripts, workflows, aplicaciones y rutas mencionados como destinos futuros no acreditan una implementación. Mantén AD-ARQ-001 y AD-IA-001: web Next.js en Vercel, API/trabajos NestJS en Azure Container Apps, Supabase y pgvector, Azure OpenAI, Vercel Sandbox productivo y Docker local.

## Preparar un entorno reproducible

1. Revisa archivos y cambios existentes, runtime, gestor de paquetes, lockfile, Docker y Supabase CLI. Fija versiones compatibles con Node 24, NestJS 12, React 19, TypeScript 5.x y el Next.js elegido mediante DEC-007. Verifica versiones oficiales cuando instales; no actualices familias por conveniencia del generador.
2. Implementa un conjunto pequeño de scripts con propósitos claros: prerrequisitos, instalación desde lockfile, servicios locales, migración, seed, web/API/trabajador, pruebas y apagado. Documenta nombres y comandos solo después de crearlos y probarlos.
3. Usa Docker Compose y Supabase CLI según la arquitectura. Define propietarios de procesos, puertos y volúmenes para evitar dos instancias incompatibles del mismo servicio. Arranque normal no debe borrar ni reinicializar datos existentes.
4. Valida configuración al inicio con errores accionables y sin valores secretos. Mantén `.env.example` con nombres, descripción, carácter público/secreto, consumidor y obligatoriedad por ambiente; deja valores reales fuera de Git y de logs.
5. Ejecuta migraciones de esquema, funciones, grants, RLS e índices con credencial separada del runtime. La API usa rol limitado sin BYPASSRLS; las operaciones administrativas Auth/Storage usan adaptador acotado.
6. Carga fixtures ficticios idempotentes y muestra conteos. Inicia web/API/trabajador, verifica salud y recorre inicio de sesión, publicación, ejecución y envío. Documenta cualquier dependencia externa o manual que todavía impida arranque limpio.
7. Prueba la guía desde un checkout o entorno limpio sin borrar el workspace del usuario. Conserva comandos/versiones/resultados; corrige pasos implícitos hasta que la reproducción no dependa de una máquina preparada manualmente.

Separa reinicialización de demo del arranque. Si implementas reset, exige destino resuelto, comprobación de ambiente local/de prueba y rechazo explícito de producción; explica el dataset afectado. No lo ejecutes sobre una base compartida o con datos desconocidos solo para simplificar una prueba. En Windows verifica rutas absolutas antes de mover/eliminar recursivamente, y usa operaciones literales en una sola shell.

## Configuración y aislamiento por ambiente

| Ambiente | Construye/configura | Comprueba antes de usar |
| --- | --- | --- |
| Local | Next.js, NestJS/trabajador, Supabase CLI/Compose y ejecutor Docker. | Secretos locales separados, versiones fijadas, migraciones/seed reproducibles y puertos disponibles. |
| CI | Servicios efímeros de prueba, fixtures y ejecución Docker. | Sin credenciales productivas, estado limpio y reportes ligados al commit. |
| Preview | Vercel con API y datos de prueba compatibles. | No apuntar por defecto a producción; origen/callback/CORS explícitos y aislamiento definido entre previews. |
| Demo/MVP | Vercel, Azure Container Apps, Supabase gestionado y Vercel Sandbox. | Ambiente autorizado, costos/cupos fijados, corpus listo y ensayos reales de la vertical. |

Parte del inventario lógico de variables del [spec de operación](../../specs/11-operacion-y-despliegue.md); no dupliques configuraciones contradictorias. Documenta URLs públicas, Auth/JWKS, rol de aplicación/migración, bucket privado, Azure deployments/API/dimensión de embeddings, límites de ejecución, timeout/configuración RAG y metadata de release.

No supongas que esos nombres son leídos automáticamente por los SDK. Implementa el mapeo y la validación. El código estudiantil no recibe secretos de API, Azure, Supabase o Vercel. La autenticación de Azure hacia Vercel Sandbox debe verificarse explícitamente; no asumas que un token OIDC del runtime Vercel existe en Azure Container Apps.

Mantén `APP_ORIGIN`/orígenes permitidos/callbacks acordes al ambiente. Usa configuración mínima por servicio y rotación documentada. No imprimas secretos al diagnosticar una variable ni añadas claves administrativas al prefijo público de Next.js. PR externos no reciben secretos productivos.

## CI y artefactos de release

Implementa GitHub Actions con las fases pertinentes: instalación desde lockfile; formato/lint/tipos; Jest de dominio/contrato; migraciones y RLS sobre BD de prueba; build web/API; integración y Cypress de la vertical; publicación de evidencias. Respeta dependencias entre fases y paraleliza solo trabajos aislados. Si una fase no se pudo ejecutar, haz visible su estado; no la conviertas en paso verde mediante una captura de error genérica.

Identifica el artefacto construido por commit/digest, junto con migraciones, versión de corpus, prompts/configuración y arnés. Promueve el mismo artefacto probado. No recompiles con dependencias distintas ni despliegues una imagen API que no corresponde al candidato.

Documenta el vínculo preview web → API de prueba compatible en los artefactos operativos. No expongas detalles internos innecesarios a estudiantes. Diseña la transición de contratos cuando web y API puedan estar temporalmente en versiones distintas.

Verifica la configuración localmente y prepara archivos de infraestructura, checklist y procedimiento revisables antes de requerir autorización externa faltante. No afirmes que un workflow remoto pasó solo porque el YAML es válido.

## Salud, observabilidad y límites

Implementa `/health/live` para vida del proceso y `/health/ready` para dependencias mínimas de dominio conforme al contrato acordado. Restringe diagnóstico detallado. Una caída de IA debe degradar ayuda y mantener lectura/envío cuando sus dependencias sigan disponibles; una caída de BD impide confirmar escrituras.

Incluye `requestId`, IDs de intento/ejecución/trabajo cuando existan, UTC, ambiente, release, operación, resultado y duración. Registra región/consumo/truncamiento/motivo del ejecutor y estado/latencia/consumo/configuración del proveedor IA. No escribas contraseñas, tokens, tests ocultos o código completo en logs generales.

Instrumenta latencia completa y por componente, errores por dependencia, trabajos pendientes/edad/reintentos, entornos huérfanos, intentos admitidos/confirmados/fallidos y consumo por proveedor. Prepara alertas solo con umbral/destinatario definidos; no declares un monitor activo porque existe su configuración propuesta.

Mantén límites 1 vCPU/2 GB del sandbox y 128 MB/3 s/64 KB del proceso independientes. No permitas que el usuario estudiante los amplíe. Aplica cuotas y control de concurrencia acordados, con degradación explícita cuando se alcanza el límite.

Antes de mediciones pagadas o carga, fija perfil, región, muestra, cuotas, costo y autorización según DEC-008. Registra unidades facturadas, consumo, importe, conversión efectiva y finalidad. CLP 265.000 es el tope directo documentado; CLP 4.585.000 incluye valorización de horas. Ninguno acredita gasto ejecutado ni autoriza contratación ilimitada.

## Demo canónica y ensayo

Construye un seed versionado e idempotente con exactamente 2 organizaciones, 2 administradores, 2 profesores, 8 estudiantes, 3 clases, 10 ejercicios y 6 documentos ficticios, dos por clase. La distribución entre organizaciones/clases es propuesta DEC-012; identifica en el registro cuál se adoptó. Usa IDs estables o claves naturales para no duplicar datos.

Incluye estados de actividad, diagnósticos, RAG, tipos de señal y revisión requeridos para demostración. Etiqueta ejemplos pregrabados como fixtures. No sustituyas pruebas reales con una respuesta de éxito fija o una captura preparada. Usa reloj de prueba para inactividad/ventanas sin esperar días.

Ensaya el guion completo: acceso administrativo acotado; profesor crea/publica; estudiante se incorpora, ejecuta/envía, recibe ayuda con fuente y reintenta; profesor consulta progreso/detalle/revisa señal; acceso cruzado denegado entre organizaciones y entre clases; exportación autorizada. Ejecuta al menos una solución correcta, una fallida y un timeout reales. Comprueba también `NO_EVIDENCE` y `PROVIDER_UNAVAILABLE` manteniendo intento/resultado técnico.

Registra cuentas ficticias de ensayo sin reutilizar credenciales reales. Un código colectivo de clase no debe agotarse por incorporar al primer estudiante; la idempotencia evita duplicar su membresía. Mantén fixtures negativos aislados y restaura su estado sin alterar las cantidades canónicas.

## Preparar y ejecutar una publicación autorizada

Preparar scripts, revisar configuración, construir el candidato y probar en entornos ya autorizados son parte de la tarea. No pidas permiso para cada acción rutinaria reversible. Comprueba primero el alcance de la autorización del usuario y las reglas vigentes para la acción concreta; no repitas una aprobación ya otorgada.

Antes de crear servicios de pago, modificar infraestructura externa, promover a un entorno activo o realizar operaciones destructivas, confirma que la autorización efectiva cubre destino, impacto y costos. La documentación exige autorización del PO para servicios pagados: si falta, deja listo un cambio concreto con destino, artefacto, plan de recuperación y costo/límite conocido, y solicita solo esa decisión. Continúa trabajo independiente mientras se resuelve. No publiques de forma implícita por terminar de escribir código.

Cuando la publicación esté autorizada:

1. Identifica entorno, candidato, artefactos, configuración y migraciones; comprueba compatibilidad y evidencia de checks pertinentes.
2. Respalda el estado necesario conforme al plan probado. No supongas que un dump SQL incluye archivos, corpus o configuración de referencias.
3. Aplica migraciones compatibles hacia adelante. Si se necesita cambio incompatible, usa transición explícita y revisada antes de promover.
4. Despliega API y trabajador, verifica salud/contratos y después web compatible. Conserva la revisión anterior utilizable cuando sea viable.
5. Ejecuta smoke con datos ficticios para roles, persistencia, ejecución, ayuda/degradación y aislamiento; verifica corpus listo y procesos/entornos limpios.
6. Registra versión, hora, migración, URLs operativas pertinentes, resultado y defectos. Si la nueva revisión no es saludable, aplica el procedimiento de recuperación acordado y conserva evidencia.

Desplegable, desplegado, probado y aceptado son estados diferentes. Un build local no acredita publicación ni aceptación académica.

## Recuperación y contingencias

| Incidente | Implementa/documenta y ensaya |
| --- | --- |
| Nueva API no saludable | Retirar revisión defectuosa y volver a imagen compatible; verificar contratos/datos antes de declarar recuperación. |
| Migración incompatible | Detener promoción y preparar corrección revisada. No ejecutar rollback destructivo automático sobre datos del usuario. |
| Base de datos caída o respuesta de envío perdida | No confirmar intento inexistente; conservar editor y reconciliar idempotencia al recuperar servicio. |
| IA sin cuota o indisponible | Mostrar `PROVIDER_UNAVAILABLE`, conservar resultado técnico e intento; registrar causa/consumo y reintento acotado. |
| Ingestión/reindexación interrumpida | Recuperar trabajo durable; mantener generación previa válida solo si continúa autorizada. No publicar generación incompleta. |
| Fuente revocada | Excluir recuperación de inmediato y revalidar trabajos/respuestas pendientes sin romper aislamiento. |
| Sandbox huérfano | Localizar por correlación, cerrar en el ámbito operativo permitido, reconciliar resultado y registrar gasto. |
| Credencial expuesta | Revocar/rotar la credencial afectada dentro del alcance autorizado, revisar accesos y desplegar corrección sin revelar el valor. |

Prepara copias privadas de BD, binarios de Storage y configuración/versiones relevantes. Ensaya restauración en un ambiente separado; comprueba cuentas/permisos, intentos, eventos, resultados, feedback y fuentes como conjunto coherente. Conserva IDs, texto, localizadores y generaciones que sustentan citas históricas. Reconstruir embeddings no reconstruye por sí solo la trazabilidad previa.

RPO, RTO, retención, eliminación y residencia para un piloto real quedan pendientes DEC-009. No atribuyas un SLA, cumplimiento legal ni retención garantizada a un plan sin evidencia. Usa datos ficticios hasta que el tratamiento del piloto esté definido.

Para contingencia de demo, conserva evidencia fechada de ejecuciones anteriores y explica qué está disponible en vivo. Nunca presentes datos simulados o un proveedor falso como respuesta real.

## Entrega y cierre

Al implementar, entrega scripts ejecutables, ejemplos de configuración sin secretos, configuración CI/infra, guía local, procedimiento de release/recuperación, seed/corpus y guion, más evidencias ligadas al candidato. Sus ubicaciones finales deben corresponder al repositorio real; `infra`, `fixtures/demo` y `.github/workflows` son destinos de referencia si todavía no se han creado.

Solicita revisión cruzada y reproducción por otro integrante cuando corresponda a la aceptación. Reporta qué ejecutaste tú y qué revisión humana falta; no atribuyas contribuciones del agente a los tres integrantes. Conserva trazabilidad a RNF-POR-01/02/03, RNF-MAN-03/04 y ORG-001 a ORG-005, además de los RF de cada smoke.

No marques completo el MVP por llegar a la fecha de un sprint. La tensión S7/freeze de semana 15 sigue DEC-011; cambios de alcance/calendario requieren el control definido en [plan](../../specs/12-plan-de-entrega.md). Para cierre exige criterios funcionales probados, ausencia de defectos altos conocidos en ruta crítica, evidencia de aislamiento/límites/degradación/accesibilidad, demo reproducible y pendientes visibles. Entrega al usuario el resultado, verificaciones realizadas, versión y límites materiales de lo comprobado.
