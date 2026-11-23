# IMP-05.04 — Corte puro de inactividad

Fecha: 13/10/2026 UTC. Estado: **EVALUADOR PURO IMPLEMENTADO Y VERIFICADO EN FOCOS NATIVOS LOCALES**. Es un corte parcial de .04: no cierra .04 completa, RF-018 ni IMP-05.03/CI17. No hay señal persistida, endpoint, captura operacional nueva, episodio ni worker.

## Autorización, dependencias y base preservada

Marcelo autorizó revisar dependencias con .03 y, si permitían avance independiente, implementar únicamente inactividad y pruebas deterministas. Fuente de la instrucción: hilo `01a0f393-a43f-732f-a160-dfcc6a2750c3`, aceptación `Sentinel_19626a5bb3b88191a5bb2989c8c2c1fd`, en respuesta a la propuesta `Sentinel_eae9fc145728819181882391a1d1707f`. No se atribuye una aprobación docente/CAPSTONE a esa autorización.

Se verificaron AGENTS.md, las guías de progreso y pruebas, el plan preparado el 12/10 y [DEC-005 vigente](DEC-005-2026-10-05.md). No existe `.agents/skills` en el checkout; se consultó la skill disponible de NestJS y se respetaron Zod/Jest y las convenciones existentes. No se encontraron memorias locales pertinentes disponibles. Se inspeccionó Git con lectura autorizada: HEAD `75708ceecf2ca755bd32fb4b04e77bcb8de310f4`, staging vacío, 47 archivos tracked modificados y 59 entradas untracked. El baseline externo contiene 601 hashes de archivos de fuente/documentación, sin atribuir sus cambios anteriores a este corte.

La dependencia permite avanzar: el evaluador recibe T explícito, regla versionada, snapshot y cobertura como datos, sin leer el reloj, DB, red o proveedor. El cierre CI17 de .03 sigue pendiente; el trabajo de cargas y relojes está pausado. No se promovieron ni importaron candidatos experimentales de optimización. El repositorio final no se modificó.

La tabla `student_event_coverage` existente solo conserva instalación de ACTIVITY_OPEN/RUN; no acredita continuidad global ni huecos de ATTEMPT/HELP. Eso **bloquea afirmar detección operacional de inactividad**, pero permite implementar/probar el contrato puro. La adquisición autorizada y exhaustiva de hechos, continuidad real, revalidación frente a commits tardíos y reconciliación durable permanecen en .05.

## Archivos y comportamiento

- `apps/api/src/signals/inactivity.ts`: función pura `evaluateInactivity`, contrato interno estricto y aritmética exacta de microsegundos; reutiliza el schema de versión de .03 sin modificar sus fuentes.
- `apps/api/src/signals/inactivity.spec.ts`: casos deterministas, integración de SIG-01–04 sintéticos con el evaluador y pruebas de límites/cobertura/scopes/reproducibilidad.
- `fixtures/progress/signals-proposed.json`: solo SIG-01–04 reciben cobertura sintética explícita; conservan IDs, estado histórico PROPOSED y resultados esperados. No se corrigen las otras señales en este corte.
- `tests/progress-fixtures.test.cjs`: solo el oráculo de inactividad incorpora cobertura continua y microsegundos. Las reglas/fixtures de repetición, estancamiento, episodios y revisión siguen fuera del alcance.
- Este registro documenta autorización, contratos, resultados y pendientes del corte.

T es un parámetro obligatorio con zona y hasta seis decimales; se normaliza UTC sin perder la fracción. Un día son `86_400_000_000` microsegundos. La línea base es siete días, inclusive en igualdad; se respetan los días positivos int4 configurados por .03, con BigInt y sin multiplicaciones Number inseguras.

```text
baselineAt      = max(enrolledAt, publishedAt, opensAt si existe)
coverageSince   = max(inicio continuo de ACTIVITY_OPEN, RUN, ATTEMPT, HELP)
observableSince = max(baselineAt, coverageSince)
lastAt          = max(observableSince, último evento elegible de la actividad <= T)
cumple          = T - lastAt >= inactivityDays × 24 horas
```

El input interno exige un snapshot/revisión/digest con lectura exhaustiva hasta T y cobertura comprobada continua hasta T de las cuatro fuentes. Son garantías distintas: captura operativa no convierte por sí sola un array vacío en prueba de ausencia. Cada fuente conserva referencia; el tramo conserva época y motivo de reinicio. Si una captura se restablece tras un hueco, su nuevo inicio reinicia el tramo observable; no se inventa silencio anterior.

