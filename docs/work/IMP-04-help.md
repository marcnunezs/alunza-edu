# IMP-04.04–04.06 — Ayuda contextual sobre intentos guardados

Fecha: 27/09/2026. Estado: implementado y probado localmente. El usuario
autorizó este corte; la ejecución Azure, evaluación docente y aceptación CAPSTONE
no se presumen aprobadas. Se preservan los cambios anteriores de IMP-03 y materiales.

## Comportamiento implementado

El estudiante ACTIVE propietario solicita una explicación o la siguiente pista
desde un intento confirmado, incluso después del cierre de la actividad. La API
obtiene enunciado, conceptos, código completo, diagnóstico y resultados booleanos
de pruebas visibles desde PostgreSQL; no recibe contexto pedagógico del cliente.
RUN y un SUBMIT pendiente no habilitan ayuda. Se excluyen identidades personales,
pruebas ocultas, expectativas, stdout y stderr del contexto enviado al proveedor.

La explicación no consume pistas ni incluye orientación para resolver. Las tres
pistas son concepto, pregunta dirigida y siguiente paso/pseudocódigo parcial. No
se ofrece una solución completa. SUCCESS admite solo explicación; UNKNOWN con
infraestructura fallida produce una explicación determinista NO_EVIDENCE sin IA.
Los intentos, diagnósticos y cálculos de progreso permanecen inmutables.

La recuperación pgvector aplica permisos y configuración antes del ranking de
hasta cinco fragmentos. La política remota exige calibración vinculada al modelo,
dimensión, tokenizer, constructor y corpus: maximiza cobertura sin aceptar
negativos, desempata por el menor umbral observado y comprueba una partición
reservada con grupos de documentos/ejercicios separados. No hay umbral Azure
predeterminado ni ambigüedad inferida solo por distancias cercanas.

Generación y verificación tienen configuración y prompts versionados. La segunda
llamada devuelve un veredicto interno tipado; no reescribe el candidato. SUPPORTED
requiere contrato exacto, diagnóstico intacto, referencias exactas y ACCEPT. La
insuficiencia/contradicción documental produce NO_EVIDENCE; salida inválida,
revelación de solución o fallo del verificador producen PROVIDER_UNAVAILABLE.
El servidor revalida todas las fuentes usadas, incluidas las no citadas.

## Durabilidad y límites

La transacción de admisión confirma solicitud, idempotencia, cupo y reserva antes
del 202. El trabajador usa lease de 10 s renovado cada 3 s y fencing. El plazo
absoluto es 15 s desde admisión. Cada despacho se registra antes del proveedor;
un despacho incierto no se repite automáticamente. Los checkpoints conservan
embeddings, contexto íntegro, generación y verificación; una configuración nueva
no puede completar un trabajo con contexto preparado bajo otra configuración.

El sondeo del trabajador usa un valor predeterminado reversible de 500 ms entre
ciclos, para reducir transacciones vacías sobre el pool compartido. El ajuste
desde 150 ms conserva el plazo absoluto de 15 s, la renovación y el fencing;
puede añadir hasta 350 ms de espera para descubrir una solicitud. Su efecto sobre
SUBMIT se comprobó con el mismo perfil y umbral de rendimiento: la repetición
aprobó, sin demostrar que el sondeo fuera la única causa de la variación.

El límite es una operación pendiente por estudiante y por intento, cuatro por
organización; seis admisiones nuevas/minuto por estudiante y sesenta por
organización. Las consultas, replays y reutilización de una explicación válida
no consumen cuota. Una pista preparada conserva su reserva hasta el ACK y no
ocupa un cupo de proveedor. El ACK serializado registra HINT_DELIVERED o
FEEDBACK_VIEWED una sola vez, como presentación en la interfaz, no comprensión.

La consulta tiene hasta 500 tokens; contexto compartido 5.000, entrada por llamada
8.000, salida de generación 2.048 y verificación 512. Se conserva el código completo
o se devuelve una limitación explícita. El tokenizer fijado se valida contra el
modelo. Para acotar su CPU se rechazan piezas léxicas de más de 2 KiB antes del
conteo exacto; no se recorta el código para hacerlo encajar.

