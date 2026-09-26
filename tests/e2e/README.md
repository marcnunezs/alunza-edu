# Recorridos integrados de LAB — IMP-00.05, IMP-01 e IMP-02

`npm run test:e2e` prepara servicios locales aislados del laboratorio y ejecuta `foundation.cy.ts`, `identity.cy.ts` y `academic.cy.ts` con Cypress 16.0.0. Conserva los ocho casos FND y añade ocho recorridos institucionales y ocho de contenido/editor. Sus resultados no equivalen a aceptación humana ni despliegue remoto.

| Entorno  | Proyecto Supabase             | Web / API       | Auth / PostgreSQL / correo  |
| -------- | ----------------------------- | --------------- | --------------------------- |
| LAB DEV  | `alunza-edu-laboratorio`      | `3200` / `4200` | `17421` / `17422` / `17424` |
| LAB TEST | `alunza-edu-laboratorio-test` | `3300` / `4300` | `18421` / `18422` / `18424` |

El arnés usa `.local/lab-integration-workspace`. Los archivos de estado y reportes históricos de otros proyectos no autorizan su uso como destino. Las guardas comprueban el proyecto exacto, Auth y la URL PostgreSQL completa antes de conectar; rechazan DEV, servicios originales y overrides de conexión. `local-isolation.test.cjs` verifica contextos, configuración Supabase DEV/TEST y puertos publicados de Compose sin iniciar servicios.

| Caso      | Resultado esperado                                                                             |
| --------- | ---------------------------------------------------------------------------------------------- |
| FND-01    | Estado web y rutas live/ready disponibles                                                      |
| FND-02–04 | Administrador, profesor y estudiante: login real, organización A, sesión tras recarga y logout |
| FND-05    | Credenciales incorrectas rechazadas sin vista privada                                          |
| FND-06    | Organización B y UUID inexistente producen 404 indistinguibles, sin datos ajenos               |
| FND-07    | Caída real de API retira perfil/organización; reintento recupera datos autorizados             |
| FND-08    | Estado informa API inaccesible y se recupera al comprobar otra vez                             |

El script orquestador proporciona `ALUNZA_TEST_STATE`, `ALUNZA_TEST_API_URL`, `ALUNZA_E2E_CONTROL_URL` y `ALUNZA_E2E_CONTROL_KEY` al proceso Node. La configuración solo acepta web `127.0.0.1:3300`, API `127.0.0.1:4300` y Auth `127.0.0.1:18421` del proyecto `alunza-edu-laboratorio-test`. Las tareas usan POST `/api/stop` y `/api/start`, autenticados con `x-alunza-e2e-key`; esperan `{ok:true}` después de completar la operación. `afterEach` restaura la API incluso si una aserción falla. El orquestador conserva responsabilidad sobre arranque y limpieza final de procesos.

La contraseña ficticia llega al test mediante `cy.env()` y se utiliza directamente dentro del callback con logging deshabilitado. No se incluyen credenciales administrativas en la configuración del navegador. La API nueva reemplaza `Cypress.env()`, eliminado en la versión 16. [Referencia oficial de cy.env](https://docs.cypress.io/api/commands/env)

El intercept de soporte solo desactiva el log de XHR/fetch; no define cuerpos, estados ni respuestas exitosas simuladas. [Supresión de logs documentada](https://docs.cypress.io/api/commands/intercept#Disabling-logs-for-a-request)

Video y screenshots automáticos están deshabilitados. El hook Node `after:run` escribe `.local/reports/imp-01/e2e.json` con IDs estáticos, estados, conteos y duración, sin el objeto completo de ejecución, errores ni stacks. Un fallo anterior al hook debe ser registrado como error de infraestructura por el orquestador. [Evento after:run](https://docs.cypress.io/api/node-events/after-run-api)

La comprobación de tipos usa `tsc --project tests/e2e/tsconfig.json`; sus tipos Cypress/Mocha permanecen separados de Jest. No se usan esperas fijas, Cypress Cloud, `cy.prompt`, snapshots de sesión ni aprobaciones académicas implícitas.
