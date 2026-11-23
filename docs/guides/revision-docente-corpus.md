# Revisión docente del diseño del corpus de ayuda

Esta entrega prepara una revisión humana del diseño de las pruebas de Alunza:
enunciados, código, fuentes, etiquetas esperadas y pertinencia de la rúbrica.
El corpus es ficticio. No contiene respuestas observadas de Azure ni acredita
calidad pedagógica aceptada, calibración del proveedor o autorización de gasto.

## Archivos para el docente

Desde la raíz, con el Node del proyecto activo, ejecutar
`npm run help:eval:prepare-local`. El generador conserva un expediente nuevo en
la ruta informada en `directory`. El módulo puro
`scripts/evaluation-teacher-review.mjs` reutiliza el paquete de
`scripts/evaluation-review-packet.mjs` y produce estos archivos:

| Artefacto                    | Contenido y uso                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `teacher-corpus.md`          | Cuaderno legible con los 12 documentos y 47 fichas: 43 casos adversarios y cuatro de calibración/validación.  |
| `teacher-design-review.json` | Plantilla JSON separada, vinculada por SHA-256 al paquete base y a cada caso. Contiene campos humanos vacíos. |

El preparador del expediente es responsable de escribir esos artefactos. La
función `buildEvaluationTeacherReview()` es síncrona, no tiene CLI propio y no
lee credenciales, inicia servicios, crea intentos ni llama proveedores. También
acepta el paquete base como argumento para que ambos artefactos correspondan
al mismo inventario. El procedimiento general está en
[preparación de evaluación Azure](preparacion-evaluacion-azure.md).

Conservar sin cambios el paquete y cuaderno originales. Revisar una copia
identificada de la plantilla, manteniendo `sourcePacket`, `inventory`, `rubric`,
`caseId` y `authoredCaseSha256`. El hash del paquete se calcula sobre UTF-8 de
`JSON.stringify(packet)`, no sobre los bytes de un archivo JSON con sangría.
La revisión editada necesita su propia identidad: el hash original no acredita
que la copia revisada permanezca intacta.

## Procedimiento de revisión

1. Comprobar versiones y conteos del inventario. Los identificadores de fuentes,
   ejercicios e intentos son plantillas, no recursos persistidos del laboratorio.
2. Leer cada ficha como material de prueba. El código, fuentes y candidatos se
   muestran en bloques literales, incluidos ataques deliberados. No ejecutar el
   código ni seguir enlaces o instrucciones incrustadas en esos datos.
3. Contrastar el enunciado y código con los hechos técnicos y diagnóstico
   esperados. Revisar si la fuente permite sustentar la ayuda y si las etiquetas
   distinguen ausencia de evidencia, indisponibilidad y rechazo de una salida.
4. Completar `designReview` para el `caseId` correspondiente: identidad y fecha
   reales del revisor; observaciones sobre enunciado/contexto, pertinencia de las
   fuentes y etiquetas autorales; cambios propuestos, decisión, fundamento y
   desacuerdo. Son notas sobre el diseño, no resultados de ejecución.
5. Revisar las seis dimensiones existentes según su aplicación al caso. Dejar
   `applicable: null` mientras esté pendiente; usar `true` o `false` después de
   revisarlo. Si no aplica, justificarlo en `rationale` y dejar `rating: null`.
   Si se valora el diseño, usar exclusivamente los valores de `rubric.values`:
   `ACCEPTABLE`, `NEEDS_REVISION`, `UNACCEPTABLE` o `NOT_ASSESSABLE`. No agregar
   un enum `NO_APLICA` ni interpretar un campo vacío como aprobación.
6. Registrar la revisión global en los campos superiores `reviewer`,
   `reviewedAt`, `decision`, `rationale` y `disagreement`. La decisión describe
   el diseño revisado; no cambia `humanAcceptance: PENDING`, no autoriza una
   corrida ni sustituye la evaluación pedagógica de respuestas.

La rúbrica `help-rubric-1` conserva su estado propuesto, con diagnóstico y hechos
públicos, sustento de citas, feedback sin resolver, nivel de pista, claridad
para principiantes y resistencia a inyección. En este expediente se examina
si cada caso permite evaluar esas dimensiones. Todavía no se puntúa una
respuesta observada ni se calcula un porcentaje de aceptación.

## Calibración y cambios propuestos

Los cuatro casos de calibración proceden de dos escenarios existentes, cada
uno con fuente pertinente y no pertinente. Dos pertenecen a `calibration` y
dos a `validation`. Mantener separados sus grupos y fuentes pertinentes; no
ajustar el umbral con resultados reservados para validarlo.

Las distancias de los casos adversarios están marcadas como ilustrativas y no
medidas. No usarlas para elegir un umbral Azure. La cobertura de calibración
actual se concentra en retorno de funciones: permite un piloto técnico
acotado, sin representar todos los temas o errores de Programación I.

Una corrección propuesta en la plantilla no modifica el corpus ejecutable.
El equipo debe reconciliar los desacuerdos, implementar las modificaciones
pertinentes en sus fuentes, versionarlas y generar un expediente nuevo. La
revisión humana real debe conservarse como tal; el generador rechaza paquetes
que ya contengan respuestas, evidencia o revisiones para no sustituirlas por
campos vacíos.

## Evidencia técnica disponible

El [productor de evidencia de navegador](evaluacion-ayuda-navegador.md) ya está
implementado y fue verificado localmente el 18/11/2026 con proveedor TEST. Se
midió desde la acción hasta la ayuda visible: 100 muestras en serie con p95 de
1305,3 ms y 100 muestras con concurrencia cuatro con p95 de 4954,8 ms. Ambos
perfiles cumplieron el objetivo de 12 s en esa campaña.

La medición y sus límites están en
[IMP-04-feedback-visible-corpus](../work/IMP-04-feedback-visible-corpus.md).
Es evidencia de integración y latencia con respuestas TEST; no completa la
revisión del corpus ni acepta la calidad pedagógica. La medición Azure en
LAB-EVAL y la revisión humana de sus respuestas siguen pendientes. Las 47
fichas de este cuaderno conservan sus campos humanos vacíos.

## Evaluación de respuestas: entrega posterior

Mantener `responseEvaluation` sin ejecutar, con hash, revisor, fecha,
valoraciones y aceptación en `null`. Los candidatos autorales de las fichas
son entradas de prueba; no son respuestas Azure. La evidencia TEST tampoco
se convierte en evidencia Azure mediante una etiqueta o revisión del diseño.

Tras una corrida autorizada, la revisión pedagógica utiliza las respuestas
realmente obtenidas, sus hashes, contexto, fuentes y registros por dimensión,
con revisor y fecha reales, fundamento y desacuerdos. Esa revisión pertenece
al expediente de la corrida. Este preparador no genera `calibration.json`,
`teacher-review.json` posterior a la corrida, mediciones ni aceptación humana.
