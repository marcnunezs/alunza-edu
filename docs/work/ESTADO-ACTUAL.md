# Estado actual de Alunza — 23/10/2026

El alcance comprometido se mantiene en **27 requisitos funcionales Must**. La cobertura funcional probada localmente es **14/27 = 51,9 %**; aumentó desde los 9/27 (33,3 %) del corte IMP-02. No representa aceptación académica, porcentaje de horas consumidas ni despliegue productivo.

## Cobertura funcional vigente

| Estado | RF | Cantidad |
| --- | --- | ---: |
| Completos y probados localmente | RF-001, 002, 003, 004, 005, 007, 008, 009, 011, 014, 020, 021, 022, 023 | 14 |
| Parciales | RF-010, 015, 024 | 3 |
| Pendientes de integración completa | RF-006, 012, 013, 016, 017, 018, 019, 025, 026, 027 | 10 |
| Total comprometido | Los 27 RF originales de la ERS 1.3 | 27 |

IMP-03 conserva los nueve cierres de IMP-02 y añade RF-005/007/009/011/014. La [matriz de escenarios](IMP-03-trazabilidad.md) enlaza veinte escenarios nuevos y la regresión de los 36 anteriores; la cantidad de casos automatizados es distinta de la cantidad de escenarios de origen.

- **RF-010:** envío confirmado, persistencia, recuperación e idempotencia implementados. HU-010-E4 requiere revalidación con la ayuda IA real y su falla integrada `PROVIDER_UNAVAILABLE`; no se cuenta completo.
- **RF-015:** existe cálculo determinista por actividad. Conceptos, evidencias de ayuda y seguimiento integral mantienen su incremento pendiente.
- **RF-024:** existe base de propiedad, versiones, visibilidad y archivo del banco; el gobierno integral requiere IMP-06.

## Funcionalidad que puede demostrarse

Identidad y gobierno institucional; cursos, clases, inscripción por código, taxonomía, ejercicios versionados, publicación y cierre; editor con borrador por cuenta/contexto; RUN temporal sobre pruebas visibles; SUBMIT confirmado con código, resultados y eventos persistidos; seis diagnósticos deterministas; historial propio, comparación, copia confirmada y nuevo intento; progreso por actividad derivado de entregas que superan todas las verificaciones requeridas.

Una operación admitida antes del cierre puede finalizar y persistirse; nuevas admisiones posteriores se rechazan. CLOSED conserva evidencia propia autorizada sin reabrir la resolución. Una repetición de transporte recupera la misma clave e intento; un reintento intencional usa otra clave. RUN no completa ejercicios y un fallo posterior no borra un éxito anterior. `NO_ATTEMPTS`, `NO_REQUIRED_EXERCISES` y una consulta fallida son estados diferentes.

Las rutas vigentes y proyecciones públicas están en [OpenAPI](../../packages/contracts/openapi.json), [RUN](../../packages/contracts/src/practice.ts), [SUBMIT](../../packages/contracts/src/submissions.ts) y [API y contratos](../../specs/07-api-y-contratos.md). El [guion de demo](IMP-03-demo.md) describe el recorrido con datos ficticios.

## Arquitectura y datos efectivos

Next.js y NestJS usan Supabase Auth/PostgreSQL con RLS. NestJS concentra la API de dominio y orquesta el adaptador Docker local con QuickJS/WASM 0.32.0. El supervisor conserva la comparación de pruebas ocultas y la respuesta pública omite sus identificadores, entradas, expectativas y consola. Los límites máximos de proceso son 134217728 bytes de memoria, 3000 ms acumulados y 65536 bytes de salida; se respetan límites menores de cada versión. Docker rechaza presupuestos inferiores a su capacidad mínima sin aumentarlos.

