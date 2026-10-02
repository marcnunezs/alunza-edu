# Ensayo técnico del ejecutor

El ejecutor de IMP-03 conserva el contrato `module.exports.solve`, argumentos
JSON y retorno JSON síncrono. Cada caso tiene una cápsula y un intérprete
QuickJS WASM nuevos. El paquete no concede permisos académicos: el backend
autoriza la ejecución y selecciona versiones/pruebas antes de llamar `execute`.

## Reproducción local

Desde la raíz Git, con Node 24.21.0, npm 11.19.0 y Docker Linux con cgroup v2:

```powershell
npm run runner:prepare
npm run runner:doctor
npm run runner:probe -- --adapter docker
npm run runner:probe -- --acceptance-only
npm run runner:cleanup
```

`runner:doctor` ejecuta el probe fijo de identidad mediante `runCapsule`. Verifica
`memory.max=134217728`, `memory.swap.max=0`, `pids.max=32`,
`cpu.max="100000 100000"`, Node 24.21.0, UID10001, cinco conjuntos de capabilities
en cero y limpieza observada. Devuelve 2 cuando faltan motor, controladores o
imagen; 1 cuando el ensayo real no acredita esos controles; 0 cuando pasa.

Los informes están en `.local/reports/imp-00-06-08/`. La batería completa produce
`runner-docker.json`; el ensayo focal de identidad, permisos, memoria nativa,
descendientes, procesos, DNS/IPv6/UDP y recolección de
un contenedor expirado produce `runner-docker-acceptance.json`. El recolector
solo considera nombres, etiqueta y vencimiento propios. Su prueba mantiene
controles vigentes y con otra etiqueta, y los limpia en `finally`.

El supervisor `imp-03-quickjs.4` usa HTTP sobre IPC local para controlar Docker,
incluidos arranque, entrada y salida. Resuelve la precedencia
`DOCKER_CONTEXT`, `DOCKER_HOST` y contexto activo una vez por proceso, rechaza
TCP/SSH y rutas UNC remotas, y fija todas las conexiones al mismo endpoint. Un cambio
de contexto requiere reiniciar la API. Negocia la API Engine entre 1.41 y 1.45
con el rango declarado por `/version`; esto conserva compatibilidad de código
con Docker 20.10 del Sandbox, cuya integración remota sigue sin ejecutar.

