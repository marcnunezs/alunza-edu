# Especificación de UX y accesibilidad

## Estado y referencias

Esta especificación describe la experiencia que debe construirse para el MVP de Alunza. Se deriva de la ERS 1.3, los casos de uso, las historias y los tres mockups de Fase 1 inspeccionados visualmente. El cierre documental es del 02/09/2026 y la revisión técnica del 04/09/2026; los prototipos no acreditan implementación, pruebas de usuarios ni conformidad de accesibilidad. Las decisiones nuevas se identifican como **propuesta** o **pendiente** y se gestionan en [fuentes y decisiones](00-fuentes-y-decisiones.md).

Fuentes primarias: [ERS, apartados 3.1 y 3.3](../Evidencias%20CAPSTONE/Fase%201/Evidencias%20de%20proyecto/Informe_ERS_Alunza.docx), [historias y escenarios E1–E4](../Evidencias%20CAPSTONE/Fase%201/Evidencias%20de%20proyecto/Plantilla_Historias_Usuario_Alunza.xlsx) y [casos de uso](../Evidencias%20CAPSTONE/Fase%201/Evidencias%20de%20proyecto/Documento_Casos_de_Uso_Extendidos_Alunza.docx). Complementan este documento [alcance](01-producto-y-alcance.md), [requisitos](02-requisitos-funcionales.md), [flujos](03-flujos-y-criterios-de-aceptacion.md), [contratos](07-api-y-contratos.md), [IA](08-ia-y-procesamiento.md), [seguridad](09-seguridad-y-privacidad.md) y [pruebas](10-calidad-y-pruebas.md).

## Principios de experiencia

- Mostrar el rol, la organización y la clase aplicables, y conservar ese contexto al navegar. Toda cifra, lista y búsqueda debe pertenecer al ámbito autorizado.
- Mantener enunciado, código, ejecución, envío, diagnóstico y ayuda próximos. El estudiante debe distinguir ejecutar una prueba de enviar y conservar un intento.
- Mostrar primero el resultado técnico reproducible. La disponibilidad de IA/RAG no condiciona poder consultar el intento, reintentar ni ver resultados técnicos.
- Explicar progreso con numerador y denominador. Los porcentajes de casos visibles superados y ejercicios completados representan magnitudes distintas y no constituyen notas.
- Presentar señales como evidencia que el profesor revisa, sin etiquetas de capacidad, sanciones o conclusiones personales sobre el estudiante.
- Cumplir el objetivo RNF-USA-01 a RNF-USA-04: interfaz responsiva, funciones principales conforme a WCAG 2.2 AA, mensajes accionables y estados comprensibles sin depender únicamente del color.

## Lectura de los mockups y límites de su uso

| Referencia visual | Estructura aprovechable | Ajuste o decisión necesaria |
| --- | --- | --- |
| [Módulo estudiante](../Evidencias%20CAPSTONE/Fase%201/Evidencias%20de%20proyecto/mockups/modulo-estudiante.png) | Navegación lateral; indicadores; enunciado y editor; pestañas de casos e historial; acciones Ejecutar/Enviar; panel de feedback; progreso. Muestra explícitamente `FAILED_TEST` y `PROVIDER_UNAVAILABLE` con intento guardado. | Los números 3/5 ejercicios, 4/5 casos visibles y 4 intentos son datos sintéticos ilustrativos. Los casos deben incorporar resultado textual además del color. Un título o pista concreta debe estar sustentado por evidencia; el ejemplo visual no se convierte en respuesta fija. |
| [Módulo profesor](../Evidencias%20CAPSTONE/Fase%201/Evidencias%20de%20proyecto/mockups/modulo-profesor.png) | Panel de clase, avance por estudiante, señales con regla, listado de actividades, revisión individual y estado de filtro vacío. | Los 2/4 estudiantes que finalizaron y 16/20 ejercicios completados usan denominadores distintos; conservar etiquetas y explicación. El mensaje ilustrativo que nombra una clase ajena debe sustituirse por un error que no revele su existencia. |
| [Módulo administración](../Evidencias%20CAPSTONE/Fase%201/Evidencias%20de%20proyecto/mockups/modulo-administracion.png) | Navegación de organizaciones, usuarios, cursos, taxonomía, banco, materiales, reglas y auditoría/CSV; operaciones de gobierno y estado de indexación. | La tabla presenta dos organizaciones aunque el contexto indica Instituto Andino. No autoriza una vista global: DEC-001 debe resolver el alta inicial y el ámbito administrativo sin introducir un superadministrador implícito. Las cifras globales solo describen el conjunto de demo, no una consulta permitida a cualquier administrador. |

