# IMP-05.06 — Plan de administración de reglas y parámetros efectivos

Fecha: 25/10/2026, zona America/Santiago. Estado original: **PLANIFICADO**.
El usuario autorizó después «Perfecto. Implementa este plan». La ejecución y
sus resultados se registran en [IMP-05.06](IMP-05-rules-ui.md).
**Estado al 26/10/2026: IMPLEMENTADO Y VERIFICADO LOCALMENTE**, con CI 17/17
aprobada y cierre documental completado. Los pasos siguientes conservan la
planificación original; el checklist de cierre refleja la ejecución, cuya
evidencia y límites están en el registro enlazado. No autoriza despliegues.

## Objetivo y alcance

El ADMIN de una organización podrá consultar sus parámetros efectivos y su
historial, crear una versión inmutable y activarla con autor, fecha y vigencia
confirmados. El cambio será consumido por el motor existente en evaluaciones
posteriores, conservando las señales históricas y sus revisiones.

Cobertura principal: **ALZ-RF-026 / ALZ-HU-026 / ALZ-CU-026 / ALZ-PT-026,
escenarios E1–E4**, y UX-18. Se verifica la conexión con RF-018 sin cerrar su
consulta docente integral. Aplican RNF-SEG-01/02/05, USA-01/02/03/04,
CON-02/04, MAN-02/03/04, IA-05 y medición local de REN-01/04.

Se conserva el alcance de la [fase IMP-05](../plan/05-progreso-y-senales.md).
El tablero .07, la aceptación conjunta .08, el detalle y revisión docente de
IMP-06, el visor general de auditoría/CSV de RF-027 y las validaciones remotas
continúan en sus incrementos. La UI administrativa no obtiene acceso a código,
intentos, evidencia individual ni endpoints internos del motor.

Fuentes normativas: [requisitos](../../specs/02-requisitos-funcionales.md),
[CU-026 y E1–E4](../../specs/03-flujos-y-criterios-de-aceptacion.md),
[DEC-005 aprobada](DEC-005-2026-10-05.md),
[progreso y señales](../../specs/14-progreso-y-senales.md),
[contrato de reglas](IMP-05-signal-rules-dictionary.md),
[contrato de episodios](IMP-05-episodes-dictionary.md) y
[calidad](../../specs/10-calidad-y-pruebas.md).

## Base comprobada

Rama `laboratorio`, HEAD `75708ceecf2ca755bd32fb4b04e77bcb8de310f4`.
El árbol contiene cambios previos extensos y archivos nuevos de .03–.05 sin
commit. Esa implementación está en el árbol de trabajo; no reconstruirla
desde HEAD ni limpiar cambios para iniciar .06. Preservar también las evidencias
Office ajenas al encargo.

Se inspeccionaron fuentes, contratos, pruebas y el reporte existente
`.local/reports/imp-05/ci.json`: registra ejecución local `passed`, **17/17**,
con digest de candidato
`19253829d0baecaf2055c855714ab15247344a28d6fb1887fab5b65823834ba6`.
El [cierre .05](IMP-05-episodes.md) registra su término el
`2026-10-26T00:35:22.681Z` —25/10 en Santiago—. Es evidencia del candidato
anterior; no una nueva ejecución ni certificación del futuro candidato .06.

| Área              | Existe y se reutiliza                                                                                                     | Brecha de .06                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Contratos y API   | `packages/contracts/src/signal-rules.ts` y `apps/api/src/rules/`: crear, listar, detalle y activar con CAS e idempotencia | Lectura acotada y fiable de las tres reglas efectivas                     |
| Persistencia      | Migración `20261005233736_signal_rule_versions.sql`: versiones inmutables, rangos, RLS y auditoría atómica                | Nueva lectura administrativa; no rehacer tablas ni mutaciones             |
| Motor y episodios | `apps/api/src/signals/`, migración `20261025201002_signal_episodes.sql`, worker y reconstrucción                          | Conectar la prueba de activación desde UI con una evaluación real en TEST |
| Frontend          | Sesión, `ProtectedView`, `useApiResource`, `useOperation`, formularios, diálogos y paginación                             | No hay ruta, componentes ni E2E de reglas                                 |
| Verificación      | Suites de reglas, SQL/RLS y señales; CI local de 17 pasos                                                                 | Nuevos contratos/lecturas, UX, conflictos y recorrido E1–E4               |

