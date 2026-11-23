# IMP-05.06 — Administración de reglas y parámetros efectivos

Fecha de inicio: 25/10/2026, America/Santiago. Cierre registrado: 26/10/2026.
Estado: **IMPLEMENTADO Y VERIFICADO LOCALMENTE**.
El usuario autorizó implementar el [plan de continuación](IMP-05-rules-ui-plan.md)
con «Perfecto. Implementa este plan». Ese alcance incluye código, migración
aditiva, interfaz y verificación local; no despliegues ni llamadas pagadas.

## Alcance y base

ALZ-RF/HU/CU/PT-026 E1–E4, UX-18 y conexión con el motor persistente de RF-018.
Conserva DEC-005 D1–D5. Tablero .07, aceptación conjunta .08, revisión docente,
visor general de auditoría/CSV y validación remota permanecen fuera del corte.

Rama `laboratorio`, HEAD `75708ceecf2ca755bd32fb4b04e77bcb8de310f4`, con cambios
previos preservados. Captura inicial de fuentes de esta ejecución:
`2e1e482a1aaa8d34e76603ce09c9b0fea5fc4a00b5271c8dd2f087a0ca05290c`;
inventario privado en `.local/evidence/imp-05-05/rules-ui-start-candidate.json`.
La CI anterior documentada en [episodios](IMP-05-episodes.md) no acredita .06.

La CI de este corte terminó `2026-10-26T02:16:14.949Z` (25/10, 23:16 en
Santiago), con **17/17 etapas PASS**. Al retomar el 26/10 se comprobó que las
515 fuentes conservaban exactamente el digest aprobado:
`a73534c65eeb8e0ccf0ddb37e8d941401685fe885021272867fddcb374ba29e9`.
Las capturas `ci-start`, `ci-end` y `rules-ui-closure` de
`.local/evidence/imp-05-05/` identifican ese candidato. El cierre documental
posterior actualiza estado y evidencia; no modifica las fuentes probadas.

## Implementación

- Lectura administrativa `GET /api/v1/organizations/{orgId}/signal-rules/effective`,
  con exactamente tres tipos y versión ACTIVE o null, independiente del historial.
- Migración `20261026005905_signal_rule_effective.sql`: única RPC STABLE de lectura,
  propietario limitado, permisos mínimos y observación a tiempo de sentencia.
- Pantalla por organización: parámetros efectivos, historial/detalle, creación
  y activación con CAS, autores/fechas, archivo de solo lectura y errores claros.
- Registro pendiente de operación en sessionStorage por cuenta/organización,
  validado antes del envío, para reconciliar con la misma clave tras una recarga.
- Pruebas de contratos/API/datos, actualización desde .05 y recorrido Cypress
  que comprueba cambio de regla en el motor sin exponer evidencia al ADMIN.

