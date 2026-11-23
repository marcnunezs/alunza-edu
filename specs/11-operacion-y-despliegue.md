# Operación y despliegue

Fecha: 2026-09-10. **Documentado:** destinos de despliegue, herramientas locales, observabilidad, presupuesto y demo. **Propuesta técnica:** configuración, pipelines y procedimientos concretos. Fuentes: F01 RNF-POR, RNF-MAN, ORG y AD-ARQ-001; F02 y F06 del [inventario](00-fuentes-y-decisiones.md).

## Estado y entornos

Al 26/10/2026 existen aplicaciones, Dockerfiles, migraciones, scripts y workflow.
El [README operativo](../README.md) contiene el arranque vigente;
[estado actual](../docs/estado-actual.md) enlaza pruebas y pendientes, y
[arquitectura](05-arquitectura.md) distingue lo implementado del destino remoto.
Los procedimientos de despliegue/recuperación de este spec siguen siendo
criterios por verificar en su ambiente; no acreditan una instalación remota.

| Entorno | Web | API y trabajos | Datos/archivos | Ejecutor | Uso |
| --- | --- | --- | --- | --- | --- |
| DEV local existente | Next.js local | NestJS nativo; Compose tiene alcance separado | Supabase CLI del laboratorio DEV | Docker nativo para RUN/SUBMIT | Desarrollo; el arranque Compose no habilita por sí solo ejecución estudiantil |
| TEST local existente | Build y Cypress | APIs temporales de los arneses | Supabase TEST aislado y fixtures ficticios | Docker | CI local y focos verificados; no implica ejecución del workflow remoto |
| LAB-EVAL existente | Cliente de evaluación | API y listener operacional de evaluación | Estado de evaluación separado de DEV/TEST | Docker en preparación local | Evaluación por etapas; comparte listener 4401 con arneses TEST, ejecutados por turnos |
| Preview propuesta | Preview Vercel por PR | API de prueba compatible | Proyecto/ámbito de prueba aislado | Sandbox solo en ensayo autorizado | Integración remota pendiente |
| Demo/producción prevista | Vercel | Azure Container Apps | Supabase gestionado | Vercel Sandbox | Destino AD-ARQ-001; despliegue y validación pendientes |

Una preview no apunta por defecto a datos productivos. No compartir secretos productivos con PR externos. El detalle de aislamiento entre previews se resuelve según capacidad del proyecto, conservando separación de datos y permisos.

## Configuración vigente y nombres conceptuales

Los nombres realmente consumidos y su sensibilidad están en
[.env.example](../.env.example), el validador
[API](../apps/api/src/config.ts) y los scripts de entorno. La tabla siguiente
conserva el diseño lógico original; no debe copiarse como un archivo de
configuración ejecutable ni introducir alias nuevos por documentación.

Registrar variables en `.env.example` con nombres y descripción, nunca valores reales. Validar todas al iniciar; mensajes de error no imprimen secretos.

