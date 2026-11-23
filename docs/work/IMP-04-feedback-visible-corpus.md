# IMP-04: feedback visible en navegador y preparación de revisión docente

Fecha: 18/11/2026. **Incremento local verificado; revisión docente pendiente.**

La campaña final completó 100 ayudas en serie y 100 con concurrencia cuatro,
medidas desde el clic hasta el contenido visible: p95 de 1.305,3 y 4.954,8 ms.
La primera campaña detectó un defecto de ritmo del evaluador; se conservó,
se corrigió la reserva de cuota y se repitió en una corrida nueva. El cuaderno
docente prepara la revisión del diseño, sin atribuir juicios humanos.
No hubo llamadas Azure, ampliación de límites, despliegue ni contratación.

Trazabilidad: RF-006/010/012/013/014/025, HU/CU/PT-012 y 013,
RNF-REN-03/04, RNF-IA-01–04 y DEC-010. Se conserva la separación entre diagnóstico
determinista persistido, ayuda contextual y aceptación pedagógica humana.

## Implementación preparada

El evaluador existente conserva sus cuatro etapas, presupuestos, corpus,
calibración y journal. La instrumentación del navegador se incorpora a los
perfiles de latencia; no genera una segunda carga de solicitudes de ayuda.

| Archivo                                      | Responsabilidad en este incremento                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/evaluation-browser-integration.mjs` | Lanzador TEST exclusivo, preflight de solo lectura, corrida nueva, consumidores propios, conservación histórica y cierre verificable. |
| `scripts/evaluation-browser-driver.mjs`      | Chrome por CDP, acción en la interfaz, admisión y contenido visible de la misma solicitud.                                            |
| `scripts/evaluation-browser-evidence.mjs`    | Verificación de artefactos, SHA-256, identidades, perfil, contenido, visibilidad y tiempos.                                           |
| `scripts/evaluation-teacher-review.mjs`      | Cuaderno legible y plantilla vacía para revisar fuentes, casos y etiquetas autorales.                                                 |
| `scripts/evaluation-readiness.mjs`           | Integra esa preparación docente al expediente offline; no autoriza inferencia ni mide respuestas.                                     |

`evaluation-client.mjs` guarda la identidad admitida antes de esperar la
presentación y consulta después la API canónica para contrastar el resultado.
Un replay `DONE` reutiliza la evidencia persistida sin volver a llamar al
navegador ni enviar otra solicitud de ayuda. Una interrupción conserva la clave
y el identificador disponibles; la recuperación no convierte visibilidad
ausente en una muestra completa.

El reporte exige, por perfil, 100 observaciones verificadas correspondientes a
25 intentos con feedback y pistas 1–3. Verifica unicidad de solicitudes,
feedbacks y claves de operación, además de separación entre perfiles. Rechaza
artefactos falsos, modificados, duplicados, incompletos o incongruentes. El p95
debe ser menor que 12.000 ms. Las medidas HTTP históricas siguen siendo
insuficientes para acreditar presentación en navegador.

La observación contiene identidad de corrida, candidato, corpus, actor,
intento, solicitud y feedback; hashes del contenido; tiempos de acción,
respuesta y presentación; documento y geometría visibles; y dos fotogramas de
renderizado. El artefacto local se liga al reporte por SHA-256. Los campos de
observación no sustituyen autorización de API ni modifican el resultado técnico.

## Entorno y conservación

Esta medición ocurre en **TEST local del Lenovo**, proyecto
`alunza-edu-laboratorio-test`, con Auth/DB en 18421/18422, API 4300,
web 3300 y listener operacional 4401. El ejecutor de este perfil es Docker.
No es una campaña KVM del Ryzen ni una campaña LAB-EVAL/Azure. El lanzador
rechaza destinos incompatibles antes de preparar solicitudes.

Se prepararon los servicios y datos de manera aditiva, antes de congelar el
candidato:

- Se iniciaron los servicios TEST conservando sus volúmenes. DEV ya estaba
  activo y no pertenece a esta campaña.
- Se aplicaron únicamente las cuatro migraciones que faltaban. El recibo
  `migrations-verified.json` acredita conservación de las filas previas de
  **72 tablas**; `db-before-migrations.json` conserva la referencia anterior.
- Se incorporó el fixture académico necesario con seis usuarios Auth nuevos,
  sin permitir actualizaciones de usuarios existentes. El recibo
  `academic-fixture-verified.json` y los inventarios
  `rows-before-academic-fixture.json` / `rows-after-academic-fixture.json`
  acreditan conservación de las filas previas de **77 tablas**. No se ejecutó
  un reset general de la base.
- El preflight comprobó las 29 migraciones, 12 actores, tres clases, ocho
  membresías y cuatro conceptos usados por la preparación. La columna real
  de embeddings es `vector` sin dimensión fija en el esquema; se comprobó
  compatibilidad de perfiles, generaciones y dimensiones efectivas cuando
  existen filas, sin cambiar el esquema para superar el control.
- API y web se compilaron correctamente antes de la campaña. La web utiliza
  configuración TEST explícita; su registro está en `web-build.log`.

Todos esos recibos están en
`.local/evaluation-browser-preparation-20261118/`. El lanzador de navegador no
aplica migraciones, no reconstruye la base y no crea el fixture académico.
Cada nueva campaña usa un directorio exclusivo y conserva las evidencias
anteriores. Durante una medición se mantienen congeladas las fuentes.

## Pruebas verificadas antes de la campaña corregida

El recibo `evaluation-tests-final.json`, en el directorio de preparación,
registra **13 suites y 232 pruebas aprobadas**, sin fallos ni pendientes.
Incluye las pruebas de flujo, evidencia del navegador, driver, preparación
offline y revisión docente, además de las regresiones del evaluador existente.
Es el conjunto focal de evaluación; no se presenta como una ejecución nueva
de toda la CI del repositorio.

Las pruebas incluyen admisión durable antes de presentación, replay sin
llamadas adicionales, interrupción con identidad conservada, rechazo de
observaciones incompletas, unicidad dentro y entre perfiles, compatibilidad
del esquema real de vectores y destino TEST estricto. Los nuevos negativos de
ritmo de solicitudes reproducen reservas pendientes, confirmación al recibir
202, rechazo 429 sin repetición automática y recuperación con la misma reserva.

## Primera campaña: fallo preservado

Corrida: `c81db577-da29-4853-a6bc-dba4980f55a1`.
Directorio: `.local/eval-runs/c81db577-da29-4853-a6bc-dba4980f55a1/`.

La campaña terminó `FAILED` en EVALUATION por
`BROWSER_HELP_ADMISSION_FAILED`: tres solicitudes de pista 2 recibieron HTTP
429 antes de obtener un identificador. Se conservaron **157 muestras**:
cuatro funcionales, 30 adversariales, 100 en serie y 23 concurrentes. El ledger
registra **157 solicitudes SUCCEEDED y 532 recibos COMPLETED**; no hubo llamadas
Azure.

| Perfil              | Observaciones visibles | p95 visible | Resultado de ese perfil     |
| ------------------- | ---------------------: | ----------: | --------------------------- |
| Serie               |                100/100 |  1.374,1 ms | PASS local TEST             |
| Concurrencia cuatro |                 23/100 |  4.642,5 ms | BLOCKED: muestra incompleta |

El p95 de las 23 observaciones concurrentes es descriptivo; no acredita el
perfil de 100 ayudas ni permite declarar completa la campaña.

El diagnóstico SQL de solo lectura, guardado en `failed-run-diagnosis.json`,
comprobó que los tres actores ya tenían seis solicitudes dentro de la ventana
real de 60 segundos. No había trabajo activo de esos actores; la organización
tenía entre 14 y 21 solicitudes recientes y como máximo un trabajo activo. Por
tanto, el rechazo correspondía al límite por estudiante, no a saturación de
la organización o a una falla de generación. Ninguna de las tres pistas 2
rechazadas se persistió.

| Actor ficticio, sufijo | Primera solicitud todavía vigente | Intervalo del rechazo         | Diferencia registro de transporte → admisión SQL |
| ---------------------- | --------------------------------- | ----------------------------- | -----------------------------------------------: |
| `003`                  | 16:30:13.887 UTC                  | 16:31:12.469–16:31:12.864 UTC |                                         1.521 ms |
| `012`                  | 16:30:05.667 UTC                  | 16:31:04.612–16:31:04.998 UTC |                                         1.191 ms |
| `011`                  | 16:29:57.443 UTC                  | 16:30:56.719–16:30:57.233 UTC |                                           843 ms |

La causa estaba en el control de ritmo del arnés: iniciaba la ventana local
antes de preparar la página y realizar la acción del navegador. Así podía
retirar una reserva local antes de que expirase la solicitud real en PostgreSQL.
El producto mantuvo sus cuotas.

La corrección conserva una reserva pendiente hasta recibir la admisión 202 y
fija entonces el inicio de la ventana local. Las reservas pendientes cuentan
para evitar que otra tarea concurrente ocupe el mismo espacio. Recuperar una
admisión incierta reutiliza su propia reserva y clave, sin reservar otro espacio
ni eliminar reservas ajenas. Un 429 del navegador conserva evidencia incompleta
y termina la campaña; no se oculta mediante una repetición automática. No se
alteraron cuotas, concurrencia ni plazos de producto.

La corrida fallida se cerró por la API operacional existente, sin SQL directo
de mutación. `failed-run-closure.json` registra `STOPPED`, retirada de la API
temporal y conservación de los hashes de estos siete archivos: `plan.json`,
`prepared.json`, `authorized-manifest.json`, `report.json`, `run-journal.json`,
`teacher-review.json` y `browser-campaign-summary.json`. El diagnóstico posterior
confirmó cero pendientes de materiales, ayuda, ejecuciones, envíos, recibos y
corridas activas. Es un cierre del fallo, no una aceptación de la campaña.

## Campaña corregida: aprobada en TEST local

Corrida: `a11ea92e-2bdc-4158-9877-fa2122d459df`.
Directorio: `.local/eval-runs/a11ea92e-2bdc-4158-9877-fa2122d459df/`.
El proceso terminó con salida 0 y `PASSED`; las cuatro etapas quedaron
`DONE` y la base confirmó la corrida `COMPLETED`.

| Perfil              | Muestras válidas | p50 visible | p95 visible | p95 respuesta leída | p95 persistencia | Gate local |
| ------------------- | ---------------: | ----------: | ----------: | ------------------: | ---------------: | ---------- |
| Serie               |          100/100 |    1.241 ms |  1.305,3 ms |          1.246,9 ms |           800 ms | PASS       |
| Concurrencia cuatro |          100/100 |  2.407,2 ms |  4.954,8 ms |          4.872,1 ms |         3.628 ms | PASS       |

Ambos perfiles quedaron bajo 12.000 ms sin ampliar límites. La observación
incluye el clic de pedir ayuda, el polling real, la apertura de la ayuda
preparada y dos fotogramas con contenido y geometría visibles. No incluye
la navegación previa, el inicio de sesión ni las esperas de cuota anteriores
al clic. Chrome se ejecutó en modo headless con cuatro contextos separados
para la concurrencia; no es una medida de tiempo de reacción de una persona.

Se verificaron nuevamente los 200 archivos desde disco: 200 solicitudes,
feedbacks y claves únicos, sin observaciones ausentes o inválidas, duplicados,
fallos ni rechazos 429. Cada perfil contiene 25 intentos distintos y sus
cuatro niveles. El replay de la corrida completada conservó las 234 muestras
y los 763 recibos, sin nuevas ayudas.

La cobertura combinada alcanzó 43/43: 30 ayudas de producto, 12 casos de
candidato (siete rechazos de frontera y cinco revisiones TEST) y un caso
operacional determinista local. Esta cobertura no demuestra calidad pedagógica.
El total final comprende cuatro muestras funcionales, 30 adversariales y las
200 de latencia. Embeddings, generación y revisión siguen siendo TEST.

Identidades congeladas y verificadas antes de editar este registro:

- Candidato: `ab46aef3d4a88f01eb90b8645cc098e95928e14c919f110d022aece712c99726`.
- Corpus persistido: `fbee65083d12f96990b94afa6dad6fbc6e393120026252f10066a45d62840302`.
- Fuentes web: `7a75fee8aed9c394f7b15311024ed8e8de3815bfcf1f1db4c813aa6f84d33004`.
- Navegador: `Chrome/157.0.8103.51`; Node 24.21.0, Supabase CLI 2.101.0 y Docker 29.7.2.

`final-evidence-verification.json` conserva los hashes del reporte, journal,
plan, manifiesto, preparación, resumen y revisión de respuestas. Los reportes
históricos del 01/11 y la primera campaña mantuvieron sus bytes. El lanzador
comprobó también conservación de registros anteriores de sus doce tablas
con evidencia durable. Las muestras de las dos campañas no se combinaron.

`final-database-audit.json` confirmó 234 solicitudes SUCCEEDED y 763 recibos
COMPLETED en esta corrida, y 157/532 intactos en la anterior STOPPED. No quedó
trabajo pendiente de materiales, ayuda, ejecuciones, envíos, recibos o corridas.
API, Next y Chrome propios terminaron; se comprobó cero procesos Chrome de
ambas campañas y ausencia del lock de integración.

`final-shutdown-verification.json` confirmó TEST detenido con sus dos
volúmenes presentes, ocho contenedores DEV con los mismos IDs y estados,
puertos propios libres y hashes de evidencia final conservados. No se
reinició ni modificó el laboratorio físico Ryzen.

## Revisión docente: expediente offline

El expediente de esta entrega está en
`.local/eval-preparation/teacher-review-20261118-01/`. Incluye siete archivos:
README, borrador de plan, paquete base, cuaderno `teacher-corpus.md`, plantilla
`teacher-design-review.json`, preparación y checksums. Se genera tras cerrar
las ediciones documentales; su inventario conserva doce fuentes seleccionadas
y sus hashes. La verificación final independiente queda en
`.local/eval-preparation-verification/teacher-review-20261118-01.json`.

El contenido conserva **12 documentos ficticios y 43 casos
adversariales**, separados de los **cuatro casos de calibración/validación**.
Incluye enunciados, código ficticio, hechos técnicos autorales, fuentes y
comportamientos esperados. Los candidatos escritos por el equipo no son
respuestas observadas de Azure. Las distancias ilustrativas no son mediciones
ni umbrales calibrados.

La revisión solicitada se refiere al diseño, las fuentes, las etiquetas y la
aplicabilidad de las seis dimensiones de la rúbrica. Identidad del revisor,
fecha, valoraciones, decisión y desacuerdos permanecen vacíos hasta una revisión
real. La evaluación pedagógica de respuestas observadas se mantiene separada y
no ejecutada. La preparación no concede aprobación de gasto ni aceptación humana.

Antes de usar el corpus como aceptación general, conviene ampliar con un docente
la cobertura de conceptos y errores de Programación I y preservar una partición
reservada para validar. Los cuatro casos actuales permiten ensayar la mecánica
de calibración; no bastan para generalizar calidad pedagógica. Esta recomendación
no cambia las condiciones del piloto técnico mínimo ya documentado.

## Límites y siguiente trabajo

Se conservan 100 ayudas por perfil, concurrencia cuatro, límite de ayuda de
15 segundos y meta p95 menor que 12 segundos. Continúan seis admisiones por
estudiante y 60 por organización en 60 segundos, con un trabajo activo por
estudiante y cuatro por organización. No se modifican fragmentos de 500 tokens,
solapamiento 50, top-k 5 ni los límites del ejecutor: 1 CPU/2 GiB, proceso
128 MiB, 3 segundos y 64 KiB de salida.

El PASS de esta campaña acredita la integración local TEST descrita.
No acredita rendimiento Azure, calidad pedagógica, costes reales, aceptación
docente/CAPSTONE ni el mismo rendimiento en el Ryzen. Los recibos de coste y
tokens TEST son sintéticos. El resultado histórico HTTP del 01/11 conserva sus
propios límites; no se modifica para aparentar evidencia de navegador.

La [guía de reproducción](../guides/evaluacion-ayuda-navegador.md) describe
precondiciones, ejecución, artefactos y cierre. El siguiente paso es revisar
con un docente el [diseño del corpus](../guides/revision-docente-corpus.md),
reconciliar sus observaciones y acordar cobertura representativa. La revisión
de respuestas reales se mantiene como evaluación posterior e independiente.

Azure sigue pendiente de recurso, configuración efectiva de deployments,
versiones, dimensión, tokenizer, identidad, cuota, precios y autorización
correspondiente. LAB-EVAL y el perfil físico del Ryzen mantienen su separación;
no cambiar etiquetas ni debilitar guardas para intercambiarlos.
