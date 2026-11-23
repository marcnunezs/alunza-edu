# IMP-06.01 — Consulta administrativa del banco

**Cierre técnico local: 27/10/2026, America/Santiago.** La CI completa terminó
`2026-10-27T04:49:50.805Z`: 17/17 etapas aprobadas, con 83/83 casos Cypress,
207/207 HTTP y 1084 aserciones SQL. La aceptación humana y remota permanece
separada de este resultado.

Alcance autorizado: implementar el plan de consulta administrativa, únicamente
IMP-06.01. RF/HU/CU/PT-024 permanece parcial; gobierno de propiedad, visibilidad,
versionado administrativo y archivo integral corresponden a IMP-06.02.

## Contrato implementado

Cuatro GET bajo `/api/v1`, con ADMIN vigente del ámbito:

| Ruta                                  | Proyección                                      |
| ------------------------------------- | ----------------------------------------------- |
| `/organizations/:orgId/exercise-bank` | Banco filtrado, metadatos y conteos.            |
| `/exercises/:id/governance`           | Detalle y versión actual resuelta directamente. |
| `/exercises/:id/governance/versions`  | Historia de metadatos de versiones.             |
| `/exercises/:id/governance/uses`      | Referencias operativas a actividades/clases.    |

Los contratos públicos están en `packages/contracts/src/exercise-bank.ts` y
OpenAPI se genera desde ellos. Todas las respuestas contienen `data` y
`requestId`; el payload incorpora `observedAt`. Los listados contienen `items`
y `page {nextCursor, hasMore, totalFiltered}`. Límite predeterminado 20, máximo 100. No se agregan proveedores, dependencias ni tablas de dominio.

El banco filtra por título actual (`search`, texto parcial literal, trim,
máximo 160 caracteres), estado, dificultad, concepto y visibilidad. Los filtros
omitidos incluyen todos los valores. Concepto/dificultad se aplican sobre la
versión actual. Usos admite `versionId` y `activityState`.

Ejercicios/usos se ordenan por UUID ascendente; versiones por número descendente.
Cursores base64url de hasta 4096 caracteres ligan actor, organización, recurso,
filtros normalizados y orden. No conceden permisos; cada lectura reautoriza y
comprueba la pertenencia del ancla al conjunto consultado. Un cursor inválido
produce 422 corregible; un recurso ajeno/no disponible produce 404 seguro.

`totalFiltered` se calcula antes del cursor en la misma sentencia que la página.
Los conteos de uso cuentan asignaciones (`activity_exercises`): dos versiones
en una actividad son dos usos. Conservan DRAFT/PUBLISHED/CLOSED por separado y
no se multiplican por conceptos. La lectura observa el estado por petición;
no promete snapshot persistente ni estabilidad ante cambios entre páginas.

El propietario contiene ID/nombre, sin correo. La versión incluye ID, número,
título, dificultad, fecha y conceptos de las versiones fijadas. Se excluyen
enunciado, plantilla, pruebas, estudiantes, intentos, resultados y ayudas.

## Autorización y datos

La migración aditiva `20261027020051_exercise_bank_read.sql` reutiliza tablas,
claves compuestas e índices existentes. Las cuatro funciones de entrada ejecutan
como `alunza_identity`, NOLOGIN sin BYPASSRLS, con `search_path=pg_catalog` y
comprobación del actor/sesión/rol vigente. Los kernels no son ejecutables por
`alunza_app`; `anon`, `authenticated`, `service_role` y PUBLIC no reciben acceso.

NestJS usa `DatabaseService.readAs`; readiness requiere las cuatro funciones.
No se amplía `academic_activity_read`, las proyecciones estudiantiles ni la
autoría docente. ADMIN conserva consulta de organización READ_ONLY, ejercicios
y clases archivados; un propietario deshabilitado sigue identificable.
Las respuestas son privadas/no-store y los logs usan plantillas sin IDs/filtros.

