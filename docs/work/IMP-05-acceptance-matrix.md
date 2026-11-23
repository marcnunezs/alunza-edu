# IMP-05.08 — Matriz de aceptación local

La matriz enlaza requisitos con pruebas identificables; no convierte su mera
presencia en PASS. Los comandos, candidato, resultados y excepciones se registran
en [el cierre del incremento](IMP-05-acceptance.md). Los cortes históricos .04–.07
conservan sus límites originales. La aceptación humana CAPSTONE es independiente.

Cierre técnico local del candidato: CI final **17/17 PASS** a
`2026-10-27T00:12:20.364Z` (26/10 en Santiago), con 200 HTTP, 1032 SQL y
75 E2E, además de los focos de actualización y rendimiento registrados.
Los niveles de prueba y exclusiones de cada fila siguen vigentes; E20 está
fuera del MVP y E23 no acredita la corrida durable específica allí descrita.
La latencia de ayuda renderizada en navegador de IMP-04 conserva su estado
`BLOCKED/BROWSER_RENDER_EVIDENCE_UNAVAILABLE`; la UI .08 mide otras superficies.

## Inventario y oráculos

- **P**: `tests/integration/zzzzzzzz-progress.test.cjs`.
- **V**: `tests/integration/zzzzzzzzz-rule-versions.test.cjs`.
- **S**: `tests/integration/zzzzzzzzzz-signals.test.cjs`.
- **D**: `tests/integration/zzzzzzzzzzz-dashboard.test.cjs`.
- **AC**: `tests/integration/zzzzzzzzzzzz-progress-phase.test.cjs`.
- **PHASE**, **DASH**, **RULES**: casos con esos IDs en los specs Cypress
  `progress-phase.cy.ts`, `dashboard.cy.ts` y `signal-rules.cy.ts`.
- **SQL**: `supabase/tests/011_student_progress.test.sql`, `012_signal_rules.test.sql`,
  `013_signal_episodes.test.sql`, `014_signal_rule_effective.test.sql` y
  `015_dashboard.test.sql`; `016_dashboard_query_privileges.test.sql` verifica
  los límites de las funciones optimizadas en .08.
- **I/R/T/J**: specs puros `inactivity`, `repeated-error`, `stagnation` y
  `signal-evaluation.integration` en `apps/api/src/signals`.
- **F**: `tests/progress-fixtures.test.cjs`; calcula esperados independientes de
  los evaluadores de producción y conserva los catorce IDs SIG aprobados.

Los oráculos docentes usan obligaciones estudiante/asignación. El fixture pequeño
espera seis obligaciones, un logro y cinco intentos; el de capacidad espera
60 estudiantes, dos actividades con tres requeridos, 360 obligaciones y un logro.
Los conceptos superpuestos no se suman para calcular el total. La historia sintética
de frontera se distingue de SUBMIT Docker y HELP TEST ejecutados realmente.

## Dieciséis escenarios E1–E4

