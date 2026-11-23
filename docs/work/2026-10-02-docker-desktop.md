# Ensayo local de Docker Desktop para SUBMIT

Fecha: 2026-10-02. Alcance autorizado: inventariar los servicios locales, reducir temporalmente la carga de desarrollo, medir SUBMIT y probar un reinicio separado si persiste el incumplimiento. Afecta RF-009/010/011 y RNF-REN-02. Complementa el [diagnóstico de SUBMIT](2026-10-02-submit-diagnostics.md); no cambia contratos, límites, aislamiento ni requisitos y no inicia otro incremento funcional.

## Condiciones y recuperación

Se conservaron Node 24.21.0, npm 11.19.0, la imagen `sha256:876dcc8862f2301b280b2a01700fba64fc6a97f591eb3dc2891ccf0310161c4c` y las fuentes del candidato local `5268fba2f91144a584606ba9c4283fe03388c13c` (el commit añade documentación al candidato de CI `9e47eb8`). El manifiesto privado registra hashes de 267 archivos pertinentes y compara la huella antes/después de cada corrida. Docker Desktop 4.86.0 usa Engine 29.7.2, backend Linux/WSL, 12 CPU y 16.520.806.400 bytes de memoria. Esos recursos permanecieron iguales.

Cada corrida conserva el perfil existente: 50 solicitudes secuenciales y 50 a concurrencia cuatro, una prueba visible y una oculta, cápsulas nuevas, arranque frío de API por perfil, muestras frías/calientes y p95 nearest-rank <5.000 ms. La preparación reinicializa exclusivamente la BD TEST aislada. Los servicios DEV y sus volúmenes se conservan.

El inventario inicial contenía 30 contenedores persistentes: 28 en ejecución, uno en reinicio continuo y uno detenido. Para B se pausaron 25 contenedores de tres entornos Supabase DEV y se detuvo temporalmente su contenedor vector ya defectuoso. Se conservaron los tres servicios de comunicación que no participan en TEST y el contenedor originalmente detenido. La selección utilizó IDs completos, proyectos, imágenes y políticas de reinicio; el journal registró cada acción antes de enviarla y su respuesta. Los informes usan campos permitidos y permanecen privados.

Las 26 acciones se revirtieron al terminar B. La verificación adicional confirmó identidad, política, estado y recuperación de la salud de todos los servicios originalmente saludables. El vector volvió a su comportamiento previo; este ensayo no corrige su falla ni promete reproducir exactamente un estado transitorio, uptime o contador de reinicios.

## Resultados previos al reinicio

| Condición                                  | Finalización UTC | p95 C1 (ms) | p95 C4 (ms) | Resultado                                             |
| ------------------------------------------ | ---------------- | ----------- | ----------- | ----------------------------------------------------- |
| A1, carga original                         | 19:19:10         | No medido   | No medido   | La API no llegó a readiness en 30 s; cero solicitudes |
| A2, recuperación del arranque, misma carga | 19:26:27         | 3.938,99    | 12.602,30   | 100 válidas; falla p95 C4                             |
| B1, carga reducida                         | 19:32:24         | 2.586,10    | 5.772,32    | 100 válidas; falla p95 C4                             |

A1 permanece conservada como falla de preparación. A2 es una repetición delimitada para obtener una línea base después de ese arranque fallido; no se amplió el timeout ni se sustituyeron muestras. A2 y B1 conservaron limpieza, imagen y fuentes, 50 correlaciones completas y 2.000 eventos por perfil, cero rechazos y cobertura de los workers RUN/SUBMIT. B2/B3 no se ejecutaron porque B1 falló.

En C4, A2 tenía 49/50 solicitudes de al menos cinco segundos; B1 conserva ocho, índices 0–3 y 41–44. La mejora no se limita al arranque. El p95 HTTP disminuyó aproximadamente 54,2 %, pero no acredita el gate.

| p95 C4 (ms)                                            | A2        | B1       |
| ------------------------------------------------------ | --------- | -------- |
| Lifecycle                                              | 10.955,68 | 4.953,93 |
| Runtime                                                | 1.352,01  | 816,12   |
| Creación, suma entre las dos cápsulas de cada petición | 2.649,72  | 929,49   |
| Inicio, misma agregación                               | 3.479,22  | 1.634,04 |
| Eliminación, misma agregación                          | 872,02    | 454,99   |

Estos percentiles no se suman. Las fases anidadas y las esperas/streams pueden solaparse. La secuencia A/B y el calentamiento conservan factores de confusión; el ensayo no identifica una causa única ni un contenedor causante.

