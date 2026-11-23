# Control, dependencias y trazabilidad del plan

**Estado inicial de todas las fases e incrementos: pendiente.** Se conservan los cortes históricos IMP-00; el corte institucional IMP-01 se documenta por separado. Este registro acompaña el [plan progresivo](README.md). No sustituye las matrices normativas de [funcionalidad](../../specs/02-requisitos-funcionales.md), [escenarios](../../specs/03-flujos-y-criterios-de-aceptacion.md) y [calidad](../../specs/10-calidad-y-pruebas.md).

## Auditoría IMP-07.01 — 03/11/2026

La actualización [IMP-03.07](../work/IMP-03-sandbox.md) añade implementación
local y comprobaciones de recuperación a la matriz, conservando sus brechas
de preproducción. La evidencia del incremento no reemplaza el baseline auditado.

El [registro de cobertura](../work/IMP-07-coverage.md) y la
[matriz estructurada](../work/IMP-07-coverage-matrix.json) consolidan las 163
obligaciones con pruebas identificables o brechas explícitas. La base auditada
es `b12fb6f`; los resultados históricos mantienen su candidato y los nuevos
controles no transfieren esos resultados al árbol modificado. Los cortes de
esta página conservan sus estados de origen. Para planificar trabajo nuevo,
consultar la matriz y sus pendientes, no inferir estado vigente de una tabla
histórica. .04 y aceptación integral/humana/remota siguen pendientes.

## Corte local IMP-06.05 — 02/11/2026

Implementada la lectura administrativa RF/HU/CU/PT-027, E1–E3 en consulta: API NestJS, entrada SQL autorizada, allowlist de ocho campos y visor UX-19 con filtros exactos, corte y paginación estable. Se conserva el historial append-only y se registra la consulta en el canal operativo separado.

El [registro .05](../work/IMP-06-audit-read.md) acredita localmente 9 HTTP, 1.419 aserciones SQL, upgrade .04→.05, 8 Cypress y rendimiento con 10.000 eventos A/1.000 B, sin errores. Incluye controles de tipos, lint, formato, build, artefactos, suites unitarias/contratos y evidencia conservada de correcciones. No acredita RF-027 completo: CSV .06 y aceptación integrada .07 siguen pendientes. El cierre/campañas detenidos de .04 no se reanudaron; no hay CI integral ni aceptación humana/remota atribuida a este corte.

## Corte local IMP-00.01–IMP-00.04 — 10/09/2026

| Incremento | Implementación | Prueba local e integración | Aceptación / límite |
| --- | --- | --- | --- |
| IMP-00.01 | Versiones exactas, npm workspaces/lockfile y Node portable | Instalación, Nest TestingModule/Jest, tipos y builds Windows/Linux comprobados | DEC-007 probado localmente; CI pendiente |
| IMP-00.02 | Web Next separada de API Nest, navegación Estado/Acceso y Compose | Navegador real con tres roles, teclado/móvil, API caída y reintento; builds y arranque Compose healthy | Revisión humana pendiente; base técnica, sin capacidades académicas |
| IMP-00.03 | Supabase CLI, diccionario provisional, migración/RLS/rol limitado y fixture2/6 | Migración vacía, seed repetido, SQL/RLS y motor17.6/pgvector0.8.0 reales | DEC-006 provisional; Supabase publica puertos en todas las interfaces de este Docker Desktop |
| IMP-00.04 | JWT ES256, contexto transaccional, cuatro rutas, contratos, configuración y logs seguros | Acceso permitido/denegado real, pool, estados, caída/recuperación de BD, JWT adversariales; configuración ausente rechazada y22 artefactos sin secretos locales | No completa RF-001/020/021 ni acredita entorno remoto |

Evidencia, comandos, incidencias y límites: [registro único de fundación](../work/IMP-00-foundation.md). Autor de implementación/verificación: Codex; sin aceptación atribuida a PO, docentes o integrantes. Las matrices de RF/RNF conservan su estado de negocio; no se marca IMP-00 completa. La siguiente unidad al cerrar ese corte fue IMP-00.05, implementada posteriormente por encargo expreso del usuario en el corte siguiente.

## Corte local IMP-00.05 — 10/09/2026

| Incremento | Implementación | Prueba local e integración | Aceptación / límite |
| --- | --- | --- | --- |
| IMP-00.05 | Workflow GitHub Actions con runtime/acciones fijados; comandos compartidos y ocho casos Cypress sin servicios simulados | `npm ci` y `ci:verify` aprobados en Windows: formato, lint, tipos, 42 Jest, 38 integración, 14 pgTAP, builds, artefactos y 8 Cypress; cinco controles rechazaron defectos deliberados y restauraron sus fuentes | GitHub Actions configurado, sin ejecución remota; no acredita aceptación humana ni completa RF |

Evidencia, versiones y prueba de fallos de los controles: [registro de CI/Cypress](../work/IMP-00.05-ci-y-cypress.md). DEC-007 incorpora compatibilidad local Cypress16/Node24; la verificación del workflow remoto sigue pendiente. La siguiente unidad al cerrar ese corte fue IMP-00.06, abordada por encargo expreso en el corte siguiente. IMP-00 y los requisitos de negocio conservan sus pendientes.

## Corte de ensayos IMP-00.06–IMP-00.08 — 10/09/2026

| Incremento | Implementación | Comprobación local | Remoto / límite |
| --- | --- | --- | --- |
| IMP-00.06 | Supervisor CommonJS/JSON, cápsula Docker por caso y adaptador Sandbox con imagen preparada | Límites efectivos, diagnósticos, ataques al canal, procesos/red, concurrencia, cancelación y limpieza; resultados detallados en el registro | **Pendiente por configuración:** Sandbox remoto y cgroups anidados. Brecha demostrada: el retorno no prueba invocación honesta; puente UID0 con capacidades acotadas. No acepta RF-009/011 |
| IMP-00.07 | Interfaces embeddings/generación, Azure v1, contrato estricto y recuperación exacta pgvector/RLS sobre TEST | Contratos y fallos seguros; datos reales con vectores sintéticos, ACL y revocación; separación de configuraciones y modelos | **Pendiente por configuración:** deployments, dimensión/umbral real y llamada Azure. Sin ingestión completa ni calidad pedagógica acreditada; no acepta RF-006/012/013/025 |
| IMP-00.08 | Bicep ACA/ACR/identidades, Job manual, wrappers Vercel, API con TLS/release, manifiesto y smoke limitado | Plantilla compilada, imágenes locales, TLS real positivo/negativo y controles de autorización/presupuesto; reproducción y resultados en el registro | **Pendiente por configuración:** destinos y presupuesto, despliegue, pooler remoto, navegador y conectividad desde Azure. Sin validación remota aprobada ni garantía de rendimiento/costo |

Evidencia conjunta: [registro de implementación y ensayos](../work/IMP-00.06-08-ensayos.md). Distingue **comprobado localmente**, **comprobado remotamente**, **fallido** y **pendiente por configuración**; una brecha esperada no se cuenta como garantía aprobada. Continúa pendiente GitHub Actions remoto de IMP-00.05. No se atribuye aceptación humana ni se marcan RF/RNF de negocio completos. **Siguiente unidad de implementación: IMP-01.01**; no se inicia en este encargo.

## Corte institucional IMP-01 — 11/09/2026 UTC

Los ocho incrementos están implementados en migraciones, API, contratos, interfaz, pruebas y herramienta de aprovisionamiento. [El registro institucional](../work/IMP-01-identity.md) contiene la matriz de los doce escenarios HU/CU/PT-001/020/021, comandos, resultados y límites. DEC-001 está resuelta por el usuario para este alcance; DEC-004/006 concretan el contrato y diccionario institucionales.

La validación final local aprobó las once etapas de `npm run ci:verify`, incluyendo actualización desde IMP-00, RLS de escritura, correo real, carreras, recuperación de entregas e interfaz administrativa. Cypress completó 16/16 recorridos; el detalle está en el registro enlazado. No se atribuye aceptación académica, validación de despliegue remoto ni cobertura de dependencias de clases/documentos aún inexistentes. IMP-02 no comienza en este corte.

