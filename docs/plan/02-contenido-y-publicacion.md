# IMP-02 — Estructura académica, contenido y publicación

**Implementación del corte contenido/editor:** el usuario confirmó el plan el 23/09/2026 para completar seis RF nuevos y revalidar tres institucionales (meta 9/27). Las políticas elegidas, contratos, resultados y pendientes están en [el registro IMP-02](../work/IMP-02-content.md). RF-005/007/024 siguen parciales; cierre frente a SUBMIT, progreso y gobierno completo de banco pertenecen a los incrementos posteriores. Este documento conserva el plan original y no sustituye la evidencia ejecutada.

Estado al 23/09/2026: **corte de contenido/editor implementado y verificado localmente**, con nueve RF acumulados y RF-005/007/024 parciales. El resto de este documento conserva el plan original en ocho incrementos; su alcance completo y la aceptación humana permanecen separados del cierre local documentado en [IMP-02](../work/IMP-02-content.md). Conserva la secuencia IMP del [plan del agente](../agent/01-plan-de-implementacion.md) y la autoridad de [fuentes y decisiones](../../specs/00-fuentes-y-decisiones.md).

## Objetivo y demostración de salida

Construir el recorrido administrador → profesor → estudiante: el administrador configura curso, asignación docente y conceptos; el profesor prepara una clase, sus ejercicios y una actividad; un estudiante se incorpora y abre el contenido publicado en un editor que conserva su borrador local. La información proviene de API y persistencia reales y mantiene las versiones utilizadas.

La demostración debe permitir crear una actividad con dos ejercicios, publicarla, entrar con un estudiante autorizado, comprobar su orden y editar una plantilla viendo solo pruebas visibles. Al recargar se recupera el borrador de esa cuenta y asignación. Una segunda identidad sin permiso no obtiene el contenido mediante navegación ni API. El cierre cambia el estado y la disponibilidad según DEC-002. La ejecución y el envío se integran en IMP-03; este recorrido no muestra resultados, intentos ni porcentajes simulados.

## Entradas, dependencias y decisiones

Se necesita IMP-01 operativo: sesión, identidad verificada, estados, pertenencia institucional, controles por rol, contexto transaccional para RLS y auditoría mínima. El administrador y profesor utilizados deben tener permisos reales de su organización. Si una capacidad de aprovisionamiento de IMP-01 continúa pendiente, documentar el límite y usar los ámbitos ficticios ya autorizados para avanzar.

Leer [requisitos](../../specs/02-requisitos-funcionales.md), [escenarios](../../specs/03-flujos-y-criterios-de-aceptacion.md), [UX](../../specs/04-ux-y-accesibilidad.md), [modelo de datos](../../specs/06-modelo-de-datos.md), [API](../../specs/07-api-y-contratos.md) y las guías de [backend](../agent/03-backend-y-api.md), [datos](../agent/04-datos-y-migraciones.md), [frontend](../agent/05-frontend-y-ux.md) y [seguridad](../agent/09-seguridad-y-permisos.md).

