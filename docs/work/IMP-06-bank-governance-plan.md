# Plan acotado IMP-06.02 — Gobierno del banco

Fecha: 27/10/2026, America/Santiago. Autorización: implementar únicamente
IMP-06.02 y verificar sus pruebas. Base: IMP-06.01, con todos los cambios
previos del workspace preservados. Este plan no acredita resultados.

## Objetivo y contrato

ADMIN activo gobierna un ejercicio de su organización: modifica propietario
y visibilidad, crea una versión nueva o archiva conservando usos e historia.
Cobertura ALZ-RF/HU/CU/PT-024 E1–E4; regresiones RF-004/005/008/011/014/023,
DAT-01/04/10 y RNF-SEG-01/02/03/05, CON-01/03, USA-01/02/03/04.

- Reutilizar banco, contenido, auditoría, bloqueo organizacional y claves
  idempotentes. No reemplazar módulos ni crear una API de dominio en Next.js.
- `PATCH /exercises/:id/governance`: campos opcionales `ownerId` y
  `visibility`, al menos uno; `If-Match` y `Idempotency-Key` obligatorios.
  Devuelve detalle administrativo y ETag. Payload extra, destino inválido,
  permisos perdidos y revisión antigua fallan sin efectos.
- Destino de propiedad: miembro y perfil ACTIVE, ADMIN o TEACHER, misma
  organización. Se concreta dentro de los actores existentes del banco;
  no concede rol docente a ADMIN. Propietario histórico inactivo se conserva
  cuando no se cambia. Visibilidad permanece PRIVATE/ORGANIZATION.
- `GET /exercises/:id/governance/content` recupera la definición actual
  autorizada para ADMIN, sin recorrer páginas de versiones. Contiene pruebas
  de autoría; no intentos ni datos estudiantiles. Las lecturas de metadatos .01
  conservan su proyección mínima.
- `POST /exercises/:id/versions` admite también ADMIN del ámbito; conserva
  autoría del docente propietario. Siempre inserta versión, conceptos y tests
  nuevos. `POST /exercises/:id/archive` conserva DEC-002: impide nuevos usos,
  mantiene publicaciones y acceso contextual a historia.
- Confirmaciones cancelables para cambios de acceso y archivo; formulario
  recuperable ante validación/412, misma clave ante desenlace incierto.

DEC-001/002 se aplican sin reabrirlas. DEC-004/006 se concretan mediante los
contratos, migración aditiva y diccionario del incremento. No hay servicios
nuevos, dependencias nuevas, migración remota ni gasto autorizado.

## Secuencia y archivos

1. Persistencia: migración aditiva de políticas INSERT para versiones ADMIN y
   validación de propietario; pgTAP con rol real `alunza_app`.
2. API/contratos: `packages/contracts/src/exercise-bank.ts`, controladores y
   servicios de `apps/api/src/content`, readiness y generador OpenAPI.
3. Web: componentes existentes de banco y formulario de versión, transporte
   tipado, selección de miembro autorizado, confirmaciones y recuperación.
4. Aceptación: fixture aislado, HTTP y Cypress, comparación antes/después de
   actividad e intento real con diagnóstico, código, tests y conceptos.
5. Integración/revisión y comprobaciones; actualizar estado, plan y registro
   con resultados realmente observados, distinguiendo aceptación humana.

Persistencia, interfaz y aceptación se delegan con archivos separados; el
agente principal integra y revisa contratos. No se ejecutan suites compartidas
en paralelo. Laboratorio TEST exclusivo: web 3300, API 4300, Auth 18421,
PostgreSQL 18422; no tocar servicios de otros proyectos ni DEV.

## Verificación prevista

Validación de schemas, controladores y transacción; pgTAP/RLS; HTTP de éxito,
rechazo, revocación, carreras, idempotencia y rollback/auditoría; actualización
desde .01 y conservación de datos existentes; Cypress integrado con teclado,
cancelación y conflictos. Formato, lint, tipos, build y CI obligatoria del
repositorio, conservando fallos y límites sin alterar gates. Congelar fuentes
y documentación durante mediciones/CI: la huella del ensayo de ayuda incluye
todos los archivos versionados y nuevos no ignorados, aunque el manifiesto
de señales limite su inventario a fuentes. Actualizar documentos de cierre
después de la ejecución, sin atribuir a esas ediciones otra CI de producto.

Fuera de alcance: IMP-06.03–.07, RF-017/019/027, proveedores remotos,
despliegue y aceptación institucional/CAPSTONE.