Los consumos observados se guardan por llamada; una métrica ausente se conserva
desconocida. No se mantienen arrays ilimitados de uso ni se atribuye consumo cero
a llamadas sin métricas. Las respuestas privadas usan no-store.

## Referencias y producto

El panel «Ayuda para el intento #N» está integrado en el resultado guardado y su
historial. Siempre usa el snapshot persistido, conserva el borrador y recupera
trabajos pendientes al recargar. Abandonar la pantalla detiene el sondeo y no el
trabajo. Una lectura automática de estado no concede pistas ni registra lectura.

Las citas resuelven fragmento, localizador y archivo de la versión original,
incluso tras reemplazo o reindexación. Esa excepción no amplía la descarga
genérica estudiantil al historial completo. Ocultar/archivar o retirar permisos
suprime el contenido derivado y libera reservas no entregadas; los eventos
históricos confirmados permanecen. Mostrar otra vez la fuente no revive una
respuesta suprimida.

## Contratos y trazabilidad

El [diccionario](IMP-04-help-dictionary.md),
[contrato ejecutable](../../packages/contracts/src/help.ts),
[OpenAPI](../../packages/contracts/openapi.json) y migración
`20260927182613_contextual_help.sql` concretan DEC-004/006/010.

| Requisito / escenario               | Implementación y comprobaciones locales                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| RF/HU/CU/PT-012 E1–E4               | Niveles 1–3 por intento, fallbacks sin consumo, reserva/ACK atómicos, límite, intento nuevo e historia |
| RF/HU/CU/PT-013 E1–E4               | Explicación separada, cinco campos/tres estados, validación doble, citas y degradación durable         |
| RF-010 y HU-010-E4                  | Solo intento confirmado; cero llamadas previas al commit; resultado y progreso sin cambios             |
| RF-006/025                          | Corpus autorizado, referencias históricas, ocultamiento/archivo y revocación inmediata                 |
| RNF-IA-01..05, SEG-01/03/05, POR-03 | Aislamiento, contexto permitido, auditoría sin secretos, recuperación y consumo acotado                |

## Verificación ejecutada

Runtime portable: Node 24.21.0 / npm 11.19.0 (`scripts/use-node.ps1`).

- `npm run format:check`, `npm run lint` y `npm run typecheck` aprobados. Tras corregir recuperación de la interfaz,
  se repitieron formato/lint y los tipos web; las 40 pruebas web pasan.
- `npm test`: **699/699** pruebas aprobadas en seis grupos. Después del ajuste
  de interfaz se comprobaron las 40 pruebas web actuales; el cambio de sondeo
  conserva **22/22** pruebas del trabajador y los tipos API aprobados.
- `npm run test:integration`: **137/137 pruebas HTTP y 403 aserciones SQL en nueve
  archivos**, con Auth, API, Storage, pgvector y Docker reales en LAB TEST.
- `npm run runner:prepare`, `npm run runner:doctor`,
  `npm run runner:probe -- --adapter docker` y `npm run test:academic:fixtures`
  aprobados, preservando el recorrido determinista de IMP-03.
- `npm run build` y `npm run test:artifacts`, ejecutados por el arnés E2E,
  aprobados; los canarios de credenciales y adaptadores de servidor están
  ausentes de los artefactos web.
- Tres reinicios reales del API/trabajador aprobados: antes del despacho,
  despacho incierto sin repetición y reanudación de verificación desde candidato
  guardado. Se conservan plazo, unicidad y ausencia de entrega sin ACK.
- Migración incremental DEV `20260927182613`, sin reset: el contenido completo
  de las siete relaciones comprobadas conserva su hash; incluye 12 perfiles,
  12 membresías, cuatro clases, diez actividades y tres intentos. No se sembró
  material ni se modificaron entornos remotos.
- `node scripts/help-probe.mjs --mode plan` preparó el ensayo sin llamadas Azure. Consumo observado
  desconocido; no se atribuye consumo cero a proveedores no medidos.
- `npm run test:ai:integration`: **27/27**, con pgvector real, aislamiento y
  recuperación ante caída de PostgreSQL; proveedor sintético explícito.
- `npm run test:practice:performance`: **100/100 RUN válidos**, p95 1.605,77 ms
  en serie y 3.140,79 ms con concurrencia cuatro.
