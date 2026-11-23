# IMP-03.04–03.06 — Envíos, historial y avance

Implementación autorizada por el usuario el 26/09/2026: «implementa este plan»,
referida al [plan de envíos](IMP-03-submissions-plan.md). Estado: **implementado y
probado localmente**. CI de catorce etapas aprobada el 26/09/2026 a las 23:31:08Z.
Autor: Codex. Base Git `7c6e740`, rama `laboratorio`, conservando el árbol previo
de RUN y la planificación sin commit. No acredita aceptación humana ni remota.

El alcance es SUBMIT durable, historia propia con comparación/reintento y avance
mínimo. DEC-002 está resuelta: admitidos antes del cierre pueden persistir después,
nuevas admisiones posteriores se rechazan y la entrega exige acceso vigente.
IA, señales, tablero y Vercel Sandbox productivo conservan sus fases posteriores.

## Trabajo y comprobación

Contratos públicos y privados separados; diccionario previo al DDL en
[diccionario de envíos](IMP-03-submissions-dictionary.md). Migraciones aditivas,
sin regenerar el proyecto ni modificar migraciones previas. El entorno TEST se
orquesta de forma exclusiva para no interferir con DEV.

## Implementación

- Contratos `submissions.ts` y OpenAPI 0.3.1: envío, intento, historia paginada y
  avance propio; fuente hasta 65536 bytes y cuerpo HTTP hasta 512 KiB. El cliente
  no puede aportar resultados, identidad, tests ni límites.
- Migración incremental `20260926215711_practice_submissions.sql`: reserva privada,
  intento inmutable, resultado privado canónico y dos eventos atómicos
  `ATTEMPT_SUBMITTED`/`EXECUTION_COMPLETED`. RLS propia, aislamiento de ámbito,
  funciones internas con privilegios mínimos y sin acceso privado de navegador.
- Admisión serializada con cierre, cupos RUN/SUBMIT compartidos, suite completa
  derivada del servidor y ejecución Docker fuera de la transacción. La proyección
  pública excluye identidad, consola y expectativas de las pruebas ocultas.
- Evidencia normalizada durable antes de la transacción final. Un reconciliador
  recupera el resultado existente o UNKNOWN operativo sin reejecutar; exige
  limpieza de la cápsula e impide escribir al titular de un lease vencido. La revocación
  puede impedir entregar la respuesta sin destruir la evidencia ya admitida.
- Confirmación accesible con código capturado, hasta dos envíos intencionales,
  recuperación por la misma clave y borrador intacto. Pendientes separados por
  cuenta/organización/clase/asignación/versión y clave de operación; snapshots
  locales duran treinta días, con fallback en memoria cuando no está disponible
  el almacenamiento. Completar un envío en otra pestaña conserva los demás.
- Historia de veinte registros como máximo por página, orden estable de admisión,
  detalle persistido, comparación visible solo entre suites compatibles y copia
  confirmada al reemplazar un borrador. Respuestas tardías no cruzan cuentas.
- Una única función SQL calcula avance por asignación/versión. RUN no cuenta;
  ocultas fallidas no completan; un fallo posterior no elimina éxito anterior.
  La web distingue falta de intentos, ausencia de ejercicios requeridos y error.

## Evidencia del corte

La CI final `npm run ci:verify` aprobó **14/14 etapas**. Incluye formato, lint y
tipos; **444 pruebas** (145 API, 21 web, 82 contratos, 101 runner, 60 IA y 35
preproducción); **69 casos Docker** y **20 verificaciones del banco canónico**.
La integración aprobó **110/110 HTTP y 285 aserciones SQL**, incluidas 104 de
SUBMIT, más caída/recuperación real de BD. Supabase Security Advisors no encontró
hallazgos. Chrome aprobó **35/35 recorridos**, incluidos los seis nuevos; builds,
escaneo de artefactos y regresión IA también aprobaron. Los perfiles RUN/SUBMIT
incluyen doscientas respuestas correctas y limpieza verificada.
El ejemplo SUBMIT del spec 07 valida contra el schema ejecutable.
Esta evidencia nueva consta en `.local/reports/imp-03-submissions/ci.json`,
`integration.json` y `e2e.json`; no se atribuye a resultados históricos de RUN.

Los nuevos casos HTTP en `zzzzz-submissions.test.cjs` cubren entrada inválida,
los seis diagnósticos, secretos ocultos, permisos/RLS, éxito previo, paginación,
dos envíos concurrentes, idempotencia, caducidad, commit fallido, recuperación,
revocación y cierre. Los seis Cypress `IMP03-06`–`IMP03-11` cubren cancelación y
teclado, copia/comparación, pérdida de respuesta y sesión renovada, respuestas
invertidas, cambio de cuenta y reinicio real de API antes de recuperar.

