# IMP-05.07 — Tablero docente y progreso personal integrado

Fecha de inicio y cierre técnico local: 26/10/2026. **Estado: implementado y verificado localmente; CI final 17/17 PASS.**
Solicitud: implementar el plan aprobado en esta conversación, conservando
las decisiones de presentación de ACTIVE histórico y matrícula vigente.

## Alcance y base

RF/HU/CU/PT-015, 016 y 018; RNF de aislamiento, determinismo, accesibilidad y
rendimiento. Se reutilizan .01–.06 y se conservan las fórmulas DEC-005.
RF-017 integral, RF-019, aceptación transversal .08, despliegues y aceptación
CAPSTONE no forman parte de este cierre.

El repositorio tenía numerosos cambios previos, incluidos Office, ejecución,
IA, reglas y episodios. Se preservaron; este incremento no reinicia el proyecto
ni acredita como propias esas contribuciones.

## Candidato y evidencia de cierre

La CI final terminó el **26/10/2026 a las 19:42:31.499 UTC**. Su huella de
538 archivos de fuente es
`b90287f4d30e868f421935f0b942974f60b44c6163411a2fb288eecd32cdb3f1`;
se mantuvo idéntica durante toda la ejecución. HEAD base:
`75708ceecf2ca755bd32fb4b04e77bcb8de310f4`. Es un candidato de árbol de trabajo
con cambios previos, no un commit nuevo de este incremento.

Se conserva una copia de 26 artefactos en
`.local/evidence/imp-05-07/final`: CI, HTTP/SQL, actualización, rendimiento API,
pantalla y carga, Cypress focal/completo, evaluación TEST, tres reportes SUBMIT
y 14 capturas. `manifest.json` contiene sus hashes SHA-256. Los informes
mantienen las muestras completas, sus fechas y el perfil utilizado. La
medición API y la actualización son focos anteriores al ajuste visual; sus
consultas y migración no cambiaron después. Las métricas de pantalla y la CI
corresponden al candidato final.

La documentación de cierre se actualizó después de terminar CI y se verificó
por separado. La huella de fuentes excluye documentación y los dos archivos
generados declarados por el script; no se atribuye a esa documentación posterior
la identidad exacta del árbol completo medido por los gates.

## Trabajo

- [x] Contratos públicos de tablero, evidencia, historia de señales y observación personal.
- [x] Controladores/servicios NestJS de lectura y OpenAPI generado.
- [x] Migración y consultas privadas verificadas con PostgreSQL real.
- [x] Interfaz integrada con datos reales y casos adversos.
- [x] Instalación y actualización desde .06 con preservación demostrada.
- [x] Rendimiento, teclado, revisión visual y CI final del candidato estable, con los límites documentados abajo.

El [diccionario](IMP-05-dashboard-dictionary.md) describe fechas, filtros,
matrícula, páginas, evidencia permitida y compatibilidad.

## Entrega implementada

- Migración `20261026163925_teacher_dashboard.sql`: núcleo común de progreso,
  agregados por pares estudiante/asignación, observación temporal, evidencia
  mínima y proyección histórica de episodios. Funciones privadas con
  propietario limitado y autorización vigente antes de leer.
- NestJS publica cuatro GET docentes y amplía `/me/progress`. Los DTO,
  OpenAPI, validación de cursores, errores y readiness evolucionan juntos.
- `/clases/[classId]/tablero` enlaza desde la clase del docente: filtros,
  resúmenes, estudiantes, diagnósticos, conceptos y señales con diálogos de
  evidencia. Progreso personal añade intentos y ayudas sin mezclar evidencia
  del período con la que acredita completitud.
- Las consultas no evalúan reglas ni mutan episodios. Conservan la matrícula
  vigente para totales y distinguen señales históricas, revisión,
  interrupción, última evaluación y problemas de procesamiento.

## Entorno y reproducción

Comandos desde la raíz, con `./scripts/use-node.ps1`: Node 24.21.0, npm 11.19.0,
Supabase CLI 2.101.0 y Docker local. Los arneses reservan exclusivamente
`alunza-edu-laboratorio-test`, usan datos ficticios y liberan servicios al
terminar. No modifican la base de desarrollo ni una base remota.

