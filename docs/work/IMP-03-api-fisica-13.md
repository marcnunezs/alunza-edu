# IMP-03 · API y persistencia con VM física para el candidato .13

Estado al 17/11/2026: integración local implementada y verificada con API, Auth, PostgreSQL y KVM reales en el Ryzen. La campaña HTTP completó 40/40 muestras normales y nueve gates funcionales; p95 RUN **4597,111313 ms** y SUBMIT **4389,107517 ms**, ambos estrictamente menores a 5000 ms. También pasó la recuperación de un resultado staged tras matar y reiniciar la API. Este corte continúa la [validación física del runner .13](IMP-03-candidato-fisico-13.md), conserva sus límites y acredita el recorrido local secuencial; no acepta navegador, carga concurrente, red pública ni el RNF-REN-02 completo.

## Alcance y artefactos

La API de dominio sigue siendo NestJS. `local-vm` es un proveedor exclusivo de laboratorio local/TEST; el broker usa un socket Unix privado y bases inmutables residentes con sellos. Cada admisión nueva exige una VM y una cápsula nuevas, una sola VM simultánea, VM de 1 CPU/2 GiB, supervisor de 128 MiB y cápsula estudiantil de 128 MiB, 3000 ms acumulados, 65536 bytes y swap cero. No cambia AD-ARQ-001 ni se incorpora este broker al despliegue productivo.

El runner conserva versión `imp-03-quickjs.13`, imagen `sha256:1f12d0fb7fb18f6e2668669b3b5da37be47fcc71120f7579dbe32155ad5846b0` y digest de fuente quality `4782224f79163235b3f554b140b2ca40750b51b42dc61695964f7fca3f788fa3`. Los hashes de API, broker, guest y kit de integración son identidades adicionales: no se atribuyen al kit físico anterior. El protocolo rechaza pins ausentes o una imagen/versión distinta de `.13`.

El kit API tiene manifiesto `431241339773326e5df1f66614e5dad709c471cd9d2abe87b9e27f3a1cf020d8` y guest `dc4ceadd3ed793933c835482ab86ddf8b6a763cf4b336eea2c4fd7977c914ded`. El broker congelado es `88de62a99574e8f3d92bf30f71795efd0c5b570bcfbec3ac94a1224409643a76`. El paquete instalado contiene 589 archivos; su manifiesto es `c085ddbfeea2744ef2c02c991f76f8c10e0123ec47b34df13b8caf952368f254` y `apiSourceDigest=177dbc8388c14c1493a69bf8bc0ddf6bb6e7b29e9f36046492d531f002abe2ae` identifica el inventario ordenado de fuentes de ese paquete, separado del digest quality del runner congelado. El protocolo HTTP fija estas identidades antes de ejecutar; los resultados siguientes pertenecen a este conjunto.

## Campaña y reloj

[linux-vm-api.mjs](../../tests/integration/linux-vm-api.mjs) ejecuta 40 muestras normales secuenciales: 20 RUN de ocho casos visibles y 20 SUBMIT de dos visibles y seis ocultos. Alterna modos y rota ocho estudiantes reales de dos organizaciones y tres clases; mantiene cuotas normales, con espera de cliente antes de enviar cuando corresponde. No modifica cuotas del servidor.

`durationMs` usa `performance.now()` del cliente desde el despacho de `fetch` hasta consumir el último byte HTTP. Incluye la comprobación JWT/sesión y permisos en la API, admisión, VM/cápsulas, persistencia y entrega de la respuesta. El login de Supabase Auth ocurre antes de la campaña y se declara fuera de este reloj. La espera de cuota se registra aparte. Validación JSON, escritura de evidencia y consultas de auditoría posteriores tampoco se suman a la latencia HTTP.

El protocolo se escribe antes de las solicitudes e identifica fixtures y hashes de código/pruebas. Los gates funcionales anteceden a las muestras normales: la API está caliente. Se conserva la primera muestra normal, todos los fallos y todas las muestras lentas. No se vacía la caché de páginas del host ni se atribuye arranque frío del sistema.

