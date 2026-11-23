# IMP-05.08 — Verificación transversal de progreso, tablero, señales y reglas

Inicio y cierre en Santiago: 26/10/2026. Estado: **cierre técnico local**.
La CI final terminó `2026-10-27T00:12:20.364Z` con **17/17 etapas PASS**.
La aceptación humana y las validaciones remotas permanecen pendientes.

## Alcance autorizado

Implementar el plan aprobado para cerrar técnicamente RF/HU/CU/PT-015, 016,
018 y 026 en el laboratorio local. Se conservan DEC-005, la matrícula vigente,
el progreso acumulado al corte, ACTIVE/REVIEWED y la evidencia mínima docente.
RF-017 integral, la acción pública RF-019, CI Linux, proveedores remotos,
despliegue y aceptación CAPSTONE conservan su alcance posterior.

Decisiones expresas: fixture adicional de 60 estudiantes activos; medición de
API y pantalla de progreso personal, tablero y consulta de reglas; 50 muestras
secuenciales y 50 bajo carga cuatro. En pantalla, carga cuatro significa un
Chrome más tres lectores HTTP, no cuatro navegadores. La demo canónica permanece
separada de los fixtures adicionales.

## Base preservada

La inspección inicial confirmó la misma huella de 538 fuentes que el cierre .07:
`b90287f4d30e868f421935f0b942974f60b44c6163411a2fb288eecd32cdb3f1`.
HEAD base `75708ceecf2ca755bd32fb4b04e77bcb8de310f4`; numerosos cambios previos,
incluido Office, se preservan. La captura inicial está en
`.local/evidence/imp-05-05/imp-05-08-start-candidate.json`.
Los 17 pasos, 2186 unidades, 193 HTTP, 1019 aserciones SQL y 66 E2E del
[cierre .07](IMP-05-dashboard.md) son antecedentes, no resultados nuevos de .08.

## Trabajo y responsabilidades

- [x] Matriz de 16 escenarios E1–E4, SIG-01–14 y fronteras DEC-005 aplicables al MVP, con sus niveles y límites de prueba.
- [x] Reconstrucción y reconciliación contrastadas mediante lecturas públicas.
- [x] Ayuda real TEST, eventos elegibles, inactividad y determinismo.
- [x] Recorrido ADMIN → motor → docente/estudiante y aislamiento vigente.
- [x] Paginación, estados operativos, teclado y capturas pobladas.
- [x] Capacidad 60 y medición de las tres superficies.
- [x] Diagnóstico SQL acotado de 20 iteraciones, sin rebajar el esperado.
- [x] Focos y CI final de 17 etapas con tres SUBMIT consecutivos.
- [x] Evidencias, revisión documental y trazabilidad de cierre.

La [matriz de aceptación](IMP-05-acceptance-matrix.md) identifica los 16
escenarios, SIG-01–14, fronteras DEC-005, oráculos y niveles de prueba.

Datos/API posee la suite transversal, el foco HTTP/SQL y el diagnóstico SQL.
Navegador posee el spec y las interacciones. El fixture compartido y rendimiento
tienen un responsable; el coordinador integra configuración, comandos y registro.
Los arneses que reservan LAB TEST se ejecutan secuencialmente.

## Contratos y criterio de comparación

Se reutilizan las lecturas .07 y `signals:rebuild`, sin rutas públicas, estados,
fórmulas o parámetros nuevos. Los cambios de producción son dos migraciones
aditivas que corrigen el coste de las consultas del tablero demostrado durante
la medición; conservan los contratos y permisos.

Reconstruir solo proyecciones derivadas del fixture debe preservar hechos,
episodios, revisiones, reglas y checkpoints. El tablero lee sus fuentes de
verdad y no debe adquirir una caché artificial para poder reconstruirla.

Igualdad determinista exige mismos hechos/snapshot, regla y corte. Un commit
tardío legítimo puede cambiar el resultado al mismo T; la reconciliación debe
conservar la evaluación anterior. Permisos/matrícula y procesamiento son
actuales; `observedAt` tampoco es identidad pedagógica. Una entrega/lectura
elegible nueva puede reiniciar inactividad; polling y solicitudes sin entrega
o lectura no generan ese efecto. El proveedor TEST no acredita Azure real.

## Verificación