El listado actual ordena `created_at,id` ascendente y admite únicamente
`type`, `cursor` y `limit`. La activa puede estar fuera de la primera página:
ni esa página ni la versión con mayor número bastan para determinar vigencia.
Además, un replay de activación devuelve el snapshot original; puede describir
como ACTIVE una versión que posteriormente pasó a RETIRED.

La prueba existente de `tests/integration/zzzzzzzzzz-signals.test.cjs`
ya cubre cambio de versión y preservación histórica. Los evaluadores puros
tienen oráculos para N=2, N=4 y fronteras int4. Esas capacidades se reutilizan;
no se planifican como implementaciones pendientes. Algunos encabezados
documentales anteriores al cierre .05 conservan estados históricos desactualizados.

## Decisiones de trabajo

1. **Semántica vigente.** Aplicar DEC-005 D1–D5 sin reabrir su aprobación:
   activación inmediata con hora servidor, intervalos `[A,B)`, una vigente por
   organización/tipo y versiones inmutables desde creación. No hay edición,
   borrado, programación futura ni activación retroactiva. Cambiar parámetros
   crea otra versión DRAFT; guardarla no la activa.
2. **Parámetros.** Conservar `schemaVersion=1`, `algorithmVersion=DEC005_V1` y
   los tres tipos. Días enteros entre 1 y 2.147.483.647; conteos entre 2 y ese
   máximo. Línea base: inactividad 7 días; error repetido 3 intentos/14 días;
   estancamiento 3 intentos, sin ventana adicional. La línea base puede
   precargar el formulario, pero no instalar reglas ni ocultar falta de
   configuración. No introducir máximos pedagógicos nuevos.
3. **Consulta de efectivas.** Propuesta técnica aditiva: un endpoint específico
   para los tres tipos, separado de la paginación histórica. Sin filtro temporal
   cliente ni consulta de evidencia estudiantil.
4. **Auditoría acotada.** Presentar creación, activación y vigencia mediante
   `createdBy`, `createdAt`, `activatedBy`, `validFrom` y `validTo`. Verificar
   los eventos reales `RULE_VERSION_CREATED` y `RULE_VERSION_ACTIVATED` ya
   persistidos, con unicidad y atomicidad. La vista se llama «Historial de
   versiones», no un registro general de auditoría. Los UUID de autor son
   verificables y suficientes para este corte; no crear un directorio global
   ni depender de que el autor siga siendo miembro ACTIVE para conservarlos.
5. **Ámbito.** ADMIN con perfil, membresía y sesión vigentes. La organización
   ARCHIVED conserva lectura administrativa; creación, activación y sus
   replays de mutación requieren organización ACTIVE. El cliente no concede
   permiso por ocultar controles. TEACHER/STUDENT y ADMIN ajeno siguen denegados.
6. **Evaluación posterior.** Activar confirma vigencia, no procesamiento de
   todas las clases. El worker existente está deshabilitado por defecto:
   habilitarlo explícitamente solo en el arnés TEST que pruebe el recorrido,
   o usar su vía interna de procesamiento ya existente. No añadir un botón
   administrativo de recalcular ni habilitar globalmente el worker.

Estas elecciones concretan la implementación de .06; no cambian permisos,
reglas pedagógicas ni proveedores. No se identificó una decisión de producto
pendiente que impida iniciar el desarrollo local.

## Contrato adicional propuesto

