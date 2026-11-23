# crun configurable y validación de API local

Fecha de inicio: 15/11/2026. Alcance autorizado: integrar crun 1.31 de forma
configurable y validar RUN/SUBMIT por HTTP local, conservando systemd, cápsulas
en RAM, arranques simultáneos y reposición después del cierre. Sin despliegue
ni cambios en los contenedores de otros proyectos.

## Contratos y verificación prevista

RF-009/010/011/014, regresión RF-007/008, RNF-REN-02/SEG-04 y recuperación.
La API conserva autorización, cuotas normales, idempotencia y persistencia del
intento anterior a ayuda. La elección de motor, runtime, versión, SHA-256 y
estrategia queda fijada en la reserva. Las reservas Docker anteriores siguen
siendo válidas. El candidato está desactivado por defecto y limitado a local/test.

Una pareja de cápsulas de un solo uso por motor: activa o en reserva. Preparación
y arranques en paralelo; reposición solo después de limpieza durable, commit,
autorización final y cierre HTTP. La espera por la pareja cuenta en la latencia.
RUN retira la segunda cápsula sin utilizarla. La recuperación observa y limpia;
nunca recupera autoridad para volver a ejecutar código. Esta estrategia se
evalúa con una instancia local de API; no acredita rendimiento horizontal.

El perfil académico medido usa un caso visible en RUN y uno visible más uno
oculto en SUBMIT. La estrategia `cold` y la continuación de casos 3–8 conservan
los límites por cápsula, pero no repiten en código la comprobación del ancestro
compartido de 1 CPU/2 GiB que realizan las dos cápsulas preparadas. Esta campaña
no acredita esas variantes ni extiende a ellas su comprobación del ancestro.

El registro privado aditivo conserva intención, incertidumbre de creación,
identidad y evidencia de retirada. Una creación incierta y un 404 no bastan
para liberar capacidad. El TTL no sustituye la comprobación de limpieza.

## Ambiente y protocolo

VM existente `Laboratorio-Ubuntu`, Ubuntu 24.04, 2 vCPU/4 GiB, Docker con
systemd. Motores privados separados para servicios de control en disco y
cápsulas en RAM. PostgreSQL/Auth reales y rol `alunza_app`; proceso API compilado
del proyecto, sin sustitución de repositorios, autenticación o ejecutor.

La campaña incorpora un grupo systemd privado de 1 vCPU/2 GiB para el motor
ejecutor y sus cápsulas; API y base de datos quedan fuera de ese grupo. La
concurrencia de cuatro comparte esa misma envolvente y un único motor. La
revisión del A/B anterior encontró controles efectivos por cápsula, pero no
evidencia de esa envolvente conjunta. Por ello sus 4,651 s no son una comparación
directa bajo condiciones idénticas. No se aumentará CPU/RAM para alcanzar la meta.

La herramienta de instalación Supabase CLI 2.101.0 requiere una instrucción AVX
que esta CPU virtual no expone. Se ejecuta únicamente esa herramienta de
aprovisionamiento mediante un binario privado de QEMU verificado contra el
paquete firmado de Ubuntu; no se instala globalmente ni se registra binfmt.
Los servicios y procesos medidos siguen siendo nativos.

Cliente HTTP dentro de la VM. El reloj mide hasta recibir el último byte de la
respuesta; no representa latencia desde Chile ni una medición de navegador.
Perfil ejecutado: 50 RUN y 50 SUBMIT secuenciales, alternando llegadas inmediatas
y con pausa; perfil independiente de 50 RUN y 50 SUBMIT con concurrencia cuatro.
Actores ficticios rotados dentro de las cuotas normales. Se conservarán fallos,
colas, arranques fríos y valores extremos.

Controles previos: migración nueva y actualización, RLS/grants y contratos SQL,
pruebas de API/runner, replay/conflicto, permisos vigentes, límites efectivos
de 134217728 bytes agregados, 3 s acumulados y 65536 bytes de salida, cancelación,
recuperación y limpieza. La medición anterior de 4,651 s era del supervisor;
no se presenta como resultado de esta campaña HTTP.

## Implementación y controles de código

