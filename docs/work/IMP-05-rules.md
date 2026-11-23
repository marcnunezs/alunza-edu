# IMP-05.03 — Versiones y activación administrativa de reglas

Fecha de inicio: 05/10/2026 UTC; cierre focal: 06/10/2026 UTC. Estado de aquel corte:
**IMPLEMENTADO Y PROBADO EN FOCOS LOCALES**. La CI completa de 17 pasos está
pendiente al congelar el candidato FINAL. DEC-005 D1–D5 tiene aprobación de
producto; aceptación docente/CAPSTONE y los incrementos posteriores siguen pendientes.

**Actualización 25/10/2026, hora de Santiago:** la CI local completa posterior
aprobó 17/17 controles sobre el candidato integrado .03/.04/.05, incluidos
tres gates SUBMIT consecutivos con el límite original de 5.000 ms. Se cierra
el pendiente de verificación integral local de .03. El [registro final](2026-10-25-submit-admission.md)
identifica fuentes, comandos y resultados; no atribuye esa corrida al candidato
histórico FINAL de este documento. CI remota y aceptación académica permanecen
pendientes.

## Alcance autorizado y autoridad

Marcelo aprobó D1–D5 de la propuesta identificada por SHA-256
`4bb5265db416be221ca90d9d8d0498d8edc33ea3a7d6bc0db91cf684494ce24d` y referencia
Library `libfile_f19ca9299e7c8191b52e650b353b0d31`, después de explicitar sus
consecuencias de producto. Luego autorizó comenzar **únicamente IMP-05.03**.
La [decisión](DEC-005-2026-10-05.md) conserva procedencia y copia exacta del
artefacto preaprobación; no se modifica el original pendiente ni el expediente
académico. La instrucción se registra como autoridad usuario/Product Owner,
sin atribuir aprobación al equipo, asesor o docente guía/CAPSTONE.

Resultado: ADMIN ACTIVE puede crear/consultar versiones de su organización y
activar inmediatamente con vigente esperada, sin sobrescribir reglas/historia,
duplicar auditoría por replay ni dejar vigencias incompatibles bajo concurrencia.
El [diccionario incremental](IMP-05-signal-rules-dictionary.md) coordina DTO/API/SQL.
Trazabilidad principal: ALZ-RF/HU/CU/PT-026 E1–E4; soporte normativo futuro
RF/PT-018, regresión 015, RNF-CON-02/04, RNF-SEG-01/05 y RNF-MAN-02/04.

## Base preservada y decisiones técnicas

Se trabaja sobre HEAD `75708ce`, con staging vacío y cambios previos preservados.
El baseline del coordinador `imp05-03-before.json` registra 583 hashes, 43 rutas
modificadas y 52 sin seguimiento antes del corte. No se atribuye toda esa base
a esta tarea. El cierre local .01–.02 del 04/10/2026 y sus FAIL históricos siguen
en sus registros; no prueban .03.

D1–D5 aprobadas conservan asignación/versiones, eventos/fallback leído, orden
por confirmación/secuencia y progreso acumulado al corte. D5 se concreta en
schemaVersion 1 / algorithmVersion DEC005_V1, parámetros estrictos int4,
versiones inmutables desde creación, estados de versión DRAFT/ACTIVE/RETIRED y
CAS por organización/tipo. Estos son detalles técnicos del corte, sin introducir
un tercer estado de señal ni límites pedagógicos nuevos. El reloj/evaluadores
futuros deben conservar microsegundos y evitar aritmética Number insegura.

La migración fue generada con CLI y aplicada con `migration up --local` en el
suplemento TEST aislado, sobre PostgreSQL 17.6. No se ejecutaron migraciones
remotas. .03 no instala evaluadores/señales ni crea reglas activas automáticamente.

