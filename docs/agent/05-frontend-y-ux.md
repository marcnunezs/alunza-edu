# Instrucciones para implementar frontend y UX

## Cuándo aplicar y qué leer

Aplica este manual cuando escribas o modifiques navegación, pantallas, formularios, editor, visualización de resultados o integración web/API. Implementa capacidades observables de los tres roles; una pantalla conectada solo a datos simulados todavía no satisface su aceptación integrada.

Lee primero el [AGENTS.md del proyecto](../../AGENTS.md), [fuentes y decisiones](../../specs/00-fuentes-y-decisiones.md), [UX y accesibilidad](../../specs/04-ux-y-accesibilidad.md), [arquitectura](../../specs/05-arquitectura.md) y [contratos](../../specs/07-api-y-contratos.md). Para la capacidad seleccionada extrae los RF y escenarios E1–E4 de [requisitos](../../specs/02-requisitos-funcionales.md) y [flujos](../../specs/03-flujos-y-criterios-de-aceptacion.md). Usa [pruebas y evidencias](10-pruebas-y-evidencias.md) para comprobar el resultado.

Respeta la diferencia entre Documentado, Propuesta técnica y Pendiente. Los UX-01 a UX-19 son referencias propuestas para organizar pantallas; no fijan rutas ni un diseño visual aprobado. Los mockups son antecedentes de funcionalidad planificada. Sus nombres, números, colores y mensajes ilustrativos no constituyen datos reales ni permiso para mostrar recursos ajenos.

## Antes de escribir componentes

1. Inspecciona la aplicación, scripts, componentes y cambios existentes. Amplía sus convenciones cuando sean compatibles; no reemplaces trabajo previo para ajustarlo a una estructura preferida.
2. Anota actor, organización/clase, operación, respuesta pública, estados adversos y RF/HU/CU/PT cubiertos por el cambio. Identifica qué estado del servidor confirma cada mensaje de éxito.
3. Confirma el contrato utilizado con la API. Si todavía no existe, define tipos públicos y fixtures coherentes con la propuesta contractual, marcando su integración como pendiente. No conviertas un mock en backend productivo.
4. Mantén Next.js App Router, React 19, TypeScript 5.x, Tailwind, shadcn/ui, Recharts y Zod de la línea base. Antes de instalar, verifica compatibilidad de versiones en documentación oficial y en el lockfile; registra la resolución de DEC-007. No añadas otro framework o editor como requisito aprobado.
5. Define tokens y componentes reutilizables suficientes para el incremento. Puedes resolver composición, espaciado y otros detalles reversibles dentro del alcance autorizado y documentar tu elección; no detengas el trabajo por cada decisión visual. Conserva pendientes las validaciones visuales y con usuarios que aún no se hayan realizado.

## Fronteras del frontend

- Usa Supabase Auth para sesión y NestJS como API exclusiva del dominio. Un callback, Server Component o Server Action no debe crear una segunda implementación de permisos, progreso, señales o persistencia de negocio.
- Obtén identidad y pertenencias autorizadas mediante el contrato previsto. Mostrar u ocultar controles mejora la experiencia; exige igualmente autorización del servidor en todas las operaciones.
- Conserva contexto de organización/clase en navegación, filtros y consultas. Al cambiar de cuenta, ámbito o sesión, evita reutilizar datos privados de otro contexto. No compartas respuestas personales mediante caché pública o de CDN.
- Expón únicamente variables públicas previstas en [operación](../../specs/11-operacion-y-despliegue.md). No incluyas credenciales administrativas, tests ocultos, prompts internos o SDKs privilegiados en el bundle, HTML, datos serializados ni herramientas de diagnóstico del cliente.
- Centraliza traducción de errores y validación de respuestas públicas. El texto de un documento, enunciado, código o respuesta de IA es contenido no confiable; renderízalo de forma segura. No muestres trazas internas ni reflejes entradas peligrosas como HTML ejecutable.
- Formatea los instantes de la API en la zona aplicable, prevista `America/Santiago`; conserva fechas académicas sin hora cuando el contrato las declare como fechas. No conviertas silenciosamente una fecha en medianoche UTC; resuelve la discrepancia de fechas de clase en DEC-004 antes de fijar el schema.

## Capacidades a implementar

