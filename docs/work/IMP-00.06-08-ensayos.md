# IMP-00.06–IMP-00.08 — Ensayos técnicos de fundación

Fecha de inicio: 2026-09-10. Implementación y comprobación: Codex. Encargo: implementar el plan aprobado de estos tres ensayos. No se atribuye aceptación al PO, docentes ni integrantes. Se conservan las evidencias CAPSTONE y los incrementos anteriores. No se implementan otras fases ni se completan RF de negocio.

## Alcance y decisiones

Se reutilizan npm workspaces, Node 24.21.0/npm 11.19.0, TypeScript 5.9.3, Jest, Next/Nest y el lifecycle Supabase TEST. Los ensayos son herramientas internas por consola. No se agregan rutas de ejecución o IA, editor, intentos, tablas académicas, extracción de documentos ni trabajadores de producto.

El usuario eligió preparar y condicionar la ejecución remota, y fijó las unidades en MiB/KiB. Un manifiesto sin recursos, autorización y presupuesto no habilita red de pago. No se reutilizan proyectos visibles de terceros o de otros productos por inferencia. La preparación local no significa despliegue.

| Decisión | Resolución acotada del ensayo                                                                                                                                                                           | Límite que permanece                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| DEC-003  | 134217728 bytes de memoria; 3000 ms acumulados por ejecución; 65536 bytes combinados stdout/stderr. Código y transporte del retorno limitados separadamente a 65536 bytes. Comparador fuera del alumno. | La veracidad de la invocación normal de `solve` no se deduce de un retorno controlado por el alumno. Sandbox remoto requiere prueba real.      |
| DEC-004  | Diagnósticos y ayuda de cinco claves compartidos; contratos de proveedor/ejecutor internos. `X-Release-Id` identifica la API; envelopes y cuatro rutas existentes conservados.                          | No hay API académica, durabilidad de jobs ni contrato completo de intentos.                                                                    |
| DEC-006  | Esquema técnico `rag_probe` exclusivamente TEST; diccionario del fixture junto al SQL.                                                                                                                  | No sustituye clases, materiales ni permisos de negocio.                                                                                        |
| DEC-007  | SDK exactos: Sandbox3.2.2, OpenAI7.15.0, Azure Identity4.13.2. API exige TLS verificado en remoto; Vercel tiene excepción local al parche de Node, con comprobación explícita.                          | Versiones declaradas, instaladas y ejecutadas se distinguen abajo. Node administrado y GitHub Actions remotos siguen sujetos a ejecución real. |
| DEC-008  | Instrumentación de tiempos, recursos, regiones y consumo en informes.                                                                                                                                   | Sin selección óptima de región, p95 productivo ni estimación presentada como costo observado.                                                  |
| DEC-009  | Datos y certificados ficticios; servicios remotos deshabilitados por defecto. Recuperación de datos por migración correctiva.                                                                           | Sin SLA, RPO/RTO ni aprobación para datos institucionales.                                                                                     |
| DEC-010  | Puertos separados, schema Azure compatible más validación Zod completa, recuperación autorizada antes del límite y revalidación posterior.                                                              | Vectores sintéticos no prueban semántica Azure; referencias válidas no acreditan calidad pedagógica general.                                   |
| DEC-012  | Dos organizaciones/seis usuarios existentes y seis documentos ficticios preparados para el ensayo.                                                                                                      | Subconjunto técnico, no demo canónica completa.                                                                                                |

## Ejecutor

El supervisor conserva expectativas, comparador, presupuesto y diagnóstico. El alumno sólo recibe código y argumentos del caso actual. Los resultados del alumno se consideran datos no confiables: nunca se aceptan `passed`, diagnósticos o contadores como autoridad. La proyección pública excluye argumentos, salida y detalles privados. Cada caso usa contenedor nuevo y toda ejecución comparte presupuesto de tiempo y salida.

El proceso estudiantil y sus descendientes usan UID10001 y cinco conjuntos de capabilities en cero. El puente confiable PID1 usa UID0 y conserva SETUID/SETGID/SETPCAP para separar los procesos y sus canales. **Es una desviación del contenedor enteramente sin privilegios y sin capacidades:** el prototipo no acredita esa propiedad. El puente también cuenta dentro de los128MiB; `/tmp` tiene un máximo de8MiB dentro del presupuesto. Red deshabilitada, filesystem de sólo lectura, sin montajes del anfitrión, `no-new-privileges`, swap0, CPU1 y pids32 se comprueban con Docker y cgroup v2 reales.

