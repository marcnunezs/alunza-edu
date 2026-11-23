# IMP-04: intento, ayuda y reintento en Linux físico

Fecha: 18/11/2026. Estado: validación local física aprobada; servicios retirados.

Alcance autorizado: revalidar en el Ryzen el intento persistido, ayuda con
fuentes o degradación y un nuevo intento, conservando límites y evidencia.
Sin despliegue ni contratación. RF-010/012/013, HU-012/013 E1–E4,
RNF-CON-01–03 y RNF-IA-01–04 orientan esta comprobación.

La API, Auth, PostgreSQL, Storage, pgvector y VM del ejecutor `.13` son reales.
Embeddings, generación y verificación usan los puertos TEST explícitos; esta
campaña no acredita Azure, calidad pedagógica, calibración ni p95 remoto.

El perfil separado H01–H03 aprobó **3/3 pruebas Cypress**, sin omisiones ni
reintentos automáticos, desde Chrome 157 en Lenovo contra el Ryzen. Cada perfil
usó un estudiante distinto y dos SUBMIT sobre una suite de ocho casos: primero
incorrecto, después correcto. Se observaron seis intentos y seis VM nuevas;
esto no equivale a afirmar 48 comprobaciones individuales observadas.

| Caso | Ayuda y evidencia comprobada                                                                                                                              | Resultado |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| H01  | SUPPORTED; fuente, versión, fragmento y descarga desde navegador; reapertura y ACK repetido sin evento duplicado; reintento SUCCESS nuevo                 | PASS      |
| H02  | Clase nueva sin corpus: NO_EVIDENCE, sin fuente ni pista inventada, sin consumir nivel; borrador conservado y reintento nuevo                             | PASS      |
| H03  | Fallo de generación acotado al intento: PROVIDER_UNAVAILABLE; replay sin nueva llamada; recuperación con nueva clave y pista 1 SUPPORTED; reintento nuevo | PASS      |

SQL independiente confirmó código, resultado privado y los eventos
`ATTEMPT_SUBMITTED`/`EXECUTION_COMPLETED` ya confirmados antes de pedir ayuda.
La API TEST volvió a comprobar su persistencia antes de cada fase de proveedor:
**nueve observaciones**, distribuidas 3 + 1 + 2 + 3. Excluyen los embeddings de
ingestión. Los snapshots completos de los seis intentos conservaron sus hashes
durante ayuda y reintento hasta el cierre.

La recuperación no alteró el diagnóstico `FAILED_TEST` original. Cada reintento
creó intento y ejecución distintos, con `SUCCESS`. Se verificaron referencias
y bytes/hash reales en H01/H03; la descarga desde navegador se ejercitó en H01.
Los rechazos de intento inexistente, otro estudiante, docente y administrador,
y de un diagnóstico agregado por el cliente, no admitieron solicitud, operación
idempotente ni llamada de ayuda. El contexto preparado contenía exclusivamente
las dos pruebas visibles y no incluía identificadores de pruebas ocultas.

La generación fallida quedó `DISPATCHED`, sin recibo de éxito inventado; su
solicitud terminó `SUCCEEDED` con degradación. No es una ayuda pendiente.

Los fixtures son aditivos y propios. No se alteran fechas para liberar cuotas,
no se resembran servicios ni se amplían los límites o plazos existentes. Al
finalizar se conservaron intentos y fuentes históricas y se cerraron mediante
API los tres ámbitos propios de la corrida aprobada. Los dos ámbitos parciales
de la corrida fallida también se archivaron. El cierre no borra Storage; no se
efectuó otra descarga de los bytes después del archivado.

## Implementación e identidad

Se añadieron el contrato, control privado y lanzador `scripts/linux-vm-help-*.mjs`,
el entrypoint TEST y fixture `tests/integration/linux-vm-help-*`, el perfil
`tests/e2e/physical-help` y cuatro archivos de pruebas de preproducción.
El control escucha solo en loopback y exige clave privada y acciones cerradas.
Los fallos se limitan a campaña/intento, con caducidad; no hay ruta de producto
para elegirlos. El observador de persistencia usa una conexión independiente
de solo lectura; la API mantiene su rol no privilegiado.

