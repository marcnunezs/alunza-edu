# Inicio y recuperación del contexto

Usa esta guía al iniciar o retomar una tarea. Su objetivo es identificar el alcance real y continuar desde la evidencia existente, sin reiniciar el proyecto ni cargar todos los documentos innecesariamente.

## Inspección inicial

1. Lee [AGENTS.md](../../AGENTS.md) y la solicitud más reciente junto con las autorizaciones y restricciones todavía vigentes.
2. Localiza la raíz Git y el árbol real. En el espacio de trabajo original hay una carpeta contenedora y dentro otra llamada `alunza-edu`; los comandos de proyecto deben apuntar a la que contiene `.git`.
3. Consulta `git status --short`, los cambios de las rutas que vas a tocar y los archivos de instrucciones aplicables. Usa `rg --files` y búsquedas acotadas; excluye dependencias, builds, respaldos y binarios.
4. Inspecciona manifests, lockfiles, migraciones, workflows y scripts existentes. Lee sus nombres antes de ejecutar comandos; no asumas `npm test`, un puerto o un proveedor configurado.
5. Revisa registros de trabajo y decisiones si existen. Confirma con código y pruebas lo que declaren; una nota «terminado» no sustituye evidencia.
6. Identifica si hay servicios/procesos ya activos y si sus puertos pertenecen a esta tarea antes de detenerlos o iniciar otros.

Los comandos anteriores son inspecciones de referencia para entornos con Git y `rg`; si una herramienta no existe, usa su equivalente permitido. No instales dependencias para una tarea que solo necesita leer Markdown.

## Paquete mínimo de lectura

Lee [fuentes](../../specs/00-fuentes-y-decisiones.md), [producto](../../specs/01-producto-y-alcance.md) y [arquitectura](../../specs/05-arquitectura.md) al entrar por primera vez. Luego abre el RF concreto en [requisitos](../../specs/02-requisitos-funcionales.md), su CU y los escenarios E1–E4 en [flujos](../../specs/03-flujos-y-criterios-de-aceptacion.md), más el RNF relevante en [calidad](../../specs/10-calidad-y-pruebas.md).

Carga el contrato de datos/API y la guía específica cuando una tarea los afecte. Recurre a los documentos Office originales solo si los specs no resuelven una contradicción o se necesita verificar el origen. La ERS 1.3 conserva autoridad técnica sobre el MER y los mockups históricos.

## Traduce la solicitud a una tarea concreta

Antes de editar, registra de manera breve:

- Objetivo observable y actor al que beneficia.
- RF/HU/CU/PT y RNF afectados, con escenarios de éxito, rechazo y falla que debe satisfacer.
- Código existente reutilizable y archivos previstos para cambiar.
- Dependencias reales: contratos, configuración, datos de prueba o credenciales.
- DEC relevantes y tratamiento: resuelto, supuesto reversible registrado o parte pendiente que no se debe activar todavía.
- Comprobaciones que demostrarán el resultado, sin atribuir resultados anticipados.

Para cambios pequeños, ese registro puede quedar en la conversación o descripción del cambio. Para varias sesiones, usa las [plantillas](14-plantillas-de-trabajo.md) sin crear burocracia por cada edición.

## Elige el siguiente paso

Si el usuario pide una función concreta, implementa esa función y los prerrequisitos indispensables. Si pide el MVP completo, usa [el plan](01-plan-de-implementacion.md) para avanzar por incrementos completos hasta cubrirlo. Si pide revisión, documentación o un diagnóstico, mantén ese alcance.

Si encuentras una dependencia faltante, desarrolla primero su contrato y la parte local verificable. Los dobles de prueba sirven para aislar servicios; identifícalos y mantén pendiente la integración real. No pongas respuestas falsas detrás de una ruta de producción para dar por terminada una función.

## Preserva contexto y trabajo ajeno

No reemplaces archivos completos sin leerlos ni reviertas cambios previos para obtener un árbol limpio. Resuelve el conflicto de edición dentro de las rutas autorizadas. Si no puedes atribuir un cambio a tu tarea, consérvalo y explica el efecto relevante.

En Windows, comprueba el destino absoluto antes de borrar o mover recursivamente y usa una sola shell con rutas literales. Evita comandos compuestos que mezclen shells o interpreten código estudiantil, nombres de archivo o secretos como comandos.

Tras una interrupción, lee la tarea vigente, los archivos cambiados, el resultado de la última prueba y la siguiente acción registrada. No repitas instalación, seed o migración si ya se realizaron correctamente y no hay cambios que lo justifiquen.

## Salida de esta etapa

Debes conocer qué existe, qué está autorizado, qué vas a cambiar y cómo comprobarlo. Comparte un resumen breve con el usuario y comienza el trabajo concreto. La inspección y el plan son preparación; no los presentes como implementación terminada.