Por modo, p95 es el rango más próximo superior, posición 19 de 20 muestras ordenadas. Una campaña incompleta no produce un p95 aprobatorio. El criterio exige 20/20 resultados válidos, persistencia/retiro comprobados y p95 estrictamente menor a 5000 ms; exactamente 5000 falla. Los dos modos se informan por separado. Esta muestra es local y pequeña: no acredita navegador, red pública, carga concurrente ni garantía temporal absoluta.

El inicio del broker y la lectura/verificación/sellado de bases residentes deben conservar un recibo separado. La variante `resident-sealed-bases` no puede ocultar ese coste ni presentarse como una VM preparada reutilizada. El desglose privado de API se correlaciona por `requestId`/`executionId`; no se restan relojes del cliente, API y huésped entre sí ni se suman fases solapadas. La autoridad de los cinco segundos sigue siendo HTTP final-byte.

## Gates funcionales y durabilidad

Antes de las 40 muestras se requieren nueve gates, separados de sus percentiles:

- RUN y SUBMIT: replay idéntico por clave; conflicto 409 si cambia el código. Las repeticiones no añaden registro de creación ni arranque QEMU.
- RUN y SUBMIT: rechazo sin admisión para otra clase, otra organización o ausencia de autenticación. SUBMIT comprueba además lectura del intento y rechazo de lectura ajena.
- RUN y SUBMIT: fallo focal del commit mediante un trigger limitado al actor, operación y clave. Se retira el trigger en `finally`; se comprueban rollback y recuperación de la misma ejecución sin otra VM. RUN recupera UNKNOWN/FAILED; SUBMIT conserva el resultado ya staged, con TIMEOUT del fixture de bucle. No se inventa un éxito posterior.
- RUN y SUBMIT: desconexión de transporte después de observar un arranque QEMU real. Se espera cierre durable y replay de la misma identidad sin reejecutar. La desconexión HTTP no significa una cancelación del trabajo; no se atribuye un endpoint de cancelación inexistente.
- SUBMIT: el fixture emite un marcador sólo durante los seis casos ocultos. La proyección pública estricta debe conservar el resultado sin revelar marcadores, identificadores ocultos, pruebas privadas o tokens.

[linux-vm-observer.mjs](../../tests/integration/linux-vm-observer.mjs) observa PostgreSQL y `/snapshot` del broker. Exige aplicación bajo `alunza_app`, sin superusuario ni BYPASSRLS; reconsulta la proyección durable con ese rol y contexto del estudiante. Comprueba identidad de ejecución/intento, hash del código y resultado técnico, versión de pruebas, resultados ocultos privados y una prueba de retiro ligada a creación/boot/contexto.

`receiptSha256` es el SHA-256 del JSON canónico de `cleanup_proof`, no el hash del resultado completo ni de un reporte de VM. `vmCreationsTotal` cuenta arranques QEMU observados; `creationRecordsTotal` cuenta también preparaciones del broker. Cada admisión nueva exige delta uno en ambos; replay, conflicto y permisos exigen delta cero. Un recurso activo, incierto o una generación del broker cambiada detienen nuevas solicitudes.

## Preparación y reproducción

Se requiere el stack TEST existente, migrado y sembrado, con Auth `127.0.0.1:18421`, PostgreSQL `127.0.0.1:18422` y API `127.0.0.1:4300`; workers de recuperación operativos, proveedor `local-vm` y broker/kit verificados. Los helpers no instalan dependencias ni arrancan servicios al importarse. El destino previsto usa credenciales TEST nuevas y debe comprobar todos los bindings antes de admitir solicitudes. El ensayo SQL de Lenovo detectó y retiró un primer arranque con bindings fuera de loopback; el pase final no publicó puertos.

