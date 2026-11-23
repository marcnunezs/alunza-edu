# IMP-03.01–03.03 — RUN desde el editor

Implementación del plan autorizado el 26/09/2026. Este corte añade ejecución de
práctica temporal a la identidad, contenido y editor de IMP-02. La verificación
final se registra abajo; la presencia del código no acredita aceptación académica
ni integración con Vercel Sandbox.

Autor de implementación y verificación: Codex, sobre la base Git `7c6e740` y
los cambios locales de este corte. No se atribuyen revisión ni aceptación a
personas del equipo; no se creó commit ni despliegue.

## Alcance y decisiones

- ALZ-RF/HU/CU/PT-009 y regresión de 001/005/008. RUN no crea intento, progreso,
  eventos pedagógicos ni ayuda. RF-010/011/014 continúan en los siguientes cortes.
- Controles afectados: RNF-REN-02/04, RNF-SEG-01–05, RNF-USA-02–04 y
  RNF-POR-01–03. Las pruebas locales de teclado y estado textual no sustituyen
  una revisión manual completa de WCAG ni la verificación híbrida productiva.
- El usuario eligió IMP-03.01–03.03 y confirmó que un RUN admitido antes del cierre
  termina; nuevas admisiones se rechazan. El resultado exige acceso actual del
  estudiante. La carrera SUBMIT/cierre conserva su decisión pendiente.
- Docker permanece como adaptador local y Vercel Sandbox como adaptador productivo
  pendiente de validación remota. No se activan proveedores pagados ni despliegues.
- JavaScript síncrono mediante `module.exports.solve`, argumentos/retorno JSON y
  comparación estructural exacta. QuickJS/WASM se ejecuta dentro de la cápsula;
  el programa no recibe APIs de Node, archivos, red ni el canal de retorno.
- Se conservan los límites fijados: 134217728 bytes totales, 3000 ms acumulados,
  65536 bytes de stdout/stderr y límites separados de código/retorno.

## Contrato e integración

`POST /api/v1/activities/{id}/exercises/{aeId}/executions` recibe únicamente
`code` y `exerciseVersionId`, con `Idempotency-Key`. Fuente hasta 65536 bytes UTF-8;
envoltorio JSON de 512 KiB exclusivo de la ruta. Devuelve 201 con ejecución y
resultado temporal, incluidos los diagnósticos técnicos de errores estudiantiles.
Rechazos de acceso, versión, ventana, cuota o dependencia ocurren antes de ejecutar.

La admisión serializa con el cierre y confirma una reserva; Docker corre fuera de
la transacción. El resultado y la respuesta idempotente se confirman después de
la limpieza. La finalización interna usa la reserva y su token; devolver o
recuperar una respuesta exige autorización vigente.

La persistencia operativa no guarda fuente. Conserva hashes, contexto, versiones
y lease; la respuesta pública vence 24 horas después de la admisión. La purga
retira esa respuesta y conserva el vínculo y los hashes. La clave vencida no vuelve a ejecutar.
La recuperación reclama leases vencidos, elimina cápsulas propias y finaliza con
fallo operativo cuando falta resultado; no repite automáticamente código.
Una creación cuya respuesta se pierde conserva la reserva hasta el piso de 60
segundos desde su admisión. El barrido periódico también elimina cápsulas propias
que aparezcan tarde, incluso después de completar la reserva o durante una caída
de la base de datos.
El [diccionario](IMP-03-dictionary.md) describe restricciones, RLS y funciones.

La interfaz conserva el borrador, permite editar durante RUN y distingue resultados
de una versión anterior del código. Una respuesta incierta permite recuperar la
misma solicitud; un RUN deliberado genera una clave nueva. Resultados y solicitudes
se mantienen en memoria, separados por cuenta, organización, clase y versión.
Renovar el JWT de la misma sesión conserva esa memoria mientras identidad y
acceso se revalidan; el editor queda oculto e inerte durante la comprobación.
Una cuenta o sesión nueva, otro recurso o una denegación definitiva descartan
la operación local y sus respuestas tardías.