La lectura usa el [snapshot de sentencia de funciones STABLE](https://www.postgresql.org/docs/17/xfunc-volatility.html)
y mantiene las restricciones de [seguridad de funciones](https://supabase.com/docs/guides/database/functions)
con el patrón del repositorio. `observedAt` no es un corte de evaluación ni una
confirmación de procesamiento. El worker conserva su activación explícita.

## Verificación

Resultados ejecutados del candidato, diferenciando los focos de preparación
de la CI final. No se omitieron etapas ni se relajaron límites.

| Comprobación          | Estado / evidencia                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contratos/API focales | 41 contratos y 30 unidades controller/service aprobadas por el agente backend; tipos/lint focales aprobados                                                           |
| HTTP/SQL focales      | PASS: `node scripts/rules-integration.mjs`, 15 HTTP y 957 aserciones SQL/14 archivos; `.local/reports/imp-05/rules-focused.json`                                      |
| Upgrade .05 → .06     | PASS: `node scripts/rules-upgrade.mjs`; `.local/reports/imp-05/rules-upgrade.json`                                                                                    |
| Fixtures E2E aislados | PASS: historial de 105 versiones, activación por segundo ADMIN, tres intentos reales, episodio revisado y nueva regla; `.local/reports/imp-05/rules-fixtures.json`    |
| Web/E2E/visual        | Foco PASS 9/9; CI final PASS 58/58, incluidos los nueve casos de reglas, sin pendientes ni omisiones. Tres PNG completos revisados                                    |
| Rendimiento API       | CI PASS: 50 consultas por perfil sobre 103 versiones; p95 secuencial 12,27 ms y concurrencia cuatro 22,68 ms; cero fallos                                             |
| Rendimiento pantalla  | CI PASS: 50 navegaciones calientes, p95 438,50 ms y primera navegación separada 209,50 ms; 105 versiones y cero fallos; concurrencia cuatro corresponde al perfil API |
| CI final              | PASS `npm run ci:verify`: 17/17 etapas, 2.152 unidades en seis grupos, 184/184 HTTP, 957 aserciones SQL/14 archivos y 58/58 E2E; `.local/reports/imp-05/ci.json`      |

Entorno observado: Windows, Node 24.21.0, npm 11.19.0, Supabase CLI 2.101.0,
Docker 29.7.2, Chrome 155.0.8059.85 y Cypress 16.0.0. Auth, API,
PostgreSQL/RLS y ejecución Docker fueron reales en LAB TEST; los proveedores
IA de las suites de regresión fueron dobles TEST explícitos.

| Criterio              | Evidencia y comportamiento comprobado                                                                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HU/CU/PT-026 E1       | `IMP05-RULES-01`: crear y activar los tres tipos, autoría/vigencias e historial persistidos; crear DRAFT no cambia las efectivas                                                                                                 |
| E1 y conexión RF-018  | `IMP05-RULES-08`: activación UI, tres intentos reales, nueva regla consumida por el motor, episodio nuevo vinculado y revisión histórica intacta; verificación privada Node                                                      |
| E2                    | `IMP05-RULES-04`, HTTP y SQL: conflicto CAS con otro ADMIN, expectativa conservada durante revalidación, recarga y nueva confirmación; versiones inmutables y retirada no reactivable                                            |
| E3                    | `IMP05-RULES-03`, HTTP y SQL: TEACHER/STUDENT y ADMIN ajeno rechazados; perfil/membresía revocados; lectura administrativa ARCHIVED y rechazo de mutaciones                                                                      |
| E4                    | `IMP05-RULES-02`, contratos/HTTP/SQL: errores de campos, enteros/int4, extras y algoritmo; corrección mantiene formulario y configuración previa                                                                                 |
| Recuperación          | `IMP05-RULES-05/07` y unidades web: misma clave/cuerpo tras respuesta perdida, renovación real Auth y recarga; auditoría sin duplicación, replay histórico separado de vigencia actual y fallo de almacenamiento previo sin POST |
| Lectura y aislamiento | `IMP05-RULES-06`, contrato, HTTP/SQL: activa fuera de primera página, borrador posterior, reinicio del cursor, tres tipos únicos y snapshot consistente durante activación concurrente                                           |
| UX y rendimiento      | `IMP05-RULES-09`: 50 navegaciones, teclado/foco, viewports y PNG exactos, ausencia de desbordamiento horizontal                                                                                                                  |

Reportes finales en `.local/reports/imp-05/`: `integration.json`, `e2e.json`,
`rules-api-performance.json`, `rules-ui-performance.json` y
`rules-ui-screenshots.json`, con muestras/historial conservados. La primera
navegación de pantalla se registra aparte; no se midió arranque frío de los
servicios. El p95 usa nearest-rank y el gate de reglas conserva <3.000 ms.

La regresión RUN aprobó 50 muestras por perfil, p95 de 1.051,38/1.989,44 ms
(serie/concurrencia cuatro) y cero fallos. Las tres series SUBMIT consecutivas
aprobaron 100 respuestas válidas cada una, con p95 <5.000 ms:

| Serie SUBMIT | p95 secuencial (ms) | p95 concurrencia cuatro (ms) |
| ------------ | ------------------- | ---------------------------- |
| 1            | 1.674,67            | 3.043,65                     |
| 2            | 1.621,93            | 3.215,65                     |
| 3            | 1.654,07            | 3.005,65                     |

Los tres reportes conservan candidato, imagen y entorno sin cambios, con
huella de árbol `7478ae9673fd3683e6619e186819560f08acd0d1a7b36dc0c321a05ad7c00b05`.
Evidencia: `.local/reports/imp-03-submissions/history/submit-performance-*.json`.
La evaluación de ayuda TEST completó 234 muestras, 763 recibos, cobertura de
43/43 casos y tres reanudaciones, con cero llamadas externas. Su medición
`BROWSER_REQUEST_TO_VISIBLE_FEEDBACK` sigue pendiente; el PASS del arnés no
acredita esa latencia de ayuda ni calidad pedagógica Azure.

Se conserva el perfil local y los datos crudos; las mediciones no acreditan
latencia remota. Las revisiones de teclado, estados y capturas no equivalen a
conformidad WCAG completa ni a aceptación docente/CAPSTONE.

La actualización conservó tres versiones, cinco eventos de auditoría, tres
intentos, un episodio y su revisión. Digest antes/después y tras la lectura:
`521c88e5e96fd6c1474d6945da3cfe80896e021fdc6319c93c64c2d2227443d3`.

El primer foco HTTP tuvo 14/15 PASS: la nueva prueba de concurrencia intentó
`SET ROLE alunza_app` desde un rol de migración sin esa membresía. Se corrigió
el arnés para conectar directamente como runtime limitado, conservando las
aserciones; el segundo foco aprobó 15/15. El fallo queda en el historial del
reporte y `.local/evidence/imp-05-06/focused-error.log`.

Los dos primeros focos Cypress detectaron fallos de preparación: códigos de
organización en minúsculas, contexto de organización ausente en las llamadas
SQL del fixture y ejercicio sin concepto asociado. Se corrigieron los datos
y el contexto del arnés, sin cambiar restricciones de producción. El segundo
foco ya aprobó 01/02/03/07; no se atribuye aprobación a la suite fallida.
Antes del siguiente foco se verificaron por separado todos los fixtures con
Auth, API, PostgreSQL y Docker reales; el puente produjo un nuevo episodio y
conservó la revisión anterior. Los fallos permanecen en el historial E2E y los
diagnósticos saneados de `.local/evidence/imp-05/`.

El tercer foco Cypress aprobó los nueve casos, incluida renovación real Auth
mediante el SDK, recarga y reconciliación con la misma clave. La inspección
de sus PNG encontró recorte por el tamaño físico de la ventana Chrome: 622 px
de alto, aunque los viewports DOM tenían las medidas solicitadas. Se conserva
esa evidencia en `.local/evidence/imp-05/rules-focus-cropped/`. Se ajustó el
arnés de captura antes de la CI, que comprobó los PNG completos de 1440×900,
768×1024 y 390×844. Se inspeccionaron visualmente las tres imágenes finales
en `.local/evidence/imp-05/screenshots/signal-rules.cy.ts/`, con cabecera,
navegación, parámetros y controles legibles y sin recorte horizontal.
Las 50 muestras de este foco están preservadas en
`.local/reports/imp-05/history/rules-ui-performance-focus-20261026T011912Z.json`.

## Continuación

IMP-05.06 queda cerrado técnicamente en el laboratorio local. La siguiente
unidad de implementación es IMP-05.07, tablero docente, que no se inicia en
este encargo. IMP-05.08, revisión docente IMP-06, aceptación humana/CAPSTONE,
GitHub Actions remoto, Azure OpenAI y Vercel Sandbox productivo conservan sus
pendientes. El cierre no declara aceptada toda IMP-05 ni despliega cambios.
