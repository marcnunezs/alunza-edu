# Evidencia saneada de IMP-02

Corte local del 28/09/2026, 23:00 UTC / 20:00 America/Santiago. [El registro de entrega](../../IMP-02-implementation.md) explica alcance y límites; [la matriz](../../IMP-02-trazabilidad.md) mapea los 36 escenarios de origen.

Los informes son copias de los generados por las herramientas sobre el candidato final. No incluyen tokens, credenciales, conexiones de base de datos ni códigos de incorporación vigentes.

| Informe                                          | Evidencia                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| [ci.json](ci.json)                               | Once etapas aprobadas; 249 pruebas Jest y huella SHA-256 de 230 archivos |
| [acceptance.json](acceptance.json)               | 80/80 pruebas HTTP y 139 comprobaciones SQL                              |
| [integration.json](integration.json)             | Auth/PostgreSQL locales reales y cierre de infraestructura temporal      |
| [migration-upgrade.json](migration-upgrade.json) | Actualización incremental y preservación de identificadores y fechas     |
| [demo-seed.json](demo-seed.json)                 | Dos ejecuciones, filas existentes conservadas y cantidades canónicas     |
| [e2e.json](e2e.json)                             | 25/25 recorridos, sin omitidos, Chrome 153 y Cypress 16                  |

Las capturas muestran datos ficticios y complementan las aserciones; no sustituyen la comprobación de API, RLS o accesibilidad.

- [Cursos guardados](imp02-admin-cursos.png).
- [Taxonomía con versiones y referencias](imp02-admin-conceptos.png).
- [Editor, borrador y pruebas visibles](imp02-estudiante-editor.png).

Los registros se reproducen con `npm run ci:verify` desde la raíz Git. Sus originales privados permanecen en `.local/reports/`; las capturas explícitas se generan en `cypress/screenshots/learning.cy.ts/`. GitHub Actions y proveedores remotos no fueron ejecutados. Las pruebas de IA son un ensayo con vectores sintéticos; no completan ayuda contextual del producto.
