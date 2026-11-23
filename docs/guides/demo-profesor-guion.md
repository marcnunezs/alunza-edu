# Guion de demostración al profesor

Ensayo local completado el **19/11/2026** en el Lenovo: intento fallido
persistido, ayuda TEST con fuente, corrección con un intento nuevo y lectura
docente. Pasaron seis comprobaciones HTTP y tres comprobaciones en Chrome,
incluida una confirmación real de lectura. La revisión del profesor y la
presentación de mañana siguen pendientes. Duración prevista: **8–10 minutos**.

**Actualización Azure del 19/11:** Azure07 ya verificó ayuda real con fuente,
reintento correcto y lectura en navegador como alumno y profesor. Usa el
[guion Azure](demo-profesor-azure.md) para ese entorno. Este documento conserva
el recorrido **TEST de respaldo**, cuya IA debe presentarse como simulada.
El [registro de recuperación](../work/DEMO-recuperacion-fuentes-2026-11-19.md)
conserva los ensayos y US$0,004342 contabilizados dentro del máximo total US$5.

## Para abrir la demo preparada

1. Abrir [Alunza local](http://127.0.0.1:3300/acceso). Si ya funciona, no
   iniciar otra instancia. Si está detenido, usar el comando del apartado
   «Arranque y comprobación operativa» y esperar `DEMO_READY`.
2. Usar Chrome normal para `teacher.a@alunza.test` y una ventana de incógnito
   para `student.a@alunza.test`. Son sesiones separadas. Obtener la contraseña
   ficticia con `credentials.mjs`, en la terminal privada indicada más abajo.
3. Como profesor, abrir la
   [clase preparada](http://127.0.0.1:3300/clases/652af3d6-d8f5-4613-903f-c18ed04e9ea8).
   El apunte **Material ficticio · Funciones y suma** ya está disponible.
4. Como estudiante, abrir la
   [actividad reservada para presentar](http://127.0.0.1:3300/actividades/6b9beaed-3834-4bfe-9957-87ab59378954/ejercicios/5ee19699-7b9c-4ffc-b371-db14af5cd16c).
   Su intento #1 ya está fallido. **No pedir ayuda ni enviar la corrección hoy**:
   la explicación de este intento queda reservada para la presentación.
5. Para revisar hoy el resultado ya comprobado, usar la
   [actividad de ensayo](http://127.0.0.1:3300/actividades/077c11d4-57e4-4533-99f2-09f78bda28ea/ejercicios/fa2e6335-a575-4606-b15f-e8747559c354).
   Abrir su intento #1 y **Mostrar explicación**; su intento #2 ya es correcto.
   Consultar la ayuda existente no crea otra generación.

El escenario vigente está en el archivo privado
`.local/demo-profesor-20261119/fixture-02.json`. No usar las actividades de las
preparaciones anteriores ni volver a ejecutar los auxiliares de preparación.
El grant permite una explicación por cada uno de estos dos intentos; la del
ensayo ya se consumió. La ayuda reservada vence el **20/11/2026 a las 23:59 de
Santiago**. La conexión compartida del teléfono es de apoyo: el recorrido
principal está en localhost y no depende de alcanzar el Ryzen.

## Elegir el entorno

Usar **TEST local del Lenovo** para el recorrido de respaldo de esta guía. La
conexión compartida del teléfono queda como apoyo; el recorrido local con sus
dependencias ya preparadas no debe depender de alcanzar el Ryzen. Auth, API,
PostgreSQL, Storage, extracción, recuperación
de fuentes y ejecución Docker son reales; embeddings, generación y revisión
usan el proveedor **TEST** determinista. Presentarlo así al comenzar. La
ejecución Docker conserva **128 MiB / 3 s / 64 KiB**, pero no crea una VM
individual con frontera exterior de **2 GiB**. Este ensayo no acredita el
aislamiento físico del Ryzen ni la calidad de Azure. No usar el DEV histórico como atajo: requiere revisar
sus migraciones y datos antes de considerarlo compatible con el producto actual.

El **Ryzen físico** permite mostrar el mismo flujo con el ejecutor `local-vm`
`.13`, una VM por ejecución. Requiere host encendido, servicios preparados y
conectividad SSH verificada desde el lugar de la presentación. El perfil de
ayuda física probado también usó proveedor IA TEST. Su evidencia se conserva
en el [registro físico](../work/IMP-04-ayuda-fisica-13.md).

| Entorno             | Web / API   | Auth / BD     | Consideración                                                                        |
| ------------------- | ----------- | ------------- | ------------------------------------------------------------------------------------ |
| Lenovo DEV          | 3200 / 4200 | 17421 / 17422 | Desarrollo existente; no asumir corpus disponible ni Azure configurado.              |
| Lenovo TEST         | 3300 / 4300 | 18421 / 18422 | Respaldo local con flujo completo e IA TEST explícita.                               |
| Lenovo Azure07      | 3400 / 4400 | 19421 / 19422 | Ayuda Azure real; seguir su guía y las actividades propias de LAB-EVAL.              |
| Ryzen physical TEST | 3300 / 4300 | 18421 / 18422 | Proyecto y volúmenes propios del Ryzen; acceso desde Lenovo mediante túnel loopback. |

TEST local y los forwards al Ryzen ocupan los mismos puertos del Lenovo:
seleccionar uno. Cambiar de red no vuelve accesible una dirección privada del
Ryzen. Si no existe conectividad ya comprobada, usar la demo local y presentar
la evidencia física fechada como antecedente. No abrir puertos públicos para
resolver la presentación.

Azure tiene un [guion independiente](demo-profesor-azure.md), con calibración
auténtica y ayuda real. No mezclar sus actividades, fuentes, cuentas o reservas
con las de TEST. Los rechazos previos se conservan en el
[registro de recuperación](../work/DEMO-recuperacion-fuentes-2026-11-19.md).

## Revisión anterior a la presentación

Los datos y pasos de preparación siguientes ya se completaron en el fixture
vigente. Revisarlos; no crear otro lote ni repetir la carga para la demo de mañana.

1. Seleccionar y anotar entorno, URL, fecha y candidato. Comprobar propietario
   de procesos, puertos y lock antes de iniciar nada. Conservar datos,
   volúmenes y evidencias anteriores.
2. Verificar cuentas ficticias ACTIVE de profesor y estudiante de la misma
   organización. Las cuentas canónicas son `teacher.a@alunza.test` y
   `student.a@alunza.test`; su existencia y acceso deben comprobarse en el
   destino elegido. Consultar la contraseña solo por el operador en el estado
   privado correspondiente, fuera de la pantalla compartida.
3. Usar perfiles de navegador separados para profesor y estudiante. Dos
   pestañas del mismo perfil comparten sesión y no representan dos roles
   independientes. Dejar abiertas únicamente las páginas necesarias.
4. Preparar mediante UI/API autorizada una clase adicional identificada
   `DEMO-AAAAMMDD` con la fecha real, con profesor asignado y estudiante incorporado, y dos
   actividades Formativas publicadas, sin ventana horaria, con un ejercicio de
   suma. Reutilizar una versión válida del banco cuando corresponda. Guardar
   sus URL reales en notas privadas; no inventar IDs ni modificar campañas
   históricas. Los datos nuevos se añaden al fixture canónico.
5. Cargar un TXT breve pertinente a suma, argumentos y retorno. Esperar
   **Disponible**, abrir su versión/fragmento y descargar el documento como
   estudiante. Usar TXT evita depender de una extracción PDF durante la demo.
   El archivo cargado y el documento citado deben ser el mismo material
   autorizado. No presentar una mera recepción como indexación completada.
6. Separar la actividad de ensayo de la actividad de presentación. En ambas
   se prepara un intento fallido real; el de presentación queda sin ayuda ni
   corrección hasta la demo. Su ID debe tener una autorización TEST acotada
   vigente. Preparar la corrección para copiarla al editor. En escena se dice
   que el primer intento se guardó durante la preparación; no simular un envío
   nuevo ni solicitar ayuda sobre un ID ajeno al manifiesto.
7. Dejar preparado el cuaderno docente y una copia de la hoja de comentarios.
   Comprobar tamaño de fuente, zoom, desplazamiento y descarga antes de
   compartir pantalla. Registrar los problemas encontrados, sin atribuir
   pruebas o aceptación aún pendientes.

Código con fallo conocido para «Sumar dos números»:

```js
module.exports.solve = (a, b) => a - b;
```

Corrección para un nuevo intento:

```js
module.exports.solve = (a, b) => a + b;
```

La actividad debe usar realmente ese enunciado y firma. No copiar estas
soluciones a un ejercicio diferente.

## Recorrido de 8–10 minutos

| Tiempo     | Persona y acción visible                                                                                                                                                                    | Qué explicar o comprobar                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0:00–0:45  | Mostrar la portada y entrar por `/acceso` con el profesor, o mostrar su sesión ya autenticada en `/academia`.                                                                               | «Alunza acompaña Programación I. Hoy usamos [entorno elegido]; la ayuda usa un proveedor TEST, no Azure». Las pruebas deterministas fijan el resultado.                                    |
| 0:45–2:00  | Abrir `/clases/[classId]`, la actividad reservada y **Materiales**. Mostrar **Disponible**, versión y fragmento del apunte provisional ya procesado.                                        | El profesor controla el contenido autorizado. El documento se preparó antes; esta demo no autoriza una nueva ingestión arbitraria.                                                         |
| 2:00–3:15  | Cambiar al perfil estudiante y abrir la URL de presentación reservada. Leer enunciado y prueba visible; en el historial, abrir **Ver intento #1**.                                          | «Este intento fallido se guardó durante la preparación». Mostrar su código, identificador y `FAILED_TEST`; la ayuda aún no se ha solicitado. No volver a enviarlo para obtener otro ID.    |
| 3:15–5:00  | En el intento guardado, pulsar **Pedir explicación**. Cuando esté preparada, **Abrir ayuda preparada** o **Mostrar explicación**. Abrir la referencia y **Descargar documento · versión…**. | La ayuda corresponde al código persistido y conserva el diagnóstico. Mostrar documento, versión, fragmento y ubicación. La fuente es consultable con permisos reales.                      |
| 5:00–6:30  | Escribir la corrección y realizar **Enviar intento**, con su confirmación.                                                                                                                  | Mostrar `SUCCESS`, un ID nuevo y los dos intentos de esta actividad en el historial. El original sigue fallido y conserva su ayuda. Editar el borrador no reescribe el resultado anterior. |
| 6:30–8:00  | Volver al profesor, pulsar **Ver tablero de clase**, filtrar la actividad de presentación y actualizar el corte después del nuevo intento. Abrir **Ver detalle del estudiante**.            | Mostrar evidencia y progreso de esa actividad, separados del ensayo previo. La ayuda no asigna notas ni inventa señales. Un resultado aún no actualizado se informa como tal.              |
| 8:00–10:00 | Abrir el cuaderno docente y registrar observaciones.                                                                                                                                        | Pedir opinión sobre enunciado, pertinencia de fuente, pistas y trazabilidad. Distinguir revisión del diseño de evaluación de respuestas Azure y de aceptación general del producto.        |

La ruta docente de detalle es
`/clases/[classId]/estudiantes/[studentId]`; el tablero está en
`/clases/[classId]/tablero`. Usar los enlaces de la aplicación para mantener
el contexto autorizado. No dedicar la demo breve a crear organizaciones,
gestionar invitaciones por correo o configurar infraestructura.

La autorización de este lote TEST se limita a **una explicación para el intento
de ensayo y una para el intento reservado**. No incluye pistas adicionales,
nuevas fuentes ni ayuda sobre IDs creados durante la presentación. El reintento
correcto sí es un envío nuevo real y no necesita IA. Esta delimitación pertenece
al lote de demostración; no cambia las tres pistas que contempla el producto.

## Escenarios alternativos y contingencia

| Escenario                | Precondición y conducta esperada                                                                                                                                 | Uso durante la presentación                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ayuda con fuente         | Material autorizado disponible e intento guardado. Aparece **Ayuda con fuente** con referencia verificable.                                                      | Recorrido principal.                                                                                                                                       |
| Sin fuente suficiente    | Clase adicional sin corpus recuperable, con su propio intento. Aparece **Sin fuente suficiente**, sin referencia inventada.                                      | Mostrar en lugar de la pista si se preparó y ensayó antes.                                                                                                 |
| Proveedor indisponible   | Fallo TEST controlado en un escenario propio, sin tocar otros usuarios o campañas. Aparece **Ayuda temporalmente no disponible** y el intento sigue consultable. | No improvisar fallos del servicio en la demo. Usar evidencia fechada si no hay escenario preparado.                                                        |
| Ryzen inaccesible        | Falta conectividad SSH desde la red de presentación.                                                                                                             | Seguir con Lenovo TEST y explicar que el ejecutor físico se validó en una campaña anterior.                                                                |
| Flujo local no saludable | Falla de Auth, API, ejecución, permisos o material.                                                                                                              | Conservar el fallo; mostrar solo el flujo que esté disponible y los reportes anteriores identificados. No representar capturas como una ejecución en vivo. |

Los fallbacks no consumen indebidamente una pista ni cambian el diagnóstico.
Una repetición de transporte conserva la operación; corregir código y enviar
crea un intento nuevo. Evitar clics repetidos ante una respuesta pendiente y
respetar las cuotas del producto durante ensayo y demo.

## Arranque y comprobación operativa

El entorno TEST recuperó sus volúmenes conservados, tiene 29 migraciones y
dispone de los builds y la imagen Docker requeridos. Se guardó un backup privado
antes del arranque y se verificaron salud, login real de ambos roles y rutas.
Los servicios DEV y sus datos permanecieron intactos. El lanzador conserva un
propietario y lock para evitar dos sesiones sobre el mismo entorno.

La [guía de evaluación en navegador](evaluacion-ayuda-navegador.md) documenta
el arranque aditivo de la infraestructura TEST con `up(testContext)`, la
compilación de API y la web con configuración pública TEST. El contexto y los
helpers reutilizables están en
[`scripts/test-environment.mjs`](../../scripts/test-environment.mjs):
`testApi(testContext, state)` inicia el entrypoint TEST de materiales/ayuda;
`nodeService` controla un proceso propio y `publicTestEnvironment(state)` fija
los orígenes de la web. El operador preparó un lanzador privado en
`.local/demo-profesor-20261119/launcher.mjs`. El arranque actual carga la
calibración persistida del grant 03 y pasó los doce controles de salud, login y
rutas. El flujo completo del fixture 02 pasó HTTP y Chrome por separado.

La base TEST conserva corridas de evaluación anteriores. Su ledger exige
autorización asociada a los nuevos trabajos aunque `EVALUATION_ENABLED` sea
`false`; no se debe quitar esa guarda ni borrar campañas para usar la demo.
Se conservaron las preparaciones fallidas: esperado HTTP incorrecto del
auxiliar, ingestión sin binding, API sin calibración activa y `NO_EVIDENCE`
correcto para la geometría del proveedor TEST. También quedó registrado el
rechazo de un reindexado docente de fuentes ya disponibles; el grant 03 usó
el permiso ADMIN de mantenimiento previsto. No se relajó la política de
evidencia. El fixture 02 añadió un ejercicio natural sobre función y retorno,
con ocho casos y dos actividades nuevas. El apunte original conserva identidad,
versión y bytes. Los recibos anteriores permanecen en
`.local/demo-profesor-20261119/`; ninguno se transformó en éxito.

El API de evaluación debe arrancar con `HELP_CALIBRATION_JSON` y
`HELP_CALIBRATION_CORPUS_SHA256` correspondientes al artefacto persistido y al
grant propio. Guardar la calibración en PostgreSQL no cambia por sí solo la
configuración de un proceso que ya está iniciado. El lanzador privado verifica
esa identidad antes de reutilizar el artefacto; la carga no habilita Azure ni
amplía los límites del lote.

Desde PowerShell en la raíz del repositorio, el arranque preparado es una sola
línea. Mantener abierta esa terminal y esperar `DEMO_READY` antes de abrir la
web:

```powershell
.\.tools\node-v24.21.0-win-x64\node.exe .local\demo-profesor-20261119\launcher.mjs
```

En otra terminal interactiva, fuera de la pantalla compartida, este auxiliar
muestra las credenciales ficticias locales. No copiarlas a documentación,
capturas ni mensajes:

```powershell
.\.tools\node-v24.21.0-win-x64\node.exe .local\demo-profesor-20261119\credentials.mjs
```

Al terminar, solicitar el cierre propio con:

```powershell
.\.tools\node-v24.21.0-win-x64\node.exe .local\demo-profesor-20261119\stop.mjs
```

El cierre es asíncrono: esperar `DEMO_STOPPED` y comprobar que el
`shutdown.json` de la sesión indicada por `current.json` contiene `errors: []`
antes de apagar Windows o iniciar de nuevo. No borrar el lock para saltar una
sesión todavía activa. Los auxiliares, backups y recibos permanecen en
`.local/demo-profesor-20261119/`; esta carpeta privada no se publica.

El grant actual vence el **20/11/2026 a las 23:59 de Santiago**
(`2026-11-21T02:59:00Z`). Comprobar su vigencia al abrir la demo. Reiniciar los
servicios conserva las operaciones consumidas y la ayuda reservada; no renueva
el vencimiento ni habilita más operaciones.

Antes de reutilizarlas, comprobar esquema vigente, compatibilidad del perfil
de embeddings, ausencia de controles de fallo activos y configuración del
ejecutor Docker. Preparar y comprobar la imagen local con los procedimientos
existentes de [runner](../../infra/runner/README.md), si falta. Usar un build
web correspondiente a ese destino: `NEXT_PUBLIC_*` queda incorporado al build.
`npm run dev` selecciona DEV; `eval:serve` selecciona LAB-EVAL. Ninguno cambia
automáticamente a la demo TEST.

No ejecutar `test:e2e`, `test:integration` o un wrapper que use
`withTestEnvironment` para abrir la demo: reconstruyen la BD TEST. No repetir
`db:seed`, reactivar clases cerradas ni modificar filas de campañas anteriores
para conseguir una pantalla preparada. `materials:demo` usa DEV por defecto;
no confundirlo con una carga en TEST.

Para Ryzen, seguir la [guía física](validacion-local-navegador-13.md) y comprobar
el perfil de ayuda. Los forwards deben quedar en loopback, con la huella SSH
verificada; no reutilizar el control de una campaña cerrada como lanzador de
demo. Un cambio de red exige comprobar conectividad y orígenes antes del acto.

Comprobaciones realizadas el 19/11/2026:

| Evidencia               | Resultado y alcance                                                                                                                                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operación               | Doce controles de salud/login/rutas aprobados. La auditoría final conserva doce recibos TEST completados en el grant 03 y cero ayudas consumidas del intento reservado.                                                                                                                       |
| `smoke-02.json`         | Seis controles HTTP: material disponible y descarga con SHA igual al original; intento fallido persistido; ayuda `SUPPORTED` y referencia autorizada; reintento `SUCCESS` con ID nuevo e historial de dos intentos; consulta docente; presentación todavía sin ayuda ni ejercicio completado. |
| `smoke-browser-02.json` | Tres controles en Chrome real: historial, explicación con fuente visible/editor editable/confirmación de lectura, y detalle docente con ayuda entregada. Cero HELP y cero SUBMIT adicionales; una confirmación de lectura desde la UI.                                                        |
| Capturas                | `smoke-student-help-02.png` y `smoke-teacher-detail-02.png`, dentro de la misma carpeta privada. Son evidencia del ensayo, no una demo en vivo.                                                                                                                                               |

El fixture 02 contiene tres SUBMIT reales: dos en el ensayo y uno fallido
reservado. Su única generación de ayuda se hizo por HTTP; Chrome abrió la
respuesta persistida y confirmó su lectura. La sesión de Chrome se obtuvo
mediante Auth real: este smoke no ejerció el formulario de login ni midió
latencia. Las descargas de bytes se comprobaron por HTTP; Chrome comprobó la
referencia visible. No hubo llamadas Azure ni aceptación pedagógica del profesor.

Antes de salir hacia la presentación, comprobar Docker Desktop, batería/cargador
y arranque local; conservar la ayuda reservada. Al cerrar, esperar cero trabajos
propios pendientes y detener únicamente la sesión de demo con su auxiliar.

## Hoja de comentarios del profesor

Conservar esta plantilla vacía y completar una copia durante la revisión.
No equivale a aprobación del MVP ni a calificación pedagógica del proveedor.

| Campo                                                     | Registro de la sesión                       |
| --------------------------------------------------------- | ------------------------------------------- |
| Revisor y fecha                                           | Pendiente                                   |
| Entorno, candidato y actividad observados                 | Pendiente                                   |
| Enunciado y prueba visible comprensibles                  | Pendiente; comentario y ejemplo             |
| Fuente pertinente y trazable                              | Pendiente; documento, versión y observación |
| Pista orienta sin entregar la solución                    | Pendiente; nivel y observación              |
| Diferencia entre intento, ayuda y reintento clara         | Pendiente; dificultad observada             |
| Evidencia docente suficiente para acompañar al estudiante | Pendiente; información que falta            |
| Cambio prioritario y criterio para comprobarlo            | Pendiente                                   |

El cuaderno ya preparado está en
`.local/eval-preparation/teacher-review-20261118-01/teacher-corpus.md`, junto a
`teacher-design-review.json`. Sus 12 documentos y 47 fichas son ficticios y
sirven para revisar el diseño; no contienen respuestas Azure observadas.
Consultar la [guía de revisión docente](revision-docente-corpus.md) antes de
editar una copia. El [registro de feedback visible](../work/IMP-04-feedback-visible-corpus.md)
separa resultados TEST anteriores, fallos conservados y aceptación pendiente.
