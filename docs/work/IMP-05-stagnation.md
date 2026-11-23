# IMP-05.04 — Corte puro de estancamiento

Fecha: 13/10/2026 UTC. Estado: **IMPLEMENTADO Y VERIFICADO EN FOCOS LOCALES**, con Node 24.21.0. Es un corte parcial de IMP-05.04: no cierra RF-018, error repetido, integración durable .05 ni validación integral .03/CI17.

## Autorización y semántica conservada

Marcelo autorizó continuar con el evaluador de estancamiento y sus pruebas. La traza conservada identifica la pregunta `Sentinel_2e129912eaa88191a8f789e67f35776e` («¿Seguimos con el evaluador de estancamiento y sus pruebas, dentro de IMP-05.04?») y la respuesta `Sentinel_f162c86165b48191b77886c759581138` («Si»), en `source_thread_id=01a0f393-a43f-732f-a160-dfcc6a2750c3`.

La coordinación confirmó finalizar este corte puro y repetir los focos tras corregir el replay idéntico. Se mantienen cobertura/evidencia suministradas explícitamente y adquisición operacional durable fuera del alcance, en .05. No se amplía hacia Supabase/NestJS operacional ni se reabre el plan general.

Se conserva [DEC-005 D1–D5 aprobada](DEC-005-2026-10-05.md) y [spec 14](../../specs/14-progreso-y-senales.md). STAGNATION **no tiene ventana temporal adicional**: la mención inicial de `[T−14 días,T]` fue una traslación errónea de la regla de error repetido y la coordinación la corrigió. No cambió la decisión del usuario ni se editaron sus bytes. SHA-256 del artefacto aprobado: `4bb5265db416be221ca90d9d8d0498d8edc33ea3a7d6bc0db91cf684494ce24d`.

La base es el laboratorio `C:\Users\Lenovo\Desktop\alunza-edu\alunza-edu-laboratorio`, HEAD `75708ceecf2ca755bd32fb4b04e77bcb8de310f4`. El manifiesto externo `stagnation-before-review.json` conserva 604 fuentes previas, staging vacío y cambios anteriores. No se atribuyen esos cambios previos a este corte. El repositorio final no se modifica; no hay commits, push, despliegues o gastos.

## Archivos y comportamiento

- `apps/api/src/signals/stagnation.ts`: función pura `evaluateStagnation`, contrato interno estricto, UTC/microsegundos y secuencias BigInt, sin DB/red/IA ni estado persistido.
- `apps/api/src/signals/stagnation.spec.ts`: pruebas de selección, comparabilidad, resultados completos, disponibilidad, snapshot, precisión, replay y parámetros N.
- `fixtures/progress/signals-proposed.json`: solo SIG-07 y SIG-09–12 normalizados en este corte; IDs/expected preservados. SIG-01–04 y su cobertura sintética anterior se conservan.
- `tests/progress-fixtures.test.cjs`: solo el bloque STAGNATION actualizado y comprobación de canonicidad de SIG-07 añadida; bloque de inactividad y oráculo REPEATED_ERROR preservados.
- Este registro de trabajo, con evidencia externa y límites del corte.

