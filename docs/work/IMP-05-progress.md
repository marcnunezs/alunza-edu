# IMP-05.01–05.02 — Eventos y progreso por concepto al corte

Encargo autorizado: implementar el plan acordado el 02/10/2026. Cobertura
RF/HU/CU/PT-015 E1–E4 y regresión RF-007; RNF-IA-05, CON-02/04, SEG-01/05,
USA-02/03/04 y MAN-02/04. No acredita aceptación académica.

## Implementación

- Captura durable de apertura explícita y RUN; contrato interno normalizado
  sobre inscripción, SUBMIT y ayuda, sin copiar sus ledgers.
- Cálculo común SQL para progreso propio al corte, actividades y conceptos
  históricos, con evidencia del primer éxito y contadores exactos.
- GET /api/v1/me/progress y POST /api/v1/activities/{id}/open-events; contratos
  estrictos, OpenAPI y wrapper compatible del avance básico.
- Vista estudiantil /clases/{classId}/progreso con filtros, zona institucional,
  fracción/porcentaje, estados honestos y consulta de intento/ayudas.
- Aperturas deduplicadas entre transporte/remontaje/refresh; navegación
  intencional posterior conserva una nueva identidad.
- Fixtures independientes para eventos, corte y progreso. SIG-01–SIG-14 se
  conservan como PROPOSED, sin acreditar motor de señales ni aceptación docente.

Contrato y persistencia: [diccionario incremental](IMP-05-progress-dictionary.md).
Ensayos externos: [preparación y precondiciones](IMP-05-remote-validation.md).

## Trazabilidad del corte

| Escenario        | Evidencia implementada                                                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ALZ-HU-015-E1    | SQL: 2/3, conceptos históricos, ejercicio reutilizado, opcionales, reservas, RUN, UNKNOWN, fallo oculto y éxito seguido de fallo. HTTP: cálculo, replay, filtros y wrapper compatible. Cypress IMP05-01: filtros y evidencia navegable. |
| ALZ-HU-015-E2    | Contratos estrictos y HTTP: filtros extra/ajenos, fecha sin zona y corte futuro. Cypress IMP05-02: corte visible, servicio caído y recuperación sin fabricar cero.                                                                      |
| ALZ-HU-015-E3    | SQL/RLS y HTTP: dos organizaciones, clases, otros estudiantes, ADMIN/TEACHER, DRAFT y revocación con sesión previa. Cypress IMP05-03: acceso propio y rechazo de roles/ámbitos ajenos.                                                  |
| ALZ-HU-015-E4    | SQL/HTTP: 0/0 antes de publicación, concepto sin requeridos y ausencia de intentos. Cypress IMP05-01: filtro sin requeridos y porcentaje no calculable.                                                                                 |
| RF-007 y eventos | Wrapper de actividad con sus seis campos anteriores, más regresiones existentes de práctica. Cypress IMP05-04 y SQL/HTTP: replay, apertura intencional posterior y finalización durable RUN.                                            |

Los fixtures EVT/ORD/PRG son oráculos independientes; SIG-01–SIG-14 siguen
propuestos. La nueva comprobación SQL compara la respuesta completa con el
mismo corte antes y después de ayudas/fallbacks/ACKs, conservando intentos y
publicaciones. La modificación de ayudas no acredita ni elimina un logro.

## Verificación

Eventos, progreso, permisos y recorrido estudiantil están probados localmente.
El cierre técnico integrado local se completó el 04/10/2026: una corrida íntegra
de `npm run ci:verify` aprobó sus 17 controles. Las tres series SUBMIT
consecutivas conservaron 50 muestras seriales y 50 a concurrencia cuatro cada
una, cero fallos y p95 inferiores a 5.000 ms. El
[registro de SUBMIT y cierre](2026-10-04-submit-closure.md) conserva condiciones,
comparación A/B, comandos, percentiles recalculados y límites del diagnóstico.

La cuarta CI del 02/10/2026 se detuvo en el paso 14 con 13 controles aprobados.
Su continuación parcial y sus FAIL permanecen históricos; la nueva aprobación
proviene de la corrida completa del 04/10/2026.

