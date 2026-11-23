# IMP-02 — Contenido y editor; meta 9/27 RF

Implementación local solicitada y verificada el 23/09/2026. Este registro distingue código, pruebas y aceptación. El corte alcanza nueve RF con evidencia local satisfactoria; no acredita despliegue, datos reales, aceptación académica ni integración estudiantil del ejecutor.

## Alcance y decisiones

Se revalidaron ALZ-RF/HU/CU/PT-001, 020 y 021. Se implementaron 002, 003, 004, 008, 022 y 023: nueve RF acumulados, equivalentes al 33,3% de los 27 RF, no del esfuerzo total. RF-005, 007 y 024 son habilitadores parciales; no cuentan como cierres. La ejecución, intentos, IA, progreso, señales y gobierno avanzado continúan fuera de este corte.

El usuario resolvió las políticas de este incremento:

- ADMIN habilita docentes por curso; TEACHER habilitado crea clases propias. Solo ADMIN reasigna. Revocar habilitación bloquea nuevas clases y conserva asignaciones existentes.
- Actividad DRAFT→PUBLISHED→CLOSED, sin reapertura. Publicar fija versiones, orden y requeridos. Publicadas y cerradas son consultables por miembros autorizados. La edición estudiantil exige PUBLISHED y ventana `opensAt <= ahora < closesAt`; un extremo nulo no restringe.
- Cursos/clases conservan fechas civiles (`startDate/endDate`). Ventanas de actividad son instantes UTC y la interfaz usa la zona de la organización.
- ADMIN archiva una clase solo después de cerrar publicaciones; revoca códigos, conserva relaciones y consulta autorizada. Archivo de conceptos/ejercicios impide usos nuevos, mantiene referencias publicadas.
- Código colectivo: uno vigente por clase, siete días por defecto o un plazo menor, revocable y rotativo. Solo digest persistido; código mostrado una vez. Replay de emisión devuelve metadatos sin secreto.
- Borrador local por cuenta, organización, clase, asignación y versión, con 30 días desde última edición, conservado al salir. Solo se recupera tras autorización vigente; descarte manual y estados de error explícitos.

DEC-002 se concreta para visibilidad, ventanas, archivo y transiciones de este corte; la carrera con SUBMIT real queda pendiente de IMP-03. DEC-004/006 se concretan en DTO, OpenAPI y diccionario académico. DEC-001, arquitectura y proveedores permanecen vigentes.

Elecciones reversibles: dificultad BEGINNER/INTERMEDIATE/ADVANCED; banco PRIVATE por defecto; editor textarea monoespaciado con Tab libre; nombres de conceptos normalizados NFKC, espacios reducidos y minúsculas; período académico textual obligatorio. El banco usa JavaScript/solve, JSON, igualdad exacta, 1–8 pruebas, al menos una visible y límites existentes 128 MiB/3000 ms/64 KiB. Coherencia de formato/expectativas no acredita corrección pedagógica universal; referencia correcta e incorrecta se ensayan para cada ejercicio canónico, y el gate universal de autoría propuesto en specs/13 queda pendiente.

## Entregables

- Migración incremental, diccionario y pgTAP; contexto académico comparte bloqueo institucional sin conceder UPDATE de organizaciones al estudiante/profesor.
- API NestJS de cursos, habilitaciones, clases/códigos, inscripción, conceptos, banco versionado, publicación/cierre y proyección estudiantil. Privilegios vigentes, RLS, auditoría transaccional, ETag e idempotencia.
- Pantallas por rol, formularios, confirmaciones, ordenación, editor y recuperación local. No hay datos ficticios como respuesta de producción ni botones de funciones futuras.
- Fixture académico separado que preserva los seis UUID originales y agrega seis estudiantes: 2 organizaciones, 2 administradores, 2 profesores, 8 estudiantes, 3 clases y 10 ejercicios. Documentos se incorporan en IMP-04. Variantes adversariales no forman parte del conteo canónico.

## Matriz de evidencia