## Operación local y pruebas

En una sesión con Node/npm del repositorio:

```powershell
. ./scripts/use-node.ps1
npm ci
npm run runner:prepare
npm run runner:doctor
npm run db:migrate
npm run dev
```

El ejemplo supone el Supabase DEV del laboratorio ya iniciado. Migrar no requiere
repetir el seed ni modifica el repositorio original. Compose mantiene RUN apagado:
no se monta el socket Docker en la API. La aplicación nativa local usa Docker
Engine mediante IPC local y conserva el CLI para iniciar y adjuntar la cápsula.
Ambos transportes fijan el mismo daemon; se rechazan endpoints remotos. La imagen
preparada se identifica por su digest inmutable.

Cuotas predeterminadas: un RUN activo por estudiante/organización, cuatro por
organización y diez admisiones por minuto. Las variables `PRACTICE_*` se documentan
en `.env.example`. El plazo operativo es distinto del estudiantil: 30 segundos
más 10 de limpieza, cliente de 45, lease de 60 y reconciliación cada 15 segundos.

Comprobaciones del corte: contratos, unitarias, Docker adversarial y probes OS,
veinte referencias correctas/incorrectas del banco, integración Auth/API/SQL,
Cypress y medición HTTP. Los resultados se guardan en `.local/reports/imp-03/`;
las suites del ejecutor conservan su directorio histórico de ensayos.

`npm run test:practice:performance` reconstruye solo TEST y toma 50 solicitudes
secuenciales y 50 a concurrencia cuatro. Usa cuatro alumnos canónicos y un límite
de frecuencia de 100 únicamente en ese proceso de medición, para separar latencia
de rechazos intencionales por cuota. Se mantienen límites de concurrencia y
recursos. La carga usa la solución correcta de **Sumar dos números**, con una
prueba visible, en las clases de esos alumnos. Cada cápsula es nueva; el primer
lote tras reiniciar API se distingue de los siguientes. No representa latencia
híbrida ni carga productiva.

## Demo reproducible

Con DEV iniciado, usar `npm run local:credentials` para consultar las credenciales
ficticias sin incluirlas en este registro. Entrar como estudiante en
`http://127.0.0.1:3200`, abrir una clase inscrita, una actividad publicada y el
ejercicio canónico **Sumar dos números**. Pulsar **Ejecutar** con
`module.exports.solve = (a, b) => a + b;`: el panel debe mostrar SUCCESS y las
pruebas visibles superadas. La función `() => 0` demuestra FAILED_TEST y
`() => { while (true) {} }` demuestra TIMEOUT.

Editar mientras se ejecuta mantiene el borrador y marca el resultado anterior.
Recargar conserva el borrador y descarta el resultado. El escenario Cypress
IMP03-03 reproduce la pérdida de una respuesta real, cierra la actividad y
recupera exactamente la misma ejecución. Incluye renovación real de sesión
durante RUN y recuperación, con el almacenamiento de borradores indisponible.
IMP03-05 cambia de cuenta antes de
entregar una respuesta real y comprueba que esa respuesta tardía se descarta.

## Evidencia de cierre

Estado: implementado, integrado y probado en el laboratorio local. La tercera
corrida de `npm run ci:verify` terminó con código 0 el 26/09/2026 a las 21:36:02
UTC, con las 13 etapas aprobadas. Informe: `.local/reports/imp-03/ci.json`.

