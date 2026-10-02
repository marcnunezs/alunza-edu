# Plan del siguiente desarrollo: envíos, historial y avance

Fecha: 26/09/2026. Autor: Codex. Estado original: **planificado**.
El usuario autorizó después «implementa este plan». La implementación y sus
comprobaciones se registran en [IMP-03.04–03.06](IMP-03-submissions.md).
El resto de este documento conserva el plan previo; no acredita por sí mismo
pruebas, despliegues ni aceptación académica.

## Objetivo y corte recomendado

Completar **IMP-03.04–03.06** en el laboratorio: el estudiante confirma un envío,
obtiene un intento persistido con diagnóstico determinista, lo recupera al
recargar, puede reintentar sin perder el anterior y ve avance real en su actividad.
El primer incremento ejecutable es **IMP-03.04 SUBMIT durable**; después se
integran historial/reintento y avance mínimo, con cierre verificable de cada uno.

La [fase IMP-03](../plan/03-practica-y-ejecucion.md) conserva su alcance completo.
Este corte incluye la aceptación local pertinente de IMP-03.08. IMP-03.07,
Vercel Sandbox y su paridad productiva, siguen pendientes. Ayuda IA/RAG,
materiales, progreso por concepto, señales y tablero docente corresponden a
fases posteriores. Se mantienen AD-ARQ-001 y AD-IA-001.

## Base inspeccionada

Rama `laboratorio`, HEAD `7c6e740`, con numerosos cambios anteriores sin commit.
El corte RUN está en ese árbol de trabajo; no debe reconstruirse desde HEAD ni
descartarse para iniciar este desarrollo.

| Componente                    | Estado observado y reutilización                                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identidad, contenido y editor | Existen autenticación, permisos, clases, publicaciones/versiones y borradores aislados por cuenta y recurso.                                                                           |
| RUN integrado                 | `apps/api/src/practice` admite, ejecuta Docker, conserva respuesta idempotente y reconcilia; `run-result-panel.tsx` presenta un resultado temporal. No guarda fuente ni crea intentos. |
| Motor de ejecución            | `packages/runner/src/index.ts` ya contempla RUN/SUBMIT, resultados privados y `allRequiredPassed`; reutilizar supervisor QuickJS/WASM y límites existentes.                            |
| Puerto de práctica            | `execution.port.ts` y `docker-execution.adapter.ts` solo admiten RUN/pruebas visibles. Requieren una extensión interna explícita para SUBMIT.                                          |
| Persistencia                  | `app.executions` está restringida a RUN. Las migraciones actuales no implementan intentos, resultados canónicos ni eventos de envío.                                                   |
| Interfaz                      | Falta confirmación de Enviar, detalle/historial persistido, copia para reintentar y avance basado en intentos.                                                                         |

Se revisaron código y reportes existentes, sin ejecutar nuevas suites. El
[registro RUN](IMP-03-practice.md) documenta CI local de 13 etapas, 327 pruebas,
97 pruebas HTTP, 181 aserciones SQL y 29 recorridos Cypress. Los informes de
`.local/reports/imp-03/` respaldan ese cierre previo. Su rendimiento corresponde
a RUN local de un ejercicio con una prueba visible; no acredita SUBMIT, una
suite completa ni un proveedor remoto.

## Decisiones y dependencias

**DEC-002, resuelta por el usuario en esta planificación:** guardar los envíos
admitidos por el servidor antes del cierre y rechazar nuevas admisiones después.
Confirmar el diálogo del navegador no equivale a admisión. Esta se serializa con
el cierre; un envío ya admitido puede ejecutar y confirmar su transacción después.
Se conserva la ventana `[opensAt, closesAt)`, sin reapertura. Responder, recuperar
y consultar historia exige autorización vigente; una reserva no concede acceso.
Implementación y pruebas de esta regla permanecen pendientes.

| Decisión/dependencia | Tratamiento en este corte                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DEC-003/007          | Conservar runtime y límites ya fijados: 134217728 bytes totales de proceso, 3000 ms acumulados y 65536 bytes de salida. Verificar de nuevo la integración SUBMIT y confidencialidad de ocultas; no cambiar dependencias por defecto. |
| DEC-004/006          | Revisar diccionario y contrato antes de migrar: reserva privada, intento inmutable, resultado canónico, eventos, orden, idempotencia y recuperación. Son trabajo de implementación pendiente.                                        |
| DEC-008              | Medir SUBMIT completo, incluida persistencia; declarar perfil local, errores, concurrencia y muestras. La región y medición híbrida quedan pendientes.                                                                               |
| DEC-005              | Capturar hechos y orden deterministas reutilizables; no activar reglas de señales ni resolver implícitamente su semántica.                                                                                                           |
| DEC-009/012          | Usar datos ficticios y conservar la demo canónica. No autoriza datos reales ni política institucional de retención.                                                                                                                  |