| Entrada o decisión | Trabajo concreto antes de depender de ella | Límite de aceptación |
| --- | --- | --- |
| DEC-001: rol y ámbito | Reutilizar permisos institucionales y la asignación docente explícita de IMP-01. | `ADMIN` no publica ni obtiene evidencia pedagógica por su rol de gobierno; no se crean combinaciones de rol implícitas. |
| DEC-002: disponibilidad, cierre y archivo | Preparar una política única de disponibilidad/admisión con casos antes, durante y después del cierre; registrar tratamiento del banco archivado y del historial. | No habilitar reapertura ni decidir silenciosamente si archivar retira una versión de una actividad vigente. Mantener pendiente la aceptación afectada hasta su resolución. |
| DEC-004: contratos | Alinear fechas académicas de curso/clase, instantes de actividad, paginación, errores, ETag y mutaciones con la API. | No mezclar `date` con medianoche UTC; resolver `startDate/endDate` frente a `startsAt/endsAt` antes del schema ejecutable. |
| DEC-006: diccionario | Revisar entidades, relaciones, unicidad, pruebas privadas y versiones antes de consolidar migraciones. | DDL provisional y ensayo local no equivalen a modelo aprobado ni autorizan migración compartida. |
| Contrato de ejercicios y DEC-003 | Fijar formato de entrada/salida, comparadores permitidos y validación de límites junto con el trabajo del ejecutor. | Validar una definición no demuestra aún aislamiento ni cumplimiento físico de 128 MB/3 s/64 KB. |
| Decisiones UX y catálogos | Documentar normalización de conceptos, dificultad, estado de clase, vigencia/revocación del código y retención del borrador. Ensayar accesibilidad del editor elegido. | No reutilizar enums de actividad para clases ni presentar elecciones propuestas como aprobadas. |
| DEC-012: fixtures | Ampliar los datos ficticios con estructura y contenido manteniendo IDs y distribución acordados. | Fixtures adversariales separados del conjunto canónico; los seis documentos se incorporan en la fase de materiales. |

Los detalles técnicos reversibles pueden resolverse y registrarse dentro de la autorización de la fase. Una decisión de permisos o significado de producto requiere una propuesta concreta y su resolución; mientras tanto avanzan los incrementos independientes, conforme a [decisiones pendientes](../agent/12-decisiones-pendientes.md).

## Cobertura funcional

La fase es el cierre principal de siete RF y prepara dos dependencias posteriores. Cada RF conserva HU, CU y PT del mismo número. Los escenarios indicados son los originales de [specs/03](../../specs/03-flujos-y-criterios-de-aceptacion.md), no escenarios nuevos del plan.

| Requisito | Resultado de la fase | Escenarios de fuente |
| --- | --- | --- |
| ALZ-RF-002 | Crear/configurar clase y mecanismo de incorporación. | ALZ-HU-002-E1 a E4; ALZ-CU-002; ALZ-PT-002. |
| ALZ-RF-003 | Inscripción válida, inválida, ajena, vencida y duplicada. | ALZ-HU-003-E1 a E4; ALZ-CU-003; ALZ-PT-003. |
| ALZ-RF-004 | Definición íntegra de ejercicio, conceptos, versiones, pruebas y límites. | ALZ-HU-004-E1 a E4; ALZ-CU-004; ALZ-PT-004. |
| ALZ-RF-005 | Composición, publicación, cierre y política de admisión. La prueba completa cierre/envío se integra con IMP-03. | ALZ-HU-005-E1 a E4; ALZ-CU-005; ALZ-PT-005. |
| ALZ-RF-008 | Contenido autorizado, pruebas visibles y editor con borrador local. | ALZ-HU-008-E1 a E4; ALZ-CU-008; ALZ-PT-008. |
| ALZ-RF-022 | Gobierno de cursos/clases y asignación de profesor activo de la organización. | ALZ-HU-022-E1 a E4; ALZ-CU-022; ALZ-PT-022. |
| ALZ-RF-023 | Taxonomía única, acíclica y versionada; archivo conserva referencias. | ALZ-HU-023-E1 a E4; ALZ-CU-023; ALZ-PT-023. |
| ALZ-RF-007, parcial | Lista/detalle autorizado de publicaciones y sus estados vacíos. | Preparar ALZ-HU-007-E1 a E4; el avance desde intentos reales y cierre principal corresponden a IMP-03. |
| ALZ-RF-024, base | Propiedad, visibilidad, versiones y usos persistidos desde el primer ejercicio. | Preparar conservación de versiones de ALZ-HU-024-E4; gobierno completo y cierre en IMP-06. |

Son 28 escenarios originales correspondientes a los siete RF de cierre principal. La aceptación de cada escenario exige su comportamiento completo; una parte diferida o dependiente de DEC se registra como pendiente, aunque la fase sea su responsable principal.

