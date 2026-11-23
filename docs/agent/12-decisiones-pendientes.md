# Tratamiento de decisiones pendientes

Usa esta guía cuando un spec marque Propuesta técnica/Pendiente o cuando código, API, datos y UX no coincidan. El registro de autoridad es [specs/00](../../specs/00-fuentes-y-decisiones.md); este archivo indica cómo trabajar con él y no cambia el estado de sus decisiones.

Consulta también el [estado actual](../estado-actual.md) y el último registro
del área. Un corte histórico conserva lo pendiente en su fecha; no revoca
resoluciones posteriores ni exige pedir de nuevo una autorización vigente.
Separar autoridad de producto, implementación, prueba local y aceptación humana
evita confundir una decisión resuelta con una validación todavía pendiente.

## Decide con evidencia y dentro del alcance

1. Identifica el requisito y el texto que originan la duda. Comprueba la solicitud actual y autorizaciones anteriores antes de interpretar que hace falta una nueva confirmación.
2. Determina si se trata de un detalle técnico reversible, una validación empírica o una elección que cambia alcance, permisos, significado pedagógico o efectos externos.
3. Para detalles reversibles dentro de lo solicitado, elige la alternativa más simple compatible con los specs, registra el supuesto y prueba sus consecuencias. No conviertas esta elección en «aprobación del equipo».
4. Para una validación empírica, prepara y ejecuta el ensayo permitido. Usa el resultado para completar la decisión técnica; una pregunta al usuario no sustituye medir compatibilidad, integridad o tiempos.
5. Si una elección relevante no puede inferirse de la autoridad existente, deja lista una propuesta concreta con alternativas e impacto. Solicita solo la información que falta y continúa las partes independientes. No habilites el comportamiento dependiente como si estuviera aceptado.
6. Actualiza el registro de decisión y los contratos afectados cuando exista resolución real. Una implementación provisional debe indicar el supuesto en tarea/pruebas y conservar pendiente la aceptación dependiente.

No solicites permiso solo porque una tabla dice «pendiente». Tampoco uses una hipótesis de desarrollo para inventar un superadministrador, ampliar visibilidad, desplegar públicamente, gastar presupuesto o alterar una regla de aprendizaje. Las instrucciones explícitas actuales del usuario prevalecen sobre guías de proyecto, dentro de las políticas y permisos del entorno.

## Acciones por DEC

| DEC | Qué debes resolver o probar | Trabajo que puede avanzar | Qué no debes dar por cerrado |
| --- | --- | --- | --- |
| DEC-001 Ámbito administrativo, resuelta para IMP-01 | Aplicar permiso técnico explícito de un uso, creador ADMIN, un rol por organización e identidad/correo global con estado local; verificar los contratos y rechazos resultantes | Gobierno institucional e invitaciones de 72 horas conforme a la resolución del usuario, con protección del último admin y archivo administrativo de lectura | Pruebas o aceptación por documentar la decisión; permiso global por ser ADMIN; acceso docente implícito; dependencias académicas futuras sin verificar |
| DEC-002 Publicación e historial | Aplicar decisiones de IMP-02 y resolución SUBMIT del 26/09/2026: admitidos antes del cierre pueden persistir después; posteriores se rechazan | Implementación y pruebas de carreras, preservación histórica y autorización vigente, dentro del encargo de desarrollo | Implementación o pruebas por documentar la decisión; reapertura o admisión posterior al cierre |
| DEC-003 Límites y clasificación | Demostrar límites totales de proceso, unidades y protección de tests; fijar precedencia y motivos de terminación | Puerto de ejecutor, harness, pruebas adversarias locales y prototipo autorizado | 128 MB solo por limitar heap; séptimo diagnóstico; Docker como prueba de aislamiento productivo |
| DEC-004 Contratos y trabajos | Concretar DTO, HTTP, fechas, idempotencia, transacciones, leases y plazos | Contratos tipados, migraciones locales revisadas, integración por incrementos | API y BD con significado distinto; 202 sin trabajo durable; 201 de intento no persistido |
| DEC-005 Semántica de señales, D1–D5 resueltas | Aplicar eventos/progreso y D1–D5 aprobadas el 05/10/2026; conservar contratos y cierre técnico local transversal .08 | Reutilizar versiones, evaluadores, episodios y consultas ya implementados; continuar únicamente dentro del alcance autorizado | Reabrir semántica aprobada; IA clasificando al alumno; RF-019 público por existir soporte interno; aceptación humana o remota atribuida al PASS local |
| DEC-006 Diccionario y MER | Contrastar diccionario actual, FK, versiones y mappings con ERS; registrar revisión técnica previa al esquema definitivo | DDL/prototipos locales reversibles, revisión cruzada y pruebas de restricciones | RAR/DMD importado como esquema vigente; migración compartida que codifica una decisión de dominio no resuelta |
| DEC-007 Compatibilidad | Verificar versiones exactas, generador, módulos, Jest, CLI y motor real; fijar lockfile | Ensayo de instalación/build/CI y elección rutinaria de patch compatible | Cambiar familia de stack o herramientas aprobadas porque el generador prefiera otras |
| DEC-008 Región y rendimiento | Definir perfil/muestra y medir recorridos desde Chile, región/costo/límites | Instrumentación, carga local y preparación del ensayo remoto | p95 productivo a partir de mocks o tiempo de proceso solamente; región «óptima» sin medición |
| DEC-009 Datos reales y recuperación | Definir retención, eliminación, recuperación, residencia y responsabilidades institucionales | Demo ficticia, minimización, exportación segura y restauración aislada | Cumplimiento legal inventado, datos reales sin condiciones acordadas, RPO/RTO o SLA no medido |
| DEC-010 Configuración IA | Verificar deployment/modelo, tokenizer, dimensión, umbral, pistas, timeout y fallback | Interfaces, schema, corpus ficticio, evaluación local y generación real cuando esté autorizada | Dimensiones supuestas, modelo sustituido, niveles de pista aprobados sin evidencia o cita solo por existir un ID |
| DEC-011 Dependencias y capacidad | Separar capacidades en ciclos del backlog y explicitar trabajo/freeze pendiente | Orden técnico IMP propuesto, entregas parciales honestas y estimación del trabajo restante | Retirar Must, reasignar fechas/puntos o afirmar acuerdos humanos para dar por cerrado el sprint |
| DEC-012 Demo | Fijar distribución, IDs, reloj, fixtures y reset seguro manteniendo cantidades | Seed ficticio reproducible y variaciones de permisos dentro de conteos | Demo pregrabada presentada como proveedor en vivo; cuenta/organización extra para eludir un negativo |

