# Alunza

Alunza es un tutor universitario web para Programación I con JavaScript. Combina ejecución controlada, pruebas deterministas, pistas sustentadas en material docente y seguimiento explicable por clase.

## Grupo 7

Proyecto CAPSTONE de Ingeniería en Informática, Duoc UC, sede Puente Alto.
Sección 708V.

**Integrantes:**

- Benjamín Pérez Olguín.
- Abraham Retamal.
- Marcelo Ignacio Núñez San Martín.

## Estado del proyecto

**Repositorio principal actualizado el 22/11/2026.** Se incorporaron las fuentes
actuales del laboratorio, incluidos los avances posteriores a los cortes
históricos descritos abajo. El [registro del traslado](docs/work/2026-11-22-sincronizacion-principal.md)
identifica el respaldo, las verificaciones y las exclusiones. La carpeta
`Evidencias CAPSTONE` conserva íntegramente el contenido que tenía en este
repositorio antes del traslado.

**El entorno del principal aún no se ha adaptado ni iniciado.** Los scripts
copiados conservan los identificadores, redes y puertos del laboratorio.
Los comandos de arranque de esta página describen ese perfil y no deben
ejecutarse desde el principal hasta definir un entorno independiente y validar
su estado privado. Las bases, volúmenes, credenciales y dependencias instaladas
no se trasladaron. La sincronización de fuentes no acredita disponibilidad ni
una migración de la base de datos.

