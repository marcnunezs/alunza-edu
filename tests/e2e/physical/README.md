# Navegador físico `.13`: arnés adjunto

Estos comandos **no arrancan Docker, API, web, broker ni túneles**. El operador
prepara el candidato y el nuevo proyecto `alunza-edu-laboratorio-physical-test`,
rota las credenciales TEST y conserva los volúmenes/evidencias históricos.
No usar el launcher E2E general ni `phase-context` para esta campaña.

Usar Node 24.21.0/npm 11.19.0 y dependencias del lockfile; los paquetes contracts
deben estar compilados. Chrome/Cypress corresponden a los ya preparados en Lenovo.

El manifiesto privado (archivo ordinario, dueño actual y `0600` en Linux) contiene:

```json
{
  "schemaVersion": 1,
  "campaignId": "UUID de esta campaña",
  "candidate": "objeto de siete pins de validateCandidate, no una cadena",
  "webSourceDigest": "SHA256 real del candidato web",
  "endpoints": {
    "web": "http://127.0.0.1:3300",
    "api": "http://127.0.0.1:4300",
    "apiReplica": "http://127.0.0.1:4301",
    "auth": "http://127.0.0.1:18421",
    "control": "http://127.0.0.1:4302"
  },
  "controlKey": "64 dígitos hex aleatorios privados",
  "statePath": "/ruta/absoluta/estado-del-nuevo-test.json",
  "brokerSocket": "/ruta/privada/broker.sock",
  "outputDir": "directorio absoluto NUEVO para este comando"
}
```

Los pins son `runnerVersion`, `capsuleImageId`, `runnerSourceDigest`,
`kitManifestSha256`, `guestSha256`, `apiSourceDigest` y `brokerSha256`.
No inventar sus valores. Los manifiestos bridge/capacidad/navegador comparten
identidades y clave, pero **requieren outputDir distintos**, apropiados al sistema
donde se ejecutan. La carpeta de salida debe no existir.

```text
node scripts/linux-vm-browser-control.mjs --manifest /privado/bridge.json
node scripts/linux-vm-capacity.mjs --manifest /privado/capacity.json
node scripts/linux-vm-browser.mjs --manifest C:/privado/browser.json
```

El bridge se ejecuta en Ryzen, escucha solo `127.0.0.1:4302` y usa el estado TEST
para PostgreSQL/Auth. El navegador requiere túneles SSH locales explícitos para
3300, 4300, 18421 y 4302. El ejecutor de capacidad puede correr en Ryzen; si se
ejecuta desde Lenovo necesita además 4301. Mantener host pin/clave SSH y no usar
bindings públicos. La segunda API comparte BD/host/kit y conserva cuotas normales.

`POST /task` exige clave en `x-alunza-control-key`, campaignId y acciones allowlisted:
`inspect`, `prepare`, `login`, `snapshot`, `verify`, `absent`, `barrier-arm`,
`barrier-wait`, `barrier-release`, `barrier-cleanup`, `hold-start`, `hold-finish`, `membership`, `close`.
No recibe SQL, shell ni rutas arbitrarias. Sólo tareas Node poseen la clave.
`login` devuelve una sesión Auth real del actor; nunca contraseña, rol de BD,
clave administrativa o pruebas ocultas. Los fixtures son adicionales y se cierran
sin borrar intentos. La revocación temporal F06 se restaura al cerrar/shutdown.

Capacidad: seis tandas controladas de ancho 2/4 (18 ofertas, seis admisiones
esperadas) más dos carreras mixtas sin barrera (seis ofertas, dos admisiones
esperadas). Se alternan las dos API. La barrera SQL focal libera automáticamente
a los 12 s; esa liberación es fallo de campaña y nunca un pase. No amplía plazos
del producto. Estos 24 resultados no participan en p95.

La primera campaña `capacity-01` fallida se conserva. El arnés corregido espera
sólo las respuestas HTTP de los contendientes, como máximo 1200 ms programados
desde observar la barrera, y registra el motivo y tiempo real de liberación.
`barrier-release` únicamente desbloquea; no ejecuta DDL mientras las peticiones
están pendientes. Tras terminar todas las respuestas se verifican BD/broker y se
retiran trigger/función con `barrier-cleanup`; una nueva barrera exige ese retiro.
Así se observan tanto la exclusión anterior al commit como el ledger PENDING
durable después de liberar. HTTP 201/503/otro y requestId se conservan aunque falle
la verificación privada. Se siguen exigiendo exactamente una admisión, los demás
BUSY, cero efectos en perdedores y una VM por tanda; liberar pronto no suaviza
ninguna de esas aserciones. La limpieza DDL no cambia el timeout SQL del producto.

Navegador: ocho casos funcionales independientes, seguidos por 20 RUN8 y 20
SUBMIT8, ocho estudiantes rotados. F01 publica una versión con dos casos visibles
y seis ocultos: RUN2 y SUBMIT8 usan esa misma versión; su intento se comprueba en
historial, progreso y detalle docente. F08 libera la barrera inmediatamente tras
503, antes de verificar rollback, esperar Retry-After o recargar: el slot libre
no debe provocar reintento automático. El timeout SQL del producto sigue en 2 s.
Antes de iniciar una campaña, el operador debe dejar expirar la ventana de cuota
de campañas anteriores (60 s desde la última admisión); no elevar cuotas. Esta
campaña de navegador admite como máximo nueve operaciones por estudiante en
total, bajo el límite habitual de diez por minuto.
Se mide en el reloj AUT desde el click efectivo
hasta el resultado correlacionado renderizado; SUBMIT empieza al confirmar.
Todos los resultados normales, incluidos fallos y primeras muestras, se conservan.
Login, navegación previa y startup quedan separados; no se vacía la caché del host.
Se exige p95 `<5000 ms` por modo y ninguna muestra omitida/fallida. No acredita
concurrencia productiva, Internet público, ETL ni aceptación académica.

Conservar `protocol.json`, `requests.jsonl`, `cases.jsonl`, `summary.json` y
`control-events.jsonl` privados. Las capturas automáticas, vídeo, reintentos de
Cypress y Cloud están deshabilitados. Ante falla no completar el denominador con
otra corrida favorable: conservar la campaña e investigar con etiqueta nueva.
El operador verifica retirada, cierra sus procesos y túneles por identidad y
respalda recibos saneados. Una prueba offline del arnés no acredita esta ejecución.
