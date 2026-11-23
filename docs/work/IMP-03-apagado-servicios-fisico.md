# IMP-03: cierre ordenado de los servicios físicos locales

Fecha: 18/11/2026. Alcance autorizado: corregir el apagado de Kong y PostgREST
del laboratorio Ryzen, preservar datos y verificar su retiro. Sin despliegue,
contratación, cambios de proveedor ni ampliación de límites.

Estado: **implementado y verificado en dos ciclos físicos del candidato final**.
Servicios detenidos y respaldo verificado en Lenovo. La suite general conserva
un fallo de inventario por bytecode previo; no se declara CI integral aprobado.

Actualización posterior del 18/11/2026: la
[corrección de inventario Python](IMP-03-inventario-cache-python.md) aprobó la
suite completa de preproducción (52 suites, 1019 pruebas). Los resultados
históricos de este expediente y sus respaldos se conservan intactos.

## Alcance y aceptación

Incremento operativo de soporte a RF-009/RF-010/RF-011 y la ejecución de IMP-03.
No cambia API de dominio, reglas pedagógicas, esquema de persistencia ni el
candidato de ejecución `.13`. Conserva el plazo de cierre de 20 segundos.

- Identificar los contenedores existentes del destino TEST físico antes de
  actuar; rechazar identidades, configuración o redes diferentes.
- Cerrar Kong mediante su proceso maestro, sin depender de la propagación de
  señales del shell de entrada.
- Explicar y verificar la terminación de PostgREST con la versión efectivamente
  instalada; un código distinto de cero aislado nunca acredita cierre correcto.
- No escalar a SIGKILL. Restaurar las políticas de reinicio incluso ante fallos.
- Verificar reinicio saludable, retiro de conexiones, conservación de datos,
  contenedores, volúmenes y evidencia previa; terminar con servicios detenidos.

## Diagnóstico y mecanismo

