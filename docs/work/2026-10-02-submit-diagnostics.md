# Diagnóstico de latencia SUBMIT y confirmación Docker

Fecha: 2026-10-02. Alcance autorizado: instrumentar TEST, reproducir el perfil SUBMIT, corregir una fase medida y comprobar tres series consecutivas sin cambiar el límite p95 de 5.000 ms ni el aislamiento. Afecta RF-009/010/011, CU-009/010, HU-010/014 y RNF-REN-02, SEG-04/05 y CON-01. No inicia otro incremento funcional.

## Evidencia inicial

El [registro de Git y CI](2026-10-02-git-and-ci.md) conserva el fallo local anterior de p95 concurrente **6.273,51 ms**, con 100 respuestas válidas y limpieza comprobada. La CI de GitHub sobre `4a3ee8f` aprobó; ese resultado corresponde al código anterior a esta tarea.

La primera serie instrumentada reprodujo un incumplimiento el **02/10/2026 a las 16:04:30 UTC**: p95 **2.310,74 ms** secuencial y **5.206,96 ms** a concurrencia cuatro. Conservó las 100 respuestas válidas, cero fallos funcionales, limpieza verificada y la imagen `sha256:876dcc8862f2301b280b2a01700fba64fc6a97f591eb3dc2891ccf0310161c4c`. Cada perfil retuvo 2.000 eventos, cero rechazados y cobertura completa de sus 50 solicitudes.

En la solicitud que fija el p95 concurrente, índice 41, el total fue 5.206,96 ms y el lifecycle 4.611,02 ms. Las dos cápsulas sumaron 1.362,93 ms en `start`, 1.258,82 ms en `streams`, 704,00 ms en creación, 456,07 ms en eliminación y 260,06 ms en `wait`. El supervisor registró 631,96 ms, incluidos dentro del lifecycle. Otra solicitud lenta registró 431,18 ms en `wait`. Los percentiles de fases no se suman ni se confunden con el tiempo del programa.

Los contadores de la VM en los extremos del perfil mostraron unos 11 GB de memoria disponible y swap sin uso. También había servicios de otros proyectos. Estos snapshots y los promedios CPU no atribuyen la demora a un proceso concreto ni descartan picos entre observaciones. No se detuvieron servicios ajenos ni se modificaron la VM, el firewall o Docker Desktop.

La nueva serie diagnóstica fallida y su descomposición permanecen en `.local/reports/submit-diagnostics/diagnostic-1*.json`; los resultados CI anteriores se conservan en sus grupos originales con su estado fallido. No se seleccionaron muestras favorables ni se excluyeron errores del cálculo.

## Instrumentación y cambio

El [observador API](../../apps/api/src/practice/submit-observability.ts) exige simultáneamente `environment=test` y `ALUNZA_TEST_SUBMIT_TIMINGS=1`. El canal de solicitudes v2 proyecta únicamente versión, source, fase permitida, duración finita, finalización, marca de tiempo monotónica y UUID de correlación. El canal separado de recuperación registra worker RUN/SUBMIT, fase, duración, finalización, la misma clase de timestamp y conteos enteros limitados cuando corresponden. No copia código, pruebas, salidas, mensajes de excepción, prompts o credenciales. Los UUID se utilizan en memoria para correlacionar; el informe de muestras los elimina. No se añadieron campos al DTO público ni columnas de BD.

El [observador del ejecutor](../../infra/runner/timing.mjs) es opcional. Sin callback no lee el reloj adicional. Los observadores que arrojan errores o devuelven promesas rechazadas no cambian el resultado ni el fallo original. Se instrumentan admisión, ejecución, persistencia, autorización final, transporte Docker e inspección/limpieza.

El [perfil](../../scripts/practice-performance.mjs) conserva 50 muestras secuenciales y 50 a concurrencia cuatro, la misma solución ficticia, una prueba visible y una oculta, cápsulas nuevas, tiempos fríos/calientes y nearest-rank. El límite sigue siendo **p95 <5.000 ms**. Los snapshots del host y VM ocurren fuera de las solicitudes medidas; los callbacks TEST de la API sí forman parte del trabajo medido y pueden añadir costo de observación. La cobertura exige las nueve fases del servicio y las catorce fases obligatorias de cada cápsula completas, sin aceptar omisiones o duplicados. Los fallos HTTP conservan sus fases cuando la correlación es inequívoca.