No faltan credenciales remotas para construir y verificar el corte local. Antes
de trabajar, verificar cambios posteriores, servicios/puertos y separación
DEV/TEST. Las comprobaciones no deben reinicializar DEV ni alterar recursos ajenos.

## Secuencia de trabajo y entregables

| Orden               | Trabajo acotado          | Entregable verificable y dependencia                                                                                                                                                                                        |
| ------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 · IMP-03.04       | Contratos y diccionario  | DTO públicos separados del resultado privado, admisión/cierre, recuperación, permisos y fixtures acordados. Revisar antes de escribir migraciones.                                                                          |
| 2 · IMP-03.04       | Persistencia y ejecución | Migración incremental, RLS y operaciones internas; reserva durable, suite completa, confirmación atómica y reconciliación. Depende de 1.                                                                                    |
| 3 · IMP-03.04       | Envío desde el editor    | Diálogo accesible, captura del código confirmado, estados pendientes/error y recuperación del mismo envío. Cierre: envío real consultable después de recarga y pruebas de fallos aprobadas. Depende de 2.                   |
| 4 · IMP-03.05       | Historial y reintento    | Lista paginada, detalle y comparación visible autorizados, copia al editor y nuevo envío que conserva el original. Cierre: dos intentos distintos y repetición de transporte sin duplicado. Depende de 3.                   |
| 5 · IMP-03.06       | Avance mínimo            | Consulta y presentación de completados/requeridos sobre asignaciones y versiones fijas, con estados vacíos/error correctos. Cierre: fórmula probada con resultados visibles y ocultos. Depende de 2; integrar después de 4. |
| 6 · IMP-03.08 local | Integración y evidencia  | Regresión RUN, pruebas del corte, rendimiento SUBMIT, demo reproducible, OpenAPI y trazabilidad actualizados. Cierre local sin atribuir aceptación remota/humana. Depende de 3–5.                                           |

No se asignan fechas ni horas sin disponibilidad real del equipo. Esta secuencia
no modifica sprints, puntos, presupuesto ni el freeze académico.

## Contratos que debe implementar el corte

Las rutas propuestas en [spec 07](../../specs/07-api-y-contratos.md) usan el prefijo
`/api/v1` y la API de dominio única de NestJS:

- `POST /activities/{id}/exercises/{aeId}/attempts`: `code`,
  `exerciseVersionId`, `previousAttemptId?` e `Idempotency-Key`.
- `GET /activities/{id}/exercises/{aeId}/attempts`: historial propio paginado.
- `GET /attempts/{id}`: código, versiones, fecha y resultado público del intento
  propio. La interfaz de seguimiento docente se completa en IMP-06; ADMIN no
  obtiene lectura pedagógica por gobernar la organización.

El servidor deriva identidad, ámbito, versión fijada, suite y límites. Si existe
`previousAttemptId`, debe pertenecer al mismo estudiante y asignación. SUBMIT
ejecuta de nuevo todas las pruebas requeridas; un RUN previo nunca lo sustituye.

Separar el resultado privado del runner del DTO estudiantil. Conservar los seis
diagnósticos exactos, conteos visibles y resumen permitido de completitud, sin
IDs, argumentos, expectativas, consola ni trazas derivados de pruebas ocultas.
`SUCCESS` y `allRequiredPassed` exigen evidencia completa. Mantener motivos
operativos separados del diagnóstico y `Cache-Control: no-store`.

### Persistencia, recuperación y concurrencia

1. Cancelar el diálogo conserva el borrador y no envía POST ni crea reservas.
   Confirmar captura una versión inmutable del código para esa operación; editar
   después no modifica el envío en curso.
2. Admitir transaccionalmente respecto del cierre: permisos vigentes, ventana,
   versión, cupos e idempotencia. Guardar una reserva privada con código y
   metadatos necesarios para recuperar la operación; aún no es un intento.
3. Ejecutar fuera de una transacción larga. Obtener la suite completa mediante
   una operación interna de alcance limitado que verifica la reserva y sus
   relaciones; no ampliar `tests_read` del alumno ni usar `service_role` general.
4. Confirmar en una transacción intento, código, resultado canónico, versiones,
   eventos deduplicados y vínculo/respuesta idempotente. Solo después responder 201. Persistir `admittedAt`, fecha de confirmación y un orden monotónico para
   desempates; no ordenar intentos concurrentes por llegada de respuestas.
