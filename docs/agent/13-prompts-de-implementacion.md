# Prompts listos para iniciar trabajo de código

Estos textos están dirigidos al futuro agente de desarrollo. Copia el que corresponda y completa los campos entre corchetes antes de enviarlo. Su presencia en el repositorio no inicia tareas ni autoriza acciones externas. Las instrucciones actuales del usuario y del entorno siguen siendo la autoridad.

## Construir el MVP completo

```text
Implementa el MVP completo de Alunza en este repositorio basándote en AGENTS.md,
docs/agent/README.md y los specs. Inspecciona primero el estado real y reutiliza
el código existente. Lee el plan docs/agent/01-plan-de-implementacion.md y
trabaja por incrementos integrados, preservando la cobertura de los 27 RF,
sus escenarios y los requisitos no funcionales.

Conserva la arquitectura y proveedores documentados. Resuelve y registra
decisiones técnicas reversibles dentro de este alcance sin pedirme permiso
por cada detalle. Para decisiones con impacto en permisos, alcance o reglas
pedagógicas, revisa la autoridad existente y prepara una propuesta concreta
si falta una definición esencial; continúa las partes independientes.

Construye la persistencia, API, frontend y verificaciones necesarias para
cada flujo. No cierres el trabajo en un scaffold, una interfaz simulada o
un proveedor falso. Si faltan credenciales, completa contratos y pruebas
locales, deja la integración real identificada como pendiente y continúa
el trabajo que pueda verificarse.

Ejecuta los checks proporcionales y requeridos, conserva los cambios ajenos
y actualiza contratos, guías operativas y evidencias reales. Antes de una
acción remota, publicación, gasto o comunicación, comprueba que tenga
autorización vigente; la construcción local no la supone automáticamente.

Al entregar, informa cobertura implementada/probada, comandos ejecutados,
defectos o decisiones pendientes y estado real de la demo y despliegue.
No afirmes aprobaciones, métricas o resultados que no existan.
```

## Construir únicamente la fundación

```text
Implementa IMP-00 de Alunza conforme a AGENTS.md y la guía
docs/agent/02-fundacion-y-arquitectura.md. Comprueba si ya existe una base antes
de generar código. Fija una combinación compatible del stack documentado,
workspace mínimo, contratos públicos, API NestJS única, configuración segura,
servicios locales, migración inicial revisada y CI verificable.

Incluye una comprobación mínima real de web/API/datos y un acceso permitido
y denegado según el alcance viable. Registra decisiones y comandos reales.
No marques completos RF de negocio solo por generar carpetas o DTO.
Detén la ampliación funcional cuando la fundación solicitada esté cerrada.
```

## Implementar una capacidad específica

```text
Implementa [capacidad] para [actor] cubriendo [ALZ-RF-NNN y RNF relacionados].
Lee AGENTS.md, el requisito, su caso de uso y los escenarios ALZ-HU-NNN-E1
a E4, además de las guías de las áreas que vayas a modificar.

Inspecciona qué parte existe y completa las capas necesarias para que el
flujo sea utilizable y verificable. Conserva permisos, estados, versiones,
idempotencia y manejo de errores de los specs. Trata los DEC afectados según
docs/agent/12-decisiones-pendientes.md y no amplíes funciones ajenas.

Verifica éxito, entrada inválida, acceso ajeno y falla/concurrencia relevante.
Entrega el comportamiento integrado, las comprobaciones realizadas y las
limitaciones pendientes con referencias a los archivos modificados.
```

## Continuar una implementación existente

```text
Continúa la implementación autorizada de Alunza desde el estado actual.
Lee AGENTS.md y el último registro de tarea o traspaso que exista; contrasta
sus afirmaciones con git diff, código y evidencia. No reinicies el proyecto
ni repitas una fase ya verificada sin motivo.

Completa [la capacidad pendiente o el próximo incremento dentro del alcance].
Conserva decisiones vigentes, secretos y cambios previos; actualiza solo la
documentación y pruebas afectadas. Si una dependencia sigue bloqueada,
explica el bloqueo específico y avanza trabajo independiente autorizado.
```

## Corregir un defecto

```text
Corrige [síntoma] en [flujo] de Alunza. Lee AGENTS.md, el requisito y su
escenario de aceptación. Reproduce o acota el fallo con evidencia y localiza
la causa antes de cambiar código. Conserva el contrato correcto y los datos.

Añade o ajusta una prueba de regresión si es necesaria para verificar el
defecto; no debilites permisos, límites ni aserciones para obtener verde.
Ejecuta las comprobaciones pertinentes y reporta causa, solución y límites.
No aproveches la corrección para reescribir áreas no relacionadas.
```

## Revisar un incremento

```text
Revisa [rutas, diff o incremento] de Alunza frente a AGENTS.md y los specs
afectados. Comprueba autorización, integridad, concurrencia, contratos,
fallos y cobertura de aceptación según corresponda. Busca defectos concretos
que produzcan comportamiento incorrecto o exposición, con ubicación y caso
de reproducción. Distingue pruebas realizadas de análisis estático.

No edites ni publiques cambios salvo que estén autorizados en esta tarea.
Si no encuentras defectos accionables, dilo sin inventar observaciones y
explica las verificaciones que no pudiste realizar.
```

## Preparar una entrega

```text
Prepara la versión candidata de Alunza según AGENTS.md y
docs/agent/11-operacion-y-entrega.md. Verifica cobertura, comandos reales,
configuración, migraciones, demo ficticia, recuperación y evidencias del
commit/árbol actual. Corrige problemas dentro del alcance autorizado.

Comprueba qué publicación o despliegue está autorizado en la conversación.
Deja listo el resultado verificable antes de ejecutar efectos externos que
requieran una autorización faltante. Informa claramente qué está preparado,
qué está desplegado y qué permanece pendiente, sin atribuir aprobación humana.
```

## Delegar una parte a otro agente

```text
Trabaja únicamente en [subtarea concreta] dentro de [archivos/directorios].
Lee AGENTS.md, [guías específicas] y [RF/contratos]. La tarea principal es
[objetivo] y otros agentes trabajan en [áreas fuera de tu responsabilidad].
No edites archivos compartidos sin coordinar. Mantén [contrato acordado]
y los DEC [identificadores] en su estado real. Envía pronto cualquier
incompatibilidad que afecte integración. Implementa y verifica tu parte;
al entregar lista archivos, pruebas reales, decisiones y pendientes.
No hagas despliegues ni comunicaciones externas fuera de la autorización.
```

El agente coordinador debe aportar contexto suficiente, revisar el resultado y verificar la integración. Delegar tareas de desarrollo no introduce una arquitectura multiagente en Alunza.