## Casos que suelen confundirse

**DEC-001 resuelta para IMP-01:** no volver a solicitar el permiso de aprovisionamiento ni las reglas de identidad ya confirmadas por el usuario. El operador técnico concede a una identidad ACTIVE un permiso consumible para crear una organización, cuyo primer ADMIN es el creador. Una identidad puede tener varias membresías, cada una con un rol; deshabilitar una no deshabilita Auth ni las demás. Las invitaciones duran 72 horas y el reenvío invalida el enlace anterior. Se permite archivar si el único miembro ACTIVE es el ADMIN ejecutor y no existen otras dependencias activas ni invitaciones pendientes; conserva su membresía para consulta administrativa del archivo. La resolución se registra en [specs/00](../../specs/00-fuentes-y-decisiones.md) y se concreta en el [diccionario IMP-01](../work/IMP-01-dictionary.md). No implica aceptación académica ni cierra DEC-004/006 para módulos futuros.

**Fechas resueltas en IMP-02:** cursos y clases usan `startDate/endDate`
civiles nullable, sin hora, conforme al [contrato ejecutable](../../packages/contracts/src/academic.ts)
y la [resolución del 23/09/2026](../../specs/00-fuentes-y-decisiones.md).
No volver a elegir entre fecha e instante ni recuperar los nombres propuestos
`startsAt/endsAt`. Las ventanas `opensAt/closesAt` de actividad son instantes
UTC presentados en la zona de la organización; `publishedAt/closedAt` registran
transiciones y conservan un significado distinto.

**Envío y cierre:** distingue confirmación del estudiante, admisión por servidor y confirmación durable. El usuario resolvió la carrera SUBMIT el 26/09/2026: permite terminar y guardar un envío admitido antes del cierre; nuevas admisiones posteriores se rechazan. Serializa admisión/cierre y exige autorización vigente para entregar o consultar. No vuelvas a solicitar esta decisión. El usuario autorizó implementar el plan; su estado y pruebas se registran en [IMP-03.04–03.06](../work/IMP-03-submissions.md).

**Visibilidad histórica:** archivar una entidad no equivale a borrar evidencia. Si el spec deja ambiguo el acceso operativo a una versión ya publicada, prepara ambos casos de aceptación y una política aislada, sin ampliar acceso por omisión.

**Parámetros de tamaño:** IMP-04 concreta 10 MB de archivo como 10.000.000 bytes. El ejecutor ya fija 128 MiB y 64 KiB en DEC-003; no volver a pedir esas unidades. Centraliza los bytes elegidos y prueba frontera inferior/exacta/superior. El presupuesto independiente del extractor documental no modifica los límites del proceso estudiantil ni del Sandbox.

**Modelos IA:** el proveedor inicial está decidido; el deployment concreto no. Verifica qué ofrece el ambiente autorizado y evalúa compatibilidad. Falta de credenciales no permite elegir en secreto otro proveedor o afirmar que un doble es integración real.

## Estado actual de DEC-005