## Corte de práctica IMP-03.01–IMP-03.03 — 26/09/2026

El alcance autorizado conecta editor, admisión NestJS, QuickJS/WASM en Docker y
resultado temporal RUN. La migración agrega reservas operativas, cuotas,
idempotencia y recuperación; no crea intentos, progreso ni ayuda. El cierre de
actividad impide nuevas admisiones y permite terminar las anteriores, sujeto al
acceso vigente al recuperar la respuesta. La decisión de SUBMIT continúa pendiente.

El [registro de práctica](../work/IMP-03-practice.md) conserva los comandos y
resultados de la verificación local. La brecha histórica de falsificación del
retorno se convierte en regresión obligatoria con el nuevo intérprete. La evidencia
anterior permanece como registro del prototipo; no describe el arnés actual.
Sandbox remoto, paridad productiva, aceptación académica y los incrementos
IMP-03.04 en adelante quedan pendientes.

El corte quedó implementado, integrado y probado localmente: `npm run ci:verify`
aprobó sus 13 etapas el 26/09/2026 a las 21:36:02 UTC. Incluye 327 pruebas
unitarias/de contrato, 69 casos Docker, 20 verificaciones del banco canónico,
97 pruebas HTTP, 181 aserciones SQL, 100 muestras de rendimiento y 29 recorridos
Cypress. Los fallos iniciales y las correcciones permanecen en el registro.

## Corte de envíos IMP-03.04–IMP-03.06 — 26/09/2026

El corte está **implementado y probado localmente**: SUBMIT durable, historia
propia, comparación/reintento y avance mínimo por actividad. DEC-002 quedó
resuelta por el usuario: la admisión se serializa respecto del cierre; un envío
admitido antes puede persistir después, las nuevas admisiones se rechazan y la
entrega o recuperación exige permisos vigentes. El [registro de envíos](../work/IMP-03-submissions.md),
su [diccionario](../work/IMP-03-submissions-dictionary.md) y el
[plan autorizado](../work/IMP-03-submissions-plan.md) detallan contratos,
implementación, escenarios, fallos corregidos y límites. Las cifras del corte
anterior conservan la evidencia histórica RUN.

La CI final `npm run ci:verify` aprobó **14/14 etapas** el 26/09/2026 a las
23:31:08 UTC. Incluye 444 pruebas unitarias/de contrato (145 API, 21 web,
82 contratos, 101 runner, 60 IA y 35 preproducción), 69 casos Docker,
20 verificaciones del banco canónico, 110/110 pruebas HTTP, 285 aserciones SQL
(104 de SUBMIT) y 35/35 recorridos Chrome, sin pendientes ni omitidos.
Los informes de este corte están en `.local/reports/imp-03-submissions/`:
`ci.json`, `integration.json`, `e2e.json`, `run-performance.json` y
`submit-performance.json`.

Los perfiles finales usan cien solicitudes RUN y cien SUBMIT; cada operación
incluye cincuenta secuenciales y cincuenta con concurrencia cuatro, sin errores
y con limpieza verificada. SUBMIT incluye pruebas visibles/ocultas y commit.
Las cápsulas son nuevas por caso y la frecuencia se eleva únicamente en el
proceso aislado de medición, como documenta el registro.

| Operación | p95 secuencial (ms) | p95 con concurrencia cuatro (ms) |
| --- | --- | --- |
| RUN | 1460,17 | 2307,43 |
| SUBMIT | 2083,26 | 4032,03 |

Ambos perfiles aprueban el objetivo local de menos de cinco segundos. Esta
evidencia no acredita rendimiento híbrido, paridad productiva Sandbox ni
aceptación humana. IA/RAG, progreso por concepto, señales y lectura docente
conservan sus incrementos posteriores; el avance mínimo no completa RF-015.
El alcance local aporta evidencia a RF-007/009/010/011/014 y revalida el cierre
concurrente de RF-005, sin declarar aceptados esos RF globalmente ni toda IMP-03.

## Corte de materiales IMP-04.01–IMP-04.03 — 27/09/2026

El usuario autorizó fuentes, carga privada y procesamiento recuperable, con
activación automática del índice completo y reemplazo mediante nuevas versiones.
La implementación conecta contratos, NestJS, Storage, PostgreSQL/pgvector,
worker y pantallas de clase/actividad. Su estado es **implementado y probado localmente**;
comandos, resultados y pendientes se mantienen en el
[registro de materiales](../work/IMP-04-materials.md).

El corte aporta ALZ-RF/HU/CU/PT-006 y 025 y sus E1–E4, sin cerrar todavía los
requisitos de ayuda 012/013. La recuperación SQL comprueba generaciones activas
con filtros antes de top-k=5; solicitar ayuda sobre intentos quedó para el corte siguiente.
DEC-004/006 concretan trabajos/versiones; DEC-010 fija tamaño, extracción,
fragmentación y política de reintento local. Los seis documentos ficticios
completan el corpus canónico de DEC-012.

Las pruebas integradas distinguen extracción/Storage/pgvector reales del doble
explícito de embeddings en TEST. Azure real, evaluación pedagógica, despliegue
y aceptación CAPSTONE permanecen pendientes. IMP-03.07 — Sandbox remoto conserva
prioridad antes de producción y no bloquea esta ingestión docente.

## Corte de ayuda IMP-04.04–IMP-04.06 — 27/09/2026

El alcance autorizado está **implementado y probado localmente**. Conecta
intento propio confirmado, recuperación filtrada, explicación separada de tres
niveles de pista, trabajo durable, validación semántica, historial y referencias
privadas de la versión citada. El [registro de ayuda](../work/IMP-04-help.md) y su
[diccionario](../work/IMP-04-help-dictionary.md) conservan contratos, decisiones,
comprobaciones y límites. Cypress aprobó **42/42 recorridos**, incluidos los cuatro
de ayuda, con Auth, API, Storage y pgvector reales y proveedor de IA TEST explícito.
El registro conserva las incidencias iniciales de worker y Cypress, sus correcciones
y el fallo histórico del perfil de latencia; este cierre no declara aprobada la CI
agregada.

El corte aporta RF/HU/CU/PT-012 y 013 E1–E4 y revalida RF-010, RF-006/025 y sus
fronteras de persistencia/permiso. CLOSED permite ayuda sobre evidencia existente;
SUCCESS solo explicación. Metadatos y seguimiento no entregan pistas: el ACK
posterior a presentación explícita registra el evento una sola vez. Ni los
fallbacks ni los trabajos fallidos consumen niveles o alteran diagnóstico/progreso.
Ocultar, archivar o revocar acceso suprime la ayuda derivada; restaurar la fuente
no revive el contenido suprimido. RF-017 docente conserva su corte posterior.

`HELP_WORKER_ENABLED` habilita el consumidor de servidor, con generación,
verificación y calibración configuradas en [.env.example](../../.env.example).
`npm run help:plan` prepara el [manifiesto de ensayo](../../infra/preproduction/help-manifest.example.json)
sin llamadas remotas; la preparación ejecutable posterior se registra en el corte siguiente.
Las pruebas locales con proveedor TEST explícito no acreditan Azure real, p95
remoto, calidad semántica, evaluación docente ni aceptación CAPSTONE. Este cierre
histórico no acredita el incremento siguiente, Vercel Sandbox IMP-03.07 ni la
operación productiva del consumidor.

## Fallos IMP-04.07 y preparación ejecutable IMP-04.08 — 01/10/2026

Estado al 02/10/2026: **IMP-04.07 probado localmente y preparación ejecutable IMP-04.08 probada en TEST**. El
[registro del incremento](../work/IMP-04-evaluation.md) concentra comandos,
resultados y pendientes; el [diccionario](../work/IMP-04-evaluation-dictionary.md)
y [manual](../work/IMP-04-evaluation-operations.md) concretan DEC-004/006/008/010.
La corrida completa de `ci:verify` está aprobada: 985 pruebas, 146 casos HTTP, 471 aserciones SQL, 27 casos de integración IA, 45 recorridos Cypress y el arnés de cuatro etapas.

