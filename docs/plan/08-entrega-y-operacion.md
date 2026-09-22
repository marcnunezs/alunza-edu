# IMP-08 · Entrega reproducible y operación

Estado: **plan propuesto, sin despliegue ni aceptación acreditados**. Esta fase consolida la versión, los procedimientos y la evidencia de operación iniciados en IMP-00. Las rutas de scripts, configuración y manuales mencionadas son propuestas hasta que la implementación las cree y verifique.

Lee el [índice del plan](README.md), [AGENTS.md](../../AGENTS.md), [arquitectura](../../specs/05-arquitectura.md), [operación](../../specs/11-operacion-y-despliegue.md), [calidad](../../specs/10-calidad-y-pruebas.md), [entrega CAPSTONE](../../specs/12-plan-de-entrega.md) y la [guía del agente para operación](../agent/11-operacion-y-entrega.md). La fase anterior es [IMP-07](07-calidad-integral.md).

## Resultado y demostración

Entregar un candidato identificable que otra persona del equipo pueda levantar, comprobar y demostrar con instrucciones completas. El paquete distingue código desplegable, servicios realmente desplegados, pruebas aprobadas y aceptación humana. Contiene los manuales de los tres roles, operación y recuperación, demo ficticia canónica, evidencias y limitaciones.

La demo usa la arquitectura AD-ARQ-001: Next.js en Vercel, API y trabajos NestJS en Azure Container Apps, Supabase Auth/PostgreSQL/Storage/RLS/pgvector y Vercel Sandbox. Azure OpenAI conserva AD-IA-001; Docker es el adaptador local del ejecutor. Ninguna actividad de esta fase sustituye proveedores o convierte Next.js en una segunda API de dominio.

## Entradas y preparación temprana

| Entrada / decisión | Comprobación requerida | Avance posible si falta |
| --- | --- | --- |
| IMP-07 | Candidato integrado, matriz de calidad, defectos y pendientes; controles obligatorios aplicables aprobados para recomendar entrega | Redactar manuales, preparar scripts y resolver defectos independientes; no etiquetar la versión como aceptada |
| Preproducción desde IMP-00 | Configuración por ambiente y smoke mínimo web → API → Auth/datos; Sandbox/Azure OpenAI ensayados tempranamente cuando exista autorización/configuración, y verificados sobre flujos reales en IMP-03/04 | Completar configuración y ensayo acotado antes de promoción. Un pendiente de credencial se conserva como pendiente remoto, no como éxito del mock |
| DEC-007 | Lockfile, runtime, versiones y comandos comprobados | Corregir reproducción en una copia limpia antes de documentar comandos definitivos |
| DEC-003/004/008/010 | Supervisor, trabajos durables, credenciales Azure → Sandbox, regiones, perfil/costos y deployments IA demostrados | Preparar validación concreta; mantener visible el proveedor o comportamiento no acreditado |
| DEC-009 | Tratamiento ficticio y recuperación definida para demo; privacidad/retención/residencia del piloto por resolver cuando corresponda | Avanzar con datos ficticios. No usar datos reales ni prometer cumplimiento legal, RPO/RTO o SLA sin definición y evidencia |
| DEC-011 | Alcance del candidato y freeze revisados con la capacidad real | Conservar 27 Must y línea base académica; preparar impacto/alternativas sin inventar cambio de calendario, horas o aprobación |
| DEC-012 | Dataset, distribución, IDs/reloj y procedimiento reproducible registrados | Adoptar un supuesto técnico reversible compatible con las cantidades; distinguirlo de aprobación previa |
| Efectos externos | Destino, costos, cambios, acceso y autorización vigentes identificados | Dejar artefactos y procedimiento concretos listos; solicitar solo la decisión faltante si fuera necesaria, sin repetir autorizaciones concedidas |

El inicio temprano de preproducción reduce riesgos de conectividad, JWT/orígenes, RLS, permisos cloud, cuota y latencia. IMP-08 repite el smoke sobre la versión candidata; no debe ser la primera ocasión en que los servicios se conectan. Este documento no ejecuta despliegues, ensayos pagados ni cambios remotos.

## Incrementos ordenados