5. Misma clave/payload recupera el mismo intento. Otro payload con esa clave
   produce conflicto; una operación en curso devuelve 409 `REQUEST_IN_PROGRESS`
   y `Retry-After`. Un nuevo envío intencional usa otra clave. Proponer conservar
   respuesta 24 horas y vínculo/hash después de expirar, siguiendo el patrón
   vigente; una clave expirada nunca crea un segundo envío.
6. Recuperar primero el vínculo y cualquier resultado durable antes de actuar.
   Caer después del commit no pierde el intento. Caer antes no permite anunciar
   persistencia. No reejecutar código automáticamente si el resultado es incierto:
   reconciliar leases y cápsulas, registrar fallo operativo sin completitud y
   permitir un nuevo envío explícito. Solo una evidencia normalizada válida
   permite confirmar un resultado, incluido UNKNOWN cuando corresponda.
7. Aplicar cuotas a ambas operaciones sin permitir eludir el total combinando
   RUN y SUBMIT. La cuota actual de un RUN activo no resuelve HU-014-E4.
   Propuesta técnica inicial: mantener un RUN y permitir hasta dos SUBMIT activos
   por estudiante/organización, sujetos al total compartido de cuatro por
   organización y diez admisiones por minuto. Validar consumo/rendimiento; cada
   envío admitido tiene identidad propia y un rechazo por cupo no se confirma.
8. Revalidar autorización al entregar o consultar, también después del cierre,
   renovación de token, cambio de cuenta y revocación. El archivado debe considerar
   reservas SUBMIT activas para no interrumpir su finalización durable.

El diccionario debe concretar retención y purga de snapshots operativos fallidos,
grants, FK compuestas, unicidad, versiones y orden. Los intentos confirmados no
se sobrescriben ni se purgan al vencer su respuesta idempotente. Los eventos de
envío quedan en el commit; su uso por señales se aborda en IMP-05. Este corte no
invoca IA/RAG ni habilita ayuda sobre reservas.

### Historial, reintento y avance

El historial usa orden estable de servidor y cursor; el detalle conserva el
código/resultado de cada intento. Permite seleccionar dos intentos propios
comparables y contrastar cantidades reales de pruebas visibles superadas,
identificando las versiones. Suites diferentes se muestran como no comparables,
sin atribuir mejora o retroceso ni revelar detalles ocultos.
Copiar un intento propio al editor no lo muta
y advierte si reemplaza un borrador editado. Un nuevo envío pide confirmación y
usa una nueva clave. En CLOSED se conserva la consulta histórica autorizada y
el borrador, con envío deshabilitado; no se amplían permisos ni `canEdit`.

Para RF-007, `required` cuenta asignaciones requeridas y `completed` aquellas con
algún intento confirmado que superó todas sus pruebas requeridas. Un fallo
posterior no borra un éxito; otra asignación o versión no lo hereda. RUN,
reservas e intentos inconclusos no completan ejercicios.

Mostrar `completed/required`, proporción sin redondear en API y `asOf`:
`0/0` implica proporción nula y «Sin ejercicios requeridos»; `0/N` sin envíos
implica «Sin intentos»; una consulta fallida muestra error recuperable. Reutilizar
una sola proyección conforme a [spec 14](../../specs/14-progreso-y-senales.md),
ampliable en IMP-05. El caso `0/0` requiere fixture de frontera; no habilita
publicar actividades vacías contra el contrato vigente.

## Archivos y reparto posible

| Área         | Rutas existentes a ampliar; archivos nuevos por concretar al implementar                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contratos    | `packages/contracts/src/practice.ts`, `packages/contracts/src/academic.ts`, `scripts/openapi.mjs`, `packages/contracts/openapi.json`.                              |
| Datos        | Nueva migración en `supabase/migrations/`, nuevas pruebas en `supabase/tests/`, diccionario de envíos en `docs/work/`; conservar las migraciones aplicadas de RUN. |
| Backend      | `apps/api/src/practice/` y consultas de `apps/api/src/academic/`; añadir repositorio/servicios de intentos y avance donde corresponda.                             |
| Web          | Editor/ruta de ejercicio, componentes nuevos de envío/historial, `activity-panel.tsx`, `class-panel.tsx` y `apps/web/src/lib/api.ts`.                              |
| Verificación | Contratos, pruebas de práctica, `tests/integration/zzzz-practice.test.cjs`, `tests/e2e/practice.cy.ts`, `scripts/practice-performance.mjs` y CI afectada.          |
| Cierre       | Registro propio del corte, `docs/plan/09-control-y-trazabilidad.md`, specs de datos/API afectados y guía de reproducción. Conservar reportes previos.              |

Tras fijar contratos, pueden avanzar tres frentes con archivos disjuntos:
datos/RLS, servicios NestJS/ejecutor y web. El integrador conserva contratos,
OpenAPI y pruebas de integración; revisa cada entrega y la ruta completa. Los
dobles temporales de desarrollo no acreditan aceptación. No se asignan aquí
contribuciones ni revisiones a personas del equipo.