En [Docker Engine](../../infra/runner/docker-engine.mjs), `wait` se inicia después de `start=204` y de enviar el input, mientras se aguarda el cierre completo de ambos streams. La [especificación oficial API 1.45](https://docs.docker.com/reference/api/engine/version/v1.45.yaml) define esa operación como una espera por la terminación y su código de salida. El resultado exige ambos EOF y la confirmación válida del daemon; luego mantiene la inspección independiente, eliminación y comprobación de ausencia. Siguen vigentes deadline, cancelación, límites, propiedad de cápsulas y ausencia de reintentos de transporte.

Este cambio elimina una dependencia secuencial de la fase medida. `docker.wait` ahora incluye tiempo solapado con `docker.streams`; sus duraciones no representan componentes aditivos. La corrección no establece una causa única para toda la variación local ni acredita por sí sola la meta de rendimiento.

Los reconciliadores mantienen su intervalo de 15 s, exclusión de ticks simultáneos, sweep compartido en curso, purge y lote máximo de cuatro recuperaciones. Sus observadores solo miden el trabajo existente. La correlación de background usa la ventana `submission.total` y el reloj del mismo proceso API. Un trabajo que todavía está abierto al detener la API puede carecer de evento final; ausencia de overlap no demuestra inactividad. Los timestamps derivados del runner marcan publicación, no el inicio original de esa fase. Coincidencia temporal tampoco demuestra causalidad.

## Medición posterior a la espera concurrente

RUN aprobó con p95 de **1.697,17 ms** secuencial y **4.432,98 ms** concurrente; 100 respuestas válidas, limpieza e imagen sin cambios. La primera serie SUBMIT posterior al cambio falló el **02/10/2026 a las 16:30:22 UTC**, con p95 de **2.684,26 ms** secuencial y **5.521,18 ms** concurrente. Las 100 respuestas siguieron siendo válidas, sin cápsulas pendientes ni cambio de imagen. Ambos perfiles conservaron las 50 correlaciones completas y cero eventos rechazados. Por tanto, la espera concurrente por sí sola no acredita el objetivo de tres series.

Ese resultado se conservó en `.local/reports/submit-diagnostics/optimized-series-1.json`. El registrador auxiliar interpretó mal una fecha de PowerShell después de medir y se detuvo; la fecha se corrigió, se recuperó el informe nuevo y se verificaron los hashes de todas las fuentes contra el manifiesto anterior. Este error de registro no produjo el fallo p95. No se reemplazó la serie ni se ejecutaron las otras dos como si la primera hubiera aprobado.

La serie con timestamps y background terminó el **02/10/2026 a las 16:54:42 UTC**: p95 **5.687,50 ms** secuencial y **12.768,01 ms** concurrente. Conservó 100 respuestas válidas, limpieza, imagen, 2.000 eventos y 50 correlaciones completas por perfil. Hubo 72 eventos background secuenciales y 40 concurrentes, sin rechazos. El registrador comprobó que las fuentes permanecieran idénticas antes/después y detuvo la secuencia al fallar; no se completaron tres series locales aprobadas. Los manifiestos y el informe permanecen en `.local/reports/submit-diagnostics/source-timed-*.json` y `timed-series*.json`.

La muestra concurrente índice 11 fija el p95. Su ventana API fue [17.984,349; 30.745,770] ms del reloj del proceso. Los ticks previos RUN/SUBMIT terminaron antes de 17.768,208 ms; los siguientes comenzaron después de 32.623,514 ms. Todas sus fases y totales quedaron completos. Por tanto, esos ticks medidos no se solaparon directamente con esa muestra. Otras muestras lentas sí coincidieron con un tick de unos 144 ms, sin recuperación de reservas ni eliminación de cápsulas expiradas. Los sweeps máximos del perfil fueron unos 417 ms; esto no explica por sí solo el exceso de varios segundos ni acredita una causa global.

La muestra índice 11 sumó 2.400,68 ms en creación, 3.043,81 ms en start y 3.097,71 ms en eliminación de sus dos cápsulas; la primera eliminación sola tomó 2.868,23 ms. Las esperas y streams solapados no se suman. Los extremos del perfil muestran más tiempo de escritura y de cola del disco de la VM que las series previas, pero no son observaciones por solicitud. La memoria disponible sigue cerca de 11 GB y no hay swap usado. Estos datos son compatibles con variación de recursos/I/O del entorno Docker Desktop; no identifican un proceso causante ni descartan otros factores.

El candidato se prepara para una nueva CI Linux y sus tres series consecutivas, dentro de la autorización vigente para publicar en `equipo/laboratorio` y ejecutar la CI. La validación remota será evidencia de ese entorno; no reemplazará ni convertirá en aprobados estos fallos locales.

## Comprobaciones de código

Formato, lint y tipos aprobaron. El `npm test` inicial aprobó 1.055 pruebas. Tras la nueva instrumentación y protección ante fallos del reloj, se ejecutaron los grupos afectados completos: **413/413** API, **128/128** runner y **282/282** preproducción. Web (40), contratos (97) e IA (310) ya habían aprobado y sus fuentes no cambiaron en esta tarea. Son **1.270 pruebas unitarias aprobadas por grupos**, no una nueva ejecución completa de `npm test`.

La integración sobre el candidato con espera concurrente aprobó **146 HTTP y 471 SQL**, incluidos escenarios de caída/recuperación. El probe Docker real aprobó **69 casos**, sin cápsulas propias pendientes ni llamadas remotas. Estos controles preceden la extensión de timestamps y observadores de los reconciliadores; las unidades posteriores verifican que esa extensión conserva el comportamiento. No se ejecutó una nueva CI completa de GitHub para estas fuentes.

Las regresiones ejercitan EOF antes de la confirmación, confirmación antes del último byte, rechazo o respuesta perdida de `wait` con output pendiente, cancelación, deadlines, entrega única y cierre de sockets. Las pruebas del observador verifican opt-in TEST, allowlists, privacidad, fallos síncronos/asíncronos y cobertura incompleta. La revisión independiente del código no encontró cambios en permisos, persistencia, diagnósticos o límites; no sustituye aceptación humana CAPSTONE.
