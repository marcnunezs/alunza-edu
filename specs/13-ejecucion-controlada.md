# Ejecución controlada de JavaScript

Fecha: 2026-09-10. Fuente: F01 ERS ALZ-RF-009/010/011, RNF-REN-02, RNF-SEG-04, ALZ-PAR-001 y AD-ARQ-001 del [inventario](00-fuentes-y-decisiones.md). **Documentado:** proveedores, límites y diagnósticos. **Propuesta DEC-003/004:** protocolo, arnés, supervisión y clasificación de motivos.

## Alcance y límites

Cada ejecución productiva usa un Vercel Sandbox desechable sin secretos, archivos del anfitrión ni red no autorizada. El adaptador Docker local debe conservar el contrato funcional, aunque exige validación independiente de seguridad.

| Capa | Límite documentado | Evidencia necesaria |
| --- | --- | --- |
| Entorno Sandbox | 1 vCPU y 2 GB RAM | Configuración efectiva registrada por ejecución |
| Proceso estudiantil | 128 MB | Límite real de memoria del proceso y descendientes, incluyendo memoria externa al heap |
| Tiempo del programa | 3 segundos | Supervisor externo detiene el proceso y sus descendientes |
| Salida del programa | 64 KB | Captura limitada y marca de truncamiento; no acumular salida ilimitada en API |
| Respuesta completa | p95 <5 segundos en demo | Aprovisionamiento, ejecución, cierre y persistencia incluidos |