## Aceptación y verificación previstas

Trazabilidad principal: **ALZ-RF/HU/CU/PT-007, 010, 011 y 014**, con escenarios
E1–E4. Regresión de 001/005/008/009. Aplican RNF-REN-01/02/04,
RNF-SEG-01–05, RNF-USA-01–04, RNF-CON-01/02/04, RNF-MAN-02, RNF-IA-05 y RNF-POR-01–03 en las superficies
afectadas. No se cierran RF/RNF completos por esta planificación.

| Caso                               | Resultado exigido                                                                                                                                           | Nivel principal                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Confirmar/cancelar                 | Cancelar sin efectos; confirmar guarda el código capturado y permite recuperar ID, fecha y resultado tras recargar.                                         | Cypress + API/SQL                      |
| Visibles correctas, oculta fallida | FAILED_TEST, sin completitud ni filtración en respuesta, UI, logs o errores.                                                                                | Runner real + integración + inspección |
| Seis diagnósticos                  | Evidencia determinista y UNKNOWN seguro; nunca una causa estudiantil inventada por caída del servicio.                                                      | Fixtures + contratos                   |
| Fallo antes/durante commit         | Sin 201, intento parcial, evento huérfano, avance ni solicitud IA/RAG; borrador conservado.                                                                 | Inyección de fallos + SQL              |
| Respuesta perdida tras commit      | Repetición con misma clave recupera un único intento, resultado y conjunto de eventos, también tras reinicio.                                               | Integración + Cypress                  |
| Duplicados/concurrencia            | Misma clave no duplica; payload distinto entra en conflicto; dos envíos intencionales admitidos conservan IDs y orden distintos.                            | Integración concurrente                |
| Cierre y ventana                   | Admitido antes termina y persiste; cierre anterior a admisión y frontera `closesAt` rechazan; confirmar UI por sí solo no reserva.                          | Carrera real + reloj controlado        |
| Identidad/ámbito                   | Alumno ajeno, otra clase/organización, ADMIN y usuario revocado no obtienen código ni resultados; renovación/cambio de sesión no mezcla respuestas.         | API + RLS real + Cypress               |
| Reintento                          | Copia autorizada; original intacto; CLOSED conserva consulta permitida y bloquea otro envío.                                                                | Integración + Cypress                  |
| Comparación de intentos            | ALZ-HU-011-E1: conteos visibles reales de dos intentos propios de la misma suite; versiones distintas identificadas como no comparables; sin datos ocultos. | Integración + Cypress                  |
| Avance                             | RUN no cuenta; oculta fallida no cuenta; éxito previo se conserva; `0/0`, `0/N`, versiones distintas y error de servicio son distinguibles.                 | Fixtures independientes + UI           |
| Ayuda futura                       | Frontera de persistencia preparada; ALZ-HU-010-E4 y caída real del proveedor se revalidan en IMP-04.                                                        | Pendiente de integración IA            |
| Rendimiento/limpieza               | Medición SUBMIT extremo a extremo y p95 local objetivo <5 s; cero cápsulas propias huérfanas; informar fallos sin ocultar muestras.                         | Docker real + medición HTTP            |

Usar los scripts reales: `npm run format:check`, `npm run lint`,
`npm run typecheck`, `npm test`, `npm run test:integration`,
`npm run runner:probe -- --adapter docker`, `npm run test:academic:fixtures`,
`npm run test:practice:performance` y `npm run test:e2e`.
Extender la medición actual para incluir SUBMIT antes de atribuirle resultados;
proponer al menos 50 muestras secuenciales y 50 a concurrencia cuatro con
fixtures que incluyan pruebas ocultas, tiempos completos y errores registrados.
Ejecutar los controles focales durante el desarrollo y `npm run ci:verify` al
cerrar, evitando repeticiones sin cambios o fallos que las justifiquen.

Guardar evidencia del nuevo corte separada de los reportes RUN. La demo de
cierre muestra: ejecutar sin avance → enviar fallo oculto → recargar historial
→ copiar/corregir → enviar éxito → conservar ambos intentos y actualizar avance.
Añadir recuperación de respuesta perdida y ambos órdenes de cierre/admisión.

## Próxima acción

Al recibir una solicitud de implementación, comenzar por IMP-03.04: revisar el
diccionario y definir el contrato público/privado y la recuperación; implementar
después datos, NestJS, UI y pruebas de ese incremento. La regla de cierre ya
está resuelta y no requiere otra confirmación. Tras cerrar .04, continuar .05 y
.06 solo si están incluidos en el encargo. Este plan deja preparado ese alcance
sin iniciar código ni efectos externos.