| Frontera | Ampliación implementada | Evidencia local y condición remota |
| --- | --- | --- |
| RF-010/012/013 · CON-01–03 | RUN/SUBMIT durante fallback, ACK perdido, historial y recuperación sin doble pista | Tres recorridos `IMP04-08/09/10`, con teclado/foco/borrador/sesión; regresión total 45/45 aprobada, sin omisiones |
| RF-006/025/013 · SEG-01/03/05 | Contenido adversario sin autoridad, Storage real interrumpido/corrupto y revocación durante I/O | Rechazo sin fuga ni cambio de diagnóstico; descargas y referencias autorizadas |
| Persistencia y consumidor | Caída PostgreSQL en admisión, fallos de checkpoint/publicación, reinicio postREVIEW y reconciliación de ledger | Sin 202 ni estado parcial al fallar admisión; misma clave y recibos; plazo original; cero eventos sin ACK |
| Evaluación operacional | LAB-EVAL separado, bindings/credencial y cuatro etapas, ledger universal, presupuestos y recibos seguros | Corrida TEST completa y recuperable: 43 casos, 234 ayudas y 763 recibos; diez controles contables con dos procesos; cuotas vigentes y autorización exacta |
| DEC-008/010 · REN-03/04 | 100 ayudas en serie y 100 con concurrencia cuatro; calibración ligada a evidencia y origen | Reportes por perfil, costos/uso observados o desconocidos, fallbacks completos; Azure medido por separado |

Los proveedores controlados de TEST se seleccionan desde el arnés, fuera de
instrucciones estudiantiles o materiales. La calibración TEST no se acepta como
Azure. El paquete de revisión deja autor, fecha y aceptación sin completar hasta
una revisión humana real. Permanecen pendientes Azure/calidad semántica,
aceptación docente/CAPSTONE, RF-017, IMP-03.07 y el despliegue del consumidor ACA.
El fallo histórico de latencia SUBMIT y las corridas anteriores se preservan;
la tercera corrida de CI pasó completa, incluidos tres perfiles SUBMIT consecutivos bajo 5 s. Esto no acepta el incremento IMP-04.08 remoto ni la calidad pedagógica.

## Cobertura de los 27 RF

**Corte IMP-05.01–05.02 autorizado el 02/10/2026, cierre técnico local el
04/10/2026:** eventos y progreso por concepto/al corte están implementados,
integrados y probados. El [registro del corte](../work/IMP-05-progress.md) y el
[cierre SUBMIT](../work/2026-10-04-submit-closure.md) conservan comandos,
diagnóstico y resultados reales; el [diccionario](../work/IMP-05-progress-dictionary.md)
concreta DEC-004/006 y la resolución parcial DEC-005.

La nueva `npm run ci:verify` aprobó **17/17 pasos**, con registro final
`2026-10-04T19:46:25.135Z`. Incluye 1.552 pruebas unitarias/de contrato en seis
grupos, 152/152 HTTP, 545 aserciones SQL en once archivos y 49/49 Cypress.
La evaluación con proveedor TEST completó 100 ayudas seriales y 100 con
concurrencia cuatro, 234 muestras, 763 recibos y cobertura 43/43; no acredita
el proveedor Azure real.

| Serie SUBMIT consecutiva | p95 secuencial (ms) | p95 concurrencia cuatro (ms) |
| --- | --- | --- |
| 1 | 1.827,90 | 3.792,36 |
| 2 | 1.824,69 | 3.250,55 |
| 3 | 1.945,19 | 3.297,92 |

Cada serie conserva 50 muestras por perfil, cero fallos, 2.000 eventos y 50/50
correlaciones completas por perfil, con limpieza comprobada. RUN, las tres
series SUBMIT y la evaluación HELP comparten huella de candidato; las tres
series SUBMIT conservan imagen idéntica. Se mantiene p95 <5.000 ms, sin
modificar concurrencia ni seleccionar muestras. Permanecen registrados el FAIL anterior
de 5.620,75 ms y el de la serie B diagnóstica de 5.271,86 ms; la aprobación
posterior no identifica una causa demostrada de esas demoras.

El cierre aplica al ambiente local comprobado, sin acreditar este candidato
en Linux, Azure OpenAI ni Vercel Sandbox remotos, producción o aceptación
académica. IMP-05.03–05.08, RF-016/018/026, reglas, señales y tablero docente
siguen pendientes. La [validación remota](../work/IMP-05-remote-validation.md)
continúa como un carril independiente con precondiciones explícitas.

**Actualización 13/10/2026:** .04 completó exclusivamente los tres evaluadores puros y sus contratos/pruebas, con [trazabilidad E/SIG y candidato](../work/IMP-05-evaluators-pure.md). .03 conserva CI17/validación integral pendiente; .05-.08 conservan adquisición operacional, episodios, consulta y reconstrucción durables. RF-018 y la aceptación docente no se cierran por estos focos. Los registros históricos anteriores permanecen intactos.

**Cierre técnico local IMP-05.05 y CI conjunta .03/.04/.05, 25/10/2026:**
`ci:verify` aprobó **17/17 pasos**, con registro final
`2026-10-26T00:35:22.681Z` (25/10 en la zona local). El candidato de 502 archivos
tiene SHA-256 `19253829d0baecaf2055c855714ab15247344a28d6fb1887fab5b65823834ba6`.
Incluye 2.110 unidades, 181 HTTP, 928 aserciones SQL en 13 archivos y 49/49 E2E.
Ayuda TEST completó 234 muestras, 763 recibos y tres reanudaciones, sin llamadas
externas. Las tres series SUBMIT aprobaron con 100 respuestas válidas cada una:

| Serie SUBMIT consecutiva | p95 secuencial (ms) | p95 concurrencia cuatro (ms) |
| --- | --- | --- |
| 1 | 2.072,35 | 3.415,01 |
| 2 | 1.644,12 | 3.198,67 |
| 3 | 1.646,66 | 3.246,24 |

Se conserva el gate p95 <5.000 ms. El [registro .05](../work/IMP-05-episodes.md)
y la [corrección de admisión SUBMIT y fixture temporal](../work/2026-10-25-submit-admission.md)
documentan el cierre y preservan las corridas fallidas. Este corte acredita
captura, episodios, recuperación y reconstrucción locales; no cierra .06–.08,
tablero, revisión docente, RF-018 integral, RF-019 ni aceptación académica.
GitHub Actions, Azure OpenAI, Vercel Sandbox y despliegue remotos siguen pendientes.

**Cierre técnico local IMP-05.06, registrado el 26/10/2026:** CI completa
**17/17 PASS**, terminada `2026-10-26T02:16:14.949Z` (25/10 en Santiago), sobre
515 fuentes con digest
`a73534c65eeb8e0ccf0ddb37e8d941401685fe885021272867fddcb374ba29e9`.
Incluye 2.152 unidades, 184 HTTP, 957 aserciones SQL/14 archivos y 58/58 E2E.
RF/HU/CU/PT-026 E1–E4 se verifican con consulta efectiva, historial, creación,
activación CAS, permisos y recuperación tras renovación de sesión/recarga.
El puente UI/motor conserva la revisión histórica. Upgrade .05→.06, tres
series SUBMIT, capturas de tres tamaños y p95 local de reglas están aprobados;
el [registro .06](../work/IMP-05-rules-ui.md) contiene resultados y antecedentes.
.07–.08, RF-018 integral, revisión docente, aceptación académica y servicios
remotos conservan sus pendientes; este cierre no acepta toda IMP-05.

