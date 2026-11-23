# IMP-05.07 — Contrato de tablero y observación personal

Fecha: 26/10/2026. Este diccionario concreta el plan solicitado por el usuario;
el estado de verificación se registra en [el trabajo del incremento](IMP-05-dashboard.md).
Conserva DEC-005 y las fórmulas de [spec14](../../specs/14-progreso-y-senales.md).

## Decisiones del corte

- El usuario eligió mostrar todas las señales ACTIVE, diferenciando episodios
  históricos de condición vigente. REVIEWED sigue disponible como filtro.
- Los totales usan matrícula actualmente inscrita y ACTIVE, incluso para un
  corte pasado. No reconstruyen el padrón histórico. Las señales autorizadas
  de estudiantes fuera de ese conjunto siguen disponibles y se identifican.
- Una consulta lee historia persistida; no ejecuta reglas, publica señales,
  revisa episodios ni registra actividad estudiantil.
- El detalle integral del estudiante y la revisión RF-019 siguen en IMP-06.

## Contratos HTTP

Rutas bajo `/api/v1`, con JWT validado, sesión y permisos vigentes. Respuestas
`{data,requestId}` y `Cache-Control: no-store`. Definiciones ejecutables
en [dashboard.ts](../../packages/contracts/src/dashboard.ts),
[progress-observation.ts](../../packages/contracts/src/progress-observation.ts)
y [progress.ts](../../packages/contracts/src/progress.ts); OpenAPI generado desde ellas.