| Comprobación                               | Resultado de cierre                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| Formato, lint y tipos                      | Aprobados                                                                |
| `npm test`                                 | 327 pruebas aprobadas en seis grupos                                     |
| Preparación y doctor del runner            | Imagen preparada; límites efectivos y limpieza comprobados               |
| `npm run runner:probe -- --adapter docker` | 69/69 casos; cero cápsulas propias restantes                             |
| `npm run test:academic:fixtures`           | Diez ejercicios, 20 verificaciones correctas/incorrectas                 |
| `npm run test:integration`                 | 97/97 pruebas HTTP y 181 aserciones SQL en seis archivos                 |
| `npm run test:practice:performance`        | 100/100 respuestas válidas, cero errores, ambos p95 <5 s                 |
| `npm run test:ai:integration`              | Regresión local aprobada; ninguna llamada remota añadida                 |
| `npm run test:e2e`                         | 29/29, sin omitidos ni pendientes; Chrome 153.0.8010.50 / Cypress 16.0.0 |

Cypress terminó a las 21:35:56 UTC; su informe es
`.local/reports/imp-03/e2e.json`. Incluye los 24 recorridos anteriores y los cinco
escenarios IMP03-01–05, sin simulación del servicio de ejecución. Los informes
de integración, rendimiento y runner identifican entorno, versiones y limpieza.
La CI también ejecutó los controles de artefactos y exposición de secretos de
la suite existente. Las corridas fallidas anteriores se conservan abajo.

La comprobación final de solo lectura encontró cero cápsulas propias, ningún
listener TEST en 3300/4300/18421/18422 y ningún bloqueo de integración pendiente.
DEV respondió 200 tanto en la web (3200) como en `/health/ready` (4200).
Evidencia: `.local/reports/imp-03/closing-verification.json`. Se restauraron las
rutas generadas de `next-env.d.ts` al entorno DEV y `git diff --check` pasó.

El cierre se limita a IMP-03.01–03.03. Sandbox remoto, paridad productiva,
despliegue y aceptación humana permanecen pendientes. No se implementó SUBMIT,
historial de intentos, progreso ni ayuda, ni se atribuye aceptación a integrantes.

Primera medición HTTP, conservada en
`.local/reports/imp-03/run-performance-initial.json`: 100/100 respuestas 201
SUCCESS, sin errores ni cápsulas huérfanas. Node 24.21.0, Windows x64, 12 CPU
lógicas y 33854394368 bytes de RAM del anfitrión. La imagen se mantuvo idéntica
durante el ensayo.

| Perfil inicial | Muestras |  p95 total | Primer lote | Lotes siguientes | Objetivo <5 s |
| -------------- | -------: | ---------: | ----------: | ---------------: | ------------- |
| Secuencial     |       50 | 3971,73 ms |  3732,04 ms |       3971,73 ms | Cumple        |
| Concurrencia 4 |       50 | 7656,41 ms |  6239,74 ms |       7656,41 ms | No cumple     |

El comando terminó con código 1 por ese incumplimiento. El primer lote contiene
solo 1 o 4 muestras respectivamente; no representa una distribución independiente
amplia de arranques fríos. El resultado inicial permanece visible aunque una
optimización posterior mejore la latencia.

Medición posterior a la corrección, preservada en
`.local/reports/imp-03/run-performance-optimized.json`: 100/100 respuestas 201
SUCCESS, cero fallos y limpieza verificada. El control Docker usa IPC local;
los controles de autorización, cuotas y recursos siguen activos. Runner
`imp-03-quickjs.3`, imagen
`sha256:fe5d20796778a8ab843fcddfaeb074c75e63ec30f145f9dda9888ebd476f2689`,
sin cambios durante el ensayo.

| Perfil optimizado | Muestras |  p95 total | Primer lote | Lotes siguientes | Objetivo <5 s |
| ----------------- | -------: | ---------: | ----------: | ---------------: | ------------- |
| Secuencial        |       50 | 1710,70 ms |   929,99 ms |       1710,70 ms | Cumple        |
| Concurrencia 4    |       50 | 3616,73 ms |  1860,43 ms |       3616,73 ms | Cumple        |

