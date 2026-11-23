# Evaluación local de ayuda visible en navegador

Procedimiento verificado el 18/11/2026. Los resultados y el fallo previo
conservado están en el [registro del incremento](../work/IMP-04-feedback-visible-corpus.md).

El perfil usa API, Auth, PostgreSQL, Storage, pgvector, ejecutor Docker y Chrome
reales, con embeddings, generación y revisión TEST explícitos. Mide las mismas
solicitudes del evaluador desde la acción del navegador hasta su ayuda visible.
Conserva los límites del producto. No prepara Azure, despliega ni contrata
servicios.

## Elegir el destino correcto

Este lanzador exige `alunza-edu-laboratorio-test`: Auth/DB en 18421/18422,
API en 4300, web en 3300 y listener operacional en 4401, con orígenes loopback
del contrato. DEV usa otro proyecto y 174xx; se conserva tal como estaba.

El perfil físico `PHYSICAL_HELP_TEST` del Ryzen y el destino `LAB-EVAL` no se
aceptan en este lanzador. El primero usa otro proyecto y ejecutor `local-vm`;
el segundo está reservado al flujo de evaluación Azure. No cambiar etiquetas,
puertos o guardas para hacerlos pasar por TEST.

## Piezas del procedimiento

| Script                                       | Responsabilidad                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `scripts/evaluation-browser-integration.mjs` | Preflight, corrida nueva, consumidores propios, etapas, preservación y resumen.                             |
| `scripts/evaluation-browser-driver.mjs`      | Chrome por CDP; acción de usuario, admisión, respuesta y contenido visible de la misma ayuda.               |
| `scripts/evaluation-browser-evidence.mjs`    | Verificación local del artefacto, SHA, identidad, correlación, visibilidad y tiempos.                       |
| `scripts/evaluation-teacher-review.mjs`      | Fichas legibles y plantilla para revisar el diseño del corpus, sin generar respuestas ni aceptación humana. |
| `scripts/evaluation-readiness.mjs`           | Expediente offline independiente que incorpora la preparación de revisión docente.                          |

Se reutilizan `evaluation-client.mjs`, `evaluation-run.mjs`, el preparador y
la autorización TEST existentes; `evaluation-review-packet.mjs` proporciona
el inventario ficticio del corpus.

## 1. Preparar TEST sin reconstruir la base

Desde la raíz del repositorio, activar el runtime fijado:

```powershell
. ./scripts/use-node.ps1
```

Antes de iniciar servicios, registrar qué contenedores y puertos ya estaban
activos y comprobar que no hay otra integración dueña de `.local/integration.lock`.
Conservar inventarios y hashes de los datos y evidencias anteriores. El
lanzador nuevo no inicia Supabase ni aplica migraciones.

Si TEST estaba detenido y este operador debe iniciarlo, el helper de destino
explícito conserva sus volúmenes existentes:

```powershell
node --input-type=module -e "import { up } from './scripts/local.mjs'; import { testContext } from './scripts/test-environment.mjs'; await up(testContext);"
```

Verificar después el runtime y esquema TEST. Si faltan migraciones, copiar solo
las ausentes al workspace TEST identificado y aplicarlas hacia delante con el
procedimiento local existente, comprobando la conservación de filas previas.
No usar `test:help:evaluation` para preparar esta campaña: su
`withTestEnvironment` reconstruye la base de prueba.

El preflight del nuevo lanzador consulta en solo lectura:

- Todas las versiones de migración presentes en el repositorio.
- Los 12 actores ficticios activos, las tres clases, sus ocho membresías y los
  cuatro conceptos que utiliza el preparador de evaluación.
- La columna `vector`, que puede no tener dimensión fija en el esquema;
  compatibilidad del perfil único, generaciones y dimensiones efectivas de
  los fragmentos con `materials-fixture-3d-v1`, `test-fixture-only`, dimensión 3.
  Un corpus vacío sin perfil fijado es admisible.
- Cero trabajos de ingestión o ayuda y cero ejecuciones o envíos pendientes.
- Cero corridas anteriores en `AUTHORIZED` o `RUNNING`, incluso expiradas:
  registrar una autorización nueva reconcilia esas corridas y podría modificar
  evidencia histórica sin intención.

Si falta un actor o una referencia académica, inspeccionar primero qué registro
falta y preparar una incorporación aditiva acotada. Comprobar identidad,
permisos y preservación antes/después. No reactivar, reemplazar o resembrar
globalmente el fixture para superar el preflight.

## 2. Construir antes de fijar el candidato

El lanzador exige la API compilada y la web ya construida para TEST. No las
reconstruye. Completar cambios y comprobaciones focales antes de estos pasos:

```powershell
node --input-type=module -e "import { buildApi } from './scripts/test-environment.mjs'; await buildApi();"
```

