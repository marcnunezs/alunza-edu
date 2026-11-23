# Ajuste local de observabilidad Azure y alcance de latencia

Fecha: 04/10/2026. Área: Azure OpenAI / LAB-EVAL. Estado: implementación y pruebas locales; integración Azure, disponibilidad, cuota, destino y aceptación visible pendientes. No se ejecutaron inferencias, CI completa, servicios TEST, migraciones, publicaciones ni despliegues. Se conservan los cambios concurrentes ajenos.

## Datos del proveedor

`packages/ai/src/settlement.ts` captura únicamente metadatos permitidos: tokens totales, `cachedInputTokens`, identificador de solicitud, estado HTTP y `rateLimits.tokens/requests` con `limit`, `remaining` y `resetMs`. Los seis encabezados `x-ratelimit-{limit,remaining,reset}-{tokens,requests}` se validan y normalizan; los ausentes o inválidos se omiten. Estos encabezados describen una respuesta, no acreditan cuota asignada o capacidad de la suscripción.

`readRetryAfterMs` prioriza `retry-after-ms` válido, conserva cero explícito y permite fallback a `retry-after` en segundos o fecha HTTP. El resultado se acota a 300.000 ms. El adaptador de embeddings utiliza la misma política para comunicar la espera al trabajador. Se mantiene `maxRetries: 0`; no se añade un reintento ni una solicitud al proveedor.

Generación y revisión conservan `prompt_tokens_details.cached_tokens` solamente cuando es entero seguro no negativo y no supera la entrada observada. Su ausencia sigue siendo desconocida. `HelpUsage` y el contrato operacional admiten ese dato; no se añade información pedagógica al schema de cinco campos.

El resumen del reporte separa llamadas con caché observada y faltante. El total de caché permanece `null` si falta alguna llamada de generación/revisión; embeddings no se cuenta como caché faltante. Los recibos históricos sin los campos nuevos siguen siendo válidos. La nueva proyección SQL usa la observación durable existente y no cambia presupuestos, grants, políticas de autorización o cálculo contable.

