# Gobierno administrativo del banco — IMP-06.02

Fecha: 27/10/2026, America/Santiago. Implementación del único incremento
solicitado, sobre IMP-06.01 y preservando cambios anteriores del workspace.
El [plan acotado](IMP-06-bank-governance-plan.md) describe alcance y secuencia;
el [diccionario](IMP-06-bank-governance-dictionary.md), la persistencia.

## Capacidad implementada

ADMIN activo modifica propietario/visibilidad de ejercicios activos de su
organización, crea versiones nuevas y archiva conservando usos e historia.
Se reutilizan las rutas y reglas de autoría/archivo de IMP-02, las consultas
administrativas .01 y la auditoría/idempotencia transaccional existentes.

`PATCH /api/v1/exercises/{id}/governance` admite solamente `ownerId` y
`visibility`, opcionales pero no ambos ausentes. Requiere `If-Match` y
`Idempotency-Key`; responde detalle administrativo más ETag. Valida destino
ACTIVE ADMIN/TEACHER con perfil ACTIVE en el mismo ámbito. PRIVATE/ORGANIZATION
no habilita publicación fuera de organización. El dueño histórico inactivo
puede conservarse cuando no cambia. Un no-op no incrementa revisión ni crea
auditoría de mutación; sí conserva la respuesta idempotente.

El bloqueo de organización serializa mutaciones con membresías/autoría.
Autorización vigente precede al replay; revisión y disponibilidad preceden
al cambio efectivo. Misma clave/payload/revisión recupera la respuesta sin
duplicar efectos; clave con otro payload falla 409, revisión obsoleta falla 412. Se mantienen 24 horas y tombstone del mecanismo previo de contenido.
Una falla de auditoría revierte identidad, revisión y reserva de operación.

`GET /api/v1/exercises/{id}/governance/content` recupera la definición actual
para ADMIN autorizado, con las pruebas de autoría; no incluye evidencia de
alumnos. Permite precargar el formulario sin recorrer el historial paginado.
La proyección de metadatos de .01 permanece sin código ni tests. ADMIN no
obtiene publicación docente ni lectura de intentos por esta capacidad.

`POST /exercises/{id}/versions` conserva permiso del TEACHER propietario y
añade ADMIN del ámbito. Inserta definición, conceptos y pruebas inmutables;
actualiza solo el puntero vigente. Un replay confirmado puede recuperarse
después del archivo, sujeto a autorización actual. `POST /exercises/{id}/archive`
mantiene DEC-002: bloquea nuevas asignaciones/versiones y publicación de
borradores referenciados, conserva publicaciones y consultas autorizadas.

La migración aditiva `20261027155241_exercise_bank_governance.sql` añade un
trigger para destino de propietario y amplía tres políticas INSERT al ADMIN.
No cambia filas previas, tablas, columnas, proveedores ni dependencias.
Readiness exige la función nueva. La API se instala después del esquema.

## Experiencia y aceptación

El banco muestra contexto, conceptos, versión y usos antes de cada acción.
El selector de propietario usa miembros autorizados paginados. Cambios de
acceso y archivo requieren confirmación cancelable; cancelar no envía mutación.
La edición reutiliza el formulario de definición existente. Los conflictos
conservan campos y permiten cargar la revisión actual; ante resultado incierto,
el reintento conserva clave, payload y ETag. Revocar permisos retira los datos.
Se conservan lecturas de organización/ejercicio archivados.

| Escenario | Evidencia implementada                                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| HU-024-E1 | PATCH recuperable, una auditoría; archivo desde UI; cancelación sin request.                                                                         |
| HU-024-E2 | Destino inválido y tests contradictorios rechazados sin cambios; fallo de auditoría revierte todo.                                                   |
| HU-024-E3 | Rol/organización ajenos y revocación rechazados; sin ampliar visibilidad ni devolver contenido.                                                      |
| HU-024-E4 | Nueva versión ADMIN; comparación independiente de versiones, pruebas, conceptos, actividades e intento Docker previo; progreso conserva denominador. |

Concreta DEC-004/006 y aplica DEC-001/002; no modifica diagnóstico, progreso,
reglas o semántica pedagógica. RF-017/019/027 e IMP-06.03–.07 quedan fuera.