Ámbito del carril: organización/clase/estudiante/actividad/**asignación**. Se filtran SUBMIT confirmados con submittedAt<=T, se deduplica transporte idéntico y se ordena `(submittedAt, ATTEMPT_SUBMITTED.eventSequence)` antes de tomar últimos N. RUN, unconfirmed, futuro u otro carril no ocupa posición. UNKNOWN/parcial/incompatible confirmado sí ocupa posición: no se salta para rescatar tres anteriores. Duplicados contradictorios o secuencia asignada a distintos IDs producen NOT_VERIFIABLE.

Después de seleccionar, se exige misma versión de ejercicio, hash de suite, conjunto único/total visible y perfil de runner/límites/schema compatible. El mapping interno es `DEC005_V1_SUBMISSION_V1`; no afirma que exista un nuevo campo de normalización persistido. Se valida `submitTechnicalResultSchema`, infraestructura OK, diagnóstico conocido y cobertura exacta de IDs visibles. El contador debe coincidir con resultados passed reales y total positivo. Falta/incoherencia no se sustituye por cero.

Con N=3 cumple `p2<=p1 && p3<=p2`, salvo último `allRequiredPassed=true`. N configurable respeta todos los pares adyacentes; límites int4 no provocan Number inseguro ni array gigante. No hay plazo adicional. Un éxito anterior conserva progreso y no suprime la tripleta posterior. Opcionales son elegibles; 3/3 visibles con allRequiredPassed=false puede cumplir sin revelar ocultas. La causa no afirma nota, dominio conceptual o pérdida de aprendizaje.

T se suministra explícitamente, con zona y hasta seis decimales; se normaliza a UTC6 sin perder fracción. No se consulta Date.now. Inicio inclusivo/cierre exclusivo y habilitación se verifican antes del predicado. Regla debe pertenecer a la organización/tipo y aplicar en `[validFrom,validTo)`; retirada puede reproducir su intervalo histórico. Snapshot/revisión/digest debe garantizar selección completa hasta T.

Salida: MATCH/NO_MATCH/NOT_EVALUABLE/NOT_VERIFIABLE con motivo, scope, T, regla/parámetros, revisión/digest, IDs seleccionados y evidencia mínima comparable. Son resultados de cálculo, no estados ACTIVE/REVIEWED. No se incluye signalId, código, consola, detalles ocultos o score. No se registra controller/provider en AppModule ni se toca configuración, migraciones o endpoints.

## Fallo conservado y corrección

Primera ejecución con Node 24.21.0: **1 FAIL y 126 PASS de 127 pruebas**, dos suites. Falló «replay idéntico y orden permutado son deterministas e inmutables»: el duplicado producido con structuredClone tenía iguales datos JSON, pero `isDeepStrictEqual` comparó prototipos de realms distintos conservados por z.unknown y devolvió evidencia incoherente. El reporte `stagnation-unit-r1.log` se conserva; no cuenta como PASS.

Se corrigió la comparación de duplicados con `sameEvidence`: clona ambos hechos a un mismo entorno antes de comparar datos; fallo de clonación se trata como incoherencia. No muta ni transfiere inputs. No se eliminó la aserción fallida y se reforzó `expect(first.outcome).toBe('MATCH')`. Se añadió el caso independiente `[1,2,1,1]`: N=2 MATCH con últimos dos IDs; N=4 NO_MATCH por mejora, con los cuatro IDs.

La revisión estática adicional no encontró bloqueantes y confirmó el alcance puro. Es revisión por agentes, no revisión humana ni aceptación académica. Las ejecuciones siguientes, no esa revisión, sustentan los PASS técnicos.

## Verificación local final

Ejecutable explícito: `.tools\node-v24.21.0-win-x64\node.exe`, versión observada `v24.21.0`, SHA-256 `ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32`. No se descargó/instaló runtime o dependencia, no se cambió PATH ni se ejecutó `scripts/use-node.ps1`.

| Control            | Foco real                                                                         | Resultado                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unitarias R2       | Jest API, stagnation.spec.ts e inactivity.spec.ts, cache externo                  | **PASS 128/128**, dos suites: 67 de estancamiento y 61 de regresión de inactividad. Exit 0.                                                                              |
| Lint R2            | ESLint sobre stagnation.ts, stagnation.spec.ts y progress-fixtures.test.cjs       | **PASS**, exit 0.                                                                                                                                                        |
| Tipos R2           | TypeScript `--noEmit -p apps/api/tsconfig.json`                                   | **PASS**, exit 0.                                                                                                                                                        |
| Compilación API R2 | TypeScript `-p apps/api/tsconfig.build.json`, solo dist ignorado                  | **PASS**, exit 0; `stagnation-static-r2-receipt.json`.                                                                                                                   |
| Oráculos R2        | Jest contracts sobre progress-fixtures.test.cjs, diez checks pertinentes          | **PASS 10/10**, exit 0; treinta fuera del filtro no se ejecutaron.                                                                                                       |
| Formato final      | Prettier check sobre los cinco archivos del corte                                 | Reporte externo final `stagnation-format-final-r2.log`, asociado a los bytes de cierre.                                                                                  |
| Preservación final | Hashes contra las 604 fuentes previas; SIG/expected, HEAD/staging y cortes ajenos | 602 fuentes previas idénticas; dos cambios esperados; cero faltantes. HEAD y staging preservados. El manifiesto externo final agrega hashes de los tres archivos nuevos. |

Comando R2 unitario: `node.exe --experimental-vm-modules node_modules/jest/bin/jest.js --config apps/api/jest.config.cjs --runInBand --runTestsByPath apps/api/src/signals/stagnation.spec.ts apps/api/src/signals/inactivity.spec.ts --cacheDirectory <workspace-externo>/jest-stagnation-cache`. El ejecutable es el explícito anterior; el texto abreviado no cambia el runtime registrado.

El foco de oráculos usa `--config tests/jest.contracts.cjs --runTestsByPath tests/progress-fixtures.test.cjs --testNamePattern 'preserves SIG-01 through SIG-14|inactivity duration and availability oracle|comparable visible-count oracle|SIG-07 SUCCESS fixture is canonical'`. No se ejecuta npm test global, C1/CI17, HTTP/RLS/DB/worker ni carga.

Los casos verifican igualdad/descenso/mejora adyacente, >14 días sin ventana, último éxito, éxito anterior, 3/3 visibles sin cumplimiento requerido, parcial/UNKNOWN/infra FAIL/no resultado/contadores incoherentes, perfiles incompatibles sin rescate, IDs duplicados/distintos, modos/carriles/futuros, T±1µs, empate con secuencia >MAX_SAFE_INTEGER, replay/contradicciones, snapshot incompleto/tardío, disponibilidad, vigencia, N=2/4/int4 y no mutación. Los hechos/certificados son **sintéticos**; su ejecución no demuestra actividad estudiantil real, RLS/captura operacional ni utilidad pedagógica.

## Evidencia y pendientes delimitados

Los reportes originales/finales se conservan en `C:\Users\Lenovo\Documents\Codex\2026-10-12\task`: `stagnation-before-review.json`, `stagnation-preservation-review.json`, `stagnation-unit-r1.log`, `stagnation-oracle-r1.log`, `stagnation-lint-r1.log`, `stagnation-types-r1.log` y sus focos R2; build/formato/preservación finales en la tabla. Lint/tipos/build R2 devolvieron exit 0 sin stdout; Tee-Object no creó logs vacíos. Sus comandos/resultados reales se conservan en `stagnation-static-r2-receipt.json`, sin fabricar salida ni repetir pruebas para crear archivos. `stagnation-preservation-checker-r1.json` conserva el fallo inicial del helper de manifiesto al buscar ese log ausente; se corrigió únicamente el registro externo. El FAIL R1, evidencia anterior de inactividad y fallos históricos .03 no se sobrescriben.

No hay una dependencia semántica nueva que bloquee este núcleo puro. Queda fuera la adquisición autorizada exhaustiva de hechos/perfil, cobertura operacional, snapshot/revalidación compatible con productores, commits tardíos y reconciliación durable .05. La continuidad sintética suministrada no demuestra la continuidad real; MAX(event_sequence) no congela evidencia.

**No implementado por este corte:** REPEATED_ERROR, episodios/deduplicación/checkpoints, ACTIVE/REVIEWED/revisión, resolución automática, APIs/UI, fuente SQL operacional o habilitación RF-018. El oráculo legado de repetición mantiene su defecto conocido `t3−t1<=14d`: el futuro corte debe sustituirlo por `[T−14d,T]`, con ±1µs y tripleta envejecida. No se modificó aquí ni se presenta como aprobado DEC005_V1.

**No ejecutado:** C1/CI17/validación integral, integración HTTP/RLS/DB/worker, Docker/Supabase/WSL, cargas/diagnóstico de relojes, proveedores cloud o aceptación docente/CAPSTONE. .03 conserva su validación integral pendiente; PASS focal de este corte no la cierra.

En lenguaje sencillo: la función mira los últimos envíos de una asignación y comprueba si todos sus resultados completos son comparables y no aumentan las pruebas visibles superadas. Si el último ya cumple todo lo requerido, no marca estancamiento; si faltan datos, dice «no verificable». Calcula una condición técnica con evidencia explícita; todavía no crea una alerta real ni califica al estudiante.