Comprobaciones iniciales: `format:check`, ESLint completo y TypeScript E2E
aprobaron. El helper de rendimiento aprobó cuatro unidades. El smoke de
capacidad verificó 60 activos, 360 obligaciones, un logro, 201 intentos, 51
episodios y 51 versiones, con primera y segunda página válidas en las tres
consultas. Su primer intento detectó un código de clase en minúsculas en el
fixture; se corrigió a mayúsculas y se preservó el rechazo original, sin
modificar el constraint de producción.

El segundo foco de aceptación ejecutó los seis casos AC-01–06 con PASS
(39,426 s) y SQL/RLS completo con 15 archivos y 1020 aserciones PASS.
La prueba SQL original conserva esperado `2`; una aserción nueva contrasta el
mismo conteo con el corte explícito de evidencia ya observada.

Diagnóstico SQL terminado: **20/20 PASS**, 63 aserciones por iteración, cero
errores de ejecución/parse y fuente intacta. Las respuestas originales, cortes,
hechos canónicos y secuencias se conservaron en cada muestra. No se reprodujo
la intermitencia heredada; su causa permanece no demostrada. No se presenta
como defecto corregido ni se rebaja el esperado.

### Perfil local de rendimiento

Windows 11 Pro 10.0.26200; Intel Core i7-1355U, 10 núcleos/12 hilos y
33.854.394.368 bytes de memoria física. Docker Desktop 29.7.2 informa 12 CPU
y 16.520.081.408 bytes disponibles. Node 24.21.0, npm 11.19.0, Supabase CLI
2.101.0, Compose 5.3.1 y Cypress 16.0.0; Chrome se identifica en cada informe.
Auth/PostgreSQL/Storage/API/web usan LAB TEST; resultados masivos canónicos
preparados y proveedores IA TEST explícitos. No son mediciones remotas.

API: tres superficies, páginas de 50 alternadas con su segunda página real;
50 muestras secuenciales y 50 a concurrencia cuatro. Reiniciar API antes de
cada perfil y conservar sus primeras 1/4 consultas aparte (15 en total).
UI: navegación autenticada hasta datos listos, primera navegación aparte y
50 siguientes por perfil/superficie; concurrencia cuatro significa un Chrome
y tres lectores HTTP sostenidos. La medida UI carga la primera página; las
páginas siguientes se comprueban en PHASE-02/03. Reglas conserva página UI
de 20; la lectura API usa 50. Percentil nearest-rank, p95 <3000 ms, cero
errores, muestras completas y candidato estable.

### Historial de fallos y correcciones anteriores al cierre

Primera corrida Cypress .08: **3/9 PASS, 6 FAIL**, 581,357 s, Chrome
155.0.8059.85. PHASE-03/08/09 aprobaron. Los fallos de arnés fueron un selector
de versión reciente que desaparece al refrescar (01/04), comparación textual
de `Z` frente a `+00:00` para el mismo instante (02), reutilizar el token de
una sesión cerrada al comprobar recuperación (05), y `cy.click()` sobre un
select nativo (06). Se corrigen sin eliminar las comprobaciones originales.

PHASE-07 demostró un fallo de rendimiento del tablero bajo carga: 50 muestras,
sin errores, p95 **4609,4 ms**. El secuencial dio 2827,7 ms; progreso
570/2452,8 ms y reglas 504,4/642,6 ms (secuencial/carga cuatro). Las tres
lecturas HTTP de fondo del tablero registraron 484 respuestas sin error,
mediana 1141,81 ms y p95 1724,96 ms: hay coste real de consulta que investigar,
sin atribuirlo únicamente al arnés. Todas las muestras conservaron candidato
estable. El rechazo, informes y muestras se preservan en
`.local/evidence/imp-05-08/browser-r1/`; no se rebaja el gate de 3000 ms.

La investigación aisló consultas repetidas de claves, cobertura y ACK por
carril. `EXPLAIN ANALYZE` midió 183,7 ms y 42.332 accesos a caché en
`dashboard_processing`; la lectura por conjuntos redujo esa medición a
47,5 ms y 2.556 accesos. Son mediciones de atribución, no el perfil formal
completo. JIT se descartó porque `pg_jit_available()` devuelve false.

