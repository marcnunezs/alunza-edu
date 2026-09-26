# Alunza

Alunza es un tutor universitario web para Programación I con JavaScript. Combina ejecución controlada, pruebas deterministas, pistas sustentadas en material docente y seguimiento explicable por clase.

Este repositorio conserva la documentación CAPSTONE y las especificaciones del MVP, la fundación IMP-00, la identidad institucional IMP-01 y el contenido/editor IMP-02. Integra Next.js, NestJS y Supabase local. El alcance, resultados y límites del primer corte funcional están en [IMP-02](docs/work/IMP-02-content.md); no acredita despliegue remoto ni aceptación académica.

## Arranque local

Este laboratorio tiene identificadores, volúmenes, redes y puertos propios: `alunza-edu-laboratorio` para desarrollo y `alunza-edu-laboratorio-test` para las suites. El repositorio original conserva sus servicios `alunza-edu-foundation`. No copies sus archivos privados de estado, claves o `.env.local` al laboratorio. La [guía de demo](docs/work/IMP-02-demo-local.md) registra el entorno y el recorrido por roles.

Trabaja desde esta raíz Git, no desde la carpeta contenedora. Se requiere Docker Desktop con motor Linux activo. En Windows, prepara Node 24.21.0/npm 11.19.0 en la sesión con el script portable (descarga oficial y checksum; no modifica Node global):

```powershell
. ./scripts/use-node.ps1
npm ci
npm run local:doctor
npm run local:up
npm run db:migrate
npm run db:seed
npm run dev
```