| Capacidad y referencias | Instrucciones de construcción | Verificación específica |
| --- | --- | --- |
| Acceso y contexto; UX-01/02, RF-001/003/007 | Construye inicio/cierre de sesión, destino por rol, clases autorizadas e incorporación. Distingue cuenta `INVITED`, `ACTIVE`, `DISABLED` y sesión vencida. Conserva código de incorporación y validación útil ante error. | Rechaza credenciales inválidas y cuenta inactiva; inscripción repetida no duplica membresía. El acceso directo a una ruta no descubre datos ajenos. |
| Clases y publicación; UX-06/07/08, RF-002/004/005 | Implementa formularios de clase, ejercicio JavaScript con versión y composición ordenada de actividad. Separa pruebas visibles/ocultas en las proyecciones autorizadas. Permite ordenar con teclado. Representa `DRAFT`, `PUBLISHED`, `CLOSED` según servidor. | Una validación conserva los campos; publicación fallida no muestra éxito. Una edición no altera la versión ya publicada. Clase archivada impide cambios operativos. |
| Resolución e historial; UX-03/04/05, RF-007 a RF-015 | Construye enunciado, plantilla, editor, casos visibles, ejecución, envío, resultado, ayuda e historial. Usa la secuencia obligatoria que sigue a esta tabla. | El historial permanece intacto; un nuevo intento tiene otro identificador. Un resultado de práctica no marca automáticamente un ejercicio completo ni confirma envío. |
| Materiales y fuentes; UX-09/17, RF-006/025 | Implementa carga PDF textual/TXT/Markdown de hasta 10 MB, asociación autorizada, estado de ingestión y reindexación permitida. Usa los estados de indexación del contrato acordado. | Rechaza archivo inválido o demasiado grande; explica PDF sin texto y fallo de ingestión. No presentes carga terminada como documento ya recuperable. |
| Seguimiento docente; UX-10/11, RF-015 a RF-019 | Muestra agregados y filtros de clase, progreso con numerador/denominador, detalle de intentos y señales con regla, evidencia, fecha y versión. Solicita confirmación antes de revisar `ACTIVE → REVIEWED`; permite cancelar sin enviar la mutación. | Filtros vacíos no parecen carga pendiente. Cancelar conserva ACTIVE; revisión repetida conserva responsable/fecha. No muestres detalle de tests ocultos ni etiquetas sobre capacidad personal. |
| Gobierno institucional; UX-12/13/14, RF-020/021/022 | Construye organización, usuarios/roles y estructura académica dentro del ámbito vigente. Distingue invitación, activación y deshabilitación. Maneja dependencias activas, duplicados y protección del último administrador. | No crees vista global por copiar el mockup. RF-020 requiere resolver DEC-001 para alta institucional; el seed no completa esa función. Asignación cruzada o usuario ajeno no modifica datos. |
| Taxonomía y banco; UX-15/16, RF-023/024 | Implementa jerarquía de conceptos, referencias y archivado; gobierno de propiedad, visibilidad y versiones de ejercicios. | Ciclo o conflicto preserva el formulario. Editar una versión publicada crea la versión correspondiente sin sustituir referencias históricas. No amplíes visibilidad fuera de organización. |
| Reglas y auditoría; UX-18/19, RF-026/027 | Construye parámetros/versiones/vigencia de reglas, filtros de auditoría y exportación CSV operativa. Muestra autor y fecha confirmados, y proceso de exportación hasta resultado real. | No edites silenciosamente una regla histórica. Exportación fallida no anuncia archivo disponible; no incluyas datos ajenos ni secretos. |

Todos los RF de esta tabla usan el prefijo completo `ALZ-RF-`. Conserva los identificadores completos en trazabilidad, cambios y evidencias.

## Secuencia obligatoria del editor

1. Carga únicamente la versión y proyección pública autorizadas. Presenta enunciado, conceptos, plantilla y casos visibles. No descargues tests ocultos para filtrarlos visualmente después.
2. Distingue **Ejecutar** de **Enviar intento**. Ejecutar ofrece evidencia de práctica. Al elegir enviar, solicita la confirmación explícita del estudiante prevista en CU-010; solo después envía la solicitud para admisión, verificaciones y persistencia. Cancelar conserva el editor y no crea solicitud, ejecución de envío ni intento. Esta confirmación del estudiante es distinta de la confirmación durable del servidor. No confíes en el diagnóstico o porcentaje calculado por el navegador.
3. Conserva código editable mientras se procesa la operación y si falla la red o persistencia. Implementa el borrador local requerido por RF-008 cuando ese RF forme parte del alcance; identifica borradores por cuenta, organización, clase, asignación y versión para no mezclarlos. Comprueba recuperación y fallo del almacenamiento, y evita que una sesión posterior vea código de otra cuenta. No anuncies recuperación de borradores que no hayas implementado y verificado.
4. Gestiona la clave de idempotencia conforme al contrato final de DEC-004. Conserva la misma clave mientras se desconozca el desenlace de una operación; consulta/reintenta de forma acotada ante operación en curso. Crea otra clave solo para un nuevo intento deliberado. Deshabilitar un botón no sustituye la garantía del servidor.
5. Indica envío pendiente hasta recibir confirmación de persistencia. Solo entonces muestra ID/fecha, actualiza historial y habilita la solicitud separada de feedback. Una ejecución correcta seguida de error de persistencia no es un intento guardado.
6. Ante fallo de persistencia, conserva editor y resultado permitido; no solicites RAG ni modelo. Ante respuesta tardía o perdida, reconcilia con el servidor y la clave original antes de crear otro envío.
7. Representa el trabajo de ayuda en curso separado del contrato RAG. `QUEUED` y `RUNNING` pertenecen al trabajo; jamás son valores de `status` RAG. Usa consulta acotada y cancelación de seguimiento cuando la vista se abandone, sin atribuir cancelación del trabajo durable a cancelar una petición del navegador.
8. Presenta diagnóstico técnico y ayuda como dimensiones diferentes. Conserva el diagnóstico aunque no exista fuente o falle el proveedor. Reintentar ayuda conserva el intento y no equivale a reenviar solución.
9. Abre referencias por el mecanismo que vuelve a validar permisos. No construyas URLs a partir de texto arbitrario del modelo ni muestres como disponible una referencia inexistente o revocada.
10. Ante cierre de actividad, aplica el estado confirmado por servidor. No decidas localmente la carrera entre admisión y cierre; depende de DEC-002 y del contrato implementado. La consulta histórica de `CLOSED` queda sujeta a esa decisión, sin reapertura implícita.