| Variable lógica propuesta | Consumidor | Clase y finalidad |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | Web | Pública; URL de API del ambiente |
| `NEXT_PUBLIC_SUPABASE_URL` | Web | Pública; proyecto de Auth correspondiente |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Web | Clave publicable, solo con políticas y permisos mínimos |
| `APP_ORIGIN`, `ALLOWED_ORIGINS` | API/Auth | Orígenes explícitos y callbacks permitidos |
| `SUPABASE_URL`, `SUPABASE_JWKS_URL` | API | Identidad del emisor/JWKS confiable configurado |
| `DATABASE_URL` | API | Secreto de rol de aplicación limitado, sin BYPASSRLS |
| `DATABASE_MIGRATION_URL` | CI de migración | Secreto privilegiado separado, nunca runtime del estudiante |
| `SUPABASE_SERVICE_ROLE_KEY` | Adaptador administrativo acotado | Secreto, solo operaciones necesarias de Auth/Storage |
| `RAG_BUCKET_NAME` | API/trabajador | Bucket privado de fuentes |
| `AZURE_OPENAI_ENDPOINT` | API/trabajador | Endpoint del proveedor inicial |
| `AZURE_OPENAI_API_KEY` o identidad de servicio | API/trabajador | Credencial del proveedor, mecanismo definitivo pendiente |
| `AZURE_OPENAI_GENERATION_DEPLOYMENT`, `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | IA | Deployments fijados por ambiente |
| `AZURE_OPENAI_API_VERSION`, `EMBEDDING_DIMENSIONS` | IA | Contrato compatible y dimensiones verificadas |
| `RUNNER_PROVIDER`, `SANDBOX_REGION` | API/ejecutor | Adaptador local o productivo y región medida |
| `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID` | API en Azure, si usa este mecanismo | Credenciales del control de Sandbox; no se inyectan al programa |
| `EXECUTION_MEMORY_BYTES`, `EXECUTION_TIMEOUT_MS`, `EXECUTION_OUTPUT_BYTES` | Supervisor | Límites validados contra línea base; nunca ampliables por alumno |
| `FEEDBACK_TIMEOUT_MS`, `RAG_CONFIG_VERSION` | Trabajador | Plazo y configuración versionada |
| `LOG_LEVEL`, `RELEASE_SHA`, `ENVIRONMENT` | Servicios | Observabilidad sin datos sensibles |

Son nombres propuestos de aplicación, no una afirmación de que los SDKs los consumen automáticamente. Autenticación Azure→Vercel debe validarse de forma explícita; no suponer que el token OIDC de un despliegue Vercel existe dentro de Azure Container Apps. Elegir credenciales de alcance mínimo y rotación documentada.

## Contrato de arranque local

Los scripts existentes en [package.json](../package.json) cubren
`local:doctor`, `local:up`, `db:migrate`, `db:seed`, `runner:prepare`, `dev`
y `local:down`; el [README](../README.md) fija su orden y prerrequisitos.
No ejecutar automáticamente instalaciones, migraciones o resets al retomar
una sesión documental. TEST se reserva mediante los arneses; no comparte el
estado privado ni reinicializa DEV. LAB-EVAL tiene su
[manual](../docs/work/IMP-04-evaluation-operations.md).

El procedimiento verificable debe funcionar desde una copia limpia:

1. Instalar versiones fijadas de runtime, gestor de paquetes, Docker y Supabase CLI.
2. Generar la configuración local mediante los scripts documentados y validar; no copiar estado privado de otro entorno ni confundir la tabla lógica con variables consumidas.
3. Iniciar servicios auxiliares y aplicar migraciones de tablas, funciones, grants y RLS.
4. Cargar datos ficticios con script idempotente y mostrar un resumen de cantidades.
5. Iniciar web/API/trabajador y comprobar salud; recorrer inicio de sesión, publicación, ejecución y envío.
6. Ejecutar suite de aislamiento y comprobar limpieza de procesos/archivos temporales.

Separar el comando destructivo de reinicialización de demo del arranque normal. Debe verificar ambiente y destino, rechazar producción y explicar qué dataset reemplaza. No cargar datos reales para probar la guía.

## CI y publicación

El [workflow configurado](../.github/workflows/foundation.yml) y
[ci:verify](../scripts/ci-verify.mjs) conservan 17 etapas y tres gates SUBMIT
consecutivos. El último resultado acreditado es la CI local del
[candidato .08](../docs/work/IMP-05-acceptance.md). Incluye formato, lint,
tipos, unidades, runner, fixtures, SQL/RLS/HTTP, IA TEST, E2E y evaluación.
La existencia del workflow no demuestra su ejecución remota ni acredita
Linux para ese candidato. La publicación y despliegue siguen requiriendo
su propia autorización, candidato y comprobación.

Revisar cada cambio relevante por otro integrante. No desplegar una imagen de API distinta de la probada. Identificar artefactos por commit/digest, migración aplicada, versión de corpus y arnés. Las previews Vercel deben mostrar a qué API de prueba corresponden sin exponer secretos.

**Secuencia de entrega propuesta:** respaldar estado necesario; aplicar migraciones compatibles hacia adelante; desplegar revisión API y trabajador; comprobar salud y contratos; desplegar web; ejecutar smoke de roles y aislamiento con datos ficticios; registrar versión y resultado. Cambios incompatibles de contrato requieren transición explícita, no solo cambiar el frontend.

Antes de una demo, ejecutar al menos flujo correcto, timeout, ausencia de evidencia, proveedor IA caído y acceso cruzado denegado. No permitir que una carga inicial pendiente haga parecer lista una versión sin corpus.

## Salud, métricas y logs

`/health/live` verifica que el proceso puede responder. `/health/ready` comprueba dependencias mínimas necesarias para la operación de dominio. **Propuesta:** una caída de IA degrada esa capacidad pero no retira toda la API de servicio si lectura/envío siguen operables; caída de BD impide aceptar escrituras. La salud detallada requiere acceso operativo.

Registrar `requestId`, `attemptId/executionId/jobId` cuando existan, fecha UTC, ambiente, release, operación, resultado y duración. Para ejecución, región del sandbox, consumo, truncamiento y motivo; para IA, estado de proveedor, latencia, tokens/consumo y configuración. Nunca incluir tokens, contraseñas, tests ocultos o código completo en logs generales.

| Indicador | Uso |
| --- | --- |
| p50/p95/p99 por recorrido y componente | Contrastar RNF sin ocultar esperas de cola o arranque |
| Tasa de errores por dependencia | Distinguir fallo de programa y fallo operativo |
| Trabajos en cola, edad y reintentos | Detectar ingestión/feedback detenido |
| Entornos activos y huérfanos | Controlar limpieza y gasto |
| Intentos admitidos/confirmados y fallos de persistencia | Detectar pérdida o confirmación falsa |
| Denegaciones de autorización y exportaciones | Investigar con auditoría acotada |
| Consumo y gasto por proveedor/ambiente | Mantener el presupuesto directo |

Las alertas requieren umbrales y destinatario operativo definidos por el equipo; no inventar que existe un monitor desplegado. Propuesta: alertar ante fallos persistentes de BD, cola envejecida, entornos huérfanos o consumo próximo al límite acordado.

## Recuperación y degradación

| Incidente | Respuesta operativa propuesta |
| --- | --- |
| API no saludable después del despliegue | Retirar nueva revisión y volver a imagen compatible; conservar evidencia |
| Migración incompatible | Detener promoción y aplicar corrección revisada; no rollback destructivo automático |
| BD no disponible | No confirmar envíos; conservar editor; recuperar servicio y reconciliar claves idempotentes |
| IA sin cuota o caída | `PROVIDER_UNAVAILABLE`, resultado técnico disponible; medir causa y consumo |
| RAG indexación fallida | Mantener versión previa válida si está autorizada; reintentar trabajo acotado |
| Fuente revocada | Excluir recuperación de inmediato; cancelar o revalidar trabajos y respuestas |
| Sandbox huérfano | Cerrar desde control operativo, reconciliar resultado y registrar gasto |
| Secreto expuesto | Revocar y rotar credencial, revisar accesos y despliegues afectados, registrar incidente |

**Propuesta para demo:** exportación/backup antes de migraciones y antes de entrega; copias privadas de BD, binarios de Storage, configuración de versiones y corpus. Probar restauración en ambiente separado con la misma matriz de aislamiento. Los embeddings pueden reconstruirse desde binarios/versiones, preservando configuración. Conservar IDs, texto y localizadores de fragmentos citados y sus generaciones; si el algoritmo los cambia, crear una generación nueva sin romper `feedback_source_refs` histórico. Restaurar solo vectores nuevos no reconstruye por sí mismo la trazabilidad de las citas anteriores.

RPO, RTO, frecuencia automatizada y retención definitiva quedan pendientes DEC-009; no atribuir SLA a planes gratuitos. El historial de intentos requiere restauración coherente con eventos, feedback y fuentes; un backup solo del SQL no garantiza recuperación de archivos.

## Demo canónica

Cantidades **Documentadas:** 2 organizaciones, 2 administradores, 2 profesores, 8 estudiantes, 3 clases, 10 ejercicios y 2 documentos por clase, todos ficticios.

La distribución ficticia está concretada en
[identidades](../fixtures/foundation/identity.json),
[contenido](../fixtures/demo/academic.mjs) y el
[registro de materiales](../docs/work/IMP-04-materials.md). Conservar los
conteos y las claves de esos fixtures al preparar otra sesión; la demo integral
de detalle, revisión pública y CSV sigue dependiendo de IMP-06. Los fixtures
adversariales y los 60 alumnos del perfil .08 están separados del seed canónico.

Para el negativo docente dentro de A, una variante temporal del fixture retira la asignación del profesor A a la segunda clase y verifica denegación con JWT anterior. Luego restaura el seed. Esto permite probar rol docente válido en la misma organización pero sin pertenencia a la clase, manteniendo las cantidades canónicas.

El seed debe crear clases, actividades y reglas coherentes y usar identificadores estables o claves naturales para no duplicar datos al repetirlo. Incluir actividades DRAFT/PUBLISHED/CLOSED, seis resultados técnicos, tres estados RAG, tres tipos de señal y revisión; los ejemplos pregrabados se etiquetan como fixtures y no sustituyen ejecución real.

Un reloj de prueba permite producir inactividad de siete días y ventanas de catorce sin esperar tiempo real. Ejecutar además un intento real correcto, uno fallido y un timeout en la demo. El código de clase colectivo puede admitir a varios estudiantes; impedir duplicar la membresía de uno de ellos, no consumir el código al primer uso salvo que sea invitación individual.

Guion: acceso administrativo acotado; creación/publicación; incorporación; ejecución/envío; feedback con fuente; reintento; progreso y detalle docente; señal revisada; rechazo entre organizaciones y entre clases; CSV operativo autorizado. Documentar cuentas ficticias de prueba sin usar credenciales reales reutilizadas.

## Costos y aprobación operativa

El presupuesto referencial documentado es CLP 4.585.000, de los cuales CLP 265.000 es el tope directo. No son gastos ejecutados. La ERS menciona reservas de planes y consumo; esos valores históricos no se presentan como precios vigentes.

Registrar por proveedor unidad, consumo, importe facturado, conversión efectiva, ambiente y finalidad. Todo servicio pagado requiere la autorización del Product Owner indicada por la documentación. Antes de habilitar carga, fijar cupos de concurrencia, frecuencia y gasto; detener nuevas operaciones costosas de forma controlada cuando se alcanza el límite acordado. No ampliar infraestructura o cuotas automáticamente sin ese control.

La entrega operativa se acepta cuando otro integrante reproduce arranque y demo, se prueba restauración, no hay secretos expuestos y cada meta tiene evidencia o incumplimiento visible en [calidad](10-calidad-y-pruebas.md).