La CI de cierre consta de catorce etapas. Usa TEST aislado y reportes en
`.local/reports/imp-03-submissions/`; el cierre RUN anterior se conserva en
`.local/reports/imp-03/`. Cada perfil de rendimiento usa cincuenta solicitudes
secuenciales y cincuenta a concurrencia cuatro, con cápsulas nuevas; SUBMIT
incluye suite visible/oculta y commit. La frecuencia se eleva a cien únicamente
en este perfil aislado para medir latencia, conservando el cupo organizacional.
Todas las muestras y fallos cuentan para el p95 por rango más cercano.

Los perfiles finales con `imp-03-quickjs.4` aprobaron el objetivo local de menos
de cinco segundos; cada fila incluye cincuenta solicitudes, sin errores y con
limpieza confirmada. No se reutilizan cápsulas. «Frío» identifica solo el primer
lote tras reiniciar API; «caliente», las siguientes solicitudes del mismo perfil.

| Operación | Concurrencia | p95 total (ms) | Frío (ms) | Caliente (ms) |
| --------- | ------------ | -------------- | --------- | ------------- |
| RUN       | 1            | 1460,17        | 1139,94   | 1460,17       |
| RUN       | 4            | 2307,43        | 2043,04   | 2307,43       |
| SUBMIT    | 1            | 2083,26        | 1761,57   | 2083,26       |
| SUBMIT    | 4            | 4032,03        | 3060,04   | 4032,03       |

Reportes: `run-performance.json` (23:22:06Z) y `submit-performance.json`
(23:25:24Z) del 26/09/2026, dentro del directorio de este corte. Incluyen las
doscientas muestras, entorno, versiones y perfil completo.

### Fallos encontrados y corregidos

1. La migración requería propietario y CREATE temporal sobre `app_private` para
   reemplazar dos funciones RUN existentes. Se corrigió con SET ROLE y grants
   temporales revocados al final, sin ampliar permisos de `alunza_app`.
2. La regresión de fundación enumeraba el esquema anterior y no incluía `attempts`.
   La tercera corrida aprobó 109/110 HTTP, incluidos los trece casos SUBMIT; se
   actualizó la lista manteniendo las comprobaciones de propietario y FORCE RLS.
3. Revisión previa a aceptación: reestablecer contexto de organización dentro de
   la transacción de admisión, conservar evidencia válida si la limpieza es
   incierta, validar FAILED_TEST completo y consumir una confirmación una sola
   vez. Se añadieron casos que comprueban esos límites.
4. Al añadir ventanas y avance entre versiones, el rollback del último savepoint
   restauraba el contador interno de pgTAP: emitía 104 pruebas aprobadas pero
   declaraba 92. Se conserva ese savepoint hasta `finish()` y el rollback exterior
   limpia todas las fixtures; ninguna aserción se elimina.
5. La primera medición SUBMIT completó cien solicitudes sin errores, pero el p95
   con concurrencia cuatro fue 5391,74 ms, superior al objetivo de 5000 ms.
   Se concentraron consultas repetidas de autorización en una consulta RLS por
   frontera, conservando permisos actuales y transacciones separadas. Las
   inspecciones Docker simultáneas comparten solo la consulta en curso, sin
   caché posterior. Se conserva `submit-performance-first.json`; la medición
   posterior `submit-performance-second.json` mantuvo cien respuestas válidas
   y redujo la mediana concurrente de 4366 a 3916 ms y el p95 del tiempo externo
   al runner de 948 a 603 ms. Aun así, el p95 HTTP fue 5432,59 ms: la cola lenta
   del ciclo Docker subió de 4403 a 4918 ms. La corrección de API tiene efecto,
   pero esa medición todavía no acreditaba el objetivo completo. La investigación
   del transporte local continuó sin cambiar límites, cápsulas por prueba ni
   excluir muestras; la corrección y el resultado final constan en el punto 8.
6. El array local de pendientes podía sobrescribirse entre pestañas. Cada
   operación usa ahora su propia clave; se migra el formato anterior, se purga
   por operación y completar una solo elimina su entrada. Las nuevas pruebas
   cubren dos montajes, migración, caducidad selectiva y varios pendientes. El
   caso Cypress de código capturado retiene la respuesta real hasta terminar
   la edición, evitando depender de una demora fija de un segundo.
