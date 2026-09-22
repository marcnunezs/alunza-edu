# Preproducción técnica · IMP-00.08

Esta carpeta prepara API en Azure Container Apps (ACA), web en Vercel y un Job manual de ensayos runner/IA. No crea recursos al ejecutar los comandos locales de preparación. `manifest.example.json` deniega todas las operaciones remotas. La ejecución exige un manifiesto privado completo, autorización humana referenciada y vigente, destinos exactos, SHA y presupuesto. Cambiar `enabled` no sustituye esa autorización.

## Prerrequisitos y verificación local

- Node **24.21.0**, npm **11.19.0**, lockfile vigente y Docker para construir las imágenes Linux/amd64. No usar `--force` ni `--legacy-peer-deps`.
- Azure CLI y Bicep para la etapa Azure. La plantilla se compiló localmente con **Bicep 0.47.16**; esto no acredita permisos, cuotas o despliegue Azure. Crear asignaciones RBAC requiere permisos de administración de acceso en los ámbitos elegidos; las identidades runtime no los reciben.
- Vercel CLI para vincular el proyecto elegido y crear deployments después de autorización. Configurar Root Directory `apps/web`, inclusión de archivos externos al directorio raíz y Node **24.x**. `apps/web/vercel.json` fija install/build wrappers del monorepo.
- Supabase CLI fijada en el lockfile para las migraciones, acceso bootstrap separado y CA oficial del proyecto remoto. El proyecto debe admitir JWT ES256, extensión vector y el esquema/grants vigentes.

Desde la raíz del repositorio, con Node activado:

```powershell
npm ci
npm run test:preproduction
npm run preprod:check
az bicep build --file infra/preproduction/main.bicep --outfile .local/preproduction/main.json
docker build --platform linux/amd64 -f infra/preproduction/Job.Dockerfile -t alunza-preprod-job:local .
```

`preprod:check` y `preprod:smoke` salen **2** si faltan configuración o autorización; **1** indica ensayo fallido y **0** éxito del comando. Con el ejemplo no hay peticiones remotas. Los informes públicos saneados están en `.local/reports/imp-00-06-08/`; el manifiesto y parámetros secretos pertenecen a `.local/preproduction/`, ignorado por Git. No copiar `.local/runtime.json`, `.env.local` ni claves locales de firma.

La imagen Job tiene contexto Docker permitido por lista, base Node fijada por digest, usuario `node`, sin daemon ni socket Docker del host. Compila contratos, runner e IA. El Sandbox remoto usa una imagen **distinta**, `targets.sandbox.image`, previamente preparada y fijada por digest, con Docker y la cápsula; si ese entorno no permite los límites requeridos el adaptador falla cerrado.

## Configuración por consumidor

| Consumidor | Configuración pública                                                                                          | Credenciales exclusivas                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Manifiesto | Recursos/IDs/regiones/orígenes, SHA, imágenes por digest, aprobación/expiración y límites                      | Ninguna; el esquema rechaza campos adicionales                                        |
| API ACA    | `ENVIRONMENT=preproduction`, `RELEASE_ID`, HOST/PORT, APP_ORIGIN/ALLOWED_ORIGINS exactos, issuer/JWKS/audience | `DATABASE_URL` de `alunza_app` y `DATABASE_SSL_CA` en secretRef; sin Auth Admin       |
| Web Vercel | `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` del destino     | Ninguna credencial privada en build o navegador                                       |
| Job runner | Manifiesto, IDs/región/imagen Sandbox coincidentes                                                             | `VERCEL_TOKEN` sólo para el adaptador; nunca se transfiere a la cápsula               |
| Job IA     | Endpoint/deployments/dimensión desde manifiesto; AI_EMBEDDING_MODEL, AI_GENERATION_MODEL, AI_CONFIGURATION_ID  | Managed identity exclusiva `*-probes`, o AI_AZURE_API_KEY cuando AI_AUTH_MODE=api-key |
| Smoke      | Key pública remota, UUID de organización propia/ajena y correos ficticios ADMIN/TEACHER/STUDENT                | Password común exclusivo del fixture remoto; tokens sólo en memoria                   |
| Bootstrap  | Destino Supabase verificado, migraciones y fixture versionados                                                 | Acceso migrador/Auth Admin separado; nunca entregado a API/web/Job                    |