[linux-vm-fixture.mjs](../../tests/integration/linux-vm-fixture.mjs) añade seis actividades propias a las clases canónicas. Cada campaña tiene UUIDs nuevos; no altera el fixture canónico de dos casos. Al terminar sólo cierra sus actividades, conservando operaciones, intentos y evidencias. El pool administrativo sirve exclusivamente para preparación, observación y faults de TEST; las solicitudes atraviesan la API y su rol limitado.

El wrapper local de operación está en [http-campaign.mjs](../../.local/preproduction/imp-03-07/physical-api-13-20261117/http-campaign.mjs), preparado para `/home/alunza/laboratorio/physical-api-13-20261117`. Su secuencia es `setupLinuxVmFixture` → `loginLinuxVmActors` → `createLinuxVmObserver` → `runLinuxVmApiCampaign` → cierre de actividades y pools. Debe ejecutarse explícitamente con una etiqueta nueva; un directorio de salida existente se rechaza para preservar evidencia.

Cada salida contiene `protocol.json`, `requests.jsonl` y `summary.json`. Conserva hashes, tiempos, identidades y códigos de falla allowlisted; no incluye código estudiantil, cuerpos HTTP, tokens ni SQL. El fixture privado y logs operativos se conservan aparte con permisos restringidos y no forman parte de un resumen público. Ante un gate fallido no se completa artificialmente la muestra ni se eliminan sus filas.

## Transporte físico ejecutado y fallos conservados

QEMU 8.2.2 del Ryzen arrancó desde las bases memfd selladas. Dos ejecuciones nuevas completaron ocho casos, con identidad de VM distinta, replay sin otra VM y retiro verificado:

| Modo   | Casos                  | Tiempo estudiantil acumulado | Preparación, ejecución y retiro por UDS |
| ------ | ---------------------- | ---------------------------- | --------------------------------------- |
| RUN    | 8 visibles             | 694,138970 ms                | 4608,516928 ms                          |
| SUBMIT | 2 visibles + 6 ocultos | 731,170024 ms                | 4304,535730 ms                          |

Son dos muestras de transporte; no incluyen API de dominio, Auth ni PostgreSQL y no producen un p95. El arranque/verificación/sellado del broker se registró por separado: 6414,270 ms iniciales y 5812,242 ms en el primer arranque corregido. Los reinicios posteriores también conservan sus recibos; no se suma o resta ese coste al reloj HTTP.

Otras cinco VMs pasaron las comprobaciones de resultado, limpieza y el **validador real de la API compilada en el Ryzen**: bucle (`TIMEOUT`, 2955,988717 ms), tiempo acumulado (`TIMEOUT`, 2954,220309 ms), memoria heap (`MEMORY_LIMIT`, 471,970300 ms), ArrayBuffer (`MEMORY_LIMIT`, 270,064719 ms) y exceso acumulado de salida (`OUTPUT_LIMIT`, 65536 bytes cobrados). Las entradas, tiempos observados y evidencia no se recortaron para aprobar. [Resumen privado de estas cinco pruebas](../../.local/preproduction/imp-03-07/physical-api-13-20261117/transport-adversarial-summary.json).

La interrupción física por `SIGKILL` del broker tras observar QEMU también pasó: el guardian terminó la ejecución, retiró sus recursos y conservó el resultado. Después de esperar su salida comprobada y reiniciar el broker, `/status` recuperó el mismo recibo y `/start` rechazó la generación anterior, sin una segunda VM. El cierre observado fue 4608,070742 ms. Este ensayo prueba recuperación del transporte, no reinicio/reconciliación de la API. [Recibo de interrupción](../../.local/preproduction/imp-03-07/physical-api-13-20261117/broker-crash-test.json).

Se preservaron los fallos previos y se añadieron regresiones que los reprodujeron:

- Un primer smoke envió fechas fraccionarias desde Python. El huésped exigía milisegundos enteros y no llegó a READY; el guardian retiró QEMU al vencer el plazo original. El broker ahora rechaza esos valores antes de reservar o arrancar.
- La lectura de pipe producía `bytearray`, mientras el parser estricto esperaba `bytes`; el segundo arranque fue rechazado con `FRAME_TOO_LARGE`. Se convirtió el frame explícitamente, con regresión de pipe real fragmentado.
- El primer ensayo de caída intentó reiniciar tras una espera fija de 150 ms y el proceso nuevo salió sin READY. Se conserva ese arranque fallido; la repetición esperó la salida real del guardian por pidfd, sin ampliar plazos.
- El controlador privado capturó una vez `cmdline` vacío durante el arranque. Rechazó detener ese PID por identidad incompleta. Se verificaron PID, ticks, ejecutable y argv completos antes de refrescar el registro; los nuevos arranques registran la identidad después de READY. No se señalizó un proceso sin verificarlo.

La auditoría final contó 11 VMs iniciadas: nueve terminales completos y dos fallidos; esto incluye las dos variantes de interrupción. Quedaron cero procesos propios de VM/broker/guardian y scratch vacío. Los hashes de las bases nuevas y del kit `.13` original coinciden. El broker quedó detenido, con las marcas durables preservadas. [Auditoría física](../../.local/preproduction/imp-03-07/physical-api-13-20261117/transport-final-audit.json).

El respaldo del kit contiene nueve miembros (tres bases, manifiesto y cinco fuentes de transporte), 418217556 bytes, SHA-256 `fe87746414821661539e45d10d1c8a307fa46491af01b98cdc0200c7ae6ed400`. Los 76 archivos de evidencia se respaldaron por separado. Ambos archivos y cada miembro se verificaron nuevamente en Lenovo. [Verificación de respaldos](../../.local/preproduction/imp-03-07/physical-api-13-20261117/backup-verification.json).

## Verificación y pendientes

Validación SQL real en Lenovo, 17/11/2026: **25 archivos / 1701 aserciones pgTAP PASS**, incluidas las 37 aserciones de SQL025 y las regresiones SQL023/024. PostgreSQL 17.6 confirmó la migración `20261117230000`; `alunza_app` conserva superusuario/BYPASSRLS desactivados. El pase final usó exclusivamente PostgreSQL y pg_prove fijados, red interna propia y ningún puerto publicado. Los contenedores/redes del pase fueron retirados, con recursos preexistentes intactos y volúmenes propios preservados. [Recibo y procedencia local](../../.local/preproduction/imp-03-07/physical-api-13-20261117/sql-lenovo/README.md). Este pase no ejecutó API ni VM y no se atribuye a Ryzen.

Los [tests offline focales](../../tests/preproduction/linux-vm-api.test.mjs) verifican percentiles con fallos, rechazo de cinco segundos exactos, campaña incompleta, fixtures de ocho casos, pins `.13`, rol restringido, proyección oculta, identidad durable y contadores del broker. Son comprobaciones del arnés sin red, DB o VM; no sustituyen la campaña física.

Build, tipos, lint y formato focal de API pasaron, junto con 146 pruebas Jest de siete suites. El transporte añadió 20 pruebas Python Linux (memfd/pidfd/UDS/procesos reales sin VM) y dos Node; el arnés HTTP tiene nueve pruebas offline. La inspección de 45 artefactos públicos no encontró credenciales privadas. El gate global de formato se lanzó durante la edición y se detuvo antes de sus probes; también señaló `cypress.config.cjs` preexistente, que no se modificó. Los focos nuevos quedaron formateados; no se acredita CI completa.

El usuario completó la instalación local de Docker; una conexión SSH nueva verificó Docker 29.1.3 y pertenencia al grupo. Se iniciaron cinco servicios TEST con todos sus puertos publicados en loopback, migración `20261117230000`, seed y Supabase Auth ES256 reales. La API trabajó bajo `alunza_app`, sin superusuario ni BYPASSRLS. Node 24.21.0 y Supabase CLI 2.101.0 permanecieron fijados. Docker aloja los servicios de control; los programas estudiantiles continúan dentro de una VM KVM nueva por admisión.

## Resultado HTTP completo en Ryzen