La CPU activa media de VM en C4 pasó de 54,17 % a 56,51 %, mientras iowait bajó de 2,55 % a 1,59 %. En `sde`, el delta de sectores escritos cambió de 428.088 a 408.504 y `writeMs` de 103.356 a 36.121. Los perfiles tienen distinta duración y estos contadores son globales, tomados en sus extremos; no son mediciones por petición. `weightedIoMs` no equivale exclusivamente a espera en cola. La memoria disponible estuvo cerca de 11 GB y swap sin uso en ambos extremos; no se ajustó RAM/CPU por falta de evidencia de agotamiento de memoria.

## Reinicio separado y perfil C

Se restauró B antes de reiniciar Docker Desktop una sola vez. La CLI confirmó el reinicio entre 19:34:45,988 y 19:35:10,261 UTC (unos 24,27 s). También interrumpió temporalmente los servicios de comunicación preservados durante B. Dos lecturas estables confirmaron la misma configuración del daemon.

La comprobación inicial encontró dos servicios Auth reiniciándose durante el arranque de sus dependencias y no certificó la restauración. Una inspección posterior confirmó que ambos recuperaron salud; la recuperación verificó los 30 IDs y sus estados/políticas originales, con cero acciones adicionales de start/stop, estados inciertos o fallas de journal. El contenedor originalmente detenido permaneció detenido. Se mantuvo el reinicio continuo preexistente del vector.

C mide la carga original restaurada después de ese único reinicio. Cada serie se evalúa por separado:

| Serie | Finalización UTC | p95 concurrencia 1 (ms) | p95 concurrencia 4 (ms) | Resultado                           |
| ----- | ---------------- | ----------------------- | ----------------------- | ----------------------------------- |
| C.1   | 19:40:54         | 2.645,95                | 4.430,16                | 100 válidas; aprueba ambos perfiles |
| C.2   | 19:44:47         | 2.310,30                | 4.983,38                | 100 válidas; aprueba ambos perfiles |
| C.3   | 19:48:39         | 2.112,05                | 3.937,19                | 100 válidas; aprueba ambos perfiles |

La serie C.2 tiene un margen concurrente de solo 16,62 ms; dos solicitudes superaron cinco segundos (5.019,31 y 5.065,23 ms). El requisito es p95 y su cálculo incluye esas muestras. No se usa un promedio entre series ni se interpreta p95 como máximo. El dispositivo de la VM pasó de `sde` a `sdg` después del reinicio; no se equiparan sus contadores sin verificar el mapa físico.

Las tres series consecutivas aprobaron por separado y conservaron las 300 respuestas HTTP 201 válidas, limpieza, fuentes e imagen. Cada perfil conserva sus 50 correlaciones completas y 2.000 eventos, cero rechazos y cobertura de ambos workers. La revisión independiente recalcula nearest-rank desde las muestras originales; no descarta fallos ni agrupa series.

**RNF-REN-02: objetivo de latencia comprobado localmente en el perfil C, con la carga original restaurada después de un reinicio.** A2 y B1 conservan sus incumplimientos. El margen estrecho de C.2 y la variación anterior limitan la conclusión: el reinicio acompañó una mejora verificable, pero no establece una causa única ni garantiza futuras mediciones. Conviene detener los entornos de desarrollo que no se utilicen antes de medir y registrar esa condición; la pausa B por sí sola no cumplió el objetivo.

La última verificación confirmó nuevamente los 30 contenedores originales, sus estados/políticas y la salud de los originalmente saludables, con cero cápsulas propias o servicios TEST pendientes. El vector conserva su falla previa. No se cambiaron RAM/CPU, versiones, transporte Docker, código de aplicación ni límites. La [CI Linux](https://github.com/marcnunezs/alunza-edu/actions/runs/37041475335) continúa como validación independiente del mismo código de ejecución, con su propia imagen y entorno. Vercel Sandbox productivo, ambiente híbrido real y aceptación académica CAPSTONE permanecen pendientes.

## Evidencia privada

Los reportes A/B/C y la comparación de fases están en `.local/reports/docker-desktop-20261002T1925/`. El nombre de la carpeta es un identificador; los timestamps efectivos de cada operación están en sus registros. El journal de reinicio está en `.local/reports/docker-desktop-restart-20261002T1935/`. Los helpers, registros y logs saneados están ignorados por Git; se preservan los fallos y reportes anteriores. Ningún volumen ajeno se reinicializó o eliminó y no se modificaron políticas de reinicio ni recursos globales.
