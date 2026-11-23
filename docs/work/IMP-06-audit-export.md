# IMP-06.06 — Registro de implementación y verificación

Estado al 02/11/2026 (Santiago): **IMP-06.06 implementado y verificado localmente**. [Plan autorizado](IMP-06-audit-export-plan.md), [contrato](IMP-06-audit-export-dictionary.md). No acredita aceptación humana/remota ni cierre .04/.07.

## Base preservada

Checkpoint local `8161b3b` del acumulado hasta .05; implementación en `codex/imp-06-06-audit-export`. Office modificado y `apps/web/next-env.d.ts` quedan fuera de commits; sus bytes se contrastan con los hashes iniciales. Sin dependencias nuevas ni cambios al lockfile. Secretos, `.local`, builds y evidencia privada permanecen excluidos.

## Diagnóstico offline .04

`resumption-14` conserva 13.654 archivos previos / 513.009.164 bytes y realiza dos aperturas de cabecera OpenTraceW→CloseTrace, sin ProcessTrace/TDH/payloads/reintentos. Principal: 64 KiB × 737 buffers, duración 25.561,0131 ms; adicional: 128 KiB × 2 buffers, 3,8435 ms, inicio 12,5693 ms después del fin principal. Ambas cabeceras declaran pérdidas cero. El controlador construía el inventario solo desde el path consultado, sin enumerar staging.

Resultado **procedencia inconclusa**: ventana distinta compatible con tareas de stop/merge, sin demostrar productor, proveedores, contenido o inocuidad. Se conserva RAW_INVENTORY_MISMATCH; propuesta v2 privada mantiene HOLD_UNRESOLVED_SECONDARY_ETL. No decodificación, captura, campaña contextual ni CI: **9/17 y 0/1**. Sensor/cierre .04 siguen pendientes. Evidencia privada `.local/evidence/imp-06-closure/resumption-14/`; su manifiesto v2 conserva el v1 y aclara la versión del helper de hashes, sin atribuir retrospectivamente la versión final al proceso inicial.

## Implementación

Contratos estrictos compartidos, API Nest con reserva/captura/finalización, CSV acotado, entrega privada con ticket, conciliador, migración incremental y UI con recuperación de clave. Se añaden focos `test:audit-export:integration`, `test:audit-export:upgrade`, `test:audit-export:performance` y `test:e2e -- --audit-export`; inventario contextual congelado de **69 casos / 10 specs** conservado.

## Resultados

Runtime portable Node 24.21.0 / npm 11.19.0, Supabase CLI 2.101.0, Docker 29.7.2 y Compose 5.3.1. Ejecuciones integradas serializadas en LAB TEST, sin usar DEV ni servicios ajenos.

| Comprobación ejecutada                                           | Resultado                                                                                                                                                                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                       | 2.554 pruebas aprobadas: API 945, web 141, contratos/fixtures 232, runner 211, IA 378, preproducción 647.                                                                                                      |
| Contratos tras ampliar enum de errores                           | 6/6 focales; cuatro casos adicionales, total vigente 2.558 pruebas.                                                                                                                                            |
| `npm run typecheck`, `npm run lint`, `npm run format:check`      | Aprobados.                                                                                                                                                                                                     |
| `npm run test:audit-export:integration`                          | 24/24 HTTP: 15 nuevos y 9 del visor .05; 1.513 aserciones SQL en 22 archivos, 94 nuevas.                                                                                                                       |
| Recuperación/observabilidad dentro de integración                | Reinicio API conserva recurso y bytes; seis registros operativos correlacionados y minimizados.                                                                                                                |
| `npm run test:audit-export:upgrade`                              | .05→.06 aprobado; hashes de historia iguales, 26 eventos operativos y evidencia pedagógica preservada, incluidos 8 intentos, 4 ayudas y una revisión. Readiness 503 antes / 200 después, CSV real recuperable. |
| `node scripts/audit-export-spreadsheet-probe.mjs` tras build API | Excel 16.0 build 20527: fidelidad Power Query 15×8, 11 cadenas literales sin fórmulas en importador General, bytes intactos.                                                                                   |

Informes privados `.local/reports/imp-06/audit-export-{integration,upgrade}.json`; logs generales `.local/evidence/imp-06/audit-export-{unit-run,typecheck,format}.log`. Excel conserva cada intento en `.local/evidence/imp-06/audit-export-spreadsheet/`; resultado combinado aprobado en `run-2026-11-03T01-07-23-344Z-KDQHH9/result.json`.

### Navegador y rendimiento

`npm run test:e2e -- --audit-export`: **8/8 PASS**, cero fallos, pendientes u omisiones. `npm run test:e2e -- --audit`: **8/8 PASS** de regresión. Chrome 156.0.8078.80 / Cypress 16.0.0 con builds de producción web/API. Capturas verificadas a 1440×900, 768×1024 y 390×844, revisadas visualmente; controles legibles y sin desbordamiento horizontal de página.