| Comando                              | Evidencia local                                    |
| ------------------------------------ | -------------------------------------------------- |
| `npm run test:dashboard:integration` | `.local/reports/imp-05/dashboard-focused.json`     |
| `node scripts/dashboard-upgrade.mjs` | `.local/reports/imp-05/dashboard-upgrade.json`     |
| `npm run test:e2e -- --dashboard`    | `.local/reports/imp-05/e2e-dashboard.json`         |
| `npm run test:dashboard:performance` | `.local/reports/imp-05/dashboard-performance.json` |
| `npm run ci:verify`                  | `.local/reports/imp-05/ci.json`                    |

La CI mantiene sus 17 etapas y los tres gates SUBMIT consecutivos. Los
reportes de navegador, carga, muestras y capturas complementan ese registro;
su existencia por sí sola no acredita una ejecución aprobada.

La actualización .06 → .07 aprobó: seis intentos, doce eventos, dos episodios,
una revisión y tres reglas preservados. Los hashes antes/después coinciden
(`06fdc7d2011f02188054363348cba7030ff8dfeff9a4d61b839c7ae16beaf6ee`),
y la respuesta de progreso anterior conserva exactamente su contenido.

## Perfil de rendimiento local

Equipo observado: Intel Core i7-1355U (10 núcleos, 12 procesadores lógicos),
31,5 GiB de RAM; Docker expone 12 CPU y aproximadamente 15,4 GiB. Servicios
en localhost, datos ficticios, sin Azure ni Sandbox remoto. El fixture tiene
dos estudiantes, tres obligaciones por estudiante, cinco intentos y un logro.
Este perfil pequeño no acredita capacidad para una cohorte productiva.

La API alterna dos páginas con `limit=1` y exige el mismo agregado 1/6. Separa
las primeras 1 y 4 solicitudes tras reiniciar el proceso API, y conserva
50 muestras calientes secuenciales más 50 a concurrencia cuatro. El cálculo
de p95 usa rango más próximo y conserva errores, timeouts y todas las muestras.

Chrome utiliza el build de producción y mide hasta el tablero y sus señales
renderizados. Cada perfil registra la primera navegación y 50 siguientes:
un navegador solo, y un navegador con tres lectores HTTP adicionales
sostenidos. El segundo perfil no representa cuatro navegadores. Los
servicios ya están activos; las primeras navegaciones no se presentan como
un arranque frío de toda la infraestructura. La carga adicional conserva
sus respuestas y errores en `dashboard-ui-load.json`.

Resultados aprobados del 26/10/2026: API en el foco de las 17:17 UTC y pantalla
en la CI final, a las 19:17 UTC.

| Superficie | Perfil                      | Muestras calientes | p95       | Errores |
| ---------- | --------------------------- | ------------------ | --------- | ------- |
| API        | Secuencial                  | 50                 | 51,34 ms  | 0       |
| API        | Concurrencia 4              | 50                 | 59,87 ms  | 0       |
| Pantalla   | Un navegador                | 50                 | 634,00 ms | 0       |
| Pantalla   | Navegador + 3 lectores HTTP | 50                 | 968,50 ms | 0       |

Las muestras API tras reinicio fueron 78,87 ms (una solicitud) y máximo
116,23 ms (grupo de cuatro). Las primeras navegaciones finales fueron 355,20 ms y
877,90 ms; están separadas de los p95 calientes. Las 1420 lecturas de carga
adicional no produjeron errores. Chrome 155.0.8059.85, Cypress 16.0.0.

## Verificación del candidato