Los banners «funcionalidad planificada» y «datos sintéticos» contextualizan las láminas. **Propuesta:** conservar una identificación discreta del ambiente de demostración en el producto. Los colores, tipografía, espaciado y componentes definitivos requieren validación; las imágenes no constituyen un sistema de diseño completo.

## Mapa de pantallas

Los identificadores `UX-*` son referencias de diseño propuestas, no nuevos requisitos funcionales. Las rutas definitivas se acordarán con la implementación de [arquitectura](05-arquitectura.md).

| Pantalla | Actor y requisitos | Contenido y acciones | Estados específicos que deben diseñarse |
| --- | --- | --- | --- |
| UX-01 Acceso | Todos; ALZ-RF-001 | Inicio y cierre de sesión; identidad y destino permitido por rol. | Credenciales inválidas, `INVITED`, `DISABLED`, sesión vencida y acceso denegado. No revelar datos de otras cuentas. |
| UX-02 Mis clases e incorporación | Estudiante; ALZ-RF-003, ALZ-RF-007 | Clases autorizadas; formulario de código vigente; actividades publicadas. | Sin clases; código inválido/vencido; membresía ya existente sin duplicación. |
| UX-03 Actividad | Estudiante; ALZ-RF-007, ALZ-RF-015 | Ejercicios en orden, conceptos, completados/requeridos y acceso al ejercicio. | Sin publicaciones, sin evidencia, denominador cero no calculable, actividad cerrada. |
| UX-04 Resolver ejercicio | Estudiante; ALZ-RF-008 a ALZ-RF-014 | Enunciado, plantilla, editor, casos visibles, Ejecutar, Enviar intento, diagnóstico, pista progresiva y referencias autorizadas. | Ejercicio no disponible, ejecución en curso, envío pendiente, fallo de persistencia, seis diagnósticos técnicos y tres estados de ayuda. |
| UX-05 Historial y progreso propio | Estudiante; ALZ-RF-014, ALZ-RF-015 | Intentos ordenados y resultados por actividad/concepto; abrir un intento sin sobrescribirlo. | Sin intentos; progreso no calculable; consulta histórica de actividad cerrada sujeta a DEC-002. |
| UX-06 Mis clases / configurar clase | Profesor; ALZ-RF-002 | Datos básicos, mecanismo de incorporación y contexto de organización. | Validación de obligatorios; clase archivada sin modificaciones operativas; guardado fallido. |
| UX-07 Editar ejercicio | Profesor; ALZ-RF-004 | Enunciado, plantilla JavaScript, dificultad, conceptos, pruebas visibles/ocultas y límites. | Pruebas inconsistentes, campos inválidos, edición de versión publicada. |
| UX-08 Componer actividad | Profesor; ALZ-RF-005 | Orden de ejercicios; guardar borrador, publicar y cerrar según transiciones autorizadas. | Validación previa; publicación fallida; conflicto de estado; cierre que impide nuevos envíos. |
| UX-09 Materiales de clase | Profesor; ALZ-RF-006 | Archivo oficial, asociación a clase/actividad, estado de ingestión y acceso a fuente. | Archivo no admitido, exceso de 10 MB, PDF sin texto, procesamiento y fallo controlado. |
| UX-10 Panel y señales | Profesor; ALZ-RF-016, ALZ-RF-018, ALZ-RF-019 | Filtros, avance, fallas frecuentes, conceptos, causa/evidencia/fecha/versión de cada señal y Marcar revisada. | Clase sin eventos; filtro sin coincidencias; `ACTIVE`/`REVIEWED`; recarga fallida; revisión ya realizada. |
| UX-11 Detalle de estudiante | Profesor; ALZ-RF-017 | Intentos persistidos, resultados, progreso y evidencia que explica una señal. | Sin intentos; recurso no autorizado; ningún detalle de pruebas ocultas. |
| UX-12 Organizaciones | Administrador; ALZ-RF-020 | Crear, actualizar y archivar dentro de su ámbito autorizado; dependencias que impiden archivar. | Datos duplicados/inválidos, dependencia activa, falta de permiso. Alta inicial pendiente DEC-001. |
| UX-13 Usuarios y roles | Administrador; ALZ-RF-021 | Invitar, activar, deshabilitar y asignar roles permitidos; estado de usuario explícito. | Correo duplicado, rol inválido, usuario ajeno y bloqueo de último administrador activo. |
| UX-14 Cursos y clases | Administrador; ALZ-RF-022 | Estructura académica, códigos, fechas y asignación de profesor de la organización. | Fechas incoherentes, código duplicado, profesor ajeno/deshabilitado. |
| UX-15 Taxonomía | Administrador; ALZ-RF-023 | Crear, editar y archivar conceptos; jerarquía y usos existentes. | Nombre duplicado, ciclo, concepto referenciado y archivo que conserva historial. |
| UX-16 Gobierno del banco | Administrador; ALZ-RF-024 | Propiedad, versiones, visibilidad, referencias y archivado. | Edición crea versión sin cambiar publicación existente; visibilidad no autorizada. |
| UX-17 Gobierno de materiales | Administrador; ALZ-RF-025 | Fuentes autorizadas, visibilidad, asociación, estado e intervención para reindexar fallas. | Ingestión pendiente/fallida; archivo no permitido; ausencia de fuentes disponibles. Nombres técnicos de estados según contrato de datos. |
| UX-18 Reglas de señales | Administrador; ALZ-RF-026 | Parámetros, autor, vigencia, historial de versiones y activación. | Parámetro inválido; versión futura; conflicto de vigencia. No editar silenciosamente la regla histórica aplicada. |
| UX-19 Auditoría y CSV | Administrador; ALZ-RF-027 | Filtros por fecha, actor, acción y entidad; exportación de registros operativos autorizados. | Sin coincidencias, filtro inválido, exportación en curso o fallida y confirmación real de resultado. |

