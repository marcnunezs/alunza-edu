# IMP-03 — Candidato físico .13: watchdog y contabilidad OOM

Fecha: 17/11/2026, America/Santiago. Estado: **74/74 ensayos físicos aprobados
y verificación independiente exitosa; respaldo transferido y rehasheado**. El usuario autorizó
corregir watchdog y contabilidad OOM y revalidar en el Ryzen, manteniendo
límites y sin desplegar ni contratar. Se conservan RF-009/010/011,
RNF-REN-02/SEG-04 y DEC-003/008.

## Correcciones verificadas

La [campaña .12](IMP-03-rendimiento-adversarial-fisico-12.md) conservó cuatro
fallos adversariales: TIMEOUT con 3005,804950 y 3002,981394 ms informados,
y dos OOM con packet disponible cuyo tiempo y cgroups no se acumularon antes
del retorno terminal. Los recibos y artefactos `.12` permanecen intactos;
la etiqueta `.13` no transforma esos fallos en éxitos.

El watchdog v2 implementado conserva el deadline original y reserva
`min(50,budgetMs)` dentro del presupuesto restante de 3000 ms acumulados.
El inicio del retiro es `stopDeadlineMs=budgetMs-retirementReserveMs`.
Los checks previos a escribir/spawn y la ruta sin lanzamiento evitan iniciar
trabajo cuando esa ventana ya se agotó. `launchSkipped` conserva spawn/exit
ausentes y kill cero; el tiempo de cierre sigue siendo real, sin clipping.
Esta reserva no aumenta límites ni establece una garantía hard realtime.

La corrección OOM implementada captura, valida y contabiliza una sola vez la
evidencia disponible antes de finalizar `UNKNOWN / MEMORY_LIMIT`. Si no hay
packet válido, conserva la observación de OOM sin inventar tiempo o controles.
No continúa con otro caso tras OOM ni altera prioridades de cancelación
y limpieza. Su efecto físico se verifica por separado de los fallos temporales.

## Preparación de identidad y campañas

La construcción inicial de imagen `.13` comunicada por el operador tiene ID
`sha256:1f12d0fb7fb18f6e2668669b3b5da37be47fcc71120f7579dbe32155ad5846b0`
y archivo SHA-256
`707ee453fb1c1667aff78ee07782ac77ad057393be226e8194fa19918e1814ae`.
El [recibo del bundle](../../.local/preproduction/imp-03-07/physical-candidate-13-20261117/bundle-receipt.json)
y la [revisión del arnés](../../.local/preproduction/imp-03-07/physical-candidate-13-20261117/harness-revision.json)
fijan las siguientes identidades. No se reutilizan hashes `.12` como identidad
del candidato nuevo; kernel y guest compartidos conservan su identidad real.

| Artefacto                    | SHA-256                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| Fuente `quality-coverage-v1` | `4782224f79163235b3f554b140b2ca40750b51b42dc61695964f7fca3f788fa3` |
| Bundle runner                | `60fa6e007337ab761526d934990b6dca4ec2f5fff528331d153c6b792fc26eea` |
| Manifiesto bundle            | `83cc6798eb050c770a3e9eab72db70fbcd0a29a4d7efd8638a825303ea2109f9` |
| Manifiesto kit `.13`         | `6801df3e646873dcfaef7b18ac29bae0916fa149e2a736e9e64aad3a4fd573ab` |
| Revisión arnés               | `d1685d8638d466b256b07f6a1f254705780f388e482d1e72ce4741c26cfb8433` |
| Launcher                     | `2b2b20ae1de7eb92d7eee0067aac19832614224aae0b7163d318e7824185ceb7` |
| Guest                        | `1c0c07d49fd181c03af08fdf7b98a527907494c0f647b966d1d741f766a7925d` |
| Kernel r3                    | `49604546758f9e8d60ba8c44d478faad53b2148abd760c217576f36c182c0819` |
| Raíz preparada `.13`         | `f8ad7a4f8f8b20941ab79345298ae60d6a1b997d84c3ebb035fc0d2ffeddc937` |
| Store `.13`                  | `1d40aac63680327d0e1f281d33d8432d3585d2fd41abdd8833ad218462ee662c` |

El [snapshot de fuente](../../.local/preproduction/imp-03-07/physical-candidate-13-20261117/source-candidate.json)
usa otro algoritmo: `a33db5dd18eaf599b7ac256b7911d8c1214680b3b2da7a2f41cc38372aead862`.
No se intercambia con el digest quality del bundle. Conserva 939 archivos,
HEAD `b12fb6fb13b8de5e4f664270fe1a5108739c0aa9` y árbol con cambios explícito.
El empaquetado no ejecuta ni acredita pruebas del producto.
Fuente, imagen, bundle y kit quedaron capturados antes de las campañas;
los documentos finales se completaron después del congelado. Esa edición
documental no cambia el runtime medido ni modifica los artefactos `.12`.

