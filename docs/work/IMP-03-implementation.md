# IMP-03 — Circuito de práctica local y avance del 50%

Encargo aprobado en este chat: implementar el plan para alcanzar **14/27 RF (51,9%) probados localmente**, conservando los nueve de IMP-02 y cerrando RF-005/007/009/011/014. RF-010 se implementa técnicamente, pero no se cuenta completo hasta revalidar HU-010-E4 con la ayuda real de IMP-04. No acredita aceptación académica ni integración productiva.

Estado del 23/10/2026: **14/27 RF (51,9%) probados funcionalmente en local**. Se conservan RF-001/002/003/004/008/020/021/022/023 y se cierran localmente RF-005/007/009/011/014. **CI local aprobado: 14/14 controles**, con p95 SUBMIT concurrente de **3502,71 ms**, inferior a 5000 ms. RNF-REN-02 cumple el perfil local medido; no acredita rendimiento productivo, aceptación del profesor ni publicación. Los resultados se obtuvieron nuevamente en el principal.

## Procedencia y decisiones

- Base del proyecto: `c8bc969`. El candidato local se identifica por la huella de fuentes de la evidencia; conserva el esquema académico, los documentos previos y `next-env.d.ts`.
- DEC-002, ratificada por el usuario: admisión anterior al cierre puede finalizar y persistir; admisión posterior se rechaza. Histórico propio separado del catálogo PUBLISHED, con permisos vigentes.
- Se conservan esquema académico, UUID, `VISIBLE/HIDDEN`, `EXACT_DEEP`, dificultades, límites publicados y navegación `/academia/[orgId]/…`.
- Runner QuickJS/WASM reforzado, función `solve` y `module.exports.solve`. Los máximos son 134217728 bytes, 3000 ms acumulados y 65536 bytes de salida; cada versión puede reducirlos. Docker no admite memoria inferior a 6 MiB: se devuelve UNKNOWN/CAPABILITY_GAP sin ejecutar ni aumentar el límite. Los límites viables se redondean hacia abajo a páginas de 4096 bytes.
- RUN solo visible/temporal; SUBMIT conserva código, resultado y eventos atómicos. Reenvío de transporte conserva clave; nuevo intento usa nueva clave. Sin IA ni resultados simulados en rutas de producto.
- Migración aditiva y aislamiento de TEST. Los identificadores Docker de Alunza separan sus cápsulas; la limpieza se limita a recursos propios.

## Implementación entregada

- API NestJS: `POST /api/v1/activities/{id}/exercises/{assignmentId}/executions`, `POST/GET /api/v1/activities/{id}/exercises/{assignmentId}/attempts`, `GET /api/v1/attempts/{id}` y `GET /api/v1/activities/{id}/progress`. Los POST reciben código, versión e `Idempotency-Key`; autor, permisos, pruebas y límites se resuelven en el servidor.
- `GET /api/v1/classes/{id}/attempted-activities` permite descubrir únicamente la evidencia propia autorizada de actividades cerradas. No amplía el catálogo académico ni vuelve a entregar la plantilla.
- Migración `20261023040609_practice_and_submissions.sql`: ejecuciones, intentos, reservas durables, resultados privados y eventos. La confirmación espera el commit; la recuperación conserva la clave y no duplica el intento. La vigencia del lease se comprueba después de obtener el bloqueo, también cuando hubo espera.
- Contratos ejecutables y OpenAPI separan evidencia privada y respuesta estudiantil. Se entregan los seis diagnósticos contractuales y solo datos públicos de pruebas visibles; los intentos UNKNOWN siguen siendo consultables.
- Editor existente: RUN temporal, confirmación de SUBMIT con instantánea de código, recuperación tras respuesta perdida, historial paginado, comparación y copia confirmada. Borrador y solicitudes locales están separados por cuenta/contexto, conservados ante errores y retirados al cerrar sesión. Las respuestas tardías no sustituyen la sesión o el intento más reciente.
- Progreso calculado desde entregas persistidas: RUN no suma, las pruebas requeridas ocultas cuentan, un éxito anterior se conserva y el denominador cero produce proporción nula. La interfaz distingue ausencia de intentos, ausencia de ejercicios requeridos y fallo de consulta.
- Arranque compilado mediante `npm run demo`; construcción de API y job con sus dependencias de runner. Compose conserva el ejecutor de host deshabilitado; la guía indica el arranque que sí ofrece RUN/SUBMIT.

La [matriz RF/HU/CU/PT](IMP-03-trazabilidad.md) enlaza los veinte escenarios nuevos y la regresión de los nueve RF previos. El [guion de demostración](IMP-03-demo.md) usa las cuentas ficticias existentes y conserva el historial de cada ensayo.

