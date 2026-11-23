# Plantillas para tareas, decisiones y evidencias

Usa estas plantillas como registros breves de trabajo real. No crees archivos rellenados con resultados supuestos ni copies todas las secciones para una edición trivial. Las rutas sugeridas son futuras y solo deben crearse cuando una tarea necesite persistir contexto.

## Registro de tarea

Para una implementación de varias sesiones, guarda un registro en una ruta como `docs/work/IMP-03-practica.md`, o usa el sistema de tareas ya existente. No dupliques trackers.

```markdown
# [ID y resultado de la tarea]

## Alcance

Solicitud vigente: [qué autorizó el usuario].
Resultado observable: [actor, acción y resultado esperado].
Requisitos: [ALZ-RF/HU/CU/PT y RNF].
Fuentes: [specs concretos].

## Estado comprobado

Fecha y versión: [fecha, commit y cambios sin commit relevantes].
Existe: [código/contratos comprobados].
Falta: [capas o criterios pendientes].
Decisiones: [DEC, estado y supuesto si corresponde].

## Trabajo

- [ ] [Paso concreto y verificable]
- [ ] [Paso concreto y verificable]

## Validación

| Criterio | Comando o procedimiento real | Resultado | Evidencia |
| --- | --- | --- | --- |
| [Escenario] | [Comando exacto sin secretos] | [No ejecutado / pasó / falló] | [Ruta/registro] |

## Continuación

Próxima acción: [acción única y ejecutable].
Bloqueo: [dependencia precisa o ninguno].
Trabajo independiente posible: [qué puede avanzar].
```

No marques una casilla por haber escrito el archivo si el paso exige integración o prueba. Si el usuario reduce el alcance, deja constancia de lo que sale de esa tarea sin borrar requisitos del proyecto.

## Registro de decisión

Vincula la decisión al DEC existente en [fuentes](../../specs/00-fuentes-y-decisiones.md). Para una decisión nueva, asigna un ID no usado y registra impacto; no sobrescribas AD-ARQ-001 o AD-IA-001.

```markdown
# [ID y decisión concreta]

Fecha: [fecha real].
Estado: [propuesta / supuesto técnico / resuelta / aceptada con evidencia].
Origen: [spec, incompatibilidad o instrucción del usuario].

## Problema y alternativas

[Diferencia precisa y consecuencias de cada alternativa pertinente].

## Tratamiento

[Elección o propuesta, motivo y alcance].
Autoridad: [instrucción, acuerdo o decisión técnica real; sin atribuciones ficticias].
Validación: [ensayo, test o revisión pendiente/realizada].

## Impacto

Requisitos afectados: [IDs].
Contratos/archivos: [rutas].
Datos existentes: [migración, versiones y preservación].
Riesgos o límites: [concretos].
Trabajo que puede continuar: [tareas].
Condición de cierre pendiente: [si aplica].
```

Usa «supuesto técnico» para una elección de trabajo reversible. Una prueba que pasa puede demostrar viabilidad; no demuestra aprobación institucional. Mantén sincronizados el registro y los specs solo cuando cambie realmente su decisión o contrato.

## Evidencia de prueba

Reutiliza los IDs ALZ-PT/ALZ-HU-E y RNF. Registra la evidencia en un archivo acotado, reporte de CI o ubicación ya usada por el repositorio. No incluyas secretos, tokens, datos personales reales, pruebas ocultas expuestas o trazas sin sanear.

```markdown
# [Prueba o conjunto ejecutado]

Fecha: [fecha/hora real y zona].
Versión: [commit, estado del árbol y configuración relevante].
Requisitos/escenarios: [IDs].
Ambiente: [local / CI / integración remota / demo].
Datos: [fixture/corpus y versión; ficticios].
Dependencias: [reales / dobles identificados / indisponibles].

## Procedimiento y resultado

Comando/procedimiento: [lo ejecutado, sin credenciales].
Esperado: [criterio derivado del spec].
Observado: [resultado y código de salida reales].
Estado: [pasó / falló / no ejecutado].
Evidencia: [ruta o URL autorizada al reporte].
Limitación: [qué no demuestra esta prueba].
Defecto o siguiente paso: [si corresponde].
```

Para rendimiento agrega perfil, concurrencia, número de muestras, región, arranque frío/caliente, errores, método de percentil y duración completa. Para seguridad registra qué acceso se permitió o denegó y sobre qué ámbito ficticio, sin publicar el contenido restringido.

## Traspaso de contexto

Usa este formato al pasar una subtarea a otro agente, continuar en otra sesión o interrumpir una implementación larga. Guarda el registro en la tarea existente cuando sea posible.

```markdown
# Continuación de [tarea]

Objetivo vigente: [alcance y exclusiones de esta tarea].
Raíz del repositorio: [ruta real].
Estado Git: [branch y cambios previos/propios relevantes, sin borrar nada].
Instrucciones necesarias: [AGENTS y guías del área].

Completado y probado: [resultado y evidencia].
Implementado sin verificar: [rutas y verificación pendiente].
Pendiente: [criterios exactos].
Decisiones: [DEC y estado actual].
Autorizaciones/limitaciones vigentes: [solo las realmente dadas].
Servicios activos: [proceso/puerto/ambiente si aplica; sin secretos].
Último comando relevante: [comando, resultado y por qué importa].
Próxima acción: [paso concreto].
Archivos reservados por otros agentes: [rutas y coordinación].
```

El receptor debe verificar el estado antes de editar, pero no rehacer las comprobaciones ya válidas sin cambios que lo justifiquen. No interpretes una interrupción como cancelación del objetivo ni como aprobación de acciones pendientes.

## Entrega al usuario o descripción de cambio

Informa primero el resultado observable. Luego indica archivos/contratos relevantes, motivo del cambio, verificación realizada y limitaciones materiales. Para una entrega pequeña bastan uno o dos párrafos; para varias capacidades usa una lista breve de resultados paralelos.

No incluyas un historial completo de intentos, estimaciones inventadas o una afirmación de «todo terminado» si quedan criterios sin verificar. Si está probado localmente pero falta integración remota, dilo de forma precisa. Vincula archivos y evidencias existentes; no enlaces rutas futuras como si fueran entregables.