D1–D5 y la resolución previa de eventos/progreso continúan vigentes, sin nueva
ratificación. La implementación avanzó desde el corte del 05/10 hasta el cierre
técnico local IMP-05.08: versiones, evaluadores, persistencia/recuperación,
administración de reglas, progreso, tablero y consulta histórica están
verificados según el [registro .08](../work/IMP-05-acceptance.md) y la
[matriz](../work/IMP-05-acceptance-matrix.md). Sus límites distinguen fixtures
temporales, cálculo puro, recorridos reales TEST y pruebas operacionales.

La revisión pública RF-019 y el detalle integral RF-017 siguen en IMP-06;
CAPSTONE, validación remota y los demás pendientes del
[estado actual](../estado-actual.md) conservan su alcance. Resolver la semántica
no acreditó pruebas en 2026-10-05; las pruebas posteriores tampoco sustituyen
aceptación docente ni autorizan comenzar otra fase.

## Registro y cortes históricos

Los siguientes cortes conservan decisiones, autorizaciones y límites de su
momento. Para trabajo nuevo, combínalos con el estado vigente anterior y el
último registro del módulo.

**DEC-005, IMP-05.01–05.02:** resuelta parcialmente por instrucción del usuario
el 02/10/2026 para eventos, lectura explícita de fallback, deduplicación,
orden por confirmación/secuencia y progreso por concepto al corte. No volver
a solicitar esas decisiones. Las ventanas, firma de error, comparabilidad,
estancamiento y episodios fueron resueltos por D1–D5 el 05/10/2026. Contrato y evidencia
en [diccionario](../work/IMP-05-progress-dictionary.md) y
[registro](../work/IMP-05-progress.md); la preparación remota es independiente.

**DEC-005 D1–D5, corte histórico del 05/10/2026:** Marcelo aprobó la propuesta completa después de
explicitar diagnóstico grueso, estancamiento sin ventana adicional y posibilidad
de otro ACTIVE con evidencia vigente al cambiar regla; luego autorizó comenzar
IMP-05.03. La [decisión y copia del artefacto](../work/DEC-005-2026-10-05.md)
registra autoridad de producto, SHA-256 y referencia Library. No pedir otra
ratificación de D1–D5. En aquel corte, .03 concretaba versiones inmutables y
activación inmediata serializada/auditada; .04–.05, UI de gobierno, tablero y
revisión seguían pendientes.
La decisión no sustituye pruebas ni aceptación docente/CAPSTONE. Usar
[spec 14](../../specs/14-progreso-y-senales.md),
[diccionario .03](../work/IMP-05-signal-rules-dictionary.md) y
[registro .03](../work/IMP-05-rules.md) para contrato y estado comprobado.

**DEC-004/006/010, corte IMP-04.01–04.03:** el usuario autorizó materiales con
activación automática al completar una generación y reemplazo mediante nueva
versión. Conserva el ámbito inicial y las reglas de gobierno; ocultar no reasigna
material. El primer procesamiento fija el perfil de embeddings del ambiente y
una configuración incompatible se rechaza, sin sustitución silenciosa de
proveedor. Los contratos, diccionario, límites y evidencia están en el
[registro de materiales](../work/IMP-04-materials.md). No volver a pedir decisiones
ya acordadas; distingue configuración técnica local de llamada Azure real,
evaluación pedagógica y aceptación humana pendientes. IMP-03.07 no bloquea
ingestión local; continúa pendiente antes de producción.

**DEC-002/004/006, corte IMP-02:** las políticas de contenido/editor fueron confirmadas por el usuario el 23/09/2026 y están registradas en [fuentes y decisiones](../../specs/00-fuentes-y-decisiones.md) y [contrato IMP-02](../work/IMP-02-content.md). No volver a pedir confirmación sobre habilitación docente por curso, código colectivo, archivo, ventanas, versiones o retención local ya fijados. La regla SUBMIT/cierre se resolvió el 26/09/2026 según el apartado anterior; sus contratos de persistencia/recuperación están implementados y su evidencia y pendientes se registran en [IMP-03.04–03.06](../work/IMP-03-submissions.md). Los módulos posteriores conservan sus decisiones y comprobaciones pendientes.

Usa la [plantilla de decisión](14-plantillas-de-trabajo.md). Identifica origen, alternativa elegida, estado, evidencia, dependencias y quién decidió realmente. Registra «supuesto técnico de implementación» si corresponde; solo usa «aprobado» cuando exista tal aprobación.

Cuando una decisión se resuelva, actualiza DTO/modelo/UI/pruebas y la documentación afectada de forma conjunta. Mantén historial de versiones ya usadas por intentos, reglas y fuentes. Si no está resuelta, documenta qué aceptación sigue pendiente y cuál es la siguiente acción concreta, evitando una lista genérica de preguntas que detenga todo el desarrollo.