Campaña `http-01`, variante `resident-sealed-bases`: 63 filas HTTP conservadas, 23 funcionales y 40 normales. Los nueve gates pasaron. Las dos desconexiones deliberadas conservan `responseComplete=false` y `transportAborted=true`; no se mezclan con los percentiles normales. Las 40 muestras normales completaron ocho casos y persistencia/retiro verificados, sin fallos ni descartes.

| Modo                           | Muestras | p50 HTTP       | p95 HTTP       | Máximo HTTP    | Resultado |
| ------------------------------ | -------- | -------------- | -------------- | -------------- | --------- |
| RUN, 8 visibles                | 20/20    | 4551,060545 ms | 4597,111313 ms | 4601,619539 ms | PASS      |
| SUBMIT, 2 visibles + 6 ocultos | 20/20    | 4356,269123 ms | 4389,107517 ms | 4412,155806 ms | PASS      |

El reloj incluye autorización, ejecución, retiro, persistencia y último byte de respuesta sobre loopback; login previo y espera del cliente por cuota quedan fuera, como declara el protocolo. La API está caliente y las bases residentes verificadas, pero cada admisión genera una VM nueva. El arranque del broker `broker-06` costó **4413,136 ms** y el de `api-01`, **1038,543 ms**, registrados fuera del reloj de solicitud. No se reutilizaron VMs ni se ampliaron límites.

La campaña añadió **47 VMs**: 40 normales y siete ejecuciones funcionales. Replays, conflictos y rechazos no crearon otra VM. El contador total del broker pasó de 11 a 58; las 11 anteriores pertenecen a los ensayos de transporte descritos arriba. Hubo 49 observaciones durables: las solicitudes iniciales y sus replays de RUN y SUBMIT observan dos veces las mismas operaciones; no son 49 ejecuciones nuevas. [Protocolo](../../.local/preproduction/imp-03-07/physical-api-13-20261117/http-review/protocol.json), [filas conservadas](../../.local/preproduction/imp-03-07/physical-api-13-20261117/http-review/requests.jsonl) y [resumen](../../.local/preproduction/imp-03-07/physical-api-13-20261117/http-review/summary.json).

La [revisión independiente](../../.local/preproduction/imp-03-07/physical-api-13-20261117/http-review/review.json) recalculó percentiles, identidades y contadores desde los archivos retenidos y correlacionó **320 eventos de fases API** por requestId. El p95 de `execute` fue 4298,045399 ms RUN y 4297,664332 ms SUBMIT; el tiempo estudiantil acumulado tuvo p95 de 696,092271/696,113131 ms, en el reloj del runner. No se restan estos relojes para fabricar un coste residual.

| Fase API, mediana               | RUN         | SUBMIT      |
| ------------------------------- | ----------- | ----------- |
| Autorización inicial            | 99,092 ms   | 9,589 ms    |
| Admisión                        | 79,566 ms   | 27,889 ms   |
| Ejecución mediante el proveedor | 4257,718 ms | 4254,993 ms |
| Guardado staged                 | No aplica   | 9,531 ms    |
| Finalización                    | 16,453 ms   | 17,927 ms   |
| Autorización final              | 91,628 ms   | 16,932 ms   |

Estas medianas describen fases separadas, no una suma de percentiles ni un nuevo reloj de aceptación. El tramo dominante continúa siendo la ejecución mediante el proveedor. El margen observado frente a 5 s permite avanzar al recorrido real de interfaz; esta serie no requiere ampliar recursos ni eliminar controles de autorización/persistencia.

### Recuperación tras reiniciar la API

El gate adicional `restart-01`, excluido de la latencia normal, provocó un fallo de commit focal después de guardar un resultado `TIMEOUT` y retirar su VM. Se restauró el trigger y se verificó que aún no existía un intento final. El operador terminó `api-01` mediante `SIGKILL` y arrancó `api-02` con admisiones deshabilitadas. Se acreditó la retirada del PID anterior y la identidad del proceso nuevo.