## Estados y mensajes que debes comprobar

Mantén los seis diagnósticos `SUCCESS`, `SYNTAX_ERROR`, `RUNTIME_ERROR`, `FAILED_TEST`, `TIMEOUT`, `UNKNOWN`; los estados de ayuda `SUPPORTED`, `NO_EVIDENCE`, `PROVIDER_UNAVAILABLE`; y las señales `ACTIVE`, `REVIEWED`. No agregues un séptimo diagnóstico por memoria/salida, un estado RAG de carga o un estado de señal «No verificable». Los motivos operativos tienen otro campo.

En cada pantalla implementa carga, vacío, error recuperable, validación, falta de permiso y resultado confirmado cuando correspondan. Toda espera termina en resultado, error controlado o tiempo excedido; no dejes indicadores girando indefinidamente. Mapea 401, 403/404, 409/412, 413/415/422, 429 y 503/504 según [API](../../specs/07-api-y-contratos.md), conservando contenido válido y ofreciendo solo acciones admitidas.

Un recurso inexistente o no autorizado tiene un mensaje genérico que no nombra usuarios, clases u organizaciones ajenas. No muestres cuotas, credenciales, trazas o infraestructura al estudiante para explicar un error. El `TIMEOUT` del programa, una respuesta HTTP 504 y el plazo de ayuda tienen causas distintas.

Presenta progreso como completados/requeridos y casos visibles superados/total visible con etiquetas distintas. Denominador cero usa estado no calculable; no inventes `0 %`, nota o dominio conceptual. Renderiza las señales como hechos revisables por el profesor, con causa y evidencia; no propongas sanciones, diagnóstico personal o calificación automática.

## Accesibilidad y revisión visual

Aplica RNF-USA-01 a RNF-USA-04 desde cada incremento. Implementa estructura semántica, etiquetas persistentes, errores asociados a campos, foco visible y orden lógico. Los resultados, tablas y gráficos tienen texto equivalente; el color no es el único indicador. Anuncia estados relevantes sin interrumpir cada pulsación del editor.

Antes de cerrar la elección del editor, ensaya entrada/salida de foco, captura de Tab, atajos, ampliación y lector de pantalla en la matriz acordada. Documenta los atajos reales. No aceptes un editor que impide abandonar el campo con teclado.

Comprueba menús, diálogos, formularios, ordenación de ejercicios y los tres roles con teclado. Mantén foco razonable al guardar, validar y actualizar resultados. En móvil/tableta conserva lectura, navegación y acciones esenciales; apila paneles y limita el desplazamiento de tablas/código a su región.

Usa como punto inicial propuesto 1440×900, 1280×720, 768×1024 y 390×844; registra navegador, versión, sistema y tecnología de asistencia utilizados. Complementa herramientas automáticas con revisión manual de los criterios WCAG 2.2 AA aplicables. Un reporte automático o captura no acredita conformidad completa ni validación con usuarios.

## Artefactos y cierre del incremento

Cuando implementes, entrega componentes y rutas en la estructura vigente de `apps/web`, contratos públicos sincronizados, estados reproducibles, pruebas pertinentes y documentación del editor/decisiones. Esas rutas son destinos futuros propuestos si aún no existe aplicación; no declares archivos o scripts creados sin haberlos comprobado.

Verifica primero tipos/lint/build y pruebas pertinentes existentes para el cambio; después recorre la capacidad con API real y evidencia de estados normal/adverso. Comprueba especialmente RNF-CON-01/03, RNF-SEG-01/03/05 y RNF-IA-05 cuando intervengan envío, sesión, ayuda o señales. No añadas pruebas que solo reproduzcan clases CSS ni suites para una corrección documental trivial.

Registra pantalla/flujo, RF/HU/PT/E, commit, fixtures, resultado observado y limitaciones conforme a [pruebas y evidencias](10-pruebas-y-evidencias.md). Deja explícitos los mocks y las verificaciones no realizadas. Solicita revisión humana cuando corresponda a la aceptación; no atribuyas al PO, docente o usuarios una aprobación que no ocurrió.
