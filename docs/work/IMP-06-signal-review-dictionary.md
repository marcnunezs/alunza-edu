# IMP-06.04 — Contrato de revisión docente

Estado: contrato implementado, con focos locales aprobados y cierre integral pendiente;
los resultados y límites se registran separadamente en
[el registro](IMP-06-signal-review.md). Concreta DEC-004/006 conservando DEC-005
y la decisión del usuario de revisar solo matrícula CURRENT_ACTIVE.

## API y semántica

`PUT /api/v1/signals/{id}/review`: JWT vigente, UUID, body `{}` obligatorio y
sin query. La identidad, organización y clase se derivan en servidor. No exige
If-Match ni Idempotency-Key; la revisión única por episodio es su identidad
permanente. Sin notas de revisión en este incremento.

Respuesta `200`: `{data:{signalId,classId,studentId,state,reviewedBy,
reviewedByName,reviewedAt},requestId}`. `state` es siempre REVIEWED; UUID y
fecha originales no cambian en replay. El nombre es display_name actual, nullable,
sin correo ni snapshot histórico. Instantes UTC conservan microsegundos.

La sesión, perfil/membresía TEACHER, asignación actual, organización/clase
operativas y matrícula CURRENT_ACTIVE se comprueban también al repetir.
Un recurso fuera del ámbito, organización archivada o matrícula no vigente
devuelve 404 RESOURCE_NOT_FOUND genérico. Una clase archivada dentro del ámbito
de consulta devuelve 409 ACADEMIC_ARCHIVED; no autoriza una mutación histórica.
Actividad cerrada/episodio detenido no impide revisar.

Entrada inválida: validación 422 (JSON malformado 400). Lease activo:
409 REQUEST_IN_PROGRESS con Retry-After 1. Fallo de persistencia: 503, sin
confirmación aparente. La recuperación consulta estado actual o repite el PUT
para el mismo episodio; un fallo de transporte no prueba rollback.

## Persistencia y fronteras

Se reutilizan signal_reviews, signal_episodes, snapshots, clocks, proyecciones
y audit_events. Una nueva función privada autorizada permite a alunza_app
ejecutar el caso de uso sin escritura directa de tablas ni acceso al helper
signal_review_fixture. No se vacía actor/sesión ni se relaja signal_worker_only.

La primera revisión captura base al presente, conserva testigos/evaluaciones,
aplica ACTIVE→REVIEWED, termina acumulación cuando corresponda, registra REVIEW,
sincroniza proyecciones y añade SIGNAL_REVIEWED (entidad SIGNAL) atómicamente.
Replays conservan autor/fecha y no duplican auditoría. El nombre de presentación
puede cambiar legítimamente con el perfil. No se adelanta checkpoint de cálculo.

La captura de revisión no usa continuation.targetThrough como corte. Un lease
vigente no se roba; un fallo de snapshot o auditoría revierte el conjunto.
La auditoría solo contiene referencias, transición y correlación, sin código,
evidencia pedagógica, snapshot, pruebas ocultas ni credenciales.

## Consultas y presentación

Se añade reviewedByName nullable a las proyecciones públicas de señales.
Revisión posterior a asOf mantiene ACTIVE y los tres campos de revisión null.
La respuesta PUT expresa estado vigente; no reescribe un corte histórico.
Tablero/detalle conservan filtros/corte, muestran el resultado vigente aparte
y ofrecen actualizar al presente, obteniendo nuevo corte y reiniciando cursores.

La confirmación es explícita y cancelable antes del PUT. Leer no revisa, no
crea actividad estudiantil y no llama IA. Las pruebas de los escenarios y las
limitaciones del candidato pertenecen al registro, no a este contrato.
