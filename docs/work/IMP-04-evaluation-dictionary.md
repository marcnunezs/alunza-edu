# IMP-04.07–04.08 — Diccionario de evaluación y recibos de IA

Estado al 02/10/2026: **implementado y probado en TEST**. Este documento
describe el contrato técnico, no acredita una corrida Azure, p95 remoto ni
aceptación docente/CAPSTONE. Los resultados ejecutados corresponden al
[registro del incremento](IMP-04-evaluation.md); la operación se describe en el
[manual del arnés](IMP-04-evaluation-operations.md).

## Fronteras

NestJS conserva la única API de dominio. Materiales y ayuda mantienen sus rutas,
JWT, permisos vigentes y límites. El ledger registra llamadas de ingestión y de
ayuda aunque no pertenezcan a una evaluación: en ese caso `run_id/stage` son
nulos y la etiqueta contable del proveedor es `UNSPECIFIED`. Esa etiqueta no
cambia el adaptador configurado ni acredita su origen.

La evaluación activa añade una autorización acotada e inmutable. Se vincula a
un candidato, destino aislado, corpus, actores, ámbitos, archivos e intentos,
perfiles y presupuestos aprobados. No concede lectura pedagógica a ADMIN ni
habilita a un usuario inactivo. La ingestión usa al profesor autorizado; la ayuda
usa al estudiante propietario y siempre parte de un intento confirmado.

El listener operacional de `EvaluationOperations` escucha exclusivamente en
`127.0.0.1`, separado de `/api/v1`, y se habilita mediante
`EVALUATION_ENABLED`. Su credencial opaca permite consultar, iniciar etapas y
detener una corrida concreta; no permite crear autorizaciones, cambiar límites,
invocar directamente el proveedor ni sustituir los permisos del producto.
Los navegadores, JWT de dominio y ADMIN no reciben esa credencial.

## Persistencia privada

La [migración incremental](../../supabase/migrations/20261002001227_evaluation_ledger.sql)
define estas relaciones en `app_private`. Sus tablas tienen RLS forzada y no
conceden acceso directo a `anon`, `authenticated`, `service_role` ni `alunza_app`.
Las funciones permitidas usan el rol interno y validan propietario, alcance,
lease, capacidad o etapa según la operación. Autorizar el manifiesto corresponde
al proceso de mantenimiento; la aplicación no tiene permiso de ejecutar
`evaluation_authorize`.

| Relación                  | Identidad y contenido                                                                                                                                            | Invariantes                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `evaluation_runs`         | `id`, manifiesto y hash, hash de credencial, ambiente/proveedor, estado, expiración, artefacto/hash de calibración                                               | Un único run `AUTHORIZED/RUNNING` por base; manifiesto, destino, precios y autorización inmutables                                            |
| `evaluation_stages`       | `(run_id, stage)`, presupuesto, estado y fechas                                                                                                                  | Cuatro etapas; solo una `RUNNING` por run; presupuesto inmutable                                                                              |
| `evaluation_bindings`     | ID, run/etapa/tipo, organización/clase/actividad/actor, hash de contenido, intento u operación/formato, máximo de operaciones, metadatos de calibración/revisión | FK compuestas fijan ámbito y dueño; el hash aprobado liga archivo o código confirmado; no autorización global por rol                         |
| `evaluation_owners`       | `(owner_kind, owner_id)`, binding, run, organización                                                                                                             | Vincula un trabajo real de material, ayuda o calibración a una autorización; no reasigna un trabajo entre corridas                            |
| `evaluation_calibrations` | Binding, estado, token/lease, consulta/hash, llamada, candidatos, resultado de revisión, fecha                                                                   | Consumidor recuperable para mediciones y candidatos ficticios; contexto desde el intento permitido; no sustituye un intento real              |
| `ai_call_receipts`        | ID/token de despacho, propietario y ámbito, fase/clave lógica/intento, input hash, configuración, reservas, observación, resultado/fallo privados                | Único propietario/fase/clave/intento; despacho durable previo al proveedor; exactamente un vínculo a trabajo de material, ayuda o calibración |

`evaluation_runs.state` admite `AUTHORIZED/RUNNING/STOPPED/COMPLETED`;
`evaluation_stages.state`, `PENDING/RUNNING/COMPLETED/STOPPED`;
`evaluation_calibrations.state`, `QUEUED/RUNNING/SUCCEEDED/FAILED`.
Son estados operativos. No amplían los seis diagnósticos ni los tres estados RAG.

