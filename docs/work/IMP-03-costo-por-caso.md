# Coste por caso y preparación de validación física

Fecha: 17/11/2026, America/Santiago. Incremento local solicitado por el usuario:
identificar y reducir el coste para completar ocho casos, sin ampliar límites,
y preparar la validación en Linux físico. No autoriza despliegues ni contratación.

## Alcance y aceptación

Afecta RF/HU/CU/PT-009/010/011, RNF-REN-02, RNF-SEG-04,
RNF-CON-01/04 y DEC-003/004/007/008. Se preservan AD-ARQ-001, una cápsula
nueva por caso, 128 MiB agregados, swap cero, pids 32, 3000 ms acumulados,
65536 bytes de salida combinada y entorno exterior de 1 CPU/2 GiB.
El reloj vigente incluye el tramo desde interpretar la entrada en el puente
hasta observar el cierre del trabajador; este incremento no lo descuenta.

La aceptación local exige ocho resultados correctos, presupuesto acumulado
menor a 3000 ms, controles efectivos de cada cápsula y limpieza
verificada. Se mantienen los rechazos, las pruebas ocultas, las proyecciones
públicas y los casos de agotamiento. Una mejora del tiempo del programa no
demuestra por sí sola el objetivo p95 del recorrido completo ni un corte
físico exacto a 3000 ms.

El punto de partida es el [runner `.11`](IMP-03-limites-watchdog-local.md):
ocho casos triviales agotaron el presupuesto en el quinto/sexto caso. Su
evidencia y sus candidatos congelados se conservan sin modificar.

## Trabajo y comprobaciones

Se inspeccionan worker, puente, protocolo privado, empaquetado y arneses
existentes. Se medirá la inicialización del intérprete y el cierre antes de
elegir la optimización; las marcas del trabajador no conceden éxito ni se
mezclan con el reloj del puente. La comparación utilizará imágenes y fuentes
identificadas, resultados fallidos incluidos y motores privados locales.

La preparación física parte del [arnés de una VM por ejecución](IMP-03-vm-por-ejecucion.md).
La estación disponible es Windows y el laboratorio existente es VirtualBox;
ninguno se presentará como Linux físico. Los artefactos o pruebas que falten
quedarán identificados expresamente.

## Instrumentación y primer descarte

El perfil optativo `case-cost-v1` se selecciona en la imagen confiable. El
worker escribe fases conocidas y acotadas por fd4; el puente conserva su
recepción y cierre. Las fases usan el origen propio de Node y no se restan
del reloj del puente. Una traza parcial no acredita un caso terminado y
ninguna marca concede éxito. `caseCost` se conserva solo en evidencia privada.
`cpu.stat` final incluye el arranque previo del puente: no es una medición
exclusiva del worker ni un delta entre sus fases.

Un microperfil de 96 procesos nuevos, sin ejecutar código estudiantil, comparó
ocho formas de inicializar el mismo WASM. Bajo el entorno exterior de 1 CPU /
2 GiB, las medianas fueron 338,06 ms para la carga original, 356,96 ms para
CommonJS solo y 298,15 ms para CommonJS con pool V8 y tareas de compilación
WASM limitados a uno. Solo ganó 6/12 comparaciones por bloque: era una
hipótesis a comprobar en cápsulas, no una mejora sostenida ni aceptación.

El primer A/B completo conservó ese resultado fallido: baseline RUN/SUBMIT
alcanzaron cuatro casos; el candidato alcanzó cinco/seis. Todos terminaron
por TIMEOUT y se verificó la limpieza. El intervalo entre recibir la última
marca del worker y observar `close` seguía siendo relevante. Se prepararon
dos variantes adicionales para estudiar planificación y terminación sin
alterar el presupuesto; las imágenes y los informes previos se conservan.

