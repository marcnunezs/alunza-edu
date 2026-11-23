# IMP-06 — Gobierno y seguimiento completo

**IMP-06.07 verificado funcionalmente, 03/11/2026:** seis recorridos HTTP y seis Cypress acreditan los 16 escenarios originales sobre el mismo candidato; aprobaron 1.513 aserciones SQL, ocho Cypress de regresión .06 y controles generales/focales. [Plan](../work/IMP-06-governance-phase-plan.md), [matriz](../work/IMP-06-governance-phase-matrix.md) y [registro](../work/IMP-06-governance-phase.md). La aceptación integral sigue **bloqueada**, código 2 del agregador, por .04 y CI completa pendiente. El inventario vigente es 125/18; contextual 69/10 intacto.

El diagnóstico offline `resumption-15` conserva 13.676 archivos y cataloga cinco eventos del secundario. Sin procedencia ni mapping completos mantiene **HOLD_UNRESOLVED_SECONDARY_ETL**; no abrió el principal. No hubo nuevas campañas .04 ni CI: **9/17 y 0/1**. Se requiere evidencia independiente sobre ese catálogo antes de considerar la lectura condicionada; validación humana/remota y fases posteriores permanecen separadas.

**Corte histórico IMP-06.06, 02/11/2026:** [plan CSV autorizado](../work/IMP-06-audit-export-plan.md), [contrato concretado](../work/IMP-06-audit-export-dictionary.md) y [registro de pruebas aprobadas](../work/IMP-06-audit-export.md). Checkpoint acumulado `8161b3b` realizado; CSV, permisos, recuperación, upgrade, formatos, 16 Cypress y perfiles locales API/UI verificados. El diagnóstico `resumption-14` leyó solo cabeceras y no acreditó procedencia del ETL secundario ni cobertura scheduler; conserva la parada .04, 9/17 y 0/1. .07 y aceptación humana/remota continúan pendientes.

**Corte histórico IMP-06.05, 02/11/2026:** visor administrativo implementado y verificado localmente, independiente del cierre detenido de .04. Aprobaron integración HTTP/SQL, upgrade, ocho Cypress y perfiles de rendimiento API/pantalla. Evidencia y límites en el [registro .05](../work/IMP-06-audit-read.md), contrato en su [diccionario](../work/IMP-06-audit-read-dictionary.md). No se ejecutan las campañas congeladas de .04 ni CSV .06; .07 y aceptación humana/remota siguen pendientes. Las notas históricas que excluían iniciar .05 conservan su corte anterior a esta autorización.

**Actualización IMP-06.04, 01/11/2026:** revisión pública implementada con focos locales aprobados
conforme al [plan autorizado](../work/IMP-06-signal-review-plan.md). El
[registro .04](../work/IMP-06-signal-review.md) conserva pruebas, fallos de CI y límites;
el cierre integral permanece pendiente. También documenta los estados reales de
la repetición de dashboard tras corregir una expectativa anterior y de la
evaluación independiente de ayuda.

**Decimotercera reanudación — corte histórico del 02/11/2026 (`resumption-13`):**
el usuario completó la captura manual secuencial
`capture-20261102T2014038955625`: un arranque, RAW esperado retenido,
**24 muestras** válidas, controles de captura y limpieza aprobados y sesión
inactiva. Ese paso manual ya no está pendiente.

El lector offline congelado se invocó una sola vez y rechazó el inventario
con **`RAW_INVENTORY_MISMATCH`**, antes de crear `offline-analysis` o leer ETL.
El RAW esperado ocupa **48300032 bytes**; hay además un ETL de **262144 bytes**
con prefijo `WPRC_Internal_Collector_`, cuyo origen y semántica siguen sin
clasificar. No se presume su función por el nombre, no se lo excluyó y no se
relajó el guard ni se repitió la invocación.

La cobertura de la ventana y de las 24 consultas **no fue evaluada**. Sensor y
cierre local .04 siguen **PENDIENTES**. No se pide otra acción manual ni hubo
nuevo E2E, carga o captura durante el análisis; ON/OFF, ABBA y CI siguen
detenidos, con **9/17** contextuales y **0/1** CI final. Código activo y B
intactos; .05–.07 y la aceptación humana/remota siguen separados, según el
[registro de cierre](../work/IMP-06-signal-review-closure.md).

**Duodécima reanudación — corte histórico del 02/11/2026 (`resumption-12`):**
quedó preparado el nuevo protocolo de captura secuencial, **sin ejecutarlo**.
Conserva **24 muestras a 1 Hz**, **12 trabajadores**, **64 KiB × 512 buffers**
y guard de **45 s**; el tope es **268435456 bytes** (`MaximumFileSize=256`).
Las consultas `QUERY` antes y después deben demostrar la sesión y el modo
reales, con cero pérdidas y ETL RAW original retenido. El lector exige
cobertura completa antes de aceptar evidencia para reconstruir estados.

Pruebas focales del controlador, limpieza, consulta, helper y lectores
aprobadas; preflight de PowerShell 7.6.9, WPR y preparación Node aprobado.
El paquete de **51 archivos** está congelado; no hubo inicio, consultas
reales ni carga. La autorización ya existe y queda pendiente la ejecución
manual elevada por privilegios de Windows, limitada a un intento.