Para construir la web con los orígenes y la configuración pública TEST correctos,
usar el helper de entorno del repositorio; no reutilizar una compilación DEV o
del Ryzen:

```powershell
$buildEvaluationWeb = @'
import { join } from 'node:path';
import { root, readState, run } from './scripts/local.mjs';
import { testContext, publicTestEnvironment } from './scripts/test-environment.mjs';
const state = await readState(testContext);
await run(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'build'], {
  cwd: join(root, 'apps/web'),
  env: publicTestEnvironment(state),
  inherit: true,
});
'@
$buildEvaluationWeb | node --input-type=module
```

Chrome debe estar instalado. El driver busca las ubicaciones locales habituales
y permite una ruta absoluta mediante `ALUNZA_CHROME_PATH`; no instala un
navegador. Usa un perfil privado nuevo dentro del directorio de la corrida,
sin abrir el perfil personal del operador.

Finalizar también cualquier archivo generado por el build antes del inicio.
El fingerprint incluye las fuentes, documentos y archivos nuevos no ignorados
por Git. Desde el inicio hasta terminar la campaña, congelar esos archivos;
una modificación invalida la identidad del candidato. Las notas operativas
durante el ensayo deben permanecer en `.local`.

## 3. Ejecutar una corrida nueva

Comprobar que 3300, 4300 y 4401 están libres para los consumidores propios.
Ejecutar:

```powershell
npm run test:help:browser-evaluation
```

Guardar el `runId` y `directory` impresos. El directorio nuevo vive en
`.local/eval-runs/<runId>`. Opcionalmente, `--directory` admite un hijo directo
nuevo de `.local/eval-runs`; un directorio existente se rechaza. Este comando
no retoma silenciosamente una corrida anterior.

El lanzador toma el lock exclusivo, verifica precondiciones, captura hashes de
archivos históricos y de filas de doce tablas, y sigue estas etapas:

1. Ejecuta el caso unitario operacional `UNKNOWN` necesario para documentar
   la cobertura completa del corpus.
2. Arranca la API TEST y prepara ejercicios, actividades e intentos nuevos por
   las APIs de producto. Conserva claves de idempotencia en el journal antes
   de enviar cada operación.
3. Registra el manifiesto de autorización de la fixture TEST, con precios
   sintéticos y presupuestos existentes; no es una autorización Azure.
4. Ejecuta INGESTION y CALIBRATION, conserva el artefacto TEST y reinicia su
   consumidor con esa calibración.
5. Ejecuta FUNCTIONAL, incluidos los controles de replay y fuentes.
6. Arranca la web construida y Chrome. EVALUATION conserva sus casos adversarios
   y ejecuta los dos perfiles de latencia con el driver de navegador.
7. Reconciliación final de la corrida completada: no deben aumentar solicitudes,
   muestras ni recibos. Cierra sus consumidores y comprueba preservación.

Los perfiles son 25 intentos distintos por perfil, cada uno con explicación y
pistas 1–3: **100 ayudas en serie y 100 con concurrencia cuatro**. Cada
estudiante ocupa un solo carril. Se conservan las cuotas vigentes; la espera
de admisión se registra por separado. Un fallback permanece como evidencia y
detiene la progresión de ese intento.

El navegador es el único que despacha la ayuda medida. La admisión y su
identificador se guardan mientras el navegador sigue observando la respuesta.
El cliente después verifica esa misma solicitud mediante lectura de la API;
no inicia otra ayuda para completar la muestra. El resultado canónico se
correlaciona con el contenido visible y sus hashes.

## 4. Interpretar y conservar los artefactos

| Artefacto de la corrida                                                                     | Lectura correcta                                                                                                |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `plan.json`, `prepared.json`, `authorized-manifest.json`                                    | Identidad y alcance de esta corrida TEST, con sus bindings propios.                                             |
| `prepare-journal.json`, `run-journal.json`                                                  | Intenciones, claves, admisiones, fases, muestras y fallos para reconciliar. No editar para cambiar resultados.  |
| `calibration.json`                                                                          | Calibración de origen TEST; no se promueve a Azure.                                                             |
| `browser-observations/*.json`                                                               | Observaciones correlacionadas y archivos con SHA. Su verificación no sustituye la ejecución real del navegador. |
| `report.json`, `reports/`                                                                   | Reporte actual e historial de esa misma corrida, con tiempos de servidor, API y navegador separados.            |
| `teacher-review.json`                                                                       | Contextos, respuestas y fuentes ficticias de la corrida, con revisión humana pendiente.                         |
| `historical-files-before.json`, `historical-rows-before.json`, `historical-rows-after.json` | Evidencia de conservación de archivos y registros previos.                                                      |
| `browser-campaign-summary.json`                                                             | Estado final, fallo si lo hubo, cobertura, cierre de consumidores y preservación.                               |

