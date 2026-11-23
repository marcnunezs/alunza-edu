# Sincronización del repositorio principal

Fecha: 22/11/2026, America/Santiago. Estado: **fuentes trasladadas y verificadas;
entorno operativo del principal pendiente de adaptación**.

Se incorporó al repositorio principal el progreso del laboratorio, incluidos sus
cambios locales todavía no confirmados. La carpeta `Evidencias CAPSTONE` del
principal no se modificó. Este trabajo actualiza archivos de proyecto; no
despliega servicios, migra datos ni acredita aceptación del producto.

## Origen y destino

| Elemento                    | Identificación                                                                   |
| --------------------------- | -------------------------------------------------------------------------------- |
| Origen                      | `C:/Users/Lenovo/Desktop/alunza-edu/alunza-edu-laboratorio`                      |
| HEAD del origen             | `b12fb6fb13b8de5e4f664270fe1a5108739c0aa9`, más el árbol de trabajo inventariado |
| Destino                     | `C:/Users/Lenovo/Desktop/alunza-edu/alunza-edu`                                  |
| HEAD del destino conservado | `318efed67bb293f53a43c0a5a4d015eb3e0812d0`                                       |
| Rama del destino conservada | `main`                                                                           |
| Respaldo                    | `C:/Users/Lenovo/Desktop/alunza-edu/_repo_sync_backups/2026-11-22-1795368761525` |

El principal estaba limpio en Git, pero también contenía documentación histórica
ignorada que se inventarió por separado. Sus archivos activos correspondían a una
variante anterior, con módulos, rutas web y migraciones diferentes. Por eso se
trasladó el conjunto coherente del laboratorio y se retiraron los archivos
activos sustituidos, conservando un respaldo comprobado antes de hacerlo.

No se importó ni reescribió historia Git. No se crearon commits, no se preparó el
índice y no se ejecutó `push`. Los cambios quedan en el árbol de trabajo del
principal para su revisión y posterior confirmación.

## Archivos y preservación

El inventario del laboratorio contiene **1034 archivos de fuentes**. De ellos,
118 ya coincidían, 733 se añadieron y 183 sustituyeron versiones anteriores.
Se retiraron 48 archivos activos obsoletos después de comprobar sus respaldos,
incluidas las rutas antiguas bajo `apps/web/src/app/academia/[orgId]` y las dos
migraciones alternativas de contenido y práctica del principal.

Se conservaron sin cambios 50 archivos históricos propios del principal en
`docs` y `supabase/entrega`. El índice `docs/work/ESTADO-ACTUAL.md` y la exportación
SQL de `supabase/entrega` describen su corte anterior; no sustituyen al
[índice vigente](../estado-actual.md), las migraciones actuales ni sus registros
de evidencia. La exportación histórica no se aplicó a ninguna base.

Después de la copia se adaptó únicamente la introducción de `README.md` para
identificar este repositorio como principal y advertir que su arranque todavía
requiere configuración independiente. Este registro se añade como evidencia
del traslado. El código y los contratos transportados conservan su contenido
original del laboratorio.

Controles de preservación:

- Los 60 archivos y 13 directorios de `Evidencias CAPSTONE` conservaron inventario,
  nombres, mayúsculas y fechas. Los 60 SHA-256 y tamaños coinciden con el corte
  anterior. Una segunda comprobación independiente confirmó el resultado.
- Los 399 archivos de fuentes preexistentes inventariados quedaron respaldados
  con SHA-256 verificado en `principal-before`.
- Los 48 archivos retirados están presentes íntegramente en ese respaldo y
  ausentes de las rutas activas del principal.
- Los cuatro archivos privados existentes comprobados conservaron sus hashes.
  No se trasladaron secretos, `.local`, `.tools`, `node_modules`, compilaciones,
  cachés, bases, volúmenes ni adjuntos de sesión.
- El laboratorio no se modificó. `manifest.json` en el respaldo conserva el
  inventario y las acciones; `LEEME.txt` describe una restauración revisable.

## Comprobaciones ejecutadas

Se utilizó el runtime portable ya existente del principal: Node 24.21.0 y npm
11.19.0. No se instalaron ni actualizaron dependencias.

| Comprobación                                        | Resultado y límite                                                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Igualdad inicial de fuentes por SHA-256             | 1034/1034 archivos idénticos al laboratorio antes de la adaptación documental del README                              |
| Preservación de CAPSTONE y respaldo                 | Aprobada; sin diferencias de contenido o inventario                                                                   |
| `git diff --check`                                  | Aprobado                                                                                                              |
| `npm run lint`                                      | Aprobado                                                                                                              |
| `npm run quality:coverage`                          | `auditStatus=consistent`, salida 0; aceptación no evaluada y candidato distinto del baseline histórico                |
| `npm run build -w @alunza/contracts`                | Aprobado                                                                                                              |
| Contratos de práctica, ayuda, detalle docente y CSV | Cuatro suites y 25 pruebas aprobadas, sin servicios externos                                                          |
| `npm run format:check`                              | Salida 1 por nueve archivos con formato heredado; no se reformatearon fuentes ni evidencias históricas para ocultarlo |

Las suites de contratos fueron `tests/practice-contracts.test.cjs`,
`tests/help-contracts.test.cjs`, `tests/student-detail-contracts.test.cjs` y
`tests/audit-export-contracts.test.cjs`, ejecutadas con Jest en serie y sin caché.
La compilación de contratos solo generó salidas locales ignoradas.

Las nueve advertencias de formato corresponden a `infra/runner/README.md`,
copiado sin cambios del laboratorio, y a ocho archivos históricos conservados:
`docs/work/ESTADO-ACTUAL.md`, `docs/work/IMP-03-implementation.md`,
`docs/work/IMP-03-trazabilidad.md`, `docs/work/REVISION-DOCUMENTAL-2026-10-23.md`,
`docs/work/evidence/imp-03/performance-analysis.md`,
`docs/work/evidence/imp-03/README.md`,
`docs/work/evidence/imp-03/runner-docker.json` y
`docs/work/evidence/imp-03/verification-summary.json`.

El control de cobertura informa evidencia privada no disponible en este
checkout. No se copiaron los recibos privados del laboratorio ni se atribuyeron
sus resultados a una nueva ejecución del principal. No se ejecutaron CI
integral, E2E, integración con bases, campañas, pruebas de proveedores ni
mediciones de rendimiento.

## Condiciones antes de ejecutar el principal

`scripts/local-target.mjs`, `supabase/config.toml` e `infra/compose.yaml`
conservan los identificadores, redes y puertos del laboratorio. Una copia del
código no crea un segundo entorno aislado. Por ello no se arrancaron, detuvieron,
limpiaron o migraron servicios desde el principal.

Antes de operarlo, definir un namespace independiente de desarrollo, TEST y
evaluación, comprobar sus puertos, adaptar conjuntamente las validaciones y
configuraciones y decidir cómo inicializar o migrar el estado privado existente.
No copiar el estado ni reutilizar las credenciales del laboratorio como atajo.
Las rutas absolutas que aparecen en los registros históricos conservan su
procedencia; sus lanzadores privados no se incluyen en este traslado.

La instalación de dependencias del principal es anterior al nuevo lockfile:
faltan `@types/multer@2.2.0`, `js-tiktoken@1.0.21` y `pdfjs-dist@6.3.289`, y el
`acorn` instalado es 8.18.0 frente a 8.19.0 requerido. Antes del build completo,
sincronizar dependencias con el lockfile y regenerar los tipos contextuales de
Next.js. El traslado no acredita todavía un arranque ni una compilación integral
del producto en esta ruta.