La migración aditiva `20261026212627_dashboard_processing_set_based.sql`
comparte claves/vectores y usa una proyección mínima para contar señales.
Conserva firmas, propietario limitado, permisos y DTO. Diez contrastes de
estados/frescura y 360 vectores comprobaron equivalencia; AC-01–07 y los
16 archivos SQL (1030 aserciones) aprobaron tras aplicarla. La nueva prueba
ACL distingue membresía administrativa de permisos efectivos SET/USAGE en
PostgreSQL 17: el vínculo ADMIN heredado permanece y no permite asumir el
rol limitado. La comparación de actualización debe conservar ese grafo.
La evidencia está en `.local/evidence/imp-05-08/perf-attribution/`.

Este corte intermedio todavía no acreditaba cierre. Los resultados finales
figuran más abajo. La CI mantiene 17 etapas y tres SUBMIT consecutivos, con
los mismos gates; cada corrida conserva sus resultados completos. Las fuentes
y la documentación permanecieron congeladas durante las mediciones finales.

La intermitencia SQL heredada mantiene esperado `2`, diagnóstico de la misma
respuesta y estado no resuelto. Investigar con fechas/corte y un caso explícito;
un fallo actual exige análisis. Veinte iteraciones sin reproducción no prueban
una causa ni convierten el antecedente en corregido.

La instalación vacía posterior a la optimización aprobó AC 7/7, SQL 1030/1030
y otras veinte iteraciones SQL completas. La actualización .07 → primera
migración .08 aprobó: 26 conjuntos canónicos y DTO públicos idénticos al
mismo corte, con grafo de roles y ACL conservados. Su informe se preserva en
`perf-attribution/phase-migration-upgrade-first.json` dentro de la evidencia .08.

Segunda corrida Cypress: **5/9 PASS, 4 FAIL**. Se conservan todos los resultados
en `.local/evidence/imp-05-08/browser-r2/`. El tablero mejoró a p95
1744,2/3362,1 ms (secuencial/carga cuatro), todavía superior al gate bajo carga.
Sus lectores HTTP registraron 871 respuestas, cero errores y p95 786 ms.
PHASE-01/02/06 detectaron aserciones o interacción del arnés aún por corregir;
no se atribuye un cierre funcional ni se rebaja el objetivo de rendimiento.

Las correcciones posteriores conservan las aserciones: identidad pública
`Attempt.attemptId`, ausencia del botón Siguiente al terminar todas las páginas
y acceso a la región de tabla mediante Tab nativo, sin forzar un clic cubierto.
La segunda migración `20261026220133_dashboard_summary_projection.sql` evita
construir 201 proyecciones de detalle para contadores que solo consumen
diagnóstico y verificabilidad. Ocho muestras RPC antes/después dieron medianas
102,5/78,5 ms con DTO equivalente: atribución local, no aceptación del perfil UI.
Una medición Node aislada de formateo de fechas no demuestra el coste en Chrome;
no se modifica ese helper. Otro arranque API excedió 30 s durante atribución,
con el mismo síntoma IMPORTS_START; se conserva y no se modifica el límite.

Primer intento del foco: falló antes de ejecutar la suite porque la API no
alcanzó `/health/ready` en 30 s; el diagnóstico solo alcanzó `IMPORTS_START`.
Se conserva `acceptance-error-r1-startup.log`. Una comprobación independiente
posterior importó la aplicación y proveedores TEST en 12,46 s. No demuestra
la causa del timeout; no se modifica el gate de arranque ni se atribuye fallo
de dominio a una suite que no llegó a ejecutarse.

## Candidato y resultados finales

El candidato conserva HEAD base `75708ceecf2ca755bd32fb4b04e77bcb8de310f4`;
no se creó un commit. Huella de 549 fuentes:
`daa670b3fca99f41f6a1ff557ca3a2c1fe727aade26012490f01012e23a29029`.
Hay 18 archivos fuente distintos respecto de la captura inicial; el inventario
con sus hashes está en `final/source-delta.json`. Además de las dos migraciones,
los cambios corresponden a fixtures, pruebas, arneses, comandos e inventarios.
No se cambiaron código de API/web/runner ni dependencias.

La huella de todos los archivos usada para rendimiento fue
`60ebb6b940c267af67772afe8bc46e07c53788ab35d5ecee75a7bff7288888fe`;
se comprobó idéntica al crear el paquete final, antes del cierre documental.
Las actualizaciones documentales posteriores se distinguen del candidato
medido y conservan su huella de fuentes. Las migraciones tienen SHA-256:

