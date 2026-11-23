# Plan autorizado IMP-06.04 — Revisión docente de señales

Fecha: 01/11/2026, America/Santiago. El usuario autorizó implementar el plan
propuesto, únicamente IMP-06.04 y ALZ-RF/HU/CU/PT-019 E1–E4. Se conservan los
cambios previos del árbol y los incrementos .01–.03.

## Decisiones y contrato

El usuario eligió **solo matrícula activa**: profesor ACTIVE actualmente
asignado, organización/clase operativas y estudiante CURRENT_ACTIVE. Alumno
retirado/deshabilitado y clase archivada conservan solo consulta histórica.
Una actividad cerrada o un episodio con acumulación terminada pueden revisarse
si el ámbito y la matrícula continúan habilitados. ADMIN no obtiene esta acción.

`PUT /api/v1/signals/{id}/review`, cuerpo `{}` estricto y sin query. Retorna
REVIEWED, identificadores de señal/clase/alumno y primer responsable/fecha.
Idempotencia permanente por episodio, sin If-Match ni Idempotency-Key
obligatorios. Cada repetición reautoriza. `reviewedByName` es la etiqueta actual
del perfil; no cambia la identidad ni fecha original. No incorpora notas,
calificación, sanción ni estados nuevos.

## Implementación

- Migración aditiva: captura actual sin usar continuación de worker, base
  inmutable, transición, proyección y auditoría efectiva única en una transacción.
  Conservar guard de worker, actor/sesión docentes, grants mínimos y RLS.
- NestJS con writeAs, DTO estricto, correlación, readiness y OpenAPI. El helper
  TEST continúa privado y no se convierte en API.
- Acción compartida en evidencia de tablero/detalle. Confirmación explícita,
  cancelación sin PUT, recuperación tras respuesta perdida y reautorización.
  Mantener asOf y mostrar resultado vigente aparte; actualizar al presente
  obtiene corte nuevo del servidor y reinicia cursores.
- No recalcular señales durante la revisión, borrar evidencia, modificar
  diagnósticos o invocar IA. Aplicar DEC-005 en procesamiento posterior.

## Verificación y cierre

Contratos/unidad, pgTAP, HTTP real E1–E4, rollback de auditoría, lease ocupado,
revocación y concurrencia; histórico, recálculo, actualización .03→.04 y datos
conservados. Dos sesiones del único docente asignado; reasignación en carrera
separada, sin introducir codocencia. Cypress integrado desde ambas pantallas,
teclado, tres tamaños, cancelación y respuesta perdida. Rendimiento de API y
confirmación visible con primeras muestras, 50 seriales y 50 con carga cuatro,
episodios distintos y errores conservados; objetivo p95 <3 s.

Ejecutar focos nuevos, regresiones de tablero/detalle y CI de 17 etapas con
tres gates SUBMIT. Congelar código y documentación durante CI; registrar
resultados y límites después, sin atribuir aceptación humana/remota.

El registro de ejecución está en [IMP-06-signal-review.md](IMP-06-signal-review.md).
El encargo no incluye .05–.07, despliegue, datos reales ni proveedores remotos.
