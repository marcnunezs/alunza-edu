# Alunza

Alunza es un tutor universitario web para Programación I con JavaScript. Combina ejecución controlada, pruebas deterministas, pistas sustentadas en material docente y seguimiento explicable por clase.

Este repositorio conserva la documentación CAPSTONE y las especificaciones del proyecto, junto con la implementación local de identidad, gobierno institucional, contenido académico y práctica JavaScript con intentos persistentes. Integra Next.js, NestJS, Supabase local y un ejecutor Docker con QuickJS/WASM. El corte IMP-03 incorpora ejecución, confirmación de envío, diagnósticos, historial, reintentos y avance por actividad; **14/27 RF (51,9 %) quedaron probados funcionalmente en local**. El alcance comprometido sigue siendo 27 RF: aumenta la cobertura demostrada. El [estado vigente del 23/10/2026](docs/work/ESTADO-ACTUAL.md) clasifica 14 completos locales, 3 parciales y 10 pendientes. CI local aprobó sus 14 controles: SUBMIT concurrente p95 3,50 s frente al objetivo <5 s; ver la [entrega y evidencia](docs/work/IMP-03-implementation.md). El [guion IMP-03](docs/work/IMP-03-demo.md) describe el recorrido y sus límites. Se conservan el [registro IMP-02](docs/work/IMP-02-implementation.md), su [trazabilidad](docs/work/IMP-02-trazabilidad.md) y los [ensayos históricos](docs/work/IMP-00.06-08-ensayos.md). No existe despliegue remoto acreditado.

## Arranque local

Trabaja desde esta raíz Git, no desde la carpeta contenedora. Se requiere Docker Desktop con motor Linux activo. En Windows, prepara Node 24.21.0/npm 11.19.0 en la sesión con el script portable (descarga oficial y checksum; no modifica Node global):

```powershell
. ./scripts/use-node.ps1
npm ci
npm run local:doctor
npm run local:up
npm run db:migrate
npm run db:seed
npm run runner:prepare
npm run runner:doctor
npm run demo
```