## Verificación

LAB TEST exclusivo, Windows, Node 24.21.0/npm 11.19.0, Supabase 2.101.0,
Docker 29.7.2/Compose 5.3.1. Web 3300, API 4300, Auth 18421, PostgreSQL 18422.
No se ejecutaron migraciones remotas ni se crearon commits.

| Comprobación ejecutada               | Resultado                                    | Fuente                                                        |
| ------------------------------------ | -------------------------------------------- | ------------------------------------------------------------- |
| Foco API exercise-bank/app           | 42/42 aprobadas en la primera ejecución.     | Salida de sesión; precede al último caso de logs y mapeo SQL. |
| Contratos del banco                  | 5/5 aprobadas.                               | `tests/exercise-bank-contracts.test.cjs`.                     |
| `npm run lint` y `npm run typecheck` | Aprobados.                                   | Salida de sesión.                                             |
| `npm run test:bank:integration`      | 14/14 HTTP; 1126 SQL en 18 archivos.         | `.local/reports/imp-06/bank-integration.json`, 15:58:41 UTC.  |
| Integración completa dentro de CI    | 214/214 HTTP; 1126 SQL en 18 archivos.       | `.local/reports/imp-05/integration.json`, 16:25:09 UTC.       |
| Cypress completo dentro de CI        | 88/88; cero fallidos, pendientes u omitidos. | `.local/reports/imp-06/e2e.json`, 17:00:45 UTC.               |
| Jest completo dentro de CI           | 2234/2234 pruebas aprobadas en seis grupos.  | `.local/reports/imp-06/ci.json`, etapa `npm test`.            |

El ensayo `npm run test:bank:upgrade` aprobó a las 16:00:41 UTC. Actualizó
`20261027020051` → `20261027155241` y conservó 25 ejercicios, 49 versiones,
49 enlaces de conceptos, 98 pruebas, 24 actividades, 25 asignaciones, un
evento de auditoría previo real y su clave de operación. Los tres digests
(antes, después de migrar y después de leer) coincidieron:
`30c3daeb5af5f542012b4db258485a99e5c614182e3e3747ae764c84c6ad44c1`.
Readiness pasó de 503 a 200; PATCH, replay y nueva versión ADMIN aprobaron.
Informe: `.local/reports/imp-06/bank-governance-upgrade.json`.
`test:bank:upgrade` apunta ahora al ensayo vigente .01→.02; el script y el
registro de la prueba histórica .01 se conservan sin alterar sus resultados.

Cypress focal `npm run test:e2e -- --bank-governance` aprobó **5/5**, sin
pendientes/omitidos, a las 16:08:34 UTC. Chrome 156.0.8078.48, Cypress 16.0.0,
servicios reales y build de producción; incluye SUBMIT Docker real y
manipulación únicamente del transporte de una respuesta ya confirmada.
Informe `.local/reports/imp-06/e2e-bank-governance.json`.
Las capturas `imp06-governance-{desktop,tablet,mobile}-confirmation.png`
están en `.local/evidence/imp-06/screenshots/exercise-bank-governance.cy.ts`.
Revisión visual del agente: texto legible, contadores separados y acciones
visibles; diálogo con scroll interno en 1440×900, 768×1024 y 390×844.
El foco verificó teclado, retorno de foco y ausencia de overflow de página.

Los gates de regresión RUN y SUBMIT conservaron 50 muestras a concurrencia
uno y 50 a concurrencia cuatro por corrida, sin errores. Los tres perfiles
SUBMIT consecutivos aprobaron sin cambiar candidato ni entorno:

| Perfil   | Fecha UTC | p95 concurrencia 1 (ms) | p95 concurrencia 4 (ms) |
| -------- | --------- | ----------------------- | ----------------------- |
| RUN      | 16:28:10  | 1266,05                 | 3031,58                 |
| SUBMIT 1 | 16:32:13  | 2118,43                 | 4167,51                 |
| SUBMIT 2 | 16:36:08  | 2055,62                 | 3826,92                 |
| SUBMIT 3 | 16:40:01  | 2064,84                 | 3587,36                 |