## Incrementos en orden de construcción

Las rutas son propuestas de ubicación; se adaptan al árbol real sin duplicar módulos ni API de negocio. Todos los incrementos están pendientes. Cada entrega incluye persistencia, API, interfaz y comprobaciones necesarias para su resultado observable.

| ID | Resultado vertical y orden | Artefactos propuestos | Comprobaciones que permiten continuar |
| --- | --- | --- | --- |
| IMP-02.01 | Un administrador crea un curso, una clase y asigna un profesor activo; recarga y recupera las relaciones. Parte de IMP-01. | `apps/api/src/academic`, pantallas UX-14 en `apps/web`, contratos académicos, migraciones/RLS. | Código duplicado, fechas incoherentes, profesor deshabilitado/ajeno y cambio sin permiso no alteran relaciones. Auditoría ligada al cambio. |
| IMP-02.02 | El profesor crea/configura su clase dentro de un curso permitido y emite o revoca un código de ingreso controlado. Reutiliza .01. | Casos de uso de clase/códigos, UX-06, `class_join_codes`, DTO de configuración. | Obligatorios, propiedad de clase, estado archivado, digest en DB, ausencia de código en logs y vigencia/revocación. El profesor no reasigna otro profesor. |
| IMP-02.03 | El estudiante confirma incorporación y ve la clase en su inicio. Reutiliza .02. | Servicio transaccional de inscripción, UX-02, restricciones de membresía y fixtures de dos organizaciones. | E1–E4 de HU-003; dos solicitudes simultáneas producen una sola membresía. Cancelar antes de confirmar no inscribe. Un código colectivo vigente admite estudiantes distintos según contrato. |
| IMP-02.04 | El administrador crea, edita y archiva conceptos con relaciones y consulta sus referencias. Puede avanzar después de IMP-01 en paralelo con .01–.03. | `apps/api/src/content` para taxonomía, UX-15, versiones de conceptos y validador de grafo. | Nombre normalizado duplicado, relación consigo mismo, ciclo indirecto y entidad ajena se rechazan; archivo/reemplazo mantiene historia. |
| IMP-02.05 | El profesor crea y recupera un ejercicio íntegro con plantilla, dificultad, conceptos, pruebas y límites. Requiere .02/.04 y contrato del ejecutor. | Banco/versiones/tests privados, UX-07, DTO públicos separados de internos, validadores de definición. | E1–E4 de HU-004; edición ajena rechazada; definición incoherente no se habilita; pruebas ocultas ausentes de proyección estudiantil. |
| IMP-02.06 | El profesor compone una actividad, ordena ejercicios, guarda borrador y publica una versión válida. Requiere .05. | `apps/api/src/activities`, UX-08, publicación transaccional, posiciones/requeridos y contratos de consulta. | Actividad vacía o fechas inválidas permanece DRAFT; publicación fija versiones/orden; rol ajeno no publica; conflicto ETag evita sobrescritura. |
| IMP-02.07 | El estudiante abre la publicación y prepara una solución con borrador local recuperable. Requiere .03/.06. | UX-03/04, editor y almacenamiento local por ámbito, proyección pública de asignación, lectura API real. | E1–E4 de HU-008 según DEC-002; fallo de borrador mantiene plantilla; cambio de cuenta no expone código anterior; teclado permite entrar/salir del editor. |
| IMP-02.08 | El profesor cierra la actividad; el recorrido completo conserva contenido/versiones y aplica bloqueos de resolución. Integra .01–.07. | Política de disponibilidad/admisión compartida, pruebas de transiciones/archivo/concurrencia y evidencia E2E de publicación. | DRAFT/PUBLISHED/CLOSED exactos; cancelación previa no cambia estado; no reapertura implícita; política rechaza admisión posterior al cierre; prueba real con SUBMIT queda vinculada a IMP-03. |