El repositorio contiene la aplicación web/API, contratos, migraciones, arneses
y documentación CAPSTONE. Al 27/10/2026, IMP-06.03 tiene cierre técnico local:
detalle docente de estudiante integrado sobre progreso, reglas, episodios,
tablero, identidad, contenido, RUN/SUBMIT y ayuda TEST existentes. El
[estado actual](docs/estado-actual.md) reúne capacidades, evidencia y pendientes;
la [arquitectura](specs/05-arquitectura.md) describe las responsabilidades reales.
IMP-06.01 añade la [consulta administrativa del banco](docs/work/IMP-06-bank-read.md)
e IMP-06.02 su [gobierno administrativo](docs/work/IMP-06-bank-governance.md):
propiedad, visibilidad, nuevas versiones y archivo que conserva la historia.
IMP-06.03 incorpora el [detalle docente de estudiante](docs/work/IMP-06-student-detail.md),
con consultas de solo lectura y ayuda entregada hasta el corte. La CI final
aprobó 17/17 etapas, con 95/95 casos Cypress; su registro conserva los focos,
fallos anteriores y límites observados. Los incrementos .04–.07 siguen pendientes. Los resultados locales
no acreditan despliegue remoto, integración Azure/Sandbox productiva ni
aceptación académica.

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
npm run runner:prepare
npm run runner:doctor
npm run dev
```

Abre [Alunza local](http://127.0.0.1:3200). La API escucha en `127.0.0.1:4200`; Supabase Auth/API en `127.0.0.1:17421`, PostgreSQL en `17422`, Studio en `17423` y correo ficticio en `17424`. Se eligieron estos puertos después de detectar servicios ajenos y rangos reservados por Windows. Un puerto ocupado produce un error: los scripts no detienen procesos ajenos. Para preparar Docker se puede abrir Docker Desktop o ejecutar `docker desktop start`.

La primera descarga de imágenes puede tardar varios minutos. `local:up` crea claves locales de firma y guarda configuración de bootstrap en `.local/runtime.json`. `db:migrate` asigna la contraseña del rol limitado y genera los archivos `.env.local` de API/web por separado. `.env.example` documenta consumidores y sensibilidad; no copies secretos administrativos al frontend. Los archivos de estado, firma y credenciales se excluyen de Git.

Límite observado en Docker Desktop de esta máquina: los puertos de Supabase se publican en `0.0.0.0` y `::`, incluso con la red exclusiva configurada para loopback. `local:up` informa las direcciones efectivas. Las URLs anteriores permiten acceder localmente, pero no prueban exclusión de acceso desde la red. Usa únicamente este fixture ficticio y detén Supabase con `local:down` al terminar. Web/API sí tienen binding explícito en `127.0.0.1`; no se cambiaron el firewall ni la configuración global de Docker.

El fixture es incremental: conserva las seis identidades originales y completa dos organizaciones, dos administradores, dos profesores, ocho estudiantes, tres clases y diez ejercicios. Los correos están en [identidad](fixtures/foundation/identity.json) y [datos académicos](fixtures/demo/academic.mjs); `npm run local:credentials` muestra su contraseña común únicamente en una terminal interactiva local. El estado privado también contiene `fixturePassword`. No copies ese valor a reportes o commits. Repetir `db:seed` reconcilia las cuentas ficticias por ID/correo y sus estados; no es una operación de producción.

`Ctrl+C` detiene el desarrollo. `npm run local:down` detiene únicamente Supabase de Alunza y conserva sus volúmenes. No hay reset destructivo en el arranque normal. Una migración ya aplicada se corrige con una migración nueva; no se promete recuperar datos borrados mediante rollback automático.

## Comprobaciones

Para RUN usa la API nativa local y la imagen preparada. El botón Ejecutar muestra
pruebas visibles y resultados temporales; repetir una solicitud incierta recupera
la misma ejecución. La base guarda metadatos operativos durante la recuperación,
sin crear intentos ni progreso. Compose conserva RUN deshabilitado porque no
recibe acceso al daemon Docker. El [registro IMP-03](docs/work/IMP-03-practice.md)
explica límites, cuotas y tratamiento de errores.

Para guardar evidencia, usa **Enviar intento** y confirma el código capturado.
SUBMIT ejecuta pruebas visibles y ocultas; el historial permite consultar, comparar
las pruebas visibles y copiar un intento al borrador antes de confirmar otro.
**Recuperar envío** reutiliza la clave de una respuesta incierta. Los envíos que
el servidor admitió antes del cierre pueden terminar después; CLOSED conserva
historial autorizado. El avance requiere todas las pruebas superadas, y un fallo
posterior no borra un éxito anterior. El [registro de envíos](docs/work/IMP-03-submissions.md)
detalla persistencia, cuotas compartidas y reproducción.

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

El corte IMP-03 incorpora `npm run test:practice:performance` y su variante
`npm run test:practice:performance -- --submit` a la CI: cada perfil usa 50 muestras
secuenciales y 50 a concurrencia cuatro en TEST aislado. SUBMIT mide también su
persistencia y exige una suite visible/oculta. Los reportes actuales quedan en
`.local/reports/imp-03-submissions/`; `.local/reports/imp-03/` conserva el cierre RUN
previo. El perfil documenta su límite de frecuencia elevado solo durante medición.

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

Los informes del candidato IMP-05 están en `.local/reports/imp-05/` y los de
evaluación de ayuda en `.local/reports/imp-04/`; los grupos anteriores conservan
sus cortes históricos. Los diagnósticos saneados permanecen en `.local/evidence/`
por incremento. El [inventario Cypress](tests/e2e/README.md) incluye los
recorridos actuales y capturas explícitas; videos, capturas automáticas de fallo
y Cypress Cloud siguen desactivados. La contraseña ficticia entra mediante
`cy.env()` y se escribe sin logging; credenciales administrativas, conexión BD
y clave de control permanecen en Node. El build E2E comprueba que canarios
secretos de Azure/Sandbox no aparezcan en artefactos públicos.

`npm run test:gates` demuestra por separado que los cinco comandos de formato/lint/tipos/tests/build rechazan un defecto deliberado. Usa una copia física aislada del código y dependencias en el directorio temporal del sistema (`alunza-gate-probes/run-*`), verifica primero un baseline correcto y restaura las fuentes después de cada caso. Puede tardar varios minutos; no se ejecuta en cada push. No necesita Supabase y no modifica las aplicaciones de trabajo.

La verificación de IMP-06.03 se registra en [detalle docente](docs/work/IMP-06-student-detail.md).
Como antecedente, el [registro IMP-06.02](docs/work/IMP-06-bank-governance.md),
del 27/10/2026: 214 pruebas HTTP, 1126 aserciones SQL y 88/88 E2E sin omitidos;
los tres gates SUBMIT consecutivos aprobaron. La CI terminó con 16/17 etapas
aprobadas: la evaluación TEST rechazó un cambio documental del candidato
durante el ensayo; su repetición con el repositorio congelado aprobó a las
17:28:18 UTC. No se reclasifica la corrida original como CI 17/17.
El registro conserva el fallo, la repetición y la actualización aditiva .01→.02.
El [cierre IMP-06.01](docs/work/IMP-06-bank-read.md) mantiene su CI histórica
17/17 y sus perfiles API. El
[cierre IMP-05.08](docs/work/IMP-05-acceptance.md) conserva su
[matriz](docs/work/IMP-05-acceptance-matrix.md) y los comandos específicos de
progreso/tablero/reglas; los scripts vigentes están en `package.json`.
No se acredita CI Linux/remota.

### Antecedentes de CI del 02/10/2026

Los resultados siguientes pertenecen a sus commits históricos y no al candidato
IMP-05.08. [El workflow](.github/workflows/foundation.yml) usa Ubuntu24.04,
acciones oficiales fijadas por SHA y permisos de lectura; atiende PR, push a
main y ejecución manual. El [registro del 02/10](docs/work/2026-10-02-git-and-ci.md)
documenta la publicación de la rama `laboratorio` en `equipo` y la
[ejecución manual 36968922897](https://github.com/marcnunezs/alunza-edu/actions/runs/36968922897),
sobre `4a3ee8f`: **17 controles**, 985 unidades, 146 HTTP, 471 SQL,
27 pruebas IA/pgvector, 45 Cypress y evaluación TEST completa. No acredita
las integraciones alojadas ni aceptación docente.

El job tiene un límite de 90 minutos. La corrida local aprobada que motivó el ajuste tomó 50 min 13 s en sus 17 etapas, sin contar instalación ni preparación del workflow. El primer job remoto duró **43 min 23 s**, superando el límite anterior de 40 minutos. La nueva revalidación local falló en la tercera serie SUBMIT por p95 concurrente de **6.273,51 ms** frente a 5.000 ms; las tres series remotas aprobaron. Integración IA, Cypress y evaluación TEST locales aprobaron por separado después del fallo. El [registro de consolidación y revalidación](docs/work/2026-10-02-git-and-ci.md) conserva ambos resultados y el pendiente de rendimiento local.

El [diagnóstico posterior de SUBMIT](docs/work/2026-10-02-submit-diagnostics.md) añade observación privada TEST por fase y correlación de recuperación. La confirmación de salida Docker se solapa con el drenaje de streams, conservando ambas verificaciones y limpieza. La [CI 37041475335](https://github.com/marcnunezs/alunza-edu/actions/runs/37041475335), sobre `9e47eb8`, aprobó **17/17 controles y 1.334 pruebas unitarias**, con tres series SUBMIT consecutivas de p95 concurrente **1.195,34 / 1.218,72 / 1.180,93 ms**, 300 respuestas válidas, limpieza y la misma imagen. El [ensayo de Docker Desktop](docs/work/2026-10-02-docker-desktop.md) comprobó el objetivo local de RNF-REN-02 tras un reinicio y con la carga original restaurada: tres p95 concurrentes de **4.430,16 / 4.983,38 / 3.937,19 ms**, 300 respuestas válidas, limpieza, fuentes e imagen idénticas. Se conservan las fallas previas y el margen estrecho de la segunda serie; la carga y el umbral de 5.000 ms se mantienen. Sandbox productivo, ambiente híbrido real y aceptación académica continúan pendientes.

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

El corte de ensayos anterior precede a IMP-01. La implementación institucional
se registra en [IMP-01](docs/work/IMP-01-identity.md) y el contenido/editor en
[IMP-02](docs/work/IMP-02-content.md). Sus resultados y brechas conservan su
fecha; el [estado actual](docs/estado-actual.md) enlaza las comprobaciones
posteriores. Las CI remotas descritas arriba corresponden a sus commits
históricos y no validan automáticamente el candidato vigente.

## Identidad y gobierno institucional

La interfaz incluye `/acceso`, `/inicio`, `/administracion/organizaciones`, miembros/invitaciones por organización y `/acceso/invitacion`. ADMIN administra su ámbito; TEACHER y STUDENT ven su contexto real. El archivo queda en lectura administrativa. La cuenta puede pertenecer a varias organizaciones, con un rol por membresía; deshabilitar una no bloquea las demás.

Para actualizar una base IMP-00 existente: `npm run db:migrate` y `npm run db:seed`, sin reset de desarrollo. El permiso para crear una organización se concede por UUID mediante `node scripts/provisioning.mjs --help`; la herramienta exige actor, motivo y vencimiento. Las cuentas del producto no pueden concederlo. [El manual del incremento](docs/work/IMP-01-identity.md) detalla comandos y permisos mínimos de Auth.

Las invitaciones duran 72 horas y usan Mailpit local; solo guardan el digest institucional. Un trabajador durable entrega el enlace, registra incertidumbre/fallo y reconcilia reintentos. El callback permite verificar correo en otro navegador y aceptar dentro de NestJS. No hay registro público ni correo a destinatarios reales en las pruebas.

Cypress conserva los ocho casos FND y añade los recorridos IMP01. El cierre no depende de un número fijo de ocho pruebas: exige todos los identificadores requeridos y ausencia de fallos. Los informes institucionales están en `.local/reports/imp-01/`; el CI conjunto conserva su ruta histórica. La integración comprueba actualización desde IMP-00; E2E reconstruye desde todas las migraciones. [OpenAPI](packages/contracts/openapi.json) se genera desde los contratos compartidos.

## Recorrido de contenido y editor

Con las migraciones y el seed locales aplicados, entra a `/academia` desde el inicio y elige organización. ADMIN crea un curso, habilita al profesor en ese curso y define conceptos. TEACHER crea su clase, emite el código colectivo y prepara un ejercicio con `module.exports.solve`, conceptos y pruebas visibles/ocultas. En la clase crea una actividad, ordena ejercicios y publica. STUDENT confirma su incorporación con el código, abre la actividad y edita su solución. El banco canónico permite explorar también clases, publicaciones, borradores y actividades cerradas sin preparar contenido desde cero.

El código se muestra una vez; si se pierde, se regenera. Las habilitaciones por curso no reasignan clases existentes. Solo ADMIN cambia profesor o archiva clases, y debe cerrar antes sus actividades publicadas. TEACHER cierra actividades; la consulta histórica se conserva. Las fechas de curso/clase son civiles y las ventanas se muestran en la zona institucional.

El editor conserva borradores durante treinta días desde la última edición en ese navegador y cuenta. Cerrar sesión los conserva; volver a abrirlos requiere autorización actual. Hay descarte manual y aviso si el almacenamiento falla. El corte histórico IMP-02 no incluía ejecución, envío, ayuda ni avance desde intentos; sus incrementos posteriores se describen en este README. El [manual web](apps/web/README.md) detalla rutas y comportamiento. `npm run test:academic:fixtures` valida diez soluciones correctas y diez incorrectas en Docker; CI lo incluye. Los reportes académicos están en `.local/reports/imp-02/`.

ADMIN puede abrir **Banco de ejercicios** desde Organizaciones, también en una
organización archivada con acceso vigente. La ruta
`/administracion/organizaciones/[orgId]/banco` consulta propietarios, conceptos
fijados, versión actual, historia y usos por actividad/clase; ofrece filtros y
paginación independiente. IMP-06.02 permite cambiar propietario/visibilidad,
crear una versión y archivar, con contexto previo, confirmaciones cancelables,
control de revisión y recuperación de respuestas inciertas. Las actividades
e intentos anteriores conservan su versión, pruebas y conceptos.
Los registros de [consulta](docs/work/IMP-06-bank-read.md) y
[gobierno](docs/work/IMP-06-bank-governance.md) conservan contratos, resultados
y límites; `test:bank:integration`, `test:bank:upgrade` (alias
`test:bank:governance:upgrade`), `test:bank:performance` y
`npm run test:e2e -- --bank-governance` usan LAB TEST exclusivo.

El profesor abre **Ver detalle del estudiante** desde el tablero de su clase.
IMP-06.03 conserva corte/filtros al navegar, presenta resultados públicos y
ayuda entregada, y reautoriza fuentes/documentos. Sus focos usan LAB TEST
exclusivo: `test:student-detail:integration`, `test:student-detail:upgrade`,
`test:student-detail:performance` y `npm run test:e2e -- --student-detail`.

## Materiales docentes

En una clase o actividad, profesor y ADMIN autorizado pueden cargar PDF con
texto, TXT o Markdown de hasta 10.000.000 bytes. Materiales muestra recepción,
procesamiento y versión disponible por separado. El docente puede reemplazar
sus archivos creando otra versión o reintentar un fallo; ADMIN dispone de
reindexación, visibilidad y archivo. Un reemplazo fallido conserva la versión
anterior. Las descargas pasan por NestJS y requieren autorización vigente.
El historial autorizado permite consultar versiones y fragmentos con su
localizador; los estudiantes acceden únicamente al material disponible de su
ámbito.

El worker utiliza Storage privado y Azure OpenAI para embeddings. Configura
`MATERIALS_WORKER_ENABLED` y el bloque de embeddings documentado en
[.env.example](.env.example) solo en servidor. Sin proveedor configurado se
informa un fallo recuperable, sin simular disponibilidad. El perfil de embeddings
queda fijado para ese ambiente; un cambio incompatible requiere migración
explícita. La generación de explicaciones y pistas se integra en IMP-04.04–04.06,
implementado y probado localmente con proveedor TEST explícito.

El [manifiesto de materiales](fixtures/demo/materials.mjs) contiene seis archivos
ficticios, dos por clase canónica. `npm run materials:demo` los carga mediante la
API local con claves idempotentes; consulta su estado en Materiales después de
la recepción. Si Azure está configurado, esa carga puede generar consumo real.
Las pruebas TEST usan un doble de embeddings explícito y conservan Auth,
extracción, Storage y pgvector reales. El
[registro del corte](docs/work/IMP-04-materials.md) separa esa evidencia del ensayo
Azure pendiente. Vercel Sandbox, IMP-03.07, sigue pendiente antes de producción.

## Ayuda sobre intentos guardados

IMP-04.04–04.06 está **implementado y probado localmente**. En el resultado de
un envío confirmado o su historial, el estudiante solicita una explicación o
una de tres pistas progresivas. La ayuda usa el código guardado y conserva el
borrador. Abrir una pista preparada confirma su presentación; consultar estado
no consume niveles. Los fallbacks conservan el diagnóstico y permiten continuar.
Las referencias muestran documento, versión, fragmento y ubicación; la descarga
privada revalida permisos incluso para una versión histórica citada.

La ayuda propia está disponible también para actividades CLOSED. SUCCESS admite
explicación y un fallo de infraestructura recibe una explicación determinista
sin IA. RUN y un envío pendiente no habilitan ayuda. Este corte no habilita
lectura docente de intentos ajenos ni chat libre. El
[registro de ayuda](docs/work/IMP-04-help.md) detalla contratos, resultados y fallos
previos. Cypress aprobó **42/42 recorridos**, incluidos los cuatro de ayuda, con
Auth, API, Storage y pgvector reales y proveedor de IA TEST explícito.

Activa el consumidor con `HELP_WORKER_ENABLED` solo en servidor. El bloque de
[.env.example](.env.example) separa generación/verificación de embeddings y
requiere deployment, modelo, ID de configuración, tokenizer comprobado y un
artefacto de calibración `HELP_CALIBRATION_JSON` vinculado mediante
`HELP_CALIBRATION_CORPUS_SHA256`. Esas variables no son `NEXT_PUBLIC`.

`npm run help:plan` prepara un plan offline desde el
[manifiesto de ayuda](infra/preproduction/help-manifest.example.json), sin llamar
a Azure ni desplegar recursos. El corte IMP-04.07/preparación .08 añade corpus
adversario, fallos recuperables y un arnés ejecutable en LAB-EVAL aislado, con
autorización por etapas, límites y recibos privados de llamadas. Está
**implementado y probado en TEST**. `npm run help:eval -- --mode plan`
describe el nuevo manifiesto sin llamadas; el
[manual operacional](docs/work/IMP-04-evaluation-operations.md) explica ambiente,
consumidor, preparación, autorización, calibración y reanudación.
Configuración y calibración Azure reales, p95 remoto, calidad semántica,
evaluación docente y aceptación CAPSTONE siguen pendientes. También siguen
pendientes Vercel Sandbox IMP-03.07 y operación productiva del consumidor en ACA.

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

Para continuar, leer [estado actual](docs/estado-actual.md), fuentes y decisiones,
producto y arquitectura; luego los contratos y criterios del área solicitada.
Tratar pendientes mediante el [registro de decisiones](specs/00-fuentes-y-decisiones.md),
conservando resoluciones previas y distinguiendo trabajo local, validación
remota y aceptación humana. No reiniciar capacidades existentes.

## Documentación original

Las fuentes se conservan en [Evidencias CAPSTONE](<Evidencias CAPSTONE/Fase 1>). El [inventario](specs/00-fuentes-y-decisiones.md) identifica los archivos usados y sus límites. Los specs complementan las evidencias académicas y no sustituyen sus aprobaciones.

El contrato de operación y sus procedimientos remotos pendientes permanecen en
[operación y despliegue](specs/11-operacion-y-despliegue.md); los comandos
anteriores operan el laboratorio local existente.

## Desarrollo por fases

El [plan progresivo de implementación](docs/plan/README.md) organiza el desarrollo en nueve fases, con incrementos pequeños, dependencias, resultados observables, pruebas y criterios de cierre. Incluye una [matriz de control y trazabilidad](docs/plan/09-control-y-trazabilidad.md) y un archivo detallado por fase.

El corte [IMP-00.01 a IMP-00.04](docs/plan/00-fundacion.md) implementa versiones, workspace, Supabase local y una conexión real web/API/datos con acceso protegido. Su evidencia está en [el registro de trabajo](docs/work/IMP-00-foundation.md); [IMP-00.05](docs/work/IMP-00.05-ci-y-cypress.md) incorpora CI y Cypress. La fase IMP-00 completa y los RF de negocio no se dan por terminados.
