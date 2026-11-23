# Diagnóstico de arranque después del reinicio — 20/11/2026

El usuario solicita conocer la causa y ejecutar personalmente la recuperación.
Se inspeccionaron procesos, puertos, archivos de sesión y Docker; no se
arrancaron ni detuvieron servicios y no se consumió IA.

## Hallazgos comprobados

- Windows arrancó a las 22:12 UTC (19:12 de Santiago).
- TEST falló a las 21:57:29 UTC en `START_TEST`, dentro de `up(testContext)`.
  La sesión `d57ff3fd-b914-4098-8ed4-e3df2069e360` no llegó a comprobar la
  base ni iniciar API/web. Su cierre registró `PENDING_AUDIT_FAILED` y
  `TEST_LEFT_RUNNING_FOR_RECONCILIATION`, conservando el lock. Los reintentos
  posteriores fallaron con `EEXIST`. El error interno de Supabase no quedó
  registrado; no se atribuye el primer fallo a red, memoria o Docker.
- Actualmente no hay contenedores ni puertos TEST activos. Sus dos volúmenes
  de base y Storage siguen presentes. El mensaje histórico de conciliación
  no acredita que hoy existan procesos activos.
- Azure07 falló en `START_API` a las 22:24:26 UTC: no obtuvo HTTP 200 de
  `/health/ready` en 30 segundos. Nunca llegó a `START_WEB`. El controlador
  cerró sus procesos sin errores y retiró su lock. Los ocho contenedores
  LAB-EVAL están disponibles. No se guardaron status/body de los sondeos
  fallidos y no es posible atribuir una causa interna más concreta.
- La validación de `DatabaseService.ready()` del build07 exacto pasó ahora
  en 108 ms, con el usuario limitado real y conexión de solo lectura.
  No demuestra qué ocurrió durante el sondeo fallido anterior. Tampoco hay
  evidencia de un fallo por mayúsculas en `Desktop`: los controles de rutas
  pasaron antes de intentar iniciar la API.
- La consulta de solo lectura a LAB-EVAL confirmó 310 llamadas completas,
  US$0,004342 contabilizados, cero llamadas inciertas/en despacho y reserva
  de presentación Azure en 0/1. El grant continúa RUNNING hasta
  21/11/2026 02:59 UTC, equivalente al 20/11 a las 23:59 de Santiago.

## Procedimiento preparado, aún no aplicado

El helper anterior `Recover-DemoAfterReboot.ps1` corresponde a sesiones que
alcanzaron READY. No sirve para esta sesión TEST fallida, que carece de
`ready.json` y tiene un cierre con errores. No se relajó ese helper.

Se preparó por separado
`.local/demo-azure-20261119/operation/Recover-FailedTestStartup.ps1`.
Sin argumentos, o con `-CheckOnly`, verifica la sesión conocida. Con `-Apply`
archiva únicamente su lock y copia los registros originales a una carpeta
nueva; conserva hashes y recibos. Exige identidad exacta de sesión, PID
ausente, fallo/cierre conocidos, reinicio posterior, ausencia de procesos,
puertos y contenedores TEST, y rutas internas sin enlaces. No borra datos,
no cambia grants y no inicia ni detiene servicios.

CheckOnly pasó en PowerShell 5 y 7. Recibo privado:
`.local/demo-azure-20261119/operation/failed-test-startup-check-1795214422122.json`.
**No se ejecutó Apply ni se acredita un nuevo arranque exitoso.**

El operador debe aplicar esa recuperación, iniciar TEST con su lanzador y
esperar `DEMO_READY`; después iniciar Azure07 con su wrapper existente y
esperar `AZURE_LOCAL_READY`. No hace falta `down(testContext)` en el estado
observado, porque no existen contenedores TEST. Si cualquier arranque falla,
se conserva el mensaje y se detiene la secuencia; no se repite en bucle ni
se cambian límites. La auditoría de ambos entornos corresponde sólo después
de que ambos estén listos. La [guía de la demo](../guides/demo-profesor-azure.md)
conserva sus comandos de arranque y cierre.