| Comprobación                                          | Resultado observado                                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Build de contratos y generación OpenAPI               | PASS                                                                                                                           |
| Unidades focales API tablero/progreso, errores y HTTP | 32/32 PASS                                                                                                                     |
| Contratos focales tablero/progreso                    | 9/9 PASS                                                                                                                       |
| Typecheck API                                         | PASS tras corregir tipado de una respuesta deliberadamente inválida en la prueba                                               |
| Web: typecheck, pruebas y lint focal                  | PASS inicial; 73/73 pruebas y typecheck tras corregir fechas narrativas                                                        |
| HTTP focal progreso/tablero                           | 15/15 PASS                                                                                                                     |
| Formato, lint y typecheck completos                   | PASS en CI final; documentación de cierre comprobada posteriormente                                                            |
| `npm test` completo                                   | 2186/2186 PASS en seis grupos; incluye las 73 pruebas web, no son 2186 pruebas nuevas de .07                                   |
| SQL/RLS                                               | PASS: 1019 aserciones en 15 archivos dentro de la integración completa; conserva esperado original y diagnóstico solo si falla |
| HTTP completo                                         | 193/193 PASS en la CI actual; aislamiento y recuperación incluidos                                                             |
| Actualización .06 → .07                               | PASS; preservación de hechos, episodios, revisión y progreso                                                                   |
| Cypress focal                                         | 8/8 PASS, sin omitidos, después de corregir fechas narrativas                                                                  |
| Cypress completo                                      | 66/66 PASS, cero fallidos, pendientes u omitidos; 14 capturas de tablero                                                       |
| Rendimiento API y pantalla                            | PASS en los perfiles descritos; muestras completas conservadas                                                                 |
| Tres gates SUBMIT consecutivos                        | PASS los tres; 50 muestras secuenciales + 50 a concurrencia cuatro por gate; candidato y entorno sin cambios                   |
| Evaluación integrada de ayudas                        | PASS: 100/100 secuenciales y 100/100 concurrentes, proveedor TEST, cero llamadas externas, tres reanudaciones                  |
| CI completa final                                     | 17/17 PASS sobre el candidato que incluye la corrección visual                                                                 |

Los tres SUBMIT finales quedaron registrados a las 19:04:16, 19:08:12 y
19:11:58 UTC. Sus p95 secuencial/concurrente fueron 2851,99/3732,54 ms,
1978,30/4185,10 ms y 2028,69/3767,46 ms, dentro del gate vigente del flujo
SUBMIT. Esas métricas no son la latencia del tablero ni su objetivo de 3 s.

## Cobertura y límites de la evidencia

| Alcance                                    | Evidencia ejecutada                                                                                                                                                                                                                                                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HU-015, completitud y observación personal | [SQL de progreso](../../supabase/tests/011_student_progress.test.sql), [SQL .07](../../supabase/tests/015_dashboard.test.sql), [HTTP .07](../../tests/integration/zzzzzzzzzzz-dashboard.test.cjs) y Cypress `IMP05-DASH-07`: éxito previo al período, fallos, intentos y separación de evidencia de completitud. |
| HU-016, cifras y filtros                   | SQL .07, HTTP .07 y Cypress `IMP05-DASH-01/02`: oráculo independiente 1/6, conceptos sin duplicación, asignaciones reutilizadas, corte inclusivo, páginas y agregados completos.                                                                                                                                 |
| HU-018, historia y evidencia               | HTTP .07 y Cypress `IMP05-DASH-03`: tres tipos, regla/causa, ACTIVE interrumpido, REVIEWED histórico, cortes y última evaluación del episodio correcto.                                                                                                                                                          |
| Permisos, fallas y ayuda real              | SQL .07, HTTP .07 y Cypress `IMP05-DASH-04/05/06`: aislamiento, ADMIN denegado, revocación, servicio caído y entrega/ACK deduplicado con Storage y proveedor TEST.                                                                                                                                               |
| Temporalidad y procesamiento               | Contratos/unidades, SQL de progreso y [regresiones del worker](../../tests/integration/zzzzzzzzzz-signals.test.cjs): microsegundos, empates, reconciliaciones tardías, leases y recuperación. HTTP .07 verifica historia persistida y estado FAILED; las unidades de presentación cubren PENDING.                |
| Navegador y rendimiento                    | [Ocho casos Cypress .07](../../tests/e2e/dashboard.cy.ts), inventario completo de 66 y [perfil API](../../scripts/dashboard-performance.mjs), con todos los resultados conservados.                                                                                                                              |
| Migración y lectura sin efectos            | [Actualización desde .06](../../scripts/dashboard-upgrade.mjs), digest antes/después idéntico y lecturas públicas con rol limitado; instalación limpia en la integración SQL.                                                                                                                                    |