**Cierre técnico local IMP-05.07, 26/10/2026:** CI final **17/17 PASS**, terminada
`2026-10-26T19:42:31.499Z`, sobre el candidato
`b90287f4d30e868f421935f0b942974f60b44c6163411a2fb288eecd32cdb3f1`.
Incluye 2.186 unidades (73 web), 193 HTTP, 1.019 aserciones SQL, 66 E2E,
tres series SUBMIT y ayuda TEST con 100 solicitudes secuenciales y 100 a
concurrencia cuatro. RF-015 amplía la observación personal por período y
conserva progreso acumulado; RF-016 integra el tablero de matrícula vigente;
RF-018 incorpora consulta de los tres tipos de señal, historia
`ACTIVE`/`REVIEWED`, causa y evidencia mínima de solo lectura. El foco Cypress
de tablero aprobó 8/8 casos. El [registro .07](../work/IMP-05-dashboard.md)
identifica los resultados finales, la corrección de fechas narrativas, las
mediciones, capturas y antecedentes fallidos. IMP-05.08 y los flujos integrales
RF-017/RF-019 de IMP-06 permanecen pendientes, al igual que aceptación CAPSTONE
y validaciones remotas. Los cierres históricos anteriores conservan su alcance.

**Cierre técnico local IMP-05.08, 26/10/2026:** CI final **17/17 PASS**,
registrada `2026-10-27T00:12:20.364Z`, con 2.190 unidades, 200 HTTP,
1.032 aserciones SQL y 75 E2E. Las tres series SUBMIT consecutivas a
concurrencia cuatro obtuvieron p95 de 3844.73, 4334.64 y 4702.79 ms,
por debajo de 5000 ms. El [registro .08](../work/IMP-05-acceptance.md)
identifica candidato, reportes, perfiles de rendimiento y capturas;
la [matriz .08](../work/IMP-05-acceptance-matrix.md) traza los 16 escenarios
E1–E4 de RF-015/016/018/026, SIG-01–14 y fronteras aplicables al MVP por nivel.
Incluye reconstrucción, reconciliación, ayuda real TEST, permisos vigentes y
activación de reglas → motor → consultas. La actualización aditiva conserva
26 colecciones canónicas, DTO al mismo corte excluyendo únicamente
`observedAt`, y grafo de roles/ACL.

Las tres superficies medidas son progreso personal, tablero y reglas, con
60 alumnos activos; la carga UI usa un Chrome más tres lectores HTTP.
El PASS de ayuda API/persistencia no cierra su latencia documental en navegador,
pendiente de IMP-04. E23 conserva verificación pura, sin corrida durable
atribuida; E20/backfill está fuera del MVP. RF-017 integral, RF-019 público,
CAPSTONE, CI Linux y validaciones remotas permanecen pendientes. SQL015 no
reproducida en 20 iteraciones y el tercer SUBMIT de CI R1 con p95 de 5123.54 ms
conservan causa no demostrada; el PASS posterior no acredita una corrección.
Los cortes .01–.07 mantienen sus resultados y límites históricos.

**Cierre técnico local IMP-06.01, 27/10/2026:** consulta ADMIN del
banco con propietario, versión actual, conceptos fijados, historia y usos
paginados. Los focos incluyen Cypress 8/8, actualización aditiva con datos
preservados y rendimiento de las cuatro superficies API. La CI final aprobó
**17/17 pasos**, registrada `2026-10-27T04:49:50.805Z` (01:49 en Santiago),
con 2.218 pruebas Jest, 207 HTTP, 1.084 aserciones SQL y **83/83 E2E sin omitidos**;
también aprobaron los tres gates SUBMIT consecutivos y la evaluación TEST.
El [registro .01](../work/IMP-06-bank-read.md) conserva candidato,
comandos, resultados y límites. RF/HU/CU/PT-024 permanece parcial: este corte
cubre lectura de E1/E3 e historia de E4, sin acreditar las mutaciones de
E1/E2/E4. IMP-06.02–.07 y la aceptación humana/remota siguen pendientes.

**Implementación y pruebas locales IMP-06.02, 27/10/2026:** el administrador
cambia propiedad/visibilidad, crea nuevas versiones y archiva desde el banco.
Las operaciones conservan autorización vigente, ETag, idempotencia y auditoría;
las publicaciones e intentos anteriores mantienen versiones, pruebas y conceptos.
El [registro .02](../work/IMP-06-bank-governance.md) traza RF/HU/CU/PT-024 E1–E4
y conserva comandos, resultados y límites. El foco aprobó 14 casos HTTP y
1.126 aserciones SQL en 18 archivos; la actualización .01→.02 preservó los
datos históricos. Cypress aprobó cinco casos del foco y 88/88 del conjunto
integrado. La CI terminó con 16/17 etapas aprobadas; la evaluación de ayuda
rechazó cambios documentales durante el ensayo y aprobó al repetirse por separado
con el repositorio congelado a las 17:28:18 UTC. El registro conserva ambos resultados, sin
reclasificar la corrida inicial como 17/17. IMP-06.03–.07, la aceptación humana y la
validación remota permanecen pendientes; los cortes anteriores no se reescriben.

**Corte histórico del cierre técnico local IMP-06.03:** el
[registro del detalle docente](../work/IMP-06-student-detail.md) documenta
la consulta de intentos/resultados, ayuda entregada, progreso y señales de
RF/HU/CU/PT-017 E1–E4 y UX-11. Enlaza la CI local completa aprobada, los focos,
la actualización .02→.03 y los perfiles de API/pantalla del candidato.
Conserva los intentos fallidos, diagnósticos y repeticiones sin reclasificarlos,
junto con los límites del laboratorio y de los proveedores TEST.
IMP-06.04–.07, la CI Linux y la aceptación humana/remota permanecen pendientes.

**Actualización IMP-06.04, 01/11/2026:** revisión pública implementada con focos
locales aprobados para RF/HU/CU/PT-019 E1–E4. El
[registro .04](../work/IMP-06-signal-review.md) conserva resultados, fallos de CI
y verificaciones adicionales, incluida la corrección de la expectativa anterior
de DASH-03 sobre señales ya revisadas, limitada a esa prueba.
El cierre integral permanece pendiente; los focos separados no equivalen a una
CI completa aprobada. IMP-06.05–.07 y aceptación humana/remota siguen pendientes.
La [campaña de cierre](../work/IMP-06-signal-review-closure.md) conserva tres D_A.
La última, tras diferir SDKs de IA al construir sus adaptadores, terminó
**68 aprobados, 1 fallido y 0 omitidos**, con recuperación API aprobada y
observación válida. PHASE-07 registró p95 concurrente **3393 ms**. Los dos fallos
contextuales anteriores y sus evidencias permanecen conservados.
La corrección posterior es la opción `runnerUi: false`: la regresión real A/B
comprueba que desaparece el reporter de Cypress y se conservan reintentos, errores
y viewport. D_B terminó el **01/11/2026 a las 23:19:50.544Z**, con **69 aprobados,
0 fallidos, 0 omitidos y 0 pendientes**, **27 capturas** y **789 archivos** congelados
verificados. La observación fue válida y elegible, con **1070/1070** peticiones
correlacionadas. El p95 del tablero fue **1809,9/2428,1 ms** (serie/concurrencia 4);
la media residual concurrente fuera de la unión de fetch bajó de **1399,062** a
**448,154 ms** (**67,968 %**), cumpliendo la predicción registrada sin modificar
los umbrales. El mecanismo del arnés tiene regresión y D_B favorables; el cierre
causal final sigue pendiente de ABBA y CI. La campaña se detuvo por presupuesto:
**4/6** contextuales usadas, **2** disponibles y **4** requeridas para ABBA; **0**
CI final. En esa tercera reanudación no se reinició el contador ni se amplió el límite ni se abrevió ABBA.

**Cuarta reanudación IMP-06.04, 01/11/2026:** el usuario amplió expresamente el
límite contextual a **ocho**, conservando las cuatro corridas previas. A1 sin
diagnóstico terminó el `2026-11-02T00:09:03.910Z` (01/11 en Santiago):
**67 PASS/2 FAIL/0 SKIP/0 pendientes**, diez specs en orden, con PHASE-07
concurrente **4081,8 ms** y fallo adicional PHASE-08 **3110,1 ms**; límite
original <3000 ms. Se conservaron 50 muestras válidas por perfil, primeras
navegaciones separadas, carga de fondo válida y **24/27 capturas**.
La huella de 633 fuentes A antes/después fue
`68a576cc6fa5e6526932fdbc4e3b755e5c8396de5b0201b41d6b734d4ce23a6b`;
789 archivos y protocolo privado permanecieron congelados. B quedó restaurado.
El control A1 se rechazó: **ABBA 1/4 ejecutado, cero controles conformes**;
B1/B2/A2 y CI final no se iniciaron. Consumo **5/8 contextuales y 0/1 CI**.
El saldo no elimina la condición de parada. El
[registro de cierre](../work/IMP-06-signal-review-closure.md) y
`.local/evidence/imp-06-closure/resumption-04/` conservan reportes, huellas y
fallos. La causa de PHASE-08 no queda atribuida y el cierre permanece pendiente.

