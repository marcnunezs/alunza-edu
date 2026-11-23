# IMP-01 — Identidad, organizaciones y aislamiento

Implementación local autorizada por el usuario el 10/09/2026 (Chile); registro técnico del 11/09/2026 UTC, preparado por Codex. Alcance RF/HU/CU/PT-001, 020 y 021. Datos ficticios; no despliegue remoto, aceptación académica ni inicio de IMP-02. Se conservan la migración IMP-00, los UUID canónicos y las evidencias CAPSTONE.

La fase añade gobierno institucional a la base existente. La ejecución final de `npm run ci:verify` terminó aprobada el 11/09/2026 a las 01:37 UTC, con las once etapas completas. Los resultados y su alcance se registran más abajo.

## Decisiones y entregables

DEC-001 queda resuelta para este incremento por las instrucciones del usuario: permiso técnico revocable y consumible una vez, un rol por membresía, cuenta/correo globales con estado institucional independiente, archivo consultable por su único ADMIN activo e invitaciones de 72 horas. Se conservan JWT de una hora y contraseña mínima de 12 caracteres. DEC-004 y DEC-006 concretan únicamente sus aspectos institucionales; los contratos académicos posteriores siguen pendientes.

| Incremento | Entrega revisable                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| IMP-01.01  | [Diccionario](IMP-01-dictionary.md), migración `20260911003744_identity_governance.sql`, permisos técnicos y herramienta `scripts/provisioning.mjs` |
| IMP-01.02  | Verificador JWT con `session_id`, consulta limitada de sesión Auth, identidad vigente y `/me` con contextos/archivos/permisos                       |
| IMP-01.03  | `DatabaseService.writeAs`, contexto local transaccional, RLS lectura/escritura, helpers NOLOGIN sin bypass y auditoría atómica                      |
| IMP-01.04  | Creación, listado, edición versionada y archivo de organizaciones; consumo atómico del permiso y control de dependencias bajo bloqueo               |
| IMP-01.05  | Invitaciones, entregas durables con lease, adaptador administrativo Auth separado, correo Mailpit, callback y aceptación/renovación                 |
| IMP-01.06  | Cambios de rol/estado con revisión vigente y protección concurrente del último ADMIN; deshabilitación local y aceptación sin reactivación implícita |
| IMP-01.07  | Inicio con selector, navegación por rol, organizaciones, miembros, invitaciones, formularios y archivo en lectura                                   |
| IMP-01.08  | Integración real, pgTAP, Cypress ampliado, OpenAPI, recuperación tras fallo/reinicio y trazabilidad de este registro                                |

Toda mutación de dominio llega a NestJS. Auth del navegador se limita a sesión/verificación/contraseña. Storage permanece deshabilitado. El producto no implementa directorio global, clases ni consulta pedagógica implícita por ADMIN.

## Matriz de permisos vigente

| Operación                             | Actor y estado                                                                    | Ámbito y condición                                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Consultar `/me`                       | Cuenta ACTIVE con sesión válida                                                   | Sus membresías ACTIVE consultables y sus permisos disponibles; cero membresías es un estado válido           |
| Crear organización                    | Cuenta ACTIVE, incluso sin membresías                                             | Permiso técnico no revocado, vigente y sin consumir; queda ADMIN solo de la nueva organización               |
| Leer organización activa              | ADMIN, TEACHER o STUDENT ACTIVE                                                   | Membresía ACTIVE en esa organización                                                                         |
| Editar organización                   | ADMIN ACTIVE                                                                      | Organización activa, revisión vigente                                                                        |
| Consultar miembros e invitaciones     | ADMIN ACTIVE                                                                      | Su organización; lectura administrativa del archivo permitida                                                |
| Invitar, reenviar o revocar           | ADMIN ACTIVE                                                                      | Organización activa; reenvío puede cambiar autorizante vigente sin modificar emisor histórico                |
| Aceptar invitación                    | Destinatario Auth confirmado con sesión vigente; perfil ausente, INVITED o ACTIVE | Secreto, generación, destinatario, plazo, autorizante y organización válidos; nunca eleva un perfil DISABLED |
| Renovar enlace Auth                   | Portador del secreto institucional vigente                                        | Solo su invitación y plazo original; conserva autorizante vigente                                            |
| Cambiar rol/estado                    | ADMIN ACTIVE                                                                      | Membresía aceptada, revisión vigente y al menos un ADMIN activo posterior                                    |
| Archivar                              | ADMIN ACTIVE                                                                      | Solo el ejecutor queda ACTIVE; sin invitaciones ni entregas pendientes; conserva referencias                 |
| Mutar archivo o borrar organización   | Ninguno desde el producto                                                         | Operación rechazada; no reapertura                                                                           |
| Conceder/revocar permisos de creación | Operador técnico local                                                            | UUID de cuenta ACTIVE, actor y motivo; no capacidad de las cuentas del producto                              |