Las respuestas de control se limitan a 524288 bytes y tienen plazos absolutos.
Un pool de proceso conserva como máximo dieciséis conexiones IPC y cuatro libres;
no almacena respuestas ni reintenta mutaciones. El arranque registra primero dos
attachments separados: salida multiplexada y entrada. Así el EOF de la entrada
en Windows no cierra la lectura de salida. Se validan upgrade, framing, tamaño y
plazo; ambos canales se cierran ante fallo. Después del EOF se espera la salida
por Engine y se contrasta con la inspección independiente del contenedor.
Se mantienen la inspección de configuración antes de arrancar, la lectura de
estado/OOM y la eliminación forzada seguida de una observación HTTP 404. No se
siguen redirecciones. El cambio evita nuevos procesos CLI para cada consulta,
sin reutilizar cápsulas ni omitir controles. Referencias primarias:
[Engine API](https://docs.docker.com/reference/api/engine/),
[contextos](https://docs.docker.com/engine/manage-resources/contexts/) y
[esquema Engine 20.10](https://raw.githubusercontent.com/moby/moby/v20.10.24/api/swagger.yaml).
El pool y el cierre de conexiones siguen [Node HTTP Agent](https://nodejs.org/docs/latest-v24.x/api/http.html#class-httpagent).
La separación de entrada/salida se verificó sobre named pipes reales de Windows
y Docker, además de las pruebas de framing y cancelación del transporte.

## Frontera del retorno y regresión de la brecha

La batería contiene `forged-return-known-gap` en
`tests/runner/fixtures.mjs`. Su programa ficticio es:

```javascript
module.exports.solve = () => {
  require('node:fs').writeSync(3, '{"kind":"value","value":true}');
  process.exit(0);
};
```

El prototipo IMP-00.06 aceptaba ese valor como `SUCCESS` sin observar el retorno
normal de `solve`. La regresión conserva el programa original y ahora exige
`RUNTIME_ERROR/STUDENT_EXCEPTION`: `require` y `process` no existen en el guest.

Solo el worker Node confiable escribe fd3 después de que `callFunction` termina
sin excepción y un serializador privado valida el valor JSON. El marcador de
invocación identifica el protocolo; la garantía proviene de la frontera WASM y
de no exponer capacidades de Node, no de mantener secreto el marcador. Las
expectativas, el comparador y el diagnóstico continúan fuera de la cápsula.

Se fijan `quickjs-emscripten-core` y la variante
`@jitl/quickjs-wasmfile-release-sync` en 0.32.0. El build copia las dependencias
instaladas y el WASM a un contexto aislado de `.local`, y Docker construye sin
red. No hay `require`, módulos Node, npm arbitrario, temporizadores, DOM ni
loader de imports en el guest. `console.log/error` son callbacks acotados. Se
rechazan promesas, thenables, ciclos, BigInt, números no finitos, accesores y
objetos de prototipo no JSON. Las propiedades `toJSON` no reemplazan el retorno.
El serializador consulta la marca interna Promise de QuickJS en cada nodo,
incluidos retornos anidados y promesas con prototipo retirado. Los handles del
resultado de esa consulta se liberan sin disponer argumentos prestados. También
conserva comprobaciones intrínsecas de Map, Set, Date, RegExp, buffers, vistas,
primitivos envueltos y Error para que retirar su prototipo no los convierta en
objetos JSON vacíos aceptados. Estas regresiones no acreditan seguridad general
de todos los objetos o futuras versiones del motor.

Los probes OS ejecutan programas fijos del arnés para probar memoria nativa,
descendientes y controles de kernel. Solo herramientas locales seleccionan esos
probes mediante opciones de `runCapsule`; el contrato académico estricto no
expone esa selección ni ejecuta el código estudiantil directamente en Node.

El ensayo Docker del 26/09/2026 obtuvo 69/69 casos PASS y cero contenedores
restantes, incluyendo la brecha, límites, probes OS, cancelación y concurrencia.
Esto no acredita paridad remota ni aceptación de RF de negocio.

## Límites y diferencias explícitas

- La cápsula limita memoria total y descendientes a 134217728 bytes. El puente
  confiable también cuenta dentro de ese límite. Los 3000 ms se acumulan entre
  casos usando el reloj monótono del puente, fuera del worker estudiantil. Este
  reloj comienza antes de preparar y lanzar el worker y el puente mata su grupo
  de procesos al vencer el presupuesto restante. Incluye el inicio de Node/WASM
  dentro del worker; excluye arranque de Docker y transporte. La operación
  completa sigue acotada a 30 s en el host. La evidencia privada distingue ese
  tiempo de infraestructura, la vida del contenedor y la duración del puente;
  una respuesta ausente, incompleta o sin cgroups efectivos nunca concede éxito.
  stdout/stderr comparten 65536 bytes. Código y
  transporte del retorno tienen límites independientes de 65536 bytes.
- `execute` limita la operación a 30 s y la limpieza de cada cápsula tiene un
  presupuesto independiente de 10 s. Las etiquetas incluyen `executionId` y
  vencen a los 60 s. `cleanupDockerExecution` verifica nombre y etiquetas antes
  de eliminar solo cápsulas de esa ejecución; `getDockerAvailability` comprueba
  daemon, controladores e imagen local, sin crear ni descargar imágenes.
- Si se pierde o cancela la respuesta de creación, un 404 inmediato no acredita
  limpieza: el supervisor conserva incertidumbre hasta observar esa cápsula o
  vencer su etiqueta de 60 s. La API conserva el período de recuperación en BD
  y llama `sweepExpiredDockerExecutions` al arrancar y cada 15 s, incluso para
  apariciones tardías de ejecuciones ya finalizadas. El barrido exige nombre,
  etiqueta propia y vencimiento; una falla del daemon no acredita limpieza.
  Esta recuperación es eventual al volver el daemon, no una garantía absoluta
  de atomicidad distribuida entre una respuesta perdida y la creación remota.
- El puente PID1 usa UID0 y retiene `CAP_SETUID`, `CAP_SETGID` y `CAP_SETPCAP`
  para crear al alumno con UID diferente y capabilities cero. Por ello no se
  acredita la propiedad de una cápsula enteramente sin privilegios. El alumno
  debe superar la comprobación de permisos antes de cargar su código.
- El kernel puede presentar excesos transitorios y la terminación tiene latencia
  de planificación. La evidencia no acredita el p95 completo del producto.
- Sandbox requiere manifiesto vigente, imagen exacta y presupuesto autorizado.
  Este corte admite un Sandbox por ensayo y reserva ocho solicitudes para
  limpieza. Una expiración automática no demuestra limpieza observada.
- La imagen exterior se prepara antes de ejecutar: no hay instalaciones ni
  descargas durante el trabajo estudiantil. Construirla localmente no prueba
  optimización VCR, importación de la cápsula, cgroups anidados ni paridad remota.