## Estados compartidos y mensajes

| Estado | Comportamiento visible | Recuperación |
| --- | --- | --- |
| Cargando | Indicar la operación y mantener el contexto. **Propuesta:** anunciar cambios relevantes mediante semántica accesible sin interrumpir continuamente el editor. | Terminar siempre en resultado, error controlado o tiempo excedido. |
| Vacío | Explicar si no hay clases, publicaciones, intentos, eventos o coincidencias de filtro. | Ofrecer la acción pertinente al rol; no fabricar métricas. |
| Validación | Identificar campo y corrección; mantener la información válida introducida. | Corregir y reenviar; el servidor vuelve a validar. |
| Acceso denegado | Mensaje genérico: «No puedes acceder a este recurso». | Volver a una vista autorizada o iniciar sesión si corresponde. No nombrar clases, usuarios ni organizaciones ajenas. |
| Guardado confirmado | Mostrar identificador/fecha del intento solo cuando la persistencia se confirmó. | Consultar historial o solicitar ayuda. |
| Fallo de persistencia | «No se pudo guardar el intento. Conservamos el código en el editor para que puedas volver a enviarlo». No indicar éxito ni pedir IA/RAG. | Reintentar guardado sin perder el contenido editable de la vista; no se promete recuperación después de cerrar el navegador. |
| Tiempo excedido | Identificar si expiró la ejecución o la consulta de ayuda. | En ejecución, revisar código; en ayuda, conservar resultado técnico y ofrecer reintento posterior. |
| Actividad cerrada | Bloquear nuevos envíos y explicar el estado. | Consulta histórica de solo lectura propuesta en DEC-002; no reabrir actividad desde el estudiante. |
| Servicio de ayuda no disponible | Mostrar `PROVIDER_UNAVAILABLE` con mensaje comprensible y el estado real del intento. | Continuar con diagnóstico técnico; no perder intento ni generar otro envío solo por reintentar ayuda. |