## Operación local

Desde la raíz Git y con Docker disponible:

```powershell
. ./scripts/use-node.ps1
npm run local:up
npm run db:migrate
npm run db:seed
npm run dev
```

`db:migrate` aplica la migración incremental, el rol de aplicación limitado y los grants/políticas mínimos del helper sobre Auth usando su propietario en el contenedor local. El procedimiento remoto equivalente no está validado. No ejecutar reset sobre la base de desarrollo para actualizar IMP-00.

La herramienta técnica no crea cuentas ni envía correo. Requiere un UUID Auth con perfil ACTIVE existente. Para datos ficticios, obtener los UUID de `fixtures/foundation/identity.json` y usar la identidad administrativa correspondiente; no copiar credenciales a esta documentación.

```powershell
node scripts/provisioning.mjs --help
node scripts/provisioning.mjs grant --user UUID --by "operador-local" --reason "Alta institucional autorizada" --expires-at "2026-12-31T23:59:59Z"
node scripts/provisioning.mjs list --user UUID
node scripts/provisioning.mjs revoke --grant UUID --by "operador-local" --reason "Permiso retirado"
```

Los UUID son marcadores que se reemplazan por identificadores existentes. `--test` selecciona exclusivamente el entorno aislado. Concesión y revocación conservan actor/motivo en el permiso; el consumo se audita en la organización creada. Las cuentas sin membresías no adquieren otra capacidad por recibir el permiso.

El arranque genera configuración separada para web y API. El adaptador de entregas necesita `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `INVITATION_WORKER_ENABLED=true` e `INVITATION_CALLBACK_URL`. La clave secreta permanece solo en servidor. Las plantillas locales de Supabase llevan el token Auth y el secreto institucional en el fragmento del callback, que la interfaz retira al abrirlo. Mailpit local de desarrollo escucha en 15424; E2E usa 16424 y callback web3100.

La entrega comienza como QUEUED y responde 202 después de persistir invitación, clave, evento y trabajo. Cada lease dura 90 segundos; hay hasta tres intentos automáticos con un minuto entre ellos. UNCERTAIN significa que el proveedor pudo enviar el correo; la recuperación observa estado/permiso y rota generación antes de repetir. FAILED permite un reenvío administrativo explícito. La renovación Auth no amplía las 72 horas. Un correo repetido no produce otra membresía.

Las respuestas idempotentes tienen ventana de 24 horas. El mantenimiento de la API elimina sus cuerpos vencidos en lotes de 100 cada minuto, incluso con entrega de invitaciones deshabilitada, manteniendo claves, hashes y vínculos al recurso. Una clave vencida no vuelve a ejecutar la operación. Si la API está detenida, la limpieza se reanuda al arrancar. Una aceptación consumida sigue permitiendo consultar su membresía vigente. El producto no expone esas tablas.

## Cobertura de los doce escenarios

Los identificadores originales de HU/CU/PT se conservan. Las pruebas adversariales generan instituciones y cuentas fuera del fixture canónico; los datos de IMP-00 se preparan dos veces para verificar repetibilidad.

| Escenario | Prueba y observación institucional                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| HU-001 E1 | Cypress FND-02/03/04: acceso/inicio/salida por rol; integración `logout invalida token conservado`                                            |
| HU-001 E2 | Cypress FND-05 y validación Auth/API: credenciales incorrectas y formulario inválido                                                          |
| HU-001 E3 | Cypress FND-06/IMP01-03; integración foundation: recurso ajeno, rol insuficiente, JWT adulterado, cuenta inactiva y cambios de pertenencia    |
| HU-001 E4 | Cypress IMP01-04, integración de renovación/expiración, sesión conservada tras logout y permisos vigentes con JWT anterior                    |
| HU-020 E1 | Cypress IMP01-01: crear/editar/archivar; integración: consumo único, respuesta perdida/idempotencia, carrera de permiso y lectura del archivo |
| HU-020 E2 | Cypress IMP01-02 y API: nombre vacío, código duplicado, campos extra y revisión antigua                                                       |
| HU-020 E3 | Cypress IMP01-03, API y pgTAP: organización ajena y cambio malicioso de contexto/organización                                                 |
| HU-020 E4 | Cypress IMP01-08 y API: dependencias activas, invitación pendiente, prohibición de DELETE y referencias conservadas                           |
| HU-021 E1 | Cypress IMP01-05 y API: correo real, callback en otra sesión, aceptación, contraseña inicial y deshabilitación; recuperación con reinicio     |
| HU-021 E2 | DTO/API: correo/rol inválido, destinatario incorrecto, cuenta existente, duplicados, expiración, reenvío y revocación                         |
| HU-021 E3 | API/pgTAP: miembro ajeno, ámbito manipulado y deshabilitar A sin retirar B                                                                    |
| HU-021 E4 | Cypress IMP01-06 e integración: último ADMIN y dos cambios concurrentes                                                                       |

Para HU-001 E3 y HU-020 E4, las variantes con clases/documentos reales se extienden en IMP-02/06. Este corte comprueba las dependencias institucionales existentes, sin fabricar tablas académicas ni declarar esas variantes ejecutadas.

## Verificación y resultados

Comandos de verificación:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
npm run ci:verify
```