El fixture `forged-return-known-gap` escribe un valor coincidente directamente en fd3 y termina antes del retorno normal de `solve`. El supervisor lo compara externamente y obtiene `SUCCESS`, pero el informe lo identifica como **KNOWN_GAP**: no prueba la autenticidad de la invocación. El alumno no controla el veredicto ni accede a expectativas; esta brecha impide aceptar la cápsula como ejecutor de producto. La reproducción y los contraejemplos están en [el ensayo del ejecutor](../../infra/runner/README.md).

Los eventos cgroup y la inspección externa sustentan memoria/terminación; exit137 por sí solo no basta. El kernel puede mostrar excesos transitorios y demora efectiva de terminación, conservados en la evidencia. Preparación y limpieza se miden por separado. Los3000ms externos se acumulan entre casos e incluyen arranque estudiantil/serialización; no garantizan latencia completa de3s ni ausencia de escapes.

Sandbox admite un único ensayo por invocación, con VM1vCPU/2048MiB, plazo exterior máximo60s, `persistent:false`, red `deny-all`, sin puertos y cápsula precargada. Se reservan ocho solicitudes y hasta30s exclusivamente para limpieza; el Job permite35s de gracia y ACA40s. La imagen exterior se construyó localmente; Docker/cgroups anidados, optimización/publicación VCR y limpieza remota siguen **pendientes por configuración**. No se crearon snapshots ni Sandboxes remotos.