Los journals, sesiones y directorios `browser-runtime-*` son privados. Publicar
solo las proyecciones de evidencia previstas, sin copiar configuraciones
privadas ni el perfil de Chrome.

El gate de navegador requiere 100 observaciones verificadas por perfil, 25
bindings con sus cuatro niveles, identidades únicas también entre perfiles,
correspondencia con la respuesta canónica y p95 estrictamente menor que
12.000 ms. Conserva el plazo operativo de ayuda de 15 s. Los ACK, las
respuestas HTTP rápidas o la persistencia del servidor por sí solos no prueban
que el usuario vio la ayuda. Los reportes HTTP históricos permanecen bloqueados
para ese objetivo.

Una ejecución aprobada de este perfil acredita únicamente el recorrido local
TEST observado. No acredita latencia Azure o remota, gasto real, calidad
pedagógica general ni aceptación académica. La VM física `.13` tiene su
evidencia independiente; este ensayo usa el ejecutor Docker local.

## 5. Preparar la revisión docente

El expediente offline se genera en otro directorio exclusivo:

```powershell
npm run help:eval:prepare-local
```

Incluye `teacher-corpus.md`, con 47 fichas —43 adversarias y cuatro de
calibración—, `teacher-design-review.json`, `review-packet.json` y sus hashes.
Revisar el diseño y las etiquetas en una copia conservando el original. Esas
fichas no contienen respuestas Azure observadas ni opiniones de un docente.

Para revisar respuestas efectivamente obtenidas, usar el `teacher-review.json`
de la corrida correspondiente. Mantener revisor, fecha y valoraciones vacíos
hasta que haya revisión real. Las cuatro observaciones mínimas de calibración
no bastan como aceptación pedagógica general; acordar con el docente la
cobertura representativa antes de cualquier evaluación Azure futura.

## 6. Si se interrumpe o falla

Conservar el directorio, el código de fallo, las muestras parciales y todas
las admisiones. No quitar fallos del journal ni crear otra clave para repetir
una solicitud cuyo resultado sea incierto. Una observación incompleta sigue
siendo incompleta aunque después se lea su respuesta o se reciba un ACK.

El evaluador conserva mecanismos de reconciliación e idempotencia, pero este
lanzador exclusivo no ofrece un comando para continuar una campaña de
navegador fallida en el mismo directorio. Antes de una recuperación, revisar
estado durable, propietario del lock, permisos y consumidores de esa corrida.
El `resume` HTTP por sí solo no recrea una medición de visibilidad que se perdió.
Si corresponde otra campaña, identificarla explícitamente como nueva y
conservar la anterior; no repetirla hasta conseguir un resultado y ocultar
las fallas previas.

## 7. Cerrar lo que inició este operador

Esperar a que termine el proceso del lanzador. Su `finally` cierra Chrome,
Next y API propios, verifica la evidencia histórica y libera su lock. Revisar
el resumen: `cleanupErrors` vacío, consumidores detenidos y
`historicalEvidencePreserved` verdadero. Un fallo requiere conservar su estado
y comprobar pendientes; no presentarlo como cierre limpio.

Mientras la base sigue activa, comprobar en solo lectura cero trabajos propios
pendientes, estado final de la corrida y conservación de datos. Guardar los
reportes y hashes finales. Registrar los IDs y estados de los ocho contenedores
DEV para compararlos después.

Solo si este operador inició TEST para la campaña, detenerlo con el contexto
explícito siguiente. Si TEST ya estaba activo, conservarlo:

```powershell
node --input-type=module -e "import { down, readState } from './scripts/local.mjs'; import { testContext } from './scripts/test-environment.mjs'; await readState(testContext); await down(testContext);"
```

El helper valida el proyecto TEST y ejecuta `stop` sin `--all` ni
`--no-backup`; conserva los volúmenes. No usar `npm run local:down`, que
selecciona DEV por defecto.

Comprobaciones posteriores:

```powershell
docker ps -a --filter name=alunza-edu-laboratorio-test --format '{{.Names}}|{{.State}}'
docker volume inspect supabase_db_alunza-edu-laboratorio-test supabase_storage_alunza-edu-laboratorio-test --format '{{.Name}}|{{.Driver}}'
docker ps --filter 'name=alunza-edu-laboratorio$' --format '{{.ID}}|{{.Names}}|{{.State}}'
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(3300,4300,4401,18420,18421,18422,18423,18424) } | Select-Object LocalAddress,LocalPort,OwningProcess
Test-Path .local/integration.lock
```

Se espera ningún TEST activo ni listener propio, ambos volúmenes TEST presentes,
los mismos contenedores DEV activos y el lock ausente. Comparar también los
hashes guardados de evidencia. Un lock restante no se borra automáticamente:
primero se comprueba su propietario y se conserva el diagnóstico.