## Detalles que condicionan la implementación

### Estructura y pertenencia

Separar curso, clase y membresía; una clase referencia un curso de la misma organización. Solo el administrador asigna o reasigna profesores. El profesor administra su configuración autorizada, sin adquirir acceso a otras clases. La cuenta y membresía institucional deben seguir activas al confirmar cada mutación, incluso si el JWT fue emitido antes de una revocación.

La inscripción confirma validación de código, vigencia, uso permitido, membresía y auditoría/evento aplicable en una transacción. Un código colectivo no es automáticamente de uso único. Si la membresía ya existe, devolver la relación autorizada y permitir abrirla; si el código es ajeno, no revelar clase ni organización.

### Versiones, publicación y archivo

Crear identidad estable del ejercicio y versiones independientes desde el inicio. Fijar versiones de conceptos y pruebas, visibilidad y propietario en el modelo base de RF-024; no postergar estas relaciones hasta IMP-06. Una versión ya publicada o utilizada no se sobrescribe.

Publicar valida contenido, pruebas, conceptos, orden, requeridos y disponibilidad en la misma transacción que cambia el estado y guarda auditoría. La actividad no resuelve automáticamente «la última versión» del banco. En la interfaz, revisar y confirmar la publicación o cierre; cancelar conserva el estado. El éxito visible se muestra después de la respuesta confirmada del servidor.

Preparar el archivado de conceptos con referencias mediante tratamiento explícito: conservar historia, identificar usos activos y aplicar la política registrada. El efecto del banco archivado sobre una actividad vigente sigue DEC-002. Para el cierre, implementar una política central de admisión que IMP-03 reutilizará y probará con ejecución/persistencia reales. No declarar probado el flujo de envío a partir de un test aislado de esta política.

### Editor y contenido público

La API entrega enunciado, dificultad, límites, conceptos, plantilla y pruebas visibles de la asignación autorizada. Las pruebas ocultas se excluyen antes de serializar: no deben aparecer en JSON, HTML inicial, bundle, mapas de fuentes, logs ni mensajes de error. Renderizar enunciados y código como contenido no confiable con tratamiento seguro de Markdown.

Identificar cada borrador por cuenta, organización, clase, asignación y versión. Probar recuperación, almacenamiento no disponible y cambio de sesión; la UI no afirma haber recuperado datos cuando falló. La retención local y el tratamiento al salir se documentan. Un editor accesible permite abandonar la captura de Tab y conserva trabajo ante errores.

Las acciones de práctica, envío y ayuda solo se habilitan al integrar sus capacidades posteriores. En esta fase, la lista no usa métricas ficticias; RF-007 se cierra en IMP-03 con la proyección mínima determinista desde intentos.

## Artefactos y comprobaciones de la fase

| Entrega | Ubicación propuesta y condición |
| --- | --- |
| Modelo académico y contenido | `supabase/migrations` y `supabase/tests`: integridad institucional, unicidad, versiones, grants, RLS y privacidad de tests. |
| Dominio y API | `apps/api/src/academic`, `content`, `activities`; `packages/contracts`: DTO públicos, errores y OpenAPI sincronizados, sin lógica paralela en Next.js. |
| Experiencia | `apps/web`: UX-02/03/04/06/07/08/14/15 y estados de carga, vacío, validación, permiso, conflicto y confirmación real. |
| Fixtures | `fixtures/demo`: ampliación determinista; `tests/integration` y `tests/e2e`: variantes adversas fuera del conteo canónico. |
| Evidencia | Registro según [plantillas](../agent/14-plantillas-de-trabajo.md), con incremento, RF/PT/E, versión, entorno, esperado, observado y limitaciones. |

