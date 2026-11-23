# Recorrido web de IMP-03.07

Este arnés queda fuera del glob E2E local. La campaña remota lo selecciona con
`kind: "api"`, `fixtures: ["browser-vertical"]` y configuración pública
`{ "baseUrl": "https://API", "webOrigin": "https://WEB", "fictitiousOnly": true }`.
El orquestador exige autorización, candidato, destino y presupuesto antes de
invocar `executeBrowserStage`; este módulo no proporciona un comando de ejecución
remota independiente.

Recorre la interfaz real: RUN fallido, cancelar el primer diálogo de envío,
SUBMIT fallido, SUBMIT correcto, recarga e historial, copia de un intento y nuevo
SUBMIT correcto. Son cuatro creaciones nuevas: una RUN y tres SUBMIT. No altera
respuestas, no simula proveedores y no cambia el reloj. Las intercepciones observan
el tráfico y comprueban confidencialidad y límites. No pide ayuda IA.
Comprueba que no existe panel ni consulta de ayuda antes de un intento persistido;
tras el 201 y la lectura de su historial, la explicación puede solicitarse desde
el panel habilitado. El recorrido también conserva esta asociación al abrir un
intento guardado después de recargar. Rechaza cualquier POST de ayuda: la invocación
real de Azure OpenAI/RAG sigue pendiente y requiere su propia aceptación.

`ALUNZA_SANDBOX_BROWSER_FIXTURES_FILE` debe apuntar a un JSON privado con:

- `schemaVersion: 1`, `environment: "preproduction"`, `fictitiousOnly: true`.
- `baseUrl`, `webOrigin` iguales a la etapa, y `supabaseHost` del Auth configurado.
- `actorId`, `activityId`, `assignmentId`, `exerciseVersionId` de una fixture
  ficticia preparada, publicada y habilitada, con un único ejercicio requerido,
  pruebas visibles y ocultas, y sin intentos anteriores para este actor.
- `actorSession`: sesión Supabase completa del actor ficticio, incluidos
  `access_token`, `refresh_token`, `token_type`, `expires_at`, `expires_in` y `user`.
  Debe mantener al menos diez minutos de vigencia. No colocar esta sesión en el
  manifiesto público ni en Git.
- `successfulCode`, `failingCode`: soluciones conocidas del ejercicio; la fallida
  debe fallar una prueba visible y la correcta debe superar también las ocultas.
- `privateSentinels`: identificadores/valores privados que no deben aparecer en
  respuestas o DOM.

El arnés instala la sesión bajo `alunza.auth.<supabaseHost>`. Lee los secretos con
`cy.env(..., {log:false})`; ejecuta Cypress en un hijo con stdout/stderr descartados,
sin Cloud, screenshots ni video. El reporte solo contiene IDs, diagnósticos,
estados y contadores. No reutiliza el support local que inicia/detiene la API.
Cada respuesta API observada debe incluir `X-Release-Id` igual al commit aprobado
de la campaña; una cabecera ausente o diferente invalida el recorrido.
La comprobación de contenido privado cubre respuestas y DOM observados. Este arnés
no inspecciona logs de los servicios remotos y no acredita su ausencia de filtraciones.

Para observar las cuatro sesiones y su cleanup usa
`ALUNZA_SANDBOX_API_DATABASE_URL` y `ALUNZA_SANDBOX_API_DATABASE_CA_FILE`, con el
rol limitado `alunza_app`, TLS verificado y transacciones de solo lectura. Un PASS
de Cypress no basta: deben coincidir los cuatro `executionId` de la UI con cuatro
sesiones remotas distintas, finalizadas y con limpieza verificada. La planificación
reserva 320 requests normales del proveedor y 32 de limpieza; el tráfico HTTP
cliente tiene un límite separado de 240.

Requiere Cypress 16.0.0 y su binario ya instalados. Usa Electron headless incluido;
no instala dependencias ni navegadores. Al vencer el plazo termina el árbol del
proceso Cypress que creó y deja el estado de limpieza pendiente visible al
reconciliador. La preparación local puede verificarse sin abrir navegador ni red:

```powershell
node --test tests/remote-sandbox/browser-harness.test.mjs
node node_modules/typescript/bin/tsc -p tests/remote-sandbox/tsconfig.json
```

Estas comprobaciones locales no acreditan el recorrido remoto. La aceptación
queda pendiente hasta ejecutar la etapa autorizada sobre el candidato exacto.