**Investigación posterior de PHASE-08, 01/11/2026:** la auditoría de muestras
ratificó el fallo, pero no atribuyó su causa. Los sensores diagnósticos de aquella
etapa cubrían tablero y no permitían separar los intervalos de PHASE-08. La regresión
aislada de B aprobó (2 PASS/1 FAIL centinela esperado); verifica la corrección
existente, no rendimiento ni una nueva corrección. No hubo campañas nuevas ni
CI: **5/8 y 0/1**. A1 permanece rechazado; otro ABBA requiere cuatro campañas
con tres disponibles, mínimo global nueve aun sin nuevos diagnósticos. El
máximo de ocho impide completar el cierre sin modificar las restricciones,
que se conservan. La quinta reanudación del registro de cierre y
`resumption-05/` preservan el diagnóstico inconcluso y los controles ejecutados.

**Sexta reanudación — estado vigente al 01/11/2026 (Santiago):** el usuario
autorizó un máximo global de **11** contextuales, conservando las **cinco**
anteriores y reservando seis para D_A08, D_B08 y ABBA; CI final, máximo **una**,
condicionada al éxito de la secuencia. El instrumental calificado ahora cubre
tablero y progreso en cuatro perfiles, sin cambiar muestras, relojes ni gates.
D_A08 terminó **67 PASS/2 FAIL**, reproduciendo PHASE-07/08 con p95 concurrentes
**4481,2/3356,7 ms**. D_B08 terminó **69 PASS/0 FAIL/0 SKIP**, con seis gates
aprobados, p95 concurrentes **2777,2/2016,1 ms**, **27 capturas** y observación
calificada: **2253/2253** correlaciones, sin pérdidas y autocostes inferiores
al 1 % por perfil/proceso. La predicción registrada antes de B se cumplió:
en progreso concurrente, la media de inicio a efecto de sesión bajó **86,26 %**
y la unión observada de long tasks **87,71 %**. No se atribuye CPU exclusiva al
reporter ni se convierte esta comparación instrumentada en cierre causal final.

El nuevo A1, sin diagnóstico, terminó el `2026-11-02T02:23:44.959Z` (01/11 en
Santiago), con **68 PASS/1 FAIL/0 SKIP/0 pendientes**, los 69 casos y
**27 capturas**. PHASE-07 reprodujo el fallo (**3962 ms**), pero PHASE-08
aprobó con **2828,3 ms** y no satisfizo el control de reproducción exigido.
A1 fue rechazado; la secuencia se detuvo con **8/11** contextuales consumidas
y **0/1** CI final. Esta secuencia ABBA ejecutó **1/4**, con **0 controles
conformes**; B1/B2/A2 y CI no se iniciaron. Los **792 archivos** y el protocolo
permanecieron estables, B quedó restaurado y TEST detenido. El saldo no permite
repetir después de esta parada. El A1 anterior de `resumption-04/` y su corte
**5/8** conservan el rechazo original; no se reutilizan ni reclasifican.
El [registro de cierre](../work/IMP-06-signal-review-closure.md) y
`resumption-06/` conservan predicción, comparación y veredictos. El cierre
técnico local .04 permanece **PENDIENTE**; .05–.07 y la aceptación humana/remota
siguen separados de este resultado.

**Auditoría del 02/11/2026 (`resumption-07`):** se verificó la comparabilidad
de fuentes, métrica y oráculos lógicos. Los **18 p95** recalculados coinciden;
las nueve cargas tienen intervalos físicos válidos y envolventes de peticiones
que cubren la suma de duraciones navegadas. Esto es necesario, pero no acredita
alineamiento por navegación. No se observó desaparición del fondo. Un
contraejemplo offline mostró que el validador histórico acepta tres peticiones
de 1 ms dentro de un reporte largo; el nuevo auditor distingue esa duración
reportada de la envolvente real y rechaza su cobertura. No se modificó el
validador histórico ni se reclasificó A1.
Las **15/15 pruebas offline** califican este auditor, no la CI ni una causa de
PHASE-08. La neutralidad ON/OFF sigue sin probarse: el flag también afecta la
compilación web y el autocoste directo no acota efectos indirectos del observador.
No hubo nuevas campañas: **8/11** contextuales y **0/1** CI final; A1 permanece
rechazado y la parada sigue vigente, sin B1/B2/A2 ni CI. El
[registro de cierre](../work/IMP-06-signal-review-closure.md) y `resumption-07/`
conservan la auditoría; el cierre técnico local .04 permanece **PENDIENTE**.

**Octava reanudación — corte del 02/11/2026 (`resumption-08`):** la
comparación controlada ON/OFF se concretó en un máximo prospectivo de **16**
contextuales: ocho previas, cuatro de calibración OFF–ON–ON–OFF y cuatro ABBA,
con máximo una CI final condicionada. El instrumental privado aprobó **80/80
pruebas offline**; estas califican los validadores y el análisis, no la CI del
producto ni la neutralidad del observador.
La única corrida, **CAL_OFF1**, terminó el `2026-11-02T05:37:26.297Z`, con
**68 PASS/1 FAIL/0 SKIP/0 pendientes**, 69 casos en diez specs ordenados.
PHASE-07 concurrente falló con **4150,8 ms** y PHASE-08 aprobó con **2838,3 ms**;
ambos eran desenlaces permitidos de esta calibración, sin cambiar los gates.
El rechazo provino únicamente de `CONTROL:commonHostQualified`: el autocoste
del observador común de host en tablero fue **2,036 %**, sobre el límite del
**1 %**. Los seis perfiles conservaron 50 muestras válidas y primeras separadas;
se verificaron las cargas y las **27 capturas** requeridas. Los **792 archivos**,
versiones, imágenes y protocolo permanecieron estables; B quedó restaurado y
TEST detenido, sin nueva corrección de código ejecutable.
La serie quedó incompleta (**1/4**); ON1/ON2/OFF2, nuevo ABBA y CI no se
iniciaron. Consumo **9/16** contextuales y **0/1** CI final, con parada vigente.
No se demuestra causalidad ni neutralidad ON/OFF. Los A1 históricos conservan
sus rechazos y sus evidencias; esta calibración no los reclasifica. El
[registro de cierre](../work/IMP-06-signal-review-closure.md) y `resumption-08/`
conservan la calificación fallida. El cierre técnico local .04 permanece
**PENDIENTE**, separado de .05–.07 y de aceptación humana/remota.

**Novena reanudación — corte histórico del 02/11/2026 (`resumption-09`):** la
calificación no contextual rechazó el candidato de sensor con lectura de CPU
en Windows dentro del mismo proceso. Bajo carga, el autocoste registrado fue
**A 28,888 % / B 28,607 %**, superior al límite del **1 %**, con CPU compartida
del host de aproximadamente **90,88 %**. Los demás controles de carga,
cobertura, reloj, integridad y limpieza fueron válidos. La auditoría offline
independiente confirmó el rechazo, sin atribuir una causa a los tiempos.
Las **693 pruebas de preproducción** y **55 aserciones nativas** aprobadas
verifican la corrección del candidato; no acreditan su calificación bajo carga
ni la CI final. Se archivó y retiró el candidato, se restauró el sensor original
y se conservaron `runnerUi: false` y dos pruebas del contrato de tiempo
transcurrido. No se acepta una corrección de sensor.
No hubo nuevas campañas contextuales ni continuación ON/OFF, ABBA o CI:
siguen **9/16** contextuales y **0/1** CI final, con parada vigente. Los rechazos
históricos permanecen sin reclasificar y el cierre local .04 sigue **PENDIENTE**.
El [registro de cierre](../work/IMP-06-signal-review-closure.md) y
`resumption-09/rejected-candidate/` conservan el candidato rechazado, los hashes
y la procedencia de la restauración.

