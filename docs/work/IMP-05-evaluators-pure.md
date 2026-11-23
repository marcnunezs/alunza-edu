# IMP-05.04 — cierre del alcance puro de los tres evaluadores

Fecha: 13/10/2026. Repositorio observado: `C:\Users\Lenovo\Desktop\alunza-edu\alunza-edu-laboratorio`. Resultado: **IMP-05.04 completo y comprobado exclusivamente como cálculo puro local**. Este cierre no acredita RF-018 operacional, .03 integral/CI17, relojes, persistencia .05, revisión IMP-06 ni aceptación académica humana.

**Actualización 25/10/2026, hora de Santiago:** los tres evaluadores conservan
sus bytes y fórmulas en el candidato integrado .03/.04/.05, cuya CI local
completa aprobó 17/17 controles. Persistencia y recuperación .05 quedan
cerradas localmente según el [registro final](2026-10-25-submit-admission.md).
Los pendientes descritos en este corte puro son históricos; tablero, revisión
docente pública, RF-018 integral y aceptación académica siguen abiertos.

Para Marcelo: Alunza ya puede calcular, sobre datos confiables suministrados, si hubo siete días completos de silencio observable, si los últimos envíos repiten un diagnóstico técnico o si sus resultados completos dejaron de mejorar. Las tres condiciones conservan su causa y evidencia. Un mismo conjunto de envíos puede cumplir repetición y estancamiento; un parcial fiable puede permitir repetición y dejar estancamiento sin verificar. El cálculo no crea todavía una alerta guardada ni concluye que el alumno carezca de dominio conceptual. La siguiente fase necesita captura y almacenamiento reales, episodios y revisión humana.

## Autoridad y fuentes

La delegación inicial fue de planificación sin implementación. Los cortes posteriores y este cierre tienen autorizaciones específicas; no se interpreta aquel encargo como permiso de construir. Para este último corte, en el hilo `01a0f393-a43f-732f-a160-dfcc6a2750c3`, el mensaje del asistente `Sentinel_4add1198c0ec8191bcedc63e56deab8c` pidió añadir metadatos a inactividad, pruebas conjuntas y actualizar trazabilidad; el usuario respondió **«Si»** en `Sentinel_00d5095d6f64819194be36f689d5a5fd`. Esa autorización también abarca repetir las comprobaciones, conservando operación/persistencia para .05.

Autoridad semántica: [DEC-005 registrada](DEC-005-2026-10-05.md), [artefacto aprobado íntegro](DEC-005-artefacto-aprobado.txt) y [spec 14](../../specs/14-progreso-y-senales.md). SHA-256 del artefacto: `4bb5265db416be221ca90d9d8d0498d8edc33ea3a7d6bc0db91cf684494ce24d`. Se preservan decisión, fórmulas, SIG y criterios originales. [Plan IMP-05](../plan/05-progreso-y-senales.md), [guía del área](../agent/08-progreso-y-senales.md) y [control de trazabilidad](../plan/09-control-y-trazabilidad.md) delimitan .04/.05.

El plan de planificación del 13/10 queda histórico en `C:\Users\Lenovo\Documents\Codex\2026-10-12\task\IMP-05.04-plan-Alunza-2026-10-13.md`; sus pruebas propuestas no se convierten retroactivamente en ejecutadas. Este registro aporta la evidencia posterior. Los cortes de [inactividad](IMP-05-inactivity.md), [estancamiento](IMP-05-stagnation.md) y [error repetido](IMP-05-repeated-error.md), con sus PASS/FAIL, permanecen intactos. .03 se consulta en [reglas](IMP-05-rules.md) y [diccionario](IMP-05-signal-rules-dictionary.md): implementada con validación integral pendiente.

## Cambio mínimo y contrato interno

Las funciones reales son `evaluateInactivity`, `evaluateRepeatedError` y `evaluateStagnation`, en `apps/api/src/signals`. Reciben hechos explícitos, T, regla versionada y snapshot; son llamadas directamente por la suite conjunta. No se añadió dispatcher, provider, registro en AppModule, DTO público, HTTP, SQL, UI o dependencia nueva. El nombre `integration.spec.ts` expresa integración entre funciones puras; no una corrida DB/HTTP.