Fuentes primarias: [recursos Docker](https://docs.docker.com/engine/containers/resource_constraints/), [cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html), [advertencia de Node VM](https://nodejs.org/docs/latest-v24.x/api/vm.html), [imágenes Sandbox](https://vercel.com/docs/sandbox/concepts/images) y [persistencia Sandbox](https://vercel.com/docs/sandbox/concepts/persistent-sandboxes).

## IA y corpus

Se utiliza PostgreSQL/pgvector real con rol `alunza_app`, RLS y transacciones de lectura. El esquema y los negativos sólo se preparan tras adquirir el bloqueo compartido de Supabase TEST. Los filtros de organización, clase, actividad, visibilidad, estado e índice/configuración se aplican antes de `LIMIT 5`; no hay índice ANN para este corpus pequeño.

Los vectores locales de tres dimensiones están identificados como sintéticos. Los fragmentos están preparados: no acreditan extracción PDF, tokenización500/50, Storage, reindexación durable ni ayuda progresiva. La política semántica del fixture es un oráculo acotado y versionado, no evaluación pedagógica general.

El adaptador Azure exige endpoint/deployments/modelos/dimensión configurados. `AI_EMBEDDING_MODEL` y `AI_GENERATION_MODEL` deben coincidir **exactamente con `response.model`**, no con el alias del deployment; una discrepancia se rechaza antes de publicar vectores o resultados. La identidad de Azure o la clave se eligen explícitamente, sin fallback. El SDK no reintenta la generación. Los15s cubren embeddings, recuperación y generación; preparación y limpieza de Supabase quedan fuera, aunque `durationMs` las incluye. No se habilitan herramientas del modelo.

El ensayo local aplica un oráculo semántico limitado al fixture y distingue `NO_EVIDENCE` de `PROVIDER_UNAVAILABLE`, conservando el diagnóstico. El probe Azure valida transporte, dimensión, estructura y referencias; mantiene pendiente la revisión semántica. Sus fallos generan informe fallido y salida1. `rag-local`, predeterminado, crea una generación separada en TEST con embeddings reales y exige `AI_MAX_COSINE_DISTANCE` provisional; `connectivity`, usado por el Job, recibe contexto ficticio fijo y **no acredita recuperación ni autorización SQL**. El schema enviado a Azure omite restricciones no admitidas, que Zod valida al recibir la respuesta. No hay rutas HTTP de IA ni ayuda pedagógica de producto.

Fuentes: [Structured Outputs de Azure](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs), [API v1](https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle), [SDK OpenAI](https://github.com/openai/openai-node) y [RAG con permisos](https://supabase.com/docs/guides/ai/rag-with-permissions).

## Preproducción

La API admite `ENVIRONMENT=preproduction`, exige `RELEASE_ID` SHA40, orígenes HTTPS explícitos, emisor y JWKS coincidentes y CA PostgreSQL válida en `DATABASE_SSL_CA`. El pool configura `rejectUnauthorized:true` y `servername` explícito. La conexión remota no acepta query parameters porque [pg puede reemplazar la configuración SSL al interpretarlos](https://node-postgres.com/features/ssl). El rol SQL real sigue verificándose como `alunza_app` incluso cuando el usuario de conexión al pooler incluye el ref del proyecto.

Las pruebas TLS realizan la negociación PostgreSQL SSLRequest y el handshake real en loopback: CA confiable/hostname correcto admitidos, CA ajena y hostname incorrecto rechazados. No simulan una base de datos remota ni acreditan conexión con Supabase alojado. El certificado y su clave en `tests/fixtures/tls` son públicos y ficticios, exclusivamente de prueba; jamás se configuran en una aplicación.

Vercel administra los patches de Node24. El wrapper conserva los engines exactos globales y permite sólo esa diferencia del paquete raíz en el entorno Vercel, usando npm11.19 y verificando los engines instalados y el hash del lock. [Versiones de Node en Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

La configuración declarativa y el Job manual no se ejecutan automáticamente. API tiene identidad con AcrPull; el Job tiene identidad exclusiva y, cuando corresponde, permiso OpenAI User sólo sobre el recurso elegido. El bootstrap Supabase exige `supabase:bootstrap`; `azure:deploy` no lo habilita. El adaptador Azure y el Job de conectividad no reciben credenciales administrativas. `rag-local` usa las de Supabase TEST exclusivamente para preparar/limpiar el fixture, separadas del rol ordinario de consulta.

El smoke remoto es no destructivo: nunca usa reset ni parada de BD. Comprueba HTTP/Auth/API; el recorrido remoto de navegador sigue pendiente. Exige29slots para los tres roles (32con cuenta deshabilitada opcional), reserva logout antes de cada login y permite sólo esa limpieza durante35s tras el deadline. **`maxCost` no corta automáticamente la facturación**: es el límite autorizado que acompaña a los topes efectivos de llamadas, tokens y duración. Costo observado N/D; regiones declaradas no equivalen a ubicación observada. El Job conserva sólo un informe acotado por allowlist; exit0 sin mediciones completas o limpieza verificada no es aprobado.

El rollback restaura aplicación y configuración compatible anteriores; secretos/configuración compartidos y datos no revierten con una revisión. La recuperación de datos avanza por migración correctiva; restaurar un respaldo requiere procedimiento explícito. Las etiquetas de vencimiento no eliminan recursos. La secuencia de bootstrap, despliegue, smoke, rollback y retiro está en [preproducción](../../infra/preproduction/README.md).

## Reproducción

Desde la raíz Git en Windows:

```powershell
. ./scripts/use-node.ps1
npm ci
npm run ci:verify
```

El mismo `ci:verify` se configura en GitHub Actions. Ejecuta comprobaciones estáticas y unitarias, preparación/doctor/ensayo Docker, integración existente, integración IA y Cypress con builds y revisión de artefactos. Las suites de BD son seriales y reconstruyen únicamente TEST16421–16424. El arranque normal DEV15421–15424 conserva sus datos.

Comandos independientes: `runner:prepare`, `runner:doctor`, `runner:probe -- --adapter docker`, `runner:cleanup`, `test:runner`, `test:ai`, `test:ai:integration`, `ai:doctor`, `preprod:check`, `preprod:plan`. La ejecución Azure/Sandbox/smoke requiere manifiesto completo y autorizado; ausencia de condiciones devuelve2, fallo devuelve1 y comprobación satisfecha devuelve0. Los informes distinguen falta de configuración de fallo y de éxito.

Preparación local de la imagen exterior, sin publicar ni invocar Sandbox:

```powershell
npm run runner:prepare -- --sandbox-context
docker build --platform linux/amd64 -t alunza-runner-sandbox:imp-00-06 .local/runner-sandbox-build
```

La activación siguiente permanece **no ejecutada**. Completar primero el manifiesto privado y las variables del consumidor con destinos y presupuesto autorizados. La imagen Sandbox debe estar disponible por digest en un registro compatible:

```powershell
npm run runner:probe -- --adapter vercel --manifest .local/preproduction/manifest.json
npm run ai:doctor -- --manifest .local/preproduction/manifest.json
npm run ai:probe -- --provider azure --manifest .local/preproduction/manifest.json
npm run ai:probe -- --provider azure --mode connectivity --manifest .local/preproduction/manifest.json
npm run preprod:check -- .local/preproduction/manifest.json
npm run preprod:plan -- .local/preproduction/manifest.json --workloads
npm run preprod:smoke -- .local/preproduction/manifest.json
```

`preprod:plan` sólo prepara archivos. El Job usa connectivity; la prueba RAG con pgvector TEST se ejecuta desde el operador local. Ningún comando de prueba despliega infraestructura. Los wrappers Vercel se ejecutan desde su Root Directory configurado; el ensayo local registra `execution:local-probe`, no deployment.

## Evidencia ejecutada y pendientes

Comprobaciones locales del 10/09/2026 sobre el árbol de trabajo, sin commit ni release remoto emitido. Informes nuevos en `.local/reports/imp-00-06-08/`; integración/Cypress/gates reutilizan `.local/reports/imp-00-05/`. Sólo resúmenes saneados explícitos se seleccionan para CI; nunca estado, claves, logs completos, capturas o videos.

| Comprobación                                       | Resultado observado                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime y motor                                    | Windows/PowerShell; Node24.21.0, npm11.19.0, Docker29.7.2 Linux, Compose5.3.1, Supabase CLI2.101.0                                                                                                                                                                                                                                     |
| Dependencias nuevas                                | Sandbox3.2.2, OpenAI7.15.0, Azure Identity4.13.2 y ws8.21.3 exactos; CommonJS/NodeNext: instalación/tipos/builds en Windows/Linux; Jest en Windows                                                                                                                                                                                     |
| Instalación limpia                                 | `npm ci --no-audit --no-fund`:908 paquetes; `npm ls --all`:salida0. Sin force/legacy-peer-deps ni sustitución del stack                                                                                                                                                                                                                |
| Auditoría de producción                            | `npm audit --omit=dev`:0 vulnerabilidades conocidas en esta consulta; `audit-production.json`                                                                                                                                                                                                                                          |
| CI conjunta local                                  | `npm run ci:verify`:salida0; once pasos aprobados, incluidos formato/lint/tipos, **172 pruebas Jest en seis grupos**, Docker, integración, pgvector y E2E; `ci.json`                                                                                                                                                                   |
| API y TLS                                          | 50 pruebas Jest de API; handshake PostgreSQL/TLS positivo y dos rechazos reales. Imagen API ejecutada como UID1000:live200, ready503 con BD ausente y me401; `api-image.json`                                                                                                                                                          |
| Ejecutor real                                      | CI inicial:33 casos. Revalidación final con heap JS:34 casos, **33PASS +1KNOWN_GAP**,0fallos y0contenedores remanentes;21unitarias del supervisor pasan. Heap:MEMORY_LIMIT, Docker OOMKilled=true y cgroup oom_kill=1, cleanup=true; no inferido de SIGKILL. Doctor comprueba límites/UID/capabilities efectivos; `runner-docker.json` |
| IA/pgvector real                                   | 57unitarias IA;27integradas con PostgreSQL17.6/pgvector0.8.0. Caída/recuperación reales, permisos restaurados y conteos2organizaciones/6perfiles/6membresías; `ai-integration.json`                                                                                                                                                    |
| Corpus                                             | 6documentos/11fragmentos, fixture `fictitious-rag-assay-1`, vectores sintéticos3D y generación4D separada en prueba. Hash `6d7b08e41afc59a5a6166238e30f6ac5f65b1886f15ea6c424bbf336a7c06e3a`                                                                                                                                           |
| Recorrido web                                      | 8/8 Cypress16.0.0, Chrome152.0.7977.83, sin omitidos. Auth/API/BD reales, tres roles, denegaciones, API caída y reintento; `imp-00-05/e2e.json`                                                                                                                                                                                        |
| Artefactos públicos                                | Build completo de los cinco workspaces; revisión de valores privados del entorno y canarios Azure/Sandbox aprobada, ambos `not-found`; `imp-00-05/artifacts.json`                                                                                                                                                                      |
| Controles de defectos                              | `npm run test:gates`:salida0. Cinco baselines aprobados; cinco defectos deliberados rechazados con diagnóstico específico; fuentes restauradas y copia eliminada; `imp-00-05/gates.json`                                                                                                                                               |
| Wrapper Vercel local                               | Instalación limpia sin scripts, engines, hash del lock, tipos, Jest y build Next aprobados; `vercel-build.json`, execution=local-probe. No observado aún otro patch en Vercel                                                                                                                                                          |
| Preparación de preproducción                       | 35Jest aprobados; Bicep0.47.16 compila principal/módulo; actionlint1.7.12 valida el workflow. API/web/Job/imagen Sandbox construidos localmente. Job usuario node, sin secretos en ENV;4negativos sin red devuelven2                                                                                                                   |
| Configuración remota ausente                       | Seis comandos doctor/probes/check/smoke con manifiesto deshabilitado devuelven2 y0llamadas; `pending-commands.json`. Esto prueba el bloqueo, no la integración remota                                                                                                                                                                  |
| GitHub Actions remoto                              | No ejecutado; conserva el pendiente de IMP-00.05                                                                                                                                                                                                                                                                                       |
| Vercel/Azure/Supabase alojado/Sandbox/Azure OpenAI | **Pendiente por configuración y autorización:** sin despliegues ni llamadas remotas. No hay comprobaciones remotas aprobadas, medición de costo ni aceptación humana                                                                                                                                                                   |

Incidencias resueltas con evidencia:

- El primer `npm ci` seguido de `npm ls --all` detectó ELSPROBLEMS: OpenAI7.15 requiere peer opcional ws^8.21 y Cypress usa ws7.5.13. Se aisló ws8.21.3 en AI; la instalación limpia y el árbol completo posteriores pasan. No se forzó a Cypress a usar otra major. El lock único conserva SHA256 `198414a36919d38f0724e825b3046e79f8991742dda52c1cef4faa431056f769`.
- La primera copia aislada de `test:gates` omitía `packages/ai/node_modules` y falló su baseline de tipos con TS2307. Se corrigió la copia de dependencias por workspace a partir del lock. La segunda ejecución completó baselines, defectos y restauración; fallo inicial conservado en `.local/evidence/imp-00-06-08/gates-initial-failure.{json,log}`.
- La allowlist del contexto Docker incluye únicamente los manifests nuevos para las imágenes web/API; la imagen Job tiene una allowlist independiente. Los builds finales comprobaron esta separación. No se enviaron `.local`, claves, documentos CAPSTONE ni respaldos al contexto.

Identidades de imágenes locales en `local-images.json` (no se presentan como digests publicados en ACR/VCR):

| Artefacto               | Referencia/ID observado                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Base oficial fijada     | `node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553`                                           |
| API                     | `sha256:dce41ee19d38db04254cb3c35c42e6f66bb793ddabc40ffe4f3987ee3ca1d48e`                                                                      |
| Web                     | `sha256:696388b0d80ee3d7d53c49fa94bc9608cbb8e2581f7f40a216d30b04ea4431b3`                                                                      |
| Cápsula local           | `sha256:e7f970bc2dee7af339aa1891265047634f8ec4663a0b74691ba620f85937dabe`                                                                      |
| Imagen exterior Sandbox | `sha256:ffe4aaeae052b8f22c343e4a50c6c5ce057e891ae2e95cc080bfd84e8f228020`                                                                      |
| Job manual final        | `sha256:59403e8f96a624101879cca81a9cbda0a5aed2a4ff72b41e52b15181299e7117`; reconstruido con el fixture final, prueba sin autorización retorna2 |

La imagen exterior registra Node24.21.0, docker.io20.10.24+dfsg1-1+deb12u1+b6, containerd1.6.20 y runc1.1.5 con paquetes Debian; no se iguala al daemon local29.7.2 ni se acredita su funcionamiento anidado. `runner-sandbox-image.json` conserva las versiones observadas. API y Job se construyen con el mismo runtime base, pero tienen consumidores y permisos diferentes.

El corte entrega implementación y comprobaciones locales; las brechas conocidas y dependencias remotas permanecen visibles. No se completa IMP-00 ni se marcan RF de negocio completos. **La siguiente unidad es IMP-01.01**, sin iniciarla en este encargo.