Abre [Alunza local](http://127.0.0.1:3200). La API escucha en `127.0.0.1:4200`; Supabase Auth/API en `127.0.0.1:17421`, PostgreSQL en `17422`, Studio en `17423` y correo ficticio en `17424`. Se eligieron estos puertos después de detectar servicios ajenos y rangos reservados por Windows. Un puerto ocupado produce un error: los scripts no detienen procesos ajenos. Para preparar Docker se puede abrir Docker Desktop o ejecutar `docker desktop start`.

La primera descarga de imágenes puede tardar varios minutos. `local:up` crea claves locales de firma y guarda configuración de bootstrap en `.local/runtime.json`. `db:migrate` asigna la contraseña del rol limitado y genera los archivos `.env.local` de API/web por separado. `.env.example` documenta consumidores y sensibilidad; no copies secretos administrativos al frontend. Los archivos de estado, firma y credenciales se excluyen de Git.

Límite observado en Docker Desktop de esta máquina: los puertos de Supabase se publican en `0.0.0.0` y `::`, incluso con la red exclusiva configurada para loopback. `local:up` informa las direcciones efectivas. Las URLs anteriores permiten acceder localmente, pero no prueban exclusión de acceso desde la red. Usa únicamente este fixture ficticio y detén Supabase con `local:down` al terminar. Web/API sí tienen binding explícito en `127.0.0.1`; no se cambiaron el firewall ni la configuración global de Docker.

El fixture es incremental: conserva las seis identidades originales y completa dos organizaciones, dos administradores, dos profesores, ocho estudiantes, tres clases y diez ejercicios. Los correos están en [identidad](fixtures/foundation/identity.json) y [datos académicos](fixtures/demo/academic.mjs); `npm run local:credentials` muestra su contraseña común únicamente en una terminal interactiva local. El estado privado también contiene `fixturePassword`. No copies ese valor a reportes o commits. Repetir `db:seed` reconcilia las cuentas ficticias por ID/correo y sus estados; no es una operación de producción.

`Ctrl+C` detiene el desarrollo. `npm run local:down` detiene únicamente Supabase de Alunza y conserva sus volúmenes. No hay reset destructivo en el arranque normal. Una migración ya aplicada se corrige con una migración nueva; no se promete recuperar datos borrados mediante rollback automático.

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

`test:integration` crea su propio proyecto Supabase en `.local/lab-integration-workspace`, usa puertos `18421–18424` y una API temporal en `4300`. Cada ejecución reconstruye exclusivamente esa BD de pruebas mediante `db reset --local --no-seed`, aplica las migraciones actuales y repite el seed. Ejecuta Jest contra Auth/API/BD reales y pgTAP, detiene exclusivamente su BD para probar fallo y recuperación, y cierra sus servicios en `finally`. Las mutaciones negativas se restauran; el desarrollo no se reinicializa. Un archivo `.local/integration.lock` impide ejecuciones simultáneas; si hubo terminación abrupta, verifica que su PID ya no exista antes de retirar únicamente ese archivo.

`npm run openapi` genera [OpenAPI](packages/contracts/openapi.json) desde los esquemas públicos. NestJS concentra identidad, gobierno, cursos, clases, conceptos, ejercicios y actividades bajo `/api/v1`, además de salud. JWT ausente/inválido devuelve 401; cuenta inactiva 403; organización ajena o inexistente 404 indistinguible; BD indisponible 503. Las respuestas privadas no se cachean.

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

El runner reutiliza el fixture y lifecycle de integración, con el mismo `.local/integration.lock`. Reconstruye la BD de pruebas de Supabase18421–18424, construye web/API con `npm run build`, verifica secretos con `test:artifacts` y ejecuta Chrome contra web3300/API4300. El build web usa `.next-e2e`; los puertos y archivos de configuración de desarrollo permanecen separados. Los ocho casos FND conservados cubren salud, acceso de tres roles, rechazo, recarga/cierre de sesión, acceso cruzado y caída/recuperación real de API. Cada test restablece la API; el runner cierra sus procesos y Supabase en `finally`. No se ejecutan dos suites integradas al mismo tiempo.

Los resúmenes históricos de fundación están en `.local/reports/imp-00-05/`; integración/Cypress actuales en `.local/reports/imp-01/`; CI conjunta y ensayos en `.local/reports/imp-00-06-08/`. Los diagnósticos locales saneados permanecen en `.local/evidence/` por incremento. Videos, capturas automáticas y grabación en Cypress Cloud están desactivados. La contraseña ficticia entra al navegador mediante `cy.env()` y se escribe con logging desactivado; credenciales administrativas, conexión BD y clave de control permanecen en Node. El build E2E también comprueba que canarios secretos ficticios de Azure/Sandbox no aparezcan en artefactos públicos.

`npm run test:gates` demuestra por separado que los cinco comandos de formato/lint/tipos/tests/build rechazan un defecto deliberado. Usa una copia física aislada del código y dependencias en el directorio temporal del sistema (`alunza-gate-probes/run-*`), verifica primero un baseline correcto y restaura las fuentes después de cada caso. Puede tardar varios minutos; no se ejecuta en cada push. No necesita Supabase y no modifica las aplicaciones de trabajo.

[El workflow](.github/workflows/foundation.yml) usa Ubuntu24.04, acciones oficiales fijadas por SHA y permisos de lectura. Reutiliza `npm ci` y `ci:verify`, y sube únicamente resúmenes JSON con retención de siete días. Atiende PR, push a main y ejecución manual. **GitHub Actions remoto no está ejecutado:** el workflow y la base permanecen como cambios locales, sin publicación ni dispatch. Validación sintáctica y ejecución local no equivalen a un run remoto aprobado.

## Alternativa Compose local

Con Supabase iniciado y `db:migrate` ejecutado, detén primero `npm run dev` para liberar 3200/4200:

```powershell
npm run compose:up
npm run compose:down
```

Compose construye web/API con el mismo Node y lockfile, ejecuta como usuario sin privilegios y publica solo en loopback. Supabase continúa bajo su CLI. Las claves públicas de Next se fijan al construir; cambiar de ambiente requiere reconstruir web. Las URLs internas de BD/JWKS usan `host.docker.internal`, conservando el emisor público del JWT. Esta configuración demuestra ejecución local; no despliega a Vercel o Azure.

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

`preprod:check` devuelve2 mientras falte configuración autorizada; no es una aprobación remota. `ai:doctor` inspecciona configuración sin inferencias y también devuelve2 si está incompleta. Los comandos de ejecución devuelven1 ante fallo y0 al satisfacer su comprobación. `runner:cleanup` elimina únicamente cápsulas expiradas identificadas como propias. Los informes saneados nuevos están en `.local/reports/imp-00-06-08/`.

El ejecutor es experimental: conserva el comparador fuera del alumno, limita tiempo/memoria/salida y prueba aislamiento con programas ficticios. El valor de retorno sigue siendo controlable por el alumno; no prueba que se haya invocado honestamente la función. Un puente de UID0 conserva capacidades acotadas para lanzar al alumno con UID distinto y capacidades cero. Esta desviación del contenedor enteramente no privilegiado se registra; no acredita seguridad productiva de Sandbox ni completa RF-009.

El ensayo IA usa PostgreSQL/pgvector real, ACL ficticias y RLS sobre un esquema exclusivamente TEST, con vectores sintéticos identificados. No implementa el modelo académico ni certifica calidad pedagógica. Su modo Azure necesita manifiesto y configuración autorizados; nunca sustituye una integración faltante por un doble silencioso.

Azure tiene dos modos: `rag-local`, predeterminado, combina embeddings remotos con pgvector TEST y exige `AI_MAX_COSINE_DISTANCE` provisional; `connectivity`, utilizado por el Job, emplea contexto ficticio fijo y no acredita recuperación SQL. Los modelos configurados deben coincidir exactamente con `response.model`; una discrepancia rechaza la respuesta antes de publicar vectores o resultados.

La preparación de preproducción está en [infra/preproduction](infra/preproduction). Usa API con release/TLS/CORS estrictos, Vercel con comprobación del runtime administrado y un Job manual de conectividad. No hay publicación automática. [El registro conjunto](docs/work/IMP-00.06-08-ensayos.md) detalla comandos, resultados, decisiones y recuperación.

El corte de ensayos anterior precede a IMP-01. La implementación institucional se registra en [IMP-01](docs/work/IMP-01-identity.md) y el contenido/editor en [IMP-02](docs/work/IMP-02-content.md). Siguen pendientes GitHub Actions remoto y las integraciones alojadas, además de las brechas de los ensayos de IMP-00.

## Identidad y gobierno institucional

La interfaz incluye `/acceso`, `/inicio`, `/administracion/organizaciones`, miembros/invitaciones por organización y `/acceso/invitacion`. ADMIN administra su ámbito; TEACHER y STUDENT ven su contexto real. El archivo queda en lectura administrativa. La cuenta puede pertenecer a varias organizaciones, con un rol por membresía; deshabilitar una no bloquea las demás.

Para actualizar una base IMP-00 existente: `npm run db:migrate` y `npm run db:seed`, sin reset de desarrollo. El permiso para crear una organización se concede por UUID mediante `node scripts/provisioning.mjs --help`; la herramienta exige actor, motivo y vencimiento. Las cuentas del producto no pueden concederlo. [El manual del incremento](docs/work/IMP-01-identity.md) detalla comandos y permisos mínimos de Auth.

Las invitaciones duran 72 horas y usan Mailpit local; solo guardan el digest institucional. Un trabajador durable entrega el enlace, registra incertidumbre/fallo y reconcilia reintentos. El callback permite verificar correo en otro navegador y aceptar dentro de NestJS. No hay registro público ni correo a destinatarios reales en las pruebas.

Cypress conserva los ocho casos FND y añade los recorridos IMP01. El cierre no depende de un número fijo de ocho pruebas: exige todos los identificadores requeridos y ausencia de fallos. Los informes institucionales están en `.local/reports/imp-01/`; el CI conjunto conserva su ruta histórica. La integración comprueba actualización desde IMP-00; E2E reconstruye desde todas las migraciones. [OpenAPI](packages/contracts/openapi.json) se genera desde los contratos compartidos.

## Recorrido de contenido y editor

Con las migraciones y el seed locales aplicados, entra a `/academia` desde el inicio y elige organización. ADMIN crea un curso, habilita al profesor en ese curso y define conceptos. TEACHER crea su clase, emite el código colectivo y prepara un ejercicio con `module.exports.solve`, conceptos y pruebas visibles/ocultas. En la clase crea una actividad, ordena ejercicios y publica. STUDENT confirma su incorporación con el código, abre la actividad y edita su solución. El banco canónico permite explorar también clases, publicaciones, borradores y actividades cerradas sin preparar contenido desde cero.

El código se muestra una vez; si se pierde, se regenera. Las habilitaciones por curso no reasignan clases existentes. Solo ADMIN cambia profesor o archiva clases, y debe cerrar antes sus actividades publicadas. TEACHER cierra actividades; la consulta histórica se conserva. Las fechas de curso/clase son civiles y las ventanas se muestran en la zona institucional.

El editor conserva borradores durante treinta días desde la última edición en ese navegador y cuenta. Cerrar sesión los conserva; volver a abrirlos requiere autorización actual. Hay descarte manual y aviso si el almacenamiento falla. No hay ejecución, envío, ayuda ni avance desde intentos en este corte. El [manual web](apps/web/README.md) detalla rutas y comportamiento. `npm run test:academic:fixtures` valida diez soluciones correctas y diez incorrectas en Docker; CI lo incluye. Los reportes académicos están en `.local/reports/imp-02/`.

## Especificaciones del proyecto

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

Para comenzar la implementación, leer fuentes y decisiones, producto, requisitos y arquitectura. Cada área tiene contratos y criterios de aceptación propios. Trata los pendientes mediante la [guía de decisiones](docs/agent/12-decisiones-pendientes.md): permite supuestos técnicos reversibles registrados y prototipos verificables, sin dar por aceptados comportamientos que dependan de una definición relevante todavía ausente. El trabajo independiente puede avanzar.

## Documentación original

Las fuentes se conservan en [Evidencias CAPSTONE](<Evidencias CAPSTONE/Fase 1>). El [inventario](specs/00-fuentes-y-decisiones.md) identifica los archivos usados y sus límites. Los specs complementan las evidencias académicas y no sustituyen sus aprobaciones.

El contrato general de operación futura permanece en [operación y despliegue](specs/11-operacion-y-despliegue.md); los comandos anteriores cubren la fundación y el gobierno institucional locales implementados.

## Instrucciones para el agente de desarrollo

El punto de entrada es [AGENTS.md](AGENTS.md). Las [guías de implementación para agentes](docs/agent/README.md) contienen el orden de trabajo, instrucciones por área, tratamiento de decisiones pendientes, pruebas y criterios de entrega.

Para encargar la construcción del MVP o una capacidad concreta, utiliza los [prompts de implementación](docs/agent/13-prompts-de-implementacion.md). Estas guías preparan el trabajo de código y mantienen separados lo documentado, lo propuesto y lo realmente implementado.

La [selección de skills recomendadas](docs/agent/15-skills-recomendadas.md) identifica las capacidades ya disponibles, las incorporaciones prioritarias y sus límites para este stack.

## Desarrollo por fases

El [plan progresivo de implementación](docs/plan/README.md) organiza el desarrollo en nueve fases, con incrementos pequeños, dependencias, resultados observables, pruebas y criterios de cierre. Incluye una [matriz de control y trazabilidad](docs/plan/09-control-y-trazabilidad.md) y un archivo detallado por fase.

El corte [IMP-00.01 a IMP-00.04](docs/plan/00-fundacion.md) implementa versiones, workspace, Supabase local y una conexión real web/API/datos con acceso protegido. Su evidencia está en [el registro de trabajo](docs/work/IMP-00-foundation.md); [IMP-00.05](docs/work/IMP-00.05-ci-y-cypress.md) incorpora CI y Cypress. La fase IMP-00 completa y los RF de negocio no se dan por terminados.