## Despacho y recuperación

`EvaluationGateway` reserva antes de llamar al adaptador. El recibo contiene
`phase=EMBEDDING/GENERATION/REVIEW`, propietario, clave lógica, hash de entrada,
perfil y límites. La repetición de un resultado `COMPLETED` devuelve el resultado
guardado; una llamada `DISPATCHED` sin resultado o `UNKNOWN` no se vuelve a pagar
automáticamente. Una solicitud nueva de ayuda sigue siendo una intención distinta
con otra clave y se somete a las mismas cuotas y permisos.

Un error confirmado puede conservar código, carácter transitorio y `Retry-After`.
La ingestión mantiene su máximo de tres intentos para fallos recuperables. Una
incertidumbre de transporte o de checkpoint no se interpreta como permiso para
repetir la llamada. Los checkpoints de ayuda siguen en `help_calls`: si su
actualización se pierde pero el ledger ya tiene el resultado, el worker puede
reconciliarlo dentro del plazo y alcance vigentes. Sin ese resultado, espera el
fallback durable sin ampliar el plazo absoluto de 15 s.

Las observaciones de respuesta/error pueden completar metadatos de consumo
después de abortar o perder el permiso pedagógico. Ese registro contable no
publica la respuesta ni revive una fuente revocada. La publicación continúa
exigiendo permisos, configuración, lease, plazo y autorización operacional
vigentes. `stop` impide nuevos despachos y publicaciones autorizadas por el run;
una llamada ya enviada puede liquidar consumo tardío.

## Presupuestos y proyección segura

Cada etapa y el run tienen límites de llamadas, tokens de entrada, máximo de
salida y costo. La reserva es transaccional y conservadora; una llamada incierta
mantiene su reserva. Los precios explícitos por millón de tokens y los costos
en microUSD se guardan como enteros decimales, sin usar coma flotante. No se
inventan precios de Azure ni se interpreta uso desconocido como cero.

La [proyección de recibo](../../packages/contracts/src/evaluation.ts) contiene
IDs operacionales, fase/estado, origen, configuración/modelo/dimensión, hash de
entrada, tiempos, estado de respuesta, ID de proveedor, tokens y costos
observados/reservados. `inputTokens`, `outputTokens`, `observedCostMicroUsd` y
otros datos no observados son `null`. No expone prompts, código, vectores,
material, candidatos, credencial, token de despacho ni el resultado privado.

## Calibración con procedencia comprobable

La calibración obtiene consultas desde intentos y candidatos de pgvector bajo
los filtros reales del producto. El artefacto liga run, origen `TEST/AZURE`,
corpus/versiones/hashes, consultas/hashes, distancias observadas, recibos,
configuración/modelo/dimensión, tokenizer y versión del constructor de consulta.
El servidor vuelve a calcular y comprobar la evidencia persistida antes de
registrarlo o consumirlo. Un conjunto local de distancias arbitrarias no prueba
una medición de Azure; un artefacto de origen TEST no es promovible a Azure.

Se conservan casos positivos y negativos próximos, particiones de calibración y
validación sin mezclar grupos, y el algoritmo versionado de selección de umbral.
El umbral medido no demuestra claridad pedagógica ni corrección semántica general.
La revisión de candidatos ficticios comprueba límites y veredictos; su acuerdo
con otro modelo tampoco sustituye evaluación humana.

## Aislamiento y verificación

LAB-EVAL utiliza proyecto `alunza-edu-laboratorio-eval`, API 4400, web 3400,
listener 4401 y Supabase 194xx. TEST conserva API 4300, web 3300 y Supabase
184xx, con proveedor controlado explícito. DEV mantiene sus puertos 4200/3200 y
174xx. La configuración rechaza un ambiente de evaluación dirigido a DEV;
el listener de evaluación no se habilita en producción.

Las pruebas nuevas incluyen controles externos por UUID de intento o hashes de
archivo/fragmentos, contenido hostil tratado como texto, fallos reales en
PostgreSQL y lectura de Storage, reanudación y continuidad RUN/SUBMIT. Los
controles TEST no forman parte de rutas productivas ni se activan por instrucciones
en documentos. Ejecución integrada, regresión completa y resultados se registran
en el documento de trabajo: CI completo aprobado con 146 casos HTTP, 471
aserciones SQL, 45 recorridos Cypress y el arnés de cuatro etapas. Esta prueba
local no acredita integración Azure ni aceptación humana.