`GET /api/v1/organizations/{orgId}/signal-rules/effective`

Respuesta estricta, siguiendo los sobres actuales:

```text
{
  data: {
    organizationId: UUID,
    observedAt: instante UTC con precisión de hasta seis decimales,
    rules: [
      { type: INACTIVITY, ruleVersion: SignalRuleVersion | null },
      { type: REPEATED_ERROR, ruleVersion: SignalRuleVersion | null },
      { type: STAGNATION, ruleVersion: SignalRuleVersion | null }
    ]
  },
  requestId: UUID
}
```

Exigir exactamente una entrada de cada tipo, sin duplicados ni extras. Cada
versión no nula debe ser ACTIVE y corresponder al tipo y organización de su
entrada; `null` significa «Sin regla activa». Una falla de servicio produce
error, nunca tres valores nulos ni parámetros por defecto.

Resolver autorización, las tres entradas y `observedAt` con una lectura consistente del
servidor, independiente del tamaño del historial; preferir el timestamp de la
sentencia y conservar microsegundos. `DatabaseService.readAs`
usa actualmente `BEGIN READ ONLY`; no presumir que varias consultas separadas
comparten snapshot. Diseñar una única consulta/RPC de lectura para el conjunto
y probar una activación concurrente. `observedAt` informa la consulta, no el
corte de un evaluador ni que el worker ya procesó la nueva versión.

Conservar `Cache-Control: no-store`, validación Zod, revalidación de sesión y
ámbito, lectura de organización archivada y errores seguros del módulo actual.
No usar `service_role` para servir esta consulta. Añadir la función SQL y sus
grants mínimos en una migración nueva; mantener intactas las migraciones .03
y .05. No se prevé tabla nueva, dependencia nueva ni cambio de fórmula.

La creación y activación mantienen sus DTO actuales. Después de confirmar o
reconciliar una mutación, consultar efectivas y detalle/historial actuales.
El snapshot de respuesta de una operación conserva su valor de comprobante,
pero no sustituye la consulta de vigencia actual.

## Secuencia de implementación

Los pasos son subtareas de IMP-05.06, no nuevos incrementos ni RF.

| Paso                       | Entrega verificable                                                                                                     | Archivos previstos                                                                                                                                                                          | Dependencia        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1. Contrato y fixture      | Esquema de efectivas, ejemplo vacío/parcial/completo y matriz E1–E4; registrar el candidato de partida                  | `packages/contracts/src/signal-rules.ts`, `tests/signal-rule-contracts.test.cjs`, diccionario de reglas                                                                                     | Base inspeccionada |
| 2. Lectura consistente     | Endpoint/RPC, autorización, proyección y prueba con vigente fuera de la primera página                                  | Nueva migración y prueba en `supabase/`; controller/service y specs de `apps/api/src/rules/`; `database.service.ts` para readiness si corresponde; `scripts/openapi.mjs` y OpenAPI generado | Paso 1             |
| 3. Consulta administrativa | Ruta por organización, resumen efectivo y detalle/historial paginado, incluidos carga/error/vacío/archivo               | Nueva ruta y componentes de reglas; navegación existente                                                                                                                                    | Paso 2             |
| 4. Crear y activar         | Formulario estricto, confirmación de activación, CAS, recuperación idempotente y mensajes de conflicto                  | Componentes de reglas, helper de formulario/mensajes y pruebas web                                                                                                                          | Pasos 1–3          |
| 5. Recorrido integrado     | UI → versión persistida → activación → procesamiento TEST → nueva versión aplicada, historia intacta; E1–E4 y negativas | Nuevo E2E, suites HTTP/SQL/señales existentes, arnés y documentación de pruebas                                                                                                             | Pasos 2–4          |
| 6. Candidato y cierre      | Accesibilidad, medición, CI completa y registro trazable de resultados y pendientes                                     | `docs/work/`, diccionario/API, plan y matriz de control                                                                                                                                     | Paso 5             |

