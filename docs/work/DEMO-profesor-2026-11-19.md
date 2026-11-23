# Preparación de demostración al profesor — 19/11/2026

Objetivo: presentar el recorrido de Alunza y obtener observaciones del profesor.
Es una demostración técnica preliminar, no aceptación docente del corpus ni
validación productiva. Se conservan los límites de ejecución, AD-ARQ-001 y
AD-IA-001. La preparación empezó sin autorización externa. Posteriormente el
usuario autorizó crear el recurso Azure de la propuesta y hasta US$5 de
inferencia; no autorizó desplegar la aplicación en la nube.

## Estado comprobado antes de preparar el ensayo

- Lenovo: Docker y los servicios de datos DEV del laboratorio están activos;
  web/API DEV y TEST no estaban escuchando al iniciar la revisión. No se debe
  ejecutar `db:seed`, borrar volúmenes ni confundir DEV con LAB-EVAL.
- Ryzen: accesible por SSH con identidad fijada, Linux físico y KVM. Los cinco
  contenedores del laboratorio físico están detenidos; no hay QEMU activo ni
  servicios de la aplicación escuchando. No tiene una VPN de acceso remoto
  preparada. El acceso LAN actual no acredita acceso desde el instituto.
- La evidencia del 18/11 acredita intento persistido, ayuda con fuente,
  degradación y reintento en el Ryzen con proveedores de IA TEST. No acredita
  inferencia Azure. Véase [el registro físico](IMP-04-ayuda-fisica-13.md).
- La integración Azure existe. `productionHelpFactory` exige configuración de
  embeddings y generación, un artefacto `help-evidence-2` y su comprobación
  contra recibos de calibración. Configurar una clave no basta para habilitar
  la ayuda. La ingestión con embeddings es independiente de esta calibración.
- El usuario confirmó un día hasta la demostración, que llevará el Lenovo y
  que puede compartir internet desde su teléfono. Sigue sin Azure OpenAI.
  Confirmó además que no tiene una suscripción Azure, eligió funciones y
  `return` y no dispone todavía de un apunte propio. Se prepara material
  ficticio provisional para la demostración.

## Elección de recorrido

| Opción                             | Preparación pendiente                                                                                             | Uso recomendado                                                                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lenovo local                       | Recuperar TEST y ensayar ejecución y ayuda; DEV conserva solo nueve migraciones.                                  | Ruta recomendada para esta visita: aplicación y datos locales, con internet solo para Azure si llega a estar habilitado. No atribuirle las métricas físicas. |
| Ryzen por red privada              | Instalar/configurar acceso privado en ambos equipos, recuperar servicios de laboratorio y ensayar desde otra red. | Alternativa si es imprescindible demostrar el ejecutor físico; añade una dependencia de red que la demo local evita.                                         |
| Publicación por puertos del router | Nueva operación y exposición que no están preparadas.                                                             | No es necesaria para esta visita.                                                                                                                            |

Tailscale permite conectar equipos de redes distintas y normalmente no requiere
abrir puertos entrantes. Es una opción por configurar, no una conexión existente.
Reutilizar SSH con su clave de host fijada y túneles enlazados a `127.0.0.1`;
mantener web, API y Auth en los mismos orígenes que el navegador espera. La VPN
por sí sola no inicia estos servicios. Limitar el acceso a los equipos propios;
no habilitar Funnel ni publicar PostgreSQL, Docker o puertos de control.

Antes de salir, comprobar el recorrido con el Lenovo conectado al teléfono o a
otra red. Si ese ensayo no pasa, usar la alternativa local y evidencias fechadas.
El Ryzen necesita permanecer encendido, conectado y sin suspensión durante la
presentación. La latencia de LAN no garantiza el mismo tiempo por internet.

