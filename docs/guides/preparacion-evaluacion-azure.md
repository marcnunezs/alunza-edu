# Preparación local de la evaluación de ayuda con Azure

Esta guía prepara el expediente de configuración, corpus, revisión docente y
evidencia pendiente de Alunza. La preparación es offline: no inicia servicios,
no crea intentos, no consulta Azure y no autoriza gasto. Conserva los límites y
las decisiones AD-IA-001 y AD-ARQ-001. El alcance corresponde a RF-006,
RF-010/012/013/014 y sus pruebas de persistencia, fuentes, degradación y reintento.

El flujo ejecutable de evaluación ya existe. Se reutilizan su manifiesto v2 y
su modo `plan`; el expediente nuevo organiza lo que falta antes de ejecutarlo.
La operación posterior está descrita en
[IMP-04.08](../work/IMP-04-evaluation-operations.md).
El [productor de evidencia de navegador](evaluacion-ayuda-navegador.md)
está implementado y verificado en una campaña local TEST. La medición con
Azure en LAB-EVAL sigue pendiente.

## 1. Generar un expediente independiente

Desde la raíz del repositorio, en PowerShell, ejecutar una línea a la vez:

```powershell
. ./scripts/use-node.ps1
npm run help:eval:prepare-local
```

El comando ejecuta `scripts/evaluation-readiness.mjs` y crea un directorio
exclusivo bajo `.local/eval-preparation`. Conservar la ruta informada al
terminar en el campo `directory`. La salida indica `PREPARED_OFFLINE`,
`providerCalls: 0` y `authorizedForInference: false`. Una nueva preparación
produce otro expediente; no sustituye evidencias de corridas anteriores.

