# Propuesta de costos del probe Vercel Sandbox

Fecha de preparación: **04/10/2026**. Estado: **estimación y reserva propuestas;
destino y autorización pendientes**. No se ha ejecutado este ensayo ni publicado
una imagen como parte de esta preparación.

El alcance es una comprobación inicial de capacidad con la operación
`probe:sandbox`: una creación, hasta 60 solicitudes HTTP y una ventana de despacho
de 1.800 segundos. Este probe utiliza un único fixture; sus resultados no aceptan
la integración productiva completa ni la paridad Docker/Sandbox de IMP-03.07.

## Base de cálculo en USD

Se propone **Pro en `iad1`** para calcular una referencia revisable. Esta elección
no identifica un team/proyecto real ni confirma su plan. Las tarifas se
consultaron el 04/10/2026 en la
[página oficial de precios de Vercel Sandbox](https://vercel.com/docs/sandbox/pricing).
Antes del despacho deben comprobarse nuevamente las tarifas y el plan efectivos.

| Concepto                               | Tarifa Pro, `iad1`                  | Supuesto del probe                    | Importe calculado |
| -------------------------------------- | ----------------------------------- | ------------------------------------- | ----------------- |
| CPU activa                             | US$0,128 por vCPU·hora              | 1 vCPU plenamente activo durante 60 s | US$0,002133333    |
| Memoria provisionada                   | US$0,0212 por GB·hora               | 2 GB durante 60 s                     | US$0,000706667    |
| Creación                               | US$0,60 por 1.000.000 de creaciones | Una creación                          | US$0,0000006      |
| CPU y memoria                          | `(0,128 + 2 × 0,0212) / 60`         | Un minuto                             | **US$0,00284**    |
| Total de los tres conceptos calculados | Suma anterior                       | Un minuto y una creación              | **US$0,0028406**  |

El cálculo conserva los precios de lista sin descontar créditos o cantidades
incluidas en el plan. Los 60 slots HTTP son un límite técnico de solicitudes;
no equivalen a 60 creaciones. No se han medido ni presupuestado tráfico,
almacenamiento o publicación en un registro de imágenes, impuestos, conversión
monetaria ni otros cargos. La suscripción Pro tampoco está incluida. El costo
facturado debe conciliarse con el consumo observado del ensayo.

## Reserva propuesta y monto autorizado

Se propone una **reserva técnica de CLP 1.000** para este probe. Es un techo
prudente propuesto para control operativo, separado del cálculo en USD: no se
dispone de un tipo de cambio efectivo que permita presentar una estimación
válida en CLP. Esta reserva no acredita aprobación del Product Owner, no cubre
la suscripción de un plan ni autoriza publicar una imagen o crear otros recursos.

El monto autorizado sigue **pendiente**. El ejemplo conserva `maxCost=0` y
`remote.enabled=false` hasta disponer de una aprobación concreta. Todo servicio
pagado requiere la autorización del Product Owner conforme al
[spec de operación](../../specs/11-operacion-y-despliegue.md#costos-y-aprobación-operativa).
El arnés controla nuevos despachos por cantidad y tiempo; `maxCost>0` funciona
como condición de autorización, sin medir por sí mismo cargos facturados ni
imponer un corte automático de facturación en Vercel.

## Duraciones y recursos separados

- **1.800 s** es la ventana global de nuevos despachos configurada en el ejemplo.
  No representa el tiempo provisionado de la VM usado en esta estimación.
- **60 s** es el timeout máximo que el adaptador actual solicita para cada VM,
  mediante `Math.min(60000, tiempoRestante)`. Se conserva ese comportamiento.
- El máximo publicado del proveedor es **45 minutos en Hobby** y **24 horas en
  Pro/Enterprise**, según sus [límites oficiales](https://vercel.com/docs/sandbox/pricing#runtime-limits).
  Estos límites no cambian el timeout de 60 s del adaptador ni autorizan ampliar
  el ensayo.
- El adaptador solicita 1 vCPU y comprueba que el recurso efectivo reporte
  1 vCPU/2.048 MB. La capa estudiantil conserva 128 MiB, 3 s acumulados y
  64 KiB de salida combinada.

El presupuesto de solicitudes reserva ocho slots para limpieza; esta dispone
de hasta 30 s desde su inicio, incluso si terminó la ventana normal de despacho.
Debe registrarse la duración real hasta finalizar `stop`/`delete` y comprobar
los remanentes. El TTL de la VM no acredita limpieza efectiva.

## Configuración privada pendiente antes del ensayo

Completar un manifiesto privado a partir del
[ejemplo Sandbox calculado](../../infra/preproduction/sandbox-probe.costed.example.json)
con los datos efectivos siguientes:

| Campo          | Valor requerido                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| Destino        | `targets.sandbox.teamId`, `projectId` y región efectivos; `iad1` sigue propuesta                     |
| Imagen         | Imagen realmente publicada fijada por digest `@sha256:…`; igualdad exacta con `RUNNER_SANDBOX_IMAGE` |
| Candidato      | `release.sha` del candidato que se ensayará y trazabilidad con la imagen publicada                   |
| Acceso técnico | `VERCEL_TOKEN` privado con permiso sobre el destino; configurar sin exponer su valor                 |
| Aprobación     | Product Owner, `approvedBy`, referencia comprobable y monto concreto en CLP                          |
| Vigencia       | `approvedAt` y `expiresAt` UTC, ventana vigente de máximo siete días                                 |
| Operación      | `remote.enabled=true` y `allowedOperations` acotado a `probe:sandbox`                                |
| Límites        | Una creación, 60 solicitudes HTTP y 1.800 s, ligados a la aprobación                                 |

La publicación de la imagen necesita autorización propia antes de ejecutarla.
Si el probe se lanza desde un Job manual de Azure Container Apps, también debe
estar autorizada la operación `azure:job`; el probe local no exige desplegar toda
la plataforma. La secuencia y los gates existentes se conservan en
[IMP-05 remote validation](IMP-05-remote-validation.md#gate-y-secuencia-de-sandbox-real).

Tras la aprobación y configuración completas, ejecutar el probe y registrar
recursos efectivos, aislamiento, limpieza, solicitudes, duración y cargos
observados. Esta preparación no aporta resultados de un ensayo real.