- API: configuración estricta, contexto durable, repositorio operacional y
  servicio compartido por RUN/SUBMIT. El cierre HTTP gobierna la reposición.
  El apagado espera la finalización de servicios y limpieza antes de cerrar BD.
- Runner: identidad del ELF, versión y hash; pareja de un uso; plazos comunes;
  comprobación del lease y de cgroups efectivos antes de stdin; recuperación
  de recursos aunque se retire la configuración de nuevas admisiones.
- Migración aditiva `20261115225605_practice_docker_prepared_runtime.sql`:
  pares y recursos privados, contexto inmutable, exclusión por motor,
  `SKIP LOCKED` y evidencia durable. Los helpers de recuperación rechazan
  contexto de actor y no se conceden al navegador.
- La prueba de concurrencia SQL queda incorporada en `npm run test:integration`.
  El arnés HTTP reproducible está en `tests/integration/docker-runtime-api.mjs`;
  importa sesiones ficticias y un observador del registro, sin operar Docker.

Comprobaciones ejecutadas antes de la campaña: 60 suites API/1034 pruebas;
17 suites runner/394 pruebas tras las correcciones de drenaje y recuperación;
45 suites de preproducción/890 pruebas y diez nuevas del arnés HTTP. Las 22 pruebas HTTP
sin infraestructura se repitieron con limpieza simulada explícita para impedir
contacto con el Docker del anfitrión. Formato, lint, tipos globales y build de
API/web aprobaron. Estas cifras son controles de código, no aceptación remota.

La actualización real de BD pasó 151 aserciones SQL en los archivos 023/024.
La prueba con dos conexiones `alunza_app` verificó ocho casos de concurrencia.
Se corrigió el permiso temporal del migrador para reemplazar funciones del
propietario interno. Ese permiso se revoca al terminar; no se elevó el rol API.

La instalación desde cero aplicó las 26 migraciones y pasó los 24 archivos SQL
con 1664 aserciones, además de los ocho casos concurrentes. Los servicios de
Auth/PostgreSQL y la API compilada pasaron 23 comprobaciones HTTP reales:
los seis diagnósticos en RUN y SUBMIT, replay idéntico, conflicto de payload,
consulta posterior, denegación por organización/clase y protección de pruebas
ocultas. Fueron 13 ejecuciones nuevas; estas solicitudes no integran el perfil
de rendimiento.

RUN y SUBMIT superaron la interrupción real de la API con un trabajador activo:
la nueva instancia recuperó con admisiones deshabilitadas, esperó el lease
natural, rotó la propiedad, verificó retirada y conservó el mismo resultado
`UNKNOWN/RUNNER_FAILURE` en los replays, sin nuevas creaciones. El primer
observador SUBMIT falló antes de provocar el corte; ese envío terminó en
`TIMEOUT` y se limpió. Se conservó el incidente y se repitió únicamente SUBMIT
con checkpoints adicionales, sin relajar aserciones.

Ocho pruebas nativas verificaron memoria agregada de padre/hijos y retirada de
descendientes. Los OOM esperados ocurrieron en las hojas; el contador local del
grupo exterior permaneció en cero. El programa C confiable de diagnóstico usó
un tmpfs ejecutable privado: esa excepción no pertenece al flujo académico ni
demuestra su política `noexec`.

El caso de tiempo acumulado terminó en `TIMEOUT` con solo el caso visible
aprobado. Su `runtimeMs` observado fue 3347,540 ms: el presupuesto sigue siendo
3000 ms, pero esta métrica suma preparación del worker, ejecución, interrupción
y espera de su cierre. Sin marcas del disparo del watchdog ni de la última
instrucción no se atribuyen los 347,540 ms adicionales únicamente a limpieza
ni se afirma un corte físico exacto a los 3000 ms. No se repitió para obtener
una cifra menor.