| Archivo                      | Uso                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan-draft.json`            | Borrador compatible con el modo `plan`, con huella del candidato actual y los datos pendientes explícitos. No es una autorización.                            |
| `review-packet.json`         | Copia identificada del corpus ficticio, casos de calibración y rúbrica para revisión. Las respuestas observadas y las revisiones humanas empiezan pendientes. |
| `teacher-corpus.md`          | Cuaderno legible con 47 fichas y los textos del corpus tratados como datos.                                                                                   |
| `teacher-design-review.json` | Plantilla para revisar diseño y etiquetas, separada de la evaluación de respuestas.                                                                           |
| `readiness.json`             | Inventario de preparación, evidencia disponible y brechas. No es un reporte de evaluación Azure.                                                              |
| `checksums.json`             | Huellas de los archivos del expediente que identifica el generador. Permiten detectar cambios posteriores.                                                    |
| `README.md`                  | Resumen y modo de uso de ese expediente concreto.                                                                                                             |

El directorio queda en `.local`, fuera de los archivos versionados. Conservar
el expediente generado como referencia y trabajar las propuestas y revisiones
en copias identificadas. Cambiar una copia no convierte las huellas del
original en evidencia de esa revisión.

Si ya existe un archivo privado de configuración del proveedor, la opción
`--provider-env` permite indicar su JSON al preparador. El informe registra
presencia, ausencia o valores de ejemplo, sin copiar sus valores ni probar
autenticación. `PRESENT_UNVERIFIED` no significa credencial válida ni recurso
disponible; esa inspección tampoco completa automáticamente el borrador.
El archivo debe estar dentro del repositorio, preferiblemente en `.local`;
se rechazan rutas de red y enlaces para conservar la preparación offline.

## 2. Consultar el plan sin ejecutar la evaluación

Sustituir `DIRECTORIO-INFORMADO` por el nombre devuelto en el paso anterior:

```powershell
$expedienteEvaluacion = '.local/eval-preparation/DIRECTORIO-INFORMADO'
npm run help:eval -- --mode plan --manifest "$expedienteEvaluacion/plan-draft.json"
```

`plan` valida la forma del descriptor y muestra los pendientes, etapas y
perfil previstos. No necesita arrancar API, base de datos o navegador. Que el
comando termine correctamente acredita un plan legible; los campos pendientes
siguen impidiendo una corrida Azure.

El nombre `prepare-local` se refiere únicamente a este expediente. En cambio,
`help:eval --mode prepare` usa Auth/API y crea datos persistidos, incluidos
intentos reales. No es el siguiente comando de esta preparación offline.
Tampoco lo son `eval:environment prepare`, `eval:serve`, `ai:probe` ni
`test:help:evaluation`.

## 3. Completar los datos pendientes

Usar información comprobable del destino que se quiera evaluar. El expediente
no inventa un recurso Azure existente ni convierte ejemplos de configuración o
precios en valores vigentes. Estos datos pueden prepararse sin entregar claves
o tokens; las credenciales se configuran después por el canal privado del
consumidor, fuera de informes y campos públicos de Next.js.

| Entrada             | Qué debe quedar identificado antes de la corrida                                                                                                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint y región   | Recurso y región concretos; `azure.baseURL` debe satisfacer el contrato del adaptador y corresponder al destino autorizado. No deducirlo de una URL de ejemplo.                                                                                                 |
| Deployments         | Nombres efectivos para embeddings, generación y revisión, ligados a las fases `EMBEDDING`, `GENERATION` y `REVIEW`.                                                                                                                                             |
| Modelo y versión    | Identidad y versión/configuración efectiva de cada fase, con sus huellas. Un nombre de deployment por sí solo no documenta el modelo que se midió.                                                                                                              |
| Dimensión           | Dimensión efectiva de embeddings compatible con el índice del destino. No reutilizar el índice TEST ni otro perfil de modelo/dimensión.                                                                                                                         |
| Tokenizer           | Identificador y versión admitidos por el código actual, ligados a los perfiles y al manifiesto. No cambiarlo para acomodar una medición.                                                                                                                        |
| Autenticación       | Modo admitido por el adaptador y permisos del consumidor sobre el destino. Registrar el modo, no el valor de una credencial.                                                                                                                                    |
| Cuota y presupuesto | Cupo disponible y reservas máximas por etapa y global, coherentes con llamadas, tokens y concurrencia del perfil. No ampliar los límites del producto ni asumir cuota a partir del presupuesto monetario.                                                       |
| Precio              | Tarifas aplicables, moneda, fecha y `priceVersion`, con estimación y tope revisables. El ejemplo de costes no acredita una cotización ni gasto realizado.                                                                                                       |
| Autorización        | Responsable, referencia y expiración reales para destino, candidato y presupuesto concretos. Reutilizar la autorización vigente si cubre esa operación; dejar pendiente lo que no esté autorizado.                                                              |
| Candidato y corpus  | Huella del candidato final, versiones de corpus, consulta, prompts y esquema, más identidad de los artefactos. Las huellas deben corresponder al código y materiales que se ejecuten.                                                                           |
| Pedagogía           | Docente revisor, pertinencia de los casos, etiquetas revisadas, criterios de la rúbrica y desacuerdos documentados. No rellenar aceptación o autoría humana en nombre de otra persona.                                                                          |
| Navegador           | Usar el productor implementado para medir la corrida Azure correspondiente; su validación local TEST no sustituye esa evidencia. Vincular acción, ayuda visible, respuesta y perfil. Los tiempos HTTP/servidor y el ACK no prueban por sí solos el renderizado. |

El manifiesto tiene un esquema estricto: no añadir campos arbitrarios para
forzarlo a aceptar información pendiente. Mantener las notas de revisión en el
expediente y concretar los campos admitidos en el descriptor de ejecución.

El cálculo actual de `candidateFingerprint` incluye documentación y archivos
nuevos no ignorados por Git. Finalizar primero los cambios de código, corpus y
guías; después fijar la huella para la futura corrida. El descriptor privado
de ejecución permanece en `.local`. Una modificación posterior requiere
comprobar de nuevo la correspondencia con el candidato y la autorización.

## 4. Revisar el corpus con un docente antes del gasto

El paquete distingue las expectativas escritas por el equipo de las respuestas
realmente observadas. Las distancias de los fixtures adversarios son
ilustrativas; no sirven para fijar un umbral de recuperación Azure.
El procedimiento para completar las 47 fichas está en
[revisión docente del corpus](revision-docente-corpus.md).

| Conjunto                | Qué representa                                                                                                | Qué no acredita                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 43 casos adversarios    | Corpus ficticio versionado para fuentes, aislamiento, inyección, revisión de candidatos y otros rechazos.     | No son 43 observaciones de calibración ni respuestas Azure aceptadas por un docente.                          |
| 4 casos de calibración  | Dos escenarios, cada uno con fuente pertinente y no pertinente; dos casos de calibración y dos de validación. | Es el mínimo técnico del arnés, no una muestra suficiente para aceptar la ayuda de Programación I en general. |
| Rúbrica `help-rubric-1` | Dimensiones y formato de registro de revisión propuestos.                                                     | Una plantilla vacía no es revisión ni aceptación académica.                                                   |

Revisar primero enunciados, fuentes, diagnósticos deterministas y expectativas
de los casos existentes. Después acordar con el docente casos representativos
de los conceptos y errores que se enseñarán, incluidas fuentes cercanas pero
no pertinentes. Recomiendo ampliar esa cobertura antes de la evaluación
pedagógica; los cuatro casos actuales permiten un piloto técnico acotado,
con sus límites explícitos. Conservar separados los grupos de calibración y
validación: no ajustar el
umbral con las consultas o contenidos reservados para validarlo.

La pertinencia de recuperación y la calidad pedagógica son comprobaciones
distintas. La revisión debe valorar sustento de las citas, claridad para
principiantes, correspondencia con el diagnóstico, gradualidad de las pistas,
ausencia de solución completa prematura y resistencia a instrucciones dentro
del material. Se registran respuesta identificada por hash, revisor, fecha,
dimensión, valoración, fundamento y desacuerdo cuando exista. Antes de tener
respuestas del proveedor que se pretende evaluar, este paquete permite revisar
el diseño del corpus y de la rúbrica. Las respuestas TEST no acreditan calidad
pedagógica de Azure.

Extender el corpus puede requerir ajustar el preparador y sus pruebas; editar
`review-packet.json` no cambia automáticamente el corpus ejecutable. Versionar
esa ampliación, recalcular su inventario y estimación y comprobar que cabe en
los límites ya acordados. No elevar cuotas o presupuestos para hacerla caber
de forma implícita.

La calibración futura debe producir `help-evidence-2` de origen `AZURE`, con
consultas, distancias y recibos obtenidos realmente por el servidor, ligados a
la corrida, corpus y perfil. La calibración TEST y un umbral escogido a mano
no satisfacen ese contrato.

## 5. Reutilizar la evidencia sin mezclar sus alcances

| Evidencia                                                                                          | Reutilización válida                                                                                                                                                                                                             | Pendiente independiente                                                                                                 |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| TEST del 01/11/2026, `.local/reports/imp-04/evaluation-test.json` y `evaluation-measurements.json` | Prueba histórica del arnés: cobertura 43/43, 234 muestras, 763 recibos, cero llamadas externas; perfiles de 100 ayudas en serie y 100 concurrentes.                                                                              | Proveedor Azure, coste real, aceptación docente y latencia hasta ayuda visible en navegador. Su candidato es histórico. |
| Ryzen `.13`, 18/11/2026                                                                            | Tres escenarios aprobados: fuente consultable, `NO_EVIDENCE` y `PROVIDER_UNAVAILABLE` con recuperación; seis intentos, cuatro ayudas y seis VM retiradas. Persistencia, reintento e integración web/API/Storage/KVM reales.      | Embeddings/generación/revisión siguen siendo TEST. No valida calibración Azure ni un p95 de 200 ayudas.                 |
| Navegador local TEST, 18/11/2026                                                                   | Productor Chrome/CDP verificado: 100 ayudas en serie con p95 de 1305,3 ms y 100 con concurrencia cuatro con p95 de 4954,8 ms, desde la acción hasta la ayuda visible. Ambos perfiles cumplen el objetivo de 12 s en esa campaña. | Medición con Azure/LAB-EVAL, calidad pedagógica, coste real y aceptación docente. No es una medición KVM del Ryzen.     |
| Expediente offline nuevo                                                                           | Inventario reproducible, borrador, corpus y preguntas concretas para completar configuración/revisión.                                                                                                                           | No ejecuta ninguna de las mediciones anteriores ni genera aceptación nueva.                                             |

La evidencia física y sus límites están en
[IMP-04-ayuda-fisica-13](../work/IMP-04-ayuda-fisica-13.md). El historial del
arnés y sus incidencias está en
[IMP-04-evaluation](../work/IMP-04-evaluation.md). La campaña de navegador y
la entrega docente están registradas en
[IMP-04-feedback-visible-corpus](../work/IMP-04-feedback-visible-corpus.md).
Leer un reporte JSON ya
guardado es una consulta local; `help:eval --mode report` consulta el listener
operacional y no es una alternativa offline.

El perfil de evaluación fija 25 intentos por carril con cuatro ayudas por
intento: 100 muestras en serie y 100 con concurrencia cuatro. Los tres
escenarios físicos no sustituyen ese perfil. Se conserva el plazo operativo
de ayuda de 15 s y el objetivo documental p95 de 12 s; su cumplimiento requiere
evidencia de navegador de la corrida correspondiente, además de la telemetría
del servidor. La campaña TEST citada ya aporta sus 200 observaciones de
navegador; la corrida Azure aún debe producir las suyas.

## 6. Resolver el destino antes de una corrida futura

El evaluador actual admite los destinos aislados `TEST` y `LAB-EVAL`.
`LAB-EVAL` usa el proyecto `alunza-edu-laboratorio-eval`, API en loopback 4400,
web 3400, Auth 19421 y listener operacional 4401. El perfil físico del Ryzen
es `PHYSICAL_HELP_TEST`; no es un destino que el manifiesto v2 acepte.

Además, la configuración actual admite el ejecutor `local-vm` únicamente en
local/TEST, no en evaluación. Cambiar una etiqueta, reutilizar los puertos del
Ryzen o activar Azure en su entrypoint TEST no resuelve esa incompatibilidad.
La ruta ya implementada es el LAB-EVAL aislado con el ejecutor Docker local.
Usar KVM en una evaluación exigiría un incremento explícito de compatibilidad,
sus pruebas y un perfil independiente, sin debilitar los controles de destino.

Una vez completados los datos y cubiertos por la autorización efectiva, seguir
el [procedimiento operacional existente](../work/IMP-04-evaluation-operations.md):
preparar el destino aislado y sus consumidores; crear datos por API; comprobar
el manifiesto; registrar la autorización; ejecutar INGESTION y CALIBRATION;
reiniciar el consumidor con el artefacto Azure verificado; continuar
FUNCTIONAL y EVALUATION con la misma corrida y journal. Para medir latencia
visible, usar el [productor de navegador](evaluacion-ayuda-navegador.md)
durante las mismas ayudas autorizadas, con la identidad del candidato, corpus,
proveedor y perfil correspondientes. El productor ya fue verificado en TEST;
su ejecución con Azure en LAB-EVAL sigue pendiente. No repetir 200 ayudas
adicionales como captura implícita: otra corrida necesita su propio plan y
presupuesto cubiertos por autorización. La revisión docente usa las respuestas
ya obtenidas y no requiere volver a consultar al proveedor.

Esas acciones pertenecen a la futura ejecución, no a los comandos offline de
esta guía. Se conservan recibos, fallos y respuestas inciertas; la recuperación
reconcilia lo ya despachado y no crea una nueva llamada para ocultarlo.

## Referencias para concretar el proveedor

Antes de elegir una configuración real, comprobar el deployment de embeddings
y la identidad autorizada según la [guía oficial de embeddings de Microsoft](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/embeddings).
El código actual usa Chat Completions con `response_format`; verificar que el
modelo elegido admita el [contrato de salida estructurada](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs).
Consultar la [cuota aplicable](https://learn.microsoft.com/en-us/azure/foundry/openai/quotas-limits)
y el [ciclo de vida del modelo y versión](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-retirement-schedule)
en el momento de completar el plan. Estas referencias, consultadas el
18/11/2026, no prueban capacidad disponible ni precios de una cuenta concreta.