| ID | Resultado observable y trabajo acotado | Artefactos propuestos | Verificación de salida |
| --- | --- | --- | --- |
| IMP-08.01 | Reproducir local y auditar separación de ambientes | Guía de arranque, scripts reales de prerrequisitos/servicios/migración/seed/pruebas/apagado, `.env.example`, configuración CI/infra | Otro checkout o ambiente limpio arranca con lockfile, Compose y Supabase CLI; no hay pasos ocultos ni reset automático; configuración inválida falla sin revelar secretos |
| IMP-08.02 | Fijar demo canónica y guion verificable | `fixtures/demo` o ubicación real, corpus versionado, reloj de prueba, cuentas ficticias y guion | Conteos exactos al crear y repetir seed; aislamiento entre organizaciones/clases; ejecución real correcta, fallida y timeout; ejemplos pregrabados etiquetados |
| IMP-08.03 | Consolidar configuración, observabilidad y controles de operación | Inventario por ambiente/proveedor, runbook, métricas, alertas y límites configurables | Salud y degradación coherentes; correlación intento/trabajo/proveedor; credenciales y logs protegidos; cuotas, presupuesto y destinatarios definidos antes de habilitar gasto/alertas |
| IMP-08.04 | Ensayar rollback compatible y restauración integral | Copias privadas, manifest de recuperación, procedimiento probado y registro de ensayo | Nueva revisión defectuosa se retira sin pérdida indebida; restauración separada preserva datos/archivos/citas/permisos y pasa aislamiento. Tiempo y punto efectivamente recuperados se reportan solo con medición; RPO/RTO comprometidos siguen pendientes de definición |
| IMP-08.05 | Completar manuales y material de entrega usando la versión real | Manual ADMIN, TEACHER y STUDENT; guía técnica; arquitectura/modelo/OpenAPI; decisiones; evidencias e informe/presentación a coordinar | Pasos, pantallas, contratos y límites coinciden con el candidato; otra persona sigue el guion. No confundir revisión interna con validación de usuarios o aceptación docente |
| IMP-08.06 | Preparar una release revisable y su decisión de promoción | Manifest de versión, cambios, compatibilidad de migraciones/contratos, checks, riesgos, costo y plan de recuperación | Commit/digest/configuración/corpus/arnés identificados; sin defectos altos conocidos de ruta crítica; autorización vigente comprobada para el destino concreto; las aceptaciones humanas faltantes quedan visibles |
| IMP-08.07 | Publicar únicamente en el ambiente autorizado y comprobar la versión promovida | Registro de despliegue y smoke del candidato, revisiones/URLs operativas pertinentes, incidencias | Backup necesario, migración compatible, API/trabajador, web y smoke en ese orden; lectura durable, ejecución, RAG/degradación y aislamiento reales. Si no hay autorización/configuración, queda listo para publicar con esa comprobación pendiente |
| IMP-08.08 | Entregar, ensayar contingencia y transferir operación | Paquete final, checklist de acceso/operación, inventario de pendientes, registro de revisión y guion de defensa | Otro integrante reproduce la demo y sabe recuperar fallas; contribuciones/aceptaciones reales identificadas; ninguna evidencia simulada se presenta como servicio en vivo |

La preparación de .01 a .05 acompaña fases anteriores. La ejecución final sigue las dependencias: dataset y entorno antes del ensayo, operación antes de recuperación, calidad y documentación antes de promoción. Manuales pueden redactarse en paralelo cuando los flujos estén estables. .07 tiene un efecto externo condicionado a la autorización efectiva; terminar el código no constituye esa autorización. .08 no añade funciones al MVP.

## Demo exacta y escenarios del guion

Cantidades documentadas por [operación](../../specs/11-operacion-y-despliegue.md), RNF-POR-02 y ORG-005:

| Entidad | Total canónico | Distribución propuesta DEC-012 |
| --- | --- | --- |
| Organizaciones | 2 | A y B, ficticias |
| Administradores | 2 | Uno por organización; sin acceso pedagógico implícito |
| Profesores | 2 | Uno por organización |
| Estudiantes | 8 | Cuatro por organización; los de A se reparten dos por clase |
| Clases | 3 | Dos en A y una en B |
| Ejercicios JavaScript | 10 | Cinco por organización; reutilizar versiones autorizadas cuando corresponda |
| Documentos | 6 | Dos por cada clase, con archivos y fuentes trazables |

Son 12 perfiles; fixtures adicionales negativos viven separados. Para negar acceso de un profesor válido a otra clase de su organización, retirar temporalmente su asignación en la variante de prueba y conservar el JWT anterior, luego restaurar el fixture. No crear una tercera organización o un profesor adicional en el seed canónico para resolver ese caso.

