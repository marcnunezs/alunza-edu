# IMP-02 — Entrega académica local

> Registro histórico del incremento indicado. Conserva sus resultados y límites originales; el estado vigente al 23/10/2026 es **14/27 RF probados localmente (51,9 %)** y se detalla en [Estado actual](ESTADO-ACTUAL.md).

Encargo del 28/09/2026: implementar el plan aprobado para completar RF-002, RF-003, RF-004, RF-008, RF-022 y RF-023, y revalidar RF-001, RF-020 y RF-021. **Resultado: nueve de veintisiete requisitos completos y probados localmente, 33,3% del alcance funcional.** Cierre de verificación: 28/09/2026 a las 20:00 de Santiago (23:00 UTC). La aceptación académica corresponde al profesor y permanece pendiente.

## Comportamiento entregado

El administrador configura cursos, asignaciones docentes y una taxonomía versionada. El profesor crea su clase, emite códigos colectivos con vencimiento, prepara ejercicios con conceptos y pruebas, y publica actividades ordenadas. El estudiante confirma su inscripción y prepara soluciones de ejercicios autorizados en un editor con borrador de sesión. La guía reproduce el recorrido en [la demostración](IMP-02-demo.md).

La nueva migración agrega tablas con claves institucionales, RLS, versiones inmutables, restricciones y controles de archivo. Se aplica incrementalmente sin reinicializar desarrollo. Las escrituras usan el rol limitado, transacción, auditoría, revisión e idempotencia cuando corresponde. La inscripción y cambios académicos se serializan con el bloqueo institucional compartido. [El diccionario](IMP-02-dictionary.md) precisa tablas, permisos y relaciones.

NestJS conserva la API exclusiva `/api/v1`. Los contratos públicos distinguen el banco docente y la proyección estudiantil, que nunca incluye pruebas ocultas. Publicar fija versiones, orden y obligatoriedad; editar el banco no modifica lo publicado. La apertura es inclusiva y el cierre exclusivo. El estado avanza DRAFT → PUBLISHED → CLOSED, sin reapertura; una fecha vencida impide resolver incluso si el estado sigue PUBLISHED.

El editor usa texto monoespaciado accesible sin dependencias nuevas. Su clave de `sessionStorage` incluye cuenta, organización, clase, asignación y versión. Recarga en la misma pestaña recupera el borrador; logout lo elimina. Un fallo de lectura conserva la plantilla; un fallo de escritura mantiene el texto y avisa que no quedó guardado. Si el navegador impide eliminarlo, el cierre de sesión continúa, se informa que debe cerrarse la pestaña y se impide recuperar/guardar borradores mientras esa limpieza esté pendiente. Un cierre durante edición conserva el texto para copiarlo y bloquea la edición; una falla posterior de API no revierte ese bloqueo.

## Verificación y versión

La [matriz de 36 escenarios de origen](IMP-02-trazabilidad.md) enlaza los 24 nuevos y las 12 regresiones institucionales, aprobados mediante las comprobaciones referenciadas. Los escenarios adversariales complementan esa cobertura. La evidencia saneada y las capturas quedan conservadas en [evidence/imp-02](evidence/imp-02/README.md).

| Verificación                     | Resultado final local                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Formato, ESLint y tipos          | Aprobados para aplicaciones, contratos, herramientas y E2E                                                                       |
| `npm test`                       | 249 pruebas aprobadas en seis grupos, incluidas 20 de web                                                                        |
| Integración HTTP/Auth/PostgreSQL | 80/80 aprobadas en cuatro suites                                                                                                 |
| pgTAP                            | 139 comprobaciones aprobadas en cinco archivos                                                                                   |
| Actualización de esquema         | Migración desde 20260910185307 hasta 20260928222008 conservando identificadores y fechas institucionales                         |
| Seed académico repetido          | Dos ejecuciones sin cambiar IDs, versiones ni fechas; cantidades canónicas verificadas                                           |
| Build y escaneo de artefactos    | Web/API construidas; configuración privada y canarios de servidor ausentes de artefactos públicos                                |
| Cypress con servicios reales     | 25/25 aprobadas: 8 FND, 8 IMP01 y 9 IMP02; sin omitidas ni pendientes                                                            |
| Regresión de ensayos previos     | Ejecutor Docker aprobado dentro de sus límites experimentales; 27 pruebas de pgvector/IA sintética aprobadas, sin llamadas Azure |
| `npm run ci:verify`              | Las once etapas aprobadas sobre el candidato final                                                                               |

Entorno: Windows, Node 24.21.0, npm 11.19.0, Supabase CLI 2.101.0, PostgreSQL 17.6, Docker 29.7.2, Compose 5.3.1, Cypress 16.0.0 y Chrome 153.0.8010.50. Se inspeccionaron las capturas de cursos, conceptos y editor; las pruebas verifican etiquetas, teclado, foco y avisos pertinentes. No se atribuye una certificación WCAG completa.

La huella SHA-256 del candidato de 230 archivos de fuentes, contratos, migraciones, fixtures, pruebas y herramientas es `921b1796725680bde964fe7d16abf755cc4853156550bb1caf1d1d3e75abf94a`. La documentación de cierre y los archivos privados/ignorados quedan fuera de esa huella. No se creó un commit para atribuirle falsamente trabajo previo.

`npm run ci:verify` conserva los once pasos y añade los casos académicos a las suites existentes. `.local/reports/imp-02/ci.json` registra el resultado y una huella SHA-256 de fuentes, contratos, migraciones, pruebas y herramientas, incluyendo archivos aún no versionados. No se inventa un commit ni ejecución remota. Los informes saneados incluyen integración, aceptación, seed y E2E; los diagnósticos privados permanecen excluidos de Git.

El seed ficticio añade seis estudiantes a las seis cuentas anteriores, tres clases y diez ejercicios. Su comprobación ejecuta dos veces el seed y compara IDs, versiones y fechas de las filas canónicas. Los casos adversariales usan organizaciones separadas; no son datos de demostración. Los documentos se incorporarán en materiales.

Se ejecutaron también `npm run db:migrate` y `npm run db:seed` sobre el entorno local de desarrollo, sin reset. Los servicios temporales de pruebas se cerraron al terminar. Para presentar la aplicación, seguir la guía y ejecutar `npm run dev` desde la raíz Git.

Durante la consolidación se corrigieron políticas RLS que impedían `INSERT RETURNING`, valores predeterminados de creación aplicados indebidamente a PATCH, clasificación de errores SQL y conservación del bloqueo del editor ante errores de red. Los fixtures de vencimiento/archivo se ajustaron para respetar la inmutabilidad que debían comprobar. Las aserciones finales conservan los controles originales; no se omiten fallos ni escenarios.

## Límites preservados

RF-005 queda parcial hasta probar cierre contra envíos reales en IMP-03. RF-007 no incluye avance desde intentos y RF-024 no tiene gobierno integral del banco. La entrega no incluye ejecución estudiantil, envío de intentos, IA/RAG, progreso, señales ni despliegue remoto. Los ensayos de IMP-00 conservan sus brechas documentadas.

El porcentaje cuenta requisitos completos comprobados localmente; no mide horas ni aceptación del profesor. La revisión académica, colaboración humana CAPSTONE y GitHub Actions remoto se registran por separado. Se preservaron los cambios documentales previos y los directorios auxiliares externos al repositorio.