El esquema contiene **25 tablas, 292 atributos de columna y 4 migraciones**. IMP-03 añade cinco tablas a las veinte preexistentes: `app.executions`, `app.attempts`, `app_private.submission_reservations`, `app_private.attempt_results` y `app_private.attempt_events`. Las 114 filas preexistentes comparadas en el ensayo de actualización conservaron sus valores. Los inventarios excluyen objetos internos administrados por Supabase y el esquema TEST de pgvector. [Diccionario de práctica](IMP-03-dictionary.md).

El fixture conserva 2 organizaciones, 2 administradores, 2 profesores, 8 estudiantes, 3 clases y 10 ejercicios. Los 6 documentos del corpus objetivo continúan pendientes con la ingesta de IMP-04; no se presenta esa parte como implementada.

## Evidencia local conservada

| Comprobación del corte IMP-03 | Resultado |
| --- | --- |
| Unitarias y contratos, seis grupos | 675 aprobadas |
| API real | 111/111 |
| SQL/pgTAP, siete archivos | 313/313 |
| Docker adversarial y limpieza | 78/78 |
| Cypress en Chrome | 34/34, sin omitidas ni pendientes |
| pgvector local y proveedor doble explícito | 27/27; no Azure ni IA de producto |
| CI local | 14/14 controles |
| RUN: p95 secuencial / concurrente | 1030,14 / 2227,87 ms |
| SUBMIT: p95 secuencial / concurrente | 1654,12 / 3502,71 ms |

Cada operación medida conserva 50 solicitudes secuenciales y 50 con concurrencia cuatro: 200 solicitudes entre RUN y SUBMIT, sin fallos funcionales y con limpieza verificada. RNF-REN-02 cumple este perfil local frente a <5000 ms; no se extrapola a producción, otras regiones o cargas. El fallo inicial SUBMIT de 5164,50 ms y las corridas instrumentadas permanecen como antecedentes separados. No se suman suites que puedan compartir comprobaciones para inventar un total único de calidad.

Fuente: [resumen de verificación](evidence/imp-03/verification-summary.json), [CI](evidence/imp-03/ci.json), [evidencia local](evidence/imp-03/README.md) y [análisis de rendimiento](evidence/imp-03/performance-analysis.md). CI final registrado a las 05:45:08 UTC del 23/10/2026 (02:45:08 de Santiago); resumen a las 05:47:19 UTC (02:47:19 de Santiago). Huella histórica de los 290 archivos del candidato: `5a5ec24f2a9535101f7cb7a303460d479a06bdf866c4b592ab1b1fcf61076194`.

Entorno del ensayo: Node 24.21.0, npm 11.19.0, Docker 29.7.2/Linux/cgroup v2, PostgreSQL 17.6, pgvector 0.8.0, Cypress 16.0.0 y Chrome 155.0.8059.85. Esta revisión documental coteja evidencia existente; no ejecuta nuevas suites ni cambia resultados originales.

## Límites y siguiente trabajo

IA/RAG y corpus docente, pistas/feedback, progreso por conceptos, tablero/señales, revisión docente, gobierno completo y exportación CSV siguen pendientes de integración. Azure OpenAI, Vercel Sandbox productivo, GitHub Actions remoto, despliegue alojado y aceptación académica no están acreditados.

La [auditoría conservada](evidence/imp-03/dependency-audit.json) registra 14 entradas afectadas previas: 5 críticas, 7 altas y 2 moderadas. Los nuevos paquetes QuickJS no agregan entradas señaladas. Aprobar CI no equivale a una auditoría limpia ni a autorización de publicación. Rendimiento productivo, conformidad WCAG integral e impacto pedagógico siguen sin validación completa.

Se conservan las 11 minutas de Fase 2 entre el 08/09 y el 16/10/2026 y sus hechos históricos. El incremento probado el 23/10 no se atribuye retroactivamente a esas reuniones. La documentación actualizada debe distinguir fecha de revisión y fecha de la evidencia.

Las metas de 27 HU, 184 puntos, 540 horas y CLP 4.585.000 continúan como planificación referencial. El nuevo porcentaje funcional no convierte esas estimaciones en gasto real, esfuerzo consumido ni aprobación del docente.
