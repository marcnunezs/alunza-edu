# IMP-06.07 — Matriz de aceptación funcional

Resultado del 03/11/2026: **16 escenarios aprobados funcionalmente en LAB TEST**, con seis casos HTTP y seis Cypress sobre el candidato `653646f5f28f58a5a0d54735e77723d96445b3e527024fa3d94f1344b94b5aad`. El [registro](IMP-06-governance-phase.md) conserva las corridas, fallos y resultados reales; `governance-phase-acceptance.json` identifica el resultado individual de cada fila como `passed`. Fuente ejecutable: `scripts/governance-phase.cjs`; los IDs originales provienen de [specs/03](../../specs/03-flujos-y-criterios-de-aceptacion.md). La aceptación integral permanece bloqueada por .04 y CI; código 2.

Cada fila combina el caso HTTP y Cypress de igual identificador. Un caso agrupa las ramas indicadas; el agregador rechaza casos ausentes, duplicados, fallidos, pendientes u omitidos y huellas de fuentes distintas.

| Escenario     | Caso IMP06-PHASE | Oráculo y ramas                                                                                                      |
| ------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| ALZ-HU-017-E1 | 01               | Persona/clase, intento Docker, ayuda entregada y señal corresponden a los mismos IDs; historia intacta.              |
| ALZ-HU-017-E2 | 03               | Filtro inválido y filtro válido sin evidencia se distinguen.                                                         |
| ALZ-HU-017-E3 | 04               | ADMIN sin función docente y demás roles no autorizados no obtienen evidencia pedagógica.                             |
| ALZ-HU-017-E4 | 04               | Otra clase de A y organización B no revelan identidad ni evidencia.                                                  |
| ALZ-HU-019-E1 | 01               | Cancelar no muta; confirmar persiste REVIEWED y conserva causa/regla/evidencia.                                      |
| ALZ-HU-019-E2 | 05               | ID inválido y revisión concurrente: rechazo controlado o primera revisión recuperada.                                |
| ALZ-HU-019-E3 | 04               | Revocación antes de confirmar impide escritura y exposición.                                                         |
| ALZ-HU-019-E4 | 05               | Repetición/concurrencia conserva primera identidad/fecha y una revisión de dominio.                                  |
| ALZ-HU-024-E1 | 02               | Gobierno permitido recuperable y auditado; archivo conserva referencias históricas.                                  |
| ALZ-HU-024-E2 | 03               | Política y pruebas inconsistentes se rechazan sin cambiar referencias.                                               |
| ALZ-HU-024-E3 | 04               | Gobierno ajeno/ampliación fuera del ámbito no expone ni muta.                                                        |
| ALZ-HU-024-E4 | 02               | Nueva versión; publicación e intentos siguen ligados a contenido/pruebas/conceptos anteriores.                       |
| ALZ-HU-027-E1 | 02               | Visor y CSV del mismo filtro/corte/ámbito, eventos públicos reales y proyección independiente.                       |
| ALZ-HU-027-E2 | 03               | Fechas inválidas y exceso de límite rechazan; nunca CSV parcial. La capacidad se distingue del recorrido real.       |
| ALZ-HU-027-E3 | 04               | Roles y organización ajenos no leen auditoría ni exportan. Caso 06 complementa revocación y propietario del archivo. |
| ALZ-HU-027-E4 | 03               | CSV vacío íntegro con encabezados, alcance y sello temporal en metadatos.                                            |

## Comprobaciones complementarias

- Caso 06: respuesta perdida después del commit, misma clave/recurso/bytes/hash, mutación posterior legítima sin regenerar el archivo, otro ADMIN y solicitante revocado sin descarga.
- Snapshots de historia identificada separados de nuevas revisiones/versiones/eventos. No exigir que toda auditoría quede idéntica tras acciones auditadas.
- Cortes estables y escrituras detenidas al comparar visor/CSV; las confirmaciones tardías permitidas no se convierten en discrepancias artificiales.
- Teclado y tres dimensiones verificadas; revisión visual conservada aparte de la automatización.
- Los focos .05/.06 conservan cursores, microsegundos, fórmulas, límites exactos de bytes, leases, expiración, HEAD y resultados de entrega. Su presencia no equivale a una repetición en este candidato; el registro identificará las regresiones efectivamente ejecutadas.
