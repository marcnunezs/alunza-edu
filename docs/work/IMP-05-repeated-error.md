# IMP-05.04 — Corte puro de error repetido

Fecha: 13/10/2026 UTC. Estado: **IMPLEMENTADO Y VERIFICADO EN FOCOS LOCALES** con Node 24.21.0. Avanza los tres evaluadores puros de .04, preservando inactividad y estancamiento. No acredita cierre integral de IMP-05.04, RF-018, .03/CI17 ni integración operacional .05.

## Alcance autorizado y autoridad

Marcelo autorizó continuar con error repetido y sus pruebas dentro de `alunza-edu-laboratorio`. Procedencia: `source_thread_id=01a0f393-a43f-732f-a160-dfcc6a2750c3`; pregunta del asistente `Sentinel_19ec3e4c11e481918966fdacbfa57e2a` («¿Seguimos con error repetido y sus pruebas?»), respuesta `Sentinel_ec633e77f65c8191b09fca2a5bb5f4fe` («si»).

Autoridad semántica: [DEC-005 aprobada](DEC-005-2026-10-05.md), artefacto íntegro SHA-256 `4bb5265db416be221ca90d9d8d0498d8edc33ea3a7d6bc0db91cf684494ce24d`, [spec14](../../specs/14-progreso-y-senales.md) líneas 72–106 y 133–152, y diccionario de reglas .03. Se revisaron AGENTS, guías pertinentes y plan. La guía progreso:77 aún sugiere agrupar por versión antes de seleccionar; prevalece D2/spec14:90. No se cambian la decisión, sus bytes, configuración, migraciones ni reglas .03.

Solo evaluador puro y pruebas deterministas: sin DB/red/IA, endpoint, controller/provider, adquisición operacional de evidencia, persistencia, episodio, worker o revisión. C1, CI17, Docker/Supabase/WSL, cargas y sondeos/intervención de relojes permanecen pausados. Sin commits, staging, push, publicación, despliegues, gastos, cambios al repositorio final ni importación de candidatos experimentales .03.

## Archivos del corte

- `apps/api/src/signals/repeated-error.ts`: función pura `evaluateRepeatedError` y contrato interno estricto, compatible con reglas .03/schema1/DEC005_V1.
- `apps/api/src/signals/repeated-error.spec.ts`: 99 casos deterministas, incluidos SIG-05–08 y fronteras/configuraciones.
- `fixtures/progress/signals-proposed.json`: únicamente inputs SIG-05/06/08 normalizados con SUBMIT/scope/actividad, secuencia textual, hash/perfil y resultado canónico; SIG-07 y todas las demás fixtures se preservan. Todos los IDs, estados históricos y expected se conservan.
- `tests/progress-fixtures.test.cjs`: oráculo de repetición sustituido por ventana inclusiva respecto de T, selección local y canonicidad/comparabilidad; seis checks adicionales de fronteras, envejecimiento, exclusiones y parcial fiable. Los bloques de inactividad, estancamiento, canonicidad SIG-07, episodios/revisión y restantes pruebas se preservan.
- Este registro de trabajo. No cambia manifest/configuración de Jest; el descubrimiento existente incluye el nuevo spec.

Base: laboratorio `C:\Users\Lenovo\Desktop\alunza-edu\alunza-edu-laboratorio`, HEAD `75708ceecf2ca755bd32fb4b04e77bcb8de310f4`. `repeated-error-before-2026-10-13.json` conserva 607 hashes de fuentes previas, 47 cambios tracked ya existentes y staging vacío. La preservación final y hashes se registran externamente; los cambios previos no se atribuyen a este corte.

## Reglas implementadas

