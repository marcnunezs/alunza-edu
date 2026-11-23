# IMP-04: preparación offline de evaluación y calibración Azure

Fecha: 18/11/2026. Alcance: preparar lo verificable localmente e identificar
entradas pendientes. No se autoriza ni ejecuta una inferencia Azure, provisión,
despliegue, contratación o aumento de límites. RF-006/010/012/013/014,
HU-012/013, CU-012/013, RNF-IA-01–04 y DEC-010 orientan este incremento.

Se reutiliza el evaluador v2 existente, con cuatro etapas, presupuestos,
procedencia de calibración y recuperación mediante journal. No se añade otro
evaluador ni se modifica la API de producto, el ejecutor `.13`, las decisiones
AD-IA-001/AD-ARQ-001, los catálogos o los límites.

## Entrega local

`npm run help:eval:prepare-local` genera un expediente nuevo y exclusivo en
`.local/eval-preparation`. Rechaza sobrescribir carpetas, salir de ese ámbito
o seguir enlaces del destino. La inspección opcional de configuración solo
lee archivos regulares del repositorio, sin enlaces ni rutas de red; publica
presencia/ausencia/placeholder, nunca valores. No prueba credenciales.

- `scripts/evaluation-readiness.mjs`: borrador v2 sin aprobación, comprobación
  de presencia, inventario SHA-256, pendientes y recibo de preparación offline.
- `scripts/evaluation-review-packet.mjs`: instantánea pura del corpus existente,
  expectativas autorales y formularios humanos vacíos.
- `tests/preproduction/evaluation-{readiness,review-packet}.test.mjs`: controles
  de no ejecución, ausencia de secretos, integridad, particiones y conservación.
- [Guía reproducible](../guides/preparacion-evaluacion-azure.md): comandos,
  entradas por completar, interpretación de evidencias y siguiente trabajo.

El expediente incluye `plan-draft.json`, `review-packet.json`, `readiness.json`,
`README.md` y `checksums.json`. El candidato se calcula al final de las ediciones
y se guarda exclusivamente en `.local`, sin autorreferencia. Las revisiones se
hacen en copias; conservar los originales. Un cambio posterior de código,
corpus o documentación requiere otra huella y expediente.

## Inventario y límites de la evidencia

El corpus `help-adversarial-1` conserva **12 documentos y 43 casos**:
18 positivos, diez inyecciones, cinco candidatos semánticos, siete rechazos
estructurales, dos negativos y una contradicción. Las etiquetas son autorales;
los candidatos no son respuestas Azure y las distancias son ilustrativas.

Los **cuatro casos de calibración son distintos de esos 43**: un positivo y un
negativo cercano por partición, con dos casos para calibrar y dos reservados
para validar. Cubren principalmente retorno de funciones. Son suficientes para
ensayar el mecanismo técnico, no para generalizar calidad pedagógica. La
rúbrica `help-rubric-1`, con seis dimensiones, permanece propuesta y sin
aceptación humana. El expediente deja en blanco identidad de revisor, fechas,
valoraciones, respuestas observadas y evidencia medida.

La calibración consumible futura es `help-evidence-2`: debe proceder de
consultas, distancias y recibos realmente registrados por el servidor, ligados
al mismo run, origen Azure, corpus y perfil. No se construye aquí un
`calibration.json`, no se elige un umbral y no se promueve TEST a Azure.

La evidencia histórica más reciente consultada del evaluador es TEST del
**01/11/2026**, run `df30ff67-a171-4f50-9098-87d4e5fc25da`: 43/43 casos,
234 muestras, 763 recibos, tres reanudaciones y cero llamadas externas.
Ambos perfiles conservan 100 ayudas. El gate de feedback visible continúa
`BLOCKED/BROWSER_RENDER_EVIDENCE_UNAVAILABLE` en ese reporte.

| Archivo histórico preservado                         | SHA-256                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| `.local/reports/imp-04/evaluation-test.json`         | `01b2d83d460aaa6e304dfe7423cf0da0d954532eabf50170568cb916b84d9855` |
| `.local/reports/imp-04/evaluation-measurements.json` | `a9bab47320ae231ab0157ab1376b6f09ae1850a0e716052920a4e98c35c91105` |

El [cierre físico del 18/11](IMP-04-ayuda-fisica-13.md) demuestra persistencia,
fuentes, degradación y reintento con servicios y KVM reales, pero proveedor TEST.
No sustituye mediciones Azure ni la evaluación de calidad. Los defectos SQL
mencionados en el corte de observabilidad de octubre ya tienen correcciones
en el código actual; esta revisión no verifica migraciones aplicadas a una base.

## Qué falta