DEC-004/006 se concretan solo para estas lecturas. DEC-001/002 permanecen
vigentes. DEC-009 conserva datos ficticios, sin nueva retención ni exportación.

## Experiencia integrada

La página `/administracion/organizaciones/[orgId]/banco` se abre desde
Organizaciones, incluida lectura histórica. Tiene filtros, conteos completos,
detalle y paginación independiente de versiones/usos. El resumen actual permanece
visible al cambiar de página histórica. Conceptos se eligen mediante el catálogo
autorizado paginado; usos solo muestra referencias operativas.

Cambiar filtros/ejercicio reinicia cursores; actualizar o reintentar una página
también vuelve al inicio conservando filtros, para recuperarse de un cursor
cuyo ancla dejó de pertenecer al conjunto. El transporte cancela y descarta
respuestas antiguas. Revocación retira datos. Carga, vacío y error recuperable
se presentan separadamente. No hay acciones de mutación nuevas.

## Verificación del candidato

Verificación local en Windows, Node 24.21.0/npm 11.19.0, Supabase 2.101.0,
Docker 29.7.2/Compose 5.3.1 y Chrome 156.0.8078.48/Cypress 16.0.0.
LAB TEST exclusivo: web 3300, API 4300, Auth 18421 y PostgreSQL 18422.
Las migraciones y fixtures de esta tarea se ejecutaron únicamente en LAB TEST.

Candidato sobre HEAD `75708ceecf2ca755bd32fb4b04e77bcb8de310f4`, con cambios
previos del workspace conservados, sin crear un commit. La huella de los
**568 archivos de fuentes** fue igual al comenzar y terminar la CI:
`bc8e8618f567d73b8b5cbd37759dd84e704c30fb21ff15ecc14fa6bb27160b9b`.
Los documentos de cierre en `docs/`, `specs/` y el README raíz quedan fuera
de esa huella, al igual que los generados `next-env.d.ts`/OpenAPI.
Durante la corrida final se congelaron también los documentos; su cierre
posterior no constituye otra ejecución de producto.

| Comando ejecutado                                                                      | Resultado                                                                            | Evidencia local                                                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Foco Jest API (`app.spec.ts`, `exercise-bank.spec.ts`, `database-rule-errors.spec.ts`) | 40/40 aprobadas con el script ESM del workspace.                                     | Salida de sesión; el conjunto completo aprobó en CI.                          |
| Contratos `exercise-bank-contracts.test.cjs`                                           | 4/4 aprobadas.                                                                       | Salida de sesión; incluidas en `npm test`.                                    |
| `npm run test:bank:integration`                                                        | 7/7 HTTP y 17 archivos pgTAP, 1080 aserciones aprobadas en el foco inicial.          | `.local/reports/imp-06/bank-integration.json`.                                |
| `npm run test:e2e -- --bank`                                                           | 8/8 aprobadas, sin pendientes ni omitidas; seis capturas, teclado y dos perfiles UI. | `.local/reports/imp-06/e2e-bank.json`; la CI final revalidó el ajuste visual. |
| `npm run test:bank:upgrade`                                                            | Aprobado: esquema anterior, conservación y cuatro consultas HTTP autenticadas.       | `.local/reports/imp-06/bank-upgrade.json`.                                    |
| `npm run test:bank:performance`                                                        | Aprobado: cuatro primeras peticiones y 200 posteriores, sin errores.                 | `.local/reports/imp-06/bank-api-performance.json`.                            |
| `npm run ci:verify`                                                                    | 17/17 aprobadas; npm test informó 2218 tests en seis grupos Jest; Cypress 83/83.     | `.local/reports/imp-06/ci.json`; E2E completo en `imp-06/e2e.json`.           |