1. T explícito, fechas con zona y hasta seis decimales, normalización UTC6 y comparación BigInt de microsegundos. Secuencia ATTEMPT_SUBMITTED como texto decimal bigint, sin Number. Un día son `86_400_000_000` µs. No se consulta Date.now dentro del motor.
2. Actividad PUBLISHED/ámbito/alumno/inscripción habilitados al corte. Inicio inclusivo; primer cierre programado/efectivo exclusivo. Cerrada, futura, DRAFT o deshabilitada devuelve NOT_EVALUABLE; no crea condición actual publicable. Regla explícita de misma organización/tipo y vigente `[validFrom,validTo)`; DRAFT/ausente/inaplicable no se evalúa como default.
3. Snapshot/revisión/digest suministrados con selección exhaustiva hasta T. Lista parcial, cobertura de lectura insuficiente o hechos contradictorios son no verificables. Este contrato no demuestra adquisición/captura real.
4. Carril por organización/clase/estudiante/actividad/**asignación**. Filtrar SUBMIT confirmados hasta T; deduplicar transporte idéntico por ID; ordenar `(submittedAt,eventSequence)` y seleccionar últimos N **antes** de comparar versión/suite/perfil o diagnóstico. RUN, reservas, unconfirmed, futuros y otro carril no ocupan posición. UNKNOWN/parcial/incompatible confirmado sí ocupa; no se rescata una terna anterior.
5. Canonicidad individual según `submitTechnicalResultSchema`, perfil `submission.v1`, runner/total/conjunto visible coherentes y IDs ejecutados únicos dentro del conjunto esperado. Faltantes o contradicciones no se convierten en diagnóstico fiable. No se exige ejecutar toda la suite para repetición.
6. SUCCESS/UNKNOWN confirmado canónico interrumpe con NO_MATCH, incluso UNKNOWN con infraestructura FAILED. No se filtra antes de seleccionar ni se transforma en error del alumno. Con canonicidad individual acreditada, la interrupción se comprueba antes de comparar perfiles **entre envíos**; este orden cruzado es una inferencia técnica reversible de artefacto:100 y spec14:143–144, documentada y probada. No introduce umbral/decisión pedagógica nueva. Datos malformados o metadata individual contradictoria siguen siendo NOT_VERIFIABLE.
7. Para acreditar repetición, misma versión de ejercicio/hash de suite/conjunto-total visible y perfil runner/límites/schema compatible; infraestructura OK y el mismo diagnóstico entre SYNTAX_ERROR, RUNTIME_ERROR, FAILED_TEST y TIMEOUT. Resultado parcial fiable puede cumplir; cobertura completa de resultados pertenece a estancamiento. IDs visibles se comparan como conjunto, no orden de entrega.
8. Ventana exacta `T-windowDays×24h<=t1<=...<=tN<=T`, inclusiva en ambos extremos. Sustituye el oráculo antiguo `tN−t1<=14d`. Una terna vieja compacta deja de cumplir aunque conserve sus IDs. N/configuración de .03 se respeta; N=2/4 tiene oráculos propios. Int4 máximo usa BigInt sin fechas fuera de rango o reserva gigante de memoria.

Firma interna: `{version: DEC005_V1_DIAGNOSIS, diagnosisCode}`. Agrupa por diagnóstico técnico grueso; no identidad de test, mensaje, código, consola, IA o concepto. Fallos diferentes con FAILED_TEST pueden agruparse. Un éxito anterior conserva progreso y no suprime una terna posterior elegible. No se excluyen opcionales por el parámetro required de progreso.

Resultados: MATCH/NO_MATCH/NOT_EVALUABLE/NOT_VERIFIABLE con motivo, IDs seleccionados, scope/T, regla/parámetros/algoritmo/schema, snapshot/revisión/digest y ventana inclusiva en microsegundos serializados como texto. MATCH agrega perfil/evidencia segura, firma y causa legible que explicita la limitación del diagnóstico grueso. No se incluyen código, stdout/stderr, detalles ocultos, score, signalId ni ACTIVE/REVIEWED. No se mutan inputs o historial.

## Pruebas ejecutadas y FAIL conservado

Runtime explícito ya existente: `.tools\node-v24.21.0-win-x64\node.exe`, versión observada `v24.21.0`, SHA-256 `ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32`. Sin descarga/instalación, cambio PATH o `scripts/use-node.ps1`.

| Control                      | Foco real                                                                                                            | Resultado                                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Unitarias R1                 | Jest API, repeated-error.spec.ts + inactivity.spec.ts + stagnation.spec.ts                                           | **PASS 227/227**, tres suites: 99 nuevas, 61 inactividad y 67 estancamiento; exit0.                                                           |
| Oráculos R1                  | Jest contracts, progress-fixtures.test.cjs, filtro pertinente                                                        | **PASS 20/20**, exit0; 26 fuera de alcance omitidas por filtro explícito.                                                                     |
| Tipos R1                     | TypeScript `--noEmit -p apps/api/tsconfig.json`                                                                      | **PASS**, exit0.                                                                                                                              |
| Lint R1                      | ESLint sobre evaluator/spec/CJS pertinente                                                                           | **FAIL**, exit1: ocho no-undef por structuredClone en el nuevo arnés CJS; `repeated-error-lint-r1.log` preservado.                            |
| Corrección                   | Solo copias de fixtures JSON del nuevo oráculo usan helper JSON.parse/JSON.stringify, en vez de global no catalogada | Sin cambio de configuración, reglas, datos expected ni aserciones. El evaluador conserva structuredClone para igualdad de datos entre realms. |
| Oráculos R2                  | Mismo foco, después de corrección del arnés                                                                          | **PASS 20/20**, exit0; 26 omitidas fuera del filtro.                                                                                          |
| Lint R2                      | Mismos tres archivos finales                                                                                         | **PASS**, exit0.                                                                                                                              |
| Compilación API R1           | TypeScript `-p apps/api/tsconfig.build.json`, solo dist ignorado                                                     | **PASS**, exit0.                                                                                                                              |
| Formato y preservación final | Cinco archivos del corte; comparación contra baseline607                                                             | Reportes externos finales `repeated-error-format-final.log` y `repeated-error-preservation-final.json`, asociados a bytes de cierre.          |

Comando focal unitario: `node.exe --experimental-vm-modules node_modules/jest/bin/jest.js --config apps/api/jest.config.cjs --runInBand --runTestsByPath apps/api/src/signals/repeated-error.spec.ts apps/api/src/signals/inactivity.spec.ts apps/api/src/signals/stagnation.spec.ts --cacheDirectory <workspace-externo>/jest-repeated-error-cache`. `node.exe` abrevia el ejecutable explícito anterior.

Los checks de fixtures incluyen preservar SIG-01–14, oráculos de inactividad/estancamiento, SIG-07 canónico, SIG-05–08 con ventana T, borde inferior −1/exacto/+1µs, terna vieja/avance de T, futuro/carriles/RUN/unconfirmed y parcial fiable/incompatible sin rescate. Oráculos independientes no invocan el evaluador productivo para fabricar expected. La disponibilidad/snapshot exhaustivo de ese foco son precondiciones sintéticas; se verifican explícitamente en la suite API.

Las 99 pruebas nuevas cubren los cuatro diagnósticos/partials, SUCCESS/UNKNOWN incluyendo infra FAILED, interrupción ante incompatibilidad entre suites y rechazo de metadata individual incoherente, selección sin saltos, perfiles/versiones, firma gruesa/privacidad, ventana relativa a T y µs, N2/4/int4, orden BigInt, replay contradictorio/idéntico y no mutación, reglas/intervalos, disponibilidad, snapshot tardío y fixtures canónicas.

Unitarias/tipos se ejecutaron sobre los mismos bytes finales del evaluador/spec/fixtures; la corrección posterior afectó solo el helper del arnés CJS, cuyo foco/lint se repitió. No se presenta una corrida anterior como ejecución nueva. Las cronologías y garantías de cobertura/snapshot son **sintéticas**: no prueban actividad estudiantil real, continuidad operacional, RLS, persistencia o efecto sobre aprendizaje.

Revisión estática independiente realizada por agentes GPT-6.1 sol ultra: sin bloqueantes en el evaluador final. No equivale a revisión humana ni aceptación docente/CAPSTONE. La ejecución ROOT, no esa lectura estática, sustenta los PASS.

## Evidencia y límites

Evidencia externa en `C:\Users\Lenovo\Documents\Codex\2026-10-12\task`: baseline607; copias `repeated-error-original`; logs unit/oracle/lint/types/build/format; manifiesto final con hashes del candidato, runtime, controles y preservación. Lint R1 y los FAIL históricos de inactividad, estancamiento y .03 permanecen conservados. No se sobrescriben sus reportes ni registros de trabajo anteriores.

Se preservan por hash los archivos de código/spec/documentación de inactividad y estancamiento, fuentes de .03 y todos los cambios previos ajenos. Solo dos archivos previos del baseline pueden cambiar en este corte: fixtures de señales y oráculo raíz, con los segmentos/expected ajenos conservados. Tres nuevos: evaluador, spec y este registro. HEAD/staging se comprueban al cierre; no hay commits ni archivos staged.

No hay bloqueo semántico nuevo. Permanece pendiente la adquisición autorizada exhaustiva de hechos/perfil, cobertura operacional, protocolo snapshot/revalidación compatible con productores, commits tardíos/reconciliación y persistencia/episodios/checkpoints .05. MAX(event_sequence) por sí solo no congela evidencia. El evaluador suministra cálculo/testigo; no deduplica durablemente ni cambia ACTIVE/REVIEWED o resuelve automáticamente.

**No ejecutado:** C1, CI17/validación integral .03, Docker/Supabase/WSL, HTTP/RLS/DB/worker/integración/carga, sondeos/intervención de relojes, proveedores cloud, aceptación académica humana. Los PASS focales no se transfieren a otro candidato o a esos controles.

**Siguiente paso concreto:** revisión conjunta y prueba del ensamblaje/contrato interno de los tres evaluadores puros con sus evidencias/versiones, para delimitar el cierre propio de .04 antes de autorizar implementación .05. No se inicia automáticamente esa fase ni se declara cierre integral .04/.03.

En lenguaje sencillo: Alunza comprueba si los últimos envíos confirmados de una asignación, dentro de los catorce días anteriores al corte, muestran el mismo diagnóstico técnico bajo condiciones comparables. No borra un UNKNOWN o un envío incompatible para construir una terna favorable. Si faltan datos confiables, dice «no verificable». Por ahora calcula esa condición; no crea una alerta real ni concluye que el alumno tenga una misma dificultad conceptual.
