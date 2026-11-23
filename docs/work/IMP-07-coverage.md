# IMP-07.01 — Cobertura y brechas verificables

Fecha de trabajo: 03/11/2026, America/Santiago. Estado: **auditoría completada y
control offline implementado/verificado; aceptación del producto pendiente**.

## Alcance autorizado

El usuario aprobó consolidar calidad mediante matriz y controles automáticos.
Las pruebas faltantes y defectos se especifican para sus incrementos; no se
modifica comportamiento de producto. IMP-06.04 se documenta como bloqueo, sin
lectores ETL, capturas, carga, campañas, CI integral ni proveedores remotos.
No hay publicación, migración, despliegue ni aceptación humana atribuida.

La [matriz estructurada](IMP-07-coverage-matrix.json) es la única lista completa:
108 escenarios, 29 RNF, seis ORG, 14 SEC y seis verticales E2E, 163 entradas.
Los 27 RF se resumen a partir de sus cuatro escenarios; HU/CU/PT no aumentan
el número de pruebas ni constituyen un porcentaje de producto terminado.

## Candidato y procedencia

La base auditada es `b12fb6fb13b8de5e4f664270fe1a5108739c0aa9`, rama
`codex/imp-06-07-integration`, con 694 fuentes y SHA-256
`653646f5f28f58a5a0d54735e77723d96445b3e527024fa3d94f1344b94b5aad`.
Coincide con los informes HTTP/Cypress/aceptación funcional IMP-06.07.
Se capturó antes de editar; inventario, estado inicial y hashes de archivos
preservados quedan privados en `.local/evidence/imp-07-01/baseline.json`.

Se conserva el algoritmo de inventario de `signals-candidate`: fuentes
autorizadas, archivos nuevos y eliminaciones; excluye los dos generados
`next-env.d.ts` y OpenAPI. El lector nuevo calcula sin guardar diffs ni
snapshots. Añadir el control, sus pruebas y el comando cambia la huella global;
el candidato de entrega no hereda una ejecución anterior. El comando muestra
ambas identidades y `baselineMatchesCurrent`, sin cambiar el registro original.

Cada evidencia declara fuente, selector, hash, fecha, ambiente, proveedor,
resultado y candidato conocido. `historical` conserva una ejecución anterior;
`baseline` exige informe estructurado con huella coincidente; `unverified`
identifica una referencia cuyo candidato no puede acreditarse. Un registro
Markdown conserva lo documentado, sin sustituir el informe crudo ausente.
La indisponibilidad de un artefacto privado aparece como advertencia y estado
`unavailable`; no se convierte en evidencia favorable ni impide auditar un clon.

## Interpretación y mantenimiento

### Candidato crun y API local del 15/11/2026

Se incorporan tres evidencias adicionales con candidato identificado, sin
reescribir el baseline del 03/11: controles del predecesor, comprobaciones
funcionales focales y limpieza del candidato final, y perfil HTTP con resultado
`failed`. La [entrega local](IMP-03-crun-api-local.md) completó 200 mediciones:
199 resultados correctos y un `UNKNOWN/CANCELLED` de infraestructura. Los p95
RUN/SUBMIT secuenciales fueron 7,908/8,645 s; con concurrencia cuatro,
27,886/30,080 s. Se conservaron todas las muestras y la interrupción instrumental
entre perfiles; solo se continuaron los dos perfiles no iniciados.

La huella final `ec4088c1db07671bcafefeaf298025c23291e2713bd374a2eb90708da9c5b241`
fue idéntica antes/después; los controles anteriores identifican el predecesor
`10e290565f9f55eb1b3fb64b5e63cdcd5a93ea79e616025791b7e921e87118bb`.
Se usa `historical` para vincular esos candidatos distintos del baseline;
no se atribuyen sus resultados al corte del 03/11. La brecha local de RNF-REN-02
ya tiene medición y conserva un bloqueo de conformidad. La comprobación de
memoria agregada, recuperación y limpieza local no cierra aceptación remota de
IMP-03.07, revisión humana ni los bloqueos de IMP-04. Los conteos de la auditoría
original siguientes siguen describiendo ese corte histórico.

`implementation` describe código revisado. `coverage` describe las ramas
cubiertas por las comprobaciones identificadas y sus límites, sin acreditar
ejecución. `evidenceRefs` enlaza resultados observados de versiones concretas.
`gaps` identifica defecto, prueba faltante, evidencia histórica/ausente,
integración remota, decisión humana o bloqueo de aceptación.