Abre [Alunza local](http://127.0.0.1:3000). La API escucha en `127.0.0.1:4000`; Supabase Auth/API en `127.0.0.1:15421`, PostgreSQL en `15422`, Studio en `15423` y correo ficticio en `15424`. Se eligieron estos puertos después de detectar servicios ajenos y rangos reservados por Windows. Un puerto ocupado produce un error: los scripts no detienen procesos ajenos. Para preparar Docker se puede abrir Docker Desktop o ejecutar `docker desktop start`.

`npm run demo` compila todos los paquetes y sirve la API y Next mediante sus comandos `start`. La API lee `apps/api/.env.local`; el build web utiliza `apps/web/.env.local`, ambos preparados por `db:migrate`. La demostración usa `next start`, sin el endpoint MCP afectado de `next dev`, según el [aviso oficial de Next](https://github.com/vercel/next.js/security/advisories/GHSA-39w2-rjm5-chcv). `npm run dev` se conserva para desarrollo con recarga automática; no ejecutar ambos a la vez en 3000/4000.

La primera descarga de imágenes puede tardar varios minutos. `local:up` crea claves locales de firma y guarda configuración de bootstrap en `.local/runtime.json`. `db:migrate` asigna la contraseña del rol limitado y genera los archivos `.env.local` de API/web por separado. `.env.example` documenta consumidores y sensibilidad; no copies secretos administrativos al frontend. Los archivos de estado, firma y credenciales se excluyen de Git.

Límite observado en Docker Desktop de esta máquina: los puertos de Supabase se publican en `0.0.0.0` y `::`, incluso con la red exclusiva configurada para loopback. `local:up` informa las direcciones efectivas. Las URLs anteriores permiten acceder localmente, pero no prueban exclusión de acceso desde la red. Usa únicamente este fixture ficticio y detén Supabase con `local:down` al terminar. Web/API sí tienen binding explícito en `127.0.0.1`; no se cambiaron el firewall ni la configuración global de Docker.

El fixture es incremental: dos organizaciones, dos administradores, dos profesores, ocho estudiantes, tres clases y diez ejercicios. [Las seis identidades iniciales](fixtures/foundation/identity.json) se amplían mediante [el seed académico](scripts/academic-seed.mjs). `student.a@alunza.test` queda sin inscripción para demostrar la incorporación por código. `npm run local:credentials` muestra su contraseña común únicamente en una terminal interactiva local. El estado privado también contiene `fixturePassword`. No copies ese valor a reportes o commits. Repetir `db:seed` reconcilia las cuentas ficticias por ID/correo y sus estados, conservando las versiones académicas existentes; no es una operación de producción.

`Ctrl+C` detiene la demo o el desarrollo. `npm run local:down` detiene únicamente Supabase de Alunza y conserva sus volúmenes. No hay reset destructivo en el arranque normal. Una migración ya aplicada se corrige con una migración nueva; no se promete recuperar datos borrados mediante rollback automático.

## Comprobaciones

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm run test:artifacts
npm audit
```

La auditoría del 23/10/2026 registra deuda previa: **14 entradas de paquetes vulnerables —5 críticas, 7 altas y 2 moderadas—**, idénticas entre HEAD y el candidato IMP-03. Los paquetes QuickJS 0.32.0 añadidos no aparecen señalados. La comparación local está en `.local/audit-imp-03-baseline.json` y `.local/audit-imp-03-current.json`; los reportes históricos con cero hallazgos no describen la auditoría actual. El arranque compilado evita el endpoint MCP de desarrollo, pero no corrige las demás alertas ni acredita seguridad para publicación. Su revisión y actualización continúan pendientes; este incremento no actualiza masivamente dependencias.

`test:integration` crea su propio proyecto Supabase en `.local/integration-workspace`, usa puertos `16421–16424` y una API temporal en `4100`. Cada ejecución reconstruye exclusivamente esa BD de pruebas mediante `db reset --local --no-seed`, aplica las migraciones actuales y repite el seed. Ejecuta Jest contra Auth/API/BD reales y pgTAP, detiene exclusivamente su BD para probar fallo y recuperación, y cierra sus servicios en `finally`. Las mutaciones negativas se restauran; el desarrollo no se reinicializa. Un archivo `.local/integration.lock` impide ejecuciones simultáneas; si hubo terminación abrupta, verifica que su PID ya no exista antes de retirar únicamente ese archivo.

`npm run openapi` genera [OpenAPI](packages/contracts/openapi.json) desde los esquemas públicos. NestJS expone salud, identidad, gobierno institucional, cursos, clases, códigos, inscripción, conceptos, ejercicios versionados, actividades, ejecución temporal, intentos propios e historial/progreso. Todas las operaciones de dominio utilizan `/api/v1`. JWT ausente/inválido devuelve 401; cuenta inactiva 403; organización ajena o inexistente 404 indistinguible; BD indisponible 503. Las respuestas privadas no se cachean.

`test:artifacts`, después del build y de preparar Supabase local, recorre los bundles públicos y HTML de Next para detectar las credenciales administrativas, contraseñas y clave privada de firma de ese entorno. Falla si faltan los artefactos o el estado necesario para comprobarlos; no imprime los secretos.

## CI y recorrido Cypress

Con Node/npm fijados, Docker Linux activo y Chrome instalado, ejecuta desde esta raíz:

```powershell
npm ci
npm run ci:verify
```

`ci:verify` comprueba formato, lint, tipos (incluidos los tests Cypress) y Jest; prepara y comprueba el ejecutor Docker, instala/verifica el binario Cypress16.0.0, ejecuta integración real de la API y de pgvector/IA, y después `test:e2e`. No necesita levantar desarrollo ni copiar sus credenciales. La configuración pública ficticia del chequeo de tipos no se usa para autenticar: el build E2E recibe las claves públicas del Supabase real de pruebas.

Para ejecutar únicamente el recorrido:

```powershell
npm run cypress:install
npm run test:e2e
```

El runner reutiliza el fixture y lifecycle de integración, con el mismo `.local/integration.lock`. Reconstruye la BD de pruebas de Supabase16421–16424, construye web/API con `npm run build`, verifica secretos con `test:artifacts` y ejecuta Chrome contra web3100/API4100. El build web usa `.next-e2e`; los puertos y archivos de configuración de desarrollo permanecen separados. Los ocho casos FND conservados cubren salud, acceso de tres roles, rechazo, recarga/cierre de sesión, acceso cruzado y caída/recuperación real de API. Cada test restablece la API; el runner cierra sus procesos y Supabase en `finally`. No se ejecutan dos suites integradas al mismo tiempo.

Los resúmenes históricos de fundación están en `.local/reports/imp-00-05/`; los institucionales en `.local/reports/imp-01/`; la CI y los ensayos anteriores en `.local/reports/imp-00-06-08/`. Los diagnósticos locales saneados permanecen en `.local/evidence/` por incremento. Videos, capturas automáticas y grabación en Cypress Cloud están desactivados. La contraseña ficticia entra al navegador mediante `cy.env()` y se escribe con logging desactivado; credenciales administrativas, conexión BD y clave de control permanecen en Node. El build E2E también comprueba que canarios secretos ficticios de Azure/Sandbox no aparezcan en artefactos públicos.

IMP-03 añade nueve recorridos Cypress con API, persistencia y Docker reales, incluidos pérdida de respuesta, cierre, cambio de cuenta, respuestas invertidas y falla/recuperación de la consulta de avance. Los reportes del nuevo corte se guardan en `.local/reports/imp-03/`, junto con actualización incremental, rendimiento RUN/SUBMIT y CI del candidato. Los informes anteriores conservan su alcance histórico; no se atribuyen automáticamente a este corte.

`npm run test:gates` demuestra por separado que los cinco comandos de formato/lint/tipos/tests/build rechazan un defecto deliberado. Usa una copia física aislada del código y dependencias en el directorio temporal del sistema (`alunza-gate-probes/run-*`), verifica primero un baseline correcto y restaura las fuentes después de cada caso. Puede tardar varios minutos; no se ejecuta en cada push. No necesita Supabase y no modifica las aplicaciones de trabajo.

[El workflow](.github/workflows/foundation.yml) usa Ubuntu24.04, acciones oficiales fijadas por SHA y permisos de lectura. Reutiliza `npm ci` y `ci:verify`, y sube únicamente resúmenes JSON con retención de siete días. Atiende PR, push a main y ejecución manual. **GitHub Actions remoto no está ejecutado:** el workflow y la base permanecen como cambios locales, sin publicación ni dispatch. Validación sintáctica y ejecución local no equivalen a un run remoto aprobado.

## Alternativa Compose local

Con Supabase iniciado y `db:migrate` ejecutado, detén primero la demo o el desarrollo para liberar 3000/4000:

```powershell
npm run compose:up
npm run compose:down
```

Compose construye web/API con el mismo Node y lockfile, ejecuta como usuario sin privilegios y publica solo en loopback. Supabase continúa bajo su CLI. Las claves públicas de Next se fijan al construir; cambiar de ambiente requiere reconstruir web. Las URLs internas de BD/JWKS usan `host.docker.internal`, conservando el emisor público del JWT. Esta configuración demuestra ejecución local; no despliega a Vercel o Azure.

Compose mantiene `PRACTICE_RUNNER_ENABLED=false`: no monta el socket Docker del anfitrión en la API. Para demostrar RUN/SUBMIT usa `npm run demo` con la cápsula preparada y el doctor aprobado, según el arranque anterior.

## Ensayos de ejecutor, IA y preproducción

`npm run ci:verify` incluye los ensayos locales nuevos y conserva el recorrido real web/API/datos. Las llamadas a Sandbox/Azure OpenAI y los despliegues están deshabilitados por defecto. Para comprobar cada ensayo por separado:

```powershell
npm run test:runner
npm run runner:prepare
npm run runner:doctor
npm run runner:probe -- --adapter docker
npm run test:ai
npm run test:ai:integration
npm run test:preproduction
npm run preprod:check
```

`preprod:check` devuelve2 mientras falte configuración autorizada; no es una aprobación remota. `ai:doctor` inspecciona configuración sin inferencias y también devuelve2 si está incompleta. Los comandos de ejecución devuelven1 ante fallo y0 al satisfacer su comprobación. `runner:cleanup` elimina únicamente cápsulas expiradas identificadas como propias. Los informes de estos ensayos de fundación se conservan en `.local/reports/imp-00-06-08/`; los resultados integrados del corte vigente se registran en `.local/reports/imp-03/`.

El ejecutor de IMP-03 invoca `solve` en un intérprete QuickJS/WASM nuevo dentro de una cápsula Docker y conserva la comparación en el supervisor. Acepta las plantillas `function solve(...)` del banco principal; mantiene memoria, tiempo y salida acotados, protección de pruebas ocultas y limpieza verificada por sus arneses. El prototipo de IMP-00 y sus brechas permanecen documentados como antecedentes; no describen la implementación actual. La evidencia Docker debe evaluarse con este candidato y no acredita seguridad, paridad ni operación productiva en Vercel Sandbox.

El ensayo IA usa PostgreSQL/pgvector real, ACL ficticias y RLS sobre un esquema exclusivamente TEST, con vectores sintéticos identificados. No implementa el modelo académico ni certifica calidad pedagógica. Su modo Azure necesita manifiesto y configuración autorizados; nunca sustituye una integración faltante por un doble silencioso.

Azure tiene dos modos: `rag-local`, predeterminado, combina embeddings remotos con pgvector TEST y exige `AI_MAX_COSINE_DISTANCE` provisional; `connectivity`, utilizado por el Job, emplea contexto ficticio fijo y no acredita recuperación SQL. Los modelos configurados deben coincidir exactamente con `response.model`; una discrepancia rechaza la respuesta antes de publicar vectores o resultados.

La preparación de preproducción está en [infra/preproduction](infra/preproduction). Usa API con release/TLS/CORS estrictos, Vercel con comprobación del runtime administrado y un Job manual de conectividad. No hay publicación automática. [El registro conjunto](docs/work/IMP-00.06-08-ensayos.md) detalla comandos, resultados, decisiones y recuperación.

El corte de ensayos anterior precede a [IMP-01](docs/work/IMP-01-identity.md), con sesiones vigentes, organizaciones, miembros, invitaciones y aislamiento. [IMP-02](docs/work/IMP-02-implementation.md) añade estructura académica, contenido y editor. [IMP-03](docs/work/IMP-03-demo.md) integra el recorrido de práctica local. GitHub Actions remoto, las integraciones alojadas y la calidad pedagógica de IA conservan sus verificaciones pendientes.

## Identidad y gobierno institucional

La interfaz incluye `/acceso`, `/inicio`, `/administracion/organizaciones`, miembros/invitaciones por organización y `/acceso/invitacion`. ADMIN administra su ámbito; TEACHER y STUDENT ven su contexto real. El archivo queda en lectura administrativa. La cuenta puede pertenecer a varias organizaciones, con un rol por membresía; deshabilitar una no bloquea las demás.

Para actualizar una base IMP-00 existente: `npm run db:migrate` y `npm run db:seed`, sin reset de desarrollo. El permiso para crear una organización se concede por UUID mediante `node scripts/provisioning.mjs --help`; la herramienta exige actor, motivo y vencimiento. Las cuentas del producto no pueden concederlo. [El manual del incremento](docs/work/IMP-01-identity.md) detalla comandos y permisos mínimos de Auth.

Las invitaciones duran 72 horas y usan Mailpit local; solo guardan el digest institucional. Un trabajador durable entrega el enlace, registra incertidumbre/fallo y reconcilia reintentos. El callback permite verificar correo en otro navegador y aceptar dentro de NestJS. No hay registro público ni correo a destinatarios reales en las pruebas.

Cypress conserva los ocho casos FND y añade los recorridos IMP01. El cierre no depende de un número fijo de ocho pruebas: exige todos los identificadores requeridos y ausencia de fallos. Los informes del corte institucional se conservan en `.local/reports/imp-01/`; su CI se registró en `.local/reports/imp-00-06-08/ci.json`. El CI vigente de IMP-03 se registra en `.local/reports/imp-03/ci.json`. La integración comprueba actualización desde IMP-00; E2E reconstruye desde todas las migraciones. [OpenAPI](packages/contracts/openapi.json) se genera desde los contratos compartidos.

## Especificaciones del proyecto

La interfaz académica parte de `/inicio` y `/academia/{organizationId}`. El administrador configura cursos, docentes y conceptos; el profesor crea clases, versiones de ejercicios y actividades; el estudiante confirma su incorporación y abre ejercicios publicados. El editor conserva borrador y solicitudes de envío pendientes en `sessionStorage` de la misma pestaña, separados por cuenta/organización/clase/asignación/versión, y los elimina al cerrar sesión. **Ejecutar** produce un resultado temporal; **Enviar intento** requiere confirmación y anuncia guardado solo después de persistir. El historial conserva IDs, código y diagnósticos; recuperar una solicitud incierta reutiliza su clave original, mientras un reintento deliberado crea otro intento. El avance por actividad cuenta asignaciones completadas con todas las verificaciones requeridas y no borra un éxito anterior por un fallo posterior.

Las actividades cerradas salen del catálogo de resolución. **Historial de mis actividades** permite consultar exclusivamente intentos propios autorizados sin reabrir editor ni plantilla. Las nuevas admisiones posteriores al cierre se rechazan; una anterior puede terminar y persistirse después. Se verificaron funcionalmente 14/27 RF (51,9 %), manteniendo RF-010 parcial por la ayuda IA posterior todavía fuera de alcance. El conteo se apoya en la matriz de escenarios y sus pruebas, no en pantallas o scripts. RNF-REN-02 cumple el perfil local medido y CI está aprobado; aceptación del profesor y operación remota siguen pendientes.

La base principal es la ERS 1.3, con revisión técnica del 4 de septiembre de 2026. Los documentos distinguen **Documentado**, **Propuesta técnica** y **Pendiente** para conservar el alcance original y hacer explícitas las decisiones adicionales.

| Archivo                                                             | Contenido                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------- |
| [Fuentes y decisiones](specs/00-fuentes-y-decisiones.md)            | Autoridad documental, discrepancias y decisiones por resolver |
| [Producto y alcance](specs/01-producto-y-alcance.md)                | Problema, usuarios, MVP, exclusiones y éxito                  |
| [Requisitos funcionales](specs/02-requisitos-funcionales.md)        | Los 27 requisitos, reglas, permisos y trazabilidad            |
| [Flujos y aceptación](specs/03-flujos-y-criterios-de-aceptacion.md) | Casos de uso y escenarios verificables                        |
| [UX y accesibilidad](specs/04-ux-y-accesibilidad.md)                | Pantallas, navegación, estados y accesibilidad                |
| [Arquitectura](specs/05-arquitectura.md)                            | Componentes, responsabilidades y decisiones técnicas          |
| [Modelo de datos](specs/06-modelo-de-datos.md)                      | Entidades, relaciones, versiones, integridad y aislamiento    |
| [API y contratos](specs/07-api-y-contratos.md)                      | Operaciones HTTP, cargas, respuestas y errores                |
| [IA y procesamiento documental](specs/08-ia-y-procesamiento.md)     | Ingestión, recuperación, pistas y contratos del modelo        |
| [Seguridad y privacidad](specs/09-seguridad-y-privacidad.md)        | Autorización, amenazas y protección de datos                  |
| [Calidad y pruebas](specs/10-calidad-y-pruebas.md)                  | Cobertura funcional y no funcional, métricas y evidencias     |
| [Operación y despliegue](specs/11-operacion-y-despliegue.md)        | Entornos, CI/CD, observabilidad, recuperación y costos        |
| [Plan de entrega](specs/12-plan-de-entrega.md)                      | Sprints, dependencias, riesgos y criterios de cierre          |
| [Ejecución controlada](specs/13-ejecucion-controlada.md)            | JavaScript, pruebas, límites y aislamiento del ejecutor       |
| [Progreso y señales](specs/14-progreso-y-senales.md)                | Fórmulas, eventos, reglas y evidencia docente                 |

Para comenzar la implementación, leer fuentes y decisiones, producto, requisitos y arquitectura. Cada área tiene contratos y criterios de aceptación propios. Trata los pendientes mediante la [guía de decisiones](specs/00-fuentes-y-decisiones.md): permite supuestos técnicos reversibles registrados y prototipos verificables, sin dar por aceptados comportamientos que dependan de una definición relevante todavía ausente. El trabajo independiente puede avanzar.

## Documentación original

Las fuentes se conservan en [Evidencias CAPSTONE](<Evidencias CAPSTONE/Fase 1>). El [inventario](specs/00-fuentes-y-decisiones.md) identifica los archivos usados y sus límites. Los specs complementan las evidencias académicas y no sustituyen sus aprobaciones.

El contrato general de operación futura permanece en [operación y despliegue](specs/11-operacion-y-despliegue.md); los comandos anteriores cubren identidad, contenido académico y práctica con RUN/SUBMIT, historial y avance por actividad implementados localmente.


## Desarrollo por fases

El [plan progresivo de implementación](docs/plan/README.md) organiza el desarrollo en nueve fases, con incrementos pequeños, dependencias, resultados observables, pruebas y criterios de cierre. Incluye una [matriz de control y trazabilidad](docs/plan/09-control-y-trazabilidad.md) y un archivo detallado por fase.

El corte [IMP-00.01 a IMP-00.04](docs/plan/00-fundacion.md) implementa versiones, workspace, Supabase local y una conexión real web/API/datos con acceso protegido. Su evidencia está en [el registro de trabajo](docs/work/IMP-00-foundation.md); [IMP-00.05](docs/work/IMP-00.05-ci-y-cypress.md) incorpora CI y Cypress. Ese corte histórico no completaba IMP-00 ni los RF de negocio. El estado vigente del 23/10/2026 incorpora IMP-01/02/03 y 14 RF probados localmente, según el [resumen de estado](docs/work/ESTADO-ACTUAL.md).