Cada fila conserva E1–E4 del spec, no redefine sus criterios. La [matriz detallada](IMP-02-acceptance.md) enumera los 36 escenarios originales y las aserciones concretas.

| RF/HU/CU/PT | Evidencia local comprobada                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| 001         | Regresión de sesión/estado; pertenencia de clase; JWT anterior tras revocación; API/RLS y navegación           |
| 020         | Regresión institucional; bloqueo por dependencias académicas tanto en API como trigger; preservación histórica |
| 021         | Regresión invitaciones/roles/último ADMIN; cambio institucional invalida operación académica                   |
| 002         | Creación docente habilitada; datos inválidos; ajeno; archivo en lectura                                        |
| 003         | Confirmación, código inválido/ajeno/vencido/revocado, duplicado y concurrencia; replay tras rotación           |
| 004         | Definición íntegra, límites/pruebas incoherentes, edición ajena, versiones y privacidad visible/oculta         |
| 008         | Contenido autorizado, borrador y recuperación fallida, ajeno, ventana/cierre/archivo                           |
| 022         | Curso/clase/profesor activo, duplicados/fechas, sin permiso, asignación cruzada                                |
| 023         | Versiones, duplicados/ciclos, ámbito ajeno, archivo conserva usos publicados                                   |

Pruebas principales: contratos académicos, integración HTTP `zz-academic`, pgTAP académico, unitarias API/editor y recorridos Cypress IMP02. `npm run test:academic:fixtures` comprueba veinte ejecuciones Docker del banco canónico. Reportes locales saneados se guardan en `.local/reports/imp-02/`; no contienen código oculto, secretos ni contraseñas.

## Verificación y límites

**Cierre local satisfactorio:** `npm run ci:verify` terminó con código 0 el 23/09/2026 a las 20:26:56 UTC (17:26:56 de Santiago). Sus doce etapas aprobaron desde una reconstrucción de TEST; no quedan defectos graves conocidos en el recorrido autorizado. Entrega local sobre la base Git `d3fcbc8`, en la rama `laboratorio`, sin despliegue. Después de la CI solo se actualizó documentación y se restauraron las rutas generadas de `next-env.d.ts`.

| Comprobación ejecutada                | Resultado y evidencia                                                                                                                                                                                                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formato, ESLint, TypeScript y OpenAPI | Aprobados; referencias OpenAPI resueltas y contratos estrictos. [CI local](../../.local/reports/imp-00-06-08/ci.json).                                                                                                                                                        |
| Jest                                  | 243/243 en seis grupos: API, web, contratos, runner, IA y preproducción.                                                                                                                                                                                                      |
| Integración NestJS/Supabase y pgTAP   | 82/82 HTTP y 122/122 SQL (65 institucionales y 57 académicas); incluye carreras, rollback, revocación y aislamiento. [Integración fresca](../../.local/reports/imp-02/integration.json).                                                                                      |
| Actualización y recuperación          | Migración desde IMP-01 conserva identificadores y fechas; caída/restablecimiento real de PostgreSQL y recuperación de invitaciones aprobados. [Actualización](../../.local/reports/imp-01/migration-upgrade.json), [recuperación](../../.local/reports/imp-01/recovery.json). |
| Seguridad local                       | Advisors sin hallazgos; revisión de logs, HTML y bundles sin valores privados ni señuelos ocultos. [Advisors](../../.local/reports/imp-02/security-advisors.json), [artefactos](../../.local/reports/imp-00-05/artifacts.json).                                               |
| Builds y Cypress                      | Builds de contratos, runner, IA, API y web; Chrome ejecuta 24/24 casos: ocho de fundación, ocho institucionales y ocho académicos, sin pendientes ni omitidos. [E2E](../../.local/reports/imp-02/e2e.json).                                                                   |
| Banco canónico Docker                 | 20/20 ejecuciones: solución correcta e incorrecta de cada uno de los diez ejercicios. Limpieza comprobada; no acredita ejecución estudiantil integrada ni validación universal de autoría. [Banco](../../.local/reports/imp-02/canonical-exercises.json).                     |
| Regresión IA/pgvector                 | 27/27 sobre PostgreSQL/pgvector reales con proveedor sintético explícito; Azure no ejecutado. [Ensayo](../../.local/reports/imp-00-06-08/ai-integration.json).                                                                                                                |

