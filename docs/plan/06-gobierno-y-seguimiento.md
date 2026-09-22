# IMP-06 — Gobierno y seguimiento completo

Estado: **pendiente de implementación**. Esta fase contiene siete incrementos propuestos y cierra cuatro RF. Amplía capacidades previas; no posterga a esta etapa la autorización, auditoría o conservación histórica necesarias desde las primeras mutaciones. El plan no acredita pruebas, aceptación humana ni despliegue.

## Objetivo y demostración de salida

Completar dos recorridos: el profesor abre el detalle de un estudiante de su clase, comprueba la evidencia de una señal y confirma su revisión; el administrador gobierna el banco de su organización y exporta auditoría operativa filtrada. Ambos conservan permisos vigentes e historia.

La demostración usa un intento real conservado desde IMP-03, su ayuda desde IMP-04 cuando exista y una señal calculada en IMP-05. El profesor abre esos hechos desde el detalle, cancela una revisión comprobando que continúa ACTIVE, luego confirma y obtiene REVIEWED con responsable/fecha. Repetir conserva la primera revisión. El administrador crea una versión del ejercicio sin alterar la publicación ni el intento previo, aplica un cambio de gobierno permitido y descarga un CSV correspondiente al filtro visible. Una sesión ajena falla sin revelar datos.

## Entradas, dependencias y decisiones

Se requieren identidad/RLS/auditoría de IMP-01, banco versionado y estructura de IMP-02, intentos de IMP-03 y progreso/reglas/señales de IMP-05. Para cerrar RF-017 con pistas y feedback se requiere la capacidad integrada de IMP-04; su detalle técnico puede adelantarse y mantenerse parcial hasta disponer de esa evidencia. La indisponibilidad del proveedor de IA no bloquea revisión docente ni auditoría.

Leer [requisitos](../../specs/02-requisitos-funcionales.md), [escenarios](../../specs/03-flujos-y-criterios-de-aceptacion.md), [UX](../../specs/04-ux-y-accesibilidad.md), [datos](../../specs/06-modelo-de-datos.md), [API](../../specs/07-api-y-contratos.md) y [progreso/señales](../../specs/14-progreso-y-senales.md). Aplicar las guías de [backend](../agent/03-backend-y-api.md), [datos](../agent/04-datos-y-migraciones.md), [frontend](../agent/05-frontend-y-ux.md), [evidencia determinista](../agent/08-progreso-y-senales.md) y [seguridad](../agent/09-seguridad-y-permisos.md).

| Entrada o decisión | Preparación requerida | Límite de aceptación |
| --- | --- | --- |
| DEC-001 y permisos previos | Reutilizar autorización efectiva de docente de clase y administrador de gobierno. | `ADMIN` no obtiene código, pistas ni revisión de señales por gobernar la organización. |
| DEC-002: archivo e historia | Aplicar la política registrada para visibilidad histórica y efecto del archivo del banco sobre publicaciones vigentes. | Conservar referencias no concede acceso histórico permanente ni permite eliminar versiones utilizadas. |
| DEC-004: API/exportación | Fijar filtros y orden, cursores, ETag, campos del CSV, límites de filas/bytes, corte de exportación e idempotencia. | No inventar un máximo documentado ni entregar una descarga truncada como completa. |
| DEC-005: señal/episodio | Reutilizar identidad de episodio, evidencia y regla versionada de IMP-05. | Revisar no reevalúa la regla, no resuelve automáticamente un problema y no reactiva una señal ya revisada. |
| DEC-006: consistencia | Comprobar unicidad de revisión, inmutabilidad de auditoría y vínculos de versiones/usos. | Migrar y probar con rol de aplicación; una prueba como propietario no acredita aislamiento. |
| DEC-009: datos y descargas | Usar fixtures ficticios y minimización; definir configuración operativa de retención de exportaciones si son durables. | No afirmar cumplimiento legal ni autorizar datos reales por disponer de un CSV. |