El permiso auxiliar nuevo es `UPDATE(id)` de `app.profiles` para
`alunza_identity`, necesario para `SELECT ... FOR SHARE` en PostgreSQL. El rol
no tiene login ni membresía de ejecución para `alunza_app`; estas RPC no hacen
UPDATE de perfiles. Este nuevo UPDATE(id) se concede únicamente a
alunza_identity; no amplía los permisos de alunza_app, anon, authenticated o
service_role. Se agrega una política de UPDATE para ese lock.
El INSERT en audit_events de alunza_identity ya existía en materiales; la nueva
política permite solo RULE_VERSION_CREATED/RULE_VERSION_ACTIVATED con los
controles de actor/organización/entidad. Son dos adiciones de política sobre
tablas previas y una ACL de columna, no conservación sin cambios de todas sus ACL.

## Trabajo y estado comprobable

- [x] Registrar aprobación de producto D1–D5 con fuente/hash y conservar artefacto exacto.
- [x] Sincronizar specs y guías con la resolución sin volver a someter .01–.02 a aprobación.
- [x] Integrar validador/DTO, API administrativa, persistencia y activación auditada.
- [x] Verificar límites, permisos/RLS, inmutabilidad, replays y carreras de activación mediante los focos y suplemento registrados.
- [ ] Congelar candidato con documentación final y ejecutar CI completa sin editar fuente.

## Verificación

Evidencia pública externa: [manifiesto y reportes acotados](C:/Users/Lenovo/Documents/Codex/2026-09-30/task/imp05-03-public-preliminary-evidence-r2/manifest.json),
SHA-256 `5c81988ddc3c5a3f9627be6be154fa55c09d6abab4d223888e18cb15637c24f3`.
El snapshot R5 contiene 558 archivos y tiene huella
`bdd7d06a80cc64dc57da9e82ad158e01f34a7707e707ae1d8250acb4edb95a9a`;
su manifiesto tiene SHA-256
`286345b5aa0cc1c327ea054034fe6cc3e66dc0a04e75ab9dc754688dfe351cdf`.
La migración probada tiene SHA-256
`9a95a2a43c9c8fc04b87f58757b7b08c4bb6ad6397933c46d65bf6ad236bce97`.
Estos focos ejecutados en Ubuntu local/WSL anteceden al candidato FINAL; no
son la CI17 ni una ejecución remota de GitHub.

| Criterio                  | Comando/procedimiento real                                                                                                                                                                                                   | Resultado observado                                                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contratos de reglas       | `node --experimental-vm-modules node_modules/jest/bin/jest.js --config tests/jest.contracts.cjs --runInBand --runTestsByPath tests/signal-rule-contracts.test.cjs`                                                           | R2: PASS 28/28, exit 0; evidencia previa conservada por identidad de bytes de código/entradas del foco                                                        |
| API/errores de datos      | `npm run test -w @alunza/api -- --runTestsByPath src/rules/rule-versions.service.spec.ts src/rules/rule-versions.controller.spec.ts src/database/database-rule-errors.spec.ts src/database/database-errors.spec.ts`          | R2: PASS 27/27 en cuatro suites: 24 nuevos y tres previos. Con contratos son 55; no se atribuyen nuevas ejecuciones a R5                                      |
| Tipos y lint              | `npm run typecheck`; `npm run lint`                                                                                                                                                                                          | R2: ambos PASS, exit 0; evidencia previa conservada por identidad de bytes. Foundation actualizado tuvo formato/lint comprobados aparte                       |
| HTTP, pgTAP y asesores    | `node imp05-03-focal-integration.mjs` con manifiesto/candidato R5, bajo guard externo; ejecuta dos archivos HTTP completos, `supabase test db` y `supabase db advisors --local --type security --level warn --fail-on error` | R5: PASS, exit 0, 108.356 ms; 50/50 HTTP (38 Foundation + 12 reglas), 607 aserciones en los 12 archivos SQL y asesores PASS. Reporte 2026-10-06T00:35:58.539Z |
| Preservación de migración | `node imp05-03-migration-preservation.mjs` sobre TEST auxiliar aislado con manifiesto R5, bajo guard externo                                                                                                                 | Suplemento r2: PASS seis checks, exit 0, 82.070 ms; terminado 2026-10-06T00:45:10.065Z; cero llamadas externas                                                |
| Limpieza global           | Guard externo de TEST y comparación de recursos Windows/Linux tras los comandos                                                                                                                                              | PASS; liberación 2026-10-06T00:45:11.331692Z, 30 contenedores previos conservados exactamente, cero recursos propios y cero anomalías                         |
| CI completa de 17 pasos   | `npm run ci:verify` sobre el candidato FINAL congelado                                                                                                                                                                       | Pendiente al congelar FINAL; todavía no ejecutada ni aprobada para ese candidato                                                                              |