El control HTTP de límites generó seis ejecuciones y catorce solicitudes. Su
primera versión aprobó once y rechazó tres por una expectativa incorrecta del
verificador: exigía 65536 bytes en el contador público del SUBMIT acumulado,
cuando la proyección existente expone solo los 40001 bytes visibles. El
diagnóstico `UNKNOWN/OUTPUT_LIMIT`, la truncación y el primer caso aprobado eran
correctos. Se conservó el recibo fallido, se corrigió el oráculo y se verificó
el intento existente mediante GET y replay; ambos aprobaron y SQL confirmó cero
ejecuciones nuevas. No se reetiqueta aquella corrida como catorce aprobaciones.

La revisión independiente reprodujo un bloqueo de disponibilidad: si otra
réplica retiraba una pareja después de un fallo de cierre, su instancia original
conservaba la referencia local. Se corrigió consultando la retirada durable de
la pareja exacta, únicamente tras cierre HTTP y sin operaciones locales activas.
Ocho comprobaciones independientes con puertos simulados aprobaron la corrección
y los rechazos; no se presentan como una campaña real de dos réplicas vivas.
El candidato anterior de los controles SQL, smoke y recuperación tiene huella
`10e290565f9f55eb1b3fb64b5e63cdcd5a93ea79e616025791b7e921e87118bb`;
el candidato posterior, destinado al perfil, es
`ec4088c1db07671bcafefeaf298025c23291e2713bd374a2eb90708da9c5b241`.
Ambos usan la misma migración, imagen, binario crun y configuración.

## Resultado HTTP completo

Las 200 solicitudes medidas usaron el candidato final: 199 resultados correctos
y un resultado de infraestructura fallido, también persistido. No se descartó
ninguna muestra. Percentil empírico por rango más próximo, posición 48 de 50;
se exige p95 estrictamente menor que 5000 ms y cero fallos para cumplir.

| Perfil                      | Solicitudes | Resultados correctos |      p50 |      p95 | Correctos bajo 5 s |
| --------------------------- | ----------: | -------------------: | -------: | -------: | -----------------: |
| RUN secuencial              |          50 |                   50 |  5,003 s |  7,908 s |                 25 |
| SUBMIT secuencial           |          50 |                   50 |  5,710 s |  8,645 s |                 23 |
| RUN, concurrencia cuatro    |          50 |                   50 | 16,323 s | 27,886 s |                  0 |
| SUBMIT, concurrencia cuatro |          50 |                   49 | 17,579 s | 30,080 s |                  0 |

Ningún perfil cumplió la meta. Los secuenciales alternaron 25 llegadas inmediatas
y 25 pausas de seis segundos. En cada perfil se conservó el primer envío tras
reiniciar la API; base de datos y motores permanecieron calientes. En los
concurrentes, las cuatro solicitudes de la primera tanda comparten el arranque
frío de API; la primera despachada no necesariamente fue la primera atendida.
La espera del cliente por cuota fue cero; no se aumentaron las cuotas.

El control de apagado falló antes de enviar la primera solicitud concurrente.
El proceso de API ya no existía y se comprobaron cero parejas, recursos y
cápsulas pendientes; la causa exacta del fallo del controlador no quedó
registrada. Se corrigió su doble lectura de `/proc` y la captura de errores,
sin modificar el producto. Las dos series secuenciales quedaron intactas y se
continuaron únicamente las dos concurrentes en otro expediente, con sesiones
nuevas fuera de medición, cuotas conservadas y secuencias 124–223. No se repitió
el smoke ni ninguna muestra. El primer setup de 1192 s incluye la barrera de
los controles previos: no es tiempo de arranque de API ni latencia HTTP.

La solicitud 191 respondió HTTP 201 en 33762,642 ms, con
`UNKNOWN/CANCELLED` e infraestructura `FAILED`: cuenta como fallo del perfil.
Esperó 28299 ms desde admisión hasta asignación; el servicio durable tomó
3384 ms. El bridge registró 481,961 ms y el ciclo del runner, 2873,184 ms.
Esto es consistente con agotar el plazo operacional de 30 s después de esperar
la pareja, no con agotar los 3 s estudiantiles. No se amplió el plazo ni se
volvió a ejecutar esa solicitud para sustituir su resultado.

