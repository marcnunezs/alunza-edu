# IMP-06.06 — Exportación administrativa de auditoría

Complementa [visor .05](IMP-06-audit-read-dictionary.md) y OpenAPI generado. No modifica eventos históricos, pruebas ocultas, progreso ni diagnósticos.

## Rutas

Base `/api/v1/organizations/{orgId}/audit-exports`:

| Operación                                            | Resultado                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| POST base + Idempotency-Key `[A-Za-z0-9_.:-]{8,128}` | 201 `{data,requestId}` únicamente READY durable; replay conserva identidad y bytes. |
| GET `/{exportId}`                                    | 200 metadatos READY, solo solicitante con permiso actual.                           |
| GET `/{exportId}/content`                            | 200 buffer CSV completo; ticket durable, no URL pública.                            |
| HEAD `/{exportId}/content`                           | Cabeceras sin contenido ni ticket de entrega.                                       |

Todas rechazan parámetros de consulta desconocidos; POST admite `asOf` obligatorio y opcionales `from`, `actorId`, `action`, `entityType`, `entityId`, sin cursor/limit. Fechas inclusivas, UTC normalizado con microsegundos, corte no futuro; texto exacto y UUID normalizado. Orden `occurred_at DESC, id ASC`; selección confirmada al generar, no congelación retroactiva de la página del visor. Se excluyen únicamente eventos de la propia exportación por entidad/id.

Metadatos: `state: READY, exportId, organizationId, filters, snapshotAt, generatedAt, expiresAt, rowCount, byteLength, sha256, fileName, downloadPath, formatVersion: audit-csv-v1`. Nombre `auditoria-{organizationId}-{exportId}.csv`, ruta interna exacta. Metadatos JSON separados. `expiresAt` es exactamente 24 horas posterior a `generatedAt`; un instante de acceso ≥ `expiresAt` devuelve 410 aunque la purga eventual aún no ocurra.

| Código                                                              | HTTP        | Semántica                                                                                                    |
| ------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| INVALID_REQUEST                                                     | 400         | Falta clave válida; sin reserva.                                                                             |
| VALIDATION_FAILED                                                   | 422         | Filtros/corte inválidos; sin reserva.                                                                        |
| AUDIT_EXPORT_LIMIT_EXCEEDED                                         | 422         | Más de 10.000 filas o 10.485.760 bytes finales; FAILED durable, sin CSV parcial.                             |
| REQUEST_IN_PROGRESS                                                 | 409         | Misma clave RUNNING o consulta de metadatos RUNNING; `Retry-After: 1`.                                       |
| IDEMPOTENCY_CONFLICT                                                | 409         | Misma clave y payload distinto; no reutilizarla.                                                             |
| RATE_LIMITED                                                        | 429         | Generación activa para actor/org o dos operaciones CSV locales; `Retry-After: 60`.                           |
| AUDIT_EXPORT_FAILED / AUDIT_EXPORT_INTERRUPTED                      | 503         | Fallo terminal / lease vencido ya conciliado; `retryable: false`, nueva solicitud deliberada usa otra clave. |
| AUDIT_EXPORT_EXPIRED                                                | 410         | Disponibilidad terminada; no regenerar con la misma clave.                                                   |
| PERSISTENCE_UNAVAILABLE                                             | 503         | Estado incierto, `retryable: true`; conservar clave y reconciliar.                                           |
| UNAUTHENTICATED / ACCOUNT_INACTIVE / FORBIDDEN / RESOURCE_NOT_FOUND | 401/403/404 | Permiso actual insuficiente; recurso de otro solicitante/organización no se revela.                          |

La consulta de metadatos de RUNNING devuelve siempre 409, incluso si su lease ya venció. La lectura no cambia el estado ni anticipa un fallo terminal. La repetición de la reserva, la finalización interna de fallo o el mantenimiento confirman la transición durable a FAILED/INTERRUPTED.

## CSV e integridad

Cabeceras exactas: `event_id,occurred_at,actor_id,action,entity_type,entity_id,organization_id,outcome`. Se mantienen las ocho proyecciones públicas, sin safe_changes, emails, tokens, correlación interna ni contenido pedagógico. Vacío válido: BOM + cabecera + CRLF, `rowCount: 0`.

UTF-8 BOM, separador coma, CRLF, campos citados, comillas duplicadas. Timestamp UTC conserva seis decimales. Null es campo vacío. Controles Unicode Cc/Cf salvo CR/LF se escapan como secuencia visible `\uXXXX`. Si el primer carácter tras espacios/controles es `=`, `+`, `-`, `@` o su equivalente de ancho completo, anteponer `texto: `. Es una transformación de exportación, no actualización del evento original. Verificación independiente de parser y Excel se registra por ejecución; no se afirma compatibilidad con todas las aplicaciones o futuras reconversiones de archivos.

GET content verifica hash y tamaño completos, vuelve a autorizar y crea ticket PENDING antes de bytes. Cabeceras `Content-Type: text/csv; charset=utf-8`, longitud, disposición fija, no-store y nosniff. El navegador verifica longitud/hash antes de producir Blob; no usa navegación pública ni descarga parcialmente válida.

## Persistencia, eventos y conciliación

Reserva RUNNING con actor/org/key/opciones/requested_at durable, token y lease de 30 s. Esa fila registra la solicitud; no se inventa un evento histórico REQUESTED. Una captura SQL admite hasta 10.001 filas: el máximo de 10.000 filas de datos más una fila adicional para detectar exceso, que no se descarta para entregar un CSV parcial. Persiste `snapshotAt` y conteo para validar la finalización. Serialización fuera de transacción; finish reautoriza, exige token/lease/snapshot/conteo y confirma READY y evento de generación atómicos. Respuesta COMMIT perdida consulta el estado durable antes de proponer fallo. No reanuda automáticamente una generación interrumpida.

Eventos append-only de entidad AUDIT_EXPORT: GENERATED/SUCCEEDED, FAILED/FAILED, EXPIRED/EXPIRED y DOWNLOADED con resultado FINISHED/ABORTED/UNKNOWN; nombres completos con prefijo `AUDIT_EXPORT_`. El ticket de cada GET termina una sola vez, incluso si finish/close llegan juntos. El terminal usa token interno y no requiere sesión aún activa; no habilita lectura. FINISHED significa respuesta terminada por el servidor. Pérdida de callback deja PENDING hasta conciliación UNKNOWN después de 5 min.

Mantenimiento acotado al arranque y cada 60 s con SKIP LOCKED: hasta 100 de cada categoría. Bytes caducados se retiran; metadatos mínimos permanecen para idempotencia/evidencia. No hay Storage/queue, aumento de timeouts generales ni base64 en operation_keys. Los logs operativos `audit.export` contienen únicamente contexto seguro y ruta normalizada; organización solo después de autorización/proyección válida. Su emisión no acredita retención centralizada.
