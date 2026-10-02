# IMP-04.01–04.03 — Materiales docentes e indexación recuperable

Fecha: 27/09/2026. Autor de implementación: Codex. Estado: **implementado y probado localmente**; la tabla de evidencia distingue comprobaciones ejecutadas y
pendientes. El usuario autorizó este corte del
[plan de ayuda contextual](../plan/04-ayuda-contextual.md), con activación
automática al completar el índice, reemplazo mediante una nueva versión y
validación local separada de Azure real. Se conservan los cambios previos de
IMP-03 y los datos DEV; este registro no acredita aceptación académica ni remota.

## Alcance y resultado

Un profesor asignado a una clase activa o su ADMIN carga PDF con texto, TXT o
Markdown. El archivo recibido queda en Storage privado y el trabajo se confirma
durablemente antes del `202`. La interfaz informa procesamiento y muestra una
versión disponible solo cuando se ha publicado una generación completa. El
material de clase puede servir a sus actividades; el restringido a una actividad
solo sirve a esa actividad. Los permisos vigentes se aplican también a metadatos,
descarga, procesamiento y recuperación vectorial.

Este corte aporta ALZ-RF/HU/CU/PT-006 y 025, incluidos sus escenarios E1–E4 y
fallos complementarios. Conserva RNF-IA-01/03, RNF-CON-01/02/03 y los controles
aplicables de aislamiento, archivos y secretos. La recuperación SQL autorizada
permite comprobar el índice con top-k=5. No incorpora aún la consulta desde un
intento, generación de explicaciones, pistas o referencias de feedback de
IMP-04.04–04.06. La ingestión docente no exige un intento estudiantil.

## Contratos, datos y comportamiento