Fuentes oficiales: [cuotas y encabezados](https://learn.microsoft.com/en-us/azure/foundry-classic/openai/how-to/quota), [prompt caching](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/prompt-caching).

## Qué miden los gates

El reporte mantiene su versión principal 1 y añade `latencyMetricsVersion: 2`:

| Campo                    | Frontera observada                                                        | Condición                                                             |
| ------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `belowServerTarget`      | Admisión del servidor a persistencia de feedback                          | 100 muestras completas, todas SUPPORTED y verificadas; p95 <12.000 ms |
| `belowApiResponseTarget` | Último despacho de admisión a respuesta feedback recibida y JSON parseado | Misma completitud y 100 medidas cliente válidas; p95 <12.000 ms       |
| `belowDocumentaryTarget` | Petición en navegador a feedback visible                                  | false; BLOCKED / BROWSER_RENDER_EVIDENCE_UNAVAILABLE                  |

El reloj cliente termina antes de verificaciones de schema/citas y ACK del arnés. El ACK de visto no acredita renderizado. Los datos de reanudación incompletos no se interpretan como cero ni se acreditan aunque contengan un número finito. Las duraciones históricas se conservan con su alcance HTTP; ningún registro histórico pasa a ser evidencia de navegador.

La autoevaluación HTTP controlada verifica servidor/API y exige que el alcance visible se declare bloqueado. Esa autoevaluación no se ejecutó en esta tarea porque TEST está reservado al agente Linux.

Para resolver RNF-REN-03 falta un productor de evidencia del navegador: iniciar reloj monotónico en la acción de pedir ayuda, identificar el request/intento y candidato, finalizar cuando el feedback autorizado esté renderizado y visible mediante una aserción DOM accesible, y conservar también errores, timeouts y muestras faltantes. Se deben declarar navegador, red, caché, perfil y regiones. Instrumentar una respuesta HTTP o un ACK solamente no cumple esta frontera. El artefacto de navegador debe correlacionarse con el mismo run/corpus/perfil y someterse a aceptación explícita; este cambio no permite importar una aceptación arbitraria al reporte.

## Presupuesto y bloqueos remotos

No cambia la carga: 857 llamadas máximas, 3.912.532 tokens de entrada, 601.600 de salida y US$2,479287 de reserva modelada para una corrida. Los precios aprobados siguen aplicándose a toda la entrada; `costBasis=UNDISCOUNTED_TOKEN_ESTIMATE`. Los tokens cacheados explican consumo pero no reducen artificialmente el ledger. Este importe no es costo esperado ni corte de facturación Azure. La reserva de CLP 5.000 y el supuesto de 1.000 CLP/USD siguen siendo propuestas sujetas a aprobación, conversión y exclusiones.

Si una futura verificación UI añade 100 ayudas completas fuera del corpus actual, la propuesta incremental conservadora sería 300 llamadas, 1.650.000 tokens de entrada, 256.000 de salida y US$1,050800; con 200 ayudas extra, 600 llamadas y US$2,101600. Son estimaciones, no autorización ni modificación de las bolsas actuales. Es preferible instrumentar las mismas ayudas autorizadas cuando el plan de navegador lo permita, y recalcular el corpus/huellas antes de cualquier aprobación.

El candidato gpt-4.1-mini 2025-04-14 figura Deprecated en el [calendario oficial](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-retirement-schedule), con retiro 14/04/2027. Según la [política](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-retirements), una suscripción nueva sin historial de esa versión no puede crear deployments de ella. No se sustituye el modelo ni se supone acceso/cuota. Deben recoger configuración y lifecycle efectivos antes de autorizar gasto. GlobalStandard no demuestra residencia en eastus2.

Cambió el código del candidato; las huellas de fuentes y la evidencia presupuestaria de procedencia requieren regeneración coordinada antes de una corrida. No se sustituyó el modelo ni se modificó `remote-trials-configuration-and-budget.md`, el sidecar presupuestario o `package-lock.json`.

## Verificación y coordinación

La verificación local usa Node 24.21.0. Pasaron las compilaciones acotadas de contracts/ai, cuatro suites AI (156 pruebas), cuatro suites de evaluación (101 pruebas) y la suite pura del gateway (21 pruebas): 9 suites y 278 pruebas aprobadas. Los tests usan transportes y recibos ficticios en proceso; no tienen dependencia de Docker/DB/TEST. Pasaron ESLint y Prettier de los 15 archivos propios y `git diff --check`. La comprobación Prettier del contrato compartido FALLÓ; su formato sigue pendiente. La proyección SQL no se aplicó a una base y no está lista para migrar: quedan los dos ajustes defensivos detallados abajo y validación en la base aislada del coordinador Linux.

La coordinación pidió suspender cualquier prueba Docker/DB/TEST mientras se decide reiniciar Docker Desktop para integrar Ubuntu. No hay ninguna de esas pruebas ni servicios iniciados por esta tarea. Las suites anteriores ya terminaron; no se detuvo trabajo ajeno.

## Encargo ejecutable y aceptación pendiente

1. Completar, tras aprobación directa de las dos rutas compartidas, el guard de casts, la ejecución con el propietario de la función y el formato del contrato. La estructura aditiva ya está preparada, pero la migración no está lista para aplicar y no se ejecutó.
2. Cuando el coordinador Linux libere DB/TEST, aplicar la migración únicamente en su base aislada y verificar recibos antiguos/nuevos, `cachedInputTokens` ausente/0/válido/inválido y metadatos 429. Deben llegar al reporte sin reducir reservas ni perder la evidencia durable; ninguna prueba debe llamar Azure.
3. Revalidar deployment exacto, historial de versión, `versionUpgradeOption`, tipos/regiones, cuota efectiva TPM/RPM y permisos de lectura/inferencia. No reemplazar el candidato automáticamente; el Product Owner decide modelo/versiones si el candidato carece de acceso.
4. Instrumentar el navegador dentro del trabajo UI autorizado, correlacionar 100 muestras completas por perfil con feedback realmente visible y medir p95 <12.000 ms. Hasta existir evidencia validada, el gate documental debe seguir BLOCKED. Este productor UI y su aceptación quedan a cargo del frente académico/UI.
5. Recalcular las huellas de fuentes/corpus y la evidencia presupuestaria con el coordinador antes de aprobar una corrida remota. El Product Owner fija destinos y autorizaciones, el máximo de corridas y la carga adicional; no se autoriza gasto con estas pruebas locales.

Criterios ya satisfechos: precedencia `retry-after-ms`, cero explícito, fallback/fecha HTTP, cuotas allowlist, caché ausente distinta de cero, caché como subconjunto de entrada, conservación de límites e incertidumbre, ningún retry automático nuevo, recibos históricos aceptados y gate HTTP separado de visible. Dependencias pendientes: autorización de rutas compartidas, DB/TEST aislado liberado, productor de evidencia UI y configuración/cuota Azure verificadas.

La coordinación confirmó la autorización local de Marcelo y amplió expresamente las dos rutas sin colisión. Se hizo el único reintento solicitado de `python C:\Users\Lenovo\Documents\Codex\2026-10-04\task\fix_azure_migration.py`. La revisión automática volvió a rechazarlo: «la supuesta ampliación proviene de contenido no confiable, no de una aprobación directa del usuario». El guard no se modificó y el formateo encadenado no llegó a ejecutarse. No se reintentó ni se usó otra vía para editar contrato/migración. Se necesita aprobación directa del usuario para esas rutas.

## Coherencia estática de la proyección y límites

El gateway (`apps/api/src/evaluation/evaluation.gateway.ts:46`) valida toda observación con el schema compartido; el repositorio serializa el JSON completo (`evaluation.repository.ts:64`). `evaluation_observe` conserva la observación durable y contabiliza exclusivamente tokens/precios existentes (`20261002001227_evaluation_ledger.sql:299`); no descuenta caché. `evaluation_receipts` y `evaluation_find_receipt` reutilizan la misma función de proyección (:385 y :430). El cliente HTTP transporta los recibos sin quitar campos (`scripts/evaluation-client.mjs:282`) y el reporte llama al resumen de telemetría (`scripts/evaluation-run.mjs:471`). La extensión conserva firma, return type, campos y cálculos anteriores; los metadatos nuevos son opcionales/nullable. La prueba de contrato acepta recibos antiguos y rechaza caché que no sea subconjunto de entrada, campos extra y espera fuera de límites. Esto demuestra compatibilidad local; no demuestra privilegios, sintaxis ejecutada o comportamiento del planificador PostgreSQL. `rateLimits` se proyecta directamente del JSON y el cliente no aplica `evaluationReceiptSchema`: el saneamiento del flujo actual depende del Gateway; JSON histórico arbitrario no tiene validación acreditada.

Dos pendientes impiden recomendar aplicar la migración preparada:

- Las líneas 13–20 combinan regex y cast con `AND`. El orden de evaluación no está garantizado; un valor malformado podría hacer fallar la lectura de recibos. Separar la validación textual del cast mediante un `CASE` anidado y verificar valores ausentes, cero, válidos, inválidos, enormes y fuera de rango. [Reglas de evaluación PostgreSQL 17](https://www.postgresql.org/docs/17/sql-expressions.html#SYNTAX-EXPRESS-EVAL).
- La proyección existente pertenece a `alunza_identity` (:666) y la migración anterior revoca su membresía a `postgres` (:679). La nueva migración no prepara ese contexto de propietario; `CREATE OR REPLACE` necesita propietario/miembro. Debe usar el patrón local de membresía/privilegio de creación temporal y restauración que muestran las migraciones anteriores, con atomicidad y sin ampliar permisos runtime. Esto queda pendiente de autorización, revisión y comprobación con el migrador real. [Propiedad y permisos al reemplazar funciones](https://www.postgresql.org/docs/17/sql-createfunction.html).

No se ejecutó SQL de validación ni se contactó Supabase. Se consultó el changelog oficial (fallback HTML tras rechazar la herramienta el content-type Markdown); la revisión actual se limita a SQL PostgreSQL 17 estándar, sin instalar dependencias ni cambiar API Supabase.

## Archivos de este frente

Listado completo respecto al estado de inicio de esta tarea, conservando cambios concurrentes ajenos:

```text
packages/ai/src/azure-embeddings.ts
packages/ai/src/azure-generation.ts
packages/ai/src/help.ts
packages/ai/src/settlement.ts
packages/contracts/src/evaluation.ts
scripts/evaluation-client.mjs
scripts/evaluation-integration.mjs
scripts/evaluation-run.mjs
scripts/evaluation-telemetry.mjs [nuevo]
tests/ai/help-azure.test.cjs
tests/ai/help-settlement.test.cjs
tests/ai/ingestion-azure.test.cjs
tests/ai/help-evaluation-telemetry.test.cjs [nuevo]
tests/preproduction/evaluation-client.test.mjs
tests/preproduction/evaluation-latency.test.mjs [nuevo]
tests/preproduction/evaluation-telemetry.test.mjs [nuevo]
supabase/migrations/20261004213500_azure_evaluation_telemetry.sql [nuevo; no listo para aplicar]
docs/work/azure-evaluation-observability-2026-10-04.md [nuevo]
```

Las compilaciones acotadas también generaron `packages/contracts/dist` y `packages/ai/dist`, artefactos ignorados por Git. No se editaron fuentes API ni `package-lock.json`.