| Verificación integrada del 04/10/2026              | Resultado                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `npm run ci:verify`                                | PASS 17/17; registrado a las 19:46:25 UTC, sin ediciones manuales durante la corrida                                            |
| `npm test` dentro de esa CI                        | 1.552/1.552 pruebas en seis grupos                                                                                              |
| `npm run test:integration`                         | 152/152 HTTP, 545 aserciones SQL/11 archivos, recuperación y asesores de seguridad aprobados                                    |
| Tres series SUBMIT de CI                           | p95 serial/c4: 1.827,90/3.792,36; 1.824,69/3.250,55; 1.945,19/3.297,92 ms; 300 muestras válidas, cobertura y limpieza completas |
| `npm run test:ai:integration` y `npm run test:e2e` | IA local PASS; Cypress 49/49, cero fallos/omitidos                                                                              |
| `npm run test:help:evaluation`                     | TEST PASS: 100+100 ayudas, 234 muestras, 763 recibos, tres reanudaciones, 43/43 casos y cero llamadas externas                  |

Las comprobaciones siguientes conservan la historia anterior del 02/10/2026.

Runtime observado: Node 24.21.0, npm 11.19.0, Supabase CLI 2.101.0,
Docker 29.7.2, Compose 5.3.1 y Cypress 16.0.0/Chrome 154.0.8037.59.
Los comandos Node/npm utilizan `. ./scripts/use-node.ps1` desde la raíz Git.