Una fila completa local puede conservar revalidación o aceptación pendiente.
Las obligaciones remotas/humanas no se cierran con Docker, TEST o revisión del
agente. Los casos nuevos pendientes especifican actor, precondiciones, acción,
oráculo independiente y nivel de prueba. Los selectores acreditan que existe
una referencia; la revisión de aserciones establece qué demuestra.

Ejecutar `npm run quality:coverage` desde la raíz con el runtime fijado. Lee
archivos e inventarios; no arranca servicios, ejecuta los casos referenciados,
escribe artefactos ni consulta la red. Emite JSON saneado:

- Código 0: matriz íntegra y consistente, aunque conserve brechas.
- Código 1: estructura, referencia o afirmación inconsistente.
- `acceptanceStatus=not-assessed` y `humanAcceptance=not-recorded` siempre.

El catálogo se extrae de los specs funcionales, escenarios, calidad y seguridad,
no de los conteos de la matriz que se valida. Se comprueban IDs, relaciones,
rutas, selectores, inventario Cypress, evidencia identificada y casos faltantes.
No es otro agregador de aceptación. Los controles nuevos forman parte de la
suite de preproducción ya existente sin agregar etapas a CI.

## Resultado de la auditoría

| Grupo            | Obligaciones | Cobertura completa | Parcial | Sin comprobación localizada |
| ---------------- | -----------: | -----------------: | ------: | --------------------------: |
| Escenarios E1–E4 |          108 |                 90 |      17 |                           1 |
| RNF              |           29 |                  4 |      23 |                           2 |
| ORG              |            6 |                  0 |       3 |                           3 |
| SEC              |           14 |                  2 |      11 |                           1 |
| Verticales E2E   |            6 |                  0 |       6 |                           0 |
| Total            |          163 |                 96 |      60 |                           7 |

Son clasificaciones de cobertura estática sobre la base auditada, **no pruebas
aprobadas ni porcentaje de MVP aceptado**. Las 406 referencias de comprobación
se reutilizan entre obligaciones. Las 35 referencias de evidencia incluyen 11
referencias a informes del baseline, cinco históricas con candidato conocido y
19 registros cuyo candidato no puede acreditarse; no son 35 corridas distintas.
Los 16 escenarios HU017/019/024/027 conservan informes funcionales del baseline.

Las siete obligaciones sin comprobación localizada son HU007-E2, RNF-MAN-01/04,
ORG-002/003/004 y SEC-12. Esto no declara ausente toda su implementación: hay
casos sin test focal, revisión estructural/documental y obligaciones humanas.
La matriz conserva la dimensión de implementación por separado. El nuevo
control y la reconciliación documental pertenecen a la entrega de .01, sin
reescribir la cobertura del candidato inicial como si ya los incluyera.

Hay 224 asociaciones de brecha a obligaciones: 115 de evidencia histórica,
48 de comprobaciones faltantes, 29 de bloqueo de aceptación, 23 de integración
remota, ocho de decisión humana y una de evidencia ausente. Se repiten causas
compartidas: **no representan 224 defectos ni 224 tareas independientes**.
No se reprodujo un nuevo defecto de producto en este ciclo sin ejecuciones de
producto. Los huecos de aserciones son tareas de verificación, no fallos probados.

## Trabajo siguiente priorizado

| Prioridad  | Frente y obligaciones representativas                                                        | Resultado exigible e incremento                                                                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alta       | RUN/SUBMIT remoto; HU009-E1/E4, RNF-SEG-04, SEC-06                                           | Integrar Sandbox en API, recuperación y limpieza; demostrar paridad y límites reales. **IMP-03.07**, siguiente desarrollo previsto.                                                     |
| Alta       | Persistencia y aislamiento; HU010-E2, RNF-CON-01, SEC-02/14                                  | Observar cero despachos de IA tras fallo de commit; completar negativas por superficie y auditoría de concurrencia. **IMP-07.02/.03**.                                                  |
| Alta       | Ayuda real; HU006/012/013/025, RNF-REN-03, E2E-02                                            | Calibración Azure, workers operativos, evaluación de ayuda/citas y latencia visible en navegador. **IMP-04.08 y 07.05/.06**, con destinos y presupuestos efectivos.                     |
| Alta       | Cierre integrado .04/.07, RNF-REN-01/CON-04                                                  | Conservar bloqueo y siguiente paso del protocolo descritos abajo; posterior CI de candidato identificable. **IMP-06.04/.07**.                                                           |
| Alta       | Recuperación y entrega; SEC-12, RNF-POR-01/02                                                | Restaurar BD/Storage/citas/permisos y reproducir demo canónica en entorno limpio. **IMP-07.07 y 08.01/.02**.                                                                            |
| Alta/media | Accesibilidad, comprensión y revisión humana; RNF-USA, ORG                                   | Completar matriz de navegadores/teclado/lector/contraste, rúbrica y revisión por personas reales. **IMP-07.04/.05/.08**.                                                                |
| Media      | Negativas y auditoría específicas; HU001-E4, HU007-E2/E4, HU020-E1/E4, HU021-E2, HU025-E1/E4 | Ejecutar los casos concretos de la matriz: logs seguros, vacío/validación, conservación de materiales, rol inválido, top-k productivo y auditoría de denegación. **IMP-07.02/.03/.05**. |
| Media      | Evidencia histórica y estructura; RNF-MAN, escenarios restantes                              | Revalidar solo lo necesario sobre un candidato coherente; revisar dependencias y decisiones. **IMP-07.02/.03/.05/.08**, según cada fila.                                                |