| Escenario | Evidencia que debe ejecutarse                                                            | Aserción de aceptación                                                                                                                |
| --------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| HU-015-E1 | P `RF015-E1`, D período, AC-01/03/06; DASH-06/07, PHASE-03/08                            | 2/3, filtro de concepto, logro previo al período, fallo posterior sin pérdida; intentos paginados y ayudas deduplicadas.              |
| HU-015-E2 | P `RF015-E2`, D filtros; progreso Cypress, PHASE-05                                      | Fechas/filtros inválidos rechazados; caída y recuperación actualizan el corte de progreso personal.                                   |
| HU-015-E3 | P `RF015-E3`, D permisos; DASH-04, PHASE-05                                              | Ni identidad de cliente ni sesión anterior obtiene evidencia ajena.                                                                   |
| HU-015-E4 | P `RF015-E4`, SQL011; progreso Cypress, PHASE-04                                         | 0/0 no calculable separado de 0/D sin intentos y de servicio fallido.                                                                 |
| HU-016-E1 | D cifras/período/paginación, AC-01/02/03; DASH-01/06, PHASE-02/07                        | Agregados sobre todo el conjunto filtrado; evidencia, historial y páginas concuerdan con el oráculo.                                  |
| HU-016-E2 | D filtros/cursor, SQL015; DASH-02/05, PHASE-05                                           | Período invertido, cursor alterado y caída de API no producen ceros inventados.                                                       |
| HU-016-E3 | D permisos/alumno deshabilitado, AC-04; DASH-04                                          | Otra clase de la organización, otra organización, ADMIN, estudiante y revocación quedan aislados; matrícula vigente delimita totales. |
| HU-016-E4 | D sin intentos, SQL015; DASH-02, PHASE-04                                                | Ausencia de hechos observable y denominador cero tienen textos específicos; no concluyen desempeño.                                   |
| HU-018-E1 | I/R/T/J/F, S episodios, D tres tipos; DASH-03, PHASE-01/03                               | Tres causas, versión, fechas, evidencia mínima; ACTIVE/REVIEWED separados de condición y procesamiento.                               |
| HU-018-E2 | D FAILED/evidencia ausente, SQL015; PHASE-04                                             | Filtro inválido y evidencia no verificable diferenciados; no se oculta el episodio.                                                   |
| HU-018-E3 | S permisos internos, D permisos, AC-01/04; DASH-04                                       | No hay evaluación ni lectura pública de ámbitos ajenos; ningún GET modifica episodios.                                                |
| HU-018-E4 | I/R/T/J/F, S worker, AC-03; PHASE-04                                                     | NO_MATCH persistido verificable se distingue de NOT_EVALUATED, PENDING y FAILED.                                                      |
| HU-026-E1 | V creación/activación/concurrencia/efectivas, SQL012/014; RULES-01/06/08, PHASE-01/03/09 | Versión, autor y vigencia conservados; puente ADMIN → motor → docente/estudiante.                                                     |
| HU-026-E2 | V CAS/vigencias/auditoría/replay, SQL012; RULES-04/05                                    | La versión activa es inmutable; conflicto o respuesta perdida no duplica efecto ni reescribe historia.                                |
| HU-026-E3 | V permisos/revocación/mutex, SQL012/014; RULES-03                                        | Docente, estudiante y ADMIN ajeno no mutan reglas; tokens antiguos no eluden permisos actuales.                                       |
| HU-026-E4 | V validación, contratos/unitarias; RULES-02                                              | Umbral negativo, incompleto, fraccionario o fuera de int4 rechazado, configuración vigente intacta.                                   |

PHASE-06 verifica teclado nativo, foco, cierre del diálogo y acceso a las
columnas en tres tamaños (RNF-USA). Sus doce capturas, más progreso y reglas
en PHASE-08/09, completan 18 imágenes: 1440×900, 768×1024 y 390×844.
Esta revisión no equivale a una auditoría WCAG completa ni de lector de pantalla.
PHASE-04/05 comprueban estados y respuestas tardías en el tablero; los casos
personales equivalentes se acreditan con las pruebas P, DASH y progreso
indicadas en la tabla, no con esos dos casos PHASE aislados.

## SIG-01–14 y fronteras DEC-005

| Casos     | Contraste independiente y nivel operacional                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SIG-01–04 | F + I: duración, evento elegible, cobertura y cierre. S cobertura/capturador y AC-03 añaden captura real de RUN/HELP/ACK; la espera de siete días sigue siendo fixture temporal explícito. |
| SIG-05–08 | F + R: firma, N consecutivos, SUCCESS interrumpe y ventana inclusiva; S episodios y D explican la causa persistida.                                                                        |
| SIG-09–12 | F + T: conteos completos, comparabilidad, mejora y parcial; J contrasta coexistencia de causas; S E17 preserva prefijos intermedios.                                                       |
| SIG-13    | S leases, recuperación y replay idempotente; AC-01 repara proyecciones ausentes/alteradas dos veces sin alterar fuentes ni ámbitos vecinos.                                                |
| SIG-14    | S revisión concurrente conserva la primera base; AC-01 comprueba REVIEWED y lectura pública tras reconstrucción; no publica RF-019.                                                        |