Registrar decisiones según [la guía correspondiente](../agent/12-decisiones-pendientes.md). Los nombres de archivo, estructura de componentes y otros detalles reversibles no requieren detener cada incremento; los cambios de permisos o semántica pendientes sí deben quedar resueltos antes de habilitar su efecto.

## Cobertura funcional

Los cuatro RF conservan la relación HU/CU/PT del mismo número y sus 16 escenarios E1–E4 de [specs/03](../../specs/03-flujos-y-criterios-de-aceptacion.md). El plan agrega comprobaciones técnicas complementarias, sin renumerar ni reemplazar los escenarios originales.

| Requisito | Cierre previsto | Escenarios de fuente |
| --- | --- | --- |
| ALZ-RF-017 | Detalle docente con última actividad, intentos, pruebas permitidas, resultados, pistas, errores, conceptos, progreso y señales de la clase. | ALZ-HU-017-E1 a E4; ALZ-CU-017; ALZ-PT-017. |
| ALZ-RF-019 | Revisión confirmada, autorizada e idempotente; evidencia, primer responsable y fecha conservados. | ALZ-HU-019-E1 a E4; ALZ-CU-019; ALZ-PT-019. |
| ALZ-RF-024 | Gobierno completo de propiedad, versiones, visibilidad, usos y archivo del banco iniciado en IMP-02. | ALZ-HU-024-E1 a E4; ALZ-CU-024; ALZ-PT-024. |
| ALZ-RF-027 | Consulta/paginación y exportación operativa autorizada en CSV UTF-8, incluidos vacío y exceso de límite. | ALZ-HU-027-E1 a E4; ALZ-CU-027; ALZ-PT-027. |

Las regresiones de RF-004/005/008/011/014/015/016/018/023/026 comprueban que el gobierno y la revisión preservan capacidades previas. No constituyen RF nuevos ni duplican puntos del backlog.

## Incrementos en orden de construcción

Todos están pendientes. Las ubicaciones son propuestas hasta inspeccionar el código real. Cada fila termina en una operación integrada que se puede demostrar.

| ID | Resultado vertical y dependencia | Artefactos propuestos | Comprobaciones que permiten continuar |
| --- | --- | --- | --- |
| IMP-06.01 | El administrador consulta banco, propietario, conceptos, visibilidad, versiones y usos de su ámbito. Reutiliza IMP-02. | Lecturas de `apps/api/src/content`, UX-16, contratos de referencias y listados autorizados. | Paginación/conteos filtrados desde origen; banco ajeno no enumerable; lectura compartida docente no concede edición de autor. |
| IMP-06.02 | El administrador aplica cambios permitidos de propiedad/visibilidad, crea una versión o archiva conservando usos. Requiere .01 y DEC-002. | Casos de gobierno, validadores/políticas, migraciones solo si faltan restricciones, formulario y confirmaciones UX-16. | HU-024-E1 a E4; política inválida no cambia datos; ETag evita sobrescritura; actividad e intento previo mantienen versiones/pruebas/conceptos. |
| IMP-06.03 | El profesor abre un estudiante desde su clase, filtra y recorre intentos, ayuda, progreso y señales coherentes. Reutiliza IMP-03/04/05; puede avanzar junto a .01/.02. | Consulta de detalle autorizado, UX-11, enlaces a intentos y referencias con permiso vigente. | HU-017-E1 a E4; filtros inválidos y sin evidencia diferenciados; no mezcla otras clases ni expone pruebas ocultas. |
| IMP-06.04 | El profesor confirma una revisión y recibe estado, primer responsable y fecha persistidos. Requiere .03 y señales de IMP-05. | Revisión en `apps/api/src/signals`, `signal_reviews`, diálogo UX-10/11, transacción con auditoría. | HU-019-E1 a E4; cancelar no envía mutación; pérdida de acceso antes de confirmar se rechaza; dos revisores concurrentes producen una revisión. |
| IMP-06.05 | El administrador consulta auditoría por fecha, actor, acción y entidad con paginación estable. Reutiliza auditoría generada desde IMP-01. | Lecturas de `apps/api/src/audit`, UX-19, filtros/cursores y proyección allowlist. | HU-027-E1/E2/E3 en consulta; ausencia de filas distinta de falla; orden estable y permisos antes de contar/paginar. |
| IMP-06.06 | El administrador exporta el conjunto autorizado del filtro y obtiene CSV íntegro o error controlado. Requiere .05. | Servicio CSV, idempotencia y entrega privada, trabajo durable solo si el diseño lo requiere, estados UX-19. | HU-027-E1 a E4; límite, vacío, fórmulas, comillas, UTF-8, reautorización y auditoría de generación/entrega o fallo. |
| IMP-06.07 | Se demuestra el recorrido docente y administrativo completo tras edición, revisión, revocación y concurrencia. Integra .01–.06. | Fixtures, Cypress, integración DB/API, evidencias y documentación de operaciones. | Los 16 escenarios originales y regresiones relevantes; mismos datos antes/después donde deben conservarse; cero filtraciones en detalle, historial, auditoría o CSV. |

