# IMP-02 — Guía local y demostración académica

> Registro histórico del incremento indicado. Conserva sus resultados y límites originales; el estado vigente al 23/10/2026 es **14/27 RF probados localmente (51,9 %)** y se detalla en [Estado actual](ESTADO-ACTUAL.md).

Esta guía describe el recorrido a demostrar. No constituye un informe de pruebas ejecutadas ni una aceptación del profesor. El objetivo funcional es completar ALZ-RF-002, ALZ-RF-003, ALZ-RF-004, ALZ-RF-008, ALZ-RF-022 y ALZ-RF-023, conservando la regresión de ALZ-RF-001, ALZ-RF-020 y ALZ-RF-021. Solo después de verificar los escenarios se podrá registrar 9/27 = 33,3 % funcional.

## Preparar el entorno local

Trabajar desde la raíz Git `C:\Users\Lenovo\Desktop\alunza-edu\alunza-edu`, con Docker Desktop y su motor Linux disponible. La carpeta contenedora y los respaldos vecinos no son el repositorio.

```powershell
git rev-parse --show-toplevel
. ./scripts/use-node.ps1
npm ci
npm run local:doctor
npm run local:up
npm run db:migrate
npm run db:seed
npm run dev
```

`npm ci` corresponde a la preparación inicial o a un cambio de dependencias. Para continuar en un entorno ya instalado, conservarlo y ejecutar únicamente los pasos pendientes. `db:migrate` aplica migraciones incrementales; no reinicializa la base de desarrollo. `db:seed` prepara el conjunto ficticio de identidad y llama a `scripts/academic-seed.mjs`. La ampliación académica usa identificadores fijos y conserva las versiones que ya existen; volver a sembrar no deshace una demostración anterior.

