# IMP-03: inventario reproducible y cachés Python

Fecha: 18/11/2026. Alcance: corregir la inclusión de bytecode Python en el
inventario y verificar la suite general de preproducción. Soporte operativo a
RNF-MAN-03/04 y a los candidatos de IMP-03; no modifica RF, contratos, límites
de ejecución, plazos de pruebas ni servicios.

Estado: **corregido y verificado; 52/52 suites y 1019/1019 pruebas de
preproducción aprobadas**, sin casos omitidos. No equivale a CI integral del
producto, aceptación remota ni aceptación humana.

La prueba de inventario reproduce el fallo por tres `.pyc` no versionados:
`broker.cpython-312.pyc`, `protocol.cpython-312.pyc` y
`test_broker.cpython-312.pyc`. El empaquetador ya rechaza esa extensión; faltaba
declarar la caché como generada en Git. Se conservan los archivos y su evidencia.

## Cambio y aceptación

- `.gitignore` excluye `__pycache__/`, `*.pyc` y `*.pyo`. No se ignoran fuentes
  `.py` ni extensiones nativas `.pyd` por una regla demasiado amplia.
- El empaquetador rechaza también rutas dentro de `__pycache__` al capturar y
  restaurar, incluso si tienen extensión de fuente permitida.
- Se mantiene la aserción que admite solo las dos exclusiones generadas ya
  declaradas del árbol fuente; no se agregan omisiones arbitrarias al esperado.
- La regresión usa un Git temporal con el `.gitignore` real: variar la caché
  conserva archivos y huellas de captura/cobertura; variar un `.py` cambia ambas
  huellas. Un `.pyd` desconocido sigue visible para la auditoría.

## Verificación

Node 24.21.0 fijado del repositorio, Windows/Lenovo. Recibos nuevos en
`.local/preproduction/imp-03-07/inventory-20261118`:

| Comprobación                        | Resultado                                                     | Recibo                                                |
| ----------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| Inventario antes de corregir        | Fallo reproducido por los tres `.pyc`; esperado sin modificar | `before-fix.json`                                     |
| Focos de candidato y cobertura      | 2/2 suites, 74/74 pruebas; 11,112 s                           | `focal-after.json`                                    |
| Suite general de preproducción      | 52/52 suites, 1019/1019 pruebas; 25,726 s                     | `general-01.json`                                     |
| Preservación de archivos existentes | Mismos tamaños y SHA-256 de tres cachés y dos respaldos       | `preservation-before.json`, `preservation-after.json` |

También aprobaron ESLint y Prettier de los archivos afectados y la comprobación
de whitespace. La revisión independiente del cambio no detectó bloqueos; fue
una revisión de desarrollo por agente, no aceptación humana de CAPSTONE.

La corrida general utilizó los mismos límites de Jest y ninguna opción para
aumentar timeout, omitir pruebas o reintentar automáticamente:

```powershell
.tools/node-v24.21.0-win-x64/node.exe --experimental-vm-modules node_modules/jest/bin/jest.js --config tests/preproduction/jest.config.cjs --runInBand --json --outputFile .local/preproduction/imp-03-07/inventory-20261118/general-01.json
```

Los tres casos de preparación de campaña que habían agotado tiempo en el
incremento anterior aprobaron dentro de esta corrida completa. No fue necesario
modificar ese código ni sus plazos. Los resultados fallidos anteriores se
conservan como evidencia histórica, incluida la
[comprobación del apagado físico](IMP-03-apagado-servicios-fisico.md).

## Identidad y límites

| Archivo verificado                              | SHA-256                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `.gitignore`                                    | `55bcea1d85397f5eb890670cbff91e91b71de7864fa321a45ed0ed3147058eb7` |
| `scripts/runner-candidate.mjs`                  | `df3d1e4e174d839225566efc7fb95fdbee4fb18977f74684b658359e86a1b806` |
| `tests/preproduction/runner-candidate.test.mjs` | `be5cc592032983b5159d7be27547f1c9dc0574fa83e27ebdcacd24f7610f547a` |

Los archivos `.pyc` se conservan en sus rutas originales. Los respaldos
`physical-browser-13-20261117/evidence-final.tar.gz` y
`service-shutdown-20261118/evidence-final.tar.gz` conservan sus bytes. No se
modificaron artefactos congelados del ejecutor ni bases de datos, no se arrancó
el laboratorio Ryzen y no hubo despliegue ni contratación.

La política solo excluye caché generada; un archivo desconocido fuera de ella
continúa visible a Git y a la auditoría. Si alguien fuerza bytecode al índice
Git, la aserción de inventario sigue detectando esa omisión inesperada.