7. La primera corrida Chrome aprobó 33/35 recorridos. El teclado de IMP02-03
   aún esperaba el orden anterior a los controles de envío/historia; IMP03-08
   recibió el 429 correcto al compartir estudiante con los casos previos.
   Se conserva `e2e-first.json` y su diagnóstico. El recorrido de teclado incluye
   ahora los controles nuevos y SUBMIT distribuye sus escenarios entre los tres
   estudiantes A adicionales de la demo, sin elevar cuotas ni borrar evidencia.
   La segunda corrida aprobó 34/35, incluidos los seis nuevos escenarios SUBMIT;
   detectó otra aserción histórica de IMP02-03 que esperaba ausente el botón
   Enviar. Se conserva `e2e-second.json` y se actualiza esa expectativa al
   comportamiento implementado, manteniendo teclado y comprobaciones de permisos.
8. El transporte Docker abría una conexión IPC por consulta. Un Agent privado
   reutiliza hasta dieciséis conexiones y cuatro libres, sin cachear respuestas
   ni reintentar mutaciones. Descarta conexiones fallidas y conserva límites y
   cancelación incluso en espera de cupo. Diecinueve pruebas IPC verifican estas
   fronteras. El ensayo comparativo de cuatro envíos por modo redujo el tiempo
   HTTP acumulado de 5159 a 3548 ms, con ocho cápsulas nuevas y limpieza completa
   por modo. Esta muestra diagnóstica no acredita por sí sola el p95 HTTP.
   El perfil posterior de cien solicitudes conservó todos los resultados válidos
   pero obtuvo 5464,05 ms a concurrencia cuatro (`submit-performance-third.json`).
   La salida por Docker CLI añade alrededor de medio segundo por cápsula frente
   a su tiempo de contenedor. Se implementó el canal Engine directo con dos
   attachments para conservar salida tras EOF de entrada en Windows, espera de
   salida e inspección independiente. Cincuenta y tres nuevas pruebas IPC cubren
   framing, límites, cancelación y fallos de transporte. El ensayo Windows real
   aprobó cuatro envíos y ocho cápsulas con limpieza: 1995,75 ms por grupo frente
   a 4014,87 ms con CLI y pool. Se identifica como `imp-03-quickjs.4`, conserva
   imagen/WASM y presupuestos. Los perfiles completos de cierre constan arriba.
9. Al incorporar las pruebas IPC nuevas, lint detectó un `setImmediate` sin
   import explícito. Se corrigió desde `node:timers`; el informe
   `ci-third.json` conserva ese rechazo previo al arranque de las suites reales.

Los primeros diagnósticos saneados de migración y esquema se conservan bajo el
directorio de reportes de este corte; no se sustituyen por resultados exitosos.
Los conteos SQL de atomicidad se acotaron al fixture para coexistir con intentos
creados antes por HTTP; las lecturas negativas RLS siguen consultando todas las
filas para detectar cualquier filtración.

## Reproducción y límites

Preparar Node, Docker, imagen runner y fixture según README. En el editor de una
actividad publicada, ejecutar primero sin avance; enviar una solución que pase
solo visibles; recargar y consultar historial; copiar, corregir y confirmar un
nuevo envío; comprobar ambos intentos y avance. La suite E2E crea un fixture
propio por caso y no depende del orden de las pruebas ni de datos reales.

`npm run db:migrate` aplicó la migración en DEV, sin reset ni reseed. El primer
ensayo encontró la API DEV detenida, sin crear reservas ni intentos; la causa
exacta del cierre de los watchers no quedó acreditada. Un arranque API aislado
respondió correctamente a catorce verificaciones de salud. Tras los builds de
aceptación se restauró `npm run dev`; la primera recompilación del watcher
reinició la API durante un envío y cortó su conexión. Se conservan ambos ensayos
en `dev-smoke-first.json` y `dev-smoke-startup-reset.json`.

El recorrido DEV final aprobó el 26/09/2026 a las 23:34:37Z, registrado en
`dev-smoke.json`. Recuperó la clave del envío interrumpido como un único intento
UNKNOWN, sin reejecutarlo ni eliminarlo. Después, dos nuevos envíos intencionales
produjeron FAILED_TEST por ocultas y SUCCESS, respectivamente. La repetición de
transporte del éxito devolvió el mismo intento; el historial conservó los tres,
el detalle del fallo permaneció igual y el avance terminó en 1/2 ejercicios.
RUN no alteró el avance. DEV queda activo en web `http://127.0.0.1:3200` y API
`http://127.0.0.1:4200`, con los datos de demostración y sus intentos conservados.

Este corte no acredita Vercel Sandbox, región híbrida, despliegue remoto,
retención institucional ni aceptación CAPSTONE humana. No habilita IA/RAG,
calificaciones, señales ni lectura pedagógica docente/ADMIN. IMP-03.07 conserva
la integración remota, IMP-04 la ayuda y su frontera de persistencia, IMP-05 la
extensión de progreso/señales e IMP-06 el seguimiento docente.
