# SUBMIT y cierre integrado de IMP-05.01–05.02

## Resultado del 04/10/2026

`npm run ci:verify` terminó con salida 0 y **17/17 controles aprobados** en
Windows/Docker. El informe se registró el 04/10/2026 a las 19:46:25 UTC
(16:46:25 en America/Santiago). Las duraciones registradas de los controles
suman 3.416.975 ms, aproximadamente 57 minutos.

Esto cierra técnicamente IMP-05.01–05.02 de forma local. La aceptación académica,
CI Linux, Azure OpenAI real y Vercel Sandbox real siguen pendientes. El FAIL
histórico de 5.620,75 ms y el FAIL diagnóstico nuevo no se eliminan ni se
convierten en aprobados.

## Implementación del diagnóstico

- `scripts/practice-performance.mjs` acepta `--continuous-diagnostics` únicamente
  para SUBMIT en TEST. El perfil normal conserva la instrumentación de aceptación.
- Cada solicitud conserva inicio/fin monotónico y UTC, con lecturas de reloj
  acotadas por dos lecturas monotónicas y su incertidumbre. El canal privado
  `TEST_SUBMIT_CLOCK` requiere ambiente TEST y ambos flags de diagnóstico.
- `scripts/submit-continuous-diagnostics.mjs` usa un tick de un segundo,
  un lector persistente de `/proc` en el contenedor fijo de BD TEST y un stream
  persistente `docker stats`. No lanza un `exec` por muestra ni solapa lecturas.
- Host y VM conservan contadores numéricos de CPU y memoria; VM añade iowait,
  swap y discos. Windows declara load average no disponible. Grupos Docker
  ausentes conservan `unavailable` y valores `null`; un cero observado sí es cero.
- Buffers, dispositivos, registros y huecos tienen límites. El informe registra
  rechazos, descartes, retrasos, reinicios de contadores, costos de lectura y
  parsing. Los fallos del colector conservan las solicitudes HTTP.
- El cierre es idempotente y acotado. La VM exige ACK y cierre del cliente;
  una terminación incierta libera referencias propias y conserva
  `cleanupVerified=false`. Esa limpieza participa del resultado diagnóstico.
- `scripts/submit-environment.mjs` registra configuración Docker efectiva y una
  huella opaca del inventario ajeno a TEST, incluyendo estado/pausa. Las consultas
  read-only tienen timeout de 10 s y salida combinada máxima de 2 MiB mediante
  `scripts/submit-docker-observation.mjs`.
- `scripts/submit-diagnostic-comparison.mjs` recalcula nearest-rank desde todas
  las muestras, incluidas fallidas, valida condiciones equivalentes y conserva
  solicitudes que definen p95 y todas las que alcanzan 5.000 ms.

No se añadieron dependencias, migraciones ni APIs públicas para el diagnóstico.
Se conservaron cuotas del perfil, contratos y límites de 3 s, 128 MiB y 64 KiB.
No hubo reinicios globales, pausas de servicios ajenos ni cambios de recursos.

## Línea base y comparación delimitada

Configuración observada: 12 CPU, 16.520.810.496 bytes de memoria de la VM
(aproximadamente 16,52 GB), Docker 29.7.2, driver `overlayfs`, kernel
`6.18.40.1-microsoft-standard-WSL2`. Node 24.21.0, npm 11.19.0,
Supabase CLI 2.101.0 y Compose 5.3.1. Se conservaron los servicios ajenos.

A y B utilizaron la misma solución de referencia, una prueba visible y una
oculta, 50 solicitudes seriales y 50 con concurrencia cuatro, la huella
`b881864c6f94bd5b25201a754da0ba550dcab5200b20584c461d7c9adaf8e1dc`
y la imagen local preparada
`sha256:01abb77cdac04fc9156a8cee098e3d1b0b3943d91a85778c5f835550c8a84fd2`.
Sus comprobaciones de candidato, imagen, configuración/inventario al inicio y
fin, cobertura de fases y limpieza aprobaron.

| Corrida | Comando                                                                  |  p95 serial |      p95 c4 | Respuestas válidas | Resultado                 |
| ------- | ------------------------------------------------------------------------ | ----------: | ----------: | -----------------: | ------------------------- |
| A       | `npm run test:practice:performance -- --submit`                          | 2.313,47 ms | 4.837,99 ms |            100/100 | PASS                      |
| B       | `npm run test:practice:performance -- --submit --continuous-diagnostics` | 2.883,46 ms | 5.271,86 ms |            100/100 | FAIL de latencia paralelo |