Los informes se conservan también bajo `history` y no están versionados.
La integración completa dentro de CI aprobó posteriormente **207/207 HTTP y
1084 aserciones SQL en 17 archivos**, incluidos los últimos casos de permisos
del banco (`.local/reports/imp-05/integration.json`, 27/10/2026 03:58:25 UTC).
La actualización desde `20261026220133` a `20261027020051` preservó exactamente
25 ejercicios, 49 versiones, 49 enlaces de conceptos, 24 actividades y 25
asignaciones. La tabla de auditoría del fixture no tenía eventos y permaneció
vacía: esta corrida no acredita conservar eventos preexistentes. Los digests
antes, después de migrar y después de leer fueron iguales; readiness cambió
de 503 a 200 sin usar los GET como preparación de datos.

Rendimiento API: concurrencia 1; reinicio de API por superficie, primera petición
separada de 50 posteriores; listados alternan páginas de 20 y 5 registros.
Percentil nearest-rank, límite <3000 ms; conserva todas las muestras y errores.

| Superficie | Primera petición (ms) | p95 de 50 (ms) | Errores |
| ---------- | --------------------- | -------------- | ------- |
| Banco      | 231,75                | 22,02          | 0       |
| Detalle    | 48,12                 | 19,96          | 0       |
| Versiones  | 35,44                 | 13,58          | 0       |
| Usos       | 42,66                 | 13,28          | 0       |

Huella del ensayo API:
`89cc7e5c6d29de00c3d61df6900f0ae88397414b1f0384f6eb472e4842bc2715`.
Este perfil local no acredita concurrencia alta, red remota ni DEC-008 global.

La UI se midió en Chrome contra el build de producción y servicios reales,
con navegación autenticada, concurrencia 1, una primera navegación separada
y 50 posteriores por superficie. La CI final registró:

| Superficie UI | Primera navegación (ms) | p95 de 50 (ms) | Errores |
| ------------- | ----------------------- | -------------- | ------- |
| Banco         | 289,10                  | 377,40         | 0       |
| Detalle       | 629,50                  | 657,60         | 0       |

Informes: `.local/reports/imp-06/exercise-bank-ui-{list,detail}.json` y
`exercise-bank-ui-screenshots.json`. Las seis capturas finales están en
`.local/evidence/imp-05/screenshots/exercise-bank.cy.ts` (carpeta de la suite
completa): 1440×900, 768×1024 y 390×844, listado/detalle. Revisión visual del
agente sobre las capturas de 04:19:42–50 UTC: textos legibles, contadores sin
solapamiento y listado móvil inicialmente en la primera columna. Cypress
comprueba dimensiones, desbordamiento, geometría del texto, navegación/foco
con teclado y desplazamiento horizontal interno.

Los tres gates SUBMIT consecutivos de la CI final conservaron 50 muestras por
perfil y cero errores, con candidato e infraestructura intactos:

| Hora UTC | Run ID                                 | p95 concurrencia 1 (ms) | p95 concurrencia 4 (ms) |
| -------- | -------------------------------------- | ----------------------- | ----------------------- |
| 04:05:34 | `34c8298c-52bd-4b9e-a372-8624dcf0cadc` | 2009,85                 | 4067,79                 |
| 04:09:36 | `737ff7eb-7b5a-4941-9aef-3bcec3296ac6` | 1949,35                 | 3399,53                 |
| 04:13:25 | `6022f70d-a8a5-4c4f-b5bb-283f260ef74b` | 1825,69                 | 3853,60                 |

Las muestras completas permanecen en
`.local/reports/imp-03-submissions/history/submit-performance-*.json`.
La evaluación de ayuda TEST también aprobó; sus informes están en
`.local/reports/imp-04/evaluation-{test,measurements}.json`. Usa dobles de IA
explícitos y conserva las limitaciones de ayuda renderizada y aceptación
pedagógica de sus registros originales.

Fixtures de capacidad aislados: 25 ejercicios, 25 versiones del ejercicio foco,
25 asignaciones en 24 actividades, uso de dos versiones en una actividad y
conceptos históricos distintos de la taxonomía actual. No cambian la demo
canónica. La preparación de archivo cierra actividades PUBLISHED antes de
archivar la clase y conserva los usos; no deshabilita triggers.

