# Evidencia local del candidato IMP-03 — 23/10/2026

**14/27 RF (51,9%) probados funcionalmente en el principal. CI local aprobado: 14/14 controles.** SUBMIT con cuatro alumnos concurrentes obtuvo p95 de **3502,71 ms**, inferior a 5000 ms. Los 100 envíos se confirmaron y persistieron correctamente, sin cápsulas pendientes. Se conservan el fallo anterior y la comparación instrumentada de su corrección, sin excluir muestras ni ampliar límites.

La [entrega](../../IMP-03-implementation.md), la [matriz RF/HU/CU/PT](../../IMP-03-trazabilidad.md) y el [guion de demo](../../IMP-03-demo.md) delimitan el alcance. Las pruebas históricas de otros candidatos se conservan separadas y no se contabilizan como resultados nuevos. RF-010 sigue parcial por HU-010-E4; aceptación académica y operación remota permanecen pendientes.

**Revisión documental del 23/10/2026:** este README fue actualizado después de congelar la evidencia. `manifest.json` conserva el hash original y los JSON de resultados permanecen íntegros. El [registro de revisión documental](../../REVISION-DOCUMENTAL-2026-10-23.md) identifica los hashes antes/después y la comprobación de los artefactos restantes; esta edición no constituye una nueva ejecución de pruebas.

## Resultados y procedencia

| Evidencia | Resultado |
| --- | --- |
| [Resumen y huella del candidato](verification-summary.json) | 290 archivos de código/contratos/migraciones/pruebas/infra; SHA-256 y alcance exacto registrados |
| [CI local](ci.json) | 14/14 controles aprobados, estado passed |
| Unitarias/contratos, en el reporte CI | 675 aprobadas, seis grupos |
| [Aceptación HTTP/SQL](acceptance.json) y [cierre de integración](integration.json) | 111 HTTP y 313 SQL aprobadas; roles, RLS, caída de BD y recuperación reales |
| [Runner Docker](runner-docker.json) y [doctor](runner-doctor.json) | 78 casos PASS, límites máximos/menores, falsificación, aislamiento y limpieza |
| [Cypress](e2e.json) | 34/34, sin omitidas; Chrome 155.0.8059.85 y Cypress 16.0.0 |
| [Migración académica](academic-upgrade.json) y [versiones](migration-upgrade.json) | Actualización desde IMP-02 conserva filas completas; instalación limpia reejecutada por las suites |
| [Actualización de desarrollo](development-upgrade.json) | 114 filas en 20 tablas preexistentes conservadas, comparación de valores completos |
| [Seed canónico](demo-seed.json) | Dos ejecuciones idempotentes; datos existentes intactos |
| [Recuperación de identidad](identity-recovery.json) | Cinco escenarios de regresión aprobados |
| [Regresión de IA local](ai-integration.json) | 27/27 con pgvector real y doble explícito; no Azure ni IA integrada al producto |
| [Empaquetado](packaging.json) | API/job construidos, imports y UID verificados; Compose válido |
| [RUN](run-performance.json), [SUBMIT](submit-performance.json), [análisis](performance-analysis.md) | 200 solicitudes totales sin fallos funcionales; ambos perfiles de cada operación cumplen p95 <5000 ms |
| [CI anterior](ci-before-performance-fix.json), [SUBMIT anterior](submit-performance-before-fix.json) | Fallo inicial de 5164,50 ms conservado como histórico |
| [Baseline instrumentado](submit-performance-baseline-timed.json) y [variante optimizada](submit-performance-optimized-timed.json) | Comparación previa a CI: p95 concurrente 5708,82 → 3231,95 ms; 100 envíos correctos en cada corrida |
| [Auditoría comparada](dependency-audit.json) | Las mismas 14 entradas afectadas que la base; deuda previa pendiente |
| [Arranque compilado](demo-smoke.json) | Resultado HTTP de la demo principal y limpieza del runner |
| [Manifiesto de archivos](manifest.json) | SHA-256 de los artefactos de esta carpeta |

La primera corrida completa de CI tras la optimización aprobó también `test:ai:integration` y `test:e2e`, además de repetir el rendimiento. Las mediciones optimizadas y CI tienen la misma huella de código. El cambio solapa conexiones independientes y consultas de disponibilidad, comparte únicamente lecturas de imagen pendientes y conserva el digest inspeccionado dentro del mismo SUBMIT. Mantiene cápsulas nuevas, inspecciones, límites publicados, reservas durables y confirmación posterior al commit. La comparación y sus límites causales están en el análisis enlazado.

Los comandos usan Node 24.21.0, npm 11.19.0, PostgreSQL 17.6, pgvector 0.8.0 y Docker 29.7.2 Linux con cgroup v2. TEST es `alunza-edu-foundation-test`, separado del entorno de desarrollo. La huella excluye `docs/`, `specs/`, el README raíz, archivos privados/ignorados y `next-env.d.ts` generado; incluye los archivos bajo `infra/`, incluso su documentación. El registro documental de revisión distingue los cambios posteriores de texto del candidato probado. Los informes conservan timestamps UTC; las pantallas muestran hora de Santiago.

## Capturas revisadas

Solo datos ficticios de TEST, revisados visualmente. Son evidencia de estados observados, no sustituyen las aserciones de las suites.

- [RUN temporal](imp03-ejecucion.png): visibles 1/1, aviso de código editado después de ejecutar y avance 0/1 sin intentos.
- [Historial](imp03-historial.png): dos intentos independientes, comparación pública y avance 1/1.
- [Actividad cerrada](imp03-cerrada.png): resolución no disponible y evidencia propia consultable, sin editor.

Los JSON exportados se comprobaron contra los valores privados de los entornos local/TEST. No se copian credenciales, runtime.json, archivos .env, tokens ni logs privados. Los archivos completos originales permanecen en `.local/reports/`; se conservan también las corridas fallidas de integración y del formato horario de una aserción, corregidas antes de los resultados finales.