El ámbito es organización/clase/estudiante/actividad. Los eventos ajenos y futuros no entran; replay idéntico fuente/ID se deduplica; duplicados contradictorios impiden verificar. Referencias de fuentes distintas empatadas se conservan ordenadas sin inventar un orden cronológico global. CLASS_JOINED aporta referencia de clase y no reinicia todas las actividades. RUN/SUBMIT con EXECUTION_COMPLETED e infraestructura OK, ATTEMPT_SUBMITTED confirmado incluso UNKNOWN, pista concedida y lectura explícita de feedback/fallback elegible pueden reiniciar silencio. Polling/ayuda fallida no se convierten en hechos elegibles.

Trabajo no habilitado, DRAFT, futuro, actividad CLOSED o cierre programado/efectivo alcanzado produce NOT_EVALUABLE. Inicio es inclusivo y cierre exclusivo. Versión de regla debe pertenecer a la organización y ser aplicable en `[validFrom,validTo)`; una versión retirada puede reproducir un corte histórico dentro de su intervalo. Regla ausente/inaplicable, snapshot incompleto, cobertura desconocida/incompleta o hechos incoherentes produce NOT_VERIFIABLE. Evidencia suficiente antes del umbral produce NO_MATCH; al alcanzar el umbral produce MATCH con causa y referencias. No son nuevos estados de señal.

La salida conserva regla, T, ámbito, snapshot/revisión/digest, baseline, cobertura, lastAt y fuentes de referencia; duraciones BigInt viajan como texto decimal. No incluye signalId, ACTIVE/REVIEWED, score, código, consola ni pruebas ocultas. No hay dependencia de IA ni acceso directo desde el navegador. No se añade provider/controlador a AppModule ni configuración/migración, y no se inicia otra señal.

## Comprobaciones realmente ejecutadas

Entorno: Windows nativo, Node **24.14.0** disponible; el proyecto fija **24.21.0**. No se instaló ni actualizó Node/dependencias. Estos focos no acreditan el runtime fijado, WSL, integración remota ni CI17.

Antes de probar, se compiló `packages/contracts` con el TypeScript local para reconstruir `dist` desde las fuentes actuales: el dist previo no incluía signal-rules. Se generan únicamente artefactos compilados ignorados; no se modifica el contrato .03 ni se importa una reparación externa.

| Control                             | Ejecución real                                                                                                                                 | Resultado                                                                                                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Compilación de contratos existentes | `node node_modules/typescript/bin/tsc -p packages/contracts/tsconfig.json`                                                                     | PASS, exit 0.                                                                                                                                                            |
| Unitarias, R1                       | Jest API, solo `apps/api/src/signals/inactivity.spec.ts`                                                                                       | PASS 59/59, exit 0; anterior a la corrección de tipos y dos casos adicionales.                                                                                           |
| Oráculos pertinentes, R1            | Jest contracts, solo `tests/progress-fixtures.test.cjs`, filtro `preserves SIG-01 through SIG-14\|inactivity duration and availability oracle` | PASS 5 seleccionados, exit 0; 34 tests de otros alcances no ejecutados por selección explícita. Fuente/oráculo y fixture conservan los mismos bytes desde esa ejecución. |
| Lint, R1                            | ESLint sobre inactivity.ts, inactivity.spec.ts y progress-fixtures.test.cjs                                                                    | PASS, exit 0.                                                                                                                                                            |
| Tipos, R1                           | `node node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json`                                                                      | **FAIL**, exit 2: TS2532 en inactivity.ts:8 por posible grupo regex indefinido. Conservado en reporte externo; no es PASS.                                               |
| Corrección del FAIL                 | Se cambió `?.[1].length` a `?.[1]?.length` en el archivo nuevo.                                                                                | No se alteraron umbral, cobertura, expected ni aserciones.                                                                                                               |
| Unitarias, R2                       | Mismo foco Jest API tras corrección y dos casos nuevos                                                                                         | PASS **61/61**, exit 0.                                                                                                                                                  |
| Lint, R2                            | Mismos tres archivos del corte final                                                                                                           | PASS, exit 0.                                                                                                                                                            |
| Tipos API, R2                       | Mismo tsc --noEmit sobre API                                                                                                                   | PASS, exit 0.                                                                                                                                                            |

El comando focal API fue `node --experimental-vm-modules node_modules/jest/bin/jest.js --config apps/api/jest.config.cjs --runInBand --runTestsByPath apps/api/src/signals/inactivity.spec.ts`, con caché de prueba en workspace externo. La prueba de fixtures utilizó `--config tests/jest.contracts.cjs --runTestsByPath tests/progress-fixtures.test.cjs` y el filtro indicado. No se ejecutó un npm test amplio ni scripts de integración.

Los casos cubren umbral −1/exacto/+1µs, inscripción/publicación/apertura, cierre programado/efectivo, actividad no habilitada, regla/organización/vigencias, parámetros 1/7/int4 máximo, offset/fechas inválidas, cobertura tardía/desconocida/faltante/invertida/reiniciada, snapshot insuficiente y exacto hasta T, evento T−1/T/T+1µs, eventos elegibles/no elegibles, scopes ajenos, replay/contradicciones/empates, mismo UUID en dos fuentes y revisión posterior con commit tardío sintético. Se verifica que Date.now no se consulta y que los inputs no se mutan; no es un sondeo del reloj real.