El seed debe ser idempotente y verificable por conteos/relaciones, conservar IDs o claves estables e incluir actividades `DRAFT/PUBLISHED/CLOSED`, seis diagnósticos, tres estados RAG, tres señales y revisión. Un reloj controlado reproduce ventanas de señales; no esperar siete o catorce días ni alterar el reloj productivo. Los fixtures demuestran preparación de datos, no ejecución real del proveedor.

Guion progresivo:

1. Administrador entra en su ámbito, consulta estructura/usuarios y muestra un rechazo seguro. El aprovisionamiento institucional completo depende de DEC-001; un seed no demuestra por sí solo RF-020.
2. Profesor prepara un ejercicio versionado dentro de sus permisos, publica una actividad y dispone de fuentes ya indexadas y autorizadas. La versión publicada conserva sus pruebas internas protegidas.
3. Estudiante se incorpora con código vigente, abre actividad y ejercicio, modifica el editor y ejecuta un fallo conocido. Una práctica no aumenta intentos confirmados ni progreso por envío.
4. Estudiante confirma el envío; se persisten intento, resultado y eventos. Cancelar antes de confirmar no muta. La lectura posterior muestra la misma identidad y evidencia.
5. Solicita ayuda `SUPPORTED`, abre la referencia autorizada y usa una pista; después reintenta con una solución correcta, conservando historial. Ejecuta también un timeout real.
6. Muestra `NO_EVIDENCE` y `PROVIDER_UNAVAILABLE` mediante casos controlados claramente descritos; el resultado técnico sigue disponible y reintentar ayuda no crea otro intento.
7. Profesor consulta progreso/detalle y las tres señales deterministas. Revisa una señal con confirmación y evidencia de responsable/fecha; cancelar mantiene `ACTIVE`; repetir conserva la revisión original.
8. Intenta acceder a otra organización y a una clase no asignada de su organización; verifica rechazo en servidor y ausencia de datos filtrados. Cierra con visor/CSV operativo autorizado y sin fórmulas ejecutables ni contenido pedagógico no permitido.

Las capturas y grabaciones de respaldo identifican la versión y qué fue ejecutado antes. Si un proveedor falla durante la defensa, explicar la limitación actual y mostrar esa evidencia como registro previo, nunca como respuesta en vivo.

## Runbook por componente

| Componente | Datos y controles operativos que documentar | Diagnóstico y recuperación a ensayar |
| --- | --- | --- |
| Next.js / Vercel | Release, API compatible, variables públicas frente a servidor, dominios/orígenes/callbacks y política de preview | Fallo de build, acceso o API incompatible; volver a despliegue compatible y comprobar sesión, navegación y contrato sin caché de datos ajenos |
| NestJS / Azure Container Apps | Digest y revisión de API/trabajador, puerto/probes, recursos, variables, conexión limitada y mecanismo de trabajos | Arranque fallido, revisión no saludable, lease vencido/reinicio y dos réplicas; reanudar sin duplicar intentos, feedback ni señales |
| Supabase Auth/PostgreSQL/Storage/pgvector | Proyecto/ambiente, versión real, migración, grants/RLS, roles de app/migración, bucket privado y corpus/generación | Caída de BD no confirma envíos; restaurar permisos/archivos/referencias, comprobar revocación con JWT anterior y evitar accesos de `service_role` en CRUD ordinario |
| Vercel Sandbox | Credencial de control desde Azure, región, arnés/runtime, entorno 1 vCPU/2 GB y límites internos de proceso | Error de creación, loop, memoria/salida, huérfano y caída del control; terminar recursos, reconciliar evidencia y registrar costo sin revelar pruebas ocultas |
| Azure OpenAI | Endpoint/deployment/API, credencial elegida, dimensión/modelo de embeddings, configuración/prompt y consumo | Cuota, timeout, respuesta inválida y falta de evidencia como causas distintas; conservar intento y diagnóstico; reintento acotado y fuentes revalidadas |
| GitHub Actions y artefactos | Checks, permisos mínimos, secretos por ambiente, identificación de candidato y retención de evidencia definida | Reproducir check fallido, impedir promoción de artefacto distinto del probado y mantener PR externos sin secretos productivos |

El runbook define síntomas, consulta segura, pasos concretos, responsable operativo por acordar, alcance, verificación posterior y evidencia. No basta listar servicios. La salud distingue proceso vivo, dependencias necesarias para dominio y capacidades degradadas: caída de IA no vuelve indisponible toda la API si puede leer/enviar; caída de BD impide aceptar escrituras. La salud detallada queda restringida al acceso operativo.