- `npm run test:practice:performance -- --submit`, repetición: **100/100 SUBMIT
  válidos**, p95 2.503,37 ms en serie y 4.627,94 ms con concurrencia cuatro,
  ambos bajo el umbral vigente de 5.000 ms.
- `npm run test:help:integration`, posterior al ajuste del sondeo: **10/10 HTTP,
  403 aserciones SQL y tres reinicios**, aprobados con las mismas garantías.
- `npm run test:e2e`: **42/42 escenarios aprobados**, sin pendientes ni omitidos,
  en Chrome 153.0.8010.50 / Cypress 16.0.0. Incluye cuatro recorridos de ayuda y
  todas las regresiones de fundación, identidad, contenido, práctica y materiales.
  La corrida aprobada duró 318.120 ms de ejecución Cypress.
- Revisión de enlaces de README, planes, registro, diccionario y specs afectados:
  **203 enlaces locales comprobados, ninguno roto**.

`npm run ci:verify` se detuvo en la primera medición SUBMIT: sus 100 respuestas
fueron válidas, pero el p95 concurrente de 5.457,53 ms superó el umbral vigente de
5.000 ms. El informe original se conserva en
`.local/reports/imp-04/help-submit-performance-first.json`. Se redujo el sondeo
en reposo sin modificar el perfil ni el umbral y la repetición aprobó. La
variación observada no demuestra que el sondeo fuera la única causa. El comando
CI agregado conserva su resultado fallido histórico; los controles restantes se
ejecutaron individualmente, sin reescribirlo como una corrida completa aprobada.
Los informes están en `.local/reports/imp-04/`, incluido
`dev-help-migration.json`, y conservan la distinción de proveedor TEST explícito.

La primera corrida Cypress completó 41/42 escenarios: el caso nuevo de tres
pistas encontró un encadenamiento incorrecto de la prueba tras comprobar un
atributo inexistente. Se corrigió reconsultando el elemento antes de actuar,
sin eliminar las aserciones. Una repetición posterior se detuvo antes de Cypress
porque la API no alcanzó `ready` en los 30 s del arnés. El diagnóstico separado
sí inició la misma API en 2.486 ms; las importaciones también mostraron variación
entre 21,49 s y 1,78 s. No se determinó una causa única ni se ampliaron límites.
La repetición completa posterior aprobó los 42 escenarios.
Se conservan `help-e2e-first.json`, `help-e2e-startup-failure.json` y
`help-api-startup.json`, además de los diagnósticos saneados.

La verificación detectó y corrigió la precedencia de operadores JSON en la
publicación SQL, el nombre incorrecto de un campo de visibilidad en una prueba
y la preparación de intentos después del cierre en otro fixture. La revisión
de interfaz añadió recuperación del ACK tras el ciclo de efectos de StrictMode
y conservación de la intención incierta al desmontar el panel por renovación.
Abrir explícitamente una explicación de degradación registra FEEDBACK_VIEWED;
una pista de degradación no registra HINT_DELIVERED ni consume nivel.

## Ensayo remoto y aceptación pendiente

El [manifiesto específico](../../infra/preproduction/help-manifest.example.json)
y `scripts/help-probe.mjs` preparan un plan sin llamadas remotas para el mismo
recorrido del producto: embeddings, explicación, tres pistas y verificación.
Requiere destino concreto, corpus ficticio, calibración medida, configuración y
presupuesto autorizados; el ensayo legacy de conectividad no acepta este corte.
La ejecución remota del arnés todavía no está implementada: este comando prepara
y valida el manifiesto, pero no despacha solicitudes de producto. No se han
llamado servicios Azure durante esta implementación.

El transporte utiliza las salidas estructuradas de
[Azure OpenAI](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs),
con validación adicional en servidor. Dos llamadas que coinciden no acreditan
calidad pedagógica. IMP-04.07–04.08 mantienen la evaluación adversaria ampliada,
latencia real, evaluación docente y aceptación CAPSTONE. IMP-03.07 Vercel Sandbox
y la operación del worker en Azure Container Apps siguen pendientes prioritarios
antes de producción. Este trabajo no habilita lectura docente RF-017, chat libre,
generación automática al enviar ni cálculo de señales.