Cobertura verificada del incremento: lectura de HU-024-E1/E3 e historia de E4;
no atribuye la mutación de E1/E2/E4 a este incremento. Complementa DAT-01/04/10,
RNF-SEG-01/02/03/05, USA-01/02/03/04 y REN-01/04.

Antecedentes de ejecución: primer arranque detenido por Node 24.14 en PATH;
se activó Node 24.21.0/npm 11.19.0 mediante `scripts/use-node.ps1`. Primer foco
HTTP detectó ambigüedad SQL del listado y una precondición inválida del fixture
de archivo. Se corrigieron los nombres de variables y la preparación del
fixture, manteniendo los rechazos del dominio. Una invocación directa de Jest
sin el flag ESM del script de API no arrancó la suite; no cuenta como prueba.

La primera corrida Cypress aprobó 7/8: la comprobación de anchura confundía
el viewport con el espacio útil descontando la barra vertical. Se corrigió
para medir desbordamiento contra el ancho útil, conservando la dimensión
exacta del viewport/PNG; la segunda aprobó 8/8. La revisión de seis capturas
detectó después solapamiento de etiquetas/cifras en tableta: se corrigió la
columna del contador y se añadió comprobación de rectángulos del texto en
los tres tamaños. El foco con esta corrección aprobó 8/8 a las 02:45 UTC;
la nueva captura de tableta confirma la separación. Intentar restaurar el
scroll móvil antes de capturar seguía produciendo un encuadre desplazado;
se ordenó capturar antes de probar las flechas, conservando esa comprobación
de teclado. La CI final revalidó el orden de captura. Revisión visual
del agente y automatización no acreditan
conformidad WCAG completa ni aceptación humana.

Primera CI integrada: diez etapas aprobadas, incluidos 2218 tests reportados
por seis grupos Jest y la integración 207/1084. Se detuvo en la etapa 11,
RUN: `candidateUnchanged=false`. El agente editó este registro durante esa
medición; aunque la huella general de fuentes de CI excluye documentación,
la huella del ensayo RUN la incluye. Sus 100 respuestas válidas, p95 1399,16 ms
(concurrencia 1) y 2619,98 ms (concurrencia 4), limpieza e infraestructura
estables no convierten esa corrida en aprobada. Se conserva
`run-performance-1793068894484-36296541-5074-47a0-9832-a6947145fbd6.json`
en el historial de `imp-03-submissions`. Las corridas posteriores congelaron
fuentes y documentación durante la ejecución, manteniendo todos los gates.

Segunda CI integrada: 15 etapas aprobadas, incluidas RUN y tres corridas SUBMIT
con candidato/infraestructura intactos. Cypress completó **76/83**, con los
ocho casos del banco aprobados, cero pendientes y cero omitidos. Cinco FND
dependían de que `/me` seleccionara automáticamente la organización canónica:
los nuevos ámbitos `Banco E2E` ordenan antes por nombre. IMP01-08 asumía que
su tarjeta estaba entre las primeras 20. No se cambian el orden de producto,
el tamaño de página ni los datos para ocultar esos supuestos: los tests eligen
la organización y recorren páginas explícitamente. IMP05-RULES-01 intentó
enfocar `Activar` mientras se recargaba el estado efectivo; se espera a que
esté habilitado, conservando el guard de UI y las aserciones de foco. Las
causas se sustentan en código y errores observados; la tercera CI revalidó
las correcciones con **83/83 casos**, sin pendientes ni omitidos. Informe y
diagnóstico del fallo conservados
en `.local/evidence/imp-06/e2e-full-20261027T033640-failed.{json,log}`.

El cierre de .01 no acredita RF-024 integral, IMP-06 completo, despliegue,
aceptación CAPSTONE ni integración con proveedores remotos.

Cierre documental verificado: formato del registro, 355 enlaces locales de
los nueve documentos afectados, `git diff --check` y lockfile sin cambios.
La comprobación posterior a los documentos conservó la misma huella de las
568 fuentes de la CI aprobada. Se conservaron los cambios previos del usuario
y las evidencias de los intentos anteriores.
