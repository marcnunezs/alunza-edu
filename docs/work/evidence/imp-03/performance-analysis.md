# Rendimiento local RUN/SUBMIT — 23/10/2026

La medición independiente optimizada y su repetición dentro de CI cumplen el objetivo local de RNF-REN-02, p95 <5000 ms, con 100/100 SUBMIT correctos en cada corrida y limpieza verificada. **CI local aprobado: 14/14 controles.**

## Resultado histórico y método

La corrida inicial registró p95 SUBMIT de 1833,90 ms secuencial y **5164,50 ms con concurrencia 4**, por lo que ese control falló. Se conserva en [submit-performance-before-fix.json](submit-performance-before-fix.json) y [CI anterior](ci-before-performance-fix.json). RUN registró 1082,47 y 2007,53 ms, respectivamente; véase [RUN anterior](run-performance-before-fix.json). El fallo de rendimiento no altera el conteo funcional de 14/27.

La comparación siguiente utiliza el [baseline instrumentado](submit-performance-baseline-timed.json) y la [variante optimizada instrumentada](submit-performance-optimized-timed.json). Cada corrida contiene 50 envíos secuenciales y 50 con concurrencia 4. El tiempo completo incluye HTTP, ejecución y persistencia; el p95 usa nearest-rank y conserva todas las muestras.

Se mantuvieron fixture, imagen y límites: suma con un caso visible y otro oculto, dos cápsulas nuevas por envío. La cuota de admisión fue 100/min por actor únicamente en TEST; los límites de concurrencia permanecieron iguales. «Frío» identifica el primer lote tras reiniciar la API: una muestra secuencial o cuatro concurrentes, sin incluir levantar Docker o PostgreSQL.

## Comparación instrumentada

| Perfil | Media baseline | Media optimizada | p95 baseline | p95 optimizado |
| --- | ---: | ---: | ---: | ---: |
| Secuencial, 50 envíos | 1585,58 ms | 1559,42 ms | 1810,05 ms | 1840,68 ms |
| Concurrencia 4, 50 envíos | 3339,70 ms | 2894,16 ms | 5708,82 ms | 3231,95 ms |

El p95 concurrente bajó **43,39%** y la media **13,34%**. El margen respecto del umbral fue 1768,05 ms. El baseline tuvo cuatro solicitudes ≥5000 ms; la variante optimizada ninguna, con máximo de 3649,55 ms. El p95 secuencial subió ligeramente, 1,69%.

Fases con concurrencia 4; cada celda expresa **media / p95**, en milisegundos:

| Fase | Baseline | Optimizada | Unidad |
| --- | ---: | ---: | --- |
| Inspección previa | 180,02 / 392,23 | 130,83 / 264,65 | Envío |
| Segunda resolución de imagen | 192,10 / 420,90 | Eliminada | Envío |
| Ejecución completa | 2991,00 / 5008,99 | 2597,93 / 3027,08 | Envío |
| Persistir resultado durable | 20,36 / 37,83 | 20,34 / 33,92 | Envío |
| Confirmar intento | 23,32 / 43,13 | 21,66 / 36,38 | Envío |
| Crear cápsula | 298,48 / 614,80 | 261,01 / 330,96 | Caso |
| Tiempo conjunto de ambos attach | 26,61 / 66,33 | 16,33 / 29,29 | Caso |

Desaparecen los 100 spans adicionales `imageResolve`: SUBMIT reutiliza el ID comprobado en la inspección previa, que sigue consultando la imagen. Las lecturas idénticas pendientes se comparten sin caché posterior; `/info` e imagen se consultan en paralelo. Los attach presentan solapamiento medido de 0 a 14,54 ms de media por cápsula. Las fases superpuestas y sus percentiles no deben sumarse.

Ambas corridas conservaron 100 respuestas HTTP 201/`SUCCESS`, infraestructura `OK`, 100 ejecuciones y 100 intentos distintos, y 200 creaciones, inspecciones previas/posteriores, eliminaciones y verificaciones de ausencia. No hubo fases incompletas; `cleanupVerified=true`, con cero cápsulas iniciales y finales.

## Identidad y límites de interpretación

El par instrumentado utilizó la misma imagen:

`sha256:9460833e96797616e43033a336336c52f5e53902b2aa532e5e612448b60b7785`.

La evidencia confirma menos trabajo redundante y attach solapado. También mejoraron las colas de creación y variaron otros tiempos del host. Dos corridas locales no permiten atribuir toda la reducción a un cambio individual ni generalizarla a producción, otras cargas o cualquier programa. Las escasas muestras frías tampoco permiten una conclusión independiente sobre arranque frío.

## CI

**[CI local aprobado](ci.json): 14/14 controles**, incluidos 675 unitarias/contratos, 111 HTTP, 313 SQL, 78 casos Docker y 34 Cypress. Huella del candidato: `5a5ec24f2a9535101f7cb7a303460d479a06bdf866c4b592ab1b1fcf61076194`.

La repetición completa obtuvo:

| Operación | p95 secuencial | p95 concurrencia 4 | Resultado |
| --- | ---: | ---: | --- |
| [RUN](run-performance.json) | 1030,14 ms | 2227,87 ms | 100/100 correctos |
| [SUBMIT](submit-performance.json) | 1654,12 ms | **3502,71 ms** | 100/100 correctos y persistidos |

Ambas terminaron con cero cápsulas pendientes y la imagen sin cambios durante cada medición. SUBMIT conservó 100 intentos y 100 ejecuciones únicos; ningún valor de p95 se redondeó para decidir la aprobación. El margen concurrente final fue 1497,29 ms.

`runner:prepare` de esta revalidación reconstruyó la imagen y dejó una identidad distinta, corroborada por Engine y CLI:

`sha256:e0769161a0f42bee4cc42fd4fd4e10cf7cacfc93b551ea230ce3a2994d48cf72`.

Dockerfile, bridge y worker no cambiaron en esta optimización. Los reportes finales registran esa identidad exacta; no se extrapola la identidad del par instrumentado a CI. La huella de código coincide en las mediciones optimizadas y el cierre de CI. No hubo reintentos para seleccionar una corrida favorable: la primera corrida completa de CI después del cambio aprobó todos sus controles.