- NestJS conserva la única API de dominio. Los DTO ejecutables están en
  `packages/contracts/src/materials.ts` y sus rutas se describen en
  [API y contratos](../../specs/07-api-y-contratos.md#fuentes-e-ingestión).
  `source-scopes` entrega a gestores únicamente ID, título y estado de actividad;
  ADMIN no obtiene por ello acceso a ejercicios, intentos o resultados.
- Fuente, versión de contenido y generación de índice son entidades distintas.
  Reemplazar conserva la identidad y crea otra versión inmutable; reindexar crea
  otra generación de la versión elegida. Publicar cambia los punteros
  atómicamente. Una falla mantiene la generación anterior utilizable.
- La fuente expone `ACTIVE/ARCHIVED` y disponibilidad
  `NOT_READY/READY/HIDDEN/ARCHIVED`, independientes del último trabajo
  `UPLOADING/QUEUED/RUNNING/SUCCEEDED/FAILED`. `UPLOADING` distingue la recepción
  pendiente de la confirmación durable del archivo. Estos estados no alteran los tres estados
  del contrato RAG ni los seis diagnósticos deterministas.
- Profesor asignado y ADMIN cargan materiales. El docente reemplaza y reintenta
  sus propias cargas según permiso vigente. ADMIN puede reindexar, ocultar,
  mostrar y archivar. El ámbito inicial clase/actividad permanece fijo; no hay
  reasignación ni ampliación a otra clase. `Idempotency-Key` distingue reintentos
  de transporte de operaciones nuevas; reemplazo, reindexación y gobierno usan
  revisión `If-Match` donde lo declara el contrato.
- El worker adquiere trabajo con lease y token; conserva los lotes completos
  antes de continuar. Recupera cargas inciertas, reinicios y leases vencidos.
  Ningún fragmento parcial se vuelve recuperable. Una tarea terminada después
  del archivo o revocación no reactiva la fuente. La compensación elimina solo
  objetos huérfanos identificados por reservas propias.
- Las descargas pasan por la API autenticada con autorización antes y después
  de acceder a Storage, `no-store` y contenido adjunto. No se emiten enlaces
  públicos o firmados permanentes. Archivar retira acceso y recuperación
  inmediatamente; conserva metadatos e historia sin borrar la versión anterior.
- La web agrega Materiales en clase y actividad, carga/reemplazo, historial,
  consulta paginada de fragmentos con localizador, descarga y gobierno. El
  historial con texto exige permiso docente o administrativo y fuente activa;
  no renderiza Markdown ni HTML del documento. Conserva una solicitud incierta para repetir su clave;
  muestra errores útiles sin HTML ejecutable. El seguimiento automático dura
  hasta 60 segundos y permite actualizar; abandonar la pantalla no cancela el
  trabajo durable.

## Decisiones técnicas del corte

DEC-004/006 concretan los contratos y la migración incremental de materiales;
el [diccionario del corte](IMP-04-materials-dictionary.md) registra entidades,
privilegios, invariantes y revisión del esquema.
DEC-010 fija 10 MB como **10.000.000 bytes**, PDF.js para PDF textual y UTF-8
estricto para TXT/Markdown, sin OCR ni solicitudes a enlaces del documento.
Extractor y fragmentador se ejecutan en un proceso separado con presupuesto de
30 segundos, 512 MiB de RSS, 256 MiB de heap, 1.000 páginas y 20 MiB de texto
extraído; el canal de salida tiene un presupuesto independiente de 100 MiB.
Estos límites pertenecen al procesamiento documental y no sustituyen los límites
de ejecución estudiantil.

La fragmentación utiliza `js-tiktoken`/`cl100k_base`, ventanas de hasta 500 tokens
y objetivo de 50 de solapamiento, preservando texto Unicode y localizadores.
Solo se amplía mínimamente el solapamiento cuando el corte partiría un carácter
UTF-8; no se introducen caracteres de reemplazo ni se supera el máximo de 500.
El archivo, fragmentos y configuración conservan hashes/versiones. Embeddings se solicitan
por lotes de hasta 32, con validación de cantidad, índices, dimensión, valores
finitos y vectores no nulos. El perfil de embeddings del ambiente queda fijado
al preparar su primera generación; una configuración distinta se rechaza como
`CONFIGURATION_MISMATCH`. Cambiar de modelo requiere una migración explícita del
perfil y del corpus, pendiente fuera de este corte; no se mezclan modelos por
reutilizar accidentalmente un identificador.

El lease de procesamiento dura 60 segundos y se renueva; la reserva inicial de
carga dura dos minutos. Se permiten hasta tres intentos automáticos de trabajo
para errores transitorios, con esperas base de 5 y 30 segundos y `Retry-After`
acotado a cinco minutos. Archivos inválidos y errores permanentes no se repiten
automáticamente. La invocación de embeddings tiene un plazo de 15 segundos sin
reintentos internos del SDK; los reintentos corresponden al trabajo durable.

Azure OpenAI sigue siendo el proveedor inicial. Su bloque de configuración de
embeddings es independiente del modelo de generación. Sin configuración completa
no se genera un índice ficticio: se conserva el archivo y se registra un fallo
recuperable. El worker se habilita con `MATERIALS_WORKER_ENABLED`; las claves
privilegiadas de Storage y Azure quedan en servidor.

## Corpus y verificación

El manifiesto `fixtures/demo/materials.mjs` contiene seis documentos ficticios:
dos PDF, dos TXT y dos Markdown, dos por cada clase canónica. No agrega alumnos,
clases ni organizaciones. `npm run materials:demo` los carga por la misma API
autorizada con claves idempotentes; no escribe vectores artificiales en DEV y
reporta recepción, no disponibilidad. Ejecutarlo con Azure configurado puede
invocar ese proveedor y requiere el entorno/gasto ya autorizado.

Las pruebas usan LAB TEST, puertos 18421/18422 y API 4300. Su entrada exclusiva
`tests/materials-api.cjs` inyecta un proveedor de embeddings determinista:
Auth, extracción, Storage, PostgreSQL y pgvector siguen siendo reales. Los
marcadores de fallos se usan únicamente en fixtures adversarios separados del
corpus canónico. Una aprobación en TEST no acredita una llamada a Azure.

| Comprobación                                                                                    | Resultado local                                                                                                                    | Alcance de la evidencia                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime portable                                                                                | Node 24.21.0 / npm 11.19.0                                                                                                         | Activado con `. ./scripts/use-node.ps1` antes de los comandos                                                                                                                              |
| `npm run format:check`, `npm run lint`, `npm run typecheck`                                     | Aprobados; API/web volvieron a comprobar tipos tras las correcciones                                                               | Contratos, código y Cypress tipados                                                                                                                                                        |
| `npm test` y repeticiones dirigidas posteriores                                                 | 532 pruebas en la primera ejecución conjunta; últimos grupos: API 176, web 31, contratos 85, runner 101, IA 126 y preproducción 35 | 554 casos vigentes, sumados por grupo; no se atribuyen a una única ejecución posterior                                                                                                     |
| `npm run test:ai`                                                                               | 126/126                                                                                                                            | Extracción real de seis archivos, Unicode, PDF corrupto/cifrado, límites, fragmentación, errores y validadores Azure con transporte controlado                                             |
| `npm run test:integration`                                                                      | 127/127 HTTP y 335/335 SQL, ocho suites por capa                                                                                   | Migración incremental, permisos, RLS, Storage real, versiones, aislamiento, idempotencia, archivo y recuperación tras caída de PostgreSQL                                                  |
| Recuperación real de materiales dentro de integración                                           | Aprobada, dos reinicios de API                                                                                                     | Reserva incierta recuperada; huérfano eliminado sin borrar historia; 32 fragmentos confirmados se conservan al completar 41; una sola activación; tokens vencidos rechazados               |
| `npm run test:ai:integration`                                                                   | 27/27                                                                                                                              | pgvector real, autorización, caída y recuperación de BD; proveedor sintético explícito del ensayo                                                                                          |
| `runner:prepare`, `runner:doctor`, `runner:probe -- --adapter docker`, `test:academic:fixtures` | Aprobados en esta sesión                                                                                                           | Ejecutor Docker real y fixture académico; Vercel Sandbox remoto sigue pendiente                                                                                                            |
| Imagen API y extracción Linux                                                                   | Build aprobado; PDF textual extraído en contenedor sin red y filesystem de solo lectura                                            | Recursos PDF.js y dependencias de workspace empaquetados; no acredita despliegue                                                                                                           |
| DEV: `local:down`, `local:up`, `db:migrate`                                                     | Storage privado y migración preparados, sin reset de DEV                                                                           | Conservadas 2 organizaciones, 12 perfiles, 4 clases, 3 intentos y 3 ejecuciones; bucket privado con límite 10.000.000 bytes; sin llamadas Azure                                            |
| Cypress, build y artefactos                                                                     | 38/38 E2E; build y revisión de artefactos aprobados                                                                                | Chrome real, sin casos pendientes ni omitidos; IMP04-01/02/03 y regresiones IMP-03; canarios de secretos ausentes del bundle                                                               |
| `npm run test:practice:performance` y `npm run test:practice:performance -- --submit`           | Aprobados: 100 RUN y 100 SUBMIT, cero fallos                                                                                       | 50 solicitudes secuenciales y 50 con concurrencia cuatro por modo; p95 RUN 1.451,49/3.522,02 ms y SUBMIT 3.027,71/3.741,59 ms; meta local menor de 5.000 ms; limpieza de cápsulas aprobada |
| Azure OpenAI real, costos y latencia de embeddings                                              | Pendiente                                                                                                                          | Configuración, destino y autorización del ensayo acotado                                                                                                                                   |
| Aceptación docente/CAPSTONE y accesibilidad manual completa                                     | Pendiente                                                                                                                          | No se atribuyen revisiones humanas ni conformidad WCAG completa                                                                                                                            |

Los informes saneados quedan en `.local/reports/imp-04/`, con los informes de
regresión en sus grupos previos. `npm run ci:verify` se detuvo inicialmente al
final de integración y conserva ese resultado fallido; las comprobaciones
posteriores se ejecutaron individualmente. Se corrigió el cierre de la prueba
para esperar PostgreSQL y preservar el error principal si también falla la
limpieza. La integración completa posterior aprobó la caída y recuperación.

La revisión y las regresiones dirigidas corrigieron conexiones PostgreSQL
prestadas sin listener de error, cancelación indebida tras perder heartbeat,
formulario bloqueado ante carga terminalmente fallida y nombres multipart
acentuados. La carga por actividad detectó además un límite multipart que
rechazaba archivo, título y actividad: el interceptor ahora admite los tres,
manteniendo el rechazo de archivos o campos adicionales. También se verificaron
el empaquetado del extractor Linux, el cursor
numérico de fragmentos sin alterar los cursores UUID y el rechazo SQL de tokens
de lease nulos. No se relajaron aserciones para aceptar índices parciales,
permisos cruzados o respuestas de aceptación sin trabajo durable.

`npm run test:e2e -- --materials` permite repetir únicamente los tres recorridos
de este corte y guarda un informe separado, sin sustituir la exigencia de 38
casos del comando completo. La activación por Enter usa la secuencia nativa de
Chrome ya empleada por IMP-03: se reprodujo que Cypress 16 omitía el evento de
carácter necesario. La prueba conserva interacción por teclado y verifica foco,
sesión y descarga efectiva del archivo en el navegador.

## Trazabilidad de aceptación local

Cada fila conserva los identificadores RF/HU/CU/PT del requisito correspondiente.
Las pruebas de HTTP están en `tests/integration/zzzzzz-materials.test.cjs`, las
de SQL en `supabase/tests/008_materials.test.sql` y las de interfaz en
`tests/e2e/materials.cy.ts`. Esta correspondencia no sustituye la aceptación
docente pendiente.

| Escenario     | Evidencia automatizada                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| ALZ-HU-006-E1 | Seis documentos canónicos por HTTP; fragmentación 500/50 y localizadores en `tests/ai/ingestion.test.cjs`; SQL MAT-16/18/19b–19f; Cypress IMP04-01/02 |
| ALZ-HU-006-E2 | Texto vacío, PDF corrupto/cifrado y metadatos inválidos; ninguna generación activa; errores seguros de extracción y validación                        |
| ALZ-HU-006-E3 | Docente ajeno, alumno retirado/deshabilitado y Storage directo; SQL MAT-20/21 y señuelos más similares excluidos antes del ranking                    |
| ALZ-HU-006-E4 | Formatos falsos/no admitidos y límite exacto/excedido de 10.000.000 bytes; Cypress IMP04-02                                                           |
| ALZ-HU-025-E1 | ADMIN con proyección mínima, historial y fragmentos; generación completa activada transaccionalmente; Cypress IMP04-03                                |
| ALZ-HU-025-E2 | Mismos validadores de archivo para carga docente y gobierno; fallos de extracción no publican índices parciales                                       |
| ALZ-HU-025-E3 | Operaciones según permisos, campos de ámbito inmutables y negativa auditada; SQL MAT-22/26–28 y Cypress IMP04-03                                      |
| ALZ-HU-025-E4 | Fuentes de otras organizaciones/clases/actividades excluidas; reasignación rechazada; SQL MAT-19b/19c/20/21                                           |

La recuperación complementaria se ejecuta en `scripts/materials-recovery.mjs`:
reserva incierta tras Storage, replay, limpieza registrada de huérfanos,
reinicios, checkpoint de lote y finalización con token vencido. Las regresiones
del worker verifican además que perder la renovación del lease cancela el
procesamiento sin convertirlo en un fallo documental definitivo.

## Trabajo siguiente

La IaC actual de `infra/preproduction/main.bicep` corresponde al ensayo IMP-00.
Todavía no conecta Storage, configuración de IA ni el worker de materiales a
la API y concede RBAC de inferencia a la identidad de los ensayos, no a la API.
Además, `minReplicas: 0` no garantiza consumo de trabajos durables cuando no hay
tráfico HTTP. Para operar materiales en Azure Container Apps falta integrar
configuración y secretos de servidor, Storage, permisos de embeddings de la
identidad API y al menos una réplica activa o un consumidor dedicado. Este
corte no despliega esos cambios ni acredita operación productiva.

Ejecutar el ensayo Azure con corpus ficticio y presupuesto autorizado por separado. Después, IMP-04.04–04.06 conectan la recuperación, feedback durable,
pistas y citas con intentos ya confirmados, conservando sus cinco campos y tres
estados exactos. IMP-03.07 — Vercel Sandbox continúa pendiente prioritario antes
de producción; su validación remota no bloquea materiales en el laboratorio.
No se habilitan IA calificadora, señales, tablero, datos reales ni despliegue por
este incremento.