`runtime.env.example` enumera nombres por consumidor; no se carga todo el archivo en todos los procesos. En ACA, la API tiene únicamente AcrPull. La identidad `*-probes` tiene AcrPull propio y, en modo managed identity, **Cognitive Services OpenAI User** sólo en la cuenta AI existente indicada. El Job entrega credenciales únicamente al proveedor seleccionado. La configuración de IA requiere modelos declarados compatibles con los deployments elegidos; no provisiona modelos automáticamente.

Vercel controla el minor/patch de Node dentro de 24.x. El wrapper verifica major24 estable, obtiene npm11.19.0 exacto y usa `ci --engine-strict=false --ignore-scripts` sólo en esa invocación. Verifica después engines de todas las dependencias y workspaces, exceptuando únicamente el Node exacto del paquete raíz; npm exacto, `.npmrc`, manifests y hash del lock permanecen obligatorios. Typecheck, Jest y build se ejecutan sobre el runtime observado. El informe distingue `local-probe` de `vercel-build-context`; ninguno acredita por sí solo publicación o integración remota.

## Secuencia remota, sólo después de autorización

Los siguientes son comandos operativos **pendientes**, no evidencia de ejecución. Los IDs, región, orígenes, límite de gasto, expiración, cuenta AI, deployments y fixture deben corresponder a elecciones reales. No usar valores ficticios del test. Conservar SHA, digest, revisión ACA y deployment Vercel anteriores antes de cambiar tráfico.

1. Copiar el ejemplo a `.local/preproduction/manifest.json` y completar destinos, SHA, presupuesto, expiración y aprobación. Autorizar únicamente las operaciones que se van a ejecutar. Para bootstrap de ACR/entorno se admite `apiOrigin` e imágenes aún nulos; las cargas y el smoke exigen el digest y destino final.
2. Preparar parámetros públicos. Este paso local conserva `deployWorkloads=false`; no necesita habilitar acceso remoto para renderizar el archivo. Puede salir2 y aun así producir parámetros de bootstrap si faltan operaciones posteriores.

```powershell
node scripts/preprod.mjs plan .local/preproduction/manifest.json
$m = Get-Content .local/preproduction/manifest.json -Raw | ConvertFrom-Json
# Comprobar autorización azure:deploy antes de usar Azure.
node --input-type=module -e "import {loadManifest,assertRemoteAuthorization} from './scripts/preprod-manifest.mjs'; assertRemoteAuthorization(await loadManifest('.local/preproduction/manifest.json'),'azure:deploy');"
az group create --subscription $m.targets.azure.subscriptionId --name $m.targets.azure.resourceGroup --location $m.targets.azure.location --output none
az deployment group create --subscription $m.targets.azure.subscriptionId --resource-group $m.targets.azure.resourceGroup --template-file infra/preproduction/main.bicep --parameters '@.local/preproduction/parameters.public.json' --output none
```

3. Construir/probar API y Job desde el mismo SHA, iniciar sesión únicamente en el ACR elegido y subir esas imágenes. Etiquetas facilitan la carga; **las revisiones usan digest**. Guardar el digest que devuelve el registro en el manifiesto y revisar el candidato antes de activar cargas.

```powershell
$registry = "$($m.targets.azure.registryName).azurecr.io"
docker build --platform linux/amd64 --target api -f infra/Dockerfile -t "$registry/api:$($m.release.sha)" .
docker build --platform linux/amd64 -f infra/preproduction/Job.Dockerfile -t "$registry/probes:$($m.release.sha)" .
az acr login --subscription $m.targets.azure.subscriptionId --name $m.targets.azure.registryName
docker push "$registry/api:$($m.release.sha)"
docker push "$registry/probes:$($m.release.sha)"
az acr repository show --name $m.targets.azure.registryName --image "api:$($m.release.sha)" --query digest --output tsv
az acr repository show --name $m.targets.azure.registryName --image "probes:$($m.release.sha)" --query digest --output tsv
```