Muestras e identidades de corrida: `.local/reports/imp-03-submissions/`
y su carpeta `history`. No se redujeron los gates. Cypress revalidó también
las lecturas del banco en Chrome de producción: p95 de lista **529,20 ms** y
detalle **639,50 ms**, 50 muestras calientes por superficie, concurrencia uno,
con primera navegación separada. Fuentes
`.local/reports/imp-06/exercise-bank-ui-{list,detail}.json`; no son medidas
de latencia de mutaciones ni de un ambiente remoto.

La CI completa terminó a las **17:07:42 UTC** con **16/17 etapas aprobadas**.
La última, `test:help:evaluation`, falló en `authorize` con `CANDIDATE_CHANGED`,
sin llamadas externas. El agente actualizó documentación durante la preparación
del ensayo considerando solo el manifiesto de fuentes de señales; el fingerprint
de evaluación incluye también documentos. Fue un error de coordinación del
agente, no una comprobación de ayuda aprobada ni un defecto de producto demostrado.
Se conserva el informe fallido y se repitió únicamente esa etapa con todo el
repositorio congelado, sin debilitar controles ni alterar los resultados previos.
La repetición `npm run test:help:evaluation` **aprobó a las 17:28:18 UTC**,
run `8f76875c-bbe8-458a-b27b-6604e1551aa2`: 234 muestras (4 funcionales,
30 adversariales, 100 secuenciales y 100 concurrentes), 43/43 casos de cobertura,
763 recibos y cero llamadas externas. Verificó tres reanudaciones y conserva
proveedor TEST explícito. Fuentes `.local/reports/imp-04/evaluation-test.json`
y `evaluation-measurements.json`, con fingerprint global
`9c9a82110ef7f2996267cf9b875d2315337bfcb2eb3d024c6d3610fd1bdc0a6f`.
Los p95 de respuesta API fueron 765,92/2991,28 ms; no acreditan ayuda visible
en navegador (`BROWSER_RENDER_EVIDENCE_UNAVAILABLE`) ni calidad pedagógica.
La corrida original no se reclasifica como CI 17/17: sus 16 etapas aprobadas
y esta repetición se conservan como ejecuciones distintas. Los servicios TEST
se detuvieron al terminar.

El candidato inicial contiene 575 archivos de fuentes, sobre HEAD
`75708ceecf2ca755bd32fb4b04e77bcb8de310f4`, con huella
`2312a659b90a296e586838dee3bd4f073be9236158d4b705e10398a50043db00`.
Después se corrigió exclusivamente el literal `increment` de la suite Cypress
completa, que todavía decía `IMP-01–IMP-06.01`, a `IMP-01–IMP-06.02`.
El informe original de 88 casos se conserva con su etiqueta original; no se
reescribe evidencia. Esa corrección de metadatos se verifica con sintaxis,
formato y lint, separada de la ejecución de navegador. No cambia casos ni gates.
La comparación de inventarios identifica únicamente `cypress.config.cjs`
como diferencia de las 575 fuentes; la huella posterior es
`26f712ace0959efb7abb12360de399d5f58bbac8841b5d4e7b32998711856c05`.
Sintaxis, Prettier y ESLint de ese archivo aprobaron; también el formato
global y `git diff --check`. Los 453 enlaces locales revisados en 14 documentos
resuelven correctamente. No se atribuye una nueva corrida completa de CI
a la corrección de etiqueta o al cierre documental.

Los resultados locales no acreditan despliegue, Azure, Sandbox
productivo, conformidad WCAG integral ni aceptación humana/CAPSTONE.

Primer foco Cypress (16:04:21 UTC): build y artefactos aprobaron, pero el
lanzador secundario `scripts/cypress-run.mjs` aún no admitía la nueva suite
`bank-governance`. No ejecutó casos; se corrigió el registro de suite/ruta y
se conservó el diagnóstico previo. No se cuenta como aceptación de navegador.

## Cierre del alcance

IMP-06.02 está implementado y verificado localmente con API, persistencia,
interfaz y evidencia de E1–E4. Se actualizaron estado, arquitectura, contratos,
modelo de datos y trazabilidad sin cambiar los escenarios normativos ni los
cortes históricos. No se añadieron dependencias ni se modificó el lockfile.
IMP-06.03–.07, integración remota y aceptación humana/CAPSTONE permanecen
pendientes; no se inició otro incremento.