La auditoría independiente encontró 200 ejecuciones y 200 parejas distintas,
máximo cuatro HTTP simultáneos globales y por organización y máximo cinco POST
por actor en sesenta segundos, frente al límite normal de diez. Los tiempos SQL
acreditan que la preparación siguiente no se solapó con el servicio durable
anterior; el instante de cierre HTTP se verifica mediante código y pruebas,
no se deduce de `finished_at`.

## Prioridad de optimización

Para solicitudes aisladas, reducir preparación y el coste de ejecución y
admisión. Con pareja lista, RUN dio p95 4,578 s en 25 solicitudes; SUBMIT dio
5,083 s y dos de sus 25 superaron cinco segundos. En SUBMIT secuencial, el
servicio durable tuvo mediana 3,346 s, frente a 1,440 s del bridge. La diferencia
incluye otras fases confiables; esta serie no permite atribuirla solo al borrado
de Docker ni a una operación interna de crun. Conviene medir esas fases y la
inspección previa a admisión antes de elegir el siguiente cambio.

Para cuatro solicitudes simultáneas, la prioridad es capacidad de atención y
cola. El tiempo anterior a comenzar la preparación propia ocupó el 49,5 % del
HTTP agregado de RUN y el 55,5 % de SUBMIT. Una pareja global atiende en serie;
con los costes medidos, ajustar únicamente el runtime no acredita la meta.
Una evaluación posterior de trabajadores independientes deberá conservar por
trabajador su envolvente de 1 CPU/2 GiB, las cápsulas de 128 MiB y la reposición
tras su cierre, y definir explícitamente el alcance de la reserva. No se
implementó ni desplegó esa ampliación en este incremento.

## Estado y evidencia

Integración configurable implementada y validada en la API local. Conformidad
de rendimiento pendiente, con un fallo de infraestructura bajo concurrencia.
La campaña no acredita navegador, latencia desde Chile, KVM nativo ni aceptación
remota de IMP-03.07. Los bloqueos ajenos de IMP-04 permanecen abiertos.

Datos privados: `.local/preproduction/imp-03-07/vbox-crun-api/`, con raw originales,
continuación, revisión independiente, pruebas SQL, límites y recuperación.
La ejecución puntual de `quality:coverage` en Windows durante RUN secuencial
duró aproximadamente 2,13 s; se registra como posible contención del anfitrión,
sin atribuirle una causa ni excluir observaciones.

La auditoría final verificó 232 parejas retiradas: 224 asignadas y ocho ociosas.
Los 464 recursos quedaron `CONFIRMED/VERIFIED`, con prueba durable de ausencia;
las 224 ejecuciones conservaron resultado y, cuando correspondía, intento.
Se consultaron 472 identificadores (464 del registro y ocho nativos) y 464
nombres: todos ausentes, sin scopes ni procesos propios restantes. Se apagaron
los cinco servicios de control y ambos motores privados, y se retiraron RAM,
montajes, dispositivos loop, grupo systemd y espacios de red propios. El drenaje
final de API tomó 1,262 s. Dos volúmenes conservan datos y registro operacional.

El boot ID se mantuvo, SSH respondió y el Docker habitual de la VM conservó su
inventario vacío. No se operó el Docker del anfitrión ni se midió su inventario;
las mutaciones estuvieron restringidas a los recursos privados del ensayo.
Los logs operacionales revisados no incluyeron los marcadores de código, pruebas
ocultas o credenciales buscados; esta búsqueda no se presenta como prueba
universal de ausencia de cualquier contenido sensible.

La huella global final fue idéntica antes y después de los perfiles:
`ec4088c1db07671bcafefeaf298025c23291e2713bd374a2eb90708da9c5b241`, 769 fuentes.
El paquete instalado de 499 archivos coincidió con el workspace; su manifiesto
es `064e23ea236a8b688d0a042b98295f492c4ad7550180b1aa4f1618b71750371c`.
La revisión independiente verificó los 169 artefactos exportados por tamaño y
SHA-256. Los resúmenes para IMP-07.01 están en
`.local/evidence/imp-03-crun-api/{preflight,functional,performance}.json`;
separan el candidato previo, las comprobaciones focales finales y el
incumplimiento de rendimiento. Conservan el baseline anterior de la matriz.