Los textos anteriores son **propuestas de redacción**. El servidor y los [contratos de API](07-api-y-contratos.md) determinan el resultado real. No convertir errores técnicos internos, trazas o cuotas del proveedor en texto destinado al estudiante.

### Diagnóstico y feedback

| Código de dominio | Etiqueta propuesta | Información mínima |
| --- | --- | --- |
| `SUCCESS` | Verificaciones superadas | Indicar qué resultado se confirmó y la evidencia técnica permitida; completar ejercicio solo con todas sus verificaciones requeridas superadas. |
| `SYNTAX_ERROR` | Error de sintaxis | Ubicación y mensaje normalizado cuando estén disponibles; acción para corregir. |
| `RUNTIME_ERROR` | Error durante la ejecución | Causa técnica segura y disponible; sin traza interna sensible. |
| `FAILED_TEST` | Una o más verificaciones fallaron | Resultado permitido de casos visibles; no exponer entradas, salidas ni implementación de casos ocultos. |
| `TIMEOUT` | Tiempo de ejecución excedido | Límite de 3 segundos del proceso y orientación técnica sustentada, sin inferir desinterés o capacidad. |
| `UNKNOWN` | No se pudo determinar el diagnóstico | Evidencia técnica disponible y opción de reintento. No inferir una categoría sin evidencia. |
| `SUPPORTED` | Ayuda con fuente | Explicación, pista y referencia verificable a documento/sección autorizados. |
| `NO_EVIDENCE` | Sin fuente suficiente | No inventar citas ni conclusión documental; conservar diagnóstico técnico. |
| `PROVIDER_UNAVAILABLE` | Ayuda temporalmente no disponible | No atribuir una respuesta a IA si no se recibió una salida válida; permitir continuar. |

Los seis primeros valores pertenecen al diagnóstico y los tres últimos al estado de IA/RAG. Una ejecución `FAILED_TEST` puede coexistir con `NO_EVIDENCE` o `PROVIDER_UNAVAILABLE`. «Sin evidencia documental» nunca sustituye por sí sola el diagnóstico técnico por `UNKNOWN`.

## Flujos críticos accesibles

### Acceso y administración

Desde el teclado se debe poder iniciar sesión, identificar el contexto, abrir Usuarios y roles, completar campos, corregir un error, guardar un cambio permitido y volver al listado. Un intento de deshabilitar al último administrador activo debe dejar el estado previo intacto y comunicar la causa. **Propuesta:** las acciones con consecuencias de acceso o publicación presentan un resumen del recurso afectado y permiten cancelar antes de enviarse; esto es una interacción del producto, no una aprobación del trabajo documental.

### Publicación por el profesor

El profesor puede seleccionar una clase autorizada, completar un ejercicio, ordenar ejercicios, revisar datos y publicar mediante controles operables por teclado. **Propuesta:** ofrecer controles Subir/Bajar además de cualquier gesto de arrastre. Tras publicar, la confirmación debe indicar el estado confirmado por el servidor y mantener un enlace descriptivo a la actividad. Un error de validación conduce al campo correspondiente sin borrar la composición.

### Resolución y envío

