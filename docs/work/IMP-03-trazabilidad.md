# Trazabilidad del corte funcional IMP-03

Preparada el 23/10/2026. Estado: cinco cierres funcionales locales y nueve RF revalidados; **14/27 = 51,9%**. Los veinte escenarios siguientes quedaron cubiertos por pruebas aprobadas del principal. La [evidencia del candidato](evidence/imp-03/README.md) registra CI local aprobado (14/14 controles), con p95 SUBMIT concurrente de 3502,71 ms frente a <5000 ms. Conserva también el fallo histórico y su corrección. Los resultados corresponden al candidato de Alunza y no atribuyen aceptación académica.

Se conservan los identificadores `ALZ-RF-NNN`, `ALZ-HU-NNN`, `ALZ-CU-NNN` y `ALZ-PT-NNN` del mismo número. El objetivo añade cinco RF a los nueve de IMP-02: **14/27 = 51,9%**, funcionalidad local; sin aceptación académica atribuida.

**Clasificación completa del corte:** 14 RF completos locales, RF-010/015/024 parciales y RF-006/012/013/016/017/018/019/025/026/027 pendientes. La [matriz vigente](ESTADO-ACTUAL.md) detalla la cobertura sin cambiar el alcance comprometido de 27 RF.

## Fuentes de evidencia

| Alias | Archivo |
| --- | --- |
| L | [Integración académica](../../tests/integration/learning.test.cjs) |
| R | [RUN real](../../tests/integration/zzzz-practice.test.cjs) |
| S | [SUBMIT, historial y progreso reales](../../tests/integration/zzzzz-submissions.test.cjs) |
| SQL | [RUN pgTAP](../../supabase/tests/006_practice_runs.test.sql) y [SUBMIT pgTAP](../../supabase/tests/007_practice_submissions.test.sql) |
| ER | [Cypress práctica](../../tests/e2e/practice.cy.ts) |
| ES | [Cypress envíos](../../tests/e2e/submissions.cy.ts) |
| EL | [Cypress académico](../../tests/e2e/learning.cy.ts) |
| D | [Batería del ejecutor](../../scripts/runner-probe.mjs) y [fixtures adversariales](../../tests/runner/fixtures.mjs) |
| C | [Contratos RUN](../../tests/practice-contracts.test.cjs), [SUBMIT](../../tests/submission-contracts.test.cjs) y [errores HTTP](../../apps/api/src/http/errors.spec.ts) |
| U | [Validación académica](../../apps/api/src/academic/academic.spec.ts) y [estado/comparación web](../../apps/web/test/attempt-state.test.mjs) |

Los servicios de negocio de las integraciones son reales. Cypress retiene o interrumpe respuestas de transporte para probar pérdida de ACK y respuestas tardías; no reemplaza el ejecutor ni fabrica intentos. Los casos de falla de almacenamiento de navegador se identifican como tales. Las pruebas SQL operan con roles y contexto reales dentro de transacciones de TEST.

## Veinte escenarios de los cinco cierres nuevos

