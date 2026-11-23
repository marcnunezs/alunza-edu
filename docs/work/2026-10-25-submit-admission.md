# SUBMIT — digest de imagen por admisión

Estado al 25/10/2026, hora de Santiago: **IMP-05.05 CERRADO LOCALMENTE EN TEST**.
La CI completa terminó con 17/17 controles aprobados a las
`2026-10-26T00:35:22.681Z`; comprueba conjuntamente .03, .04 y .05.

## Alcance y base

Corrección solicitada para cerrar localmente IMP-05.05, exclusivamente en
`alunza-edu-laboratorio`. Se mantienen p95 menor que 5.000 ms, 50 solicitudes
seriales y 50 con concurrencia cuatro, y tres perfiles SUBMIT consecutivos en
la CI completa. No se alteran recursos, cuotas, evaluadores ni proyecto principal.

HEAD: `75708ceecf2ca755bd32fb4b04e77bcb8de310f4`. La base incluye los cambios
anteriores: 498 fuentes, SHA-256
`c32ccb10f0db6b9dd1713911160a5dc949279ae55c66b35dd53e34b701e485b0`.
Inventario y diff privados: `.local/evidence/imp-05-05/submit-repair-before-*`.

## Diagnóstico observado

Los FAIL previos de p95 concurrente 5.199,50 y 6.994,68 ms siguen conservados.
La demora se concentra en el lifecycle Docker; no se demostró que la captura
de señales ni el commit PostgreSQL expliquen esos picos.

Un preload privado del proceso API midió asignación de socket, envío, cabeceras
y finalización, con buffers acotados y flush por IPC/ACK antes del cierre en
Windows. El smoke offline comprobó transparencia y ausencia de payload.
El perfil real conservó todas las muestras: p95 2.117,13 ms serial y 4.442,18 ms
concurrente. En ambos perfiles hubo cero solicitudes esperando en el pool;
con concurrencia cuatro se observaron como máximo cinco sockets activos de
dieciséis. El event loop no explica las esperas de cientos de milisegundos
observadas en create/start. En wait, recibir pronto las cabeceras y tarde el
cuerpo es espera de terminación, no evidencia de parsing lento.

Se identificaron exactamente 50 consultas redundantes de imagen por perfil:
la admisión ya obtiene un digest, lo descarta, y el adaptador vuelve a resolver
la etiqueta. Coste de esa segunda resolución: p95 135,31 ms serial y 384,29 ms
concurrente. Los totales fueron 100 GET de imagen en serial y 73 en paralelo
(23 inspecciones de disponibilidad compartidas durante su ejecución + 50 del
adaptador). Eliminar ese coste no equivale a predecir la resta de percentiles
ni atribuye retrospectivamente todos los picos históricos.

La comparación separada de pools Node normales frente a un hilo, orden
ABBAABBA y 32 cápsulas nuevas por brazo, no mejoró latencia: p95 del lifecycle
3.677,24 frente a 4.014,52 ms. Aunque bajó el tiempo observado de throttling,
se descartó esa modificación. Ambos brazos conservaron cero fallos y limpieza
comprobada. Es un diagnóstico del runner, sin HTTP; no reemplaza aceptación.

## Corrección

El contexto interno de admisión conserva proveedor, versión y digest SHA-256.
SUBMIT entrega ese contexto mediante un argumento separado del input estricto
del evaluador. No entra en DTO, resultado público, código estudiantil ni filas
de dominio. Se comprueban versión y digest antes de construir el adaptador.

`imp-03-quickjs.5` permite fijar ese digest en el adaptador de una ejecución.
Cada caso sigue creando una cápsula nueva y verificando configuración efectiva,
salida, OOM y eliminación. No se comparte una caché entre solicitudes; si la
imagen admitida desaparece, falla sin resolver otra etiqueta. Los consumidores
directos sin contexto conservan la resolución anterior. `imageResolve` sigue
midiendo selección de imagen; el GET de admisión se mide en `submission.inspect`.

## Verificación

Primera comprobación del runner: 211/211 pruebas, nueve suites, PASS. Incluye
digest inválido, cambio de etiqueta, imagen retirada, aislamiento entre
adaptadores, fallback directo, dos cápsulas y conservación de timings.
La verificación integrada y la CI del candidato final constan al final de
esta entrada. Los resultados de diagnóstico no sustituyen los gates completos.

La medición posterior a la corrección mantuvo el mismo digest de imagen y
aprobó con p95 de 2.043,65 ms serial y 4.207,26 ms concurrente. Eliminó las
100 resoluciones redundantes del adaptador, 50 por perfil; los GET totales
pasaron de 173 a 76 porque las inspecciones de admisión compartidas variaron
de 23 a 26 en paralelo. Se conservaron las 100 cápsulas nuevas por perfil,
todos sus timings y la limpieza. Una medición anterior y otra posterior no
acreditan un porcentaje causal general de mejora ni explican todos los picos.

Los informes saneados se conservan bajo `.local/reports/imp-05/`, incluidos
`submit-ipc-analysis.json` y `submit-pools-analysis.json`; las observaciones
privadas originales permanecen bajo `.local/evidence/submit-ipc/` y
`.local/runner-pools-ab/`.

## Primer intento integral y barrera temporal E2E