Aplicar Jest a reglas y servicios, integración con DB/API reales a consistencia/autorización y Cypress al recorrido por roles. Comprobar DAT-01/02/04/09/10 de [datos](../../specs/06-modelo-de-datos.md) según el alcance ya implementado. Usar el rol de aplicación sin `BYPASSRLS`, no el propietario de tablas. Verificar permisos también en listas, conteos, versiones, relaciones y rutas directas.

Las skills pertinentes se eligen del [inventario instalado](../agent/15-skills-recomendadas.md): `nestjs-best-practices`, Supabase/Postgres, Next.js, shadcn/ui y `cypress-author`/`cypress-docs` cuando corresponda. Sus ejemplos no sustituyen los contratos, permisos ni decisiones de este proyecto.

## Criterios verificables de cierre

- [ ] Los ocho incrementos tienen resultado observable y evidencia o una dependencia pendiente identificada; ninguno se declara terminado solo por tener tablas o pantallas simuladas.
- [ ] Los siete RF principales están vinculados a sus 28 escenarios originales; se identifica explícitamente la aceptación condicionada por DEC-002 y la comprobación cierre/SUBMIT de IMP-03.
- [ ] Administrador, profesor y estudiante completan sus operaciones autorizadas mediante NestJS y DB reales; `ADMIN` sin asignación docente no publica.
- [ ] Se verificaron cruce de organización, clase ajena, estado inactivo y edición sin propiedad; no se filtran recursos en errores ni proyecciones.
- [ ] Inscripción concurrente no duplica membresía; publicación es atómica y conflicto de versión conserva el estado previo.
- [ ] Cambiar conceptos o crear una versión del ejercicio no altera la referencia de una actividad publicada; archivado conserva historia conforme a la decisión vigente.
- [ ] Editor/borrador funciona, comunica fallos y no mezcla sesiones; el estudiante recibe únicamente pruebas visibles.
- [ ] Formularios, incorporación, ordenación, publicación/cierre y editor son operables por teclado; cancelar las confirmaciones no envía la mutación.
- [ ] Migraciones y fixtures de esta fase son reproducibles, y las verificaciones proporcionales de tipos, lint, build, integración y E2E registran resultados reales.
- [ ] Queda preparado el traspaso a IMP-03 con contrato de ejercicio, versiones, política de admisión y comprobaciones pendientes, sin acreditar ejecución segura antes de construirla.

## Trabajo posterior

IMP-03 incorpora ejecución aislada, envío confirmado, diagnóstico, historial, reintento y avance real de RF-007. Allí se prueba cierre concurrente con admisión, ejecución y persistencia completas. IMP-04 añade materiales y ayuda; IMP-05 completa progreso/señales; IMP-06 completa el gobierno del banco de RF-024. Ninguno de esos cierres se deduce de publicar contenido en esta fase.

## Prompt para encargar esta fase

```text
Implementa únicamente IMP-02 de docs/plan/02-contenido-y-publicacion.md.
Lee AGENTS.md, inspecciona la raíz Git y el estado real, y reutiliza IMP-00/01.
Si falta un prerrequisito, identifica la capacidad y continúa lo independiente;
no des por hecho que los documentos acreditan código o pruebas.
Trabaja los incrementos IMP-02.01 a IMP-02.08 en su orden de dependencias,
entregando persistencia, API, UI y pruebas de cada resultado vertical.
Conserva NestJS como API única, aislamiento por organización/clase, pruebas
ocultas privadas y versiones históricas. Implementa borrador local accesible.
Resuelve detalles reversibles dentro del alcance y registra DEC relevantes;
no amplíes permisos ni cierres semántica pendiente sin resolución real.
Traza los escenarios E1–E4 originales y distingue lo integrado de lo pendiente,
incluida la prueba real cierre/SUBMIT y el avance de RF-007 en IMP-03.
Al terminar informa cambios, pruebas ejecutadas, resultado de cada criterio y
el siguiente incremento pendiente. Detente al cerrar el alcance de IMP-02;
esta instrucción no autoriza implementar las fases siguientes ni desplegar.
```
