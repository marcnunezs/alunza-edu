# Control, dependencias y trazabilidad del plan

**Estado inicial de todas las fases e incrementos: pendiente.** Se conservan los cortes históricos IMP-00; el corte institucional IMP-01 se documenta por separado. Este registro acompaña el [plan progresivo](README.md). No sustituye las matrices normativas de [funcionalidad](../../specs/02-requisitos-funcionales.md), [escenarios](../../specs/03-flujos-y-criterios-de-aceptacion.md) y [calidad](../../specs/10-calidad-y-pruebas.md).

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
| ALZ-RF-015 | Progreso por actividad/concepto | [IMP-05](05-progreso-y-senales.md) | Reutilizar cálculo mínimo IMP-03; denominadores y versiones |
| ALZ-RF-016 | Tablero de clase autorizado | [IMP-05](05-progreso-y-senales.md) | Integrar eventos reales de ayuda de IMP-04; revalidar agregado/detalle en IMP-06 |
| ALZ-RF-017 | Detalle docente del estudiante | [IMP-06](06-gobierno-y-seguimiento.md) | Intentos IMP-03, ayudas IMP-04 y seguimiento IMP-05 |
| ALZ-RF-018 | Tres señales con causa/evidencia | [IMP-05](05-progreso-y-senales.md) | Motor y reglas RF-026; DEC-005; evidencia básica ya visible |
| ALZ-RF-019 | Revisar señal sin borrar evidencia | [IMP-06](06-gobierno-y-seguimiento.md) | Confirmación/cancelación, una transición y primer revisor/fecha |
| ALZ-RF-020 | Gobierno de organizaciones | [IMP-01](01-identidad-y-aislamiento.md) | DEC-001; seed no completa aprovisionamiento; probar dependencias activas posteriores |
| ALZ-RF-021 | Invitar, activar/deshabilitar y asignar roles | [IMP-01](01-identidad-y-aislamiento.md) | Último administrador y cambios concurrentes; Auth/BD coherentes |
| ALZ-RF-022 | Gobierno académico y asignaciones | [IMP-02](02-contenido-y-publicacion.md) | Curso antes de clase; profesor activo del ámbito |
| ALZ-RF-023 | Taxonomía de conceptos | [IMP-02](02-contenido-y-publicacion.md) | Unicidad, ciclos y referencias/versiones históricas |
| ALZ-RF-024 | Gobierno integral del banco | [IMP-06](06-gobierno-y-seguimiento.md) | Base de propiedad/versionado/visibilidad en IMP-02; archivo no borra intentos |
| ALZ-RF-025 | Gobierno y reindexación del corpus | [IMP-04](04-ayuda-contextual.md) | Servicio compartido con RF-006; versiones/generaciones, permisos vigentes |
| ALZ-RF-026 | Configurar/activar reglas versionadas | [IMP-05](05-progreso-y-senales.md) | Modelo/validador antes del motor; no reescribir señales históricas |
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
| DEC-005 Señales | Captura de eventos IMP-03; cálculo IMP-05 | Activar reglas y aceptar ventanas/episodios como semántica final | Funciones puras/fixtures con propuesta registrada y progreso sin esa ambigüedad |
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
