# Web de identidad, gobierno y aprendizaje

Next.js App Router presenta `/` (estado de servicios), `/acceso`, `/inicio`, `/administracion/organizaciones`, `/administracion/organizaciones/[orgId]/usuarios` y `/acceso/invitacion`. Supabase Auth gestiona sesión y contraseñas; todas las consultas y mutaciones de dominio llegan a NestJS y se validan con los esquemas públicos de `@alunza/contracts`. No hay API de negocio paralela, Server Actions ni consultas directas a tablas Supabase.

## Sesión y contexto

`SessionProvider` es la única suscripción persistente a Auth. Comprueba `/me` al cambiar sesión o ruta y retira la proyección anterior durante una actualización. Las vistas privadas se desmontan al cerrar sesión; las peticiones de una vista se cancelan al abandonarla. El inicio permite elegir una organización autorizada y muestra el rol de esa membresía. Una organización archivada se presenta en solo lectura. Una identidad sin membresías puede consultar su inicio y utilizar su permiso explícito de aprovisionamiento, si existe.

La sesión del SDK persiste en almacenamiento local con prefijo por proyecto y renueva sus tokens. Los permisos nunca proceden de `user_metadata`. El cierre afecta la sesión de este navegador; los JWT emitidos vencen según Supabase y no se afirma revocación instantánea por logout. Deshabilitar una membresía no cierra las sesiones de otras organizaciones.

`apiRequest` utiliza exclusivamente el origen público configurado, bearer explícito, `credentials: omit`, `redirect: error`, `no-store` y plazo de diez segundos. Valida respuestas runtime y conserva errores por campo, `Retry-After` y ETag. Las mutaciones usan `If-Match` cuando corresponde y una clave de idempotencia; un desenlace incierto conserva clave, carga y versión para reintentar en la misma vista. La API vuelve a validar permisos y estado en cada operación.

## Administración

Las organizaciones se listan con paginación dentro del permiso vigente. Crear consume un permiso de aprovisionamiento; editar y archivar usan la revisión recibida. Los conflictos de dependencias, duplicado y última administración se explican desde el resultado real del servidor.

Usuarios permite buscar por nombre/correo, filtrar rol/estado, invitar y cambiar accesos locales. Las invitaciones muestran separadamente aceptación y entrega del correo, con actualización de estados, reenvío y revocación. Reenviar invalida el enlace anterior y renueva las 72 horas de la invitación. Una operación en cola o con entrega incierta nunca se presenta como aceptación completada.

## Aceptación de invitaciones

El callback recibe `invitationId`, `invitationToken`, `generation`, `token_hash` y `type` en el fragmento del enlace. Los valida, retira la URL completa del historial visible y conserva la prueba únicamente en memoria de la vista. Recargar o salir exige volver a abrir el enlace del correo. No se registran tokens en consola, rutas de dominio ni almacenamiento adicional.

La persona debe pulsar **Continuar** antes de `verifyOtp`; abrir el enlace por sí solo no acepta la invitación. Después se confirma la aceptación mediante NestJS. Para una cuenta nueva se solicita nombre y contraseña de al menos doce caracteres; una identidad existente conserva su contraseña. Si Auth fue confirmado pero el alta quedó interrumpida, `/me` permite detectar la falta de perfil y retomar ese paso. La contraseña se establece con un cliente Auth efímero ligado a la sesión verificada, sin almacenamiento persistente, para no cambiar otra cuenta si una pestaña modifica la sesión global durante la operación.

Una comprobación Auth vencida puede renovarse con la prueba de invitación vigente mediante el endpoint acotado de NestJS. Esta renovación no amplía el vencimiento de la invitación. La pertenencia solo se confirma al recibir una respuesta ACTIVE del servidor.

## Configuración y verificación

Se conservan las tres variables públicas de `.env.example`. Se validan en build y start; el error enumera únicamente nombres de variables. `NEXT_PUBLIC_*` se incorpora durante build y requiere reconstrucción al cambiar. Claves administrativas no se admiten en el navegador. `scripts/start-standalone.mjs` aplica la misma validación al iniciar la imagen.

No se añadieron dependencias. Se mantienen Tailwind, Zod y los componentes shadcn existentes; los diálogos se componen con Radix instalado. Etiquetas, errores asociados, foco de diálogo, teclado, estados textuales y tablas con encabezados forman parte del diseño. La revisión de código y los checks estáticos no acreditan conformidad WCAG completa ni aceptación CAPSTONE.