La reserva continuó staged tras el reinicio. Se venció únicamente su lease de TEST para activar el reconciliador y éste guardó **un solo intento**, conservando los hashes del resultado técnico y privado, la ejecución, creación, boot UUID y prueba de retiro. Dos replays devolvieron exactamente el mismo dato; una clave nueva recibió 503 sin admisión ni VM. El gate añadió una VM y dejó el total histórico en 59. Acredita recuperación de un resultado ya staged, no recuperación automática del resultado del broker antes de stage. [Recibo del gate](../../.local/preproduction/imp-03-07/physical-api-13-20261117/http-review/restart-verify-receipt.json).

### Auditoría final, recuperación de PostgreSQL y respaldo

La auditoría SQL de solo lectura comprobó **48 recursos y reservas completados**, 25 intentos distintos, 25 resultados privados y 50 eventos: uno `ATTEMPT_SUBMITTED` y uno `EXECUTION_COMPLETED` por intento. Quedaron cero reservas en curso, limpiezas pendientes o triggers/funciones de fault; las 12 actividades propias se cerraron. Cada recurso correlaciona con la creación y boot UUID del broker. Los 59 arranques históricos quedaron cerrados, con cero recursos activos/inciertos y scratch vacío.

Se conservan dos incidencias del cierre operativo, posteriores a las mediciones:

- El primer auditor detuvo API y broker, verificó los hashes de ambos kits y detuvo los cinco contenedores. Su comparación de stdout de Docker falló: `--time` emitió un aviso de deprecación antes del ID. Se reprodujo ese aviso sobre un contenedor ya detenido y se cambió el control posterior a `--timeout` e inspección de estado. En ese primer cierre PostgreSQL y Kong terminaron con 137, sin OOM, y PostgREST con 255; no se califican como cierres limpios.
- Se reiniciaron únicamente los cinco servicios propios y se verificaron los mismos recursos, intentos, resultados y eventos tras recuperar PostgreSQL. `pg_ctl` logró un apagado normal, pero la política de reinicio del contenedor lo volvió a arrancar. El cierre definitivo deshabilitó temporalmente esa política, ejecutó el apagado `fast`, observó salida **0** y el mensaje de base detenida, marcó parada manual y restauró la política original. No se inició la API ni otra VM durante esta reparación.

El [recibo definitivo](../../.local/preproduction/imp-03-07/physical-api-13-20261117/http-evidence/http-final-audit-completion.json) conserva ambos antecedentes y acredita cero procesos propios, API/broker detenidos, cinco contenedores detenidos y sus volúmenes/red preservados. Docker del anfitrión permanece disponible. El kit de integración y el kit `.13` anterior conservaron sus hashes. [Auditoría SQL](../../.local/preproduction/imp-03-07/physical-api-13-20261117/http-evidence/http-final-sql-audit.json).

Un diagnóstico operativo seleccionó por error los scripts expandidos de entrada de los contenedores y mostró material privado de TEST, incluida una clave TLS del stack local. Se corrigió el inspector y se reemplazó ese archivo por metadatos; el diagnóstico original queda excluido del respaldo. La comunicación ensayada fue HTTP sobre loopback. Las claves de esa instalación de TEST no deben reutilizarse para exposición externa; no se acredita su rotación.

El respaldo HTTP contiene **268 archivos**, 223857 bytes y SHA-256 `0fc44d15b3c33004a4ead97fffbffee452b4eb55ba96de62ac01954a8be18aaa`. Archivo y cada miembro se verificaron nuevamente en Lenovo. Incluye protocolos, filas, recibos privados, logs, fuentes de control y fallos conservados; excluye runtime de credenciales y claves. Los 589 archivos del paquete instalado siguen coincidiendo con las fuentes locales probadas. [Verificación del respaldo](../../.local/preproduction/imp-03-07/physical-api-13-20261117/http-backup-verification.json).

La meta local de esta campaña está cumplida. Siguen pendientes el recorrido desde navegador, concurrencia y aceptación remota de RNF-REN-02; no se cambió AD-ARQ-001, desplegó ni contrató ningún servicio.