El déficit histórico de **1874,632 ms** se conserva sin atribuir su causa
a sobrescritura circular. No hay calificación del sensor ni nuevas campañas,
ON/OFF, ABBA o CI: **9/17** y **0/1** CI final. Código activo y B intactos.
El cierre local .04 sigue **PENDIENTE**, separado de .05–.07 y aceptación
humana/remota. El [registro de cierre](../work/IMP-06-signal-review-closure.md)
detalla el protocolo y la parada: la preparación no equivale a una captura
secuencial aceptada ni a una corrección demostrada.

**Undécima reanudación — corte histórico del 02/11/2026 (`resumption-11`):**
la captura manual del usuario terminó con código cero, guard limpio y sesión
inactiva; sus **24 muestras** bajo 12 trabajadores aprobaron los controles de
muestreo. TDH rechazó el esquema CSwitch v5 con **1168**. Se conservó ese
fallo y se comprobó un lector offline con Microsoft TraceEvent **3.2.8**
fijado: **62 aserciones** de filtros/sanitización y recorrido completo del ETL,
con **831451 eventos scheduler** y cero formas no soportadas. Los fixtures
no son un oráculo binario independiente del parser oficial.

La lectura completa revela cobertura insuficiente: faltan **1874,632 ms**
desde el inicio acreditado hasta el primer evento scheduler; las consultas
0 y 1 quedan enteramente antes. QPC y frecuencia coinciden y la cabecera
reporta cero pérdidas, sin recuperar ese inicio ausente. No se particionaron
estados ni se demostró causa o corrección del sensor; no hay calificación.

La condición de parada continúa: **9/17** contextuales y **0/1** CI final.
No se repitió captura ni se ejecutaron nuevas ON/OFF, ABBA, campañas o CI.
No se pide otra acción manual ni se programa un reintento automático. Código
activo y B están intactos. El cierre local .04 sigue **PENDIENTE**, separado
de .05–.07 y aceptación humana/remota, según el
[registro de cierre](../work/IMP-06-signal-review-closure.md).

**Décima reanudación — corte histórico del 02/11/2026 (`resumption-10`):** el
máximo autorizado aumentó a **17** contextuales, con **9/17** consumidas y
**0/1** CI final. El diagnóstico local conservó **72 pares válidos**, 12 sin
carga inducida y 60 bajo carga. `nativeQuery` concentró **99,8836 %** del tiempo del
probe en las **46 lecturas lentas**; el sensor original registró autocoste
**16,05699 %** bajo carga. La localización no resuelve Running/Ready/Waiting
ni demuestra causa de PHASE-08; no produjo nuevo candidato ni calificación.
No se iniciaron nuevas ON/OFF, ABBA o CI.

ETW fue denegado con **`0x80070005`** y la instancia quedó inactiva. Está
preparado el paquete manual privado `resumption-10/etw-run/`, con preflight
validado sin captura ni carga, para **24 lecturas y 12 trabajadores**; el ETL real sigue
pendiente. Su contexto elevado no equivale a los ensayos anteriores ni acepta
PHASE. El [registro de cierre](../work/IMP-06-signal-review-closure.md) conserva
los detalles y la parada de las etapas dependientes. El cierre local .04 sigue
**PENDIENTE**, separado de .05–.07 y de la aceptación humana/remota.

**Novena reanudación — corte histórico del 02/11/2026 (`resumption-09`):** el
candidato de sensor con lectura de CPU en Windows dentro del mismo proceso no
aprobó la calificación no contextual bajo carga. El autocoste fue
**A 28,888 % / B 28,607 % > 1 %**, con CPU compartida del host de aproximadamente
**90,88 %**; los demás controles de carga, cobertura, reloj, integridad y
limpieza fueron válidos. No se demuestra una causa de esos tiempos.
Las **693 pruebas de preproducción** y **55 aserciones nativas** aprobadas
verifican el candidato, sin acreditar calificación de rendimiento ni CI final.
Se archivó y retiró el candidato y se restauró el sensor original; permanecen
`runnerUi: false` y dos pruebas del contrato de tiempo transcurrido.
No hay corrección de sensor aceptada ni nuevas contextuales, ON/OFF, ABBA o CI.
Continúan **9/16** contextuales y **0/1** CI final, con parada y cierre local
**PENDIENTE**. El [registro de cierre](../work/IMP-06-signal-review-closure.md)
conserva el rechazo, el archivo y la restauración; .05–.07 y la aceptación
humana/remota siguen fuera de este resultado.

**Sexta reanudación — corte histórico del 01/11/2026 (Santiago):** el máximo
global autorizado aumentó a **11** contextuales, conservando las cinco previas.
El instrumental calificado abarca tablero y progreso, con cuatro perfiles.
D_A08 reprodujo los fallos PHASE-07/08 (**67 PASS/2 FAIL**); D_B08 aprobó
**69/69**, los seis gates y la observación, con **2253/2253** correlaciones.
La predicción registrada antes de B se cumplió: en progreso concurrente, la
media de inicio a efecto de sesión bajó **86,26 %** y la unión observada de
long tasks **87,71 %**. Esto no sustituye ABBA ni la CI final.

