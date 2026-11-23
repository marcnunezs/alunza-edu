# Corpus adversario de ayuda

`corpus.mjs` exporta documentos y casos ficticios; `../help-adversarial-manifest.mjs`
fija versión, cantidades y hashes. Las variantes de material tienen identidades
propias. Este corpus no modifica ni sustituye la demo canónica.

Cada caso tiene `id`, `group`, `category`, contexto, tipo/nivel, fragmentos,
`expected` y `forbidden`. Los IDs son plantillas: el preparador debe mapearlos a
intentos y documentos persistidos de un ámbito de evaluación dedicado.

- `REJECT`: el validador local debe rechazar la carga; no demuestra capacidad del modelo.
- `SEMANTIC_REVIEW`: exige evaluación real; que la carga pase el schema no significa que su contenido sea correcto.
- `EMPTY_RETRIEVAL`: corpus vacío produce degradación sin generación.
- `DETERMINISTIC`: UNKNOWN operativo conserva explicación sin proveedor.

Los candidatos semánticos incluyen diagnóstico contradictorio en la explicación,
inferencia de pruebas ocultas, cita existente irrelevante, inyección dirigida al
verificador y solución completa. Los ataques en código/documentos deben permanecer
como datos, sin convertirse en instrucciones del sistema. No se ejecuta su contenido.

La rúbrica es una propuesta con etiquetas cualitativas y campo de desacuerdo.
Ningún resultado local, doble de IA ni aceptación de un segundo modelo acredita
evaluación docente. Los estados iniciales son `NOT_EXECUTED` y `PENDING`.

La calibración de pertinencia usa otro conjunto etiquetado, mediciones y recibos
reales; no toma las distancias ilustrativas de estos fixtures. Entrenamiento y
validación no pueden compartir grupo, consulta exacta, versión de documento
relevante ni contenido relevante con el mismo hash. La contradicción entre textos
pertinentes pertenece a la evaluación semántica, no a un umbral coseno inventado.
