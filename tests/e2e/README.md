# Recorridos integrados locales — IMP-03

`npm run test:e2e` prepara servicios locales aislados y ejecuta `tests/e2e/*.cy.ts` con Cypress 16.0.0. Al corte del 23/10/2026 se conservan **34 casos aprobados**: 8 de fundación, 8 de identidad, 9 de aprendizaje y contenido, y 9 de práctica y envíos. La [evidencia IMP-03](../../docs/work/evidence/imp-03/README.md) y su [matriz](../../docs/work/IMP-03-trazabilidad.md) vinculan estas pruebas con el estado funcional; el número de casos no equivale al número de RF completos.

| Archivo             | Casos | Alcance                                                   |
| ------------------- | ----- | --------------------------------------------------------- |
| `foundation.cy.ts`  | 8     | Estado de servicios, sesiones y aislamiento inicial       |
| `identity.cy.ts`    | 8     | Gobierno institucional, usuarios e invitaciones           |
| `learning.cy.ts`    | 9     | Estructura académica, banco, publicación y borradores     |
| `practice.cy.ts`    | 3     | RUN, diagnósticos y fallos de transporte                  |
| `submissions.cy.ts` | 6     | Confirmación, reintento, recuperación, historial y cierre |

## Regresión de fundación (IMP-00.05)

Los ocho casos de fundación se mantienen como subconjunto histórico de la suite actual; por sí solos no cierran RF de negocio.

| Caso      | Resultado esperado                                                                             |
| --------- | ---------------------------------------------------------------------------------------------- |
| FND-01    | Estado web y rutas live/ready disponibles                                                      |
| FND-02–04 | Administrador, profesor y estudiante: login real, organización A, sesión tras recarga y logout |
| FND-05    | Credenciales incorrectas rechazadas sin vista privada                                          |
| FND-06    | Organización B y UUID inexistente producen 404 indistinguibles, sin datos ajenos               |
| FND-07    | Caída real de API retira perfil/organización; reintento recupera datos autorizados             |
| FND-08    | Estado informa API inaccesible y se recupera al comprobar otra vez                             |

El script orquestador proporciona `ALUNZA_TEST_STATE`, `ALUNZA_TEST_API_URL`, `ALUNZA_E2E_CONTROL_URL` y `ALUNZA_E2E_CONTROL_KEY` al proceso Node. La configuración solo acepta web `127.0.0.1:3100`, API `127.0.0.1:4100` y Auth `127.0.0.1:16421` del proyecto `alunza-edu-foundation-test`. Las tareas usan POST `/api/stop` y `/api/start`, autenticados con `x-alunza-e2e-key`; esperan `{ok:true}` después de completar la operación. `afterEach` restaura la API incluso si una aserción falla. El orquestador conserva responsabilidad sobre arranque y limpieza final de procesos.

La contraseña ficticia llega al test mediante `cy.env()` y se utiliza directamente dentro del callback con logging deshabilitado. No se incluyen credenciales administrativas en la configuración del navegador. La API nueva reemplaza `Cypress.env()`, eliminado en la versión 16. [Referencia oficial de cy.env](https://docs.cypress.io/api/commands/env)

El intercept de soporte desactiva el log de XHR/fetch. Los escenarios específicos de práctica y envíos también controlan interrupciones y orden de entrega para comprobar recuperación y respuestas tardías; conservan la API, persistencia y ejecución Docker reales para los resultados de negocio. [Supresión de logs documentada](https://docs.cypress.io/api/commands/intercept#Disabling-logs-for-a-request)

Video y screenshots automáticos están deshabilitados. El hook Node `after:run` escribe los informes intermedios `.local/reports/imp-01/e2e.json` y `.local/reports/imp-02/e2e.json` con IDs estáticos, estados, conteos y duración, sin el objeto completo de ejecución, errores ni stacks. El orquestador exige los 34 IDs y publica el resultado vigente en `.local/reports/imp-03/e2e.json`. Una ejecución incompleta o un fallo de infraestructura impide registrar éxito; los diagnósticos saneados se conservan localmente por separado. [Evento after:run](https://docs.cypress.io/api/node-events/after-run-api)

La comprobación de tipos usa `tsc --project tests/e2e/tsconfig.json`; sus tipos Cypress/Mocha permanecen separados de Jest. No se usan esperas fijas, Cypress Cloud, `cy.prompt`, snapshots de sesión ni aprobaciones académicas implícitas.