El estudiante puede llegar al enunciado, entrar y salir del editor, revisar casos visibles, ejecutar y enviar sin trampa de teclado. La ejecución no mueve el foco inesperadamente ni reemplaza el código. Los resultados identifican cada caso visible mediante nombre/número y estado textual. El envío muestra primero persistencia pendiente y después confirmación o error; solo después de guardar puede solicitar ayuda. El reintento genera un intento distinto y mantiene el historial. **Pendiente:** elegir editor y documentar sus atajos, compatibilidad con lector de pantalla y salida del modo de captura de Tab antes de aceptar UX-04.

### Ayuda y referencias

La pista identifica su nivel progresivo según [IA](08-ia-y-procesamiento.md), su relación con el intento y su estado. Las referencias tienen nombre descriptivo de documento y ubicación; su apertura vuelve a comprobar permiso. Se puede regresar al editor conservando el código. No presentar un enlace visualmente existente cuando la fuente fue inventada, no está disponible o no está autorizada.

### Seguimiento docente

El profesor puede seleccionar filtros, acceder al resumen textual equivalente de los gráficos, abrir un estudiante autorizado, recorrer causa y evidencia de una señal y marcarla revisada. La acción repetida conserva el responsable y fecha originales. Una señal revisada sigue siendo consultable y mantiene la regla aplicada. No usar el color o la longitud de una barra como único portador de información.

## Criterios de accesibilidad y adaptación

La referencia normativa comprometida por la ERS es WCAG 2.2 AA. Esta lista operativa es **propuesta para preparar su verificación**; no sustituye una revisión de todos los criterios aplicables ni demuestra conformidad por sí sola.

| Área | Comportamiento verificable |
| --- | --- |
| Navegación | Orden lógico de encabezados y foco; controles con nombre; navegación completa por teclado; foco visible, incluidos menús, pestañas, editor y diálogos. |
| Formularios | Etiquetas persistentes, ayuda asociada, identificación de obligatorios, errores vinculados al campo y conservación de datos introducidos. |
| Estados | Texto o icono con alternativa textual; mensajes de carga, éxito y error disponibles para tecnologías de asistencia; evitar anuncios repetidos de cada carácter o cada evento técnico. |
| Gráficos y tablas | Encabezados comprensibles; cifras y denominadores disponibles en texto; filtros con etiqueta; estados sin resultados distintos de datos aún no cargados. |
| Contenido | Contraste comprobado en texto, controles y foco; lectura con ampliación; sin depender de hover; instrucciones comprensibles para principiantes. |
| Editor | Operable con teclado y lector de pantalla en la matriz acordada; atajos documentados y salida de foco disponible; fuente ampliable y conservación del contenido tras un error. |
| Diseño responsivo | Escritorio optimizado para programar; tableta/móvil permiten lectura y navegación esencial. En pantallas pequeñas los paneles se apilan y tablas/código pueden desplazarse dentro de su región sin ocultar acciones críticas. |

**Matriz propuesta de ensayo:** escritorio 1440×900 y 1280×720; tableta 768×1024; móvil 390×844. Registrar sistema operativo, navegador y versión realmente usados, ampliación y tecnología de asistencia. Estas resoluciones son perfiles de prueba propuestos, no dimensiones obligatorias del diseño. Benjamin define la matriz desde S2; navegador/editor exactos y sesiones con usuarios permanecen pendientes.

## Salida de diseño y validación

Antes de aceptar cada flujo se requieren una referencia de pantalla actualizada, estados normal y adverso, vínculo a ALZ-RF/ALZ-HU/ALZ-PT, revisión de accesibilidad y evidencia del comportamiento integrado. El protocolo y registro de resultados se mantienen en [calidad](10-calidad-y-pruebas.md). La demo debe utilizar datos ficticios reproducibles; no copiar nombres ni indicadores ilustrativos como resultados medidos.

Pendientes principales: DEC-001 ámbito/alta inicial de organización; DEC-002 consulta histórica de `CLOSED`; selección y validación del editor; matriz de navegadores/tecnologías de asistencia; semántica de componentes; revisión visual con estudiantes y docentes. No forman parte del MVP aplicaciones nativas, gamificación, chat docente o funciones de calificación automática.