El nuevo A1 sin diagnóstico terminó el `2026-11-02T02:23:44.959Z` (01/11 en
Santiago): **68 PASS/1 FAIL/0 SKIP**, PHASE-07 concurrente **3962 ms** y
PHASE-08 **2828,3 ms**. Este último quedó bajo 3000 ms y no reprodujo el fallo
requerido por el control; A1 fue rechazado y la secuencia se detuvo. Hubo
**27 capturas**, **792 archivos** estables y restauración de B; TEST quedó detenido.
Consumo **8/11** contextuales y **0/1** CI final. Esta secuencia ABBA ejecutó
**1/4**, con **0 controles conformes**; B1/B2/A2 y CI no se iniciaron. No se
repite por disponer de saldo. El cierre técnico local .04 sigue **PENDIENTE**,
sin aceptación humana/remota ni ampliación a .05–.07.

**Auditoría del 02/11/2026 (`resumption-07`):** las fuentes, la métrica y los
oráculos lógicos son comparables; los **18 p95** recalculados coinciden y las
nueve cargas tienen intervalos físicos válidos, sin desaparición observada del
fondo. La neutralidad ON/OFF no está probada: el flag diagnóstico también afecta
la compilación web y su autocoste directo no acota los efectos indirectos.
Las **15/15 pruebas offline** califican el auditor; no demuestran la causa de
PHASE-08 ni sustituyen CI. No hubo nuevas campañas: siguen **8/11** contextuales,
**0/1** CI final, A1 rechazado y parada vigente, sin B1/B2/A2 ni CI. El
[registro de cierre](../work/IMP-06-signal-review-closure.md) conserva esta auditoría;
el cierre local .04 permanece pendiente.

**Octava reanudación — corte del 02/11/2026 (`resumption-08`):** se
fijó un máximo prospectivo de **16** contextuales para la comparación ON/OFF
y el cierre: ocho previas, cuatro de calibración y cuatro ABBA, con una CI
final condicionada. El instrumental privado aprobó **80/80 pruebas offline**;
no acredita la CI del producto.
**CAL_OFF1** terminó **68 PASS/1 FAIL/0 SKIP**: PHASE-07 concurrente
**4150,8 ms** y PHASE-08 aprobado con **2838,3 ms**. La calibración fue rechazada
por autocoste del observador común de host en tablero, **2,036 % > 1 %**;
sus seis perfiles conservaron primeras navegaciones y 50 muestras válidas,
cargas válidas y 27 capturas requeridas. La serie OFF–ON–ON–OFF se detuvo en
**1/4**, sin ON1/ON2/OFF2, nuevo ABBA ni CI. El consumo es **9/16** contextuales
y **0/1** CI final. No se demuestra neutralidad del diagnóstico ni causa de
PHASE-08, y A1 mantiene su rechazo histórico. No se añadió una corrección de
código ejecutable; B quedó restaurado y TEST detenido. El cierre local .04
sigue **PENDIENTE**, sin ampliar .05–.07 ni acreditar aceptación humana/remota;
el [registro de cierre](../work/IMP-06-signal-review-closure.md) conserva la parada.

**Antecedentes hasta la quinta reanudación (histórico):**
La [D_A de la segunda reanudación](../work/IMP-06-signal-review-closure.md), tras
corregir la carga anticipada de SDKs de IA, terminó **68 PASS/1 FAIL/0 SKIP**:
recuperación API aprobada, cinco arranques de 2,21–4,48 s, observación válida y
PHASE-07 p95 concurrente **3393 ms**. Se conservan las tres D_A y sus evidencias.
La corrección posterior `runnerUi: false` suprime el reporter de Cypress, con
regresión real A/B favorable que conserva reintentos, errores y viewport. D_B
terminó **69 PASS/0 FAIL/0 SKIP**, con observación válida y p95 del tablero
**1809,9/2428,1 ms** (serie/concurrencia 4), manteniendo los umbrales originales.
El mecanismo del arnés tiene regresión y D_B favorables; el cierre causal final
sigue pendiente. Una nueva autorización fijó máximo **8** contextuales globales.
A1 terminó **67 PASS/2 FAIL/0 SKIP/0 pendientes**: PHASE-07 registró p95
concurrente **4081,8 ms** y PHASE-08 **3110,1 ms**, ambos sobre el gate de 3000 ms.
El fallo adicional de PHASE-08 detuvo la secuencia, sin causa demostrada.
Fuentes y protocolo permanecieron congelados y se restauró B. El acumulado es
**5/8** contextuales consumidas, **1/4** corridas ABBA ejecutadas, **0** controles
ABBA conformes y **0/1** CI final; B1, B2 y A2 no se ejecutaron. El
[registro de cierre](../work/IMP-06-signal-review-closure.md) conserva la parada;
no se acredita cierre integral.

