# IMP-06.07 — Plan autorizado del ciclo de consolidación

Autorizado el 03/11/2026 (Santiago). Base `1d8d7ac`; rama `codex/imp-06-07-integration`. El usuario eligió análisis offline acotado de .04 y continuar .07 focal aunque aquel resultado sea inconcluso. La autorización posterior permite restablecimientos necesarios; se limita su uso al entorno o recursos propios de pruebas y se conserva la evidencia.

## Resultado y límites

Implementar y verificar funcionalmente IMP-06.07, manteniendo la aceptación integral bloqueada mientras .04 siga pendiente. Sin capturas nuevas, PHASE, ON/OFF, ABBA, CI completa, proveedores externos, push ni despliegue. Los contadores .04 permanecen 9/17 y 0/1. Sandbox, Azure y fases IMP-07/08 quedan fuera. No cambiar API pública, permisos, reglas o contratos CSV para adaptar las pruebas.

## Investigación .04

Paquete privado nuevo `resumption-15`: fijar originales, manifiestos, controles, muestras y hashes antes/después. Primero pruebas negativas y congelación del lector; después una lectura de cabeceras del secundario. Emitir agregados de proveedor/forma/CPU/QPC, sin payloads, PID/TID, nombres ni comandos. La procedencia y el papel requieren fuentes verificables; ni nombre ni ventana temporal bastan.

| Lectura máxima                       | Eventos                             | Tiempo externo | Salida  |
| ------------------------------------ | ----------------------------------- | -------------- | ------- |
| Secundario nativo                    | 10.000, 32 proveedores y 128 formas | 10 s           | 256 KiB |
| Principal nativo, condicionado       | 20 millones                         | 90 s           | 1 MiB   |
| Principal administrado, condicionado | 20 millones                         | 90 s           | 1 MiB   |

Cero reintentos y aumentos de límites; cinco segundos de limpieza de procesos propios. Las lecturas principales mantienen 60 s internos y solo proceden si se acredita el secundario. Reutilizar TraceEvent 3.2.8 fijado mediante un wrapper limitado a cabeceras. Mantener pérdidas, modo, finalización, reloj, concordancia entre lectores y cobertura de las 24 muestras/siete etapas. Una cobertura temporal válida no acredita causalidad, autocoste, neutralidad ni cierre .04.

Negativos: entradas ausentes/adicionales/duplicadas/redirigidas, hashes, procedencia insuficiente, secundario relevante, lectura parcial, límites, pérdidas, reloj/modo/formas incompatibles y desacuerdo de lectores. Una parada impide iniciar la etapa siguiente.

## Verificación .07

Un nuevo harness parte del tablero vacío: tres fallos HTTP/Docker reales sobre la misma asignación, regla REPEATED_ERROR de tres intentos/14 días activada por API, ingestión/ayuda TEST con presentación y ACK, evaluación real de la señal. Cada caso posee un ámbito independiente y relaciona sus propios IDs; los preparadores históricos y sus datos de capacidad conservan su significado.

Seis casos `IMP06-PHASE-01`–`06`, enlazados en la [matriz](IMP-06-governance-phase-matrix.md): evidencia/revisión; gobierno/historia/CSV; rechazos/vacíos; permisos/revocación; concurrencia; recuperación/exportación privada. Las escrituras auditadas se producen mediante operaciones públicas. La historia inmutable y los deltas permitidos se verifican por separado. Visor/CSV se comparan con filtros/corte comunes y escritores detenidos, respetando las confirmaciones tardías admitidas por .06.

Teclado, foco, Escape y mensajes; capturas 1440×900, 768×1024 y 390×844. Sin atribuir WCAG completa. Fronteras exhaustivas existentes mantienen su cobertura focal; los datos sintéticos de capacidad nunca acreditan la historia del recorrido.

## Inventarios y aceptación

Inventario compartido vigente: 125 casos/18 specs; contextual congelado: 69/10, mismo orden. Conservar cortes históricos. Actualizar metadatos CI a .07 y preparar allowlist de cinco informes saneados IMP-06, sin publicar evidencia privada. Mantener las 17 etapas y tres SUBMIT consecutivos, sin ejecutar CI durante este ciclo.

Comandos nuevos: `test:imp06:integration`, `test:e2e -- --governance-phase` y `test:imp06:acceptance -- --since <ISO-UTC>`. El agregador exige evidencia posterior al corte, los 16 escenarios, las seis identidades y las mismas fuentes antes/después/actuales. No ejecuta suites ni promueve la aceptación integral; funcional aprobado con .04 pendiente produce estado bloqueado y código 2. Fallas o evidencia insuficiente producen código 1.

Orden: negativos offline y lecturas permitidas; formato/lint/tipos/unidades/builds; HTTP; Cypress; regresiones afectadas; agregación. Serializar TEST y lecturas intensivas. Conservar fallos, corregir su causa y repetir solo lo justificado. Entregar registro, matriz, diagnóstico, índices y commit local revisado; excluir Office y `next-env.d.ts` previos, secretos y evidencia privada.