- `20261026212627_dashboard_processing_set_based.sql`:
  `9e36f6f41bf0199e8e99e2ced761084dce8d4200de73e8f69f68bfdfc64754c9`.
- `20261026220133_dashboard_summary_projection.sql`:
  `d22b64630770c430d46a1ea178a22c512eca14d98a85de12e3344aaef6412a22`.

Los comandos se ejecutaron con Node 24.21.0/npm 11.19.0 fijados por
`scripts/use-node.ps1`, secuencialmente sobre LAB TEST:

| Comando                          | Resultado final ejecutado                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run test:imp05:upgrade`     | PASS .07 `20261026163925` → .08 `20261026220133`; 26 colecciones canónicas preservadas, DTO públicos idénticos al mismo corte excluyendo únicamente `observedAt`, grafo de roles y ACL intactos. |
| `npm run test:imp05:acceptance`  | AC-01–07: 7/7 PASS; instalación vacía, SQL/RLS 1032 aserciones en 16 archivos; diagnóstico incluido de SQL015: 20/20 PASS, 63 aserciones por iteración, fuente intacta.                          |
| `npm run test:e2e -- --phase`    | Tercera corrida focal: 9/9 PASS, 363,990 s, 18/18 capturas. Las dos anteriores fallidas se conservan.                                                                                            |
| `npm run test:imp05:performance` | API: seis perfiles PASS, 300 muestras calientes y 15 primeras separadas, cero errores, paginación real y candidato intacto.                                                                      |
| `npm run ci:verify`              | Segunda corrida completa: 17/17 PASS, 2190 unidades en seis grupos, 200 HTTP, 1032 SQL/16 archivos y 75/75 E2E. Incluye tres gates SUBMIT consecutivos y evaluación de ayuda TEST.               |

La CI aprobada incluye formato, lint, tipos, builds, pruebas del runner Docker,
fixtures académicos, integración de IA y los recorridos de los incrementos
anteriores. Los 75 E2E tardaron 911,634 s dentro de su etapa; los nueve casos
PHASE se ejecutaron de nuevo en esa suite completa. El nuevo helper de
rendimiento aporta cuatro unidades; no se sustituyen pruebas por ese conteo.

### Rendimiento del candidato final

Cada celda es p95 en milisegundos, con 50 muestras por perfil. API corresponde
al foco de `22:25:00.963Z`; pantalla corresponde a la CI final, informe de
`23:50:52.123Z` del 26/10 UTC. Se conservan 300 muestras calientes por capa,
15 primeras consultas API y seis primeras navegaciones UI aparte, todas válidas.
No hay errores en estos perfiles; ambos mantienen el gate p95 <3000 ms.

| Superficie         | API secuencial | API concurrencia 4 | Pantalla secuencial | Pantalla bajo carga 4 |
| ------------------ | -------------- | ------------------ | ------------------- | --------------------- |
| Progreso personal  | 84,20          | 204,30             | 594,0               | 1386,9                |
| Tablero docente    | 153,58         | 287,31             | 1059,2              | 2904,4                |
| Consulta de reglas | 24,12          | 47,31              | 411,4               | 1103,9                |

En pantalla, la carga conserva un Chrome más tres lectores HTTP. Los perfiles
UI del foco anterior también aprobaron y permanecen en `browser-r3/`; no se
mezclan sus muestras con las de CI. Las 18 capturas finales se inspeccionaron
en 1440×900, 768×1024 y 390×844. Las acciones de reglas en móvil requieren
desplazar horizontalmente la región de tabla. PHASE-06 verifica teclado nativo,
foco y salida del diálogo; no acredita una auditoría WCAG completa ni lector
de pantalla.

### CI fallida, diagnóstico acotado y CI final

La primera CI se detuvo en su etapa 14: tercer gate SUBMIT, p95 a concurrencia
cuatro **5123,54 ms**, superior a 5000 ms. Conservó 100 muestras y cero errores
funcionales; cuatro respuestas superaron 5 s. Sus tres perfiles concurrentes
fueron 4214,45 / 3850,96 / 5123,54 ms. Los informes completos y el error están
en `ci-r1/`; no se presenta esa corrida como aprobada.

Un único ensayo diagnóstico IPC posterior conservó las 100 muestras, imagen,
candidato y limpieza: p95 2722,37 / 3746,31 ms. No reprodujo el pico ni mostró
saturación del pool (máximo cinco sockets de 16, cero en cola). La demora de
la corrida fallida se concentró en creación/arranque Docker; la causa precisa
sigue sin demostrarse. No se cambiaron runner, pools, recursos, cachés ni gates.
Las optimizaciones SQL de lectura no forman parte del camino SUBMIT.

Después del diagnóstico se ejecutó una segunda CI **completa**, con el mismo
candidato y sin instrumentación. Sus tres gates SUBMIT consecutivos aprobaron:

| Serie de CI final | p95 secuencial (ms) | p95 concurrencia 4 (ms) | Muestras / fallos |
| ----------------- | ------------------- | ----------------------- | ----------------- |
| 1                 | 2405,87             | 3844,73                 | 100 / 0           |
| 2                 | 2092,65             | 4334,64                 | 100 / 0           |
| 3                 | 2142,28             | 4702,79                 | 100 / 0           |

Los resultados de una corrida no completan etapas fallidas de otra. La CI final
aprobada tampoco acredita corregir la variación histórica de Docker. Se
mantienen como antecedentes sin causa demostrada ese pico, la intermitencia
SQL015 no reproducida y los dos timeouts de arranque `IMPORTS_START`.

### Ayuda y límites de aceptación

La etapa 17 terminó con proveedor TEST, cero llamadas externas, tres
reanudaciones, 234 muestras y 763 recibos. Sus perfiles de 100 respuestas
secuenciales y 100 concurrentes aprobaron API/persistencia; p95 de respuesta
769,18 / 2801,01 ms y de persistencia 665 / 2688 ms. La cobertura de 43 casos
adversariales está completa según su inventario, sin acreditar calidad
pedagógica. El informe y las muestras saneadas se conservaron juntos.

La latencia documental de ayuda en navegador sigue
**BLOCKED / BROWSER_RENDER_EVIDENCE_UNAVAILABLE** en IMP-04. Estos perfiles
miden respuesta API y persistencia; la UI .08 mide progreso, tablero y reglas.
Ninguno sustituye las muestras de ayuda renderizada pendientes.

La matriz mantiene explícitos E20/backfill fuera del MVP y E23 de empate tras
revisión cubierto en cálculo puro, sin atribuir una corrida durable específica
de dos eventos nuevos con timestamp idéntico. El umbral de siete días usa
reloj/cobertura sintéticos, complementados por captura real de eventos. Los
201 resultados del fixture de capacidad son hechos canónicos preparados,
no 201 ejecuciones Docker; el puente SUBMIT/ayuda TEST se prueba por separado.

RF-017 integral, la acción pública RF-019, aceptación CAPSTONE, ejecución de
CI Linux, Azure OpenAI/Vercel Sandbox remotos y despliegue siguen pendientes.
No se inicia IMP-06 ni se modifican documentos Office o specs ajenos.

## Paquete de evidencias y trazabilidad

El [manifiesto final](../../.local/evidence/imp-05-08/final/manifest.json)
identifica 59 artefactos con tamaño y SHA-256: informes, muestras, los tres
SUBMIT de CI final, 20 logs SQL, 18 PNG, capturas de candidato e inventario de
cambios. Se creó a `2026-10-27T00:12:30.942Z` después de verificar frescura,
conteos, dimensiones y huellas. Los reportes crudos están ignorados por Git;
no incluyen el estado privado de credenciales del laboratorio.

Se conservan por separado `ci-r1/`, `browser-r1/`, `browser-r2/`, `browser-r3/`,
`perf-attribution/` y `perf-attribution-r3/` bajo
`.local/evidence/imp-05-08/`. El manifiesto los referencia para que los fallos
anteriores no desaparezcan al guardar el resultado final.

La [matriz](IMP-05-acceptance-matrix.md), el
[diccionario del tablero](IMP-05-dashboard-dictionary.md), el
[plan de fase](../plan/05-progreso-y-senales.md), la
[trazabilidad](../plan/09-control-y-trazabilidad.md) y la
[guía de progreso](../agent/08-progreso-y-senales.md) distinguen el cierre
técnico local de la aceptación humana y del trabajo posterior.