B conserva ocho solicitudes paralelas de al menos 5.000 ms. La diferencia B−A
fue +24,64 % serial y +8,97 % paralela. Como A precedió a B sin alternancia ni
réplicas, esas diferencias no identifican el costo causal del observador.
La huella de inventario tampoco iguala la carga efectiva de CPU.

En B, host y VM tuvieron observaciones válidas sin fallos; ambos lectores
confirmaron limpieza. Docker fue parcial: 61 registros inválidos seriales y
134 paralelos. No se transformaron en ceros. Se observaron 100 anclas API por
perfil, sin rechazos de formato; la alineación fue válida en 49/50 solicitudes
seriales y 50/50 paralelas. Un salto detectado impidió alinear el índice serial
14, conservando su solicitud de 1.908,02 ms en la latencia.

La primera comparación conserva cobertura y alineaciones; después se amplió
la proyección para retener también las anclas numéricas API/arnés, sin IDs,
y explicitar que las cápsulas no están atribuidas en el agrupamiento Docker.
Los focos correspondientes aprobaron antes de la CI final. La huella de esta
CI corresponde a ese código final, no se presenta como otra réplica de A/B.

## Hallazgos y límites de interpretación

Las ocho solicitudes lentas de B ocupan tres ventanas cuya unión dura
aproximadamente 16,17 s de un perfil paralelo de 56,30 s. Los deltas entre
observaciones de alrededor de un segundo, prorrateados en fronteras, dieron:

| Recurso compartido       | Ventanas lentas | Resto del perfil |
| ------------------------ | --------------: | ---------------: |
| CPU ocupada host         |         99,43 % |          97,14 % |
| CPU VM excluyendo iowait |         62,21 % |          62,88 % |
| Iowait VM                |          1,46 % |           1,54 % |
| Memoria libre host       | 10,40–10,78 GiB |  10,38–10,90 GiB |
| Memoria disponible VM    | 10,44–10,55 GiB |  10,46–10,57 GiB |
| Swap VM usado            |           0 MiB |            0 MiB |

Estos valores describen recursos compartidos; no atribuyen consumo a una
solicitud o proceso. La captura no identifica qué proceso explica la CPU alta.
El disco observado tampoco mostró un aumento de ocupación en las ventanas
lentas. No se justifica una intervención sobre un servicio ajeno concreto.

Los grupos Docker se forman por sufijo de proyecto Supabase. `other` incluye
cápsulas no atribuidas y otros contenedores, por lo que no equivale a carga ajena.
Sus porcentajes se expresan respecto de un núcleo. Las marcas del stream
registran recepción/publicación; no reconstruyen el intervalo interno usado
por el daemon para calcular CPU. Las observaciones VM/host conservan el
intervalo de lectura del contador, no el consumo individual de una solicitud.

El p95 paralelo de Docker `create/start/wait/supervisor` cambió de
795,10/1.434,16/1.550,30/784,47 ms en A a
795,55/1.549,06/1.634,35/849,27 ms en B. Son percentiles independientes y no se
suman. `wait` se solapa con streams; `submission.execute` incluye las fases
Docker. Las duraciones derivadas del supervisor se publican después y no se
convierten artificialmente en spans históricos.

Ninguna de las ocho solicitudes lentas registró solapamientos de reconciliadores.
B sí los registró en otras 13/50 solicitudes paralelas. Su ausencia no prueba
inactividad: un trabajo aún abierto al cerrar la API puede no haber publicado
su span. La comparación no demostró espera IPC ni una causa concreta que
justificara cambiar el ejecutor. El keep-alive y la espera concurrente ya
existían. Se pasó a la CI completa sin una corrección especulativa de ejecución.

## Verificación y CI final

Los comandos npm/Node se ejecutaron tras `. ./scripts/use-node.ps1`.

- API: foco de observabilidad/SUBMIT, 145/145; lint, formato y tipos aprobados.
- Nuevas suites: comparación 35/35, consultas Docker 17/17 y colector final
  44/44. El foco conjunto reloj/colector final aprobó 79/79.