El operador comunicó la semilla física aprobada en 15164 ms; esa preparación
del store no cuenta como ensayo de estudiante. La validación previa al
congelado informó 653/653 Jest y 26/26 Python aprobados. El conjunto físico
completo se descargó y verificó posteriormente, como se detalla más abajo.

El [protocolo local](../../.local/preproduction/imp-03-07/physical-candidate-13-20261117/quality/PROTOCOLO.md)
fija un kit, una VM simultánea y cuatro campañas independientes:

| Campaña                        | Posiciones fijadas                              | Estado     |
| ------------------------------ | ----------------------------------------------- | ---------- |
| Catálogo adversarial           | 20 perfiles                                     | 20/20 PASS |
| Repetición de los defectos .12 | 3 rondas × 2 perfiles de tiempo y 2 OOM: 12 VMs | 12/12 PASS |
| Normal RUN8/SUBMIT8            | 20 por modo: 40 VMs                             | 40/40 PASS |
| Fallos del host                | SIGTERM del launcher y SIGSTOP de QEMU: 2 VMs   | 2/2 PASS   |

Cada protocolo se fija antes de ejecutar y todos los intentos permanecen en
el denominador. Un retiro incierto detiene nuevos arranques. Las observaciones
v2 son obligatorias en las repeticiones temporales/OOM; no se atribuye tiempo
medido a un OOM que perdió su packet. Las pruebas del host no equivalen a
recuperar un guardián muerto por SIGKILL.

Se mantienen 1 vCPU/2147483648 bytes guest, cápsula de 134217728 bytes,
swap guest/cápsula cero, 32 tareas, 3000 ms y 65536 bytes acumulados.
Operación, cierre y TTL siguen siendo 30/40/60 s desde creación, sin reset.

## Resultados físicos del candidato

El [resumen derivado de los recibos](../../.local/preproduction/imp-03-07/physical-candidate-13-20261117/quality/timing-summary.json)
separa las cuatro observaciones de cada defecto: una del catálogo y tres
repeticiones nuevas. No se calcula p95 a partir de esos cuatro casos.

| Perfil                      | Muestras | Tiempo estudiantil observado     | Resultado                                       |
| --------------------------- | -------- | -------------------------------- | ----------------------------------------------- |
| Loop                        | 4        | Máximo 2956,438320 ms            | TIMEOUT, exceso informado 0                     |
| Tiempo acumulado, dos casos | 4        | Máximo 2954,592276 ms acumulados | TIMEOUT, presupuesto decreciente, exceso 0      |
| OOM heap                    | 4        | 425,406388–474,168964 ms         | MEMORY_LIMIT, tiempo cargado igual al observado |
| OOM buffer                  | 4        | 244,738132–254,170608 ms         | MEMORY_LIMIT, tiempo cargado igual al observado |

Las dieciséis observaciones tienen tiempo completo y watchdog v2; las ocho OOM
conservan controles del packet y contabilidad. Los cuatro perfiles que fallaron
en `.12` pasan estas observaciones nuevas, sin recortar tiempos ni ampliar los
3000 ms. El resto del catálogo también pasó: salida combinada bajo/en/sobre
65536 bytes, acceso a globals/imports, falsificación de canales/resultados,
estado entre casos, proyección oculta y controles nativos de identidad,
permisos, red, procesos y memoria. Las sondas nativas permanecen diferenciadas
de la ejecución QuickJS.

La confirmación normal conserva veinte RUN8 y veinte SUBMIT8, todos correctos
y bajo 5000 ms de ciclo local. P95 nearest-rank por modo, sin excluir muestras:

| Modo    | Mediana ciclo | P95 ciclo   | Máximo ciclo | P95 CLI completo | P95 tiempo estudiantil acumulado |
| ------- | ------------- | ----------- | ------------ | ---------------- | -------------------------------- |
| RUN8    | 4038,607 ms   | 4064,061 ms | 4071,242 ms  | 7484,435293 ms   | 712,008304 ms                    |
| SUBMIT8 | 4039,133 ms   | 4073,751 ms | 4075,123 ms  | 7484,922620 ms   | 708,974292 ms                    |

Se conserva la variante de arranque `.12`: `q35,sata=off,i8042=off`, `quiet`,
`systemd.show_status=error`, overlays privados en `/dev/shm` y caché QEMU
writeback predeterminada. No se usa `cache=unsafe`. `completeMs` comienza antes
de overlays e incluye boot, ejecución y retirada; excluye la verificación de
bases previa y posterior. `wrapperWallMs` incluye esos hashes y demás costes
de invocación: ninguna de sus cuarenta muestras baja de cinco segundos.
API, persistencia y red remota permanecen fuera de ambos relojes.