**Quinta reanudación, investigación del 01/11/2026 (Santiago):** la causa de
PHASE-08 seguía sin atribuirse; el diagnóstico de navegador de aquella etapa solo cubría el
tablero. No se añadió un cambio de rendimiento. La regresión aislada de B obtuvo
dictamen **PASS**, con **2 PASS/1 FAIL centinela**; no acredita una repetición de
los 69 casos contextuales ni de los 103 completos. No hubo campañas nuevas:
siguen **5/8** contextuales consumidas, **1/4** corridas ABBA ejecutadas (A1 rechazada),
**0** controles conformes y **0/1** CI final. Reiniciar ABBA exige cuatro corridas
con solo tres restantes: un mínimo de **9** contextuales globales, sin otras
corridas diagnósticas, excediendo el máximo entonces autorizado. A1 no se reutiliza ni se
cambian los criterios para aceptarla. El
[registro de cierre](../work/IMP-06-signal-review-closure.md) conserva la investigación
y esta limitación; el cierre integral permanece pendiente.

El usuario eligió solo matrícula CURRENT_ACTIVE; no amplía acceso histórico
ni autoriza .05–.07. Los cortes anteriores de este documento mantienen su fecha.

**Corte histórico al cierre de IMP-06.03:** **IMP-06.01 con cierre técnico local y CI 17/17 aprobada el 27/10/2026** según su
[registro](../work/IMP-06-bank-read.md). **IMP-06.02 implementado y probado
localmente el 27/10/2026**, según su
[registro](../work/IMP-06-bank-governance.md). **IMP-06.03 con cierre técnico local**,
según el [registro de detalle docente](../work/IMP-06-student-detail.md);
.04–.07 permanecen pendientes. Esta fase
contiene siete incrementos y cierra cuatro RF al completar su alcance. Amplía
capacidades previas; no posterga a esta etapa la autorización, auditoría o
conservación histórica necesarias desde las primeras mutaciones. El plan no
acredita pruebas, aceptación humana ni despliegue.

Base revisada tras el cierre local IMP-05.08. El [estado actual](../estado-actual.md)
y el [registro .08](../work/IMP-05-acceptance.md) identifican capacidades y
límites heredados. La implementación posterior de .01 se limita a consulta del
banco; no convierte su soporte previo en cierre de RF-017/019/024/027.

IMP-06.02 incorpora propiedad/visibilidad, versionado administrativo y archivo
con permisos vigentes, ETag, idempotencia y auditoría. Sus pruebas locales
incluyen conservación de publicaciones e intentos, rechazo de políticas
inválidas, recuperación de conflictos y cancelación sin mutación. El resultado
y los límites están en su registro; este avance no completa IMP-06 ni acredita
aceptación humana o despliegue.

## Objetivo y demostración de salida

Completar dos recorridos: el profesor abre el detalle de un estudiante de su clase, comprueba la evidencia de una señal y confirma su revisión; el administrador gobierna el banco de su organización y exporta auditoría operativa filtrada. Ambos conservan permisos vigentes e historia.

La demostración debe reutilizar un intento real conservado desde IMP-03, su ayuda disponible de IMP-04 y una señal calculada en IMP-05. El profesor abre esos hechos desde el detalle, cancela una revisión comprobando que continúa ACTIVE, luego confirma y obtiene REVIEWED con responsable/fecha. Repetir conserva la primera revisión. El administrador crea una versión del ejercicio sin alterar la publicación ni el intento previo, aplica un cambio de gobierno permitido y descarga un CSV correspondiente al filtro visible. Una sesión ajena falla sin revelar datos.

## Entradas, dependencias y decisiones

Se reutilizan identidad/RLS/auditoría de IMP-01, banco versionado y estructura
de IMP-02, intentos de IMP-03 y progreso/reglas/señales de IMP-05. La captura de
ayuda TEST y su lectura en evidencia mínima están verificadas en .08; RF-017
las integra en su propio detalle docente autorizado de .03, exclusivamente
cuando fueron entregadas hasta el corte. Los pendientes
de Azure remoto y latencia de ayuda renderizada en navegador conservan su
registro de IMP-04; no implican ausencia del circuito local de API/persistencia.
La indisponibilidad del proveedor no bloquea revisión docente ni auditoría.

### Base disponible y trabajo faltante