Se puede preparar el frontend y sus casos de formulario en paralelo con la
lectura SQL/API una vez fijado el DTO. La integración y las pruebas con servicios
reales son secuenciales. Si se delega, separar archivos de contratos/datos/API,
web y pruebas; un responsable integra los cambios compartidos del arnés.

### Pantalla y flujo

Ruta propuesta: `apps/web/src/app/administracion/organizaciones/[orgId]/reglas/page.tsx`.
Componentes nuevos en `apps/web/src/components/signal-rules/`; helpers puros
solo cuando permitan verificar transformación de formulario o manejo de estado.
Añadir acceso por organización en `organizations-panel.tsx` y
`home-panel.tsx`, reutilizando el patrón de usuarios y `ProtectedView`.

- Cabecera con organización y estado operativo o solo lectura.
- Tres resúmenes de parámetros efectivos, versión y vigencia; texto explícito
  si un tipo no tiene configuración activa. Distinguir error de ausencia.
- Historial paginado por tipo y detalle de parámetros/autoría/vigencias. Usar
  DRAFT/ACTIVE/RETIRED con etiquetas visibles; no confundirlos con estados de
  señal. Reiniciar cursor al cambiar filtro u organización.
- Formulario «Crear versión» con campos del tipo elegido. Convertir números
  explícitamente antes de validar; vacío no se convierte en cero. Asociar
  errores a `parameters.inactivityDays`, `parameters.repeatedErrorAttempts`,
  `parameters.repeatedErrorWindowDays` o `parameters.stagnationAttempts`.
- Diálogo «Activar versión» con parámetros propuestos y vigente que reemplaza.
  Capturar el `expectedCurrentVersionId` mostrado —o null confirmado por
  servidor—. Cancelar no envía mutación. No reemplazar la expectativa en silencio
  si llega una actualización mientras el diálogo está abierto.
- Ante `RULE_VERSION_CONFLICT`, conservar la propuesta, recargar la vigente y
  solicitar una nueva acción deliberada. `RULE_VERSION_ALREADY_ACTIVATED`
  explica que una retirada exige otra versión; no ofrece reactivarla.
- Reutilizar el protocolo de `useOperation` con una extensión optativa para
  reglas: misma clave, cuerpo y ruta mientras el resultado sea incierto;
  impedir doble clic y cambios de payload durante reconciliación. Conservar
  antes del envío una solicitud pendiente en `sessionStorage`, acotada por
  cuenta/organización y pestaña, con versión de formato, tipo de operación,
  identificadores, clave y payload validado; nunca tokens ni credenciales.
  El hook actual solo conserva memoria: esta persistencia es trabajo nuevo.
- Montar esta ruta con `ProtectedView preserveOnRefresh`. La renovación de
  sesión no debe perder la operación. Al recargar, validar el registro local y
  los permisos actuales, mostrar la operación pendiente y ofrecer reconciliar
  con la misma clave; no reenviar automáticamente ni generar otra clave.
  Un cambio de cuenta/organización no puede leer o ejecutar pendientes ajenos.
  Si no se puede guardar el pendiente antes de enviar, detener esa mutación
  con un error recuperable. Retirarlo tras resultado reconciliado; un error de
  autenticación no demuestra que una operación anterior no haya hecho commit.
  Una operación deliberada nueva obtiene otra clave.
- Tras confirmar, refrescar efectivas e historial. Si ese refresco falla,
  distinguir «operación confirmada» de «no se pudo actualizar la consulta»;
  no afirmar una vigencia actual que no se comprobó.
- Conservar precisión UTC de los valores originales. La fecha legible puede
  indicar zona local; no usar la hora del navegador para decidir vigencia.

Reutilizar `Field`, `SelectField`, `FormDialog`, `OperationError`, `Pagination`,
`RequestError`, `useSession` y `useApiResource`. Agregar mensajes de reglas en
la capa adecuada sin alterar los errores de otros módulos. Limpiar datos de
vista al cambiar cuenta/ámbito y descartar respuestas tardías de otra sesión.