| Escenario | Comprobación | Resultado exigido |
| --- | --- | --- |
| ALZ-HU-005-E1 | L `HU-005 E1/E2/E3`; EL `IMP02-05` | Publicación conserva estado y orden de dos ejercicios; visible para matrícula autorizada. |
| ALZ-HU-005-E2 | L misma prueba y fallo de auditoría; U fechas inválidas | HTTP comprueba DRAFT intacto ante publicación vacía y rollback; el contrato rechaza fechas incoherentes antes de persistir. |
| ALZ-HU-005-E3 | L misma prueba; R/S rechazo de ámbito | Estudiante, ADMIN de gobierno y docente ajeno no publican ni cierran. |
| ALZ-HU-005-E4 | L `HU-008 E2/E4`; R `Cierre serializado`; S `DEC002`; ES `IMP03-05/06` | DRAFT→PUBLISHED→CLOSED; admisión previa termina/persiste; nueva admisión se rechaza; historia intacta. |
| ALZ-HU-007-E1 | S `RF007/010/011/014`; SQL progreso; EL `IMP02-05`; ES `IMP03-04` | Estudiante ve fecha, estado, instrucciones y orden; catálogo y detalle muestran avance derivado de entregas completas, no RUN. |
| ALZ-HU-007-E2 | S validación de consultas; C progreso; ER `IMP03-09` | UUID/filtro inválido o consulta fallida no produce avance inventado. |
| ALZ-HU-007-E3 | L proyección estudiantil; S permisos de consulta; SQL RLS | Matrícula y organización actuales restringen publicaciones y avance. |
| ALZ-HU-007-E4 | S catálogo cerrado sin publicaciones; ES `IMP03-06` | Clase sin PUBLISHED muestra vacío comprensible; evidencia propia permanece separada. |
| ALZ-HU-009-E1 | R casos reales y UTF-8 máximo; ER `IMP03-01`; D aislamiento | RUN temporal prueba solo visibles, termina y limpia; no crea intento ni progreso. |
| ALZ-HU-009-E2 | R rechazo previo y diagnósticos; ER `IMP03-02`; C | SYNTAX_ERROR normalizado y entrada inválida sin admisión ni pérdida del borrador. |
| ALZ-HU-009-E3 | R rechazo de actor/ámbito y revocación; SQL | Sin autoridad no ejecuta ni entrega evidencia protegida. |
| ALZ-HU-009-E4 | D máximos/menores/acumulado, retorno falsificado, OS; R diagnósticos | Ensayos Docker locales verifican límites efectivos y rechazo de acceso a archivos del anfitrión, red, secretos y retorno falsificado. |
| ALZ-HU-011-E1 | S seis resultados y consulta; ES `IMP03-03/04` y U comparación | Diagnóstico y cantidades visibles corresponden al intento persistido; comparación de intentos propios con evidencia pública. |
| ALZ-HU-011-E2 | S consultas inválidas y ocultas; C proyección estricta | Error corregible o resumen permitido; sin IDs, entradas, expectativas, consola ni errores ocultos. |
| ALZ-HU-011-E3 | S `RLS y API impiden leer...`; SQL; ES `IMP03-06/07` | No expone intentos inexistentes/ajenos ni evidencia de otra sesión. |
| ALZ-HU-011-E4 | S caso `UNKNOWN`; D límites/condición desconocida | UNKNOWN permanece consultable sin diagnóstico fabricado. |
| ALZ-HU-014-E1 | S `RF007/010/011/014`; ES `IMP03-04` | Copia confirmada, edición y entrega nueva; ambas soluciones/resultados permanecen separados. |
| ALZ-HU-014-E2 | S rechazo y DEC002; EL `IMP02-09`; ES `IMP03-05/06` | Cierre/validación impiden nueva admisión, conservan evidencia y borrador en curso. |
| ALZ-HU-014-E3 | S RLS/API/previousAttemptId; SQL; ES `IMP03-06/07` | Intento ajeno no puede leerse/copiarse ni atribuirse. |
| ALZ-HU-014-E4 | S `Idempotencia y dos envíos...`; ES `IMP03-08` | Dos claves intencionales crean IDs distintos; respuesta invertida no sobrescribe historial ni resultado más reciente. |

## Base conservada y dependencia parcial

La [matriz IMP-02](IMP-02-trazabilidad.md) conserva los 36 escenarios de RF-001/002/003/004/008/020/021/022/023. Se repiten las suites de fundación, identidad, carreras, contenido, SQL y los 25 recorridos de navegador anteriores sobre este candidato. El nuevo ejecutor debe respetar los límites personalizados del banco; no se modifica la definición de RF-004 para usar máximos fijos.

RF-010 tiene implementados envío, validación, permisos, código/resultado/eventos atómicos, reservas, idempotencia, fallo de commit, reinicio y respuesta perdida (S y ES `IMP03-03/05/08`). **No se contabiliza completo:** HU-010-E4 exige proveedor de feedback real o su falla integrada con `PROVIDER_UNAVAILABLE`; IMP-03 no añade IA. La ausencia de llamada IA en este corte no acredita ese escenario. RF-015 sigue parcial aunque se reutilice su fórmula por actividad: conceptos/ayudas/señales permanecen posteriores.

## Comprobaciones complementarias

- Migración limpia y actualización incremental de IMP-02 conservando filas institucionales/académicas completas.
- Lease vencido durante espera de bloqueo, token antiguo, recuperación sin ejecutar nuevamente y limpieza de cápsula tardía.
- Fallo de BD/commit, revocación durante ejecución y salida tardía tras cambio de cuenta.
- Historia paginada estable, éxito anterior conservado, ocultas fallidas no completan y denominador cero con proporción nula.
- El historial se ordena por número de intento descendente, asignado al admitirlo. Respuestas invertidas no cambian ese orden; la fecha de persistencia puede diferir del orden de admisión.
- Perfiles de 50 operaciones secuenciales y 50 con concurrencia cuatro para cada RUN y SUBMIT; se conservan fallos y percentiles completos.

No se acredita WCAG integral, rendimiento productivo, Vercel Sandbox remoto ni aceptación del profesor mediante estas comprobaciones locales.
