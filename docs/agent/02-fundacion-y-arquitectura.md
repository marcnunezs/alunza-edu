# Fundación técnica y arquitectura

Usa esta guía al cambiar dependencias, composición o fronteras de la aplicación existente. La fundación y los incrementos hasta IMP-05.08 tienen implementación y verificación local; no vuelvas a generar el proyecto. Parte del [estado actual](../estado-actual.md), la [arquitectura implementada](../../specs/05-arquitectura.md), [operación](../../specs/11-operacion-y-despliegue.md) y las concreciones DEC-004/006/007 de [decisiones](12-decisiones-pendientes.md).

## Inspecciona y conserva la base

Lee el alcance autorizado y los cambios previos de Git. Contrasta los manifests, `package-lock.json`, configuración TypeScript, scripts, infraestructura y el código del área antes de editar. No ejecutes generadores sobre la raíz, crees carpetas vacías por una estructura propuesta ni reemplaces archivos ajenos.

El workspace usa npm con `apps/*` y `packages/*`, un único lockfile y herramientas fijadas. Las responsabilidades actuales están en `AppModule.register` y en las carpetas reales; una reorganización no es requisito implícito de una nueva función. Consulta el registro del incremento antes de interpretar una propuesta histórica como trabajo pendiente.

AD-ARQ-001 y AD-IA-001 siguen vigentes: Next.js en Vercel, NestJS en Azure Container Apps, Supabase, Vercel Sandbox productivo/Docker local y Azure OpenAI configurable. Un ensayo local o un adaptador implementado no acredita el despliegue o proveedor remoto. Esta guía tampoco autoriza iniciar IMP-06.

## Mantén versiones y configuración coherentes