La primera repetición integrada en CI también aprobó 100/100 respuestas sin fallos ni
cápsulas restantes. P95: 1374,73 ms secuencial y 2360,55 ms con concurrencia
cuatro; primeros lotes 1135,91 ms y 1871,33 ms respectivamente. La reconstrucción
de CI produjo la imagen
`sha256:85cc40d6a330a230414941883992d9563cc1e60236a2c751bdbed9fe956159f3`,
que permaneció fija durante esa medición. Informe:
`.local/reports/imp-03/run-performance-ci-first.json`. Se conservan esas tres corridas,
sin seleccionar muestras ni ocultar el incumplimiento inicial.

La medición de cierre, registrada a las 21:30:29 UTC, aprobó nuevamente las
100/100 solicitudes, sin errores y con limpieza confirmada. Su informe es
`.local/reports/imp-03/run-performance.json`; utilizó el mismo perfil local y
la imagen `sha256:5f089ad79fb97f3a1f997dd68f3969af2851751cdb54ee488b04aa4b7df802c0`,
sin cambios durante la medición.

| Perfil de cierre | Muestras |  p95 total | Primer lote | Lotes siguientes | Objetivo <5 s |
| ---------------- | -------: | ---------: | ----------: | ---------------: | ------------- |
| Secuencial       |       50 | 1716,08 ms |  1716,08 ms |       1626,81 ms | Cumple        |
| Concurrencia 4   |       50 | 3580,48 ms |  2207,50 ms |       3580,48 ms | Cumple        |

La primera corrida Chrome completó 28/29 escenarios: los 24 anteriores y
IMP03-02–05 pasaron. IMP03-01 no produjo POST tras Tab/Enter. Se investigó la
revalidación al cambiar el foco y se añadió la espera de foco y botón
habilitado conservando Tab/Enter nativos. Resumen y log saneados preservados en
`.local/evidence/imp-03/e2e-initial-28-of-29.*`.

La primera CI completa aprobó 12 etapas, incluidas 326 pruebas Jest en seis
grupos, pero volvió a terminar en 28/29 Cypress por la activación de teclado
IMP03-01. La nueva regresión de renovación de sesión IMP03-03 sí pasó contra
servicios reales. Los informes `ci-first.json`, `e2e-first-ci.json` y
`e2e-first-ci-error.log` conservan ese fallo; la espera de foco por sí sola no
resolvió la entrada de Enter.