Registrar `requestId` y los `attemptId/executionId/jobId` que existan, release, ambiente, operación, duración, región, resultado y consumo. No registrar tokens, contraseñas, pruebas ocultas, código completo ni prompts íntegros en logs generales. Alertas sobre BD, cola envejecida, huérfanos, errores persistentes y consumo necesitan umbral/destinatario real definidos; el documento no acredita que estén activas.

Los límites por usuario/organización, concurrencia y gasto se acuerdan antes de pruebas de carga o consumo pagado. Mantener el tope directo documentado CLP 265.000 y registrar gasto real por proveedor/unidad/conversión efectiva; el total histórico CLP 4.585.000 incluye horas valorizadas. No usar cifras históricas como cotización actual ni como autorización para contratar servicios.

## Release, rollback y restauración

Antes de promover, preparar un manifest con commit, digest de API/trabajador, build web, migraciones/grants/RLS, runtime/arnés, configuración RAG/modelo/deployment, corpus/generación, ambientes de ensayo, resultados y defectos. Conservar evidencia saneada de compatibilidad. Un cambio incompatible requiere una transición explícita; preferir migraciones compatibles hacia adelante y mantener utilizable la versión anterior durante la transición cuando sea viable.

Con autorización vigente: verificar destino y estado → respaldo necesario → migraciones compatibles → nueva revisión API/trabajador → salud y contratos → web compatible → smoke de los tres roles/aislamiento → registro de resultado. El smoke usa datos ficticios, confirma persistencia, ejecutor, fuente autorizada/degradación, trabajos y limpieza. No promover una imagen reconstruida distinta de la probada sin verificarla.

Separar tres procedimientos:

- **Rollback de aplicación:** retirar revisión defectuosa de API/web y volver a artefactos compatibles con el esquema actual; comprobar contratos, lectura/escritura y permisos. No deshacer una migración de forma destructiva automáticamente.
- **Corrección de migración:** detener promoción si la compatibilidad o integridad falla, conservar evidencia y preparar corrección revisada. Cualquier cambio destructivo verifica destino, datos afectados y autorización específica.
- **Restauración integral:** recuperar en un ambiente separado BD, archivos privados de Storage, relaciones/versiones de fuentes, IDs/texto/localizadores de fragmentos citados, generaciones, feedback, intentos/resultados/eventos y permisos. Reconstruir embeddings no reconstruye por sí solo citas históricas ni objetos originales.

Ensayar la restauración con datos ficticios y volver a ejecutar el conjunto de aislamiento, referencias y vertical técnica. Verificar qué mecanismo recupera identidades/configuración de Auth y su coherencia con perfiles/membresías, sin asumir que un dump de tablas de dominio las incluye. Registrar el punto recuperado y el tiempo observado; RPO/RTO comprometidos, frecuencia, retención, residencia y eliminación permanecen sujetos a DEC-009. No atribuir garantías legales o SLA a un proveedor/plan sin definición aplicable y evidencia.

El arranque normal nunca reinicializa la demo. Si hay un comando de reset, debe ser explícito, verificar el destino y ámbito local/de prueba y rechazar producción. Las limpiezas se limitan a los recursos creados para el ensayo. En Windows comprobar rutas absolutas y utilizar operaciones literales dentro de una sola shell.

## Manuales y paquete de entrega

| Artefacto propuesto | Contenido que debe poder seguir otra persona | Relación con requisitos |
| --- | --- | --- |
| Manual estudiante | Sesión/incorporación, actividad/editor y borrador, ejecutar frente a enviar/confirmar, diagnóstico, pistas/fuentes, reintento/historial, progreso y fallas | ALZ-RF-001/003/007–015; RNF-USA-01 a USA-04 |
| Manual profesor | Clases, ejercicios/pruebas/versiones, publicación/cierre, materiales, tablero/detalle, significado de señales y revisión humana | ALZ-RF-002/004–006/016–019; RNF-IA-05; ORG-006 |
| Manual administrador | Ámbito/usuarios/roles/último admin, cursos/clases, conceptos, banco, fuentes/reindexación, reglas y auditoría/CSV; permisos pedagógicos no implícitos | ALZ-RF-020–027; RNF-SEG-01/05 |
| Guía técnica/operativa | Prerrequisitos, comandos reales, entornos, configuración, módulos, OpenAPI, datos/migraciones, CI, release, incidentes y recuperación | RNF-POR-01/03; RNF-MAN-01 a MAN-04 |
| Dataset y guion | Cantidades, distribución adoptada, reloj, corpus, preparación, negativos y contingencia | RNF-POR-02; ORG-005 |
| Evidencia y documentación CAPSTONE | RF/HU/CU/PT/escenarios/RNF/ORG → versión/prueba/resultado; arquitectura/MER vigente/DEC; contribuciones reales; informe y presentación coherentes | ORG-001 a ORG-004; criterios del Acta y del plan original |

