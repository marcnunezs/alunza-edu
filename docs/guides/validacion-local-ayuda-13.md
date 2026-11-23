# Validación local de intento, ayuda y reintento `.13`

Perfil explícito `PHYSICAL_HELP_TEST`, separado de la campaña de latencia y
capacidad. Usa Auth/API/PostgreSQL/Storage/pgvector y KVM reales, con proveedores
de IA TEST. No instala, despliega, migra ni resemilla servicios automáticamente.

## Preparar

1. Seguir los controles de identidad, host físico, puertos loopback y acceso
   privado de [la guía de navegador `.13`](validacion-local-navegador-13.md).
   Preservar los contenedores, volúmenes, registros y respaldos existentes.
2. Comprobar cero recursos pendientes y cero trabajos de ayuda/ingestión activos
   antes de habilitar sus workers. Capturar los hashes de evidencia previa.
3. Identificar el `artifactRoot` compilado. Debe incluir el auxiliar real
   `infra/materials/extractor.mjs` y sus dependencias. Probar extracción
   supervisada de TXT sin omitir su proceso ni cambiar límites.
4. Preparar un arnés separado con los scripts `linux-vm-help-*`, sus dependencias
   del perfil físico anterior y los auxiliares TEST `help-providers.cjs`,
   `help-fault-observer.cjs`, `help-fault-controls.cjs`,
   `help-fault-materials.cjs` y `laboratory-test-state.cjs`.
5. Crear un manifiesto privado nuevo, de modo 0600 en Linux. Conserva el contrato
   físico anterior (`schemaVersion`, `campaignId`, `candidate`,
   `webSourceDigest`, `endpoints`, `controlKey`, `outputDir`, `statePath`,
   `brokerSocket`) y agrega `profile: PHYSICAL_HELP_TEST`, `artifactRoot`,
   `controlDir`, `faultPath`, `scopesPath`, `providerObservationsPath`.
   Las últimas cuatro rutas deben ser distintas y hermanas dentro de la
   campaña; el artefacto debe estar separado. No reutilizar directorios de
   control ni resultados o claves de campaña. No publicar el manifiesto.

## Ejecutar y comprobar

Arrancar únicamente los servicios TEST existentes y el broker identificado.
El control debe arrancar antes de la API para inicializar los registros privados:

```sh
node scripts/linux-vm-help-control.mjs --manifest /ruta/privada/manifiesto.json
node tests/integration/linux-vm-help-api.cjs --manifest /ruta/privada/manifiesto.json
```

La API requiere su configuración TEST loopback habitual, runner `local-vm`,
`HELP_WORKER_ENABLED=true`, `MATERIALS_WORKER_ENABLED=true` y señales desactivadas.
La evaluación y las configuraciones Azure deben estar desactivadas. No cambiar
cuotas ni plazos. Su arranque informa etapas seguras y `PHYSICAL_HELP_API_READY`.
La web usa el compilado identificado; el túnel SSH conserva las claves fijadas.

En Lenovo, usar una copia privada del manifiesto con `outputDir` local nuevo:

```sh
node scripts/linux-vm-help-browser.mjs --manifest C:/ruta/privada/manifiesto.json
```

Se requiere `summary.pass=true`, Cypress 3/3 sin omisiones, seis intentos/VM,
cuatro ayudas y tres reintentos con prueba SQL. `finish` exige cierre y retiro;
ningún resultado parcial se acepta. El perfil no calcula p95. Revisar también
las observaciones previas a cada fase del proveedor, referencias, ACK/replay y
rechazos sin admisión. Un fallo exige conservar esa corrida y repetir con una
identidad y ámbitos nuevos después de corregir su causa.

## Cerrar

Retirar el navegador/web y enviar SIGTERM al control mientras la API aún está
disponible: así puede archivar ámbitos propios, incluidos los parciales, y
desactivar el fallo. Después drenar la API y retirar el broker sin recursos
activos. Verificar hashes históricos y cero trabajos pendientes con PostgreSQL
todavía disponible. Aplicar el [apagado físico verificado](apagado-servicios-fisicos.md),
retirar el túnel y confirmar ausencia de puertos, QEMU y archivos en scratch.
Preservar los registros y bytes históricos, sin limpiezas generales.

Exportar solo recibos y fuentes revisados, excluyendo credenciales/runtime;
verificar archivo y miembros por SHA-256 en ambos equipos.
[Resultado del 18/11/2026 y límites de aceptación](../work/IMP-04-ayuda-fisica-13.md).