## Datos conservados y alcance

La actualización del entorno principal comparó los valores completos de las **114 filas de sus 20 tablas preexistentes** antes y después de migrar, mediante hashes canónicos en memoria: sin cambios. El seed idempotente conserva las dos organizaciones, dos administradores, dos profesores, ocho estudiantes, tres clases y diez ejercicios. TEST se reinicia de forma aislada para instalación limpia e incrementales; no reinicia desarrollo ni afecta recursos ajenos.

Se preservaron los documentos CAPSTONE modificados, archivos auxiliares y respaldos existentes. Los cambios de implementación permanecen en el árbol de trabajo, sin commit ni publicación remota.

La auditoría de dependencias mantiene 14 entradas de paquetes afectadas ya presentes en la base (5 críticas, 7 altas y 2 moderadas); QuickJS 0.32.0 no añade entradas señaladas. El arranque compilado evita el endpoint MCP de desarrollo de Next. La [comparación saneada](evidence/imp-03/dependency-audit.json) documenta esta deuda previa; requiere revisión antes de publicar y no se interpreta como auditoría limpia.

RF-010 sigue parcial por HU-010-E4. IA/RAG, progreso completo por conceptos, señales, aceptación del profesor, GitHub Actions remoto y Vercel Sandbox productivo quedan posteriores. El ensayo heredado de IA usa pgvector local y un doble explícito: no incorpora IA al producto ni acredita Azure OpenAI.

## Evidencia

Las pruebas usan Node 24.21.0/npm 11.19.0, Supabase local y Docker Linux. Reportes privados reproducibles en `.local/reports/imp-03/`; [evidencia saneada](evidence/imp-03/README.md) y huella del código en `docs/work/evidence/imp-03/`. El ejecutor conserva sus reportes técnicos originales en `.local/reports/imp-00-06-08/`.

| Verificación ejecutada | Resultado |
| --- | --- |
| Unitarias y contratos (`npm test`) | 675 aprobadas, seis grupos |
| API real con Supabase/Docker | 111/111 |
| pgTAP, roles y RLS | 313/313, siete archivos |
| Runner Docker adversarial | 78/78; limpieza comprobada |
| Cypress Chrome 155, Cypress 16 | 34/34; sin omitidas ni pendientes |
| Instalación limpia y migración incremental | Aprobadas; datos previos conservados |
| Regresión pgvector local con proveedor doble explícito | 27/27; sin Azure |
| Formato, lint, tipos y builds | Aprobados en el CI completo |
| Imágenes API/job y configuración Compose | Aprobadas |
| RUN completo, 100 solicitudes | Aprobado |
| SUBMIT completo, 100 solicitudes | Todas correctas y persistidas; p95 concurrente 3502,71 ms |
| `ci:verify` local | 14/14 controles aprobados sobre la misma huella de código |

### Corrección del rendimiento concurrente

El fallo inicial de SUBMIT (p95 concurrente **5164,50 ms**) se conserva como evidencia histórica. La instrumentación posterior confirmó una consulta redundante de imagen y dos conexiones `attach` que podían negociarse simultáneamente. Se comparten únicamente lecturas de imagen pendientes, se consultan capacidades e imagen en paralelo y SUBMIT conserva el ID SHA-256 validado para esa operación. Ambos canales deben estar abiertos antes de arrancar; fallos y cancelaciones esperan también el cierre de conexiones tardías. No se reutilizan cápsulas ni se amplían límites; reservas, resultado durable, commit del intento y recuperación mantienen su orden.

La comparación instrumentada obtuvo p95 concurrente de **5708,82 → 3231,95 ms**. La repetición dentro de `ci:verify` obtuvo **3502,71 ms**, con 100/100 envíos correctos y persistidos, ejecuciones e intentos únicos y cero cápsulas pendientes. RUN obtuvo p95 de 1030,14 ms secuencial y 2227,87 ms concurrente; SUBMIT secuencial, 1654,12 ms. Se conservaron todas las muestras y el umbral estricto <5000 ms. El [análisis de rendimiento](evidence/imp-03/performance-analysis.md) distingue las corridas, sus imágenes y la variación del host; no atribuye toda la mejora a un cambio individual.

`ci:verify` aprobó sus catorce controles, incluida la regresión local de IA/pgvector y Cypress, sobre la huella `5a5ec24f2a9535101f7cb7a303460d479a06bdf866c4b592ab1b1fcf61076194`. Pendientes: revisar deuda previa de dependencias antes de publicar; ensayo de presentación y aceptación del profesor. RF-010-E4, IA/RAG y ejecución remota mantienen el alcance posterior ya acordado.
