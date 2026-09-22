# IMP-00.05 — CI y recorrido Cypress

Fecha: 2026-09-10. Autor de implementación y verificación local: Codex. Autorización actual del usuario: «Procede con la unidad IMP-00.05». No se inicia IMP-00.06 ni se cierra ningún RF de negocio. Los cambios anteriores de CAPSTONE y la base IMP-00.01–00.04 se preservan.

## Implementación y decisiones

Se reutilizan npm workspaces, Node 24.21.0/npm 11.19.0, Jest, los cuatro endpoints públicos, el fixture de dos organizaciones y seis usuarios y Supabase CLI 2.101.0. **Cypress 16.0.0** se añadió como dependencia de desarrollo exacta al lockfile; sus engines oficiales admiten Node 24. El binario se instala y verifica explícitamente con `cypress:install`, sin habilitar todos los scripts de dependencias. No hay Cypress Cloud, nueva aplicación ni proveedor nuevo.

`scripts/test-environment.mjs` extrae el arranque/migración/seed/lock/apagado ya existente de integración. `test:integration` y `test:e2e` comparten el proyecto `alunza-edu-foundation-test` y el lock; nunca se ejecutan simultáneamente. Los negativos de base de datos siguen en esa instancia. E2E usa API4100/web3100, y establece CORS exclusivamente para ese origen. La configuración y los puertos de desarrollo3000/4000/154xx no se reutilizan.