Referencias oficiales consultadas el 19/11/2026:
[conectar equipos](https://tailscale.com/docs/how-to/connect-to-devices) y
[puertos y conectividad](https://tailscale.com/docs/reference/faq/firewall-ports).

## IA real y documentos propios

RAG indexa fragmentos de documentos autorizados y recupera los pertinentes como
contexto para una respuesta con citas. No modifica los pesos del modelo. Alunza
admite TXT, Markdown y PDF con texto extraíble de hasta 10 MB; no incluye OCR.
El docente asocia el material a la clase/actividad, espera su estado `READY`
y comprueba las referencias desde la ayuda de un intento persistido.

Para demostrar Azure de forma auténtica faltan:

1. Recurso accesible, permisos, región y cuota, más deployments de embeddings y
   generación. La verificación puede usar el de generación si la configuración
   admite y registra ese perfil. No hace falta desplegar la web o la API en
   Azure ni añadir Azure AI Search; la recuperación ya usa pgvector.
   Debe comprobarse también el ciclo de vida del modelo: el ejemplo histórico
   `gpt-4.1-mini-2025-04-14` está deprecado y no debe recomendarse para una
   suscripción nueva sin disponibilidad efectiva. Una tarifa publicada no
   acredita que el usuario pueda desplegarlo.
2. Configuración privada compatible con modelo, dimensión y tokenizer, sin
   reutilizar un índice TEST como evidencia de embeddings Azure.
3. Vincular la autorización explícita de hasta US$5 de inferencia al destino,
   candidato y perfil efectivos. La cuenta/suscripción aún debe activarla el
   usuario; configurar y comprobar las reservas antes de cualquier llamada.
4. Ingestión real, calibración de pertinencia y validación separada, con recibos
   auténticos. El mínimo técnico del arnés usa cuatro casos, no equivale a una
   evaluación pedagógica suficiente. La ruta existente de evaluación es LAB-EVAL
   con Docker; no se debe asumir que el lanzador físico TEST acepta Azure.
5. Ensayo de un intento fallido, ayuda sustentada con cita consultable y nuevo
   intento, manteniendo funcionamiento ante indisponibilidad del proveedor.

No es necesario completar la revisión pedagógica de las 47 fichas para explicar
una prueba técnica preliminar; tampoco se puede presentar esa prueba como
aceptación docente. La revisión conserva 28 aceptaciones preliminares y 19
pendientes, con validación docente pendiente para las 47.

Procedimiento existente: [preparación de evaluación Azure](../guides/preparacion-evaluacion-azure.md).
La selección actual se concreta en [requisitos Azure para la demo](../guides/demo-azure-requisitos.md).
Requisitos del proveedor: [recurso y modelos](https://learn.microsoft.com/en-us/azure/foundry-classic/openai/how-to/create-resource)
y [embeddings](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/embeddings).

La propuesta privada está en `.local/demo-azure-20261119/proposal.json`, con
configuración de ejemplo sin credenciales en `provider-draft.json`. Propone
`text-embedding-3-small` a 1536 dimensiones y `gpt-4o-2024-11-20` para generación
y verificación. Este último figura como Legacy, que admite nuevos deployments
según la política de Microsoft; falta disponibilidad efectiva en la suscripción.
Se propone East US 2 y el usuario ya autorizó un máximo de US$5 de inferencia.
La disponibilidad del destino sigue sin comprobarse en una suscripción propia.
No se ha configurado un límite de consumo ni creado el manifiesto de ejecución.
`proposal-before-authorization.json` conserva el borrador previo; `proposal.json`
registra la autorización y mantiene `authorizedForInference=false` hasta resolver
las precondiciones técnicas. No es una segunda solicitud de permiso.

La consulta pública de precios del 19/11 devolvió tres medidores en USD/1000
tokens: embeddings regionales 0,000022; entrada global GPT-4o 0,0025 y salida
0,01. El recibo completo está en
`.local/demo-azure-20261119/public-retail-prices-gpt4o-verified.json`.
Como ejemplo de volumen, 100.000 tokens de embeddings, 100.000 de entrada y
20.000 de salida para generación y verificación suman US$0,4522, sin impuestos
ni conversión. No es una cotización de la suscripción ni una medición de la
demo; el perfil exacto y sus reservas deben fijarse antes de cualquier llamada.

## Guion y comprobaciones antes de declarar la demo lista

Usar el [guion para el profesor](../guides/demo-profesor-guion.md). Verificar
acceso docente y estudiante, material, envío fallido, cita, reintento correcto
e historia. Separar perfiles de navegador para evitar compartir la sesión.
Rotular cualquier proveedor TEST y cualquier captura histórica. Una respuesta
de prueba no debe presentarse como generación real.

## Preparación y fallos conservados

Se prepararon lanzador, consulta local de credenciales, cierre y recibos privados
en `.local/demo-profesor-20261119/`. Cada arranque usa un directorio nuevo,
lock exclusivo, respaldo PostgreSQL y comprobaciones de esquema/permisos.
Se verificaron 29 migraciones, salud y acceso de ambos roles. DEV y los recursos
anteriores se conservaron. No se ejecutaron resets, seeds ni migraciones.

La base TEST conserva campañas históricas: su guard exige bindings del registro
de evaluación también para nuevos materiales y ayudas. Se preparó por API una
corrida TEST acotada, con cuatro casos de calibración en una clase separada,
cuatro fuentes de calibración y reindexación del material de demo. Hay dos
intentos fallidos reales, uno de ensayo y otro reservado para mañana en una
actividad distinta. Cada uno tiene una explicación autorizada; enviar otro
intento no autoriza automáticamente una ayuda adicional sobre ese nuevo ID.

La corrida `6c6b8feb-35d9-4314-8d7f-461aadeb9712` completó ingestión y
calibración con nueve recibos TEST. Su candidato al autorizar fue
`25dedbfbd2ddd4688c967f62b40d24dccf91cd63ea2f6162e5201100d7506ee6`.
El inventario está en `evaluation-source-snapshot.json`; las preimágenes de
estas guías y del índice de estado se conservaron en `source-at-grant/docs`
antes de actualizar documentación posterior al ensayo. No se cambió código
del producto. El grant expira el 20/11/2026 a las 23:59 de Santiago y se conserva
al detener servicios, distinguiendo un grant preparado de trabajos en curso.

Se conservaron un primer timeout de arranque, una expectativa incorrecta del
auxiliar de matrícula (el contrato devuelve 200), el rechazo de ingestión fuera
del registro y un feedback `PROVIDER_UNAVAILABLE / CONFIGURATION_MISSING`.
Este último ocurrió antes de consumir operaciones o recibos: la calibración
persistida también debe cargarse en la configuración del consumidor. El
lanzador ahora la comprueba contra la base y el owner antes de inyectarla.
El reintento usa otra clave y conserva la respuesta anterior.

Se verificó un cierre con cero trabajos pendientes, un grant propio preservado
y sin errores. La observación final en navegador se registra por separado;
un arranque saludable no acredita el recorrido completo.

### Preparación corregida y registros conservados

Con la calibración cargada, la segunda ayuda del primer ensayo terminó
`NO_EVIDENCE`, correctamente según la política TEST. El embedding controlado
detecta la palabra «función»: el enunciado anterior no la contenía y su distancia
al apunte fue 0,167100278909376, por encima del umbral medido de cero. Esto
expone una limitación del proveedor de prueba, no una medición semántica de
Azure. Se conservó el resultado y su consumo; no se cambió el umbral.

La preparación siguiente creó dos actividades con el enunciado «Completa una
función solve(a, b) que reciba dos números y devuelva su suma», ocho casos y
los límites existentes. Se verificaron las consultas exactas de los cuatro
casos de calibración y de ambos intentos antes de autorizar otro lote. Los dos
positivos de calibración y los dos intentos recuperan distancia cero; los
negativos permanecen fuera del umbral. Los cuatro casos de calibración y sus
materiales se reutilizaron con recibos nuevos, sin alterar los originales.

El segundo grant, `4bf8e3ce-a21c-471a-8b69-d6f487252412`, se detuvo por API
con cero recibos: el primer REINDEX recibió 403 porque el docente solo puede
reintentar fuentes FAILED; el mantenimiento de una fuente READY exige ADMIN.
La tercera preparación utiliza ese permiso de mantenimiento implementado,
sin conceder a ADMIN lectura pedagógica ni modificar los guards.

El grant vigente de esta preparación es
`dffae07c-114e-48e8-bb15-6a7f09cd13d0`, candidato
`2f2d95455bd3fa34487d9c7bd98bdebbcb98db34e95ef71849d0d78240043395`.
Se guardaron su inventario `evaluation-source-snapshot-03.json` y cuatro
preimágenes documentales en `source-at-grant-03/docs/`, dentro de la carpeta
privada de demo. Las actualizaciones documentales posteriores no forman parte
de esa huella. Completó cinco reindexaciones y cuatro observaciones de
calibración con nueve recibos TEST; el control posterior de seis consultas
también aprobó y registró cero trabajos pendientes. El primer grant permanece
STOPPED con diez recibos y el segundo STOPPED con cero. No se borraron
fallos ni se ampliaron sus operaciones inmutables.

El nuevo lote mantiene dos ayudas, una para ensayo y otra reservada para el
intento de presentación `fb8545f7-9394-4a49-b3a9-c34c8fb0ee91`, con el mismo
vencimiento. Su artefacto está en `evaluation-ledger-03/calibration.json`.
La autorización de cada ayuda está ligada al intento ya persistido; una nueva
entrega de código permite un resultado nuevo, pero no añade bindings de ayuda.

### Resultado final del ensayo local

El 19/11/2026 a las 13:29 de Santiago la sesión quedó READY en
`http://127.0.0.1:3300`, API `http://127.0.0.1:4300`. El arranque con el
artefacto 03 comprobó identidad de corpus y calibración contra la base. API y
web estuvieron listas en 2,075 s y 0,910 s respectivamente, dentro del plazo
existente; estos tiempos de arranque no son latencia de ayuda ni p95.

- Doce comprobaciones de salud, autenticación y consultas aprobaron.
- El ensayo HTTP aprobó seis controles: fuente READY y descarga con SHA-256
  coincidente, intento guardado antes de la ayuda, `SUPPORTED` con referencia
  autorizada, reintento nuevo `SUCCESS` conservando el original e historial de
  dos intentos, consulta docente y reserva de presentación sin consumir.
- Chrome aprobó tres controles: historial de los dos intentos, ayuda y fuente
  visibles con editor editable y acuse real de lectura, y consulta docente del
  intento y su ayuda entregada. No emitió más HELP ni SUBMIT.
- La auditoría final de solo lectura registró cero trabajos de materiales,
  ayuda, ejecución, reservas de entrega, llamadas despachadas o calibraciones
  en curso. El grant 03 sigue RUNNING para mañana, con 12 recibos TEST completos:
  diez embeddings, una generación y una revisión. Ensayo consumido 1/1;
  presentación reservada 0/1 y sin solicitudes de ayuda.

La autenticación de las cuentas se comprobó contra Auth. Chrome recibió esas
sesiones reales mediante el auxiliar: este ensayo no comprobó escribir una
contraseña en el formulario ni enviar código desde el editor. Los intentos y
la solicitud de ayuda se hicieron por API; Chrome comprobó su presentación,
referencias, lectura y vista docente. No se ejecutó la suite general ni se
midió un nuevo p95.

Evidencias privadas: `smoke-02.json`, `smoke-browser-02.json`,
`smoke-student-help-02.png` y `smoke-teacher-detail-02.png`. El intento de ensayo
es `0a4e9d1a-189d-41c6-8bb8-218eaec2d786`; la ayuda
`6b647f88-87cc-44ac-a380-aba8682119be` y el reintento correcto
`6e86217f-cbe6-45c3-b1e1-7a94616390e8`. Los recibos operativos finales están en
`sessions/2026-11-19T16-27-04.447Z-82443a75-a0d2-4234-a66b-8ee1b1470e01/`,
incluidos `database-audit-1795105746425.json` y
`access-check-1795105746987.json`. La sesión permanece encendida; el guion
documenta cómo detenerla y volver a iniciarla sin perder sus datos.

Se preparó también un apunte más amplio de funciones y `return` en
`.local/demo-azure-20261119/apunte-funciones-return.md`, SHA-256
`d34b1c2c7cde94ec2df34682feb75f9c626556beb4ea5242c36c9e1c8eb123a5`.
Es provisional y no sustituye el TXT de esta corrida ni acredita ingestión Azure.
El siguiente paso externo depende del usuario: activar su suscripción Azure.
La autorización de hasta US$5 ya está registrada; falta concretar y comprobar
destino, cuota, modelos y reservas antes de realizar inferencia.

## Alcance del ejecutor de esta demo

El Lenovo utiliza el adaptador Docker de desarrollo, imagen
`alunza-laboratorio-runner-capsule:imp-03-quickjs-2`, digest que empieza por
`sha256:99d10926`, con reservas persistidas de 128 MiB, 3000 ms y 65536 bytes,
y retiro confirmado. La configuración aplica una CPU y 128 MiB al contenedor,
con swap limitado al mismo total. Esta ruta no crea una VM ni una frontera
exterior propia de 2 GiB por ejecución: no acredita las dos capas del candidato
físico `.13`, aislamiento productivo ni su p95.

El opt-in preparado exige Linux junto al daemon, socket Unix, cgroup v2/systemd,
runtime verificado y un ancestro común observado. Windows con Docker Desktop
no cumple esas precondiciones. No se cambiaron guards, imágenes ni límites para
forzarlo. La demo se limita al recorrido funcional; la evidencia de aislamiento
físico permanece en el registro del Ryzen. Este límite debe comunicarse al
presentar, sin convertir el ensayo Docker en aceptación del ejecutor.

Azure no se ha conectado y no se ha realizado ninguna inferencia externa. No se
configuró VPN ni se abrió el router. El corpus congelado y sus aceptaciones se
conservaron; el material de la demo es adicional y su revisión docente está
pendiente.
