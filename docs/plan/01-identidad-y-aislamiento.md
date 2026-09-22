# IMP-01 — Identidad, organizaciones y aislamiento

**Corte IMP-01: implementado y verificado localmente.** Los ocho incrementos tienen código, contratos y resultados de `npm run ci:verify` en [el registro de trabajo](../work/IMP-01-identity.md). La validación usa datos ficticios y no atribuye aceptación académica ni despliegue remoto. Depende de la base local de [IMP-00](00-fundacion.md). Fuentes: [requisitos y permisos](../../specs/02-requisitos-funcionales.md), [escenarios](../../specs/03-flujos-y-criterios-de-aceptacion.md), [datos](../../specs/06-modelo-de-datos.md), [API](../../specs/07-api-y-contratos.md) y [seguridad](../agent/09-seguridad-y-permisos.md).

## Resultado que podremos demostrar

Un administrador accede a su organización, gestiona usuarios y roles permitidos y observa estados reales. Un profesor y un estudiante acceden a su sesión y navegación correspondiente. Una identidad deshabilitada o un usuario de otra organización recibe rechazo aunque llame a la API directamente o conserve un token anterior.

La fase cierra **ALZ-RF-001, ALZ-RF-020 y ALZ-RF-021** solo cuando sus flujos y decisiones estén resueltos y probados. La creación de dos organizaciones por seed no equivale a implementar el aprovisionamiento institucional de RF-020.

## Entradas y decisiones

- IMP-00 aporta JWT y consulta protegida mínimos, conexión local real, configuración y comandos. Ampliar esa base, sin crear otro sistema de identidad.
- DEC-001 resuelta por el usuario para esta implementación: permiso técnico revocable de una creación, un rol por membresía y correo/cuenta globales con estado institucional independiente. Archivo conserva al único ADMIN ejecutor y bloquea mutaciones. Invitación de 72 horas; reenvío invalida la anterior y reinicia el plazo.
- DEC-006: [diccionario institucional revisado](../work/IMP-01-dictionary.md) antes de migración incremental. DEC-004 concretada en contratos institucionales, transacciones, respuestas y entregas durables entre Auth y BD; los aspectos de otros módulos permanecen pendientes.
- Preparar fixtures de dos organizaciones; usuarios en estados `INVITED`, `ACTIVE`, `DISABLED`; último administrador; roles y permisos negativos. Los casos adversariales extra no cambian la demo canónica.
- Calidad prioritaria: RNF-SEG-01/02/03/05, RNF-USA-02/03/04, RNF-CON-04 y RNF-MAN-02. Seguridad y auditoría son parte de cada incremento.

## Incrementos, en orden

| ID | Trabajo y resultado observable | Artefactos previstos | Comprobación al terminar |
| --- | --- | --- | --- |
| IMP-01.01 | Ampliar el modelo institucional y concretar la matriz operación/rol/estado/ámbito | Migraciones de organizaciones, perfiles y membresías; diccionario y DEC-001/006 | Unicidad, FK, pertenencia, estados válidos y denegaciones; ningún permiso global implícito |
| IMP-01.02 | Completar inicio/cierre de sesión y resolución segura de identidad vigente en NestJS | Adaptador Supabase Auth, guards, navegación por rol y errores de sesión | JWT inválido/vencido, usuario no activo, expiración en navegación y acceso directo; firma/emisor/audiencia comprobados |
| IMP-01.03 | Aplicar aislamiento efectivo y comprobable a consultas y cambios institucionales | Contexto transaccional, grants/RLS, repositorios y reglas de Storage que ya se exponga | Acceso cruzado, asignación maliciosa de ámbito, pool alternando identidades y token previo a revocación |
| IMP-01.04 | Implementar crear/editar/archivar organización dentro del permiso explícito resuelto | Caso de uso, DTO/API, formulario/lista y auditoría | Nombre/código inválido o duplicado, ámbito ajeno, dependencias activas y eliminación física indebida |
| IMP-01.05 | Implementar invitación individual y aceptación idempotente, con destinatario y vencimiento | Flujo Auth→membresía, registro durable/reconciliación de operación y UI de estados | Invitación caducada, usada, revocada o de otro destinatario; fallo intermedio Auth/BD; repetición sin duplicar membresía |
| IMP-01.06 | Completar activación/deshabilitación y cambios de rol permitidos, protegiendo al último admin | Transacciones de ciclo de vida, guards actualizados y auditoría | Dos cambios concurrentes no dejan cero admins activos; cuenta deshabilitada pierde permiso efectivo; roles inválidos se rechazan |
| IMP-01.07 | Integrar pantallas completas de organización/usuarios y navegación de los tres roles | `apps/web`, formularios/diálogos, estados vacíos, carga y error | Teclado, foco, validaciones y errores útiles; toda mutación llega a NestJS; restricciones también funcionan fuera de UI |
| IMP-01.08 | Demostrar identidad y gobierno institucional de extremo a extremo | E2E Cypress, integración API/BD/RLS, fixtures y registro de cobertura | Escenarios E1–E4 de HU-001/020/021; repetición de flujos sin efectos duplicados y auditoría consistente |