Usar nombres/rutas de manuales acordes al árbol real, por ejemplo `docs/manuales` y `docs/operacion` cuando se creen. No generar capturas de pantallas inexistentes ni documentar botones o comandos todavía simulados como funcionales. Las fuentes Office originales y su historia se preservan; actualizar un informe académico requiere tarea y autoría reales, sin firmas inventadas.

La matriz completa de [IMP-07](07-calidad-integral.md) mantiene los 29 RNF y 6 ORG; aquí se reúnen especialmente RNF-POR-01/02/03, RNF-MAN-03/04, RNF-SEG-03/05 y ORG-001 a ORG-006, además de los RF del smoke. El equipo revisa la participación de Marcelo, Benjamin y Abraham conforme a las responsabilidades documentadas; ni delegación entre agentes ni cantidad de commits acreditan aportes humanos por sí solas.

Skills a seleccionar solo durante la tarea pertinente: `vercel:env-vars`, `vercel:deployments-cicd` y `vercel:vercel-cli` para la web; `azure-diagnostics` ante incidentes Azure; `azure-identity-ts` si coincide con el mecanismo elegido; `gh-fix-ci` ante checks fallidos. El [registro de skills](../agent/15-skills-recomendadas.md) conserva sus límites. Estar instalada una skill no configura herramientas, credenciales o infraestructura.

## Checklist de cierre

- [ ] Candidato y artefactos identificados; pruebas de IMP-07 y defectos enlazados a esa versión; sin defectos altos conocidos de la ruta crítica para recomendar entrega.
- [ ] Otra persona reproduce arranque y demo exacta, con comandos reales, configuración sin secretos y datos ficticios.
- [ ] Manuales de los tres roles y guía operativa corresponden a lo implementado; las funciones obligatorias pendientes permanecen visibles.
- [ ] Configuración por ambiente, orígenes/JWT/RLS, credencial Azure → Sandbox, corpus y servicios externos han sido comprobados en el ambiente declarado.
- [ ] Recuperación de aplicación y restauración integral se ensayaron en destino separado; se conservan permisos y citas históricas.
- [ ] Gasto, límites, alertas y responsables operativos se identifican como medidos/configurados/pendientes; no existen promesas inventadas de disponibilidad o privacidad.
- [ ] Desplegable, desplegado, probado y aceptado se reportan por separado; si falta autorización o credencial, el paquete queda preparado y el despliegue no se declara realizado.
- [ ] Contribuciones, revisión cruzada y aceptación CAPSTONE son reales o siguen pendientes; DEC-011/freeze no se resuelve modificando fechas silenciosamente.
- [ ] Contingencia ensayada y evidencias previas claramente etiquetadas; ninguna simulación se presenta como servicio en vivo.

**Siguiente paso:** cerrar el alcance autorizado con la entrega y pendientes concretos. Un piloto con datos reales, nuevas funcionalidades, soporte continuado o una nueva publicación requieren su propio alcance; no se inician automáticamente por acabar esta fase.

## Prompt para encargar un incremento

> Trabaja únicamente el siguiente incremento pendiente de IMP-08 en docs/plan/08-entrega-y-operacion.md. Lee AGENTS.md, identifica el candidato real y consulta el informe de IMP-07. Completa el resultado acotado y sus artefactos usando los comandos y rutas existentes; prueba reproducción y recuperación donde corresponda. Conserva AD-ARQ-001, AD-IA-001, las cantidades de demo y datos ficticios. Verifica autorizaciones vigentes para cada efecto externo y no pidas nuevamente una ya concedida; prepara una propuesta concreta si falta una decisión necesaria. No despliegues solo por preparar documentación. Reporta versión, cambios, comandos realmente ejecutados, resultados, estado de despliegue, revisión humana pendiente y siguiente trabajo, sin inventar mediciones ni aceptación.
