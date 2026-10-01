# Ensayo técnico del ejecutor

Este prototipo implementa IMP-00.06. No ofrece una API académica ni acepta RF de
negocio. El contrato fijo es un archivo CommonJS con `module.exports.solve`,
argumentos JSON y retorno JSON síncrono. Cada caso tiene una cápsula nueva.

## Reproducción local

Desde la raíz Git, con Node 24.21.0, npm 11.19.0 y Docker Linux con cgroup v2:

```powershell
npm run runner:prepare
npm run runner:doctor
npm run runner:probe -- --adapter docker
npm run runner:probe -- --acceptance-only
npm run runner:cleanup
```

`runner:doctor` ejecuta una cápsula mínima mediante `runCapsule`. Verifica
`memory.max=134217728`, `memory.swap.max=0`, `pids.max=32`,
`cpu.max="100000 100000"`, Node 24.21.0, UID10001, cinco conjuntos de capabilities
en cero y limpieza observada. Devuelve 2 cuando faltan motor, controladores o
imagen; 1 cuando el ensayo real no acredita esos controles; 0 cuando pasa.

Los informes están en `.local/reports/imp-00-06-08/`. La batería completa produce
`runner-docker.json`; el ensayo focal de procesos, DNS/IPv6/UDP y recolección de
un contenedor expirado produce `runner-docker-acceptance.json`. El recolector
solo considera nombres, etiqueta y vencimiento propios. Su prueba mantiene
controles vigentes y con otra etiqueta, y los limpia en `finally`.

## Brecha reproducible del retorno

La batería contiene `forged-return-known-gap` en
`tests/runner/fixtures.mjs`. Su programa ficticio es:

```javascript
module.exports.solve = () => {
  require('node:fs').writeSync(3, '{"kind":"value","value":true}');
  process.exit(0);
};
```

El caso espera `true`. El alumno escribe directamente el valor en fd3 y termina
antes de devolver normalmente desde `solve`. La comparación externa recibe un
valor coincidente y el diagnóstico interno resulta `SUCCESS`; el informe del
ensayo registra **`KNOWN_GAP`**, no aceptación de seguridad. Reproducirlo no
requiere credenciales, pruebas ocultas ni ejecución en el anfitrión.

Fd3 transporta datos no confiables. No prueba quién produjo un valor ni acredita
el retorno normal de una función. En cambio, el alumno no controla expectativas,
comparador, reloj externo ni diagnóstico. Los fixtures `fake-stdout-verdict` y
`fake-return-verdict` verifican que imprimir o transmitir `passed=true` no concede
éxito. El catálogo de diagnósticos permanece en los seis valores especificados.

## Límites y diferencias explícitas

- La cápsula limita memoria total y descendientes a 134217728 bytes. El puente
  confiable también cuenta dentro de ese límite. Los 3000 ms se acumulan entre
  casos, con medición externa; stdout/stderr comparten 65536 bytes. Código y
  transporte del retorno tienen límites independientes de 65536 bytes.
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