| Área | Base existente y fuente verificable | Trabajo pendiente de IMP-06 |
| --- | --- | --- |
| Progreso, tablero y señales | [Controlador de tablero](../../apps/api/src/dashboard/dashboard.controller.ts), [progreso personal](../../apps/api/src/progress/progress.controller.ts) y [registro .08](../work/IMP-05-acceptance.md). [IMP-06.03](../work/IMP-06-student-detail.md) incorpora y verifica localmente pantalla y consultas docentes individuales con matrícula/permisos vigentes y cálculos reutilizados. | Aceptación humana/remota del detalle y revalidación integrada de fase .07. |
| Intentos y ayuda | [Envíos e historial](../../apps/api/src/practice/submission.controller.ts), [ayuda](../../apps/api/src/help/help.controller.ts) y [registro de ayuda](../work/IMP-04-help.md). [IMP-06.03](../work/IMP-06-student-detail.md) compone y verifica localmente una proyección docente propia de solo lectura, sin ampliar las rutas personales del alumno y exclusivamente con ayuda entregada hasta el corte. | Aceptación humana/remota y revalidación integrada de fase .07. |
| Revisión de señales | [IMP-06.04](../work/IMP-06-signal-review.md) implementa RF-019 con operación pública autorizada, contrato, auditoría y diálogo de confirmación/cancelación; focos locales aprobados. Reutiliza `signal_reviews` y la base inmutable de .05. `signal_review_fixture` permanece privado, sin grant a `alunza_app`. | Cierre integral .04 pendiente según su registro; aceptación humana/remota y revalidación integrada de fase .07. |
| Banco de ejercicios | [Registro IMP-02](../work/IMP-02-content.md): autoría, versiones y archivo básicos. [Consulta IMP-06.01](../work/IMP-06-bank-read.md): banco administrativo, propietario, versión actual, conceptos históricos y versiones/usos paginados. [Gobierno IMP-06.02](../work/IMP-06-bank-governance.md): propiedad/visibilidad, versionado administrativo y archivo implementados y probados localmente, con historia conservada. | Revalidación en el recorrido integrado .07 y aceptación humana/remota. No reconstruir las mutaciones ya verificadas en .02. |
| Auditoría | [Visor IMP-06.05](../work/IMP-06-audit-read.md) y [CSV IMP-06.06](../work/IMP-06-audit-export.md) implementados y verificados localmente sobre auditoría real: filtros, corte, permisos, límites y recuperación. | Revalidación integrada .07 y aceptación humana/remota. No reconstruir el visor/CSV ni inventar acciones históricas para poblarlos. |

La tabla identifica piezas reutilizables, no aceptación de los cuatro RF.
Contrastar su código y contratos al comenzar el incremento autorizado; mantener
separados los resultados locales, el trabajo pendiente y la aceptación humana.

Leer [requisitos](../../specs/02-requisitos-funcionales.md), [escenarios](../../specs/03-flujos-y-criterios-de-aceptacion.md), [UX](../../specs/04-ux-y-accesibilidad.md), [datos](../../specs/06-modelo-de-datos.md), [API](../../specs/07-api-y-contratos.md) y [progreso/señales](../../specs/14-progreso-y-senales.md). Aplicar las guías de [backend](../agent/03-backend-y-api.md), [datos](../agent/04-datos-y-migraciones.md), [frontend](../agent/05-frontend-y-ux.md), [evidencia determinista](../agent/08-progreso-y-senales.md) y [seguridad](../agent/09-seguridad-y-permisos.md).

| Entrada o decisión | Preparación requerida | Límite de aceptación |
| --- | --- | --- |
| DEC-001 y permisos previos | Reutilizar autorización efectiva de docente de clase y administrador de gobierno. | `ADMIN` no obtiene código, pistas ni revisión de señales por gobernar la organización. |
| DEC-002: archivo e historia | Aplicar la política registrada para visibilidad histórica y efecto del archivo del banco sobre publicaciones vigentes. | Conservar referencias no concede acceso histórico permanente ni permite eliminar versiones utilizadas. |
| DEC-004: API/exportación | Fijar filtros y orden, cursores, ETag, campos del CSV, límites de filas/bytes, corte de exportación e idempotencia. | No inventar un máximo documentado ni entregar una descarga truncada como completa. |
| DEC-005: señal/episodio | Reutilizar identidad de episodio, evidencia y regla versionada de IMP-05. | Revisar no reevalúa la regla, no resuelve automáticamente un problema y no reactiva una señal ya revisada. |
| DEC-006: consistencia | Comprobar unicidad de revisión, inmutabilidad de auditoría y vínculos de versiones/usos. | Migrar y probar con rol de aplicación; una prueba como propietario no acredita aislamiento. |
| DEC-009: datos y descargas | Usar fixtures ficticios y minimización; definir configuración operativa de retención de exportaciones si son durables. | No afirmar cumplimiento legal ni autorizar datos reales por disponer de un CSV. |

Registrar decisiones según [la guía correspondiente](../agent/12-decisiones-pendientes.md).
Aplicar las resoluciones previas de DEC-001/002/005 sin pedirlas otra vez.
Los nombres de archivo, estructura de componentes y otros detalles reversibles
no requieren detener cada incremento; consultar solo una decisión nueva que
cambie permisos, semántica o alcance y no esté resuelta por la autoridad vigente.

## Cobertura funcional

Los cuatro RF conservan la relación HU/CU/PT del mismo número y sus 16 escenarios E1–E4 de [specs/03](../../specs/03-flujos-y-criterios-de-aceptacion.md). El plan agrega comprobaciones técnicas complementarias, sin renumerar ni reemplazar los escenarios originales.

| Requisito | Cierre previsto | Escenarios de fuente |
| --- | --- | --- |
| ALZ-RF-017 | Detalle docente con última actividad, intentos, pruebas permitidas, resultados, pistas, errores, conceptos, progreso y señales de la clase. | ALZ-HU-017-E1 a E4; ALZ-CU-017; ALZ-PT-017. |
| ALZ-RF-019 | Revisión confirmada, autorizada e idempotente; evidencia, primer responsable y fecha conservados. | ALZ-HU-019-E1 a E4; ALZ-CU-019; ALZ-PT-019. |
| ALZ-RF-024 | Gobierno completo de propiedad, versiones, visibilidad, usos y archivo del banco iniciado en IMP-02. | ALZ-HU-024-E1 a E4; ALZ-CU-024; ALZ-PT-024. |
| ALZ-RF-027 | Consulta/paginación y exportación operativa autorizada en CSV UTF-8, incluidos vacío y exceso de límite. | ALZ-HU-027-E1 a E4; ALZ-CU-027; ALZ-PT-027. |