Vercel documenta [el tamaño 1 vCPU/2 GB](https://vercel.com/changelog/vercel-sandbox-now-supports-1-vcpu-2-gb-configurations) y [políticas de egreso](https://vercel.com/changelog/advanced-egress-firewall-filtering-for-vercel-sandbox). Estas capacidades no acreditan el límite interno de 128 MB o 3 s: deben imponerse y probarse por separado. **Propuesta de unidades:** 128 MiB y 64 KiB combinados para stdout/stderr; confirmar interpretación exacta de MB/KB con DEC-003 antes de medir fronteras.

No basta fijar `--max-old-space-size` para afirmar un límite de memoria total. Deben ensayarse buffers nativos, procesos hijos y salida descontrolada. Si el entorno no permite aplicar el límite aprobado, documentar el impedimento y resolverlo antes de aceptar el ejecutor productivo.

## Contrato de ejercicio propuesto

Un ejercicio define `language=javascript`, una función de entrada con nombre válido, argumentos JSON y retorno serializable JSON. El banco contiene enunciado, plantilla, versión, conceptos, dificultad y pruebas. Las pruebas definen argumentos, resultado esperado, visibilidad y comparación exacta estructural. Tolerancias numéricas solo si el ejercicio las declara explícitamente.

El MVP no requiere DOM, módulos npm arbitrarios, descargas, red, acceso a base de datos ni proyectos de varios archivos. El código se entrega como archivo de datos a un arnés fijo. No interpolarlo en una línea de shell ni usarlo para construir rutas/comandos. El lenguaje exacto de funciones síncronas o asíncronas y sus restricciones se fija con fixtures antes de publicar los ejercicios.

Las pruebas deben ser deterministas: evitar dependencia del reloj, red o aleatoriedad, o inyectar valores controlados desde el arnés. Ejecutar cada caso con estado limpio para impedir contaminación entre casos. Validar la solución de referencia y al menos una solución incorrecta antes de permitir publicar la versión.

## Puerto del ejecutor

```text
ExecutionInput
  executionId, requestId
  exerciseVersionId, testsVersion, runnerVersion
  mode = RUN | SUBMIT
  code, entrypoint
  tests: conjunto autorizado suministrado por servidor
  limits: memoria, tiempo total y salida máxima

ExecutionResult
  executionId, diagnosisCode
  visibleTestResults, privateTestResults
  allRequiredPassed, stdout, stderr, outputTruncated
  runtimeMs, lifecycleMs
  terminationReason, infrastructureStatus
  sandboxRegion, resourceUsage, runnerVersion
```

`RUN` ejecuta pruebas visibles y ofrece retroalimentación técnica temporal. No completa ejercicios ni habilita pistas sin un intento persistido. `SUBMIT` verifica todas las pruebas requeridas visibles y ocultas y entrega evidencia para crear el intento. Ambos modos ejecutan con el mismo aislamiento.

El backend conserva el resultado privado y proyecta únicamente los campos permitidos al estudiante. El navegador nunca envía pruebas ocultas, resultados aprobados ni parámetros para aumentar los límites.

## Ciclo de vida

1. Validar autorización vigente, actividad PUBLISHED, versión asignada, tamaño de código y cupo operativo.
2. Reservar idempotencia y admisión en el servidor. El orden de admisión y cierre debe quedar definido transaccionalmente.
3. Crear un entorno limpio con red bloqueada por defecto, sin variables secretas ni volúmenes del anfitrión. El supervisor prepara lo mínimo para la ejecución.
4. Ejecutar el código como identidad sin privilegios, sin sudo, acceso a credenciales de plataforma o control del supervisor. Impedir creación de procesos o acotarlos bajo los mismos límites.
5. Correr pruebas con canal de control separado de stdout/stderr del estudiante. El supervisor mide el presupuesto total y normaliza resultados.
6. Finalizar descendientes, recoger evidencia limitada y destruir el entorno en un bloque de limpieza que también se ejecute tras error.
7. Para SUBMIT, persistir intento, código, versión, resultado técnico y eventos en una transacción. Solo después puede solicitarse IA/RAG. Si falla, no confirmar el envío.
8. Registrar duración, región, consumo, motivo operativo y truncamiento, sin código o pruebas en logs generales.

Un proceso bloqueado, un socket abierto, un `process.exit()` o un error del arnés no puede omitir la limpieza. Un recolector operativo debe detectar entornos huérfanos tras caída de la API y cerrarlos, con trazabilidad.

## Clasificación determinista

Los únicos diagnósticos admitidos son los seis de la ERS. La prioridad siguiente es **Propuesta** para eliminar ambigüedad; conserva motivos operativos en campos separados.

| Condición observada | Diagnóstico | Motivo operativo posible |
| --- | --- | --- |
| Todas las verificaciones requeridas del modo terminan y pasan | `SUCCESS` | `COMPLETED` |
| El compilador/parser detecta sintaxis inválida atribuible al código | `SYNTAX_ERROR` | `STUDENT_SYNTAX` |
| Excepción de ejecución atribuible al código, con evidencia confiable | `RUNTIME_ERROR` | `STUDENT_EXCEPTION` |
| Ejecución válida finalizada con una o más verificaciones fallidas | `FAILED_TEST` | `ASSERTION_FAILED` |
| El programa supera su presupuesto de 3 s | `TIMEOUT` | `EXECUTION_DEADLINE` |
| Evidencia incompleta, memoria/salida excedida o infraestructura fallida sin diagnóstico concluyente | `UNKNOWN` | `MEMORY_LIMIT`, `OUTPUT_LIMIT`, `POLICY_DENIED`, `RUNNER_FAILURE`, `PROVIDER_FAILURE` |

No clasificar la falta de credenciales o creación fallida de Sandbox como error del alumno. Puede retornarse fallo HTTP de dependencia antes de admitir una ejecución; si ya existe una ejecución admitida, guardar el fallo operativo sin completar pruebas. Nunca devolver SUCCESS con ejecución parcial.

**Propuesta de precedencia:** error de sintaxis previo al lanzamiento; después, terminación forzada de tiempo/memoria/salida; después, excepción del alumno; después, pruebas fallidas; SUCCESS solo al final del protocolo completo. Si no se puede atribuir confiablemente la causa, UNKNOWN. El [plan de pruebas](10-calidad-y-pruebas.md) debe incluir múltiples fallas concurrentes para validar esa prioridad.

## Protección de verificaciones ocultas

Un sandbox separa al usuario del anfitrión, pero no vuelve privados los archivos que su propio proceso puede leer. Las pruebas ocultas y salidas esperadas no se montan como archivos legibles para el proceso estudiantil ni se incorporan a su scope de JavaScript.

**Propuesta:** supervisor/harness separado del proceso y con permisos de sistema distintos; pasar únicamente la entrada necesaria de cada caso y comparar retorno fuera del control del alumno. Bloquear introspección de procesos ajenos y canales del supervisor. Los argumentos ocultos son observables por la función durante su ejecución; por ello su stdout/stderr y mensajes derivados no se muestran en el resultado público. Suprimir también stacks, IDs descriptivos, rutas y salidas esperadas de casos ocultos.

El protocolo no confía en texto como `{"passed":true}` impreso por el alumno. Validar que no pueda falsificar mensajes del arnés, leer tests ajenos, reemplazar comparadores, alterar futuros casos o escribir archivos de control. Si no se demuestra esta separación, RF-008/009/011 no están aceptados.

## Validación mínima de ambos adaptadores

Casos: solución correcta; sintaxis inválida; excepción; assert fallido; bucle infinito; memoria total y buffers externos; tormenta de stdout/stderr; acceso a red; lectura de variables/archivos ajenos; intento de proceso hijo; `process.exit`; falsificación de protocolo; introspección de tests; ejecuciones concurrentes; interrupción del backend y limpieza.

Comparar fixtures equivalentes en Docker y Sandbox: diagnóstico, contadores, redacción segura y versión del arnés deben coincidir; duración y métricas de infraestructura pueden variar. Registrar pruebas justo debajo, en y por encima de cada límite. El presupuesto de 3 s corresponde al trabajo estudiantil total del intento, no 3 s multiplicados por cada test.

Medir el recorrido completo desde Chile, con región, concurrencia, arranques fríos y calientes, cantidad de pruebas, muestra y versión. La selección de región sigue el menor p95 medido entre las disponibles. Las mediciones y cualquier excepción se registran en DEC-008; no declarar cumplimiento usando solo el tiempo del programa.
