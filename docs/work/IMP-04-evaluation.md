# IMP-04.07 y preparación ejecutable de IMP-04.08

Fecha de inicio: 2026-10-01. Cierre local: 2026-10-02.

Estado: **IMP-04.07 implementado y probado localmente; IMP-04.08 preparado para ejecución, con el arnés completo probado en TEST**.

El corte autorizado amplía la verificación adversaria de ayuda y prepara cuatro etapas recuperables: ingestión, calibración, recorrido funcional y evaluación. Las pruebas de esta entrega utilizan exclusivamente servicios reales de TEST y proveedores controlados. Azure, el rendimiento remoto y la aceptación docente/CAPSTONE quedan pendientes.

Se preservan los cambios de práctica, materiales y ayuda existentes. El registro inicial contiene 42 escenarios Cypress aprobados y una corrida histórica de CI fallida por latencia SUBMIT; ese fallo no se reinterpretará como éxito. DEV y servicios ajenos estaban activos al iniciar y no pertenecen a esta tarea.

## Resultado del cierre local

La tercera corrida de `npm run ci:verify` terminó aprobada el 02/10/2026 a las 04:14:41 UTC, con Node 24.21.0 y npm 11.19.0. Sus 17 etapas pasaron; los dos fallos anteriores y las repeticiones focales permanecen en el historial.

| Comprobación ejecutada                                            | Resultado                                                                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Formato, lint, tipos, OpenAPI, compilaciones API/web y artefactos | Aprobados                                                                                                                 |
| `npm test`                                                        | 985 pruebas aprobadas en seis grupos                                                                                      |
| Preparación, diagnóstico y ensayo Docker; ejercicios canónicos    | Aprobados                                                                                                                 |
| Integración de producto                                           | 146/146 casos HTTP y 471 aserciones SQL en diez archivos; recuperación y caída física de PostgreSQL aprobadas             |
| Integración IA/pgvector                                           | 27/27, con caída y recuperación de base; proveedor sintético explícito                                                    |
| Cypress completo                                                  | 45/45 en Chrome 154; cero fallos, pendientes u omitidos                                                                   |
| Registro contable                                                 | Diez controles aprobados con dos procesos y cero llamadas a proveedores                                                   |
| Arnés de cuatro etapas y reanudación                              | Aprobado: 85 intentos preparados, 45 materiales, 43 casos cubiertos, 234 ayudas y 763 recibos; sin duplicados al reanudar |

La corrida final es `73005846-0021-40b8-b54c-7ebeacbcb3a6`, de origen TEST y con **cero llamadas externas**. Los 43 casos se acreditan como 30 recorridos de ayuda, doce candidatos de revisión (siete rechazados en la frontera y cinco revisados por el proveedor controlado) y la prueba determinista de UNKNOWN, identificada mediante su resultado Jest y SHA-256. Esto acredita contratos y fronteras locales; no resistencia semántica de Azure ni calidad pedagógica.

El fingerprint del candidato ejecutado es `3fa2eca764c2834c0aca1524ef154d1ca6b6ecc2076a833bfb14db2a3506bb54`; el corpus efectivo tiene hash `3b5f3dffbb3e9b43b4793aca4ddbe4b69588ca3dd328066a72490186a0053e53`. La actualización documental de cierre es posterior a la corrida; una autorización futura debe calcular y aprobar su propio candidato.

| Perfil de ayuda TEST | Muestras correctas | p50/p95 admisión→persistencia | p95 cliente | Fallbacks del perfil |
| -------------------- | ------------------ | ----------------------------- | ----------- | -------------------- |
| Serie                | 100/100            | 532 / 756 ms                  | 932,71 ms   | 0                    |
| Concurrencia cuatro  | 100/100            | 762 / 4.342 ms                | 4.571,43 ms | 0                    |

Las 200 observaciones de cliente están completas. Se mantuvieron las cuotas, el plazo de 15 s y las primeras muestras. Estos percentiles corresponden al proveedor TEST y **no acreditan la meta de rendimiento Azure**.

### RUN, SUBMIT y condiciones del host