Durante la verificación se corrigieron una expectativa SQL de error y aserciones Cypress de solo lectura; el test de invitaciones ahora espera la entrega real antes de usar su revisión. Un arranque intermedio excedió readiness y no se reprodujo tras diagnosticar conexión/permisos. La CI final completa, incluida la reconstrucción y recuperación, aprobó. Las evidencias intermedias conservan su fecha y no sustituyen los reportes finales enlazados.

Entorno local: Windows 11 Pro 10.0.26200, Intel Core i7-1355U (12 procesadores lógicos), aproximadamente 32 GiB de RAM; Node 24.21.0/npm 11.19.0, Docker 29.7.2/Compose 5.3.1, Supabase CLI 2.101.0, PostgreSQL 17.6, Cypress 16.0.0 y Chrome 153.0.8010.50. Datos ficticios y loopback, sin integración alojada. El lockfile permanece intacto. El arnés terminó sus servicios TEST y liberó su bloqueo; la base de desarrollo no recibió la nueva migración ni fue detenida.

| Operación medida              | Muestras y concurrencia | p95 local |
| ----------------------------- | ----------------------- | --------- |
| API de clases                 | 50, concurrencia 5      | 95,46 ms  |
| API de ejercicio estudiantil  | 50, concurrencia 5      | 172,52 ms |
| Navegación completa al editor | 20, concurrencia 1      | 375 ms    |

Percentil nearest-rank, primera muestra incluida y caché no controlada; cero fallos observados, objetivo p95 <3000 ms satisfecho en las operaciones medidas. [Muestras API](../../.local/reports/imp-02/api-performance.json), [muestras UI](../../.local/reports/imp-02/ui-performance.json). No acredita toda pantalla, carga superior ni latencia híbrida remota. Las comprobaciones de teclado/semántica no equivalen a sesión humana con lector de pantalla, certificación WCAG ni aceptación del docente guía. RF-005/007/024 conservan sus pendientes, especialmente cierre frente a envíos y avance desde intentos.

## Punto de reanudación

**Actualización del 26/09/2026:** se retomó la demostración local. La inspección aclaró que el Supabase existente pertenecía al repositorio original; se separaron los destinos DEV/TEST del laboratorio antes de arrancar. El recorrido por roles y la evidencia vigente están en [demostración local](IMP-02-demo-local.md). El punto guardado del 23/09 se conserva abajo como antecedente.

El usuario pidió guardar el progreso el 23/09/2026 para continuar más tarde. Este registro, la [matriz de aceptación](IMP-02-acceptance.md) y el [diccionario](IMP-02-dictionary.md) acompañan el código en el commit local de esta entrega. Los reportes saneados permanecen en `.local/reports/` y están ignorados por Git; sus resultados principales quedan registrados arriba. No se publicó la rama.

El corte autorizado está implementado y su CI local aprobada. No hay un bloqueo técnico activo ni una prueba en ejecución. TEST quedó detenido; Supabase de desarrollo conserva su estado previo. Para retomar, leer este registro y comprobar `git status` antes de editar. El siguiente paso de demostración es aplicar la migración incremental y el seed académico al entorno de desarrollo local mediante las instrucciones del README, y recorrer administrador → profesor → estudiante. No volver a generar el proyecto ni las migraciones existentes.

Quedan la revisión humana de accesibilidad y la aceptación académica; los incrementos posteriores (ejecución/envíos, materiales/ayuda y progreso) requieren una nueva indicación de alcance. Se conserva la arquitectura y el lockfile. No hay despliegue, migración remota ni envío a terceros pendiente de ejecutarse automáticamente.