Desde la raíz Git con el runtime fijado: `npm run lint -w @alunza/web`, `npm run typecheck -w @alunza/web` y `npm run test -w @alunza/web`. La integración real se ejecuta con los arneses de raíz `npm run test:integration` y `npm run test:e2e`; sus resultados se registran separadamente.

## Estructura académica y contenido (IMP-02)

Desde Inicio se accede a `/academia/[orgId]`, que conserva el rol y la organización vigentes. El administrador crea y edita cursos, clases, asignaciones y conceptos; el profesor configura sus clases y emite códigos colectivos con vigencia sugerida de siete días. Los códigos solo se muestran al emitirlos y no se persisten en el navegador. Su creación no se reintenta automáticamente cuando el desenlace es incierto: se ofrece revisar y revocar los registros correspondientes.

La taxonomía está en `/academia/[orgId]/conceptos`, el banco en `/academia/[orgId]/ejercicios`, y cada clase en `/academia/[orgId]/clases/[classId]`. Los ejercicios se editan creando versiones, con pruebas visibles/ocultas, argumentos/resultados JSON, conceptos y límites. Los administradores consultan metadatos y archivan el banco sin descargar las definiciones privadas. Los selectores cargan todas las páginas autorizadas para no omitir cursos, profesores o conceptos después de los primeros cien registros.

El profesor compone actividades en la clase, ordena sus ejercicios con botones accesibles y confirma publicación/cierre. El formulario indica que publicar fija el último borrador guardado. Las fechas académicas se conservan como `YYYY-MM-DD`; las fechas de actividad y vencimiento se introducen y muestran en `America/Santiago`, independientemente de la zona del navegador. Una hora inexistente o repetida en un cambio de horario se rechaza con una indicación para elegir otra.

El estudiante verifica un código y confirma su incorporación antes de crear la membresía. La lista muestra solo sus clases; las actividades muestran estados confirmados por la API, sin progreso ficticio. La solución se prepara en `/academia/[orgId]/actividades/[activityId]/ejercicios/[assignmentId]` con un textarea monoespaciado. Tab y Shift+Tab salen del editor normalmente. No se habilitan ejecución, envío ni ayuda en esta fase.

Los borradores usan `sessionStorage` con clave versionada por cuenta, organización, clase, asignación y versión. Se guardan al escribir y sobreviven a la recarga de esa pestaña; el cierre o cambio de cuenta intenta retirar todos los borradores de Alunza, conservando claves de otros productos. Si el navegador bloquea almacenamiento, la vista conserva plantilla/texto en memoria y comunica que no pudo recuperar/guardar. Nunca afirma que un guardado fallido tuvo éxito. Las claves por identidad impiden que otra cuenta cargue el borrador anterior. Al cerrar la pestaña termina la retención de sesión del navegador.

Si falla la eliminación local, el cierre de Auth continúa y un aviso separado pide cerrar la pestaña para retirar los borradores. Mientras la limpieza esté pendiente no se recupera ni guarda código local; el editor conserva únicamente el texto en memoria. La siguiente entrada de Auth reintenta la limpieza, incluida una entrada con la misma cuenta. Una sesión autenticada recuperada al recargar no dispara un borrado, para conservar la recuperación normal del borrador.

La disponibilidad se consulta al abrir el ejercicio, cada treinta segundos mientras está visible y al volver el foco. Una denegación vuelve el editor de solo lectura y conserva el texto para copiarlo. La comprobación manual está disponible; una falla de red muestra error sin borrar la solución. La API sigue siendo la autoridad para permisos y fechas.

`test/academic-local.test.mjs` verifica aislamiento, borrador vacío, recuperación, errores de lectura/escritura, limpieza selectiva y conversión de horas de Santiago. Los escenarios con API real, teclado, cierre y almacenamiento bloqueado corresponden a la suite Cypress de raíz; registrar sus resultados reales antes de contar RF completos.

Referencias de integración: [Supabase verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp), [Supabase updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser), [páginas App Router](https://nextjs.org/docs/app/api-reference/file-conventions/page) y [diálogos Radix](https://www.radix-ui.com/primitives/docs/components/dialog).