| Ruta GET                           | Entrada y resultado                                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/me/progress`                     | `classId`, actividad/concepto, `from/asOf`, cursor/límite. Conserva resumen, desgloses y evidencia de completitud; añade `observation` con resumen del período, última actividad e intentos paginados. |
| `/classes/{id}/dashboard`          | Actividad/concepto, `from/asOf`, cursor/límite. Resumen, actividad/conceptos, estudiantes paginados, contadores de señales y estado del procesamiento.                                                 |
| `/classes/{id}/dashboard/evidence` | Mismos filtros, `kind=ATTEMPT/COMPLETION/EVENT/HINT`, estudiante opcional; diagnóstico solo para ATTEMPT. Evidencia mínima paginada del conjunto vigente.                                              |
| `/classes/{id}/signals`            | Actividad/concepto, `asOf`, tipo, `state=ACTIVE/REVIEWED/ALL`, cursor/límite. Historia persistida, membresía actual explícita y procesamiento.                                                         |
| `/classes/{id}/signals/{signalId}` | `asOf`. Regla, causa, estado, fechas, última evaluación y hechos autorizados del episodio.                                                                                                             |

`ALL` es filtro de consulta, nunca estado persistido. No existe ruta de revisión.
El profesor debe estar asignado a la clase y vigente; ADMIN de reglas no recibe
acceso pedagógico. El alumno de `/me/progress` siempre se deriva de la sesión.
Las lecturas docentes de evidencia no usan las rutas de intentos propios ni
los componentes estudiantiles que solicitan ayuda o registran su lectura.

## Temporalidad, agregados y páginas

`from ≤ asOf ≤ hora del servidor`, extremos inclusivos, UTC con hasta seis
decimales. Sin corte, el servidor resuelve `asOf`; las siguientes páginas
transmiten ese corte. Sin inicio, la observación abarca toda la historia hasta
el corte. La UI muestra fechas en la zona de la organización y mantiene los
instantes originales. Una hora local ambigua/inexistente se rechaza.

El inicio filtra intentos y eventos observados, pero no elimina logros previos.
COMPLETION ignora el inicio para obtener el primer éxito de cada asignación.
Última actividad se obtiene hasta el corte, sin filtrar por inicio. Señales no
admite `from`: un episodio anterior puede seguir siendo relevante.

El denominador de clase cuenta pares estudiante/asignación requerida; el
numerador cuenta pares con un éxito confirmado de su versión fija. Los
conceptos se filtran mediante relaciones históricas sin multiplicar filas;
sus porcentajes no se suman. `ratio=null` con denominador cero y los estados
`NO_REQUIRED_EXERCISES/NO_ATTEMPTS/HAS_EVIDENCE` conservan su significado.

`period`/`observation.summary` contienen intentos, cuatro diagnósticos de fallo
técnico verificable, intentos no verificables, pistas entregadas, eventos
elegibles y conteos de los seis diagnósticos. Un error canónico puede ser
verificable aunque no exista cobertura visible completa; los contadores
visibles incompletos son null, nunca ceros fabricados. HINT_DELIVERED cuenta
una entrega real deduplicada. Una solicitud fallida no es una entrega.

Los agregados se calculan antes de paginar. Tamaño predeterminado 50, máximo 100. Cada cursor está ligado al actor, ámbito, filtros, corte y clave estable;
un cursor incompatible se rechaza con 422. Cada respuesta tiene una lectura
consistente y `observedAt`; las páginas no prometen congelar nuevos commits
tardíos ni sustituyen la autorización vigente.

## Episodios y evidencia mínima

Se incluyen episodios cualificados hasta el corte. Revisión e interrupción
posteriores no se proyectan hacia el pasado. La última evaluación persistida
se presenta con su fecha y regla, dentro del episodio correspondiente; una
evaluación de un episodio sucesor no se atribuye al anterior. No se promete
una evaluación exactamente en cualquier T solicitado. `ACTIVE` no significa condición vigente y REVIEWED
no significa resolución del problema.

La proyección separa `state`, `stoppedAt/stopReason`, `lastEvaluation`,
`currentMember` y `verification`. Los contadores `currentStudents` y
`historicalStudents` cuentan **episodios** de cada población y suman `count`;
no cuentan personas únicas.

`processing.status` distingue `UP_TO_DATE`, `PENDING`, `FAILED` y
`NOT_EVALUATED`, junto a último cálculo, frontera procesada, carriles
pendientes/fallidos y tipos sin regla. Estos son metadatos operativos,
no estados de señal. Ausencia de evaluación no equivale a ausencia de
dificultades. No se modifica la configuración del worker al consultar.

La evidencia pública contiene identificadores, contexto, fechas, diagnóstico,
completitud y resultados visibles agregados. No contiene código, consola,
casos ocultos, contenido RAG, snapshots internos o credenciales. Evidencia
indisponible se presenta como no verificable; una falla SQL produce error.

## Persistencia, compatibilidad y operación

La migración aditiva incorpora funciones privadas e índices. El núcleo de
progreso se comparte entre las lecturas propias y docentes, sin cambiar la
identidad de la transacción. El wrapper SQL `student_progress` conserva su
forma anterior; la API ampliada utiliza `student_progress_observed`.

Los entrypoints autorizan el ámbito antes de devolver hechos. Kernels y
ledgers no reciben grants directos para el navegador o rol de aplicación;
se conserva el propietario limitado y `search_path` fijo. No se añade una
lectura general de intentos a los profesores ni se usa service_role en HTTP.

La instalación debe aplicar la migración antes de desplegar API/web de este
incremento. La preparación de pruebas de actualización usa las rutas previas
contra .06: comprueba liveness y readiness 503 porque falta la migración. Tras
migrar verifica readiness de datos y las nuevas RPC con el rol limitado. No requiere backfill
de datos, dependencias nuevas ni proveedores remotos.

## Ajuste de lectura IMP-05.08

La migración `20261026212627_dashboard_processing_set_based.sql` conserva las
firmas, propietarios limitados y permisos de `dashboard_processing` y
`dashboard_read`. Materializa las claves y relojes compartidos, las atestaciones
de cobertura y los cambios sin ACK para calcular la frescura en conjunto.
Conserva el vector ordenado, su digest, los trabajos ausentes y los cambios
confirmados después del corte que aún requieren reconciliación. `evaluatedAt`
sigue siendo la última fecha de cálculo persistida cuyo tiempo evaluado no
supera el corte.

El resumen de señales construye únicamente tipo, estado al corte, estudiante
y pertenencia vigente, que son los campos necesarios para contar. Las rutas
de listado y detalle mantienen su proyección histórica y su evidencia mínima.
Las consultas siguen siendo de solo lectura, sobre un snapshot, con
autorización vigente en cada petición.

La segunda migración aditiva `20261026220133_dashboard_summary_projection.sql`
reduce la proyección interna de intentos utilizada por los contadores a
diagnóstico y verificabilidad. Evita construir contexto y resultados de detalle
que ese agregado no consume. Las rutas de evidencia y progreso personal mantienen
sus proyecciones completas; las cifras, filtros y DTO públicos no cambian.

El [registro .08](IMP-05-acceptance.md) conserva el defecto de rendimiento
medido, la comparación de resultados, pruebas de permisos y actualización
desde .07, y el estado de los perfiles de capacidad. Los contratos públicos
y DEC-005 conservan su significado.
