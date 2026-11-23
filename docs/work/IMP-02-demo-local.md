# IMP-02 — Demostración local del laboratorio

Reanudación del 26/09/2026 desde el commit `86c1c71`, a petición del usuario. Objetivo: abrir y comprobar el recorrido administrador → profesor → estudiante del corte ya implementado. No amplía el alcance funcional a IMP-03.

## Separación del repositorio original

La inspección encontró Supabase `alunza-edu-foundation` activo, con dos migraciones institucionales, dos organizaciones y seis perfiles. La nota privada `.local/LEEME-LABORATORIO.md` aclara que ese entorno pertenece al repositorio original. El laboratorio carecía deliberadamente de estado, claves y `.env.local`; ejecutar sus scripts antiguos habría apuntado a los recursos originales.

La configuración del laboratorio usa estos destinos exclusivos. Las guardas de scripts y pruebas deben rechazar los identificadores y bases originales antes de una mutación.

| Servicio                 | Desarrollo del laboratorio | Pruebas del laboratorio         |
| ------------------------ | -------------------------- | ------------------------------- |
| Proyecto Supabase        | `alunza-edu-laboratorio`   | `alunza-edu-laboratorio-test`   |
| Red Docker               | `alunza-laboratorio-local` | `alunza-laboratorio-test-local` |
| Web                      | `http://127.0.0.1:3200`    | `http://127.0.0.1:3300`         |
| API NestJS               | `http://127.0.0.1:4200`    | `http://127.0.0.1:4300`         |
| Auth/API Supabase        | `17421`                    | `18421`                         |
| PostgreSQL / shadow      | `17422` / `17420`          | `18422` / `18420`               |
| Studio / correo ficticio | `17423` / `17424`          | `18423` / `18424`               |

La preparación usa las migraciones existentes y el seed ficticio en una base nueva. No se copian secretos del original ni se reinicia, migra o detiene su base. La configuración privada del laboratorio permanece ignorada por Git. `db:seed` reconcilia credenciales y estados de las cuentas canónicas; no debe ejecutarse rutinariamente sobre una demo modificada.

## Guion por roles

Las cuentas ficticias son `admin.a@alunza.test`, `teacher.a@alunza.test` y `student.a@alunza.test`. Su contraseña común se obtiene con `npm run local:credentials` en una terminal interactiva local. No se guarda en esta guía. Cierra sesión al cambiar de rol; las pestañas del mismo navegador comparten sesión.

1. ADMIN entra en `/academia`, elige Institución Ficticia A, crea un curso con código de demo único y habilita Profesor A. Crea también un concepto de demo.
2. TEACHER crea una clase propia en ese curso, prepara un ejercicio «Duplicar» con el concepto, plantilla `module.exports.solve = function solve(n) { return 0; };` y una prueba visible `[3] → 6` más una oculta `[-4] → -8`.
3. En la clase, crea una actividad Formativa sin extremos horarios, agrega el ejercicio y confirma la publicación. Emite un código colectivo de una hora; se muestra una vez.
4. STUDENT revisa el código y confirma su incorporación; abre clase, actividad y ejercicio. Solo aparece la prueba visible.
5. Edita a `module.exports.solve = (n) => n * 2;`, comprueba guardado local y recuperación al recargar. Tab sale del editor. Salir y volver con la misma cuenta conserva el borrador tras reautorizar.
6. Para consulta histórica, usa la actividad canónica cerrada «Práctica de consulta». No es necesario cerrar irreversiblemente la publicación nueva de demo.

Usa registros nuevos etiquetados con fecha para la autoría; no alteres los identificadores canónicos. El conjunto base conserva dos organizaciones, dos administradores, dos profesores, ocho estudiantes, tres clases y diez ejercicios. Los registros creados durante una demostración son adicionales y se distinguen del conjunto canónico.

## Volver a abrir la demo