Se reutilizaron los compilados `.13`: 316 fuentes locales coincidieron con el
artefacto medido y **2211 archivos compilados conservaron sus hashes**. Digest
del inventario compilado:
`6265c0f75412b7b71375de91279406171496828e8e453d6844a4a08dbd5de699`.
El ejecutor, kernel, discos base y límites permanecen iguales. Se añadió al
directorio del artefacto únicamente el auxiliar documental que faltaba,
`infra/materials/extractor.mjs`, con SHA-256
`5dda2ed02ff748a75e39c42f7557927c7fbfdabbffaa3b67543d440416f8c644`.
Es una completitud del empaquetado; no se sustituyó ningún archivo existente
ni se recompiló la aplicación. Su extracción supervisada de TXT pasó.

## Fallos conservados y verificación

Los dos primeros arranques del arnés no llegaron a disponibilidad. Se corrigió
la guarda de `evaluation.enabled` y la carga de auxiliares TEST desde el nuevo
arnés; se añadieron etapas de arranque con errores redactados y regresiones que
usan la configuración real.

`browser-01` falló: H01 agotó tres intentos de ingestión con
`EXTRACTION_UNAVAILABLE` porque faltaba el auxiliar; H02 encontró texto duplicado
por encadenar `clear().type()` en el editor controlado. El cierre incompleto hizo
que H03 se omitiera. Esa corrida creó **cero intentos y cero VM**. Se corrigió
el empaquetado y se consultó de nuevo el editor entre borrado/escritura, usando
las comprobaciones existentes. No se cambió el producto ni se amplió un plazo.

`browser-02`, campaña `592a68aa-633d-4112-870a-8ab9e2f2d371`, aprobó los tres
escenarios en unos 52 s totales de spec. Esa duración no es una medida de
latencia del producto ni una afirmación de p95.

La suite general final aprobó **56/56 suites y 1135/1135 pruebas**. La primera
ejecución conserva un timeout de 5000 ms en `sandbox-campaign-prepare`; su foco
aprobó 22/22 y la repetición general pasó sin modificar el límite o aserciones.
Pasaron ESLint/formato de los once archivos JS/TS nuevos y TypeScript E2E.

## Conservación y cierre

- Intentos: **94 → 100**; resultados privados: 94 → 100; eventos: 188 → 200.
- Recursos de ejecución: **179 → 185**, todos retirados; cero pendientes,
  activos o inciertos y cero procesos QEMU. Scratch vacío.
- Cuatro solicitudes y cuatro ayudas persistidas, dos referencias públicas,
  nueve fases contabilizadas y seis eventos de ayuda.
- Todos los registros anteriores de once tablas conservaron sus hashes;
  ambos respaldos físicos anteriores conservaron tamaño y SHA-256.
- API, web, controles, broker, túnel y cinco servicios detenidos. Configuración,
  montajes, red y políticas de reinicio conservados. Sin señales forzadas.
  PostgREST mantuvo el 255 esperado de su binario fijado, con la evidencia
  específica del procedimiento de apagado; los otros cuatro servicios dieron 0.

El respaldo verificó sus **52 miembros** tanto en Ryzen como en Lenovo:
206397 bytes, SHA-256
`11eca0ea257a4ce9b794b5502b90ec7ef9d9c38a851dd037f234f97d14765dc8`.
Incluye corridas fallida/aprobada, observaciones, inventarios, cierre y fuentes
del arnés; excluye runtime privado y credenciales. Los logs locales de ambas
ejecuciones generales y de Cypress se conservaron.

Expediente privado nuevo: `.local/preproduction/imp-04/physical-help-13-20261118`;
en el Ryzen: `/home/alunza/laboratorio/physical-help-13-20261118`.

Entradas principales: `browser-02/summary.json`, `control-02/control-events.jsonl`,
`provider-observations-02.jsonl`, `data-after.json`, `final-preservation.json`,
`service-stop-result.json` y `backup-lenovo-verification.json`.
El archivo final es `evidence-final.tar.gz`.

## Alcance pendiente

Esta comprobación usa documentos TXT sintéticos y proveedores TEST explícitos;
no acepta Azure, calidad pedagógica, calibración, otros formatos, concurrencia,
los seis diagnósticos completos, latencia remota, CI integral ni aceptación humana.
AD-ARQ-001 no cambia. No hubo despliegue, contratación, llamadas pagadas,
ampliación de límites ni migración/resembrado. El siguiente paso de IMP-04 sigue
siendo la evaluación y calibración del proveedor real y la aceptación pedagógica,
con sus autorizaciones y gates propios.

[Procedimiento del perfil](../guides/validacion-local-ayuda-13.md).