## Detalles que condicionan la implementación

### Gobierno del banco e historia

La pantalla muestra propietario, versión, conceptos, visibilidad y usos antes de confirmar cambios. Valida destino de propiedad, alcance y versión actual en el servidor; un ID recibido del formulario no prueba pertenencia ni permiso. La UI ofrece cancelación antes de aplicar cambios de acceso o archivado, y no muestra éxito si el servidor rechazó la operación.

Editar una versión referenciada produce otra versión. La actividad conserva la anterior; comparar antes/después un intento histórico debe mostrar idénticos código, diagnóstico, pruebas y conceptos utilizados. Crear una versión nueva no recalifica intentos ni modifica el denominador de una actividad publicada.

Archivar retira usos futuros según la política aprobada, conserva versiones históricas y trata las dependencias activas explícitamente. No borrar con cascadas ni resolver la ambigüedad de disponibilidad vigente por conveniencia del CRUD. Si DEC-002 sigue abierto, preparar alternativas con fixtures y dejar esa aceptación pendiente.

### Detalle docente coherente y mínimo

Resolver la relación profesor–clase–estudiante vigente antes de recuperar datos. La misma persona inscrita en dos clases no habilita al profesor a mezclar ambas. Aplicar el ámbito también a filtros, enlaces, conteos, ayudas y señales; un permiso histórico no garantiza acceso actual.

Reutilizar los cálculos deterministas de IMP-05 y el resultado canónico de IMP-03. No recalcular con otro algoritmo para la pantalla de detalle. Cada cifra presenta denominador, corte y enlace a evidencia compatible. La ausencia de intentos, filtro sin coincidencias e indisponibilidad de servicio son estados diferentes.

La vista de intentos muestra las pruebas permitidas y el resumen público de verificaciones ocultas, nunca entradas/expectativas privadas. Las referencias de ayuda se abren mediante reautorización. La falta de IA no produce pistas inventadas ni sustituye el diagnóstico técnico por otro estado. El detalle puede mostrar ayuda no disponible y seguir operando con evidencia técnica.

### Confirmación y revisión de señales

La interacción es abrir señal → revisar causa/regla/evidencia → solicitar revisión → confirmar → validar permiso vigente → confirmar transacción. Cancelar antes de enviar conserva ACTIVE y no hace request de mutación.

La transacción inserta una revisión única, aplica ACTIVE → REVIEWED y guarda auditoría efectiva. Autor y fecha vienen del contexto verificado y reloj del servidor. Repeticiones y solicitudes concurrentes devuelven el primer resultado sin sobrescribirlo; un conflicto de estado se recupera de forma controlada. Si el profesor perdió acceso antes de confirmar, se rechaza sin revelar información adicional.

