# Consolidación documental posterior a IMP-05.08

Fecha: 26/10/2026, America/Santiago. Autor: Codex, por solicitud expresa del
usuario. Alcance exclusivamente documental; no inicia IMP-06 ni cambia
requisitos, arquitectura aprobada, fórmulas, permisos o proveedores.

## Resultado

Se incorporó [estado actual](../estado-actual.md) como punto de entrada a las
capacidades verificadas, los límites y el trabajo pendiente. README, AGENTS,
planificación y guías de recuperación enlazan ese índice. Cada familia de
documentos conserva un propósito: requisitos/contratos, estructura, trabajo
pendiente, procedimiento o evidencia por candidato.

La [arquitectura](../../specs/05-arquitectura.md) describe el árbol y composición
reales: AppModule, áreas API, SQL autorizado, workers, paquetes contracts/ai/runner
y flujos de hechos/evaluación/consulta. Distingue destinos aprobados de
entornos comprobados; no introduce un paquete domain ni una API paralela.

Los specs de datos, API y señales consolidan las concreciones .05–.08:
episodios/evaluaciones, soporte interno de revisión, lecturas autorizadas,
período/corte, matrícula vigente, frescura y evidencia mínima. Las rutas
propuestas de detalle, revisión pública y auditoría/exportación permanecen
separadas de las implementadas. Los diccionarios y DTO se enlazan sin
regenerar contratos ni OpenAPI.

El [plan IMP-06](../plan/06-gobierno-y-seguimiento.md) identifica piezas
reutilizables y entregas faltantes. `signal_review_fixture` permanece como
soporte TEST sin grant a `alunza_app`; disponer de persistencia de revisión
no implementa el endpoint docente, sus permisos, auditoría ni diálogo.

Se corrigieron referencias obsoletas sobre ausencia de aplicación, fases aún
futuras y decisiones ya resueltas: DEC-001, fechas civiles de clase, archivo,
SUBMIT/cierre, unidades de ejecución, niveles de ayuda y DEC-005. Las
concreciones existentes se distinguen de los pendientes pedagógicos/remotos.
Los 27 RF, sus 108 escenarios y la semántica aprobada permanecen vigentes.

## Conservación y límites

- Los archivos previos de `docs/work`, los artefactos aprobados de decisiones
  y los documentos Office conservan sus bytes. Los cortes históricos de specs
  y planes se identifican por fecha y no reciben resultados posteriores.
- La CI local .08 de `2026-10-27T00:12:20.364Z` conserva su candidato y
  evidencia. Las CI remotas históricas del 02/10 corresponden a sus commits;
  no acreditan CI Linux/remota para el candidato .08.
- Las causas no demostradas de SQL015, pico SUBMIT y timeouts de arranque
  permanecen visibles. No se atribuye una corrección a esta edición documental.
- Se mantienen los límites TEST, E20/E23, carga UI de un Chrome y tres
  lectores HTTP y ayuda renderizada pendiente. CAPSTONE, remoto y RF-017/019
  públicos integrales conservan sus pendientes.
- No se ejecutaron migraciones, suites de producto, servicios, despliegues o
  llamadas a proveedores de producto. No se creó un commit ni se modificó el
  código para ajustarlo a los textos.

## Verificación documental

La captura inicial inventarió 694 archivos no ignorados y sus SHA-256,
incluidos cambios previos del usuario. El control compara esa base con el
cierre, restringe diferencias a Markdown autorizado y verifica por separado
las 54 filas de requisitos/trazabilidad y los 108 escenarios originales.
Los informes locales están en `.local/evidence/documentation-consolidation/`;
son auxiliares ignorados, no sustituyen este registro versionable.

El cierre comprueba destinos locales de enlaces, bloques de código,
`git diff --check`, formato aplicable y huella de fuentes. El formato de specs,
planes y guías conserva las exclusiones del repositorio para evitar un cambio
masivo de tablas. Las URLs externas no se presentan como revalidadas por el
control de destinos locales. No se repite CI de producto por cambios solo
documentales.

Controles ejecutados y aprobados:

- Comparación SHA-256 del inventario inicial: 28 Markdown modificados o nuevos;
  código, migraciones, dependencias, documentos Office y registros previos
  sin cambios respecto del inicio de esta tarea.
- 54 filas de requisitos/trazabilidad y 108 escenarios originales idénticos.
- Destinos locales de enlaces existentes y bloques de código equilibrados;
  inventario detallado en `checks.json` del directorio de evidencia indicado.
- `git diff --check` sin errores y `npm run format:check` aprobado.
- Huella de las 549 fuentes idéntica al candidato .08:
  `daa670b3fca99f41f6a1ff557ca3a2c1fe727aade26012490f01012e23a29029`.

El siguiente trabajo de producto permanece pendiente de su encargo específico;
esta consolidación termina en documentación y verificación documental.