**Decimotercera reanudación — estado vigente al 02/11/2026 (`resumption-13`):**
el usuario ejecutó la captura manual secuencial
`capture-20261102T2014038955625`. El resultado conservó un solo arranque,
sesión inactiva, RAW esperado retenido y **24 muestras** válidas; los controles
de captura, muestreo y limpieza aprobaron. La auditoría previa al registro
documental confirmó **93 archivos privados** y **792 fuentes** sin cambios.

La única invocación del lector offline congelado rechazó el inventario con
**`RAW_INVENTORY_MISMATCH`**, antes de crear `offline-analysis`: **cero lecturas
ETL**. El archivo RAW esperado coincide con la ruta de la sesión y tiene
**48300032 bytes**; el inventario también contiene un ETL de **262144 bytes**
con prefijo `WPRC_Internal_Collector_`. Su origen y semántica no están
clasificados; el nombre no acredita su función ni permite excluirlo.

Se conserva la parada: no se cambió el guard, no se descartó el archivo
adicional y no se repitió la invocación. La cobertura de la ventana y de las
**24 consultas no fue evaluada**, y no se particionaron estados ni se atribuyó
causa. El paso manual está completado y no se solicita otra acción manual.
Durante el análisis no hubo nuevo E2E, carga o captura, ni nuevas ON/OFF,
ABBA o CI: **9/17** contextuales y **0/1** CI final. Código y B permanecen
intactos; el sensor no está calificado y el cierre local .04 sigue
**PENDIENTE**, según el
[registro de cierre](../work/IMP-06-signal-review-closure.md).

**Duodécima reanudación — corte histórico del 02/11/2026 (`resumption-12`):**
se preparó y congeló el protocolo secuencial, **sin iniciar la nueva captura**.
Se conservan **24 lecturas a 1 Hz**, **12 trabajadores**, **64 KiB × 512
buffers** y guard de **45 s**; se exige `MaximumFileSize=256` y un límite
de **268435456 bytes**. `QUERY` antes y después debe comprobar nombre de sesión,
modo, flags, buffers, pérdidas y reloj. Se exige retener el ETL RAW original
y validar cabecera, conteos, QPC y cobertura de las 24 consultas mediante
lectores independientes antes de cualquier partición de estados.

Verificaciones focales aprobadas: **32** del controlador, **2** de limpieza,
**115** de `QUERY`, **20** del helper, **72** C#, **65** de protocolo y **12**
nativas. El preflight con PowerShell 7.6.9, perfil WPR y preparación Node
aprobó sin inicio, consultas reales ni carga. El paquete de **51 archivos**
quedó sellado con SHA256
`539df11cae3e558ff48379a47c0cc7580e1c8e49c93722ef783a7385284821e1`.
Estas verificaciones no acreditan una captura secuencial real ni la
calificación del sensor.

La ejecución manual elevada sigue pendiente por privilegios de Windows;
la autorización ya existe y el protocolo admite un solo intento. El déficit
anterior de **1874,632 ms** se conserva, sin atribuirlo a sobrescritura circular.
Pérdidas, límites, cambios de fuentes, cobertura insuficiente o limpieza
incompleta mantienen la parada. No hubo nuevas ON/OFF, ABBA, campañas ni CI:
**9/17** contextuales y **0/1** CI final. Código y B están intactos; sensor y
cierre local .04 siguen **PENDIENTES**, según el
[registro de cierre](../work/IMP-06-signal-review-closure.md).

**Undécima reanudación — corte histórico del 02/11/2026 (`resumption-11`):**
la captura elevada ejecutada por el usuario terminó con código cero, sesión
inactiva y **24 muestras válidas**; las huellas y la limpieza aprobaron.
El lector TDH rechazó CSwitch v5 con **1168** y ese resultado se conserva.
El lector offline posterior fijó Microsoft TraceEvent **3.2.8**, fuente y
DLL coincidentes; aprobó **62 aserciones** de colector/filtros/sanitización
y regresión del guard, sin presentarlas como un oráculo binario independiente.
El recorrido completo leyó **832160 eventos totales**, **831451 scheduler**:
**553504 CSwitch v5/28 bytes** y **277947 ReadyThread v2/8 bytes**. Conservó
**668 eventos propios** y cero formas no soportadas.

El QPC conserva el ancla exacta `5583017157` a **10 MHz**, con pérdidas cero
en la cabecera. Sin embargo, el inicio acreditado es `5564270837`: el primer
evento scheduler llega **1874,632 ms** después. Las consultas 0 y 1 quedan
enteramente antes; las 12 CPU también comienzan después del inicio requerido.
Por ello `decoderComplete=true` no implica aceptación:
**`globalWindowCovered=false` y `causalAccepted=false`**. No se reconstruyeron
estados ni se descartaron consultas para obtener un agregado; no hay causa
demostrada, corrección ni calificación del sensor o aceptación de PHASE-08.

Se aplica la parada por cobertura insuficiente. No hubo recaptura ni nuevas
ON/OFF, ABBA, campañas contextuales o CI; no se solicita otra acción manual
ni se programa un reintento automático. Código y B permanecen intactos y el
presupuesto sigue **9/17** contextuales, **0/1** CI final. El cierre local .04
continúa **PENDIENTE**; el contexto elevado tampoco acredita equivalencia con
los ensayos anteriores. El
[registro de cierre](../work/IMP-06-signal-review-closure.md) conserva fuentes,
huellas, fallos y condiciones de parada.

**Décima reanudación — corte histórico del 02/11/2026 (`resumption-10`):** la
nueva autorización elevó el máximo a **17** campañas contextuales, sin reiniciar
el contador: **9/17** consumidas y **0/1** CI final. El diagnóstico local
registró **72 pares válidos** (12 sin carga inducida y 60 bajo carga), conservando las
primeras y últimas lecturas. En las **46 lecturas lentas**, `nativeQuery`
concentró **99,8836 %** del tiempo transcurrido del probe; el autocoste del
sensor original bajo carga fue **16,05699 %**. La auditoría offline confirmó
el resultado. Esto localiza la demora, sin resolver Running/Ready/Waiting ni
demostrar causa de PHASE-08. No hay nuevo candidato, calificación, ON/OFF,
ABBA ni CI.

El inicio de ETW fue denegado con **`0x80070005`** y se confirmó la instancia
inactiva. El paquete manual privado `resumption-10/etw-run/` está preparado,
con preflight validado sin captura ni carga y **24 lecturas bajo 12 trabajadores** previstas;
el ETL real sigue pendiente. El contexto elevado se declara y no acredita
equivalencia con los ensayos anteriores ni aceptación de PHASE. Se conservan
los rechazos históricos y el cierre local .04 **PENDIENTE**. El
[registro de cierre](../work/IMP-06-signal-review-closure.md) reúne hashes,
controles, límites y las condiciones para las etapas dependientes.

Para cada `ALZ-RF-NNN` se conservan `ALZ-HU-NNN`, `ALZ-CU-NNN` y `ALZ-PT-NNN`, más los cuatro escenarios `ALZ-HU-NNN-E1` a `E4`. Son **108 escenarios de origen**, que deben concretarse con datos y resultados esperados antes de ejecutarse. Los casos adversariales adicionales complementan esa base, no reemplazan sus identificadores.

«Cierre principal» indica dónde integrar el comportamiento completo. La aceptación depende también de revalidaciones señaladas y de decisiones resueltas; no equivale a aprobar automáticamente el RF al terminar una tabla de tareas. En IMP-07 se verifica el conjunto sobre el candidato.