Cada VM/cápsula es nueva; no se vació la caché de páginas del host y la
verificación previa lee las bases. tmpfs consume memoria del host y puede usar
swap; no amplía la envolvente guest. En los intervalos antes/después de los
cuarenta normales, `pswpin`, `pswpout` y `pgmajfault` no aumentaron. La auditoría
posterior muestra 768 KiB usados en el archivo swap nominal de 4 GiB del host
(4194300 KiB registrados); no se afirma host sin swap ni se infiere su uso
durante cada instrucción. Guest/cápsula conservan swap cero observado.

Los dos fallos del host también pasan: SIGTERM del launcher tras ready termina
con `HOST_GUARD_INTERRUPTED` a 1813,835 ms, retiro 64,783 ms; SIGSTOP de QEMU
conserva el plazo original y termina con `ABSOLUTE_OPERATION_OR_CLEANUP_DEADLINE`
a 30091,351 ms, retiro 65,267 ms. No hubo retiro de emergencia. Los 74 recibos
acreditan retirada y bases intactas; la auditoría final registra QEMU cero,
directorios scratch cero y lock vacío.

## Evidencia y alcance del cierre

El [verificador nuevo](../../.local/preproduction/imp-03-07/physical-candidate-13-20261117/quality/verify_candidate.py)
exige un `pins.json` externo y su SHA, con fuente, bundle, imagen, runtime,
kit, guest, revisión del arnés y protocolos. Reproduce Receipt usando solo
un launcher local revisado y fijado explícitamente. Los verificadores `.12`
no se modifican. Las [pruebas negativas offline](../../.local/preproduction/imp-03-07/physical-candidate-13-20261117/quality/test_verify_candidate.py)
comprueban contaminación de identidades, reinicio de presupuesto, clipping,
falsos spawn/kill y exclusión de muestras lentas o faltantes: **10/10 aprobadas**.
Son pruebas del verificador con fixtures offline; no constituyen ejecuciones
físicas `.13`.

El [recibo independiente](../../.local/preproduction/imp-03-07/physical-candidate-13-20261117/quality/verification.json)
terminó con código 0 y `candidate-local-checks-passed`. SHA-256 del recibo:
`5988ffbfdc00c53e20b65a1523430a10b353a99117b57921a53052beefa326dc`;
SHA de [pins](../../.local/preproduction/imp-03-07/physical-candidate-13-20261117/quality/pins.json):
`2c5576362e0e220d3d06376c009ffbcf180992baf2757329a641c546c51ff8cb`.
Cada protocolo quedó fijado antes de su campaña y su hash se observó antes de
la primera VM correspondiente. Los hashes se reunieron posteriormente en el
[registro externo](../../.local/preproduction/imp-03-07/physical-candidate-13-20261117/quality/external-protocols.json),
antes de descargar la evidencia. El verificador contrasta 74 UUIDs de
boot distintos, admisiones distintas, ausencia de solapamiento, controles,
tiempos, Receipt y cierre; no vuelve a observar procesos vivos ni ejecutar VMs.

El [índice reproducible](../../.local/preproduction/imp-03-07/physical-candidate-13-20261117/candidate-completion.json)
reúne las identidades y los recibos. La
[transferencia de evidencia](../../.local/preproduction/imp-03-07/physical-candidate-13-20261117/evidence-verification.json)
verificó 506 archivos; archivo de 1669117 bytes, SHA-256
`0b90f4f4edb8b897fc24752d90956fdaf373e98973e8aac4782d74b3365c7bb6`.
El [respaldo físico](../../.local/preproduction/imp-03-07/physical-candidate-13-20261117/kit-backup-verification.json)
llegó al Lenovo: 431253493 bytes, SHA-256
`160d60760f1485c70feb688c2c41c8b899851775b69f00f38bf9c7c0fca9b13a`.
Se verificaron sus once archivos, incluidos los bytes descomprimidos del
kernel, raíz y store, sin extraer ni arrancar esos discos.

El ámbito ejecutado es el laboratorio Ryzen en
`/home/alunza/laboratorio/physical-candidate-13-20261117`. Quedan aprobados los
controles de esta campaña local y las repeticiones de las cuatro regresiones.
No se declara garantía hard realtime, aceptación remota/productiva ni cierre
de RNF-REN-02: falta medir el recorrido de producto con API y persistencia,
y el CLI completo sigue por encima de cinco segundos.