Abrir [Alunza local](http://127.0.0.1:3000). La API local usa `127.0.0.1:4000`; Auth usa `127.0.0.1:15421`. El comando `npm run local:credentials`, ejecutado por el presentador en una terminal interactiva local, permite consultar la contraseña ficticia. No incluir contraseñas, códigos vigentes, tokens, archivos `.env*` ni contenido de `.local/runtime.json` en capturas o informes. Los correos de esta guía son identidades ficticias.

Detener el desarrollo con `Ctrl+C`. `npm run local:down` detiene Supabase de Alunza conservando los datos. El entorno de pruebas separado usa puertos `16421–16424`, API `4100` y web E2E `3100`; no debe confundirse con la demostración.

## Conjunto canónico y navegación

La ampliación prepara **2 organizaciones, 2 administradores, 2 profesores, 8 estudiantes, 3 clases y 10 ejercicios**. Los casos adversariales se preparan por separado en los arneses de pruebas.

| Organización           | Cuentas principales                                                     | Estudiantes adicionales                                                      | Clases                                 |
| ---------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------- |
| Institución Ficticia A | `admin.a@alunza.test`, `teacher.a@alunza.test`, `student.a@alunza.test` | `student.a2@alunza.test`, `student.a3@alunza.test`, `student.a4@alunza.test` | Programación I · Sección 1 y Sección 2 |
| Institución Ficticia B | `admin.b@alunza.test`, `teacher.b@alunza.test`, `student.b@alunza.test` | `student.b2@alunza.test`, `student.b3@alunza.test`, `student.b4@alunza.test` | Programación I · Sección 3             |

`student.a@alunza.test` queda deliberadamente sin inscripción inicial para demostrar la confirmación de incorporación. El banco contiene cinco ejercicios por organización. Hay tres conceptos por organización y una actividad publicada por cada clase. El seed no deja códigos reutilizables impresos: el profesor genera uno mediante la interfaz durante la demostración.

Inicio presenta la organización, el rol y los enlaces permitidos. Para el estudiante también muestra sus clases activas. Las rutas mantienen la organización en el contexto:

| Ruta                                                                                 | Uso y actor                                                                                                    |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `/acceso`, `/inicio`                                                                 | Iniciar/cerrar sesión y seleccionar la organización autorizada.                                                |
| `/administracion/organizaciones` y `/administracion/organizaciones/[orgId]/usuarios` | Gobierno institucional y asignación del rol profesor por ADMIN.                                                |
| `/academia/[orgId]`                                                                  | ADMIN: cursos y clases; TEACHER: sus clases; STUDENT: propias clases e incorporación.                          |
| `/academia/[orgId]/conceptos`                                                        | ADMIN: crear, editar, consultar versiones y archivar conceptos.                                                |
| `/academia/[orgId]/clases/[classId]`                                                 | Datos de clase, códigos autorizados y actividades para profesor/estudiante. ADMIN reasigna profesor y archiva. |
| `/academia/[orgId]/ejercicios`                                                       | TEACHER: banco autorizado; ADMIN: metadatos y archivo.                                                         |
| `/academia/[orgId]/ejercicios/nuevo` y `/academia/[orgId]/ejercicios/[id]`           | TEACHER: definición completa y nuevas versiones.                                                               |
| `/academia/[orgId]/clases/[classId]/actividades/nueva`                               | TEACHER: composición ordenada del borrador.                                                                    |
| `/academia/[orgId]/actividades/[activityId]`                                         | TEACHER: editar, publicar/cerrar; STUDENT: consultar la actividad autorizada.                                  |
| `/academia/[orgId]/actividades/[activityId]/ejercicios/[assignmentId]`               | STUDENT: preparar solución con pruebas visibles y borrador local.                                              |

## Guion principal ante el profesor

1. **Administrador A: estructura.** Iniciar sesión y abrir **Cursos y clases**. Crear un curso con código nuevo, nombre, período y fechas académicas coherentes. Crear una clase dentro del curso y seleccionar **Profesor A**. Abrirla, editar su nombre, guardar y recargar. Mostrar que se conservaron curso, clase y asignación. Si se repite el guion, usar códigos nuevos o continuar los registros existentes; el servidor rechazará duplicados.
2. **Administrador A: conceptos.** Abrir **Conceptos**, crear un concepto de demostración y otro relacionado mediante **Concepto superior**. Editar su descripción y mostrar **Ver versiones**. Conservar al menos un concepto activo para los ejercicios. Las versiones anteriores permanecen consultables.
3. **Profesor A: configuración y código.** Cerrar sesión, entrar como `teacher.a@alunza.test` y abrir la clase creada. Editar datos básicos, generar un código con vencimiento de siete días y copiarlo temporalmente para la demostración. La vigencia se presenta en hora de Santiago. El código solo aparece al generarlo; el listado posterior muestra vigencia, usos y revocación.
4. **Profesor A: dos ejercicios.** Abrir **Ejercicios → Crear ejercicio**. Guardar dos ejercicios con enunciado, plantilla JavaScript que declare `solve`, dificultad, conceptos, pruebas visibles y ocultas, y límites válidos. Para una suma, usar argumentos JSON `[1,2]` y resultado `3`; para un doble, `[2]` y `4`. Recuperar cada definición y comprobar sus campos. Agregar al menos una prueba oculta por ejercicio sin mostrarla durante la sesión del estudiante.
5. **Profesor A: composición y publicación.** Volver a la clase y elegir **Crear actividad**. Indicar título, tipo e instrucciones. Agregar ambos ejercicios, marcar los requeridos y usar **Subir/Bajar** para fijar el orden. Guardar el borrador, volver a abrirlo y comprobar el orden. Elegir **Publicar actividad**, revisar la confirmación y confirmar. Para la demostración inmediata, dejar las fechas opcionales vacías o elegir un intervalo que incluya el momento actual.
6. **Estudiante A: incorporación.** Cerrar sesión, iniciar como `student.a@alunza.test`, abrir **Mis clases e incorporación** e introducir el código. Pulsar **Verificar código**, mostrar el nombre de clase/curso y cancelar una vez. Comprobar que cancelar no inscribió. Verificar de nuevo y pulsar **Confirmar incorporación**. Se abre la clase y la relación aparece también al volver a Inicio. Repetir el código permite abrir la membresía existente sin duplicarla.
7. **Estudiante A: editor y borrador.** Abrir la actividad y comprobar los dos ejercicios en el orden publicado. Pulsar **Preparar solución**. Mostrar enunciado, dificultad, conceptos, plantilla, límites y pruebas visibles. Escribir una solución, observar **Borrador guardado en esta pestaña**, recargar y comprobar la recuperación. Tab y Shift+Tab salen del editor sin capturar el foco. La interfaz no presenta ejecución, envío de intentos ni ayuda IA en esta fase.
8. **Aislamiento.** Conservar la URL del ejercicio para el ensayo. Cerrar sesión, entrar como `student.b@alunza.test` e intentar esa URL. Debe mostrarse acceso no permitido sin enunciado ni editor. La cuenta de B conserva su acceso a las clases de B. Volver a A después de cerrar sesión debe recuperar la plantilla, porque el logout retiró su borrador de esa pestaña.
9. **Inmutabilidad y cierre.** Como Profesor A, crear una versión nueva de uno de los ejercicios del banco. La actividad publicada conserva la versión anterior. Abrir el editor como Estudiante A en otra sesión autorizada, escribir texto y cerrar la actividad desde Profesor A. Al pulsar **Comprobar disponibilidad**, el editor debe quedar de solo lectura, conservando el texto para copiarlo. Al abrir de nuevo la URL, el servidor debe impedir la resolución. El cierre no ofrece reapertura.

En formularios, un error conserva los campos. Un conflicto de edición ofrece **Cargar versión actual**; cargarla descarta deliberadamente ese formulario para volver a editar sobre la revisión confirmada. Publicar siempre fija el último borrador guardado: guardar cualquier cambio pendiente antes de confirmar.

## Ensayos complementarios y evidencia

- **Validación:** código de curso duplicado, fechas de clase fuera del curso, concepto duplicado/ciclo, pruebas JSON incoherentes y límites fuera del rango no deben guardar cambios.
- **Revocación:** emitir un segundo código, revocarlo y comprobar que no permite una incorporación nueva. Las membresías anteriores se conservan.
- **Archivo:** ADMIN archiva un concepto o ejercicio referenciado. La historia y las actividades publicadas se conservan; un borrador nuevo que lo utilice no debe publicarse. Para archivar una clase se deben cerrar todas sus publicaciones; para archivar el curso no debe quedar ninguna clase activa.
- **Falla de borrador:** el arnés Cypress puede bloquear lectura/escritura de `sessionStorage` sin simular API. Una lectura fallida mantiene la plantilla y muestra aviso; una escritura fallida mantiene el texto en memoria y nunca anuncia que se guardó. El editor indica copiarlo antes de salir o recargar. Si falla la eliminación durante logout, se informa que la sesión se cerró pero los borradores no se pudieron retirar: cerrar esa pestaña elimina su almacenamiento de sesión. Mientras la limpieza esté pendiente, no se recuperan ni guardan borradores; ingresar nuevamente reintenta la limpieza.
- **Fechas:** comprobar apertura inclusiva y cierre exclusivo desde la API. El navegador usa Santiago y rechaza horas inexistentes o repetidas del cambio de horario. La API valida disponibilidad en cada solicitud; el editor vuelve a consultarla al recuperar foco, cada treinta segundos visible o con el botón manual.

Registrar para cada recorrido la versión del repositorio, RF/HU/PT/E, actor ficticio, navegador, pantalla, resultado observado y limitaciones. Conservar capturas saneadas y reportes de Jest, integración, pgTAP y Cypress según la guía de pruebas. Esta guía no sustituye esos resultados ni los da por aprobados.

La entrega conserva pendientes la prueba de cierre frente a envíos reales (RF-005), el avance calculado desde intentos (RF-007) y el gobierno completo del banco (RF-024). Tampoco incluye ejecución de código, intentos, IA/RAG, materiales, progreso, señales o despliegue remoto.