| RF | Resultado | Cierre principal | Base o revalidación importante |
| --- | --- | --- | --- |
| ALZ-RF-001 | Sesión y operación según rol/estado/ámbito | [IMP-01](01-identidad-y-aislamiento.md) | Base protegida IMP-00; revocación y nuevas clases en fases posteriores |
| ALZ-RF-002 | Crear/configurar clase | [IMP-02](02-contenido-y-publicacion.md) | Organización y profesor activo de IMP-01 |
| ALZ-RF-003 | Incorporación por código vigente | [IMP-02](02-contenido-y-publicacion.md) | Unicidad/idempotencia y estado actual |
| ALZ-RF-004 | Ejercicio con conceptos, versión y pruebas | [IMP-02](02-contenido-y-publicacion.md) | Base de gobierno RF-024 desde esta fase; ejecución real IMP-03 |
| ALZ-RF-005 | Componer, publicar y cerrar actividad | [IMP-02](02-contenido-y-publicacion.md) | DEC-002; carrera real cierre/envío obligatoria en IMP-03 |
| ALZ-RF-006 | Cargar e indexar material docente | [IMP-04](04-ayuda-contextual.md) | Fuentes/permisos compartidos con RF-025; ingestión puede empezar tras IMP-02 |
| ALZ-RF-007 | Listar actividades y avance real | [IMP-03](03-practica-y-ejecucion.md) | Consulta base IMP-02; misma proyección de progreso que IMP-05 |
| ALZ-RF-008 | Abrir ejercicio, plantilla y pruebas visibles | [IMP-02](02-contenido-y-publicacion.md) | Editor/borrador; protección de tests revalidada con ejecutor IMP-03 |
| ALZ-RF-009 | Ejecutar con aislamiento y límites | [IMP-03](03-practica-y-ejecucion.md) | Ensayo IMP-00; Docker y Sandbox comprobados por separado |
| ALZ-RF-010 | Enviar y persistir intento/evidencia | [IMP-03](03-practica-y-ejecucion.md) | Idempotencia, fallo BD y cierre concurrente; ayuda después de persistencia en IMP-04 |
| ALZ-RF-011 | Consultar diagnóstico determinista | [IMP-03](03-practica-y-ejecucion.md) | Seis diagnósticos exactos; no información oculta |
| ALZ-RF-012 | Pistas progresivas de intento propio | [IMP-04](04-ayuda-contextual.md) | Intento confirmado; DEC-010; niveles y fallbacks |
| ALZ-RF-013 | Feedback sustentado y válido | [IMP-04](04-ayuda-contextual.md) | Cinco campos/tres estados; citas autorizadas, sin puntaje |
| ALZ-RF-014 | Reintentar conservando historial | [IMP-03](03-practica-y-ejecucion.md) | Reintento nuevo frente a repetición de transporte; historia CLOSED según DEC-002 |
| ALZ-RF-015 | Progreso por actividad/concepto | [IMP-05](05-progreso-y-senales.md) | Cierre técnico local transversal .08: cálculo único, acumulado al corte, observación por período, versiones, paginación y reconstrucción contrastados con oráculo; E1–E4 y límites en la [matriz .08](../work/IMP-05-acceptance-matrix.md). CAPSTONE y remoto pendientes |
| ALZ-RF-016 | Tablero de clase autorizado | [IMP-05](05-progreso-y-senales.md) | Cierre técnico local transversal .08: matrícula/permisos vigentes, filtros, evidencia mínima y ayuda real TEST; capacidad de 60 activos y rendimiento local verificados. Detalle integral y su revalidación pertenecen a IMP-06 |
| ALZ-RF-017 | Detalle docente del estudiante | [IMP-06](06-gobierno-y-seguimiento.md) | Cierre técnico local en [IMP-06.03](../work/IMP-06-student-detail.md), con E1–E4 verificados: intentos/resultados públicos, ayuda entregada, progreso y señales con permisos vigentes. El registro conserva pruebas, incidencias y límites; aceptación humana/remota e integrada .07 pendientes |
| ALZ-RF-018 | Tres señales con causa/evidencia | [IMP-05](05-progreso-y-senales.md) | Cierre técnico local transversal .08: núcleo, persistencia, recuperación y consultas conservan causa inicial, versión e historia ACTIVE/REVIEWED; SIG-01–14 y fronteras aplicables trazados por nivel en la [matriz .08](../work/IMP-05-acceptance-matrix.md). Revisión pública RF-019 implementada en [.04](../work/IMP-06-signal-review.md), con focos aprobados y cierre integral pendiente; CAPSTONE pendiente |
| ALZ-RF-019 | Revisar señal sin borrar evidencia | [IMP-06](06-gobierno-y-seguimiento.md) | IMP-06.04 implementado con focos locales aprobados: confirmación/cancelación, matrícula activa, transición y primer revisor/fecha. Cierre integral pendiente; resultados, fallos y límites en [el registro .04](../work/IMP-06-signal-review.md) |
| ALZ-RF-020 | Gobierno de organizaciones | [IMP-01](01-identidad-y-aislamiento.md) | DEC-001; seed no completa aprovisionamiento; probar dependencias activas posteriores |
| ALZ-RF-021 | Invitar, activar/deshabilitar y asignar roles | [IMP-01](01-identidad-y-aislamiento.md) | Último administrador y cambios concurrentes; Auth/BD coherentes |
| ALZ-RF-022 | Gobierno académico y asignaciones | [IMP-02](02-contenido-y-publicacion.md) | Curso antes de clase; profesor activo del ámbito |
| ALZ-RF-023 | Taxonomía de conceptos | [IMP-02](02-contenido-y-publicacion.md) | Unicidad, ciclos y referencias/versiones históricas |
| ALZ-RF-024 | Gobierno integral del banco | [IMP-06](06-gobierno-y-seguimiento.md) | Base de IMP-02 y consulta administrativa IMP-06.01 con cierre técnico local. [IMP-06.02](../work/IMP-06-bank-governance.md) implementa y prueba localmente E1–E4: propiedad/visibilidad, versionado administrativo y archivo con conservación de publicaciones e intentos. Revalidación integrada .07 y aceptación humana/remota pendientes |
| ALZ-RF-025 | Gobierno y reindexación del corpus | [IMP-04](04-ayuda-contextual.md) | Servicio compartido con RF-006; versiones/generaciones, permisos vigentes |
| ALZ-RF-026 | Configurar/activar reglas versionadas | [IMP-05](05-progreso-y-senales.md) | E1–E4 de .06 revalidados transversalmente en .08 con puente ADMIN → motor → consultas, historial paginado, aislamiento y rendimiento local; nuevos episodios conservan historia/revisión anterior. Aceptación humana y validación remota pendientes |
| ALZ-RF-027 | Auditoría filtrada y CSV | [IMP-06](06-gobierno-y-seguimiento.md) | Captura desde la primera mutación; ámbito, paginación y neutralización de fórmulas |

La fase [IMP-07](07-calidad-integral.md) contiene la matriz de los **29 RNF y 6 ORG**, con evidencia y fases donde empieza su implementación. Los cuatro parámetros ALZ-PAR también se verifican mediante sus RNF: recursos del ejecutor, corpus/RAG, rendimiento y accesibilidad. Ninguno se da por medido en este plan.

## Momentos para resolver decisiones

La tabla propone cuándo abordar cada DEC; su autoridad y estado permanecen en [fuentes y decisiones](../../specs/00-fuentes-y-decisiones.md). Preparar un contrato o ensayo no constituye una aprobación institucional.