4. Preparar Supabase remoto: confirmar proyecto, revisar respaldo recuperable y migraciones pendientes; vincular explícitamente con CLI, revisar `supabase db push --linked --dry-run` y aplicar `supabase db push --linked` sólo al destino aprobado. No usar `db reset`, `local:up`, `test:integration` ni `test:e2e` contra remoto. Crear/sincronizar las seis identidades ACTIVE y dos organizaciones de `fixtures/foundation/identity.json` con credenciales bootstrap separadas, verificando IDs/correos existentes antes de cualquier cambio. El seed local no es un comando remoto y se mantiene limitado a loopback. Asignar una credencial nueva al rol `alunza_app`; usar conexión directa o pooler **session**5432 y CA con verificación de hostname. Las correcciones de esquema avanzan mediante una nueva migración revisada, nunca borrando historial o datos para hacer pasar el smoke. Retirar las credenciales bootstrap del entorno runtime al terminar.

```powershell
# Estas operaciones remotas requieren autorización específica de bootstrap.
function Confirm-SupabaseBootstrap {
  param([switch]$Linked)
  $selectedProject = node --input-type=module -e "import {loadManifest,assertRemoteAuthorization} from './scripts/preprod-manifest.mjs'; const m=await loadManifest('.local/preproduction/manifest.json'); assertRemoteAuthorization(m,'supabase:bootstrap'); console.log(m.targets.supabase.projectRef);"
  if ($LASTEXITCODE -ne 0) { throw 'Bootstrap Supabase no autorizado.' }
  if ($Linked -and ((Get-Content supabase/.temp/project-ref -Raw).Trim() -ne $selectedProject)) {
    throw 'La vinculación CLI no corresponde al proyecto autorizado.'
  }
  return $selectedProject
}
$selectedProject = Confirm-SupabaseBootstrap
npx --no-install supabase link --project-ref $selectedProject
if ($LASTEXITCODE -ne 0) { throw 'No se pudo vincular el proyecto autorizado.' }
$null = Confirm-SupabaseBootstrap -Linked
npx --no-install supabase db push --linked --dry-run
if ($LASTEXITCODE -ne 0) { throw 'La revisión de migraciones falló.' }
$null = Confirm-SupabaseBootstrap -Linked
npx --no-install supabase db push --linked
if ($LASTEXITCODE -ne 0) { throw 'La aplicación de migraciones falló.' }
# El plan también genera estos dos archivos sin red ni credenciales:
node scripts/preprod-bootstrap.mjs
```

Para Auth, cargar privadamente `BOOTSTRAP_AUTH_ADMIN_KEY` y `PREPROD_SMOKE_PASSWORD` (nuevo password exclusivo) y ejecutar el siguiente guion sólo después de revisar el payload. No enumera ni cambia cuentas distintas de los seis UUID del fixture. Usa el endpoint exacto del manifiesto; rechaza ID/email existentes que no coincidan. No registrar valores de entorno ni respuestas Auth.