- `npm run test:preproduction`: 474/474 antes de los tres casos finales;
  estos quedaron integrados en `npm test` de la CI final.
- Primer smoke real del colector: limpieza confirmada, host/VM válidos y
  controles ANSI de Docker contados como inválidos. El parser se corrigió
  para descartar controles vacíos. La comprobación real de formato confirmó
  87 líneas JSON válidas, tres controles vacíos y cero datos inválidos.
- Segundo `node .local/submit-collector-smoke.mjs`: host 10, VM 10 y Docker
  nueve observaciones válidas, cero rechazos/huecos y limpieza confirmada.
- Un foco inicial de reloj falló por expansión de arrays en `test.each`;
  se corrigieron las tuplas y se conservaron los casos negativos.
- `npm run ci:verify`: una corrida íntegra sobre el candidato final, 17/17.
  Incluye formato, lint, tipos, 1.552 pruebas en seis grupos, preparación,
  doctor/probe Docker, fixtures académicos, instalación Cypress, integración,
  RUN, tres SUBMIT, integración IA, E2E y evaluación TEST.

| Serie SUBMIT consecutiva de CI |  p95 serial |      p95 c4 | Muestras por perfil | Fallos |
| ------------------------------ | ----------: | ----------: | ------------------: | -----: |
| 1                              | 1.827,90 ms | 3.792,36 ms |                  50 |      0 |
| 2                              | 1.824,69 ms | 3.250,55 ms |                  50 |      0 |
| 3                              | 1.945,19 ms | 3.297,92 ms |                  50 |      0 |

Se recalcularon los seis p95 desde las muestras, posición 48 de 50. Cada perfil
conserva 50 índices únicos, 2.000 eventos de fase y cobertura 50/50, sin fases
fallidas ni rechazos. Todos verificaron limpieza y estabilidad de imagen,
candidato y configuración/inventario al inicio y fin. RUN también aprobó
50+50 con p95 de 1.096,30/1.927,56 ms.

La preparación normal de imagen dentro de CI generó el digest
`sha256:ce40007fae73d2162e085b0cb450bb85e779cd269d7cd59462faf2d87146e767`.
RUN y las tres series SUBMIT conservaron ese digest. Su huella de código fue
`442fcb496695071b0b76fb315cf0dc316c33c6616994c01db47da6ee93f34cb3`,
también presente en el plan de evaluación TEST. No se atribuye la mejora de
latencia al cambio de digest. Next regeneró `next-env.d.ts` para `.next-e2e`;
se conservó la generación y no hubo ediciones manuales durante la corrida.
La documentación de cierre se actualizó después.

La misma CI aprobó 152/152 HTTP, 545 aserciones SQL en 11 archivos y
49/49 Cypress sin fallos/omitidos. Evaluación TEST: 100/100 ayudas seriales,
100/100 a concurrencia cuatro, 234 muestras, 763 recibos, tres reanudaciones,
cobertura 43/43 y cero llamadas externas. Sus p95 cliente fueron
772,35/2.792,07 ms. Esto no establece calidad pedagógica ni aceptación humana.

## Evidencia conservada

- `.local/reports/imp-05/ci.json` y su historial: ejecución completa.
- `.local/reports/imp-05/submit-integrated-closure.json`: índice y verificación
  de las tres series históricas de CI, con nearest-rank recalculado.
- `.local/reports/imp-05/submit-baseline.json`, `submit-continuous.json` y
  `submit-comparison.json`, con sus historiales: A/B, incluido el FAIL de B.
- `.local/reports/imp-05/submit-collector-smoke.json` y su historial: ambos
  ensayos del colector, incluido el primer diagnóstico parcial.
- `.local/reports/imp-03-submissions/history/submit-performance-*.json`:
  muestras y fases de todas las series, incluidos los FAIL anteriores.
- `.local/reports/imp-05/integration.json`, `e2e.json` y
  `.local/reports/imp-04/evaluation-test.json` / `evaluation-measurements.json`:
  resultados integrados de esta corrida; los archivos históricos conservan los
  resultados del 02/10/2026.

El [registro del corte](IMP-05-progress.md) y la
[trazabilidad](../plan/09-control-y-trazabilidad.md) distinguen este cierre
técnico de los pendientes académicos y remotos. IMP-05.03–05.08 siguen fuera
de este corte.