Las regresiones de RF-004/005/008/011/014/015/016/018/023/026 comprueban que el gobierno y la revisión preservan capacidades previas. No constituyen RF nuevos ni duplican puntos del backlog.

## Incrementos en orden de construcción

La consulta .01 y el gobierno .02 tienen implementación, pruebas locales y
registros propios. .03 tiene cierre técnico local; su registro conserva los
candidatos, las pruebas y las incidencias. .04 está implementado con focos locales
aprobados y cierre integral pendiente; .05 está implementado y verificado localmente,
con [registro propio](../work/IMP-06-audit-read.md). .06 está implementado y verificado
localmente según su [registro](../work/IMP-06-audit-export.md); .07 sigue pendiente.
Los incrementos reutilizan la base
anterior; las rutas de incrementos pendientes son propuestas, no instrucciones para recrear módulos
o tablas existentes. Cada fila termina en una operación integrada demostrable.

| ID | Resultado vertical y dependencia | Artefactos propuestos | Comprobaciones que permiten continuar |
| --- | --- | --- | --- |
| IMP-06.01 | El administrador consulta banco, propietario, conceptos, visibilidad, versiones y usos de su ámbito. Reutiliza IMP-02. | Lecturas de `apps/api/src/content`, UX-16, contratos de referencias y listados autorizados. | Paginación/conteos filtrados desde origen; banco ajeno no enumerable; lectura compartida docente no concede edición de autor. |
| IMP-06.02 | Implementado y probado localmente: el administrador aplica cambios permitidos de propiedad/visibilidad, crea una versión o archiva conservando usos. Reutiliza .01 y DEC-002. | Casos de gobierno, validadores/políticas, migración aditiva, formulario y confirmaciones UX-16; [registro y evidencia](../work/IMP-06-bank-governance.md). | HU-024-E1 a E4 verificados localmente; política inválida no cambia datos; ETag evita sobrescritura; actividad e intento previo mantienen versiones/pruebas/conceptos. La aceptación integrada .07 permanece pendiente. |
| IMP-06.03 | Cierre técnico local: el profesor abre un estudiante desde su clase, filtra y recorre intentos, ayuda entregada, progreso y señales coherentes. Reutiliza IMP-03/04/05 y conserva .01/.02. | Consulta de solo lectura, UX-11, enlaces a intentos y referencias con permiso vigente; [registro](../work/IMP-06-student-detail.md) y [plan aprobado](../work/IMP-06-student-detail-plan.md). | HU-017-E1 a E4 verificados localmente; filtros inválidos y sin evidencia diferenciados; no mezcla otras clases ni expone pruebas ocultas. Pruebas e incidencias conservadas en el registro; aceptación integrada .07 y humana/remota pendientes. |
| IMP-06.04 | Implementado con focos locales aprobados: el profesor confirma una revisión y recibe estado, primer responsable y fecha persistidos. Reutiliza .03 y señales de IMP-05. | Operación pública de revisión y diálogo UX-10/11; `signal_reviews` y su base inmutable, con autorización/auditoría y contrato público propios; [registro](../work/IMP-06-signal-review.md). | HU-019-E1 a E4 verificados en focos: cancelar no envía mutación; pérdida de acceso se rechaza; concurrencia produce una revisión. Cierre integral pendiente, con fallos y verificaciones adicionales conservados en el registro. |
| IMP-06.05 | El administrador consulta auditoría por fecha, actor, acción y entidad con paginación estable. Reutiliza auditoría generada desde IMP-01. | Lecturas de `apps/api/src/audit`, UX-19, filtros/cursores y proyección allowlist. | HU-027-E1/E2/E3 en consulta; ausencia de filas distinta de falla; orden estable y permisos antes de contar/paginar. |
| IMP-06.06 | Implementado y verificado localmente: el administrador exporta el conjunto autorizado del filtro y obtiene CSV íntegro o error controlado. Reutiliza .05. | Servicio CSV, reserva y artefacto durables, idempotencia, entrega privada y estados UX-19; [registro](../work/IMP-06-audit-export.md). | HU-027-E1 a E4 verificados localmente; límite, vacío, fórmulas, comillas, UTF-8, reautorización y auditoría de generación/entrega o fallo. Aceptación integrada .07 y humana/remota pendientes. |
| IMP-06.07 | Implementado y verificado funcionalmente: recorrido docente y administrativo tras edición, revisión, revocación y concurrencia. Integra .01–.06. | Fixture correlacionado, seis HTTP/seis Cypress, agregador por candidato, inventario compartido y [registro](../work/IMP-06-governance-phase.md). | Los 16 escenarios aprobaron localmente, con historia preservada, rechazos y regresiones pertinentes. La aceptación integral permanece bloqueada por .04 y CI no ejecutada; no equivale a aceptación humana/remota. |

## Detalles que condicionan la implementación

### Gobierno del banco e historia