Abre [Alunza local](http://127.0.0.1:3200). Para consultar la contraseña ficticia, ejecuta `npm run local:credentials` en una terminal interactiva. Si los servicios ya están activos, no inicies otra instancia. Después de reiniciar el equipo, desde esta raíz:

```powershell
. ./scripts/use-node.ps1
npm run local:up
npm run dev
```

La base de desarrollo ya tiene las migraciones y los datos de esta demo. No necesita repetir `db:seed`. Los reportes detallados y las capturas están en `.local/reports/imp-02/` y `.local/evidence/imp-02-demo/`; son evidencia local ignorada por Git.

## Verificación de esta sesión

El 26/09 se aplicaron las migraciones y el seed al proyecto nuevo del laboratorio. La API respondió 200/`ok` en `/health/live` y `/health/ready`; Supabase Advisors no informó hallazgos. La observación del original conserva las dos migraciones previas, dos organizaciones, seis perfiles, seis membresías, la huella de identidades y ausencia de tablas académicas. Evidencia: [demo y comparación](../../.local/reports/imp-02/dev-demo.json).

El recorrido se ejecutó con `agent-browser 0.35.1` sobre Auth, API y PostgreSQL reales de desarrollo. Se crearon y publicaron los registros adicionales `DEMO-260926` / `DEMO-260926-A`; el estudiante confirmó su incorporación, abrió únicamente la prueba visible, guardó código y lo recuperó al recargar y después de cerrar sesión y autenticar nuevamente. Tab salió del editor, la actividad histórica quedó en lectura y la clase A2 ajena devolvió rechazo sin contenido. La página del editor no presentó errores de ejecución ni overlay. Son comprobaciones del agente, no aceptación humana.

La demo queda en la actividad `e137b1c3-1430-4f60-9a68-7a774cb8df42`, asignación `91d01b46-bae9-4663-993c-e1a2f7ae293e`, accesible con Estudiante A. El desarrollo contiene ahora 2 organizaciones, 12 perfiles, 3 cursos, 4 clases, 11 ejercicios, 10 actividades y 5 conceptos; los incrementos sobre el conjunto canónico corresponden a esta demo. El código colectivo temporal no se incluye en reportes y su copia de trabajo se eliminó tras usarlo. El borrador comprobado pertenece al perfil del navegador de prueba; otro navegador requiere escribir su propio borrador.

El primer arranque TEST encontró una clave ES256 generada por CLI con un escalar de 31 octetos. La normalización local ahora rellena a 32 octetos y comprueba el par criptográfico, conservando su identidad, conforme a [RFC 7518 §6.2](https://www.rfc-editor.org/rfc/rfc7518.html#section-6.2.2.1). Solo se corrigió el archivo recién generado de LAB TEST. Las 31 regresiones puras de aislamiento/firma aprobaron, incluyendo rechazo de claves inconsistentes y de destinos originales. También se actualizaron los textos de la portada para reflejar el contenido y editor disponibles.

`npm run ci:verify` terminó correctamente el 26/09/2026 a las 16:17:35 de Santiago (19:17:35 UTC), con sus 12 etapas aprobadas. Evidencia: [CI local](../../.local/reports/imp-00-06-08/ci.json).

| Comprobación                | Resultado actual                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| Formato, lint y tipos       | Aprobados                                                                                     |
| `npm test`                  | 277 pruebas aprobadas en seis grupos                                                          |
| Runner Docker               | Preparación, doctor, aislamiento y recolección aprobados                                      |
| Ejercicios canónicos        | 20 comprobaciones de los diez ejercicios aprobadas                                            |
| Integración HTTP/SQL        | Auth, NestJS, RLS/pgTAP, concurrencia, migración incremental, fallos y recuperación aprobados |
| Regresión de IA             | 27 pruebas aprobadas con pgvector real y proveedor sintético; Azure no ejecutado              |
| Build y artefactos públicos | Aprobados; sin secretos detectados                                                            |
| Cypress                     | 24 de 24 casos aprobados, sin pendientes ni omitidos                                          |

El p95 local fue 58,3 ms para clases y 127,8 ms para ejercicio estudiantil (50 muestras por operación, concurrencia 5); el editor alcanzó 631,4 ms (20 navegaciones autenticadas, concurrencia 1, Chrome con build de producción). Las mediciones usan nearest-rank e incluyen la primera muestra; caché no controlada. En este entorno están bajo 3 s, sin acreditar rendimiento remoto. Reportes: [API](../../.local/reports/imp-02/api-performance.json) y [editor](../../.local/reports/imp-02/ui-performance.json).

TEST terminó detenido y liberó el lock; DEV queda activo en 3200/4200. La CI del 23/09 sigue como evidencia histórica del producto en [IMP-02-content](IMP-02-content.md). El lockfile y las migraciones de dominio existentes permanecen intactos. El alcance continúa en nueve RF completos de 27 (33,3%); esta reanudación prepara y verifica su demo local.

La aceptación humana y la revisión con lector de pantalla siguen pendientes. Ejecución, envío, ayuda, materiales y progreso pertenecen a incrementos posteriores. No se realiza despliegue ni envío a servicios externos.