Se inspeccionaron 14 capturas iniciales y las dos capturas de señales/detalle
regeneradas tras corregir fechas. Los tamaños principales son 1440×900,
768×1024 y 390×844; teclado, foco y retorno del diálogo tienen aserciones.
En móvil las tablas permiten desplazamiento horizontal dentro de su contenedor.
Las señales pobladas y su causa corregida se revisaron visualmente en escritorio;
las capturas móvil/tablet muestran el estado sin evaluación. Esto no acredita
auditoría WCAG integral, lector de pantalla ni dispositivos físicos.

REPEATED_ERROR y STAGNATION usan el procesador real y PostgreSQL; la historia
de INACTIVITY utiliza un fixture temporal explícito, no siete días reales de
uptime. La caída/reconciliación del worker tiene regresiones heredadas: no se
añadió un recorrido nuevo de tablero al mismo corte antes/después de un commit
tardío, ni se promete un snapshot único entre GET independientes. La baja de
matrícula se comprueba mediante membresía deshabilitada. Los resultados de IA
usan TEST y las comparaciones de lectura no invocan al proveedor; no acreditan
caída real de Azure ni calidad pedagógica aceptada. La evaluación heredada de
ayudas mide API/persistencia y conserva su límite de latencia de renderizado
sin evidencia de navegador; no se confunde con la medición de pantalla del tablero.

## Defectos detectados durante la verificación

Se conservan los diagnósticos locales saneados en `.local/evidence/imp-05-07`.

- La revisión de 14 capturas detectó fechas UTC dentro de las causas y
  explicaciones, aunque los campos estructurados ya utilizaban la zona de
  la organización. Se corrigió la presentación conservando el instante
  canónico y sus microsegundos en `dateTime`/`title`. Las 73 pruebas web,
  typecheck, lint y los ocho casos Cypress aprobaron esta corrección. Las
  dos capturas nuevas de señales y detalle confirman fechas locales legibles;
  la CI completa posterior aprobó las 17 etapas con el candidato congelado.
- Una CI completa posterior a los primeros defectos aprobó sus 17 etapas,
  2182 pruebas unitarias, HTTP 193/193, SQL 1019/1019 y Cypress 66/66,
  incluidos tres SUBMIT consecutivos. Su candidato fue
  `83094a5ab9035eb47d6db6d3a74b85fae2f024a7022487705852d2c063676af2`.
  Se conserva como evidencia previa; no acredita el ajuste visual posterior.

- La primera CI completa aprobó diez etapas (incluida integración HTTP
  193/193 y SQL 1019/1019), pero el gate RUN invalidó la medición porque el
  agente actualizó este registro mientras medía. `candidateUnchanged=false`;
  entorno, imagen, limpieza y las 100 respuestas fueron válidos. El p95 RUN
  observado fue 1407,58/2828,34 ms, pero esa corrida sigue FALLIDA. Se repitió
  CI completa congelando también documentación, sin cambiar el gate; las dos
  corridas completas posteriores aprobaron, antes y después del ajuste visual.
- La primera instalación detectó un identificador SQL reservado sin comillas.
  Se corrigió y las instalaciones posteriores aplicaron la migración.
- La primera consulta HTTP paginada detectó precedencia incorrecta en la
  validación JSON del cursor. Se corrigió; las dos corridas HTTP siguientes
  aprobaron sus 15 casos, incluidos cursores de ámbito incompatible.
- Dos comparaciones SQL representaban el mismo instante como `Z` y `+00:00`.
  Se comparan como `timestamptz`, manteniendo precisión de microsegundos.
- Un caso SQL adicional observó un fallo técnico en vez de dos. Los otros
  1018 casos de esa corrida pasaron; la corrida permanece FALLIDA. No se
  reprodujo en el caso aislado ni en las dos suites diagnósticas completas.
  No se redujo el esperado: se conserva `2` y ahora se captura la respuesta
  exacta de esa misma consulta únicamente si falla. La causa no se ha
  determinado. La integración de la CI aprobó después las 1019 aserciones,
  incluido ese caso, sin consultas diagnósticas previas que pudieran alterar
  su tiempo. Se conserva este antecedente para investigar si reaparece.

Quedan pendientes IMP-05.08, el detalle integral RF-017 y la revisión RF-019
de IMP-06, aceptación CAPSTONE y validaciones remotas. La intermitencia SQL
anterior conserva su diagnóstico y esperado original para investigar si reaparece.
No se realizaron llamadas pagadas a Azure o Vercel ni despliegues remotos.