```powershell
@'
import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {loadManifest, assertRemoteAuthorization} from './scripts/preprod-manifest.mjs';
try {
  const m = await loadManifest('.local/preproduction/manifest.json');
  assertRemoteAuthorization(m, 'supabase:bootstrap');
  const users = JSON.parse(await readFile('.local/preproduction/bootstrap.auth-users.json', 'utf8'));
  const key = process.env.BOOTSTRAP_AUTH_ADMIN_KEY;
  const password = process.env.PREPROD_SMOKE_PASSWORD;
  if (!key || !password || password.length < 12 || users.length !== 6) throw new Error();
  const auth = createClient(m.targets.supabase.authUrl, key, {
    auth: {persistSession:false, autoRefreshToken:false},
    global: {fetch:(url, options) => fetch(url, {...options, redirect:'error', signal:AbortSignal.timeout(10000)})}
  }).auth.admin;
  for (const user of users) {
    assertRemoteAuthorization(m, 'supabase:bootstrap');
    const existing = await auth.getUserById(user.id);
    if (existing.data?.user) {
      if (existing.data.user.email !== user.email) throw new Error();
      const updated = await auth.updateUserById(user.id, {password, email_confirm:true});
      if (updated.error) throw new Error();
    } else {
      if (existing.error?.status !== 404 && existing.error?.code !== 'user_not_found') throw new Error();
      const created = await auth.createUser({...user, password});
      if (created.error || created.data.user?.id !== user.id) throw new Error();
    }
  }
  console.log('Seis identidades ficticias preparadas; aplicar y verificar SQL de fixture.');
} catch { console.error('Bootstrap Auth fallido; revisar privadamente el estado antes de continuar.'); process.exitCode=1; }
'@ | node --input-type=module
```

Aplicar el archivo generado `bootstrap.fixture.sql` en el SQL Editor del **mismo proyecto autorizado** después de Auth y migraciones. La transacción comprueba ID/email de Auth, inserta únicamente los dos registros de organización y seis perfiles/membresías conocidos; `ON CONFLICT DO NOTHING` más comprobaciones posteriores abortan ante estados ajenos/incompatibles, sin sobrescribirlos. En una consola PostgreSQL segura puede usarse `\i .local/preproduction/bootstrap.fixture.sql` y `\password alunza_app`; no interpolar el password en SQL, historial o archivos públicos. Verificar grants/RLS y recuentos del fixture antes del smoke. Quitar `BOOTSTRAP_AUTH_ADMIN_KEY` de la sesión al terminar. El bootstrap real remoto sigue pendiente hasta realizar estos pasos y registrar evidencia. 5. Completar `release.apiImage`/`jobImage` con digests; producir parámetros de cargas mediante `node scripts/preprod.mjs plan .local/preproduction/manifest.json --workloads`. Preparar aparte un archivo de parámetros ARM privado para databaseUrl/databaseSslCa, con acceso restringido. Aplicar la misma plantilla con ambos archivos; no pasar secretos literales en la línea de comandos ni habilitar debug.

```powershell
az deployment group create --subscription $m.targets.azure.subscriptionId --resource-group $m.targets.azure.resourceGroup --template-file infra/preproduction/main.bicep --parameters '@.local/preproduction/parameters.public.json' '@.local/preproduction/parameters.secrets.json' --output none
```

6. Leer el `apiOrigin` generado, actualizar ese origen exacto en manifiesto y en las variables públicas Vercel. Desde la raíz del monorepo, `vercel link` vincula únicamente el equipo/proyecto indicado; conservar Root Directory `apps/web` en ese proyecto. Crear un deployment mediante `vercel deploy` desde la raíz para incluir contratos y wrappers compartidos; la promoción a la URL elegida exige revisión del deployment y sólo se hace con autorización. Configurar el dominio y redirects/Auth Origins en Supabase de forma exacta. Recompilar la web si cambia cualquier NEXT_PUBLIC. Una página200 no sustituye la comprobación de integración.
7. El Job sigue deshabilitado por defecto (`deployJob=false`) y siempre es **Manual**, con paralelismo1/reintentos0. Para habilitarlo, validar `azure:job` y el `probe:*` elegido, suministrar manifiesto JSON privado en jobManifest, jobOperation, configuración exclusiva de ese proveedor y `deployJob=true`; aplicar la plantilla. Iniciar sólo esa ejecución con `az containerapp job start --subscription ... --resource-group ... --name ... --output none`. AI usa `--mode connectivity` (2 requests: embeddings y generación); el ensayo RAG/pgvector local es independiente. Runner deja35s para stop/delete al vencer su deadline; ACA reserva40s de margen, hasta3640s totales. La gracia permite limpieza, no trabajo nuevo.

