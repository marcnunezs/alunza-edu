# Fundación local — IMP-00.01 a IMP-00.04

Fecha: 2026-09-10. Implementación y verificación: Codex. Alcance autorizado: base local web/API/datos y controles técnicos de identidad. No acredita aceptación humana, contribuciones académicas de integrantes ni RF de negocio completos.

## Alcance y preservación

Raíz comprobada: `C:/Users/Lenovo/Desktop/alunza-edu/alunza-edu`. Al iniciar no había aplicaciones, manifests, lockfile ni migraciones. Se preservaron los cambios previos de cinco minutas y tres mockups, y la documentación/specs no versionados. No se usaron respaldos externos como fuente ni se modificaron originales Office. La entrega permanece como archivos revisables del árbol de trabajo; no se creó un commit ni una publicación.

El corte entrega tres workspaces: `apps/web`, `apps/api`, `packages/contracts`; scripts locales; infraestructura Compose de web/API; Supabase CLI, migración, fixture y pruebas. La API implementa exclusivamente `GET /health/live`, `/health/ready`, `/api/v1/me` y `/api/v1/organizations/{orgId}`. Los contratos Zod generan `packages/contracts/openapi.json`.

## DEC-007: compatibilidad declarada y ejecutada

| Componente                 | Versión fijada y comprobación                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| Node / npm                 | 24.21.0 / 11.19.0, portable Windows y base Linux Compose                                          |
| NestJS                     | 12.0.1, TestingModule real con DI y arranque HTTP                                                 |
| Next.js / React            | 16.3.4 / 19.3.0, build y navegador                                                                |
| TypeScript                 | 5.9.3, strict, tipos/build de los tres paquetes                                                   |
| Jest / ts-jest             | 30.5.1 / 29.4.12, ejecución real con módulos VM                                                   |
| Tailwind / Zod             | 4.3.3 / 4.6.1, build CSS y contratos compartidos                                                  |
| Supabase CLI / SDK         | 2.101.0 / 2.116.0, arranque y Auth real                                                           |
| pg / jose                  | 8.23.0 / 6.2.12, PostgreSQL y JWT ES256 real                                                      |
| ESLint / typescript-eslint | 10.10.0 / 8.70.0, lint sin errores                                                                |
| PostgreSQL / pgvector      | Motor SQL 17.6 / extensión 0.8.0; operaciones vectoriales comprobadas en transacción con rollback |

Entorno: Windows x64, PowerShell, zona America/Santiago; Docker Desktop 4.86.0 con motor Linux 29.7.2 y Compose 5.3.1. Node global inicial era 24.14.0/npm11.9.0. `scripts/use-node.ps1` descarga la distribución oficial, verifica SHA256 y activa PATH solo en esa sesión. No sustituye herramientas globales.

La compatibilidad de esta combinación está **probada localmente**, tanto en Windows como en builds Linux. **CI sigue pendiente**. Se usa npm workspaces con un lockfile, dependencias directas exactas y sin orquestador adicional. API/contratos usan CommonJS y NodeNext; Next mantiene su configuración de módulos. Nest12 ESM se consume con `require(esm)` de Node24, conservando Jest/TypeScript5; no se adoptaron los defaults del generador Nest.

Discrepancias resueltas con evidencia:

- ESLint9.39.5 estaba fuera de soporte. Los plugins react/import/jsx-a11y incluidos por eslint-config-next no declaraban ESLint10; se conservaron reglas oficiales con `@next/eslint-plugin-next16.3.4` y `react-hooks7.1.1`, junto con revisión accesible real. ERESOLVE del grafo anterior se resolvió regenerando el lock desde manifests exactos en un directorio aislado y preservando el previo, sin force ni legacy-peer-deps.
- El primer audit informó cuatro hallazgos altos derivados de multer2.2.0 en Nest. Override explícito a multer2.3.0; audit final cero hallazgos conocidos. Multipart aún no tiene consumidor y requerirá pruebas cuando se implemente.
- npm informa la deprecación transitiva de glob10.5.0 y scripts opcionales no aprobados de @parcel/watcher/unrs-resolver. Las instalaciones, lint y builds utilizan los binarios disponibles y pasan; no se habilitaron scripts indiscriminadamente. Jest informa que VM Modules sigue experimental.
- Next16.3 generó instrucciones de agente al arrancar. Se desactivó con `agentRules:false`, respaldado por su documentación incluida; solo se retiraron esos archivos automáticos recién generados.