RUN pasó 100/100 muestras: p95 de 1.128,95 ms en serie y 1.977,64 ms con concurrencia cuatro. Después de corregir el barrido simultáneo duplicado de los reconciliadores, CI completó estas tres mediciones SUBMIT consecutivas, todas con el mismo perfil e imagen dentro de la serie:

| Cierre UTC | Muestras | p95 serial  | p95 concurrente | Resultado |
| ---------- | -------- | ----------- | --------------- | --------- |
| 03:41:20   | 100      | 2.001,38 ms | 3.714,98 ms     | Aprobado  |
| 03:44:36   | 100      | 1.817,20 ms | 3.418,74 ms     | Aprobado  |
| 03:48:00   | 100      | 1.939,89 ms | 3.477,64 ms     | Aprobado  |

Las 300 respuestas fueron válidas; la limpieza quedó confirmada y ninguna muestra alcanzó 5.000 ms. El máximo fue 4.893,12 ms y se conserva. No se modificaron límites, perfil ni presupuesto del proceso estudiantil. La imagen difiere de CI2 y la anterior ya no pudo inspeccionarse: no se atribuye la mejora a una causa única. Los reportes `submit-investigation-20261002.json`, `submit-verification-20261002.json` y `runner-image-comparison-20261002.json` incluyen hashes de las fuentes y límites de interpretación.

Los seis arranques de esos perfiles tardaron 1.719–3.213 ms. En la corrida final de evaluación, los cuatro arranques/reinicios tardaron 1.498–2.358 ms. El fallo anterior de imports a 30 s permanece documentado; no se demostró su causa ni se añadió un reintento automático. Los contadores globales de CPU, memoria y fases ayudan a investigar, pero no sustituyen una medición de disco, VM o proceso.

### Evidencia conservada y pendientes

Los reportes públicos están en `.local/reports/imp-04/ci.json`, `integration.json`, `e2e.json`, `evaluation-ledger.json`, `evaluation-test.json` y `evaluation-measurements.json`, con copias históricas. Las muestras SUBMIT se conservan en `.local/reports/imp-03-submissions/history/`. El directorio privado `.local/eval-runs/73005846-0021-40b8-b54c-7ebeacbcb3a6` conserva el manifiesto, diario, calibración, recibos y paquete ficticio de revisión; contiene credenciales y no es un artefacto público. TEST quedó detenido con sus datos conservados; no se detuvieron DEV ni servicios ajenos, y no quedaron listeners en 3300/4300/4401 ni cápsulas propias.

Después de actualizar la documentación pasaron `npm run format:check`, `git diff --check` y la comprobación de 229 enlaces locales en los diez documentos afectados. No hubo cambios de código posteriores a la CI aprobada.

Quedan pendientes **Azure real, calibración remota medida, rendimiento remoto, revisión docente y aceptación CAPSTONE**. La preparación de LAB-EVAL está implementada; esta aceptación ejecutó el arnés en TEST, no una instancia Azure. Los campos externos desconocidos del manifiesto siguen pendientes y bloquean la ejecución real. La rúbrica no contiene participantes, valoraciones ni aceptación inventados. IMP-05, RF-017 y despliegue remoto permanecen fuera del corte; Vercel Sandbox IMP-03.07 y operación del worker en Azure Container Apps siguen siendo prioritarios antes de producción.

## Archivos y fronteras

- Datos: migración incremental, RLS, autorización de corridas, bindings y recibos privados; ninguna modificación de diagnósticos, intentos o eventos históricos.
- API: ledger común a proveedores y listener operacional independiente en loopback, sin permisos pedagógicos nuevos.
- IA: corpus adversario ficticio, observaciones de consumo tardías, calibración ligada a evidencia y rechazo de promoción TEST.
- Herramientas: LAB-EVAL aislado (4400/3400/4401 y 194xx), arnés por etapas y diario durable de idempotencia.
- Producto: tres recorridos Cypress adicionales y fallos de dependencias reales.

## Alcance y trazabilidad

