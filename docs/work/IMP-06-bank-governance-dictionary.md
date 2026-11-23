# Persistencia de gobierno del banco — IMP-06.02

Fecha: 27/10/2026. Concreción incremental de DEC-004/006 para RF/HU/CU/PT-024;
complementa el [diccionario IMP-02](IMP-02-dictionary.md) y la
[consulta administrativa IMP-06.01](IMP-06-bank-read.md). La ejecución y sus
resultados se registran por separado; este diccionario no acredita migración
remota, aceptación humana ni cierre de IMP-06 completo.

## Cambios aditivos

La migración
`supabase/migrations/20261027155241_exercise_bank_governance.sql` no crea tablas,
columnas ni índices ni modifica filas preexistentes. Conserva las claves
compuestas, RLS forzada, grants y restricciones históricas del banco.

| Superficie                        | Regla del incremento                                                                                                                                                                                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app.exercises.owner_id`          | Al cambiar el propietario, el destino debe ser miembro `ACTIVE` con rol `ADMIN` o `TEACHER` de la misma organización y perfil global `ACTIVE`. Un propietario histórico inactivo permanece identificable; no se exige transferirlo para crear una versión, cambiar visibilidad o archivar. |
| `guard_exercise_governance_owner` | Trigger `BEFORE UPDATE OF owner_id`, invoca `app_private.guard_exercise_governance_owner()`. Rechaza destino inválido con SQLSTATE `23514`, mensaje `EXERCISE_OWNER_INVALID`, antes de cualquier efecto.                                                                                   |
| `versions_insert`                 | Añade permiso de inserción al `ADMIN` activo del ámbito. Mantiene `organization_id` transaccional, `created_by` igual al actor y permiso previo del autor `TEACHER`.                                                                                                                       |
| `links_insert`, `tests_insert`    | Añaden al mismo `ADMIN` la inserción de conceptos/pruebas de la nueva versión del ámbito. Los triggers previos siguen rechazando modificar una definición actual o referenciada.                                                                                                           |

Los roles del contrato son `ADMIN`, `TEACHER` y `STUDENT`. Una propiedad
administrativa permite gobernar el banco; no otorga docencia, publicación,
detalle de estudiante, resultados de intentos ni revisión de señales.
`academic_exercise_author` continúa siendo exclusivo del `TEACHER` propietario.
La nueva rama RLS utiliza `academic_role`, que comprueba sesión vigente, perfil,
membresía, organización y estado. Los roles Data API no reciben acceso.

La función del trigger pertenece a `alunza_identity`, `NOLOGIN` sin
`BYPASSRLS`, tiene `search_path=pg_catalog` y no es ejecutable por `PUBLIC`,
`anon`, `authenticated`, `service_role` ni `alunza_app`.

## Restricciones reutilizadas

La mutación HTTP utiliza la transacción, contexto, bloqueo de organización,
ETag, clave idempotente y auditoría del servicio existente. El trigger
`guard_academic_resource` mantiene inmutables organización/ID/fecha de creación,
incrementa la revisión una vez y reserva propiedad, visibilidad y archivo al
administrador. Las membresías se modifican bajo el mismo bloqueo de organización.

La visibilidad sigue limitada a `PRIVATE` o `ORGANIZATION`. El cambio afecta
la selección futura desde el banco; no retira referencias fijadas por una
actividad publicada ni cambia permisos de clase. La transferencia privada
retira al antiguo propietario el permiso de autoría, conservando su acceso
docente a la evidencia de sus clases cuando todavía corresponda.

`exercise_versions`, `exercise_version_concepts` y `exercise_tests` permanecen
inmutables y sin grants UPDATE/DELETE al rol ordinario. La versión nueva se
construye junto con pruebas/conceptos y el nuevo puntero. La restricción diferida
exige una prueba visible, entre una y ocho pruebas, conceptos y expectativas
consistentes. Rechazar la definición revierte también su puntero y enlaces.

El archivo conserva versiones y asignaciones DRAFT/PUBLISHED/CLOSED. Conforme
a DEC-002, impide referencias nuevas y publicar borradores que lo contienen;
conserva publicaciones y consultas históricas autorizadas. El trigger previo
rechaza crear nuevas versiones o modificar un ejercicio ya archivado.

## Actualización y recuperación

La actualización desde IMP-06.01 modifica únicamente el trigger y las tres
políticas de inserción. No requiere backfill ni reconstrucción de progreso.
La API debe desplegarse después de esta expansión del esquema. Ante un defecto,
preferir avance correctivo; una vuelta a las políticas anteriores impediría
versionado administrativo posterior, pero no debería borrar las versiones,
asignaciones ni eventos ya conservados.

La suite `supabase/tests/018_exercise_bank_governance.test.sql` usa identidades
ficticias y el rol `alunza_app`. Cubre destinos inválidos, ámbito ajeno, autoría,
append administrativo, coherencia/rollback, restricciones de archivo y comparación
antes/después de versiones, pruebas, conceptos y asignaciones. La preservación
de intentos, auditoría atómica, ETag, transporte y concurrencia corresponde
también a las pruebas HTTP del incremento. Ninguna prueba SQL que opere solo
como propietario sustituye estos recorridos.