La CI del candidato `d73a54bbf4a60513b5303a30187a89f0d702fe41b53fabbd8a6d4f0957e62fe6`
aprobó los primeros 15 controles: 2.105 unidades, 181 HTTP, 928 aserciones SQL
y los tres perfiles SUBMIT. Sus p95 serial/concurrente fueron
2.161,51/4.607,67 ms, 1.990,72/4.007,39 ms y 1.860,56/3.768,72 ms.
Se detuvo en E2E: 48/49, con `IMP05-02` esperando cuatro requeridos en un corte
que incluía tres. La evaluación final de ayuda no se ejecutó en esa CI.
El archivo aditivo `submit-repair-ci1` conserva resultado, candidato y logs;
no se confunde el E2E fallido de `imp-01` con el PASS anterior de `imp-05`.

La inspección de TEST preservado, sin reset y con consulta read-only, encontró
la última publicación a las `23:35:59.989837 UTC` y una matrícula posterior en
el orden de las solicitudes a las `23:35:59.875485 UTC`: al menos 114.352 µs
de retroceso del reloj de BD. La cadena Cypress sí esperaba ambas respuestas.
El corte inicial podía quedar antes de la última publicación; incluirla en
ese corte habría infringido la semántica histórica de progreso.

La corrección adicional sólo afecta al fixture. Lee el corte actual hasta
alcanzar la cota superior de las publicaciones, con un máximo de 20 lecturas.
Como el DTO Activity trunca a milisegundos, la cota es el siguiente milisegundo
de la última publicación; `asOf` se compara con sus microsegundos exactos.
No usa pausas ni los contadores para decidir si reintenta. Un error de lectura
falla de inmediato, y un reloj que no alcanza la cota agota la barrera.
Después exige `completed=0, required=4`, conserva ambas aserciones históricas
y verifica que el SUBMIT posterior quede fuera del corte inicial.

El helper sigue el patrón de
[sondeo acotado de Cypress](https://docs.cypress.io/api/commands/request).
Cinco pruebas deterministas, tipos E2E y lint aprobaron. No se modificaron
SQL, cálculos de progreso, límites ni aserciones para convertir tres en cuatro.
El recorrido focal `npm run test:e2e -- --progress` aprobó 4/4 casos con
servicios reales. La CI íntegra posterior verificó el candidato con esta
precondición corregida, 502 fuentes y SHA-256
`19253829d0baecaf2055c855714ab15247344a28d6fb1887fab5b65823834ba6`.
El primer intento integral permanece como FAIL.

## Cierre local comprobado

`npm run ci:verify`, con Node portable 24.21.0, terminó con salida 0 y
**17/17 PASS**. Todos los archivos permanecieron congelados durante la corrida,
incluida documentación. El registro de cierre se actualiza después; la huella
de las 502 fuentes ejecutadas se conserva sin cambios.

| Control                         | Resultado real                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| Formato, lint, tipos y unidades | PASS; 2.110/2.110 pruebas en seis grupos                                           |
| Runner, Docker, fixtures y RUN  | PASS, incluidos los controles actuales de aislamiento y rendimiento                |
| Integración HTTP y SQL          | 181/181 HTTP; 928 aserciones SQL en 13 archivos, incluidos los 17 casos de señales |
| Integración IA local            | PASS, sin proveedor remoto                                                         |
| Cypress completo                | 49/49 PASS; cero fallos u omitidos                                                 |
| Evaluación de ayuda             | PASS; 234 muestras, 763 recibos, tres reanudaciones y cero llamadas externas       |

Los tres gates SUBMIT consecutivos de esta misma CI conservaron 50 solicitudes
seriales y 50 con concurrencia cuatro por corrida, 100 respuestas válidas,
candidato/imagen/entorno estables y limpieza verificada:

| Fin UTC, 26/10/2026 |  p95 serial | p95 concurrencia 4 | Límite y resultado |
| ------------------- | ----------: | -----------------: | ------------------ |
| 00:02:19.889        | 2.072,35 ms |        3.415,01 ms | < 5.000 ms; PASS   |
| 00:05:39.772        | 1.644,12 ms |        3.198,67 ms | < 5.000 ms; PASS   |
| 00:09:02.882        | 1.646,66 ms |        3.246,24 ms | < 5.000 ms; PASS   |

La actualización .03 → .05 conserva la prueba focal anterior aprobada, con
tres intentos, una regla, una apertura y digest canónico idéntico; no se
atribuye otra ejecución a esta CI. Sus migraciones y fuentes de señales no
cambiaron durante la corrección SUBMIT. La instalación vacía y la integración
completa sí se volvieron a verificar dentro de la CI final.

Evidencia saneada: `.local/reports/imp-05/ci.json`, `local-acceptance.json`,
`submit-admission-comparison.json` y sus historiales. El informe de aceptación
comprueba la huella contra la CI, sus tres gates, la liberación del bloqueo TEST,
la detención de sus contenedores y el principal limpio en HEAD
`318efed67bb293f53a43c0a5a4d015eb3e0812d0`. El workflow ya empaqueta estos
informes IMP-05; observaciones privadas y credenciales quedan fuera.

`SIGNALS_WORKER_ENABLED=false` permanece por defecto. Recuperación y
reconstrucción: [diccionario incremental](IMP-05-episodes-dictionary.md).
El cierre es local: quedan fuera tablero, revisión docente pública, RF-019,
cierre integral de RF-018, aceptación académica, CI Linux y servicios remotos.
No se modificó el proyecto principal ni se publicaron commits o despliegues.