| DEC | Trabajar desde | Resolver antes de… | Si falta una definición, puede avanzar… |
| --- | --- | --- | --- |
| DEC-001 Ámbito administrativo | IMP-00/01 | Activar creación institucional o combinaciones de roles y cerrar RF-020/021 | Identidad local, organización propia y negativos con fixture ficticio |
| DEC-002 Publicación e historial | IMP-02 | Cerrar publicación, archivo, historial y admisión concurrente de envíos | Máquina de estados y preservación histórica; prototipo con propuesta explícita |
| DEC-003 Ejecutor | IMP-00 | Declarar segura la ejecución real y cerrar IMP-03 | Puerto, arnés local y ensayos; proveedor no comprobado queda pendiente |
| DEC-004 Contratos y trabajos | IMP-00, por operación | Integrar cada DTO/transacción/job y aceptar su respuesta pública | Contratos y pruebas locales compatibles, sin afirmar durabilidad inexistente |
| DEC-005 Señales | Captura de eventos IMP-03; cálculo IMP-05 | D1–D5 ya aprobadas; concreción operacional y episodios en .05 | .03–.07 conservan sus cierres históricos; verificación transversal local .08 según su [registro](../work/IMP-05-acceptance.md) y [matriz](../work/IMP-05-acceptance-matrix.md), sin cambiar semántica. Revisión pública implementada en [IMP-06.04](../work/IMP-06-signal-review.md) con focos aprobados y cierre integral pendiente; CAPSTONE y remoto pendientes |
| DEC-006 Modelo/diccionario | IMP-00, por módulo | Consolidar esquema y migraciones compartidas que dependan de decisiones de dominio | DDL/prototipos locales reversibles y revisión cruzada |
| DEC-007 Compatibilidad | IMP-00.01 | Propagar la base a módulos, builds y CI | Ensayos de instalación/build/test; no cambiar familia de stack silenciosamente |
| DEC-008 Región/rendimiento | Ensayo IMP-00; medición por flujo | Aceptar p95/costos y condiciones del ambiente en IMP-07/08 | Instrumentación, carga local, perfil y preparación remota |
| DEC-009 Datos reales/recuperación | Preparación IMP-00/07 | Usar datos reales o declarar listo un piloto | Demo ficticia y restauración aislada; no afirmar cumplimiento legal |
| DEC-010 IA | IMP-00; integración IMP-04 | Publicar ayuda con configuración/modelo/dimensión/pistas finales | Interfaces, corpus ficticio, validación y dobles explícitos |
| DEC-011 Capacidad/freeze | Inicio y cada planificación | Comprometer capacidad, modificar selección o declarar congelamiento | Este orden técnico, estimaciones del siguiente incremento y evidencia real |
| DEC-012 Demo | Fixtures IMP-00/01; ampliación progresiva | Aceptar demo canónica en IMP-07/08 | Subconjuntos de fixtures identificados; no presentarlos como demo completa |

Las decisiones técnicas reversibles se resuelven dentro de la tarea con evidencia. Para semántica/alcance o datos institucionales, el agente prepara una propuesta concreta y requiere la definición que falte conforme al contexto; no interrumpe trabajo independiente ni pide de nuevo autorizaciones ya otorgadas.

## Dependencias que no deben formar ciclos

| Aparente ciclo | Descomposición del plan |
| --- | --- |
| Ejercicios RF-004 y gobierno RF-024 | Versiones, propiedad y permisos en IMP-02; gobierno completo en IMP-06 |
| Carga RF-006 y gobierno de fuentes RF-025 | Entidad/estados/permisos e ingestión comunes; luego ambos flujos en IMP-04 |
| Señales RF-018 y reglas RF-026 | Modelo/validador/versiones → motor → activación/pantallas → aceptación conjunta en IMP-05 |
| Lista RF-007 y progreso RF-015 | Proyección mínima real en IMP-03; extensión de la misma fórmula en IMP-05 |
| Primera prueba cloud y aplicación completa | Smoke temprano en IMP-00; repetir sobre integración real y candidato, sin atribuir al smoke cobertura funcional |

## Preparación y terminado de cada incremento

Un incremento está listo para comenzar cuando tiene objetivo, actor/ámbito si aplica, fuentes, aceptación, dependencias y datos de prueba. Las decisiones no resueltas se acotan al comportamiento que bloquean. No se exige crear documentación ceremonial por cada cambio pequeño.

Para dar por terminado el alcance técnico del incremento:

- [ ] El comportamiento prometido existe, conectado a datos/API/UI reales donde corresponda.
- [ ] Se probaron éxito, rechazo, fallo y concurrencia pertinentes, incluidos E1–E4 de los RF que se cierren.
- [ ] Permisos, aislamiento, contratos y preservación histórica siguen siendo coherentes.
- [ ] Se ejecutaron checks aplicables; se conoce versión/entorno y dónde está la evidencia.
- [ ] Migraciones, datos ficticios, configuración y documentación se reproducen sin pasos ocultos.
- [ ] El diff fue revisado; se conserva trabajo previo y se declaran límites, deudas y siguiente incremento.

La aceptación humana y revisión de otro integrante exigidas por CAPSTONE se registran separadamente. Un agente puede producir código y revisar coherencia, pero no firmar en nombre del PO, docente o integrantes ni fabricar contribuciones.

## Estados y registro de trabajo

| Estado | Evidencia necesaria | Lo que no implica |
| --- | --- | --- |
| Pendiente | Trabajo descrito sin comenzar | Disponibilidad de código |
| En curso | Cambios identificados y próxima acción | Flujo completo |
| Parcial / dependencia pendiente | Parte terminada y brecha exacta, con trabajo independiente posible | Integración del componente simulado |
| Implementado | Código existente y revisable | Pruebas ejecutadas o aceptación |
| Probado localmente | Comandos/resultados en entorno local identificado | Garantías del proveedor productivo |
| Integrado en ambiente acordado | Recorrido real entre servicios con versión y evidencia | Aceptación humana automática |
| Aceptado | Revisión y aceptación correspondiente acreditadas | Ausencia permanente de defectos |

Estos estados describen dimensiones del trabajo; mantener campos separados de implementación, pruebas por entorno y aceptación cuando un único estado resulte ambiguo. Reutilizar las [plantillas existentes](../agent/14-plantillas-de-trabajo.md). Para varias sesiones, crear un registro de implementación cuando comience trabajo real, con:

```text
Incremento: IMP-XX.NN
Objetivo y alcance encargado:
RF/HU/CU/PT, E1–E4 y RNF afectados:
Estado de implementación / prueba local / integración / aceptación:
Commit o archivos cambiados:
Decisiones y supuestos vigentes:
Comandos ejecutados, resultados y evidencia:
Demo observable:
Pendientes concretos y dependencias:
Siguiente incremento recomendado:
```

Una fase solo se presenta completa cuando se cumplen sus criterios de salida y se declaran con precisión sus resultados por ambiente. Si el usuario encargó un subconjunto, entregar ese subconjunto con sus límites; no utilizar el checklist de toda la fase para expandir el alcance sin necesidad.

## Riesgos que condicionan el orden

| Riesgo | Acción temprana | Condición para aceptar la capacidad |
| --- | --- | --- |
| Incompatibilidad de versiones o pruebas | IMP-00.01: ejecutar la combinación antes de generar módulos | Build/test/CI consistentes y lockfile |
| Límites o confidencialidad insuficientes del ejecutor | IMP-00.06: ensayo adversarial; integrar en IMP-03 | Protección comprobada del proceso, pruebas y canal de resultados |
| Acceso cruzado por pool, RLS o roles | IMP-01 y cada nueva operación | Negativos con identidad real y roles sin bypass |
| Ventanas, cierre o archivos con semántica ambigua | DEC-002/005 antes de aceptar el flujo afectado | Fixtures y reglas ratificadas, historia conservada |
| Proveedor IA indisponible o sin configuración | IMP-00.07; ramas IMP-04/05 independientes | Ayuda real o fallback correcto sin perder resultado técnico |
| Primer despliegue demasiado tardío | Preparación/smoke IMP-00.08; actualización por incremento | Ruta híbrida probada con configuración y versión identificadas |
| Se confunde demo con piloto o documentación con software | Estados separados, datos ficticios y DEC-009/012 | Evidencia de cada afirmación y condiciones institucionales pendientes visibles |
| Funciones nuevas después del freeze | DEC-011 y revisión de selección antes de comprometernos | Candidato y alcance congelado reales; correcciones sin ampliación implícita |

No se añaden estimaciones de horas, fechas ni asignaciones personales a partir del tamaño de este documento. Los responsables de dominio proponen/revisan contratos; el responsable real de cada entrega se registra al planificarla, conservando las responsabilidades documentadas del equipo.
