# IMP-03: integración local de VM por ejecución con la API

Fecha: 2026-11-17. Implementación local autorizada; la medición física del recorrido HTTP y la aceptación integral se registran en el expediente de campaña. Este documento no acredita una nueva ejecución física.

NestJS conserva la única API de dominio. El proveedor `local-vm` es una opción explícita para `ENVIRONMENT=local|test`; se rechaza en evaluación, preproducción y producción. No modifica AD-ARQ-001, el proveedor Vercel productivo, las cuotas existentes ni el runner/imagen `.13` congelados.

## Configuración y autoridad

Además de la configuración habitual de API, requiere estas variables completas:

| Variable                                | Valor requerido                      |
| --------------------------------------- | ------------------------------------ |
| `PRACTICE_RUNNER_PROVIDER`              | `local-vm`                           |
| `PRACTICE_LOCAL_VM_SOCKET`              | Ruta absoluta de socket Unix privado |
| `PRACTICE_LOCAL_VM_HOST_ID`             | UUID estable de instalación          |
| `PRACTICE_LOCAL_VM_KIT_MANIFEST_SHA256` | SHA-256 del manifiesto del kit       |
| `PRACTICE_LOCAL_VM_GUEST_SHA256`        | SHA-256 del transporte huésped       |
| `PRACTICE_LOCAL_VM_IMAGE`               | Imagen exacta `sha256:…`             |

La versión de runner es `imp-03-quickjs.13`; la de broker, `local-vm-broker-v1`. La generación UUID se descubre por `/inspect` y queda fijada en la admisión. El cliente requiere Linux, socket y directorio del mismo UID, sin acceso de grupo/otros ni redirección por enlaces. El broker no recibe credenciales DB/Auth.

## Flujo durable

1. La autorización y admisión existentes conservan permisos vigentes, cuotas e idempotencia. En la misma transacción se registra `app_private.local_vm_resources` en estado `PREPARED`, con identidad, organización/clase y contexto inmutable.
2. `begin_local_vm_creation` verifica el lease y registra `UNKNOWN`, SHA-256 del JSON exacto de entrada y plazos. Este commit precede cualquier petición de preparación al broker.
3. `/prepare` reserva identidad sin VM ni código. La API confirma el UUID de recurso y vuelve a verificar la autoridad antes del único `/start`, que lleva la entrada completa del intento. Una ejecución con ocho casos produce una VM, con las cápsulas internas del runner.
4. El cliente valida el resultado privado completo, correlaciones, casos visibles/ocultos, presupuestos decrecientes, watchdog v2, límites leaf y envolvente observada. Después solicita `/cleanup` y persiste prueba correlacionada de QEMU y overlays ausentes.
5. Los repositorios originales finalizan RUN o persisten resultado, intento, código y eventos de SUBMIT. La proyección pública no incluye pruebas ocultas, evidencia de VM ni metadatos del supervisor.

`local_vm_resources` usa `execution_id`, `creation_id`, `provider_resource_id` (UUID de arranque), `context`, `creation_state`, `cleanup_state`, `input_sha256`, plazos y `cleanup_proof`. No almacena código, pruebas ni secretos. RLS forzada, grants y funciones internas impiden el acceso directo del navegador o rol ordinario de API. Un booleano de limpieza por sí solo no permite completar la reserva.

Los plazos siguen siendo 30 s de operación, 40 s incluyendo retiro y lease/TTL de 60 s. La VM conserva 1 vCPU/2 GiB; cada cápsula, memoria agregada de 128 MiB y pids32; el intento completo conserva 3000 ms y 65536 bytes. La reserva preventiva del watchdog `.13` no concede tiempo adicional. La representación UTF-8 puede diferir del contador raw; ese contador no aumenta.

## Pérdidas de respuesta y recuperación

Si se pierde la respuesta de `/start`, se consulta `/status` una vez dentro del mismo lease, después de comprobar autoridad. No se repite `/start`. Ante incertidumbre, la limpieza permanece pendiente y la reserva sigue ocupada.

Los reconciliadores existentes solo retiran recursos. `/cleanup` acepta el contexto admitido y produce una lápida durable aun si `/prepare` nunca llegó, impidiendo una preparación tardía. El resultado SUBMIT ya staged se conserva; una caída anterior a stage puede concluir con `UNKNOWN/FAILED` operativo. Este incremento no recupera automáticamente el resultado completo del broker después de reiniciar la API ni inventa un resultado exitoso.

## Medición y verificación

`ENVIRONMENT=test` y `ALUNZA_TEST_SUBMIT_TIMINGS=1` habilitan diagnósticos privados de ambos flujos. RUN emite `TEST_RUN_TIMING`, fuente `run`, con requestId/executionId, fase fija, duración monotónica y estado. Las fases son autorización inicial, inspección, admisión, ejecución, limpieza de respaldo, finalización, autorización final y total. SUBMIT conserva su observador existente. `ALUNZA_TEST_SUBMIT_CONTINUOUS_DIAGNOSTICS=1` añade anclajes de reloj; no se registran código, tests ni tokens.

La aceptación de latencia usa HTTP completo hasta el último byte. Las fases ayudan a explicar costos y no reemplazan ese reloj. Las pruebas unitarias usan I/O falsos y no ejecutan código estudiantil en el anfitrión. Las nuevas pruebas SQL están en `supabase/tests/025_practice_local_vm.test.sql`; requieren ejecución en la DB local autorizada. La migración aditiva es `20261117230000_practice_local_vm.sql`.

El broker y el transporte huésped se encuentran en `infra/runner/linux-vm/`; su preparación y campaña física son pasos separados. Ninguna prueba unitaria acredita KVM, aislamiento físico, recuperación tras SIGKILL ni la meta de 5 s.

Verificación local de este incremento: build y typecheck de API, lint focal y siete suites Jest (146/146) pasan. El validador compilado también aceptó, sin modificar archivos, `response` y `cleanup` de los recibos físicos `transport-smoke-RUN.json` y `transport-smoke-SUBMIT.json` del expediente privado `physical-api-13-20261117`: ocho casos y runtime 694.13897/731.1700240000001 ms, respectivamente. Se reconstruyeron suite y código del smoke; este contraste no verifica el hash histórico de entrada porque sus requestId/exerciseVersionId no constan en esos recibos. Las 25 suites SQL reales en Lenovo pasaron (1701 aserciones, 37 nuevas de SQL025). En Ryzen, la campaña con API/Auth/PostgreSQL reales aprobó 40/40 normales y nueve gates: 20 RUN8 con p95 HTTP de 4597,111313 ms y 20 SUBMIT8 con p95 de 4389,107517 ms; creó 47 VMs nuevas. Un gate adicional creó una VM y aprobó recuperación del resultado TIMEOUT staged tras SIGKILL de la API, nuevo proceso con admisiones deshabilitadas, misma ejecución/boot/prueba de retiro, un intento, dos replays idénticos y nueva clave rechazada sin VM. Los cinco adversariales de transporte también pasaron el validador compilado nativo. El perfil HTTP es caliente, secuencial y loopback, con una VM nueva por admisión efectiva y límites intactos; no acepta navegador, concurrencia ni RNF remoto, ni modifica AD-ARQ-001 o el uso opt-in local/test. Véase el [expediente físico](IMP-03-api-fisica-13.md).
