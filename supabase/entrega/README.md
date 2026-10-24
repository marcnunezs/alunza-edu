# Base de datos de Alunza — entrega académica

**Archivo para entregar: [alunza_estructura.sql](alunza_estructura.sql).** Contiene la estructura completa implementada al **23/10/2026**, reconstruida desde las cuatro migraciones del proyecto y exportada como DDL del estado final. Los nombres físicos y las relaciones corresponden a la aplicación actual.

| Elemento | Cantidad |
| --- | ---: |
| Esquemas propios: `app` y `app_private` | 2 |
| Tablas | 25 |
| Columnas | 292 |
| Restricciones de tabla: claves primarias, foráneas, únicas y CHECK | 249 |
| Índices, incluidos los asociados a claves | 93 |
| Secuencia de identidad | 1 |
| Funciones | 71 |
| Triggers propios | 41 |
| Políticas de seguridad por fila en esquemas propios | 85 |
| Políticas adicionales de integración con Auth | 2 |

Incluye tipos de columnas, nulabilidad, valores predeterminados, relaciones, restricciones, índices, funciones, triggers, RLS, roles, propietarios y permisos. El encabezado SQL enumera las tablas y las migraciones de origen, con sus huellas SHA-256. No contiene registros de usuarios, datos de demostración, contraseñas ni tokens.

## Alcance

El esquema cubre identidad y gobierno institucional, cursos y clases, conceptos, ejercicios versionados, pruebas, actividades, ejecuciones, intentos, resultados privados y eventos. El progreso por actividad se calcula mediante una función.

Materiales, IA/RAG, feedback, progreso por conceptos y señales todavía tienen partes pendientes en el proyecto; no se presentan como tablas implementadas. Las tablas de ensayo de `fixtures/ai/schema.sql` no pertenecen al esquema de la aplicación. Este archivo tampoco incorpora el MER histórico de Oracle.

## Requisitos y ejecución

Utilizar **PostgreSQL 17 con Supabase Auth inicializado**, en una instancia de evaluación sin los esquemas `app` ni `app_private`. Las tablas `auth.users` y `auth.sessions`, y los roles de plataforma `postgres`, `anon`, `authenticated` y `service_role`, los proporciona Supabase. El archivo crea los dos roles propios de Alunza si no existen y valida sus atributos si ya existen.

Se necesita un **superusuario del entorno local**, como `supabase_admin`, para restaurar propietarios y configurar las políticas de Auth. El rol `postgres` ordinario del SQL Editor alojado no dispone necesariamente de esos permisos. No requiere pgvector ni Storage para este corte.

Ejemplo con `psql`, sustituyendo los valores entre ángulos por los del entorno de evaluación:

```text
psql -X --host <host> --port <puerto> --username supabase_admin --dbname <base_de_evaluacion> --password --set ON_ERROR_STOP=1 --file alunza_estructura.sql
```

Ejecutar desde la carpeta del archivo o indicar su ruta completa. `--password` solicita la contraseña de conexión de manera interactiva; no debe escribirse en el archivo SQL. La ejecución se realiza en una transacción y termina con `COMMIT`. Si el destino ya contiene los esquemas de Alunza, se rechaza la instalación.

La base vacía aquí significa **sin objetos propios de Alunza, pero con la plataforma Supabase ya preparada**. No es un script para MySQL, Oracle ni un PostgreSQL sin Auth. El modelo interno de Supabase se conserva como dependencia externa: no se copian sus tablas de usuarios ni sus datos al entregable.

El archivo sirve para inspección y reconstrucción académica. No registra las migraciones en `supabase_migrations` ni sustituye su historial. Para continuar desarrollando la aplicación se mantienen las migraciones originales y el arranque local del repositorio; no se deben reaplicar esas migraciones sobre una instancia creada con este snapshot. El rol `alunza_app` se crea sin contraseña, cuya asignación corresponde al arranque del entorno, fuera de esta entrega.

## Verificación realizada

Validación local el 23/10/2026 con PostgreSQL 17.6, en un contenedor desechable sin red ni puertos publicados. Se copió únicamente el DDL de Auth del entorno local como prerrequisito de prueba y se aplicaron las cuatro migraciones originales. Luego se exportó el estado final y se instaló el archivo de entrega en una base nueva, sin los roles de Alunza.

- Instalación limpia, incluida creación de roles: correcta.
- Esquema restaurado equivalente al generado por las cuatro migraciones. PostgreSQL normalizó los paréntesis de seis restricciones CHECK durante el primer ciclo de exportación/restauración; el snapshot final y su restauración coinciden exactamente.
- Reejecución sobre esquemas existentes: rechazada sin modificarlos.
- Siete archivos de pruebas SQL del proyecto: **313 comprobaciones aprobadas, 0 fallidas**. Comprueban estructura, integridad, permisos, aislamiento, contenido académico y práctica. pgTAP se utilizó solo para las pruebas.

El [registro de validación](validacion.json) conserva conteos, resultados por archivo y SHA-256 del SQL entregado. No se modificó la base de desarrollo ni se ejecutaron operaciones remotas. Estos resultados corresponden a pruebas de base de datos; no acreditan un despliegue productivo ni aceptación del profesor.

## Fuentes

- [Migraciones del proyecto](../migrations/).
- [Arranque local e integración de Auth](../../scripts/local.mjs), función `migrate`.
- [Pruebas SQL existentes](../tests/).
- [Documentación oficial de exportación de Supabase](https://supabase.com/docs/reference/cli/supabase-db-dump).

El archivo es una fotografía del estado indicado. Si se agregan nuevas migraciones, debe regenerarse y verificarse antes de una nueva entrega.
