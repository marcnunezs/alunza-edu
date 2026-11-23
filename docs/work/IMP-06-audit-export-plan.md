# IMP-06.06 — Plan autorizado de continuación

Autorización: el usuario aprobó el plan y pidió implementarlo el 02/11/2026 (Santiago). Este ciclo termina en CSV .06 y su checkpoint local. No comprende .07, publicación, despliegue, gastos remotos ni reanudación de las campañas congeladas de .04.

## Orden y límites

1. Consolidar el estado acumulado hasta .05 en un checkpoint revisado. Excluir el Office modificado y `apps/web/next-env.d.ts`; no inventar una historia Git por incrementos. Resultado: `8161b3b`, 394 archivos, rama posterior `codex/imp-06-06-audit-export`.
2. Diagnosticar offline el inventario secundario ETL de .04 mediante evidencia ya retenida y cabeceras. Conservar originales y contador 9/17, 0/1 CI; no ProcessTrace/TDH, nueva captura, PHASE, ON/OFF, ABBA ni relajación del lector congelado. Un resultado inconcluso no bloquea CSV independiente.
3. Implementar únicamente .06: contratos, migración, API, interfaz, pruebas focales y documentación. Cerrar con commit local revisado; no push.

## Contrato acordado

- RF/HU/CU/PT-027 E1–E4; RNF-SEG-03/05, integridad y rendimiento local RNF-REN. Reutilizar visor .05 y autorización administrativa vigente.
- CSV síncrono: máximo **10.000 filas de datos / 10.485.760 bytes finales**, incluidos BOM y escapado. La captura admite hasta **10.001 filas**: 10.000 permitidas y una fila adicional para detectar el exceso. No truncar; exceso 422 terminal. Vacío entrega cabecera válida.
- Instantánea confirmada **al generar**, con `asOf` explícito aplicado del visor; una confirmación tardía puede incorporarse aunque no apareciera en la consulta anterior. Una SELECT acotada, sin paginar la exportación.
- Solo ADMIN solicitante con perfil, sesión y membresía ACTIVE actuales; permitir organización archivada. Recuperación y descarga reautorizadas; no habilitar lectura pedagógica.
- POST con Idempotency-Key, reserva durable RUNNING y lease de 30 s. Una generación por actor/organización; dos operaciones CSV simultáneas por instancia. READY solo tras persistir bytes, hash, metadatos y evento atómicos. Respuesta perdida consulta estado durable antes de fallar; FAILED conserva error y exige nueva clave para un nuevo intento deliberado. La consulta de un estado RUNNING devuelve siempre 409 REQUEST_IN_PROGRESS, incluso con lease vencido, hasta que se confirme una transición durable.
- Privados `audit_exports` y `audit_export_deliveries`, RLS y funciones limitadas. Bytes `bytea`, sin base64/JSON en operation_keys, Storage, cola ni dependencias nuevas. Disponibilidad exacta **24 horas desde generatedAt**, purga física eventual. Mantenimiento al inicio y cada 60 s; RUNNING vencido pasa a FAILED/INTERRUPTED y entrega PENDING pasa a UNKNOWN tras 5 min.
- CSV tiene ocho columnas fijas; metadatos JSON se descargan aparte. UTF-8 BOM, coma, CRLF, todas las celdas entre comillas, comillas internas dobles, null vacío, UTC con microsegundos. Controles salvo CR/LF se representan como `\uXXXX`; primer carácter significativo de fórmula (`=+-@` y variantes de ancho completo) recibe prefijo literal `texto: `. No alterar el registro original.
- Descargar solo tras verificar SHA-256/tamaño y crear ticket durable. Observar `finish`/`close` antes de enviar; único resultado FINISHED/ABORTED, independiente de posterior revocación. Un callback perdido termina UNKNOWN. Timeout HTTP 30 s; HEAD solo metadatos sin ticket. FINISHED describe el servidor, no acredita lectura humana.
- UI usa filtros aplicados; deshabilita generación con cambios pendientes/carga/error. Conserva en sessionStorage únicamente actor/organización/clave/payload para reconciliar pérdida de respuesta o recarga. Retira acceso con cambio de sesión/permisos; verifica buffer completo antes de Blob. No guarda tokens ni contenido CSV en el journal.

## Verificación prevista

Contratos y unidades (fronteras exactas, fórmulas, carreras y respuesta perdida); pgTAP con rol real/RLS; HTTP y reinicio; upgrade .05→.06 sin pérdida histórica; ocho Cypress .06 y ocho regresiones .05; parser CSV independiente y Excel instalado con fórmulas benignas. Perfil API generación/descarga y recorrido UI: primera muestra separada más 50 muestras, 10.000 A / 1.000 B, concurrencia uno, p95 < 3 s y cero errores. No equivale a aceptación remota ni CI integral.

Cambios integrados y pruebas que realmente se ejecuten se registran en [el registro](IMP-06-audit-export.md). El [diccionario](IMP-06-audit-export-dictionary.md) concreta errores, rutas y semántica.