| Frontera | Cobertura exigida y límite                                                                                                                                                                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E01–E03  | I + F: siete días −1/exacto/+1 µs, base máxima, apertura y cobertura. S verifica épocas y hueco durable; no inventa backfill.                                                                                                                                                                                    |
| E04–E05  | P `apertura explícita concurrente` y S commit/rollback/replay verifican ACTIVITY_OPENED real; I verifica su efecto en lastAt (distinto de opensAt). RUN real y HELP/ACK en S/AC-03; polling y fallos sin entrega no son pistas. Cierre exclusivo en I/R/T; historia D conserva ACTIVE interrumpido.              |
| E06–E11  | R/T/J + F: ventana inclusiva, terna vieja, selección antes de comparar, UNKNOWN/parciales, mejora, visibleTotal y requerido oculto. SQL011 y SUBMIT comprueban canonicidad.                                                                                                                                      |
| E12–E14  | Replay/empates en I/R/T y `signal-processing.spec.ts`; SQL011 admite A1/A2 y confirma A2 antes de A1 con corte exacto y −1 µs. Orden confirmado y secuencia BigInt, sin usar UUID ni orden HTTP.                                                                                                                 |
| E15–E17  | S: worker atrasado, prefijos E17, checkpoints, dos procesos, respuesta perdida, reintentos y reloj regresivo. PHASE-04 muestra frescura sin afirmar evaluación exactamente en T.                                                                                                                                 |
| E18      | AC-06: dos fallos en A y uno en B del mismo ejercicio no forman terna; publicación API v2 conserva asignaciones y logro v1. La nueva asignación v2 obtiene sus propias causas tras tres fallos.                                                                                                                  |
| E19      | V/SQL012/014 y PHASE-01: vigencias de regla [A,B), CAS, motor con nueva versión, episodio anterior intacto.                                                                                                                                                                                                      |
| E20      | Backfill/corrección histórica auditada fuera del MVP; no se acredita procedencia mediante fixtures.                                                                                                                                                                                                              |
| E21      | S commit tardío/reconciliación y AC-02: mismo corte, nuevos hechos confirmados, PENDING y posterior reconciliación; conserva evaluación previa.                                                                                                                                                                  |
| E22      | J éxito antiguo + terna posterior y AC-01: progreso acumulado preservado junto con causas y episodios posteriores.                                                                                                                                                                                               |
| E23      | `signal-processing.spec.ts`, caso `E23 keeps the inactivity witness`, e I: empate de ancla y referencias conservan testigo en cálculo puro. S revisión/replay y AC-01/03 verifican persistencia idempotente. No se atribuye a AC una corrida durable con dos eventos nuevos de timestamp idéntico tras REVIEWED. |
| E24      | AC-05: SUBMIT con fecha anterior a la revisión aún sin commit queda fuera de su base; al confirmar produce ACTIVE vinculado, conserva REVIEWED, autor, fecha y base; reconstrucción no altera la lectura.                                                                                                        |

## Evidencias que condicionan el cierre

AC-07 contrasta los contadores públicos con el listado completo y verifica que
la optimización conserve UP_TO_DATE, PENDING, FAILED, job ausente, continuación,
deadline y cambios finalizados sin ACK posteriores al corte. Cambiar frescura
no altera cifras, episodios ni `evaluatedAt`; las modificaciones operativas del
fixture se revierten al terminar. La actualización real .07→.08 compara 26
colecciones canónicas y DTO públicos al mismo corte, excluyendo solo
`observedAt`, mediante `test:imp05:upgrade`.

RNF-CON-02/RNF-IA-05: D conserva cifras al cambiar flags sin pedir ayuda; S
rehidrata snapshots y reproduce cálculos sin transporte IA. AC-03 sí despacha
generación TEST indisponible y contradictoria, comprueba la llamada, el resultado
técnico original y las lecturas al mismo corte. Un ACK elegible posterior cambia
lastAt de forma legítima; repetirlo no duplica. La salida malformada pertenece
al caso `invalid-output` de `tests/integration/zzzzzzz-help.test.cjs`, no a AC-03.

El foco `test:imp05:acceptance` produce `progress-acceptance.json`; el diagnóstico
SQL produce `progress-sql-diagnostics.json` y veinte logs completos. Las corridas
guardan historial y errores. Veinte PASS sin reproducción no resuelven la causa
de la intermitencia heredada de SQL015.

`test:e2e -- --phase` exige nueve IDs y 18 capturas; la suite completa exige
75 casos. Los perfiles de API y UI de tres superficies conservan primeras muestras,
50 calientes secuenciales y 50 bajo carga cuatro, con cero errores y p95 <3 s.
En UI la carga es un Chrome y tres lectores HTTP. Los candidatos deben permanecer
estables, incluidos documentos. Finalmente `ci:verify` conserva 17 etapas y tres
gates SUBMIT consecutivos. Ninguna evidencia local acredita Azure, Vercel,
aceptación CAPSTONE, RF-017 integral o la acción pública RF-019.