## Verificación y aceptación

Fixtures TEST ficticios, separados del seed canónico: dos organizaciones,
ADMIN autorizado y ajeno, TEACHER/STUDENT, membresía revocada, organización
archivada, más de 100 versiones y reglas de los tres tipos. Usar reloj/barreras
existentes sin esperas fijas ni timestamps cliente. Los esperados se definen
independientemente de las funciones de producción.

| Criterio                    | Prueba prevista y resultado exigido                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HU-026-E1                   | Desde UI crear y activar cada tipo; recargar conserva versión, parámetros y autores/fechas reales; anterior RETIRED y cierre/inicio iguales. Crear sola no cambia efectivas.                                                                                                                                                                               |
| HU-026-E1, conexión RF-018  | Tras activación por UI, tarea Node del arnés TEST procesa/observa el motor real y comprueba versión/parametría nuevas. No expone credenciales o evidencia en el navegador. Reutilizar la fixture de cambio de regla de .05, incluida evidencia aún vigente, episodio vinculado y revisión histórica intacta.                                               |
| HU-026-E2                   | Intentos directos de sobrescritura/fechas o reactivación de RETIRED fallan; dos ADMIN compiten con la misma expectativa y solo uno activa. El perdedor conserva propuesta y debe confirmar de nuevo.                                                                                                                                                       |
| HU-026-E3                   | TEACHER/STUDENT, ADMIN ajeno, ID inexistente, sesión/perfil/membresía no vigentes: rechazo seguro y sin mutación. ARCHIVED permite lectura autorizada y rechaza mutaciones/replays. Ninguna respuesta incorpora evidencia pedagógica.                                                                                                                      |
| HU-026-E4                   | Vacíos, negativos, fracciones, conteo 1, valores fuera de int4, extras y algoritmo desconocido se rechazan. UI conserva campos y vincula error; API/SQL preservan configuración previa.                                                                                                                                                                    |
| Efectivas y paginación      | Tres tipos únicos; null explícito; activa fuera de primera página sigue visible; DRAFT con número mayor no desplaza vigente; cambio de filtro reinicia cursor; consultas concurrentes no mezclan estados incompatibles.                                                                                                                                    |
| Idempotencia y fallos       | Doble clic, respuesta perdida, renovación de sesión, recarga y replay tardío conservan clave/payload y no duplican versión/auditoría; fallo de almacenamiento previo impide enviar. Replay de una activación ya reemplazada no muestra su snapshot como vigente actual. Fallo de auditoría revierte mutación; API caída se distingue de sin configuración. |
| Aislamiento y actualización | Nuevo RPC/grants solo para contexto autorizado; alternancia de cuentas no filtra datos; migración desde .05 e instalación vacía conservan versiones, eventos, episodios y revisiones existentes.                                                                                                                                                           |
| UX y accesibilidad          | Teclado, foco de diálogo, cancelar sin petición, labels/errores asociados, estados anunciados y texto además de color. Revisar 1440×900, 768×1024 y 390×844 con navegador y limitaciones registrados.                                                                                                                                                      |
| Rendimiento local           | Perfil declarado de consulta/pantalla con historial de más de 100 versiones: 50 muestras calientes secuenciales y 50 a concurrencia cuatro; conservar frías, errores y datos crudos separados. Medir p95 frente a <3 s sin atribuir rendimiento remoto.                                                                                                    |

El arnés de señales ya prueba reglas nuevas sobre historia persistida; extender
solo la unión que falta con UI. Un administrador no debe consultar episodios
para satisfacer esta prueba. Mantener los tests de independencia de IA y las
fronteras SIG existentes; no cambiar hechos para forzar una señal esperada.

### Integración con los comandos reales