| Archivo existente actualizado en este corte    | Cambio                                                                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/signals/inactivity.ts`           | Solo dos propiedades de salida: `schemaVersion` y copia de `parameters` para INACTIVITY. Ausencia de regla conserva null. Predicado y selección sin cambios. |
| `docs/agent/08-progreso-y-senales.md`          | Estado actual y selección por carril; elimina agrupación previa por versión/suite/perfil. Ordenar, seleccionar últimos N y comprobar comparabilidad después. |
| `docs/plan/05-progreso-y-senales.md`           | Corte .04 puro y enlace a este registro, conservando pendientes integrales y criterios operacionales.                                                        |
| `docs/plan/09-control-y-trazabilidad.md`       | RF-018 distingue núcleo puro comprobado de adquisición, persistencia y consulta pendientes.                                                                  |
| `specs/00-fuentes-y-decisiones.md`             | Estado/puntero vigente de DEC-005 y precisión de pendiente histórico al 05/10.                                                                               |
| `specs/02-requisitos-funcionales.md`           | Zona/fronteras/firma/carril resueltos; concreciones operacionales siguen .05.                                                                                |
| `specs/03-flujos-y-criterios-de-aceptacion.md` | Referencia a semántica aprobada; conserva escenarios y exigencia de consulta autorizada/persistencia reales.                                                 |
| `specs/14-progreso-y-senales.md`               | Solo encabezado/puntero de implementación; fórmulas, SIG y contratos no cambian.                                                                             |

Nuevos archivos: `apps/api/src/signals/signal-evaluation.integration.spec.ts` (13 casos) y este registro. Los otros dos evaluadores, los tres specs unitarios anteriores, fixtures/oráculo raíz, contratos .03, configuración y lockfile no cambian en este corte. La compilación genera solo `dist` ignorado, sin ejecutar API.

Semántica conservada:

- Inactividad: al menos `7×24 h` continuas observables, UTC con microsegundos. Base máxima inscripción/publicación/apertura; cobertura de ACTIVITY_OPEN/RUN/ATTEMPT/HELP y lectura exhaustiva hasta T. Hueco reinicia tramo; desconocido no prueba ausencia.
- Intentos: mismo carril organización/clase/alumno/actividad/asignación, SUBMIT confirmado hasta T; orden exacto por `submittedAt` y secuencia `ATTEMPT_SUBMITTED` en BigInt. Elegir últimos N antes de comparar versiones/suites/perfiles, conservando UNKNOWN, parciales e incompatibles. RUN no es intento.
- Repetición: firma `DEC005_V1_DIAGNOSIS` con diagnóstico grueso idéntico; ventana inclusiva `[T−14×24 h,T]` en la línea base N=3. Diagnóstico fiable parcial puede cumplir; SUCCESS/UNKNOWN canónico ocupa e interrumpe. No usar `t3−t1` como ventana.
- Estancamiento: últimos N completos comparables, visibleTotal positivo, IDs y contadores coherentes; para N=3, `p2≤p1` y `p3≤p2`, sin ventana temporal adicional. Último allRequiredPassed suprime; éxito anterior conserva su testimonio y no suprime una terna posterior.
- Actividad habilitada/inscripción vigente, comienzo inclusivo y cierre exclusivo; cerrada no produce nueva condición actual. Reglas schema1/DEC005_V1, parámetros int4 y N2/N4 soportados, vigencias `[A,B)` por organización/tipo. Activación inmediata/CAS de .03 no se altera.
- Salida: outcome/motivo, ámbito/T, regla/algoritmo/schema/parámetros, revisión/digest y evidencia reducida pertinente (ancla/referencias, IDs/perfil/conteos o ventana/firma/causa). NOT_VERIFIABLE es resultado de cálculo, no estado durable. No código, consola, detalle oculto, score o inferencia conceptual. Copias independientes y determinismo sobre la misma base; nueva revisión tardía puede cambiar cálculo para el mismo T.

## Comprobaciones ejecutadas sobre este candidato

Runtime explícito existente: `.tools\node-v24.21.0-win-x64\node.exe`; versión observada `v24.21.0`; SHA-256 `ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32`. Sin instalación, PATH ni `use-node.ps1`.

| Control                                      | Resultado observado                                                                                                                  | Log en workspace externo             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| Jest API: tres specs y suite conjunta        | **PASS 240/240**, 4 suites, exit0: 61 INACTIVITY + 67 STAGNATION + 99 REPEATED_ERROR + 13 conjuntos                                  | `pure-final-unit-r1.log`             |
| Oráculos raíz pertinentes                    | **PASS 20/20**, exit0; 26 casos excluidos por filtro explícito, 46 totales                                                           | `pure-final-oracle-r1.log`           |
| TypeScript API `--noEmit`                    | **PASS**, exit0                                                                                                                      | `pure-final-types-r1.log`            |
| ESLint: siete archivos signals y oráculo CJS | **PASS**, exit0                                                                                                                      | `pure-final-lint-r1.log`             |
| TypeScript compilación API                   | **PASS**, exit0; sin iniciar API                                                                                                     | `pure-final-api-build-r1.log`        |
| Prettier del candidato aplicable             | Resultado y hash en manifiesto final; configuración existente excluye `specs`, `docs/agent` y `docs/plan`, revisados por diff mínimo | `pure-final-format-final.log`        |
| Preservación, HEAD y staging                 | Resultado y hashes del candidato, fuentes y logs en manifiesto final                                                                 | `pure-final-preservation-final.json` |

No hubo FAIL en las cinco primeras comprobaciones de este corte. Se conservan todos los FAIL históricos: tipos iniciales de inactividad, comparación entre realms del corte de estancamiento y lint R1 del oráculo de repetición, además de las evidencias previas .03. No se sobrescribieron ni se presenta un PASS posterior como ejecución original.

Comandos reproducibles desde la raíz; `node.exe` en este bloque abrevia únicamente el ejecutable portátil indicado:

```text
node.exe --experimental-vm-modules node_modules/jest/bin/jest.js --config apps/api/jest.config.cjs --runInBand --runTestsByPath apps/api/src/signals/inactivity.spec.ts apps/api/src/signals/stagnation.spec.ts apps/api/src/signals/repeated-error.spec.ts apps/api/src/signals/signal-evaluation.integration.spec.ts --cacheDirectory <workspace>/jest-pure-final-cache
node.exe --experimental-vm-modules node_modules/jest/bin/jest.js --config tests/jest.contracts.cjs --runInBand --runTestsByPath tests/progress-fixtures.test.cjs --testNamePattern "preserves SIG-01 through SIG-14|inactivity duration and availability oracle|comparable visible-count oracle|SIG-07 SUCCESS fixture is canonical|consecutive diagnosis and inclusive T-window oracle|repetition lower T-window bound|aged compact repetition|future and excluded lanes|partial canonical diagnosis" --cacheDirectory <workspace>/jest-pure-final-oracle-cache
node.exe node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json
node.exe node_modules/eslint/bin/eslint.js apps/api/src/signals/inactivity.ts apps/api/src/signals/inactivity.spec.ts apps/api/src/signals/stagnation.ts apps/api/src/signals/stagnation.spec.ts apps/api/src/signals/repeated-error.ts apps/api/src/signals/repeated-error.spec.ts apps/api/src/signals/signal-evaluation.integration.spec.ts tests/progress-fixtures.test.cjs
node.exe node_modules/typescript/bin/tsc -p apps/api/tsconfig.build.json
```

El comando exacto de formato y los hashes de logs vacíos para checks silenciosos también quedan en el manifiesto. Hechos, coberturas y snapshots de estas pruebas son **sintéticos**. Se ejecutó el cálculo que los consume; no se acredita captura continua real, procedencia servidor, RLS, SQL acumulado, worker o conducta/aprendizaje estudiantil. Las lecturas estáticas independientes de agentes GPT-6.1 sol ultra no equivalen a ejecución ni aceptación humana.

## Matriz E01–E24: evidencia y dueño restante

Rutas abreviadas: **I**=`apps/api/src/signals/inactivity.spec.ts`; **R**=`apps/api/src/signals/repeated-error.spec.ts`; **S**=`apps/api/src/signals/stagnation.spec.ts`; **J**=`apps/api/src/signals/signal-evaluation.integration.spec.ts`; **F**=`tests/progress-fixtures.test.cjs`. Las cuatro suites I/R/S/J se ejecutaron completas; F solo con el filtro arriba. Un equivalente puro no acredita el escenario durable completo de DEC-005.

| Caso | Prueba real o equivalente puro ejecutado                                                                                                                                               | Garantía restante                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| E01  | I: `frontera de siete días en %s`, −1/exacto/+1 µs                                                                                                                                     | Captura observable real .05.                                                                          |
| E02  | I: `usa la base más reciente: %s`; `apertura inclusiva y comienzo futuro`                                                                                                              | Productores/autorización reales.                                                                      |
| E03  | I: `no inventa cobertura anterior al capturador más reciente`; `reinicia el tramo después de un hueco y conserva su motivo`; `cobertura desconocida no significa ausencia`             | Capturadores/cobertura operacional .05.                                                               |
| E04  | I: `%s/%s elegible reinicia el silencio` y variante no elegible; R/S excluyen RUN del carril                                                                                           | Captura/lectura de ayuda y progreso integrado.                                                        |
| E05  | I: `cierre exclusivo programado o efectivo: %s`; R/S cierres exclusivos                                                                                                                | Preservación de episodios anteriores .05.                                                             |
| E06  | R: `extremo inferior inclusivo a un microsegundo: %s`; F: `repetition lower T-window bound at %s`                                                                                      | Ningún pendiente adicional de predicado puro.                                                         |
| E07  | R: `tripleta compacta antigua no cumple aunque su span sea inferior a 14 días`; `avanzar T un microsegundo vence la ventana con los mismos IDs`; oráculo F de terna vieja              | Reevaluación/cadencia operacional .05.                                                                |
| E08  | R: `%s canónico confirmado ocupa posición e interrumpe`; S: `último %s ocupa posición y no se salta para rescatar terna anterior`; J UNKNOWN conjunto                                  | Adquisición exhaustiva del carril .05.                                                                |
| E09  | S: `comparaciones adyacentes %j`, iguales/descendentes/mejora                                                                                                                          | Ningún pendiente adicional de predicado puro.                                                         |
| E10  | S: últimos parciales/incompatibles seleccionados antes de comparar; J: tres parciales fiables SYNTAX/RUNTIME/TIMEOUT, REP MATCH y STAG NOT_VERIFIABLE                                  | Recuperación durable tras nueva evidencia .05.                                                        |
| E11  | S: `último allRequiredPassed canónico suprime aunque visibles sean constantes`; `visibles 3,3,3 sin cumplir requeridos pueden estancarse, sin revelar ocultas`                         | Canonicidad/procedencia de productor real.                                                            |
| E12  | R/S: replay idéntico determinista sin mutación ni posición duplicada                                                                                                                   | Anexión/testigo/episodio y productores idempotentes reales .05/IMP-03.                                |
| E13  | R: `ordena microsegundos antes de la secuencia y esta antes del UUID/array`; S: `desempata por secuencia bigint, no UUID/HTTP/orden del array`                                         | No se instrumentó HTTP fuera de orden.                                                                |
| E14  | R/S orden/corte exacto por confirmación; equivalente parcial puro                                                                                                                      | No se prueba inversión real de admisión A1/A2 frente a confirmación; productores IMP-03/snapshot .05. |
| E15  | Determinismo/replay puro R/S                                                                                                                                                           | Worker atrasado, calculatedAt, checkpoint/recovery .05; fixture SIG-13 no prueba operación.           |
| E16  | Contrato documentado de episodios y fixture SIG-13                                                                                                                                     | Sin ejecución durable ACTIVE/REVIEWED/anexión; .05/IMP-06.                                            |
| E17  | J: `E17: prefijo A%s conserva la mejora intermedia y el diagnóstico repetido`: A1/A2 insuficientes; A3 MATCH; A4/A5 NO_MATCH; A6 MATCH para estancamiento                              | Preservar corte intermedio y episodios durante recovery .05. REP cumple desde A3 bajo la misma firma. |
| E18  | R/S carriles distintos e incompatibilidad en últimos N, sin rescatar versión previa                                                                                                    | Publicación v2 e historia v1 con persistencia real.                                                   |
| E19  | I/R/S regla explícita `[A,B)`, retirada histórica, DRAFT y organización ajena                                                                                                          | .03 activación real integral pendiente; episodios R1/R2 .05.                                          |
| E20  | Sin test que materialice captura histórica/backfill E20                                                                                                                                | Backfill verificable/corrección auditada fuera del MVP; no se acredita procedencia por schema puro.   |
| E21  | I/R/S: nuevo snapshot/commit tardío cambia revisión y cálculo para mismo T, conserva salida previa                                                                                     | Locks/revalidación/reconciliación append-only .05. MAX(sequence) no basta.                            |
| E22  | J: `E22: el éxito antiguo permanece y la tripleta posterior cumple ambas causas`; mismo T/snapshot/IDs, causas separadas, éxito previo canónico intacto; I no silencio con evento en T | No ejecuta progreso SQL acumulado ni creación de episodios.                                           |
| E23  | I: `deduplica replay idéntico; referencias empatadas son estables`; `el mismo UUID en dos fuentes conserva ambas referencias`                                                          | Reconciliación y no reactivación de REVIEWED .05.                                                     |
| E24  | Sin test que materialice base revisada más commit tardío E24                                                                                                                           | Ledger/base REVIEWED, evidencia nueva y revisión .05/IMP-06. SIG-14 es declarativo.                   |

Apoyos reales leídos, **no ejecutados en este corte**: `tests/integration/zzzzz-submissions.test.cjs` (`Idempotencia y dos envíos intencionales concurrentes conservan identidades separadas`; `DEC002 guarda admitido antes del cierre; historia y replay siguen autorizados`), `tests/integration/zzzzzzzz-progress.test.cjs` (`RF015-E1: 2/3 por asignaciones y conceptos, replay no duplica y fallo conserva logro`; `corte exacto y offset equivalente conservan solo confirmaciones anteriores`) y `tests/integration/zzzzzzzzz-rule-versions.test.cjs` (`RF026-E1/E2: activación inmediata preserva vigencias, parámetros y snapshots de replay`). No se hereda su PASS, ni se afirma que materialicen por completo E14/E18 o persistencia de señales.

## SIG y aceptación binaria del alcance puro

| Fixtures  | Test directo ejecutado                                                    | Oráculo independiente ejecutado F                         |
| --------- | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| SIG-01–04 | I: `$id conserva esperado sobre fixture sintético con cobertura`          | `$id inactivity duration and availability oracle`         |
| SIG-05–08 | R: `$id conserva expected con proyección canónica sintética`              | `$id consecutive diagnosis and inclusive T-window oracle` |
| SIG-09–12 | S: `$id mantiene expected con resultados y metadata canónicos sintéticos` | `$id comparable visible-count oracle`                     |

SIG-07 agrega F `SIG-07 SUCCESS fixture is canonical, retaining interruption expected` y S `SIG-07 normaliza SUCCESS central sin cambiar el expected de interrupción`. SIG-02 directo adapta UUID sintético y comprueba predicado/base; referencias se cubren también en I. SIG-04 no prueba conservación durable. SIG-13/14 permanecen contratos/expected declarativos; sus tests de episodios/revisión no pertenecen al filtro ejecutado. IDs y expected de los fixtures se preservan por bytes en este corte.

Los AC del plan se cumplen **con el límite puro allí indicado**; no convierten D01–D08 operacionales en PASS:

| AC   | Criterio binario y evidencia de este candidato                                                                                    |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- |
| AC01 | Tres funciones puras schema1/DEC005_V1, sin DB/red/IA/estados; lectura de dependencias y cuatro suites PASS.                      |
| AC02 | UTC6/µs, secuencias BigInt e int4 sin coerción; fronteras/orden/límites en I/R/S PASS.                                            |
| AC03 | Cobertura completa, ancla/base/hueco/desconocido de inactividad; I PASS, precondiciones operacionales sintéticas.                 |
| AC04 | Disponibilidad e inicio/cierre exactos de los tres tipos; I/R/S PASS; historial durable .05.                                      |
| AC05 | Selección antes de comparabilidad, sin saltar UNKNOWN/parcial/incompatible; IDs y motivos I/R/S/J PASS.                           |
| AC06 | Repetición canónica, parcial fiable e interrupciones, ventana relativa a T inclusiva; R/F/J PASS.                                 |
| AC07 | Conteos completos no crecientes sin plazo adicional, último logro y coexistencia; S/J PASS.                                       |
| AC08 | N2/N4 y extremos de parámetros tienen oráculos propios, no reemplazo silencioso por N3; R/S/I PASS.                               |
| AC09 | Misma base produce mismo cálculo sin mutación; revisión tardía distinguible; I/R/S/J PASS.                                        |
| AC10 | Metadatos/evidencia segura y copias de parámetros en los tres; nuevas aserciones comunes J y pruebas de proyección I/R/S PASS.    |
| AC11 | Carriles y regla/scope cruzados aislados por contrato; I/R/S PASS. No acredita JWT/RLS/ADMIN o capturadores reales.               |
| AC12 | Artefacto, SIG/expected y testimonios previos preservados; estados/episodios asignados a .05/IMP-06, comprobación por manifiesto. |
| AC13 | 240 pruebas + 20 oráculos, tipos/lint/build y controles finales del candidato; logs/hashes propios, sin heredar cierre .03.       |

## Preservación, límites y siguiente trabajo

Baseline antes del corte: 610 archivos fuente visibles de Git, HEAD `75708ceecf2ca755bd32fb4b04e77bcb8de310f4`, staging vacío y 47 archivos tracked ya modificados. El manifiesto `C:\Users\Lenovo\Documents\Codex\2026-10-12\task\pure-final-preservation-final.json` contrasta esos bytes: solo los ocho archivos existentes enumerados y dos nuevos están permitidos; preserva cambios previos y approved artifact. Comprueba por reconstrucción que quitar las dos propiedades nuevas devuelve exactamente el texto original de inactividad, sin modificar su cálculo. Hashes de fuentes/logs/runtime identifican el candidato y los resultados. No se requiere que la cantidad de cambios tracked siga siendo 47 si una actualización documental autorizada añade un archivo a ese conjunto.

Revisión documental independiente: sin bloqueantes; fórmulas, escenarios HU y SIG conservados. Correcciones de trazabilidad resuelven divergencias reales: AC10 incompleto de inactividad, falta de cronologías conjuntas y guía que agrupaba por versión antes de seleccionar. Los pendientes semánticos antiguos de zona/firma/fronteras ya estaban resueltos por DEC-005; se sustituyen por pendientes operacionales, sin reabrir la aprobación ni debilitar aceptación.

Sin bloqueo semántico nuevo para .04 puro. Riesgos/decisiones de .05: captura autorizada exhaustiva y perfil servidor, protocolo cobertura/snapshot/revisión compatible con commits ordinarios tardíos, revalidación antes de persistir, cadencia/recovery por cada prefijo y checkpoints, deduplicación/episodios/testigo inmutable, conservación de REVIEWED sin resolver/reabrir automáticamente y ledger de revisión. Estados contractuales únicos ACTIVE/REVIEWED; .04 no implementa ninguno. Conviene especificar adquisición y revalidación primero, luego persistencia/episodios/checkpoints, después consulta y recorrido integrado aislado por organización. Es orden propuesto, no autorización de ejecutar esa fase.

**No ejecutado ni iniciado en este corte:** C1, CI17/validación integral .03, Docker/DB/Supabase/WSL, HTTP/RLS, workers, cargas/rendimiento, diagnóstico o intervención de reloj, instalaciones, servicios productivos/cloud, aceptación académica humana. No commits, staging, push, GitHub, deploy o gastos. Repositorio final ajeno al laboratorio sin intervención. Los planes y recibos Library anteriores permanecen históricos; este registro no declara una nueva subida Library.

**Siguiente objetivo:** terminar la validación integral pendiente de .03 y obtener autorización delimitada para la concreción operacional de IMP-05.05. Este cierre acredita cálculo puro local y preserva los contratos pendientes para ese trabajo.