Fuentes técnicas contrastadas: [Node24.21](https://nodejs.org/en/blog/release/v24.21.0), [Nest12 y módulos](https://docs.nestjs.com/migration-guide), [Jest ESM](https://jestjs.io/docs/ecmascript-modules), [ESLint soporte](https://eslint.org/version-support/), [Multer2.3](https://github.com/expressjs/multer/releases/tag/v2.3.0), [JWT Supabase](https://supabase.com/docs/guides/auth/jwts), [firma en CLI2.101](https://github.com/supabase/cli/blob/v2.101.0/apps/cli-go/internal/gen/signingkeys/signingkeys.go).

## Datos, identidad y decisiones

**DEC-006:** [diccionario mínimo](IMP-00-dictionary.md) preparado antes del DDL y contrastado con specs. Sigue provisional local; aprobación del modelo completo pendiente. Tres tablas privadas `app.organizations`, `app.profiles`, `app.organization_memberships`, UUID/FK/unicidad y catálogos exactos. RLS activada y forzada; `alunza_app` solo lectura, sin propiedad, superusuario, membresías de otros roles ni BYPASSRLS. Readiness verifica también esos atributos. No se publica `app` por PostgREST y `anon`/`authenticated` carecen de acceso directo.

El primer arranque falló en `ALTER ROLE NOSUPERUSER`: el rol postgres de Supabase no es superusuario, aunque tiene CREATEROLE/BYPASSRLS. Se reemplazó por una validación de atributos del rol existente antes de aplicar por primera vez la migración. Las contraseñas se configuran fuera del SQL versionado; bootstrap/migración y API tienen credenciales separadas. La recuperación acordada es migración correctiva nueva. El arranque normal no reinicializa datos; los negativos usan exclusivamente el proyecto de pruebas.

**DEC-004:** envelopes `{data,requestId}`/`{error,requestId}`, errores seguros, CORS de orígenes explícitos y `no-store`. Auth local emite ES256 y la API contrasta firma, algoritmo, emisor, audiencia, expiración y UUID del sujeto con JWKS. La clave privada se genera solo si falta y se reutiliza fuera de Git. `user_metadata` no otorga permisos. Cada consulta protegida abre transacción de lectura, establece actor verificado, consulta perfil/membresías vigentes y solo entonces fija organización. Los parámetros y contexto local evitan herencia del pool tras éxito o rollback. RLS confía en el actor establecido por NestJS: la credencial PostgreSQL ordinaria es privada de API; no constituye autenticación independiente de alguien que ya posee esa credencial y puede ejecutar SQL arbitrario.

Los logs incluyen fecha UTC, ambiente, `release: foundation-local`, método/ruta normalizada, requestId, resultado y duración. No se atribuye un commit/release publicado. El emisor público Auth se distingue de JWKS/BD internos de Compose. Configuración inválida impide escuchar conexiones.

**DEC-012:** dos organizaciones y seis identidades ficticias: ADMIN, TEACHER y STUDENT por organización. IDs/correos están en `fixtures/foundation/identity.json`; contraseña común generada localmente. Es un subconjunto de la demo canónica. Seed repetido recupera estados, archivo/deshabilitación y fechas del fixture, sin borrar otros datos. La prueba adicional altera esos campos en el proyecto aislado, ejecuta seed, verifica conteos2/6/6 y acceso, y restaura capturas en finally.

## Entorno Docker observado

Los puertos54321–54324 pertenecían a otro proyecto. Windows/WSL reservaba553xx/563xx y devolvía EACCES. Se comprobó bind antes de escoger15421–15424 para desarrollo y16421–16424 para pruebas; API de prueba4100. Los scripts verifican identidad del proyecto, puerto y destino local y no detienen servicios ajenos.

Imágenes observadas: PostgreSQL `public.ecr.aws/supabase/postgres:17.6.1.106`, Auth `gotrue:v2.188.1`, PostgREST `v14.10`, Studio `2026.04.28-sha-89d08a2`, postgres-meta `v0.96.4`, mailpit `v1.22.3`, Kong `2.8.1`, todas del registro Supabase. La inspección con IDs y puertos se conserva en `.local/evidence/supabase-images.json`.

**Límite efectivo de red:** la CLI publica los puertos de Supabase en `0.0.0.0` y `::` en este Docker Desktop, incluso al crear una red exclusiva con `com.docker.network.bridge.host_binding_ipv4=127.0.0.1`. Se inspeccionó el binding real; no se afirma acceso exclusivo desde localhost ni garantía de aislamiento de red. Web/API sí usan bind explícito127.0.0.1, también en Compose. No se modificaron daemon/firewall globales ni se recrearon servicios CLI por un mecanismo alternativo. Usar únicamente el fixture ficticio y detener servicios al terminar. [Referencia de binding Docker](https://docs.docker.com/engine/network/drivers/bridge/).

## Registro de verificación

Comandos reproducibles desde raíz Git en [README](../../README.md): activar Node, `npm ci`, `local:doctor`, `local:up`, `db:migrate`, `db:seed`, `dev`; apagado `local:down`. Pruebas y builds tienen códigos de salida verificables. Los resultados siguientes corresponden a ejecución real, no respuestas simuladas.

| Comprobación                | Resultado observado                                                                                                                                                                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instalación desde lock      | `npm ci` repetido en Windows; npm ci de workspaces/runtime en imágenes Linux. Cero vulnerabilidades conocidas en audit; `npm ls --all` sin conflictos.                                                                                                                                                                          |
| Nest y contratos            | 33 pruebas API,5 web,4 contratos:42 aprobadas. TestingModule real, JWT/configuración/HTTP, schemas y rutas OpenAPI. Primera pasada31/33 por TypeError URL: corregido y repetido.                                                                                                                                                |
| Migración/fixture           | Primer arranque de instancia aislada vacía aplicó DDL; posteriores reaplican sin reset. Seed repetido y restauración del fixture comprobados.                                                                                                                                                                                   |
| Integración final           | 38/38 Jest con Auth/API/PG reales y14/14 pgTAP. Primera pasada35/36 por importación JWK adversarial: corregida copia en memoria con key_ops sign, sin alterar clave del servicio.                                                                                                                                               |
| Permisos/negativos          | Seis JWT reales y tres roles; ausente/alterado/vencido, issuer/audience; cuenta/membresía inactiva y revocación tras emitir token; organización ajena/inexistente404 indistinguible; RLS sin contexto, contexto ajeno, pool tras commit/rollback; escritura y acceso anon/authenticated rechazados; restricciones e integridad. |
| Caída real de PostgreSQL    | Solo contenedor TEST detenido: readiness503, consulta protegida503 PERSISTENCE_UNAVAILABLE, liveness200; al iniciar, readiness y consulta vuelven200. Cleanup detiene proyecto TEST y conserva volúmenes.                                                                                                                       |
| Navegador dev               | Chrome152/agent-browser0.35.1: credenciales inválidas rechazadas; estudianteA, profesorA y adminB obtienen perfil/org propios; recarga mantiene sesión; signout oculta datos y devuelve foco al correo; submit/signout con teclado.                                                                                             |
| Accesibilidad básica        | Móvil390x844 sin desbordamiento, foco visible/labels, axe4.12.1: cero infracciones y cero pendientes en estudiante autenticado y sesión cerrada. No acredita conformidad WCAG completa.                                                                                                                                         |
| Checks finales y artefactos | `npm ci`, `format:check`, `lint`, `typecheck`, `test`, `build`, `test:artifacts`: todos salida0. Instalación726 paquetes;42 pruebas;22 artefactos públicos/HTML sin credenciales privadas locales ni clave de firma.                                                                                                            |
| Configuración obligatoria   | Build API sin DATABASE_URL termina1 con CONFIG_INVALID antes de escuchar. Imagen web sin configuración pública termina1 y enumera solo nombres de variables.                                                                                                                                                                    |
| Compose y API caída en web  | `compose:up` salida0; API/web healthy y HTTP200. Login real con contraseña rotada; detener solo API produce error real en Estado/Acceso y retira perfil/org; iniciar API y pulsar ambos reintentos recupera datos. Logout y cierre del navegador completados.                                                                   |

Evidencia local saneada en `.local/evidence/`: `checks-final.txt`, `integration-final.txt`, `integration-api.log`, `npm-audit.json`, `dependency-tree.json`, `compose-final.txt`, `compose-summary.json`, `supabase-images.json`, `web-browser-dev.json`, `web-browser-compose.json`, `startup-missing-config.json`, `web-missing-config.txt` y capturas del flujo. Son archivos locales ignorados por Git; este registro conserva las conclusiones revisables sin adjuntar configuración privada. El fixture, pruebas y comandos permiten repetirlas. `source-sha256.json` identifica los archivos implementados del árbol comprobado; no sustituye un commit.

Incidente de verificación: una referencia de navegador obsoleta tras HMR colocó temporalmente la contraseña ficticia en el correo y apareció en un diagnóstico. Se retiró la captura afectada, se rotó la contraseña local de los seis usuarios y se repitió seed. Se comprobó que la anterior se rechaza y la nueva autentica. No involucró secretos administrativos; las capturas conservadas no contienen contraseñas. Se pasó a localizadores por etiqueta y se cerraron las sesiones de comprobación.

## Límites y cierre del corte

Cobertura técnica parcial vinculada a ALZ-RF-001/HU-001/CU-001/PT-001 y base de RF-020/021; RNF-MAN-01/02/04, RNF-POR-01/03 y RNF-SEG-01/03/05. Ninguno se da por completo ni aceptado. Roles combinados/aprovisionamiento, permisos por clase, revocación estricta de sesiones y experiencia completa de identidad siguen en IMP-01 conforme a sus decisiones.

JWT ya emitidos pueden vivir hasta su expiración; la API revalida estado/membresías en cada consulta. Lo probado no acredita identidad productiva, rendimiento p95, SLA, recuperación institucional, región/costos, piloto ni despliegue. Revisión y reproducción por integrantes humanos/aceptación CAPSTONE pendientes. No se implementaron CI/GitHub Actions, Cypress, ejecutor, IA ni otras fases.

**Cierre técnico del corte: implementado, probado e integrado localmente**, con el límite de red Docker descrito. Instalación desde lock y builds repetidos en Windows/Linux; migración vacía, fixture y recorrido completo real comprobados. La revisión humana no se atribuye al agente. El apagado conserva volúmenes y no afecta otros proyectos.

La siguiente unidad pendiente es **IMP-00.05**. Se detiene la ampliación de alcance; no se declara toda IMP-00 terminada.