Usar Node/npm fijados por `package.json` y `scripts/use-node.ps1`. No instalar
dependencias adicionales previstas para este corte. Verificar el destino LAB
TEST antes de comandos que preparen bases o servicios.

| Momento                        | Comandos existentes para la futura implementación                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contrato/API                   | `npm run openapi`; `npm run test -w @alunza/api -- --runTestsByPath src/rules/rule-versions.controller.spec.ts src/rules/rule-versions.service.spec.ts` |
| Web y comprobaciones estáticas | `npm run test -w @alunza/web`; `npm run typecheck`; `npm run lint`; formato de los archivos cambiados                                                   |
| Persistencia/HTTP              | `npm run test:integration` —incluye preparación de TEST y controles SQL; extender las suites existentes de reglas/señales—                              |
| Flujo de navegador             | `npm run test:e2e` con el nuevo spec incorporado                                                                                                        |
| Candidato final                | `npm run ci:verify`, conservando los 17 pasos y los tres gates SUBMIT consecutivos                                                                      |

Estos comandos **no fueron ejecutados para esta planificación**. Los focos
sirven para corregir; la CI final verifica un candidato estable y conserva
fallos anteriores. No repetir suites aprobadas sin cambios o dudas que lo justifiquen.

Nuevo archivo previsto: `tests/e2e/signal-rules.cy.ts`, con identificadores
propios, por ejemplo `IMP05-RULES-01…`, sin reutilizar `IMP05-01…04` de progreso.
Actualizar **ambos** inventarios de casos/conteos en `cypress.config.cjs` y
`scripts/e2e.mjs`, y la expresión extractora de IDs en `cypress.config.cjs`
para que reconozca el nuevo prefijo y no registre `UNKNOWN`, además de
`tests/e2e/README.md`. La CI ya ejecuta el E2E completo;
no hace falta otra etapa duplicada. Un foco `--rules` es opcional y hoy no existe:
si se añade, implementar también su selección/allowlist en
`scripts/cypress-run.mjs`, reporte y comprobación de casos obligatorios.

## Cierre y continuidad

- [x] Endpoint efectivo y contratos estrictos implementados, con RLS/permisos y migración aditiva verificados.
- [x] Pantalla real de consulta, creación y activación; manejo de vacío, archivo, conflictos y respuesta incierta.
- [x] HU-026 E1–E4 demostrados en UI/API/datos y cambio de regla observado por el motor TEST, sin reescribir historia.
- [x] Trazabilidad de versiones visible y auditoría atómica/única comprobada, sin ampliar RF-027.
- [x] Revisión accesible y perfil de rendimiento documentados con resultados reales.
- [x] CI completa del candidato estable aprobada; nuevos E2E incluidos en inventarios y reportes.
- [x] Registro de implementación con candidato, comandos, resultados, defectos y límites; diccionario, API/OpenAPI, plan y matriz de control actualizados según lo realmente logrado.

Actualizar solo las referencias de estado que afecten este corte, incluida la
descripción de OpenAPI que todavía presenta evaluadores/episodios como
pendientes. Conservar registros históricos y distinguir pruebas locales,
validación remota y aceptación humana. .06 no cierra toda IMP-05.

**Primera acción al iniciar desarrollo:** fijar el DTO de efectivas y sus casos
vacío/parcial/completo, activa fuera de primera página y concurrencia; después
implementar la lectura aditiva de servidor. Azure OpenAI y Vercel Sandbox no
bloquean ese trabajo local. No se asignan fechas/esfuerzo sin capacidad del equipo.

**Verificación de este plan:** inspección estática del árbol y lectura del
reporte CI anterior; Prettier aprobó el formato del documento, los nueve enlaces
relativos existen y el plan de fase enlaza este archivo. `git diff --check`
aprobó la ruta del plan de fase. No se ejecutaron migraciones, suites de producto,
despliegues ni llamadas a proveedores para redactarlo.