| Frente                       | Resultado de esta inspección y pendiente concreto                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recursos/configuración Azure | El usuario confirmó que aún no tiene recursos Azure. La inspección local también encontró ausentes `.local/eval-provider.json` y `.env.local` de raíz; `apps/api/.env.local` y el proceso no contienen variables `AI_*`. Hará falta preparar y autorizar por separado el recurso y deployments, con región, modelos/versiones, dimensión, tokenizer y perfiles compatibles. No se provisiona nada en este incremento. |
| Identidad y cuota            | `az` no se encuentra en el PATH inspeccionado. No se inició login ni se validaron permisos o capacidad. Elegir el modo admitido y comprobar el acceso efectivo al recurso existente; no aumentar cuota.                                                                                                                                                                                                               |
| Coste y autorización         | Precios aplicables actuales, fecha/versión, bolsas por etapa/global y aprobación efectiva ligada al candidato. El ejemplo con precios de octubre no es cotización vigente ni autorización. El borrador deja estos campos nulos.                                                                                                                                                                                       |
| Corpus y revisión humana     | Revisar etiquetas/rúbrica con docente. Para aceptación pedagógica, ampliar cobertura representativa y conservar una partición reservada. No es una condición nueva para el piloto técnico mínimo; cualquier ampliación se versiona y se estima dentro de los topes.                                                                                                                                                   |
| Entorno                      | LAB-EVAL no admite directamente `physical-test`, y `local-vm` solo está habilitado en local/TEST. Usar el LAB-EVAL aislado existente para el piloto, o implementar por separado la compatibilidad física sin renombrar estado ni debilitar guardas. No se inició ni inspeccionó una base esta vez.                                                                                                                    |
| Latencia visible             | Falta el productor que correlacione feedback renderizado con las mismas ayudas autorizadas, run, corpus y perfil. No añadir otra carga de 200 solicitudes de forma implícita.                                                                                                                                                                                                                                         |

Se conservan 100 ayudas en serie y 100 con concurrencia cuatro, plazo de ayuda
de 15 s, objetivo documental p95 de 12 s, fragmentos de 500 tokens/solapamiento
50/top-k 5 y los límites de ejecución de 1 CPU/2 GiB, 128 MiB, 3 s y 64 KiB.
Ausencia de medición se registra como `null` o pendiente, no como coste cero,
calibración válida, p95 cumplido o aceptación docente.

## Verificación de este incremento

Compilación TypeScript de `packages/contracts` y `packages/ai`: aprobada.
Suite unitaria de IA completa: **14 suites, 378 pruebas aprobadas**; transportes
controlados, sin integración Azure. Focos existentes de evaluación más el
paquete de revisión: **ocho suites, 133 pruebas aprobadas**.

Los controles finales del preparador aprobaron **19/19 pruebas**: datos
privados no publicados, ninguna llamada a proveedores, plan sin autorización,
hashes verificables, conservación de carpetas existentes y rechazo de rutas
externas/UNC/dispositivo o enlaces antes de acceder a sus destinos. En total,
los focos de evaluación suman **nueve suites y 152 pruebas**; junto con IA,
son **530 pruebas locales aprobadas**, no la CI integral del repositorio.
Pasaron ESLint y Prettier de los archivos afectados, `git diff --check` y siete
enlaces internos de las nuevas guías. Los dos reportes históricos conservaron
los SHA-256 indicados arriba.

El cierre utiliza `.local/eval-preparation/azure-help-20261118-02` y un recibo
independiente en `.local/eval-preparation-verification/azure-help-20261118-02.json`:
ese recibo comprueba los cuatro archivos inventariados, sus once fuentes,
el fingerprint actual, los pendientes del modo `plan` y que el guard de
ejecución continúe rechazando el borrador. El recibo queda fuera del expediente
para no alterar sus checksums ni el candidato. El expediente `azure-help-20261118-01`
y su recibo PASS se conservan: se generaron antes de la confirmación del usuario
sobre ausencia de recursos; la actualización documental requiere otra huella.
No se invocaron `prepare`, `authorize`, `run`,
`resume` ni `report` del evaluador, y no se crearon intentos o materiales.

## Continuación recomendada

Como todavía no hay recursos Azure, continuar localmente con la revisión del
corpus/rúbrica y la instrumentación del navegador. Preparar después una decisión
concreta de región, modelos/deployments, compatibilidad y presupuesto; la creación
del recurso requiere autorización aparte y no está incluida aquí. Con el recurso
disponible y autorización efectiva, ejecutar el piloto técnico por etapas sobre
LAB-EVAL y medir calibración real. La instrumentación de navegador debe quedar
lista antes de usar el perfil de 200 ayudas para afirmar su p95 visible.

Preparación local no equivale a integración Azure ni aceptación pedagógica.
El [procedimiento](../guides/preparacion-evaluacion-azure.md) separa ambos hitos
y enlaza la documentación primaria consultada para completar los perfiles.