## Detalles que no deben quedar implícitos

### Identidad actual frente a un JWT válido

La firma del token es necesaria pero insuficiente. Resolver el estado y las pertenencias vigentes en servidor; un cambio de rol, una deshabilitación o la retirada de pertenencia tienen efecto sobre las operaciones siguientes. No confiar en `user_metadata` ni en IDs enviados por el cliente. El administrador de gobierno no obtiene por su rol lectura pedagógica del estudiante.

Una organización archivada conserva evidencia y referencias. Definir el bloqueo por dependencias conforme a RF-020 y preparar su extensión cuando existan clases/actividades. Revalidar esos rechazos en IMP-02/06 con dependencias reales; no afirmar que un caso imposible todavía se verificó en producción.

### Auth y PostgreSQL no comparten una transacción mágica

Para operaciones que atraviesan Supabase Auth y las tablas de dominio, concretar estados, correlación, reintentos idempotentes y reconciliación. El usuario debe ver el estado real si Auth crea una invitación pero falla la escritura de membresía, o viceversa. No ocultar ese fallo detrás de un mensaje de éxito ni mantener privilegios por una sincronización parcial.

Durante desarrollo, comprobar el correo de invitación en un capturador local o destino de prueba autorizado. Instalar la skill o preparar el flujo no envía invitaciones a personas reales. Las credenciales privilegiadas de Auth permanecen en un adaptador administrativo acotado, nunca en el CRUD ordinario de dominio ni en el navegador.

### RLS y pruebas de acceso reales

Usar el rol de aplicación sin `BYPASSRLS`, con contexto local a cada transacción y políticas coherentes con `USING`/`WITH CHECK`. Probar lecturas, escrituras, cambios maliciosos de organización y reutilización del pool. Los filtros de pantalla, CORS y cuentas de prueba con privilegios de propietario no acreditan este control.

El modelo inicial no tiene todavía todo el contexto de clase: IMP-02 ampliará y probará esas políticas. La seguridad institucional de esta fase no se considera suficiente para publicar contenido de las fases siguientes sin esa ampliación.

### Base de auditoría desde el primer cambio

Registrar actor real, ámbito, operación, entidad, instante de servidor y correlación, sin tokens ni contenido sensible innecesario. Vincular evento de auditoría y mutación de BD de forma transaccional cuando compartan almacenamiento. El visor y la exportación se completan en IMP-06; los eventos no se reconstruyen a posteriori como si se hubieran capturado.

## Criterios de cierre

- [x] E1–E4 de ALZ-HU-001/020/021 tienen prueba y resultado institucional local, con correspondencia CU/PT del mismo número; las variantes con clases/documentos se revalidan en IMP-02/06.
- [x] Login/logout y estados se verifican en UI, API y persistencia reales.
- [x] El permiso técnico para crear organizaciones está resuelto e implementado, incluido consumo concurrente y revocación.
- [x] Invitaciones, cambios de rol y estado resisten duplicados, fallos entre servicios y concurrencia.
- [x] La última administración activa se conserva y los permisos revocados dejan de operar.
- [x] Dos organizaciones permanecen aisladas con el rol real de aplicación; no hay lectura pedagógica implícita por ADMIN.
- [x] Auditoría, migraciones, contratos, fixtures y evidencia coinciden con el comportamiento entregado.

## Siguiente fase y encargo

Continuar con [IMP-02 Contenido y publicación](02-contenido-y-publicacion.md), que introduce cursos, clases y pertenencia docente/estudiantil completa. La recuperación de cuenta solo se implementará según los flujos de sesión documentados; no se añaden SSO ni proveedores alternativos.

Skills pertinentes: `nestjs-best-practices`, las dos skills de Supabase, `vercel:nextjs`, `vercel:shadcn`, `cypress-author` y `cypress-docs`; `security-best-practices` al pedir el desarrollo seguro de esta fase.

```text
Implementa únicamente IMP-01 según docs/plan/01-identidad-y-aislamiento.md,
con desarrollo seguro y las skills pertinentes disponibles. Parte de la base
existente de IMP-00. Completa los flujos de identidad y gobierno institucional
con API, persistencia, UI y pruebas reales. Respeta DEC-001 y no inventes acceso
global. Registra evidencia y capacidades parciales, si las hubiera. Cierra esta
fase sin comenzar IMP-02 ni enviar invitaciones reales sin autorización vigente.
```