Todas esas cronologías y certificados de cobertura son **sintéticos**. Los tests sí se ejecutaron; no son evidencia de actividad estudiantil real, continuidad operacional, episodios persistidos ni efecto sobre aprendizaje. La revisión técnica estática adicional por agentes no constituye revisión humana ni aceptación académica.

## Evidencia y pendientes

Los reportes originales de este corte se conservan fuera de fuente en `C:\Users\Lenovo\Documents\Codex\2026-10-12\task`: `inactivity-before-2026-10-13.json`, `inactivity-contracts-build.log`, `inactivity-unit-r1.log`, `inactivity-oracle-r1.log`, `inactivity-lint-r1.log`, `inactivity-types-r1.log`, `inactivity-format-r2.log`, `inactivity-unit-r2.log`, `inactivity-lint-r2.log` y `inactivity-types-r2.log`. El cierre añade comparación de preservación/hash y comprobación final de formato. Los FAIL históricos de .03 y experimentos previos no se alteran ni se vuelven a acreditar.

No ejecutado: C1, CI integral/CI17, Docker/Supabase, RLS/HTTP/worker/carga, sondeos o intervención de relojes, WSL, servicios cloud o aceptación docente/CAPSTONE. Sin commits, staging, push, despliegues o gastos. No se modifica el repositorio final.

La implementación de .04 completa conserva pendientes de error repetido/estancamiento; .05 conserva cobertura/snapshot operacionales, persistencia, deduplicación, revalidación, episodios/checkpoints y reconciliación. No hay apertura/reactivación/revisión automática de señales. La revisión humana no implica resolución del problema.

En lenguaje sencillo: esta función comprueba si, desde el último evento elegible o desde que Alunza realmente pudo observar la actividad, transcurrieron siete períodos completos de 24 horas. Si faltan pruebas de que pudo observar, dice «no verificable». Si la actividad ya cerró, no evalúa una señal nueva. Por ahora calcula esa conclusión con datos explícitos; aún no crea una alerta real ni califica al estudiante.

## Verificación complementaria con Node 24.21.0

La verificación inicial bajo Node 24.14.0 se conserva íntegramente como antecedente. Se completó después el foco con el runtime portable nativo **24.21.0 ya existente**, sin instalar, descargar, cambiar PATH global ni iniciar Docker/WSL. Ruta comprobada: `.tools/node-v24.21.0-win-x64/node.exe`; `--version` devolvió `v24.21.0` y `process.execPath` identificó esa ruta. SHA-256 del ejecutable: `ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32`. Se evitó `scripts/use-node.ps1`, que puede preparar/descargar el runtime.

Los cinco archivos finales conservaban los hashes de `inactivity-preservation-final.json` antes de la corrida. Se usó ese ejecutable por ruta explícita para los mismos binarios locales y focos registrados arriba. El código, pruebas, fixture y oráculo no se modificaron; únicamente se añade este resultado al registro después de terminar las comprobaciones.

| Control con Node 24.21.0                  | Resultado observado                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| Compilación local de contratos existentes | PASS, exit 0.                                                             |
| Unitarias de inactivity.spec.ts           | PASS 61/61, exit 0.                                                       |
| Oráculos SIG-01–04 y conservación de IDs  | PASS 5 seleccionados, exit 0; otros 34 casos fuera del alcance explícito. |
| Lint de los tres archivos del corte       | PASS, exit 0.                                                             |
| Tipos API tsc --noEmit                    | PASS, exit 0.                                                             |
| Formato de los cinco archivos finales     | PASS, exit 0.                                                             |

Evidencia adicional externa en el mismo workspace: `inactivity-node2421-contracts-build.log`, `inactivity-node2421-unit.log`, `inactivity-node2421-oracle.log`, `inactivity-node2421-lint.log`, `inactivity-node2421-types.log`, `inactivity-node2421-format.log`, `inactivity-node2421-record-format.log` y `inactivity-node2421-verification.json`. El manifiesto liga ejecutable, candidato y comprobaciones; conserva el registro anterior separado. TS2532 del primer intento permanece en su log original como FAIL corregido, sin convertirlo en PASS retrospectivo.

Esta verificación elimina la salvedad de runtime para **estos focos**. No cierra CI17/.03 ni .04 completa y no acredita cobertura operacional, RLS, persistencia, workers o aceptación académica. No se ejecutó C1, CI integral, cargas ni sondeos/intervenciones de reloj; no hay commits, push, despliegues, gastos ni cambios al repositorio final.