Revisar conserva causa, ventana, evidencia y versión de regla. Recalcular el mismo episodio no vuelve a ACTIVE; una evidencia nueva se trata conforme a DEC-005. No agregar estados de resolución ni acciones automáticas, sanciones o mensajes al estudiante. Una revisión es evidencia de revisión humana, no una medición de mejora del aprendizaje.

### Auditoría y exportación

Reutilizar eventos append-only de las fases anteriores. Las nuevas operaciones incorporan su auditoría al mismo resultado transaccional; no reconstruir acciones históricas ficticias para llenar el visor. Solo se muestran los campos operativos autorizados. El administrador no obtiene código estudiantil mediante el visor ni mediante un CSV alternativo.

Definir en DEC-004 una semántica estable para exportar lo filtrado: alcance, columnas, orden, corte temporal, límites y relación entre todas las páginas y el CSV. La propuesta es exportar el conjunto completo del filtro a un corte identificado, no solo la página visible; validar esa elección antes de convertirla en contrato. Si supera el máximo, informar que se deben acotar filtros y no entregar un parcial como completo.

Usar allowlist de columnas de [specs/07](../../specs/07-api-y-contratos.md), alineando `outcome` público con `audit_events.result`. CSV vacío conserva encabezados, ámbito permitido y sello temporal según el formato acordado. Probar acentos, comillas, separadores y saltos de línea; neutralizar celdas que puedan interpretarse como fórmula. No exportar tokens, URLs firmadas, contraseñas, código completo, pruebas ocultas ni prompts.

Registrar solicitud y resultado de generación/entrega o fallo, sin afirmar que el usuario leyó el archivo. Evitar que el evento de la propia exportación cambie recursivamente el conjunto exportado mediante un corte definido. Si la descarga es asíncrona, usar persistencia durable, revalidar permisos al generar y entregar y servir un objeto privado; cancelar seguimiento en la UI no equivale a cancelar el trabajo. No introducir una cola nueva si la exportación acotada puede resolverse con el mecanismo ya disponible.

## Artefactos y comprobaciones de la fase

| Entrega | Ubicación propuesta y condición |
| --- | --- |
| Gobierno y consultas | `apps/api/src/content`, `progress`, `signals`, `audit`: reutilizar servicios y políticas previos, sin duplicación de cálculos. |
| Persistencia | `supabase/migrations`, `supabase/tests`: revisión única, restricciones históricas, auditoría append-only, RLS y roles efectivos. |
| Contratos | `packages/contracts` y OpenAPI: detalle, gobierno, revisión y exportación, con errores, estados y proyecciones coordinados. |
| Experiencia | `apps/web`: UX-10/11/16/19 conectadas a API real, estados recuperables, confirmaciones y contenido accesible. |
| Evidencia y operación | `tests/integration`, `tests/e2e`, fixtures reproducibles y registro de [plantillas](../agent/14-plantillas-de-trabajo.md), con resultados reales. |

Comprobar DAT-01/04/07/10 de [datos](../../specs/06-modelo-de-datos.md), SIG-13/14 de [señales](../../specs/14-progreso-y-senales.md) y los controles de aislamiento/CSV de [seguridad](../../specs/09-seguridad-y-privacidad.md). Añadir casos de revocación antes de confirmar, antes de generar y antes de entregar. Las consultas se ejecutan con rol de aplicación sin `BYPASSRLS`; probar directamente las superficies expuestas además de la UI.

Usar Jest para validadores, revisión y exportación; integración real para transacciones/RLS/concurrencia; Cypress para los recorridos de los roles. Verificar tablas, filtros, diálogos y enlaces mediante teclado, texto equivalente y estados de error; no atribuir conformidad WCAG completa a un reporte automático. Skills pertinentes: NestJS, Supabase/Postgres, frontend y Cypress del [inventario](../agent/15-skills-recomendadas.md); aplicar las de seguridad cuando la tarea incluya su revisión explícita.