La pantalla muestra propietario, versión, conceptos, visibilidad y usos antes de confirmar cambios. Valida destino de propiedad, alcance y versión actual en el servidor; un ID recibido del formulario no prueba pertenencia ni permiso. La UI ofrece cancelación antes de aplicar cambios de acceso o archivado, y no muestra éxito si el servidor rechazó la operación.

Editar una versión referenciada produce otra versión. La actividad conserva la anterior; comparar antes/después un intento histórico debe mostrar idénticos código, diagnóstico, pruebas y conceptos utilizados. Crear una versión nueva no recalifica intentos ni modifica el denominador de una actividad publicada.

Archivar retira usos futuros según la política aprobada, conserva versiones
históricas y trata las dependencias activas explícitamente. No borrar con
cascadas ni cambiar disponibilidad por conveniencia del CRUD. Aplicar DEC-002
ya resuelta para contenido; si aparece un caso de gobierno nuevo no cubierto,
identificarlo y preparar alternativas sin reabrir las decisiones confirmadas.

### Detalle docente coherente y mínimo

Resolver la relación profesor–clase–estudiante vigente antes de recuperar datos. La misma persona inscrita en dos clases no habilita al profesor a mezclar ambas. Aplicar el ámbito también a filtros, enlaces, conteos, ayudas y señales; un permiso histórico no garantiza acceso actual.

Reutilizar los cálculos deterministas de IMP-05 y el resultado canónico de IMP-03. No recalcular con otro algoritmo para la pantalla de detalle. Cada cifra presenta denominador, corte y enlace a evidencia compatible. La ausencia de intentos, filtro sin coincidencias e indisponibilidad de servicio son estados diferentes.

La vista de intentos muestra las pruebas permitidas y el resumen público de verificaciones ocultas, nunca entradas/expectativas privadas. Las referencias de ayuda se abren mediante reautorización. La falta de IA no produce pistas inventadas ni sustituye el diagnóstico técnico por otro estado. El detalle puede mostrar ayuda no disponible y seguir operando con evidencia técnica.

### Confirmación y revisión de señales

La interacción es abrir señal → revisar causa/regla/evidencia → solicitar revisión → confirmar → validar permiso vigente → confirmar transacción. Cancelar antes de enviar conserva ACTIVE y no hace request de mutación.

La transacción inserta una revisión única, aplica ACTIVE → REVIEWED y guarda auditoría efectiva. Autor y fecha vienen del contexto verificado y reloj del servidor. Repeticiones y solicitudes concurrentes devuelven el primer resultado sin sobrescribirlo; un conflicto de estado se recupera de forma controlada. Si el profesor perdió acceso antes de confirmar, se rechaza sin revelar información adicional.

Revisar conserva causa, ventana, evidencia y versión de regla. Recalcular el mismo episodio no vuelve a ACTIVE; una evidencia nueva se trata conforme a DEC-005. No agregar estados de resolución ni acciones automáticas, sanciones o mensajes al estudiante. Una revisión es evidencia de revisión humana, no una medición de mejora del aprendizaje.

### Auditoría y exportación

Reutilizar eventos append-only de las fases anteriores. Las nuevas operaciones incorporan su auditoría al mismo resultado transaccional; no reconstruir acciones históricas ficticias para llenar el visor. Solo se muestran los campos operativos autorizados. El administrador no obtiene código estudiantil mediante el visor ni mediante un CSV alternativo.

Definir en DEC-004 una semántica estable para exportar lo filtrado: alcance, columnas, orden, corte temporal, límites y relación entre todas las páginas y el CSV. La propuesta es exportar el conjunto completo del filtro a un corte identificado, no solo la página visible; validar esa elección antes de convertirla en contrato. Si supera el máximo, informar que se deben acotar filtros y no entregar un parcial como completo.

Usar allowlist de columnas de [specs/07](../../specs/07-api-y-contratos.md), alineando `outcome` público con `audit_events.result`. CSV vacío conserva encabezados, ámbito permitido y sello temporal según el formato acordado. Probar acentos, comillas, separadores y saltos de línea; neutralizar celdas que puedan interpretarse como fórmula. No exportar tokens, URLs firmadas, contraseñas, código completo, pruebas ocultas ni prompts.

Registrar solicitud y resultado de generación/entrega o fallo, sin afirmar que el usuario leyó el archivo. Evitar que el evento de la propia exportación cambie recursivamente el conjunto exportado mediante un corte definido. Si la descarga es asíncrona, usar persistencia durable, revalidar permisos al generar y entregar y servir un objeto privado; cancelar seguimiento en la UI no equivale a cancelar el trabajo. No introducir una cola nueva si la exportación acotada puede resolverse con el mecanismo ya disponible.

## Artefactos y comprobaciones de la fase

| Entrega | Ubicación propuesta y condición |
| --- | --- |
| Gobierno y consultas | `apps/api/src/content`, `progress`, `signals`, `audit`: reutilizar servicios y políticas previos, sin duplicación de cálculos. |
| Persistencia | `supabase/migrations`, `supabase/tests`: revisión única, restricciones históricas, auditoría append-only, RLS y roles efectivos. |
| Contratos | `packages/contracts` y OpenAPI: detalle, gobierno, revisión y exportación, con errores, estados y proyecciones coordinados. |
| Experiencia | `apps/web`: UX-10/11/16/19 conectadas a API real, estados recuperables, confirmaciones y contenido accesible. |
| Evidencia y operación | `tests/integration`, `tests/e2e`, fixtures reproducibles y registro de [plantillas](../agent/14-plantillas-de-trabajo.md), con resultados reales. |

