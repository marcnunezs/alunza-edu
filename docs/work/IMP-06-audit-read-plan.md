# IMP-06.05 — Plan autorizado del visor de auditoría

El usuario autorizó implementar el plan propuesto el 02/11/2026. Alcance exclusivo: consulta administrativa RF/HU/CU/PT-027, E1–E3 en su parte de lectura. CSV (.06), aceptación integrada (.07) e investigación/campañas detenidas de .04 permanecen separados.

## Decisiones

- Reutilizar `app.audit_events` append-only sin backfill ni nueva tabla de auditoría.
- ADMIN con perfil, sesión y membresía vigentes, también lectura de organización archivada conforme a DEC-001.
- El usuario eligió **orden estable**, no conjunto congelado. Corte temporal y keyset sin duplicados; confirmaciones tardías pueden cambiar el conteo o aparecer después del cursor. Actualizar inicia un corte nuevo.
- Ocho campos operativos, sin `safe_changes`, nombres/correos, código, ayuda, pruebas ni correlaciones internas.
- Consultas y denegaciones emiten evento operativo separado a stdout mediante el registro HTTP existente; no se insertan en el conjunto consultado. La emisión no acredita retención remota.

## Entregas

Migración aditiva, lectura SQL autorizada, controlador/servicio NestJS, contratos Zod/OpenAPI y pantalla UX-19 con filtros y recuperación. El [diccionario](IMP-06-audit-read-dictionary.md) concreta DEC-004/006.

## Verificación acordada

Contratos/unidades; HTTP y SQL con roles reales; upgrade .04→.05; Cypress focal `--audit` con ocho escenarios, teclado y tres tamaños; rendimiento de API y pantalla con 10.000 eventos A/1.000 B, primera muestra separada y 50 muestras secuenciales por superficie, p95 <3000 ms y cero errores. Conservar resultados fallidos y repetir solo tras cambios o diagnóstico justificado.

Usar runtime portable y LAB TEST aislado; preservar DEV y cambios previos. Ejecutar tipos, lint, formato, build y suites unitarias/contratos. No ejecutar `ci:verify`, PHASE, ON/OFF o ABBA como consecuencia de este incremento. El [registro](IMP-06-audit-read.md) distingue pruebas reales y pendientes.
