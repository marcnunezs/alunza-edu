# Tratamiento de decisiones pendientes

Usa esta guía cuando un spec marque Propuesta técnica/Pendiente o cuando código, API, datos y UX no coincidan. El registro de autoridad es [specs/00](../../specs/00-fuentes-y-decisiones.md); este archivo indica cómo trabajar con él y no cambia el estado de sus decisiones.

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
| DEC-002 Publicación e historial | Precisar historial CLOSED, admisión concurrente al cierre, disponibilidad por fechas y efecto del archivo del banco | Máquina de estados, preservación histórica, tests de carrera bajo propuesta explícita y flujos sin ambigüedad | Reapertura, envío posterior al cierre o bloqueo de ejercicios publicados decidido silenciosamente |
| DEC-003 Límites y clasificación | Demostrar límites totales de proceso, unidades y protección de tests; fijar precedencia y motivos de terminación | Puerto de ejecutor, harness, pruebas adversarias locales y prototipo autorizado | 128 MB solo por limitar heap; séptimo diagnóstico; Docker como prueba de aislamiento productivo |
| DEC-004 Contratos y trabajos | Concretar DTO, HTTP, fechas, idempotencia, transacciones, leases y plazos | Contratos tipados, migraciones locales revisadas, integración por incrementos | API y BD con significado distinto; 202 sin trabajo durable; 201 de intento no persistido |
| DEC-005 Semántica de señales | Fijar eventos elegibles, ventanas, empates, comparabilidad, firma de error y episodio | Funciones puras, reloj inyectado, fixtures de frontera y propuesta SQL con evidencia | Umbrales ocultos, IA clasificando al alumno, interpretación propuesta atribuida a aceptación docente |
| DEC-006 Diccionario y MER | Contrastar diccionario actual, FK, versiones y mappings con ERS; registrar revisión técnica previa al esquema definitivo | DDL/prototipos locales reversibles, revisión cruzada y pruebas de restricciones | RAR/DMD importado como esquema vigente; migración compartida que codifica una decisión de dominio no resuelta |
| DEC-007 Compatibilidad | Verificar versiones exactas, generador, módulos, Jest, CLI y motor real; fijar lockfile | Ensayo de instalación/build/CI y elección rutinaria de patch compatible | Cambiar familia de stack o herramientas aprobadas porque el generador prefiera otras |
| DEC-008 Región y rendimiento | Definir perfil/muestra y medir recorridos desde Chile, región/costo/límites | Instrumentación, carga local y preparación del ensayo remoto | p95 productivo a partir de mocks o tiempo de proceso solamente; región «óptima» sin medición |
| DEC-009 Datos reales y recuperación | Definir retención, eliminación, recuperación, residencia y responsabilidades institucionales | Demo ficticia, minimización, exportación segura y restauración aislada | Cumplimiento legal inventado, datos reales sin condiciones acordadas, RPO/RTO o SLA no medido |
| DEC-010 Configuración IA | Verificar deployment/modelo, tokenizer, dimensión, umbral, pistas, timeout y fallback | Interfaces, schema, corpus ficticio, evaluación local y generación real cuando esté autorizada | Dimensiones supuestas, modelo sustituido, niveles de pista aprobados sin evidencia o cita solo por existir un ID |
| DEC-011 Dependencias y capacidad | Separar capacidades en ciclos del backlog y explicitar trabajo/freeze pendiente | Orden técnico IMP propuesto, entregas parciales honestas y estimación del trabajo restante | Retirar Must, reasignar fechas/puntos o afirmar acuerdos humanos para dar por cerrado el sprint |
| DEC-012 Demo | Fijar distribución, IDs, reloj, fixtures y reset seguro manteniendo cantidades | Seed ficticio reproducible y variaciones de permisos dentro de conteos | Demo pregrabada presentada como proveedor en vivo; cuenta/organización extra para eludir un negativo |

## Casos que suelen confundirse

**DEC-001 resuelta para IMP-01:** no volver a solicitar el permiso de aprovisionamiento ni las reglas de identidad ya confirmadas por el usuario. El operador técnico concede a una identidad ACTIVE un permiso consumible para crear una organización, cuyo primer ADMIN es el creador. Una identidad puede tener varias membresías, cada una con un rol; deshabilitar una no deshabilita Auth ni las demás. Las invitaciones duran 72 horas y el reenvío invalida el enlace anterior. Se permite archivar si el único miembro ACTIVE es el ADMIN ejecutor y no existen otras dependencias activas ni invitaciones pendientes; conserva su membresía para consulta administrativa del archivo. La resolución se registra en [specs/00](../../specs/00-fuentes-y-decisiones.md) y se concreta en el [diccionario IMP-01](../work/IMP-01-dictionary.md). No implica aceptación académica ni cierra DEC-004/006 para módulos futuros.

**Fechas:** el contrato propuesto de clases menciona `startsAt/endsAt` y el modelo conserva fechas académicas. Determina si la institución necesita fecha o instante y alinea nombres, tipo, zona y pruebas. `opensAt/closesAt` de actividad y `publishedAt/closedAt` de transición son conceptos distintos.

**Envío y cierre:** distingue confirmación del estudiante, admisión por servidor y confirmación durable. La propuesta permite terminar un envío admitido antes del cierre; solicitudes admitidas después se rechazan. Mantén pendiente la decisión de esa carrera hasta resolver DEC-002, sin mezclar eventos en la prueba.

**Visibilidad histórica:** archivar una entidad no equivale a borrar evidencia. Si el spec deja ambiguo el acceso operativo a una versión ya publicada, prepara ambos casos de aceptación y una política aislada, sin ampliar acceso por omisión.

**Parámetros de tamaño:** el archivo de 10 MB, el proceso de 128 MB y la salida de 64 KB tienen unidades propuestas a confirmar. Centraliza los bytes elegidos y prueba frontera inferior/exacta/superior. No cambies el número contractual para hacer pasar un test.

**Modelos IA:** el proveedor inicial está decidido; el deployment concreto no. Verifica qué ofrece el ambiente autorizado y evalúa compatibilidad. Falta de credenciales no permite elegir en secreto otro proveedor o afirmar que un doble es integración real.

## Registro y cierre

**DEC-002/004/006, corte IMP-02:** las políticas de contenido/editor fueron confirmadas por el usuario el 23/09/2026 y están registradas en [fuentes y decisiones](../../specs/00-fuentes-y-decisiones.md) y [contrato IMP-02](../work/IMP-02-content.md). No volver a pedir confirmación sobre habilitación docente por curso, código colectivo, archivo, ventanas, versiones o retención local ya fijados. La admisión concurrente de SUBMIT y los módulos posteriores conservan sus pendientes.

Usa la [plantilla de decisión](14-plantillas-de-trabajo.md). Identifica origen, alternativa elegida, estado, evidencia, dependencias y quién decidió realmente. Registra «supuesto técnico de implementación» si corresponde; solo usa «aprobado» cuando exista tal aprobación.

Cuando una decisión se resuelva, actualiza DTO/modelo/UI/pruebas y la documentación afectada de forma conjunta. Mantén historial de versiones ya usadas por intentos, reglas y fuentes. Si no está resuelta, documenta qué aceptación sigue pendiente y cuál es la siguiente acción concreta, evitando una lista genérica de preguntas que detenga todo el desarrollo.