El corte actual fija Node.js `24.21.0`, npm `11.19.0`, NestJS `12.0.1`, Next.js `16.3.4`, React `19.3.0` y TypeScript `5.9.3`. Web usa Tailwind CSS, Radix UI, componentes locales y Zod; API compila como CommonJS. Jest y Cypress ya tienen configuración. [Los manifests y la tabla de arquitectura](../../specs/05-arquitectura.md#stack-y-workspace-existentes) son la referencia ejecutable; estas versiones no ordenan una actualización.

No añadas Recharts por aparecer en una propuesta anterior: el tablero actual es tabular y no depende de esa biblioteca. El editor existente tampoco presupone una biblioteca nueva. Antes de instalar una dependencia necesaria, verifica compatibilidad en documentación oficial vigente, conserva el lockfile y comprueba el formato de módulos y las pruebas afectadas. No aceptes herramientas distintas por defecto de un generador ni cambies familias aprobadas como una elección rutinaria de patch.

La configuración local se valida en [config.ts](../../apps/api/src/config.ts), con variables documentadas sin secretos en [.env.example](../../.env.example). Web usa `3200`, la API local publicada `4200` y Supabase gateway `17421`; Compose distingue estos puertos de los internos. El default de `PORT` de API es `4000`. Lee los scripts del entorno que vas a usar: DEV, TEST y LAB-EVAL no comparten sin más sus direcciones, credenciales ni datos. No conviertas valores locales en configuración de Vercel/Azure por inferencia.

Si una dependencia resulta incompatible, demuestra el problema y acota el cambio conforme a DEC-007. No mantengas varios lockfiles ni versiones ocultamente distintas entre Docker, CI y ejecución local. La CI del candidato .08 se ejecutó en Windows; no atribuyas a ese PASS una ejecución Linux/remota. Las [CI remotas históricas del 02/10](../work/2026-10-02-git-and-ci.md) conservan su evidencia sobre otros commits.

## Trabaja sobre responsabilidades existentes

```text
apps/web/               App Router, componentes, sesión y llamadas a API
apps/api/src/           Composición NestJS, servicios, repositorios y workers
packages/contracts/     DTO y schemas públicos
packages/ai/            Puertos/adaptadores de IA, extracción y recuperación
packages/runner/        Supervisor, protocolo, cápsula y adaptadores
supabase/               Migraciones, funciones, permisos, RLS y pruebas SQL
fixtures/               Datos ficticios y corpus de prueba
scripts/                Entornos, arneses, medición y operación local
tests/                  Contratos, integración y recorridos E2E
infra/                  Compose, runner y preparación de despliegue
```

No existe `packages/domain`. Los evaluadores puros de señales viven en `apps/api/src/signals`; progreso y tablero combinan servicios API con funciones SQL autorizadas. No extraigas un paquete sin un consumidor o una necesidad demostrada.

[AppModule.register](../../apps/api/src/app.module.ts) compone directamente controladores y proveedores. Las carpetas `identity`, `governance`, `academic`, `content`, `activities`, `practice`, `materials`, `help`, `evaluation`, `evaluation-calibration`, `progress`, `rules`, `signals`, `dashboard`, `database`, `http` y `health` organizan el monolito. No describas módulos Nest independientes, un servicio de auditoría autónomo o workers desplegados aparte si el código no los contiene.

Mantén estas fronteras al ampliar una función:

- El controlador valida contrato y delega; los servicios/repositorios orquestan el caso de uso y los adaptadores. No concentres transporte, SQL y llamadas externas en una función del controlador.
- Next.js presenta los flujos y gestiona sesión. Las operaciones de organización, publicación, envío y seguimiento usan NestJS y sus permisos vigentes.
- `packages/contracts` publica proyecciones autorizadas y schemas de runtime, no tipos privados por conveniencia. Una interfaz TypeScript no valida una respuesta de red.
- Las reglas de progreso/señales se determinan con hechos, reloj y versiones controladas, sin LLM. El modelo no cambia el diagnóstico persistido ni los catálogos del producto.

## Conserva autorización y límites de datos

[DatabaseService](../../apps/api/src/database/database.service.ts) conecta mediante `pg` con `alunza_app`, comprueba su rol limitado e inicializa actor, sesión y organización dentro de cada transacción. `readAs` es de solo lectura; `writeAs` admite escritura. Las funciones de dominio validan el ámbito y la sesión vigente. No aceptes `organizationId`, rol o estado del cliente como autorización ni reutilices contexto de una conexión anterior.

El rol de aplicación no posee las tablas ni tiene BYPASSRLS. El esquema `app` contiene entidades/proyecciones; `app_private` guarda funciones y evidencia restringida. Las funciones privilegiadas asignadas a `alunza_identity` tienen propietario `NOLOGIN` y grants acotados según cada migración. Conserva RLS, `search_path` seguro, restricciones y proyecciones públicas; una función `SECURITY DEFINER` no permite omitir comprobaciones de actor, organización o clase.

La entrada interna de BD está reservada a helpers específicos de workers e incorporación, sin sesión de navegador. No la conviertas en un acceso general para saltar permisos. Las credenciales privilegiadas de Auth/Storage pertenecen a adaptadores concretos de servidor y no sustituyen el rol limitado de las operaciones de dominio. Lee [datos](04-datos-y-migraciones.md) y [seguridad](09-seguridad-y-permisos.md) al cambiar estas fronteras.

Los tests ocultos, secretos, snapshots internos y tipos privilegiados no se incorporan al paquete consumido por el navegador. Construye cada DTO mediante una proyección explícita. El código del estudiante solo se entrega a actores autorizados y al contexto mínimo del flujo de ayuda correspondiente; documentos y código son datos no confiables, no instrucciones para modificar el sistema.

## Respeta la secuencia de hechos y derivados

SUBMIT registra una admisión autorizada/idempotente, ejecuta fuera de la transacción y confirma intento, resultado y eventos con el resultado canónico del supervisor. DEC-002 permite finalizar una admisión anterior al cierre y rechaza admisiones nuevas posteriores; consultar o entregar exige autorización vigente. Esta política está implementada y probada en [IMP-03](../work/IMP-03-submissions.md), no pendiente por conservar un plan histórico.

La ayuda requiere un intento confirmado. La recuperación y generación ocurren fuera de una transacción de BD; el feedback se persiste validado y el ACK idempotente distingue presentación de polling. La ingestión docente no necesita un intento estudiantil. El ledger de llamadas conserva autorización por etapa y tratamiento de despachos inciertos; no introduzcas reintentos que puedan duplicar silenciosamente un gasto remoto.

El worker de señales reclama trabajo y captura un snapshot, evalúa de forma pura fuera de la transacción y finaliza evaluación/checkpoint/episodios verificando su lease. Progreso y tablero leen hechos confirmados; no dependen de que el motor haya terminado para mostrar un logro. Preserva la diferencia entre episodio `ACTIVE`/`REVIEWED` y estado operativo `NOT_EVALUATED`/`PENDING`/`FAILED`/`UP_TO_DATE`.

Para lectura, `asOf` fija el corte y `from` acota observación, sin recortar el progreso acumulado. Permisos y matrícula siguen vigentes; el corte no reconstruye una matrícula histórica. Los cursores se vinculan a ámbito, filtros y corte. Una reconstrucción de derivados no borra historia ni hechos, y un commit tardío legítimo puede cambiar una lectura posterior del mismo corte. Consulta [progreso y señales](08-progreso-y-senales.md) antes de modificar estas reglas.

La consulta docente mínima de evidencia/señales ya existe; no equivale al detalle integral RF-017 ni a la acción pública RF-019. Reutiliza esa base solo dentro del incremento autorizado, sin adelantar IMP-06.

## Usa los puertos y workers implementados

La composición actual de API enlaza `ExecutionPort` y `SubmissionExecutionPort` con adaptadores Docker. `packages/runner` también contiene el adaptador Vercel, cuya validación productiva es independiente. Conserva el contrato funcional, QuickJS/WASM y ambas capas de límite; no infieras aislamiento por un flag de memoria o por el éxito del adaptador local. Lee [ejecución segura](06-ejecucion-segura.md).

Materiales y ayuda tienen puertos/adaptadores de Storage, embeddings y generación. `AppModule.register` rechaza proveedores TEST inyectados fuera de TEST. No actives dobles como fallback silencioso productivo ni sustituyas Azure OpenAI por preferencia técnica. La configuración y calibración habilitan capacidades; la ausencia de proveedor no se convierte en evidencia pedagógica vacía.

Los workers de invitaciones, materiales, ayuda y señales comparten el proceso NestJS y sus flags tienen default `false`. El trabajo durable vive en PostgreSQL, con leases, deduplicación y recuperación específicos. RUN/SUBMIT tienen reconciliadores propios. No asumas durabilidad por una promesa en memoria ni describas una cola externa que no existe. Evalúa cualquier separación de procesos según la necesidad del incremento y su alcance autorizado.

## Verifica contratos y preparación del incremento

1. Reutiliza catálogos y DTO existentes; separa estados de trabajo, diagnóstico, actividad, RAG y episodio. Actualiza schemas y OpenAPI junto con cambios reales de contrato.
2. Mantén configuración validada al iniciar, correlación y errores seguros. Distingue infraestructura fallida, cero datos y falta de evidencia.
3. Revisa migraciones/grants y la actualización desde el esquema anterior. No reescribas migraciones históricas ni uses un bypass productivo para preparar fixtures de upgrade.
4. Conserva `GET /health/live` como liveness y `GET /health/ready` con comprobación de rol/esquema requerido. Readiness no garantiza proveedores externos ni frescura del worker.
5. Ejecuta únicamente las verificaciones necesarias y autorizadas para el cambio, con los scripts existentes y la [guía de pruebas](10-pruebas-y-evidencias.md). No solapes arneses que reservan LAB TEST ni modifiques el candidato durante un perfil que verifica su huella.
6. Registra comandos, resultados, ambiente y límites. Actualiza el [estado actual](../estado-actual.md) y el registro pertinente cuando cambie lo demostrado; no reescribas la historia como una nueva ejecución.

## Alcance de la evidencia existente

La [fundación](../work/IMP-00-foundation.md), sus [ensayos](../work/IMP-00.06-08-ensayos.md) y los registros de cada capacidad acreditan avances locales concretos. La última CI de producto de [IMP-05.08](../work/IMP-05-acceptance.md) aprobó sus 17 etapas; el registro conserva los conteos, gates SUBMIT, muestras y límites. Las corridas anteriores mantienen sus fallos y limitaciones; esta consolidación documental no vuelve a ejecutarlas.

El cierre técnico local no acredita por sí solo los 27 RF completos, CI Linux/remota del candidato .08, Azure real, Vercel Sandbox productivo, despliegue ni aceptación CAPSTONE. Los perfiles de UI .08 miden progreso, tablero y reglas; no resuelven la evidencia pendiente de ayuda renderizada en navegador. Continúa exclusivamente el alcance solicitado del [plan](01-plan-de-implementacion.md), usando la base implementada y sin atribuir capacidades futuras al corte actual.