La revisión detectó que copiar sobre archivos anteriores y reutilizar una BD migrada podía ocultar SQL modificado o conservar una migración eliminada. El runner ahora reemplaza exclusivamente sus copias `migrations/tests` con guardas `realpath`, valida el estado TEST y ejecuta `db reset --local --no-seed --yes` antes de migrar/sembrar. Cada suite vuelve a probar las migraciones actuales desde una BD reconstruida. Solo los comandos explícitos de pruebas hacen esto; `local:up` y los datos de desarrollo siguen intactos. Flags contrastados con CLI2.101.0 instalada y [referencia oficial de db reset](https://supabase.com/docs/reference/cli/supabase-db-reset).

`ALUNZA_E2E_BUILD=1` selecciona `.next-e2e` con `distDir` de Next; se preserva `.next` normal y se incluyen los tipos generados de ambos builds. El artefacto se construye con las variables públicas reales de Auth16421. `verify-artifacts` conserva su comportamiento DEV y comprueba estado/JWK/build TEST cuando recibe el flag, sin ampliar las rutas a destinos arbitrarios. La API sigue siendo Nest; no se añadió una API de negocio en Next.

`scripts/e2e.mjs` posee los procesos que inicia. Las tareas Cypress solo pueden iniciar/detener ese hijo API a través de un control efímero en127.0.0.1 con clave aleatoria privada. El control acepta únicamente dos acciones fijas; no acepta PID, SQL, contenedor o comandos arbitrarios. Cada prueba restaura la API y el runner cierra web/API/control/Supabase en `finally`, conservando volúmenes del fixture. Un puerto ocupado o lock existente detiene la prueba sin tocar el proceso ajeno.

**DEC-007:** compatibilidad Cypress 16/Node 24 comprobada mediante instalación, verificación del binario y ejecución real. Se conserva TypeScript 5.9.3 con configuración E2E separada para no mezclar globales Cypress/Jest. No se presupone compatibilidad remota hasta ejecutar el workflow.

## Recorrido y evidencia segura

`tests/e2e/foundation.cy.ts` contiene ocho casos, con precondiciones independientes y aserciones observables:

| ID        | Comportamiento                                                                               |
| --------- | -------------------------------------------------------------------------------------------- |
| FND-01    | Estado web y respuestas reales de liveness/readiness200                                      |
| FND-02–04 | Acceso ADMIN/TEACHER/STUDENT, perfil/organización propios, recarga, cierre y foco            |
| FND-05    | Contraseña incorrecta rechazada sin perfil ni sesión                                         |
| FND-06    | Organización ajena e inexistente producen404 indistinguible, sin dato ajeno ni JWT reflejado |
| FND-07    | API detenida: perfil/organización retirados; recuperación al reintentar                      |
| FND-08    | Estado indica API indisponible y vuelve a disponible tras iniciar/reintentar                 |

No hay respuestas simuladas ni esperas de duración fija en Cypress. Los interceptores solo suprimen logging de XHR/fetch; el tráfico llega a Auth/API reales. Se usan IDs/etiquetas/textos estables. La contraseña ficticia se lee mediante `cy.env`, sin assertions que impriman su valor, y `type` tiene logging desactivado. El navegador no recibe la conexión BD, clave administrativa, JWK privado ni clave de control.

Videos, capturas automáticas y grabación remota están desactivados. `after:run` genera un resumen por lista permitida: IDs FND, estados, conteos, duración y versiones de herramienta/navegador. No copia config, errores, stacks, requests, respuestas Auth ni screenshots. El runner rechaza cero pruebas, pendientes, omitidas, failures de infraestructura y cualquier test fallido, aunque la Module API de Cypress resuelva su Promise. Un fallo de cleanup tampoco cuenta como éxito.

## CI y comandos

Desde raíz Git con Node/npm fijados, Docker Linux y Chrome:

```powershell
npm ci
npm run ci:verify
```

`ci:verify` ejecuta formato, lint, tipos y 42 pruebas Jest; instala/verifica Cypress; ejecuta las 38 pruebas de integración y 14 pgTAP; después `test:e2e` hace build de web/API, revisión de secretos del artefacto y recorrido real. Los prerrequisitos de tipos usan valores públicos ficticios válidos, sin acreditar Auth; las pruebas y el build E2E usan el entorno real. Se conserva el fallo como código de salida no cero y se emite un resumen, nunca se transforma un comando fallido en verde.

Comandos separados: `cypress:install`, `test:e2e`, `test:integration`, `test:gates`; guía completa en [README](../../README.md).

`.github/workflows/foundation.yml` usa Ubuntu24.04, Docker, Node24.21.0/npm11.19.0 y dependencias Linux de Chrome/Cypress. Acciones oficiales fijadas a SHA: checkout7.0.1, setup-node7.0.0 y upload-artifact7.0.1. Permisos mínimos `contents: read`, credenciales Git no persistidas, timeout40min y cancelación de ejecuciones anteriores del mismo ref. Eventos PR, pushmain y workflow_dispatch; no pull_request_target, despliegue, escrituras remotas ni secretos productivos.

El upload acepta únicamente `.local/reports/imp-00-05/*.json`, con retención7d. No incluye `.local` completa, logs privados, estado, claves o medios. El nombre del artefacto identifica run/attempt de GitHub cuando exista.

## Resultados ejecutados

Entorno local: Windows 10.0.26200.0, PowerShell, Node 24.21.0, npm 11.19.0, Docker Engine 29.7.2 y Compose 5.3.1. Supabase CLI 2.101.0 opera contenedores Linux; el navegador real de este corte es Chrome 152.0.7977.83. El destino configurado de GitHub Actions es Ubuntu 24.04 y sigue sin ejecución remota.

| Comprobación                               | Estado observado                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Instalación limpia del lock                | `npm ci`: salida 0, 847 paquetes instalados/851 auditados, 0 vulnerabilidades conocidas; `npm ls --all`: salida 0                    |
| Binario Cypress                            | Instalación y verify aprobados en Windows con Node 24.21.0; Cypress 16.0.0 y Chrome 152.0.7977.83                                    |
| E2E completo                               | 8/8 aprobados sobre servicios reales en tres ejecuciones; última suite 34,421 s; cleanup completado                                  |
| Entrada completa ci:verify                 | Aprobada tras instalación limpia y corrección del reset TEST: 2026-09-10 22:35:29 UTC, siete pasos con salida 0                      |
| Defectos deliberados de los cinco comandos | Aprobados: cinco baselines, cinco rechazos con diagnóstico esperado, cinco restauraciones exactas y cleanup; salida global 0         |
| Workflow                                   | Prettier y actionlint1.7.12 aprobados localmente                                                                                     |
| GitHub Actions remoto                      | **No ejecutado**. No hubo commit/push/dispatch del workflow ni de la base; la rama remota consultada aún no contiene este incremento |

Los probes `test:gates` copian físicamente fuentes y dependencias instaladas al temporal del sistema (`alunza-gate-probes/run-*`), reconstruyen enlaces de workspaces dentro de la copia y evitan archivos `.env`, estado, Git, outputs y respaldos. Cada comando primero debe pasar. Después se inyecta formato incorrecto, referencia no definida, TS2322, expect fallida o import inexistente en Next. Se exige código no cero y diagnóstico del defecto esperado; timeout o fallo de baseline no acreditan rechazo. Se comprueban hashes de fuentes restauradas y se elimina solo la copia propia verificada. Por coste, este comando es explícito y no corre en cada push.

Resultado final de los defectos: formato salió 1, lint 1, tipos 2, Jest 1 y build 1. Todos habían pasado sin el defecto (salida 0). Las cinco restauraciones coincidieron con la huella previa; cleanup pasó y no quedaron lock ni copias. Los servicios de integración/E2E también quedaron detenidos. La huella de los archivos entregados se conserva en `.local/evidence/imp-00-05/source-sha256.json`; el candidato sigue sin commit/push.

Incidencias de los probes: el primer baseline rechazó un archivo de configuración recién generado sin formato; se estabilizó el formato antes de copiar. Después Jest encontró 21 archivos pero ninguna coincidencia bajo `.local`: en Windows, `jest-util` preserva el separador anterior al punto como escape del glob. La copia se trasladó a un temporal sin ese ancestro; no se modificó Jest ni se permitió pasar sin tests. Los intentos fallidos conservaron salida no cero y no se contaron como pruebas de rechazo deliberado.

Evidencia local: `.local/reports/imp-00-05/{ci,integration,e2e,artifacts,gates}.json`; diagnósticos saneados en `.local/evidence/imp-00-05/` y, para probes fallidos, `.local/gate-probes-error.log`. La instalación limpia se registra en `.local/evidence/imp-00-05/npm-ci.txt` y el árbol de dependencias en `npm-ls.txt`. Los archivos locales permanecen ignorados por Git; este documento conserva conclusiones revisables y comandos. No se exponen credenciales ni se atribuyen contribuciones humanas.

`npm ci` advierte scripts de instalación no autorizados de tres dependencias; Cypress se instala explícitamente con el comando anterior. También avisa de deprecación de `glob@10.5.0` transitivo. Instalación, pruebas y builds finalizaron con salida 0; audit no reportó vulnerabilidades conocidas. No se habilitaron scripts globalmente ni se actualizó el stack por ese aviso.

Fuentes oficiales consultadas: [Cypress instalación/Node/SO](https://docs.cypress.io/app/get-started/install-cypress), [cy.env y manejo seguro de valores](https://docs.cypress.io/api/commands/env), [intercept](https://docs.cypress.io/api/commands/intercept), [after:run](https://docs.cypress.io/api/node-events/after-run-api), [Next distDir](https://nextjs.org/docs/app/api-reference/config/next-config-js/distDir), [checkout](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node](https://github.com/actions/setup-node/releases/tag/v7.0.0), [upload-artifact](https://github.com/actions/upload-artifact/releases/tag/v7.0.1).

## Límites y siguiente unidad

Este corte aporta a RNF-MAN/POR y controles de regresión de RF-001/020/021; los identificadores FND son pruebas técnicas adicionales y no sustituyen E1–E4 ni cierran RF. No acredita WCAG completa, rendimiento, ejecución estudiantil, IA, despliegue o aceptación CAPSTONE. Se mantiene el límite ya observado de binding Supabase en Docker Desktop; solo hay datos ficticios y se cierran los servicios de prueba.

La validación local del pipeline y actionlint no equivalen a un run remoto aprobado. La ejecución real de GitHub Actions queda pendiente hasta incorporar el candidato al remoto y ejecutarlo. **Siguiente unidad de implementación: IMP-00.06**, sin comenzar en esta tarea.