| Comando realmente ejecutado                                                                          | Resultado observado                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test` dentro de CI                                                                              | 1.385/1.385 pruebas en seis grupos; incluye los contratos y oráculos independientes nuevos.                                                                                                 |
| `npm run test:integration` dentro de la cuarta CI                                                    | 152/152 HTTP y 11 archivos/545 aserciones SQL, incluidas 74 nuevas; recuperación de servicios y asesores de seguridad aprobados.                                                            |
| `node .local/progress-sql-preserved-check.mjs`                                                       | 74/74 sobre TEST conservado después de HTTP, sin reset; foco anterior a la última CI.                                                                                                       |
| `node .local/progress-preserved-plan.mjs`                                                            | Comparación focal antes de reconstruir TEST: JSON idéntico y válido con los mismos datos persistidos, rol/contexto y corte; tiempos registrados en incidencias.                             |
| `npm run test:ai:integration` por separado                                                           | PASS local con proveedores ficticios explícitos; no acredita Azure.                                                                                                                         |
| `npm run test:e2e` por separado                                                                      | 49/49, cero fallos/omitidos; IMP05-01/02/03/04 aprobados con Auth, API, PostgreSQL/RLS y Docker reales.                                                                                     |
| `npm run test:help:evaluation` por separado                                                          | Repetición PASS con candidato congelado: 100/100 ayudas seriales y 100/100 con concurrencia cuatro, 763 recibos, 234 muestras y tres reanudaciones; proveedor TEST, cero llamadas externas. |
| `npm run ci:verify` del 02/10/2026                                                                   | Cuatro corridas reales; cuarta FAIL en tercera serie SUBMIT. No se debilitan gates ni se eliminan muestras fallidas.                                                                        |
| `npm run help:eval -- --mode plan --manifest infra/preproduction/imp-05-ai-preparation.example.json` | Salida 0, seis precondiciones pendientes y cero llamadas externas.                                                                                                                          |
| `npm run preprod:check -- infra/preproduction/imp-05-sandbox-preparation.example.json`               | Salida 2 esperada por precondiciones pendientes; no se despacha Sandbox.                                                                                                                    |

La continuación anterior se ejecutó con `node .local/imp-05-ci-remaining.mjs`. Reportes
locales: `.local/reports/imp-05/ci.json`, `ci-remaining.json`, `integration.json`
y `e2e.json`; preservan también historial. La repetición directa de ayudas
aprobó el 02/10/2026 a las 23:07:12 UTC y conserva su resultado en el historial de
`.local/reports/imp-04/evaluation-test.json`, con cobertura completa de 43/43
casos. Esto no establece calidad pedagógica ni aceptación académica.
El foco SQL conserva su log en
`.local/progress-sql-preserved.log`. Los planes de la medición focal están en
`.local/progress-preserved-plan.json` y `.local/progress-optimized-plan.json`.
El perfil SUBMIT y sus muestras se conservan en
`.local/reports/imp-03-submissions/submit-performance.json` y su historial.

## Incidencias corregidas

- La revisión de contratos detectó pérdida de precisión submilisegundo en la
  comparación de evidencia/corte. La normalización conserva seis decimales y la
  comparación usa microsegundos; el caso de evidencia un microsegundo posterior
  al corte se rechaza.
- El wrapper SQL requirió corregir la precedencia de operadores JSONB. La
  interfaz requirió recargar al volver de filtros históricos al corte actual.
- El foco Cypress inicial aprobó 3/4 casos; el restante buscaba texto visible
  para un cierre cuyo nombre accesible es «Cerrar diálogo». Se corrigió el
  selector, conservando las aserciones de progreso y navegación.
- La primera CI aprobó 1.385 pruebas unitarias/de contratos y 146 casos HTTP;
  seis casos nuevos fallaron al crear una organización ficticia con código en
  minúsculas. El fixture ahora respeta la restricción institucional.
- La segunda CI aprobó 152/152 HTTP y las recuperaciones de materiales/ayuda,
  pero el fixture SQL nuevo intentó actualizar conceptos ajenos archivados.
  Se acotaron mutaciones y conteos a sus propios IDs/organización. El foco SQL
  posterior, sobre la misma base conservada tras HTTP y sin reset, aprobó sus
  74 aserciones. La prueba de purga verifica los dos RUN propios sin asumir el
  conteo global de respuestas expiradas.
- La tercera CI aprobó HTTP/SQL y los perfiles de rendimiento; Cypress aprobó
  los 45 casos anteriores, pero la preparación del progreso recibió 503 tras
  2.014 ms. El plan SQL sobre los datos conservados identificó lecturas
  conceptuales repetidas bajo RLS. Se acotaron los joins por organización/clase
  y se reutilizan asociaciones autorizadas por versión en un CTE materializado,
  conservando el límite SQL de dos segundos y los permisos vigentes.
  La comparación sobre TEST conservado, mismos datos persistidos, rol/contexto y corte
  produjo JSON idéntico y válido: consulta anterior 726,5 ms, nueva 152,3 ms;
  EXPLAIN ANALYZE de la nueva consulta 131,1 ms. Son mediciones focales únicas,
  no percentiles ni evidencia de rendimiento productivo.
- La cuarta CI aprobó 1.385 pruebas unitarias/de contratos, 152/152 HTTP y
  545 aserciones SQL con la consulta optimizada. Se detuvo en la tercera serie
  SUBMIT: p95 con concurrencia cuatro de 5.620,75 ms frente al gate de 5.000 ms,
  con 50/50 muestras y cero fallos; el perfil serial también completó 50/50.
  Las dos series anteriores aprobaron con p95 paralelos de 4.407,96 y 4.333,30 ms.
  El aumento medido se concentra en ejecución Docker; la finalización SQL tiene
  p95 de 53,25/47,95/55,58 ms. Estos percentiles no se suman entre componentes.
  Los snapshots no identifican una causa externa concreta. Se conserva el FAIL,
  sin modificar umbral, concurrencia o muestras, y se ejecutan por separado
  las tres comprobaciones restantes. Esto no convierte la CI original en verde.
- La evaluación TEST de la continuación se detuvo en `authorize` con
  `CANDIDATE_CHANGED`: se editaron documentos y se restauró `next-env.d.ts`
  mientras preparaba la corrida. No llegó a despachar proveedores. Se terminan
  esas ediciones antes de repetir la evaluación y se conserva la comprobación
  de huella; no se modifica el validador para aceptar un candidato distinto.
  La repetición posterior con el workspace congelado aprobó ingestión,
  calibración, comprobaciones funcionales y evaluación: 100 ayudas seriales y
  100 con concurrencia cuatro, 763 recibos, 234 muestras y tres reanudaciones,
  con proveedor TEST y cero llamadas externas. El reporte de la continuación
  original conserva su FAIL; la repetición tiene su propio resultado aprobado.

## Pendientes delimitados

El gate global SUBMIT y la CI completa quedaron revalidados en Windows/Docker.
La comparación A/B conserva un FAIL diagnóstico de 5.271,86 ms y no identifica
una causa concreta que justifique modificar SQL o el ejecutor. El diagnóstico
continuo queda disponible para investigar recurrencias; su resultado no
sustituye la aceptación con instrumentación habitual. CI Linux es una
verificación posterior independiente.

Azure real requiere configuración, recursos, cuotas, precios y presupuestos
concretos; Sandbox requiere manifiesto y capacidad remota. No se invocan
proveedores por sustituir estos datos con placeholders. La preparación offline
no cierra IMP-04.08 ni IMP-03.07.

El siguiente corte funcional es IMP-05.03–05.05: versiones de reglas, evaluadores
y episodios durables. Ventanas, firma de error, comparabilidad y episodios de
DEC-005 mantienen su estado de propuesta. El tablero y seguimiento docente
continúan en sus incrementos posteriores.