Kong 2.8.1 arranca detrás del shell preparado por Supabase CLI. La señal de Docker
no alcanzaba al maestro Nginx y el cierre histórico terminó forzado con 137.
El comando nativo `nginx -p /usr/local/kong -c nginx.conf -s quit` alcanza al
maestro por su archivo PID; se verifica su argv antes de usarlo. Se evita
`kong quit`, cuyo comando incorpora una señal de terminación posterior al plazo.
Fuentes: [control de Nginx](https://nginx.org/en/docs/control.html) y
[Kong 2.8.1 quit](https://github.com/Kong/kong/blob/2.8.1/kong/cmd/quit.lua).

PostgREST 14.10 recibe SIGTERM directamente como PID1. El runtime observado es
GHC 9.4.8: la interrupción ejecuta la limpieza y trata de terminar mediante
SIGINT; si esa señal no finaliza el proceso, la ruta termina con 255. La
semántica especial de PID1 explica este resultado en el binario fijado. Se
conserva el código real y se exige evidencia adicional de retiro; no se convierte
cualquier 255 en éxito. Fuentes:
[PostgREST Unix](https://github.com/PostgREST/postgrest/blob/v14.10/src/PostgREST/Unix.hs),
[GHC RtsStartup](https://github.com/ghc/ghc/blob/ghc-9.4.8-release/rts/RtsStartup.c#L631-L672).

Un `stop` solicitado después de que el contenedor ya terminó no acredita la
marca interna de parada manual. Para Kong se solicita antes SIGCONT, que no
termina el proceso, mediante el camino de señales de Docker 29.1.3; PostgREST
usa ese mismo camino con SIGTERM. Se restauran las políticas originales y se
observa el estado detenido. No se ensaya reinicio del daemon ni se afirma haber
leído una marca durable interna. Fuente:
[Moby kill.go](https://github.com/moby/moby/blob/docker-v29.1.3/daemon/kill.go#L33-L103).

## Implementación

- [Control de cierre](../../scripts/local-service-stop.mjs): plan de identidad,
  preflight antes de efectos, transporte Docker Engine local acotado, señales
  fijas, observación, restauración y recibos exclusivos. PASS exige plazo total
  de 20 s, incluida restauración. Si vence, se intenta restaurar y se registra
  fallo; no se envían señales forzadas.
- [Evidencia PostgREST](../../scripts/local-postgrest-stop-evidence.mjs): imagen,
  hash ELF y RTS, generación, PID1, productores detenidos, conexiones inactivas
  antes y ausentes después. Consultas PostgreSQL de solo lectura con plazo y
  pool cerrado en errores. No imprime credenciales ni logs crudos.
- [Guía operativa](../guides/apagado-servicios-fisicos.md) y alias npm explícitos
  para el destino físico. El comando no modifica el apagado genérico de otros
  proyectos ni detiene PostgreSQL antes de verificar las conexiones.

## Ensayo físico y conservación

Ubuntu 24.04.5, Docker 29.1.3, Node 24.21.0. Se reutilizaron los mismos cinco
contenedores y sus montajes; no se recrearon ni se aplicaron migraciones o seeds.
Auth y REST respondieron 200 después de cada arranque. API, navegador, broker y
VM permanecieron detenidos durante el ensayo.

| Recibo            | Resultado           | Total, incluida restauración | Kong        | PostgREST                                    |
| ----------------- | ------------------- | ---------------------------: | ----------- | -------------------------------------------- |
| `stop-receipt-01` | Fallido, conservado |                   832,078 ms | 0, detenido | 255, detenido; consulta de evidencia fallida |
| `stop-receipt-02` | Aprobado            |                   858,817 ms | 0, detenido | 255, `expected-interrupt-255` verificado     |
| `stop-receipt-03` | Aprobado            |                   867,232 ms | 0, detenido | 255, `expected-interrupt-255` verificado     |

El primer recibo reveló que el Engine exige segundos Unix en `since/until` de
logs y eventos; las fechas ISO devolvían HTTP 500. Se corrigió el transporte y
se añadió una regresión. Los dos ciclos posteriores usaron exactamente el mismo
candidato corregido. Cada uno comprobó dos conexiones PostgREST inactivas antes
y cero después, desaparición de sus PID de backend, señal/log correlacionados,
ausencia de OOM, generación estable y políticas restauradas. Los dos tiempos
son observaciones de cierre, no percentiles de ejecución estudiantil.

Storage, Auth y PostgreSQL terminaron después con 0; su cierre y restauración
tomó 1073,690 ms. La auditoría final comprobó:

- Cinco contenedores TEST detenidos, mismas imágenes/configuración/red/montajes
  y políticas de reinicio; contenedores históricos detenidos e intactos.
- Puertos 3300, 4300, 4301, 4302, 18421 y 18422 cerrados; cero QEMU.
- Mismo contenido lógico en 79 tablas: **94 intentos y 179 registros de
  recursos, cero pendientes**. Huella antes/después:
  `56a223002b5399466e64b59cbc3708bc6ef0521a0bc654af6a30a9e2fe38999e`.
- Consulta final independiente: cero conexiones PostgREST. La huella de datos
  no sustituye ese recibo específico ni las comprobaciones por ciclo.
- Archivo de evidencia anterior sin modificaciones. No se eliminaron datos,
  contenedores ni volúmenes.

La comprobación inicial de arranque conservó un fallo por orden variable de los
montajes devueltos por Docker; la comparación corregida ordena por destino y
verifica los mismos elementos. `startup-02` confirmó salud e identidad de los
cinco servicios. No se ocultaron esos recibos ni el fallo histórico de apagado.

## Pruebas y límites

- Focos finales: **40/40 pruebas aprobadas**, con identidad ajena, cambio de
  generación, falta de evidencia, sesiones activas/restantes, señal incorrecta,
  OOM, salida inesperada, tiempo agotado y restauración fallida. Lint y formato
  de los archivos afectados aprobados.
- Suite de preproducción amplia sobre la primera revisión: **1006/1010**,
  50/52 suites aprobadas. Una falla corresponde a tres `.pyc` anteriores a este
  trabajo que el inventario excluye correctamente pero la prueba no espera.
  Los archivos se preservaron. Tres casos excedieron los 5 s al recorrer el
  checkout; su repetición aislada aprobó **3/3**, con el mismo plazo. La corrida
  amplia fallida se conserva; no se reetiqueta como aprobación integral.
- No cambian contratos, migraciones, UI ni fuentes del ejecutor `.13`; no se
  repitieron las campañas de latencia estudiantil ni se atribuyen métricas nuevas
  de producto. No se ensayó reinicio del daemon Docker, restauración desde backup
  ni drenaje de solicitudes HTTP activas. La aceptación remota y humana mantiene
  su estado anterior.

## Identidad y evidencia

Evidencia local: `.local/preproduction/imp-03-07/service-shutdown-20261118`.
Expediente físico: `/home/alunza/laboratorio/service-shutdown-20261118`.
El paquete final de fuentes es `candidate-02.tar`:

| Artefacto                        | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| Paquete candidato 02             | `4971b1a3d721c46a03010ee0f0c2b6f457dc67d4ee1caf5a0d314e8c0b5032d7` |
| Control de cierre                | `7aa54ccac0f2a5f5343e3e2927393df5806486f62e837609c2da146bd04bc2e4` |
| Evidencia PostgREST              | `b27850bd4a85a2f7af692b062d291413d8815ebb0076445eb8aad13087404a55` |
| ELF PostgREST                    | `f7934270752251bf27cb0f2cb60b3adefcde484dec3cfb0b5cd3a9deda07a62c` |
| Respaldo `evidence-final.tar.gz` | `0b9a0e9cac1bc0ecca6a32ef3ebca98ba07ca3b7bb63ceb456fd7afe2d0632fe` |
| Manifiesto del respaldo          | `3817e08436b8c52afa1909f1bd01469d205ddba2c037c8e42b3c08ccc907c074` |

El respaldo contiene 21 miembros y 52998 bytes. Se exportó por lista explícita,
excluyendo el estado privado y las credenciales, y se verificó cada miembro en
Lenovo. Incluye los candidatos 01/02 y todos los recibos de cierre, incluso el
fallido; `planSha256` dentro de un recibo identifica JSON canónico, mientras que
el manifiesto externo identifica los bytes de cada archivo.

Los resultados históricos de Kong 137/PostgREST 255 permanecen en
[el registro de navegador y capacidad](IMP-03-navegador-capacidad-13.md).
Este incremento cierra su observación operativa mediante evidencia nueva.
