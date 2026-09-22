# Operación y despliegue

Fecha: 2026-09-10. **Documentado:** destinos de despliegue, herramientas locales, observabilidad, presupuesto y demo. **Propuesta técnica:** configuración, pipelines y procedimientos concretos. Fuentes: F01 RNF-POR, RNF-MAN, ORG y AD-ARQ-001; F02 y F06 del [inventario](00-fuentes-y-decisiones.md).

## Estado y entornos

El repositorio revisado contiene documentos y specs; no hay aplicaciones, Dockerfiles, migraciones, scripts de arranque ni workflows ejecutables. Los comandos y archivos de esta sección son contratos de implementación futuros y no deben presentarse como disponibles.

| Entorno | Web | API y trabajos | Datos/archivos | Ejecutor | Uso |
| --- | --- | --- | --- | --- | --- |
| Local | Next.js local | NestJS local mediante configuración Compose | Supabase local administrado con CLI | Adaptador Docker | Desarrollo reproducible |
| CI | Build y prueba | Servicios de prueba controlados | BD/Storage de prueba y fixtures ficticios | Docker; pruebas productivas separadas | Checks de PR |
| Preview | Preview Vercel por PR | API de prueba compatible | Proyecto/ámbito de prueba aislado | Sandbox solo en pruebas autorizadas y acotadas | Revisión integrada |
| Demo/producción MVP | Vercel | Azure Container Apps | Supabase gestionado | Vercel Sandbox | Demostración validada |

Una preview no apunta por defecto a datos productivos. No compartir secretos productivos con PR externos. El detalle de aislamiento entre previews se resuelve según capacidad del proyecto, conservando separación de datos y permisos.

## Configuración propuesta

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

La implementación debe aportar scripts con estos propósitos, con nombres finales en el README operativo: comprobar prerrequisitos, instalar desde lockfile, levantar Supabase/Compose, aplicar migraciones, cargar seed, iniciar web/API, ejecutar pruebas y detener servicios.

El procedimiento verificable debe funcionar desde una copia limpia:

1. Instalar versiones fijadas de runtime, gestor de paquetes, Docker y Supabase CLI.
2. Copiar configuración de ejemplo, completar solo secretos del ambiente local y validar.
3. Iniciar servicios auxiliares y aplicar migraciones de tablas, funciones, grants y RLS.
4. Cargar datos ficticios con script idempotente y mostrar un resumen de cantidades.
5. Iniciar web/API/trabajador y comprobar salud; recorrer inicio de sesión, publicación, ejecución y envío.
6. Ejecutar suite de aislamiento y comprobar limpieza de procesos/archivos temporales.

Separar el comando destructivo de reinicialización de demo del arranque normal. Debe verificar ambiente y destino, rechazar producción y explicar qué dataset reemplaza. No cargar datos reales para probar la guía.

## CI y publicación

**Propuesta de pipeline GitHub Actions:** instalación desde lockfile; formateo/lint/tipos; pruebas Jest de dominio y contrato; migraciones y RLS en BD efímera; build web/API; integración y Cypress del flujo crítico; publicación de evidencias asociadas al commit. La configuración final mantiene las herramientas de la ERS.

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

**Distribución propuesta DEC-012:** organización A con administrador A, profesor A, cuatro estudiantes y dos clases; organización B con administrador B, profesor B, cuatro estudiantes y una clase. Los estudiantes de A se distribuyen dos por clase para comprobar separación de clases dentro de la misma organización. Cinco ejercicios por organización, reutilizando versiones donde corresponda; seis archivos únicos de fuentes asociados a sus clases.

Para el negativo docente dentro de A, una variante temporal del fixture retira la asignación del profesor A a la segunda clase y verifica denegación con JWT anterior. Luego restaura el seed. Esto permite probar rol docente válido en la misma organización pero sin pertenencia a la clase, manteniendo las cantidades canónicas.

El seed debe crear clases, actividades y reglas coherentes y usar identificadores estables o claves naturales para no duplicar datos al repetirlo. Incluir actividades DRAFT/PUBLISHED/CLOSED, seis resultados técnicos, tres estados RAG, tres tipos de señal y revisión; los ejemplos pregrabados se etiquetan como fixtures y no sustituyen ejecución real.

Un reloj de prueba permite producir inactividad de siete días y ventanas de catorce sin esperar tiempo real. Ejecutar además un intento real correcto, uno fallido y un timeout en la demo. El código de clase colectivo puede admitir a varios estudiantes; impedir duplicar la membresía de uno de ellos, no consumir el código al primer uso salvo que sea invitación individual.

Guion: acceso administrativo acotado; creación/publicación; incorporación; ejecución/envío; feedback con fuente; reintento; progreso y detalle docente; señal revisada; rechazo entre organizaciones y entre clases; CSV operativo autorizado. Documentar cuentas ficticias de prueba sin usar credenciales reales reutilizadas.

## Costos y aprobación operativa

El presupuesto referencial documentado es CLP 4.585.000, de los cuales CLP 265.000 es el tope directo. No son gastos ejecutados. La ERS menciona reservas de planes y consumo; esos valores históricos no se presentan como precios vigentes.

Registrar por proveedor unidad, consumo, importe facturado, conversión efectiva, ambiente y finalidad. Todo servicio pagado requiere la autorización del Product Owner indicada por la documentación. Antes de habilitar carga, fijar cupos de concurrencia, frecuencia y gasto; detener nuevas operaciones costosas de forma controlada cuando se alcanza el límite acordado. No ampliar infraestructura o cuotas automáticamente sin ese control.

La entrega operativa se acepta cuando otro integrante reproduce arranque y demo, se prueba restauración, no hay secretos expuestos y cada meta tiene evidencia o incumplimiento visible en [calidad](10-calidad-y-pruebas.md).