## Criterios verificables de cierre

- [ ] Los siete incrementos tienen evidencia enlazada y los cuatro RF conservan sus 16 escenarios originales, con resultado individual y limitaciones.
- [ ] El profesor consulta únicamente estudiantes/evidencia de sus clases; un administrador de gobierno sin función docente no obtiene detalle pedagógico ni revisa señales.
- [ ] El detalle refleja intentos, ayuda disponible, progreso y señales reales sin duplicación por joins ni métricas simuladas; filtros inválidos, vacíos y servicio caído se distinguen.
- [ ] Cancelar revisión conserva ACTIVE; confirmar persiste REVIEWED; repetición y concurrencia mantienen una revisión, primer autor/fecha y evidencia intacta.
- [ ] Revocar acceso antes de confirmar o descargar impide la operación y no expone contenido adicional.
- [ ] Cambiar gobierno/versiones/archivo preserva publicaciones e intentos históricos; visibilidad nunca se amplía fuera de la organización.
- [ ] Visor y CSV coinciden con el ámbito, filtro y corte acordados; límite excedido, conjunto vacío y fallo de exportación tienen salidas verificables.
- [ ] CSV UTF-8 preserva formato y neutraliza fórmulas; auditoría y descargas excluyen secretos, código completo, pruebas ocultas y campos no autorizados.
- [ ] Las nuevas mutaciones y exportaciones registran evidencia operativa real sin editar o borrar eventos previos ni inventar historial.
- [ ] Tipos, lint, build y pruebas proporcionales de unidad/integración/E2E están ejecutados con resultado registrado; la revisión visual y de teclado cubre estos flujos.
- [ ] Con los mismos hechos persistidos, regla y corte, cambios de respuestas o indisponibilidad de IA no alteran progreso, señales, revisión ni diagnósticos. Eventos nuevos legítimos de ayuda se evalúan conforme a DEC-005.
- [ ] Los pendientes de DEC y la validación transversal posterior están registrados; no se presenta la fase como aceptada si falta alguno de sus comportamientos obligatorios.

## Trabajo posterior

IMP-07 completa la evaluación transversal de los 27 RF y RNF: cobertura restante, adversariales, accesibilidad, rendimiento, recuperación y defectos. Esta fase ya debe probar las capacidades que modifica; no remite sus controles esenciales a esa revisión. IMP-08 prepara entrega y reproducción por otra persona. La revisión docente del producto tampoco reemplaza firmas, aceptación o evidencias académicas reales.

## Prompt para encargar esta fase

```text
Implementa únicamente IMP-06 de docs/plan/06-gobierno-y-seguimiento.md.
Lee AGENTS.md e inspecciona el código y evidencia de las fases anteriores.
Reutiliza identidad/RLS/auditoría, banco versionado, intentos, ayuda, progreso
y señales. Identifica cualquier dependencia incompleta; continúa las partes
independientes sin presentar datos simulados como integración.
Completa IMP-06.01 a IMP-06.07 con API, persistencia, UI y pruebas reales para
ALZ-RF-017/019/024/027 y sus 16 escenarios originales E1–E4.
Conserva autorización vigente de clase, ADMIN sin acceso docente implícito,
historia inmutable y revisión ACTIVE → REVIEWED única e idempotente.
La revisión requiere confirmación en la UI; cancelar no hace mutación.
Exporta solo auditoría operativa autorizada y filtrada en CSV UTF-8 seguro,
con límites, vacío, corte, reautorización y auditoría verificables.
Resuelve detalles reversibles y registra DEC sin ampliar permisos ni asumir
aprobaciones. Informa resultados de pruebas, criterios pendientes y traspaso.
Detente al cerrar IMP-06: esta instrucción no autoriza implementar fases
posteriores, desplegar, usar datos reales ni enviar mensajes a terceros.
```