El cargador CommonJS usa el subpath público de la dependencia ya fijada y
crea un módulo, runtime y contexto nuevos por caso, sin caché entre intentos.
La personalización de variantes está descrita por
[QuickJS Emscripten](https://github.com/justjake/quickjs-emscripten/blob/main/doc/quickjs-emscripten-core/README.md).
Las implicaciones de los flags se contrastaron con la
[fuente de V8 incluida en Node 24.21.0](https://raw.githubusercontent.com/nodejs/node/v24.21.0/deps/v8/src/flags/flag-definitions.h).
`--single-threaded` implica cero tareas de compilación WASM y desactiva
compilación asíncrona/tiering; no se combina con tareas igual a uno.

El segundo A/B instrumentado también falló: el candidato de un solo hilo
alcanzó seis casos en RUN y SUBMIT. Sus dos repeticiones sin perfil, con el
fixture del smoke previo, alcanzaron seis casos; la variante sin tiering y
con GC de un hilo alcanzó cinco/seis. No se promueve ninguno de esos fallos
a éxito ni se omiten para calcular un percentil. El entorno VirtualBox y su
motor privado se retiraron con cero recursos propios y Docker habitual
intacto; se conserva el archivo `vbox-evidence.tar` con sus recibos originales.

La siguiente comparación usa Ubuntu WSL2 ya existente para distinguir el
coste del entorno. Conserva imágenes, binarios y cuotas, con otro motor
privado; **no es Linux físico ni un ensayo de VM virgen**. La preparación
detectó dos bibliotecas ausentes del daemon antes de admitir código. Se
copiaron desde el laboratorio, con hashes, a un directorio privado; no se
instalaron paquetes ni modificaron bibliotecas del sistema. El fallo y su
recuperación deben permanecer en el expediente.

## Contraste local en WSL2

El motor privado de WSL2 completó el A/B instrumentado y el A/B sin perfil.
Cada brazo ejecutó una muestra cold RUN8 y otra SUBMIT8, con el mismo fixture
que devuelve `{sum:a+b}`. Todos los intentos completaron ocho casos y
verificaron su limpieza. La base también pasó en este entorno: no atribuir
al cambio de código toda la diferencia respecto de VirtualBox.

| Imagen / perfil                                | RUN8, tiempo cobrado | SUBMIT8, tiempo cobrado |
| ---------------------------------------------- | -------------------: | ----------------------: |
| Base instrumentada                             |           1228,42 ms |              1209,75 ms |
| CJS + pool V8 1 + tareas WASM 1, instrumentado |            505,54 ms |               676,23 ms |
| Base `.11`, sin perfil                         |           1233,62 ms |              1131,38 ms |
| Candidato, sin perfil                          |            657,44 ms |               675,43 ms |

En las dos muestras sin perfil, el tiempo cobrado bajó 46,7% y 40,3%.
El tiempo completo hasta limpiar fue 3,861/4,674 s para el candidato y
4,642/4,629 s para la base: la mejora del presupuesto estudiantil no demuestra
una mejora uniforme del ciclo completo. Son dos observaciones por brazo,
no un p95 ni una garantía para programas arbitrarios.

En los 16 casos instrumentados de cada brazo, la mediana parse→close del
puente bajó de 129,85 a 66,68 ms. El tramo entre recibir la última marca y
observar el cierre bajó de 70,30 a 10,81 ms; la inicialización WASM fue
6,07/6,17 ms. La función estudiantil del fixture ocupó menos de 1 ms de
mediana. Esto dirige la optimización al arranque/terminación y planificación
del proceso confiable, no a cambiar el contrato JSON ni reutilizar el
intérprete. No permite atribuir causalmente el ahorro a un único flag.

La configuración candidata usa el cargador CJS público y limita a uno el
pool V8 y las tareas de compilación WASM del worker. El puente y los probes
nativos conservan sus opciones. El perfil de referencia optativo mantiene
el cargador original para repetir A/B; el funcionamiento normal no escribe
fd4. Ninguna fase se resta del presupuesto de 3000 ms.

Identidades y recibos de esta comparación, bajo
`.local/preproduction/imp-03-07/case-cost-20261117/`:

- Imagen sin perfil comparada: `sha256:82b4fa2d55e4e58031a44474b0fd1deab46e525a32d9c3388742f59c7a62fab2`.
- Informe A/B con perfil: SHA-256 `3c15eaf76488d88a7db1c74503ad9f87e48251cb0ddb06baf9718db6e3a93469`.
- Informe A/B sin perfil: SHA-256 `d24ba8c0fe86721445949d1adb98e9126ad2240ae7b8bb33ad3a8cb7861b1e8a`.
- Archivo de recibos WSL1: `wsl1-evidence.tar`, SHA-256 `d103b8044e69fa5cbc461c1840dfd1231b09157feb0b77b3aedcced0cca1b267`.
- Archivo de los fallos VirtualBox: `vbox-evidence.tar`, SHA-256 `a49678dfb93b7d26d4b3812ae68b69c5a05635e742501bdf6cc93aecc8bb7556`.

La primera preparación WSL falló antes de arrancar dockerd. Su stdout/stderr
no se habían conservado: se registra esa carencia, el journal de systemd y
el diagnóstico posterior, por separado. La continuación validó el estado
parcial sin reiniciarlo y guardó recibos nuevos. Al cerrar WSL1 se verificaron
cero procesos/montajes/loops privados y el inventario Docker habitual
intacto. WSL2 sigue siendo un diagnóstico virtualizado, no Linux físico.

## Verificación de la configuración final

Se incorporó la configuración al funcionamiento normal de `.12` y se
reconstruyó desde fuentes congeladas, sin red durante el build y sin instalar
dependencias. Imagen final:
`sha256:59b49b3c72e25715373fd948634307bfcaaf112c3096b85cc46a2ae83e9d3c5b`.
El inventario de sus 56 archivos está en `image-final-sources.json`;
`image-final.tar` tiene SHA-256
`dc5e996ffce5b0b6f2d6feebdf190a9023de8e4b72798677912e713d31c1772e`.
La imagen no habilita el perfil.

En un segundo motor privado WSL2, bajo la misma envolvente, pasó:

| Verificación real                         | Resultado                                                                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A/B final, ocho objetos `{sum:a+b}`       | Base RUN/SUBMIT: 1085,48/1049,25 ms; final: 674,95/597,66 ms. Ocho casos y limpieza en los cuatro intentos. Ahorro observado 37,8%/43,0%.                         |
| Smoke de ocho sumas primitivas            | Cold RUN 613,99 ms; cold SUBMIT 696,88 ms; SUBMIT preparado 622,83 ms. Presupuestos decrecientes y controles efectivos en casos 1–8.                              |
| Identidad nativa                          | UID10001, cinco máscaras de capabilities cero, guardia NoNewPrivs y canal del puente inaccesible.                                                                 |
| Watchdog                                  | Loop clasificado TIMEOUT, cierre notificado a 3006,60 ms. No prueba última instrucción física.                                                                    |
| Salida combinada y acumulada              | OUTPUT_LIMIT a 65536 bytes tanto entre dos casos como entre ocho, con limpieza.                                                                                   |
| Memoria nativa directa y de descendientes | MEMORY_LIMIT, OOM observado y `oom_kill=1`, bajo 134217728 bytes agregados.                                                                                       |
| Semántica y fallos                        | 20/20: JSON, aislamiento entre casos, sintaxis/excepción/aserción, objetos no admitidos, serializador alterado, falsificación, ocultos, CPU finita y cancelación. |

La cancelación se disparó tras observar el worker Node con identidad,
parentesco y capacidades verificadas; no se afirma que observara una
instrucción de QuickJS. El resultado fue UNKNOWN/CANCELLED con limpieza
inicial no verificada; la reconciliación posterior verificó ausencia. El
fixture CPU de 200000 iteraciones terminó correctamente en 112,69 ms.
Las métricas de OOM sin paquete (`runtimeMs=0`) representan falta de esa
observación, no ejecución sin costo.

El A/B final tardó 4,302/3,827 s hasta limpiar para el candidato, frente a
5,251/4,442 s para la base. Sigue siendo una muestra por modo/brazo. No se
mezcla con las anteriores para presentar un p95, ni acredita cola, SQL, API
o navegador. La comparación se ejecutó con el bundle identificado
`runtime-ab` (runner `.12`); los harnesses se fijaron por hash por separado.
La captura final de fuentes y el bundle para el ensayo físico permiten
comprobar los mismos bytes de runtime sin confundir sus manifiestos.

Recibos finales en el mismo directorio local:

- `wsl2-final-plain-ab.json`: SHA-256 `ee5185e2ef84bd014deb2da347b4434b96669d854b2db9a5206b1697acdc2ade`.
- `wsl2-final-controls.json`: SHA-256 `10eface7ceb7b59daabedefdfa76db26883c36810357d241dbd88c45f7cb5bfd`.
- `wsl2-final-limits.json`: SHA-256 `74084a4f57a7ad31d577e626d121d712cee58a3b090a124a98f7b5800bee6045`.
- `wsl2-final-regressions.json`: SHA-256 `a4e7858b8eea0b17487a8281fc59ac7c61ecd7fa2444ff2118ea3a8e39c12473`.
- `wsl2-evidence.tar`: SHA-256 `9de14f02604b4b355280ae76cfd5ba14df0893ff742e559ebee8ce5ab2cc239c`.

Los tres motores privados de este incremento quedaron retirados; sus recibos
verifican cero procesos, montajes y loops propios. Los inventarios de Docker
habituales permanecieron iguales dentro de cada campaña. La construcción
local añadió imágenes identificadas antes de tomar el inventario de cada
motor; no se alteraron los contenedores de otros proyectos.

## Comprobaciones de código y entrega

Con Node 24.21.0 se ejecutaron `npm run typecheck`, ESLint y las pruebas del
runner: **24 suites / 575 pruebas** en la revisión final. También pasaron
los focos API de ejecución/envío (3 suites / 57 pruebas) y preparación/candidato
(2 suites / 52 pruebas). El arnés físico pasó 15 pruebas Python y 27 Jest,
estas últimas incluidas en la suite del runner. Los tests usan dobles para
contratos; los resultados de cápsulas reales se registran arriba por separado.
No se ejecutó E2E de producto, SQL real ni adaptador remoto en este incremento.

El candidato de fuentes se conserva en
`.local/candidates/imp-03-costo-2026-11-17/`, con la
[verificación/restauración existente](IMP-03-candidato-reproducible.md).
Sus identidades y las del bundle final se guardan en un recibo externo a la
captura para evitar una referencia circular. La captura de fuentes es
reproducible; no se declara reproducibilidad binaria de un host o VM todavía
no preparado. Los hashes históricos y los intentos fallidos se conservan.

## Preparación física

El [guion físico](IMP-03-validacion-fisica.md) prepara RUN8 y SUBMIT8 en VMs
distintas. Los recibos verifican ocho casos, límites exactos, presupuesto
decreciente y suma de tiempos cobrada; no aceptan un reinicio a 3000 ms por
caso. El preflight de esta estación Windows devuelve
`LINUX_PHYSICAL_KVM_REQUIRED`, salida 2, antes de crear una VM. Continúan
pendientes host físico, artefactos compatibles y ejecución real del guion.