El Job emite un único JSON público acotado en logs ACA: duración, cantidad de llamadas, tokens/dimensión IA o recursos/tiempos/cleanup del Sandbox. Sólo un Sandbox por ensayo está permitido en este incremento. Omite identificadores de Sandbox, código, texto generado, modelos y respuestas crudas. En IA la región configurada no se presenta como ubicación observada y el costo permanece N/D. Un hijo exit0 con informe ausente, incompleto o cleanup no verificado hace fallar el Job; consultar los logs de la ejecución exacta para conservar esa evidencia junto al SHA/digest.

## Smoke, rollback y retiro

```powershell
npm run preprod:check -- .local/preproduction/manifest.json
# Cargar sólo las variables PREPROD_* de fixture remoto de forma privada.
npm run preprod:smoke -- .local/preproduction/manifest.json
```

El smoke comprueba HTML, live/ready reales, X-Release-Id, ausencia de caché, login y `/me` con ADMIN/TEACHER/STUDENT, organización propia200, ajena/inexistente404, token ausente/inválido401, CORS y Data API sin acceso a `app`. Una cuenta deshabilitada es opcional. Exige al menos29slots (32con disabled), reserva un logout antes de cada login y permite sólo ese cierre durante35s de gracia después del deadline; el presupuesto no habilita nuevas consultas vencidas. No escribe datos de negocio ni hace reset; abre/cierra sesiones de fixture. Lee JSON hasta64KiB y rechaza ecos de credenciales. Su informe declara `browserFlow=pending`: el recorrido real navegador Vercel→API debe probarse después sobre esos destinos; los Cypress locales no lo acreditan.

Para rollback API, restaurar **digest y configuración compatible** anteriores en un manifiesto de release revisado, desplegar esa revisión por la misma plantilla y confirmar readiness antes de aceptar tráfico. `Single` conserva revisiones anteriores (máximo2) pero no equivale a recuperación de base de datos. Para web, `vercel rollback <deployment-anterior>` restaura un deployment de producción según el plan disponible (Hobby sólo admite el inmediatamente anterior); verificar su compatibilidad con API/Auth/config pública. Si cambió el contrato de datos, preferir una migración correctiva compatible y restauración desde respaldo sólo mediante un procedimiento explícito; nunca ejecutar reset remoto como rollback. [Referencia CLI rollback](https://vercel.com/docs/cli/rollback).

`maxCost` es un límite acordado para decidir si continuar, **no un corte automático de facturación**. Hay límites efectivos de llamadas, tokens de salida, duración, réplica máxima1 y reintentos0; el costo observado sigue N/D hasta obtener evidencia del proveedor. ACA minReplicas0 no elimina costos de ACR, logs, datos, modelos ni otros servicios. Configurar alertas propias del recurso/equipo sin modificar controles globales ajenos; las alertas pueden demorarse.

Al vencer la ventana, denegar nuevos ensayos, comprobar stop/delete de cada Sandbox, detener/revocar credenciales de ensayo y retirar sólo recursos dedicados inventariados. Las etiquetas `approvedUntil` **no eliminan recursos**; el TTL del Sandbox es contingencia y no prueba limpieza observada. Verificar remanentes y cargos antes de cerrar. No publicar informes privados, tokens, archivos env o dumps en GitHub/Vercel.

Fuentes oficiales: [versiones Node de Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), [configuración de build](https://vercel.com/docs/builds/configure-a-build), [Jobs ACA](https://learn.microsoft.com/en-us/azure/container-apps/jobs), [probes ACA](https://learn.microsoft.com/en-us/azure/container-apps/health-probes), [pull de ACR con identidad](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull), [conexiones AI sin claves](https://learn.microsoft.com/es-es/azure/developer/ai/keyless-connections), [Supabase conexiones PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres), [TLS Supabase](https://supabase.com/docs/guides/platform/ssl-enforcement), [presupuestos Azure](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets).