Las condiciones de aceptación de los casos faltantes figuran en `gaps.case`.
No se introducen endpoints, permisos ni estados de producto para hacerlos
posibles. Por ejemplo, HU020-E4 usa una organización con clase y fuente activas
y comprueba conservación tras rechazar el archivo; no presupone una fuente
independiente de clase ni atribuye el rechazo exclusivamente a materiales.

## Bloqueo IMP-06.04

Revisión docente implementada y focos funcionales aprobados; cierre de
rendimiento e integral pendientes. El sensor Windows permanece sin calificar.
La procedencia y mapping del ETL secundario conservan
`HOLD_UNRESOLVED_SECONDARY_ETL`, con **9/17 campañas y 0/1 CI final**.
No se atribuye automáticamente la causa a producto, arnés o anfitrión, ni se
clasifica el bloqueo como un defecto crítico demostrado.

El siguiente paso del protocolo vigente es acreditar procedencia, papel y
mapping del catálogo secundario con evidencia independiente. Después aún
corresponderían las condiciones de cobertura, calificación del sensor y
verificación previstas en el [registro de cierre](IMP-06-signal-review-closure.md).
La auditoría presente no ejecuta ni sustituye ese protocolo.

El agregador .07 tiene estados/contadores fijos para su ciclo original. Repetirlo
no cerrará el futuro .04: un próximo trabajo de aceptación deberá incorporar
evidencia válida del cierre y CI sin reescribir este antecedente.

## Verificación y continuación

Node 24.21.0 y npm 11.19.0, sin dependencias nuevas. Resultados reales:

- `npm run --silent quality:coverage`: código 0, 163 entradas, cero errores y
  cero advertencias en este checkout. Informe privado saneado:
  `.local/reports/imp-07/coverage.json`.
- Jest focal mediante `tests/preproduction/jest.config.cjs`, con
  `quality-coverage.test.mjs`, `e2e-inventory.test.mjs` y
  `governance-phase-acceptance.test.mjs`: **40/40 pruebas, tres suites**, cero
  omisiones. JSON conservado en `.local/evidence/imp-07-01/tests-final.json`.
- ESLint y Prettier sobre script/pruebas/matriz/registro/manifest modificados:
  aprobados; revisión de enlaces y `git diff --check` sin defectos introducidos.
- El test de la matriz real también aprobó simulando un checkout sin los
  informes privados: devuelve advertencias de disponibilidad, sin inventar
  evidencia ni requerir servicios.

El primer control de la matriz rechazó cuatro records Markdown etiquetados
como `baseline`; se conservaron como históricos, sin debilitar el validador.
El informe rechazado queda en `.local/evidence/imp-07-01/coverage-first.json`.
La revisión cruzada detectó inconsistencias posibles en resultados/proveedores
de informes y selectores Cypress. Dos aserciones de reporte fallido fallaron
antes de corregir la lógica; las regresiones finales rechazan también un
encabezado favorable que oculta un caso fallido. La primera revisión lint
detectó una variable sin uso y un global no declarado en la prueba; se
corrigieron antes del resultado final.

La entrega tiene 696 fuentes y huella
`eb1f9ff335d06deff32112e6683fbf839f952ef20130442e32b8df90f4091122`:
`baselineMatchesCurrent=false` es el resultado correcto. Solo cambia
`package.json` entre las 694 fuentes iniciales; se agregan el script y su test.
El Office y `next-env.d.ts` previos, los inventarios Cypress/contextual, el
agregador .07, workflow y orquestador CI conservaron sus hashes iniciales.

No se ejecutaron builds, suites de producto, campañas, lectores ETL, servicios
remotos ni CI completa. La cobertura .01 queda cerrada en su alcance de
auditoría; .02–.08, .04 e integración/aceptación remota y humana conservan sus
pendientes. Continúa previsto IMP-03.07, sin iniciarlo en esta entrega.