Los cinco reportes del manifiesto conservan hashes originales, timestamps y
distinción entre controles R2 previamente ejecutados, focos R5 actuales,
suplemento y limpieza. El suplemento fuerza SQLSTATE 22012 después de ejecutar
la migración completa y verifica rollback exacto de catálogo e historia; después
aplica la misma migración por CLI real. Conserva 32 roles, 24 membresías, 162
funciones previas y propietarios/RLS/ACL de 48 tablas anteriores, salvo las
adiciones mínimas de columna/políticas declaradas. Agrega tres tablas y 14
funciones, con seis entradas ejecutables por alunza_app y CREATE de
alunza_identity en app_private revocado al terminar.

La limpieza externa confirma cero contenedores TEST propios, cápsulas runner,
locks de copia, procesos o listeners del proyecto en Windows/Linux. La reserva
global quedó liberada; no se infiere esa limpieza del retorno de un helper.

## Fallos conservados y correcciones

El reporte `retained-failures.json` conserva los intentos originales:

- R1: formato inicial FAIL y typecheck por dependencia nativa de IA omitida de
  la copia; se recuperó la dependencia ya existente sin instalar ni cambiar fuente.
- R2: integración FAIL antes de HTTP/SQL por SQLSTATE 42601; se parentizó CASE
  en la migración, sin atribuir sus controles focales aprobados a otra corrida.
- R3: SQLSTATE 42501; los seis grants de funciones se ordenaron antes de revocar
  membresía de migración, sin expandir las ACL finales autorizadas.
- R4: 163/164 HTTP, incluidos los 12 nuevos aprobados; el inventario estricto de
  Foundation carecía de la tabla nueva. Se agregó exactamente esa entrada esperada.
- Suplemento r1: SQLSTATE 22023 antes de SQL03 por array ACL de dimensión cero
  en el checker externo; se corrigió solo el checker fuera de fuente. No es un
  fallo de rollback ni aprobación de ese intento.

La evidencia final de CI debe quedar en reportes externos/ignorados y resumen
de cierre, sin editar archivos fuente/documentación bajo las pruebas. Cualquier
PASS focal anterior conserva su candidato y no convierte anticipadamente la CI
completa en aprobada. No se modifican gates SUBMIT, thresholds, muestras o
aserciones para conseguir aprobación.

## Pendientes delimitados

.04: evaluadores puros/cobertura/comparabilidad, resultados no evaluable/no
verificable, reloj y oráculos microsegundo E01–E24/SIG. .05: testigos/episodios
durables, cada prefijo/frontera, snapshot/revalidación compatible con productores,
commits tardíos, checkpoints, recuperación y reconstrucción sin reactivar REVIEWED.
.06: UI de reglas. .07–.08: tablero/recorridos integrados. IMP-06: detalle/acción
docente de revisión. La aprobación de producto no cierra esos incrementos.

Azure OpenAI/Vercel Sandbox remotos, CI remota en GitHub, producción, evaluación
semántica y aceptación docente/CAPSTONE conservan sus pendientes propios.
La verificación equivalente en Ubuntu local se informa con su candidato y
evidencia externos; los focos anteriores no cierran la CI17. El estado pendiente
de CI17 de este registro describe el momento de congelar FINAL: su resultado
posterior se entrega en reportes externos/ignorados y resumen de cierre, sin
editar fuente bajo la corrida. Este corte local no acredita integración remota.
No se realizan commits, pushes o despliegues por esta tarea.