RF/HU/CU/PT-006/010/012/013/025; RNF-IA-01–04, CON-01–03, SEG-01/03/05, REN-03/04 y POR-01–03. DEC-004/006/008/010 conserva las decisiones del plan autorizado: cuatro bolsas y techo global, 100 ayudas en serie y 100 con concurrencia cuatro, plazo de ayuda de 15 s, meta documental p95 <12 s y precios/destinos externos pendientes.

La aceptación local completó contratos, HTTP/SQL/RLS, IA, materiales, práctica, 45 recorridos Cypress, ejecución y reanudación del arnés completo en TEST, formato/lint/tipos/build y `ci:verify`. Se registraron tres perfiles SUBMIT consecutivos bajo el umbral vigente, conservando también las muestras fallidas anteriores. No se aumentaron límites ni se atribuye semántica pedagógica a proveedores programados.

## Historial de comandos y resultados

Las notas siguientes conservan el estado de cada ejecución en su momento; sus pendientes locales se resuelven en el cierre anterior. No reemplazan ni reinterpretan los reportes fallidos.

- Inspección de Git, servicios Docker y puertos: ejecutada; cambios anteriores conservados.
- Runtime portable: Node 24.21.0 y npm 11.19.0 comprobados.
- `npm run typecheck`: aprobado en la primera comprobación completa; se repetirá dentro de CI con las correcciones finales.
- `npm run test -w @alunza/api`: 254/254 aprobadas antes de las últimas regresiones de normalización SQL y atestación de configuración.
- `npm run test:preproduction`: 73/73 aprobadas; pruebas adicionales de renovación de sesiones y observación de latencia se verifican separadamente antes de CI.
- `npm run test:help:integration`: los 19 casos HTTP pasaron. La recuperación posterior detectó una fixture que inyectaba `40001` (contención, HTTP 409) cuando pretendía verificar indisponibilidad. Se corrigió a `57014` y se conservan las aserciones HTTP 503, rollback, ausencia de eventos y replay. El conjunto no se declara aprobado todavía.
- Migración: un primer intento falló por ownership al reemplazar `help_claim`; se corrigió con el rol propietario restringido, sin `BYPASSRLS`. La migración posterior se aplicó. Las pruebas SQL completas siguen pendientes.
- `npm run test:ai`: 270/271 pasaron; una lectura de RSS del extractor devolvió `EXTRACTION_UNAVAILABLE` durante actividad concurrente. La repetición focal pasó 28/28. La investigación comparó tres lectores sobre un proceso propio: el primer PowerShell consumió 1.763 ms del watchdog de 2.000 ms. Esto muestra una fragilidad, pero no prueba la causa de todos los fallos anteriores.
- El monitor Windows ahora mantiene un observador externo por extracción. Conserva la primera muestra y frecuencia de 500 ms, watchdog de 2 s, plazo de 30 s y corte de 512 MiB; no atribuye aislamiento del SO al heap. Compilación y 43/43 pruebas focales (28 de extracción, 15 de protocolo/cierre) aprobadas. Evidencia local: `.local/evidence/imp-04-evaluation/rss-monitor-benchmark.json`.
- `npm run help:eval -- --mode plan`: aprobado sin proveedor; informa explícitamente autorización, precios, destino/configuración Azure y fingerprint pendientes. Consumo observado desconocido, sin inventar cero.
- `ci:verify` incorpora el arnés y tres perfiles SUBMIT consecutivos con el mismo umbral. Cada reporte tiene copia histórica; la aceptación requiere la corrida completa, todavía pendiente.
- Implementación y pruebas integradas: en curso. No se han ejecutado llamadas Azure ni despliegues.
- La repetición focal `test:help:integration -- --recovery-only` superó los escenarios de recuperación y alcanzó SQL. El snapshot anterior falló en `evaluation_authorize` por faltar el grant de mantenimiento a `postgres`; la migración actual concede solo esa función y las pruebas SQL quedan por repetir.
- `test:help:evaluation`: los diez controles del ledger pasaron con dos procesos y cero llamadas externas. La preparación posterior creó intentos mediante producto, pero falló una sustitución atómica del journal con `EPERM` en Windows mientras se inspeccionaba ese archivo. Se conserva la corrida fallida; se añade recuperación acotada de la escritura sin repetir operaciones de producto. El arnés completo sigue pendiente.
- Cuatro pruebas offline de seguimiento de calibración aprobadas: el cliente conserva el estado observado y reconoce `FAILED`/`STOPPED` sin esperar el plazo de sondeo ni publicar un artefacto previo tras una parada.
- Formato global aprobado después de estabilizar los archivos. Las correcciones del journal y del reporte aprobaron 31 pruebas offline; las huellas compartidas API/CLI aprobaron 48 pruebas focales. La siguiente corrida TEST superó el ledger y creó 51 intentos de perfiles, pero detectó una expectativa incorrecta de diagnóstico en la fixture de calibración: el código sin retorno produce `RUNTIME_ERROR` en el runner vigente. Se corrige la fixture; no cambia el diagnóstico del producto.
- CI conserva las tres series SUBMIT y las muestras/recibos públicos de evaluación en reportes históricos. Los snapshots pedagógicos, credenciales y checkpoints privados permanecen fuera de los artefactos públicos.
- `npm test`: aprobado completo (920 pruebas: API 261, web 40, contratos 97, runner 101, IA 310 y preproducción 111), con OpenAPI y compilaciones de contratos/runner/IA. Esto incluye la regresión completa del monitor de extracción Windows. Se corrigió la suma anterior de este registro, que decía erróneamente 1.020.
- El arnés TEST preparó 85 intentos y publicó 45 materiales, pero la calibración agotó el sondeo después de guardar sus cuatro recibos. El diagnóstico transaccional confirmó PostgreSQL `42883`: la comparación de vectores no resolvía el operador bajo `search_path=pg_catalog`. Se corrige calificando el operador, sin ampliar el search path ni repetir los embeddings ya guardados. Todavía falta la corrida completa del arnés y CI.
- La nueva corrida volvió a publicar los 45 materiales, pero falló el reinicio del consumidor. La instrumentación posterior conservó tres arranques: fallo a 30.231 ms durante imports, éxito a 11.485 ms y éxito a 2.351 ms. Una traza caliente terminó en 1.027 ms; no permite atribuir una causa concreta al bloqueo intermitente. Se mantienen 30 s y cero reintentos de arranque. Los reportes incluyen fases, memoria y contadores CPU; Windows expresa la carga media no disponible como `null`.
- Sobre esa base conservada, la calibración y el recorrido funcional completaron sus 4+12 llamadas TEST con el mismo presupuesto; los recibos pasaron de 45 a 61. Es un diagnóstico, no una aceptación del candidato: los cambios de instrumentación y la copia del journal quedan identificados en `.local/eval-diagnostics/` y los reportes originales no se sustituyen.
- Instrumentación TEST de arranque: 5/5 pruebas offline aprobadas. La revisión previa de Cypress corrigió un interceptor que esperaba `/runs` cuando la ruta real es `/executions`; todavía se requiere ejecutar los 45 recorridos.
- La corrida `15766be8-9273-4d35-adc0-e74fdc457c5b` completó las cuatro etapas, la reanudación sin duplicados, 234 ayudas guardadas y 763 recibos. Los perfiles alcanzaron 100/100 en serie y 100/100 con concurrencia cuatro; p95 admisión→persistencia: 745 ms y 3.075 ms. Son mediciones con proveedor TEST, no rendimiento Azure.
- Su cierre automático falló al interpretar el JSON de Jest: una suite ejecutada con filtro figura como `focused`, aunque la aserción requerida haya pasado. El parser acepta ahora únicamente `passed/focused` con éxito global, cero fallos, contadores positivos y la aserción exacta aprobada. Se verificó la evidencia real: 43/43 casos, desglosados en 30 ayudas, 12 candidatos y una prueba local determinista de UNKNOWN. Las 46 pruebas focales del comprobador pasaron. El fallo original se conserva junto con el reporte adicional `evaluation-completeness-recheck-15766be8-9273-4d35-adc0-e74fdc457c5b.json`; falta que la corrida completa de CI cierre automáticamente con esta corrección.
- La invocación focal de Jest usa la misma opción `--experimental-vm-modules` que la suite API. El intento anterior que omitía esa opción falló antes de los proveedores y queda conservado.
- La primera corrida integrada de `ci:verify` aprobó formato, lint, tipos, las 972 pruebas actuales, preparación/diagnóstico/ensayo Docker, fixtures académicas y Cypress instalado. Falló la etapa HTTP con 138/146 aprobadas: ocho casos de entrega de invitaciones agotaron la espera. La revisión encontró que el proxy TEST de Storage rechazaba las rutas Auth al sustituir la URL Supabase global. Se corrige el proxy TEST para conservar Auth real; no se altera el contrato de invitaciones ni se amplían plazos. SQL/recuperación, rendimiento, E2E y el cierre del arnés siguen pendientes en CI.
- La base conservada confirmó nueve entregas `FAILED/AUTH_UNAVAILABLE` después de tres intentos. El proxy corregido pasó 10 pruebas offline de tránsito Auth, fallos de Storage y rechazo de rutas/orígenes ajenos. Dos flujos reales de identidad pasaron sin reconstruir la base: invitación nueva y cuenta existente con OTP, correo Mailpit, canje y aceptación. Evidencia: `.local/evidence/imp-04/invitation-proxy-verification.json`. Se repite CI completo; esa verificación focal no sustituye sus 146 casos HTTP.
- La segunda corrida de `ci:verify` aprobó los controles estáticos, 982 pruebas, ensayos Docker, fixtures, los 146 casos HTTP y 471 aserciones SQL, recuperación e indisponibilidad física de PostgreSQL. RUN aprobó 100/100 muestras (p95 1.285/2.182 ms). SUBMIT aprobó las dos primeras series (p95 secuencial/concurrente: 1.996/3.704 ms y 2.055/3.593 ms), pero la tercera falló: 2.689/5.871 ms frente al límite de 5.000 ms. Las 300 respuestas fueron válidas, con limpieza confirmada y la misma imagen/perfil. No se cumplió la condición de tres aprobaciones consecutivas; CI se detuvo y conserva todas las muestras.
- El pico de esa tercera serie se concentra en cuatro solicitudes calientes consecutivas (índices 44–47), principalmente dentro del ciclo Docker. La CPU global observada subió del 85–86 % al 90 %; la memoria libre del perfil cayó de 7,37 a 7,20 GiB. Los arranques no explican el pico y no hay evidencia suficiente para atribuirlo a CPU, disco o una operación Docker concreta. La inspección encontró barridos de huérfanos duplicados de RUN/SUBMIT cada 15 s; se comparte únicamente el barrido en curso, conservando el siguiente barrido, los fallos y el plazo de limpieza. Esa corrección no acredita por sí sola causalidad ni rendimiento: requiere regresión y nueva serie completa.
- El análisis reproducible está en `.local/reports/imp-04/submit-investigation-20261002.json`, con hashes SHA-256 de las tres fuentes, fórmulas, las 300 muestras y límites de interpretación. El fallo histórico del 27/09 usa otra imagen Docker: no constituye una comparación controlada del rendimiento del candidato actual.
- La primera regresión completa Cypress de este corte terminó con 44/45 recorridos aprobados. Los siete de ayuda, incluidos los nuevos `IMP04-08/09/10`, pasaron. `IMP04-03` falló al comprobar el archivo de un material después de ocultarlo; se conserva el resultado y se investiga antes de repetir la aceptación completa.
- El fallo Cypress fue una espera imprecisa: la generación anterior todavía válida satisfacía `Completado` mientras se reindexaba. Al terminar la nueva generación cambiaba la revisión y el archivo recibía `412`. La prueba espera ahora el ID exacto del trabajo admitido y exige `200/ARCHIVED` además del estado visible y la consulta posterior. Los tres recorridos de materiales pasaron en la repetición focal, sin ampliar plazos ni quitar aserciones. La corrección del barrido pasó tipos, lint y 19 pruebas de adaptación/reconciliación. La tercera corrida completa de CI comprobará conjuntamente estas correcciones.