Los reportes nuevos de integración, recuperación y Cypress se guardan en `.local/reports/imp-01/`; el reporte conjunto CI mantiene `.local/reports/imp-00-06-08/ci.json`. Los fallos deliberados y logs se sanejan. No se suben secretos, videos ni capturas de formularios de acceso a Cypress Cloud.

La inyección de fallos de auditoría usa un esquema exclusivo de TEST, inaccesible para los roles del producto. El arnés instala su trigger antes de arrancar la API, activa los fallos mediante filas por organización y lo retira después de detenerla. Así prueba rollback y recuperación sin modificar DDL mientras el trabajador está operando.

Resultados ejecutados en Windows, Node 24.21.0/npm 11.19.0, Supabase CLI 2.101.0 y PostgreSQL 17.6:

| Verificación                | Resultado                                                                                                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instalación limpia `npm ci` | Aprobada desde lockfile; 908 paquetes instalados, auditoría sin vulnerabilidades reportadas                                                                                                           |
| Formato, ESLint y tipos     | Aprobados                                                                                                                                                                                             |
| `npm test`                  | 214 pruebas aprobadas en seis grupos; incluye 21 del parser técnico de aprovisionamiento                                                                                                              |
| Actualización desde IMP-00  | Tres tablas y fixture canónico antes de migrar; UUID y `created_at` de organizaciones/perfiles/membresías conservados                                                                                 |
| Integración HTTP            | 58 pruebas aprobadas en tres suites, con Auth/PostgreSQL/Mailpit reales                                                                                                                               |
| pgTAP                       | 65 pruebas aprobadas en cuatro archivos; grants, funciones, RLS, restricciones, auditoría e idempotencia                                                                                              |
| Recuperación institucional  | Cinco escenarios aprobados: Auth exitoso con auditoría fallida, reinicio desde UNCERTAIN, generación obsoleta, membresía/auditoría únicas y lease vencido tras aceptación sin otro correo             |
| Caída de BD                 | Readiness/consulta protegida 503, liveness 200; recuperación posterior comprobada                                                                                                                     |
| Cypress                     | 16/16 recorridos aprobados: ocho de fundación y ocho institucionales; incluye consulta real del archivo sin mutaciones                                                                                |
| `npm run ci:verify`         | Aprobado: once etapas locales, incluyendo runner Docker, regresión IA, integración real y Cypress                                                                                                     |
| Revisión visual y teclado   | Aprobada en navegador local: acceso/salida, salto al contenido, etiquetas, foco circular/restaurado, error de último ADMIN y formulario conservado; diseño móvil 375×812 sin desbordamiento de página |

La revisión accesible verifica etiquetas, foco de diálogos, teclado, errores y estados anunciados. No equivale a una certificación completa WCAG ni a aceptación humana. El siguiente incremento funcional sigue siendo IMP-02; no comienza en esta tarea.

La comprobación manual usó una cuenta ficticia separada y dos organizaciones, una activa y otra archivada. También ejecutó concesión, consulta y revocación mediante la herramienta técnica sobre TEST; la consulta posterior confirmó `revoked_at`. El registro saneado se encuentra en `.local/reports/imp-01/accessibility.json`.