| Perfil local, 10.000 A / 1.000 B, concurrencia 1   | Primera muestra | 50 muestras, p95 nearest-rank | Errores |
| -------------------------------------------------- | --------------- | ----------------------------- | ------- |
| API generación confirmada                          | 633,62 ms       | 332,99 ms                     | 0       |
| API descarga de todos los bytes                    | 78,90 ms        | 102,47 ms                     | 0       |
| Navegación → generación → CSV íntegro en navegador | 1.510,5 ms      | 1.765,8 ms                    | 0       |
| Regresión del visor .05                            | 211,2 ms        | 381,7 ms                      | 0       |

`npm run test:audit-export:performance` aprobó ambas superficies. Reinició la API antes de cada primera muestra; conservó primeros valores, todas las muestras y errores. Fuentes congeladas durante la medición; huella `f613cd697ec995965c49d9d1d7779cce4634837e35131fb406eb07dddd01b75f`. Después solo se consolidaron resultados documentales. El reloj UI termina tras verificar el buffer completo y despachar la descarga; el archivo real se valida después, fuera del reloj, sin atribuirle medición de escritura física a disco.

Informes: `audit-export-api-performance.json`, `audit-export-ui-performance.json`, `audit-ui-performance.json`, `e2e-audit-export.json`, `e2e-audit.json` y `audit-export-ui-screenshots.json` bajo `.local/reports/imp-06/`. Los primeros perfiles no equivalen a arranque frío de toda la infraestructura ni a rendimiento remoto.

## Incidencias resueltas y límites de las pruebas

- Integración 1: sintaxis CASE en la nueva migración detuvo la aplicación antes de HTTP. Se corrigió sin retirar aserciones; log y reporte `audit-export-integration-run1*` preservados.
- Revisión independiente: una revocación mientras reserve esperaba un bloqueo podía permitir metadata READY. Se reautoriza después de bloqueos en reserve/capture/finish; el caso HTTP observa la espera real, revoca y exige 404 sin datos ni mutación. Aprobó.
- Integración 2: 20/24 HTTP aprobados. Dos rechazos devolvían 500 porque faltaban los códigos nuevos en el enum del envelope; se ampliaron contrato y pruebas. Dos fixtures intentaban SET ROLE desde un usuario sin ese privilegio; ahora conectan como `alunza_app` real y verifican ausencia de SUPER/BYPASSRLS. Logs/reporte `run2*` preservados. La repetición final aprobó todos los casos.
- Una lectura RUNNING devuelve 409 incluso con lease vencido hasta que reserve, fail o mantenimiento confirmen el estado terminal. Así no se presenta un error terminal inferido como transición ya persistida.
- Excel: Windows PowerShell 5 no permitió ejecutar el archivo; se usó PowerShell 7 del entorno sin cambiar políticas. La apertura automática local y OpenText no conservaron el campo multilínea. El probe separa fidelidad mediante [Csv.Document](https://learn.microsoft.com/en-us/powerquery-m/csv-document), que conserva 15×8, de neutralización bajo General: 11 valores exactos, cero fórmulas, pero 16 filas por su limitación multilínea. Se preservan los fallos y se indica en UI importar mediante Datos → Desde texto/CSV, UTF-8/coma. Power Query por sí solo no demuestra neutralización de fórmulas automáticas.
- FINISHED se verifica por HTTP real; ABORTED/UNKNOWN y carreras de callbacks combinan SQL real con unidades del controlador. No se presenta esa combinación como un ensayo de interrupción TCP real. Las fallas de navegador comprueban que no se cree Blob a partir de una respuesta incompleta o tardía.
- Cypress inicial: 5/8 PASS, fallos en 02/03/07. El oráculo de fórmula esperaba un apóstrofo, contrario al prefijo autorizado `texto: `; dos interceptores reutilizaban alias y recogían una exportación posterior. Se corrigieron expectativas y correlación (organización/viewport, una captura), conservando y reforzando aserciones. La repetición aprobó 8/8. Log, informe, capturas y perfil inicial de 50 muestras (p95 1.900,4 ms, primera 2.445,4 ms) permanecen en `.local/evidence/imp-06/audit-export-e2e-run1/`.

## Cierre local

Lint y formato generales aprobaron nuevamente después de integrar los cambios. La revisión del índice comprueba rutas, valores privados conocidos y hashes de las dos exclusiones; `.local/evidence/imp-06/audit-export-review/` conserva el manifiesto. LAB TEST quedó detenido, con DEV, foundation y servicios de otros proyectos activos. El commit local de .06 sucede a `8161b3b`; no hay push ni despliegue.

## Límites

La verificación es LAB TEST local; no demuestra Azure/Sandbox productivo, rendimiento remoto, WCAG completa, CI integral ni aceptación académica. .07 queda fuera. La disponibilidad de 24 h se aplica al acceso; eliminación física eventual. FINISHED no demuestra que el usuario abrió el archivo.