Comprobar DAT-01/04/07/10 de [datos](../../specs/06-modelo-de-datos.md), SIG-13/14 de [señales](../../specs/14-progreso-y-senales.md) y los controles de aislamiento/CSV de [seguridad](../../specs/09-seguridad-y-privacidad.md). Añadir casos de revocación antes de confirmar, antes de generar y antes de entregar. Las consultas se ejecutan con rol de aplicación sin `BYPASSRLS`; probar directamente las superficies expuestas además de la UI.

Usar Jest para validadores, revisión y exportación; integración real para transacciones/RLS/concurrencia; Cypress para los recorridos de los roles. Verificar tablas, filtros, diálogos y enlaces mediante teclado, texto equivalente y estados de error; no atribuir conformidad WCAG completa a un reporte automático. Skills pertinentes: NestJS, Supabase/Postgres, frontend y Cypress del [inventario](../agent/15-skills-recomendadas.md); aplicar las de seguridad cuando la tarea incluya su revisión explícita.

## Criterios verificables de cierre

- [ ] Los siete incrementos tienen evidencia enlazada y los cuatro RF conservan sus 16 escenarios originales, con resultado individual y limitaciones.
- [ ] El profesor consulta únicamente estudiantes/evidencia de sus clases; un administrador de gobierno sin función docente no obtiene detalle pedagógico ni revisa señales.
- [ ] El detalle refleja intentos, ayuda disponible, progreso y señales reales sin duplicación por joins ni métricas simuladas; filtros inválidos, vacíos y servicio caído se distinguen.
- [ ] Cancelar revisión conserva ACTIVE; confirmar persiste REVIEWED; repetición y concurrencia mantienen una revisión, primer autor/fecha y evidencia intacta.
- [ ] Revocar acceso antes de confirmar o descargar impide la operación y no expone contenido adicional.
- [ ] Cambiar gobierno/versiones/archivo preserva publicaciones e intentos históricos; visibilidad nunca se amplía fuera de la organización.
- [ ] Visor y CSV coinciden con el ámbito, filtro y corte acordados; límite excedido, conjunto vacío y fallo de exportación tienen salidas verificables.
- [ ] CSV UTF-8 preserva formato y neutraliza fórmulas; auditoría y descargas excluyen secretos, código completo, pruebas ocultas y campos no autorizados.
- [ ] Las nuevas mutaciones y exportaciones registran evidencia operativa real sin editar o borrar eventos previos ni inventar historial.
- [ ] Tipos, lint, build y pruebas proporcionales de unidad/integración/E2E están ejecutados con resultado registrado; la revisión visual y de teclado cubre estos flujos.
- [ ] Con los mismos hechos persistidos, regla y corte, cambios de respuestas o indisponibilidad de IA no alteran progreso, señales, revisión ni diagnósticos. Eventos nuevos legítimos de ayuda se evalúan conforme a DEC-005.
- [ ] Los pendientes de DEC y la validación transversal posterior están registrados; no se presenta la fase como aceptada si falta alguno de sus comportamientos obligatorios.

## Trabajo posterior

IMP-07 completa la evaluación transversal de los 27 RF y RNF: cobertura restante, adversariales, accesibilidad, rendimiento, recuperación y defectos. Esta fase ya debe probar las capacidades que modifica; no remite sus controles esenciales a esa revisión. IMP-08 prepara entrega y reproducción por otra persona. La revisión docente del producto tampoco reemplaza firmas, aceptación o evidencias académicas reales.

## Prompt para encargar esta fase

```text
Implementa únicamente IMP-06 de docs/plan/06-gobierno-y-seguimiento.md.
Lee AGENTS.md e inspecciona el código y evidencia de las fases anteriores.
Reutiliza identidad/RLS/auditoría, banco versionado, intentos, ayuda, progreso
y señales. Identifica cualquier dependencia incompleta; continúa las partes
independientes sin presentar datos simulados como integración.
Completa IMP-06.01 a IMP-06.07 con API, persistencia, UI y pruebas reales para
ALZ-RF-017/019/024/027 y sus 16 escenarios originales E1–E4.
Conserva autorización vigente de clase, ADMIN sin acceso docente implícito,
historia inmutable y revisión ACTIVE → REVIEWED única e idempotente.
La revisión requiere confirmación en la UI; cancelar no hace mutación.
Exporta solo auditoría operativa autorizada y filtrada en CSV UTF-8 seguro,
con límites, vacío, corte, reautorización y auditoría verificables.
Resuelve detalles reversibles y registra DEC sin ampliar permisos ni asumir
aprobaciones. Informa resultados de pruebas, criterios pendientes y traspaso.
Detente al cerrar IMP-06: esta instrucción no autoriza implementar fases
posteriores, desplegar, usar datos reales ni enviar mensajes a terceros.
```