La reproducción focal confirmó foco correcto y botón habilitado, sin un nuevo
cambio de foco durante Enter: `cy.press` de Cypress 16 emitió keydown/keyup con
`keyCode=0`, pero ningún keypress, click ni POST. El registro saneado es
`.local/evidence/imp-03/keyboard-native-events.json`. El ensayo alternativo con
`.type('{enter}')` emitió un click sin propagación, que no alcanzó el manejador
delegado de React. La corrección del arnés conserva Tab nativo y envía Enter
nativo completo mediante CDP, verificando orden y eventos confiables; además
comprueba el código exacto antes de iniciar RUN. No se agregaron manejadores de
teclado artificiales a la interfaz. Referencias:
[implementación Cypress 16](https://github.com/cypress-io/cypress/blob/v16.0.0/packages/server/lib/automation/commands/key_press.ts)
y [activación de controles en Chromium](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/html/html_element.cc).

La prueba focal de la corrección pasó IMP03-01 en 8171 ms con Chrome
153.0.8010.50 y Cypress 16.0.0, a las 21:12:49 UTC. Verificó Tab y Enter nativos,
el orden keydown/keypress/click con propagación y confianza, código capturado,
respuesta 201, edición concurrente, consola segura y borrador tras recargar.
Informe: `.local/evidence/imp-03/keyboard-cdp-sync-report.json`.

La segunda CI aprobó formato, lint, tipos y 326 pruebas Jest, pero el ensayo
Docker terminó en 68/69. La única falla fue `expired-owned-orphan`: la cápsula
creada con lease ya vencido desapareció antes de la inspección inicial. El
reconciliador de DEV comparte el daemon y puede retirarla legítimamente durante
la preparación del ensayo. El barrido focal contó cero retiros y las cápsulas
vigente y ajena permanecieron intactas; al terminar no quedaron cápsulas propias.
`ci-second.json`, `runner-ci-second.json` y `ci-second-error.log` conservan esa
carrera del arnés, sin contarla como prueba aprobada.

La corrección conserva el reloj real del reconciliador y permite al ensayo una
observación temporal limitada a IDs exactos de sus propias fixtures. El reloj
controlado exige un ámbito válido antes de acceder a Docker. La regresión real
comprueba además una cuarta cápsula propia, vencida para ese reloj pero fuera del
ámbito: debe permanecer intacta. La aceptación focal pasó 9/9, con un retiro,
GET 404 explícito y cero cápsulas restantes; el grupo unitario del runner pasó
40/40. Evidencia: `.local/reports/imp-03/runner-reaper-scoped.json`.

DEV recibió `20260926193004_practice_runs.sql` y
`20260926195206_practice_archive_guard.sql` mediante `npm run db:migrate`, sin
repetir el seed. Tras compilar la API, su proceso local recargó la configuración;
el smoke HTTP del 26/09/2026 devolvió `201 / SUCCESS` para el alumno y ejercicio
canónicos. Evidencia saneada: `.local/reports/imp-03/dev-smoke.json`.
También se aplicó `20260926201559_practice_recovery_grace.sql` con el mismo
comando, tras aprobar sus 59 aserciones SQL en TEST.
El smoke final de DEV a las 20:59:34 UTC volvió a dar `201 / SUCCESS` con
`imp-03-quickjs.3`; el informe inicial se conserva por separado en
`dev-smoke-initial.json`. Solo se cerró la sesión creada por esa comprobación.

La integración detectó una truncación real de consola al transferir NUL mediante
`getString` de QuickJS. El puente ahora transporta cadenas codificadas con
primitivas JSON conservadas y verifica su presupuesto UTF-8; NestJS sustituye NUL
por `?` al persistir JSONB, sin expandir bytes. Se conservaron las aserciones de
consola y se añadió regresión del intérprete. También se restringió la escritura
directa de claves `practice.run` y la lectura del token de lease por el rol de
aplicación, con pruebas SQL negativas.

La revisión final añadió comprobación de la marca interna de Promise en cada
nodo del retorno: retirar su prototipo no permite convertirla en un objeto JSON.
Las regresiones incluyen promesas anidadas, pendientes y rechazadas, además de
objetos nativos con prototipo modificado. El callback privado consulta QuickJS;
no expone capacidades del anfitrión al programa.

Dos corridas del ejecutor detectaron TIMEOUT intermitente en casos cortos. Se
preservaron sus informes y se instrumentaron por separado el CLI de inicio,
la vida del contenedor y el supervisor confiable. Tres muestras de un programa
controlado de 2800 ms agotaron el plazo del CLI a los 3061–3087 ms, aunque el
contenedor completo vivió 2900–2928 ms. En tres muestras de aislamiento entre
casos, el CLI sumó 1060–1083 ms y el supervisor solo 225–236 ms. El informe
`runner-timing-before.json` conserva esta atribución; contar arranque y retorno
del CLI como tiempo estudiantil generaba un diagnóstico incorrecto.

El supervisor `imp-03-quickjs.3` acumula la medición del puente confiable externo
al worker. Este puente inicia el reloj antes de lanzar el proceso estudiantil y
mata su grupo al vencer el presupuesto restante. El anfitrión conserva la
cancelación operativa de 30 segundos, la limpieza de 10 y la validación de
protocolo, salida y cgroups. El mismo ensayo posterior de 2800 ms obtuvo SUCCESS
con 2851–2903 ms del supervisor aunque el CLI demoró 3127–3294 ms;
`runner-timing-after.json` conserva esas muestras. Un resultado sin evidencia
válida no concede SUCCESS.
