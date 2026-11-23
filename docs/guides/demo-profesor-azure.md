# Demo del profesor con Azure — 20/11/2026

La ayuda real con fuente, su lectura en navegador como alumno y profesor y el
reintento correcto ya se verificaron en el Lenovo. Este guion usa el expediente
**Azure07**; el [respaldo TEST](demo-profesor-guion.md)
conserva sus propios datos y una explicación sin consumir.

## Abrir y revisar hoy

1. Conecta el Lenovo a Internet. Puedes compartir la conexión del teléfono;
   abre la demo en el navegador del Lenovo. No necesitas conectar con el Ryzen.
2. Abre [Alunza con Azure](http://127.0.0.1:3400/acceso). Si no responde,
   sigue el apartado de arranque de esta guía.
3. Usa Chrome normal para `teacher.a@alunza.test` y una ventana de incógnito
   para `student.a@alunza.test`. Son cuentas ficticias de Alunza. Para consultar
   la contraseña de LAB-EVAL, ejecuta esta línea en una terminal privada desde
   la raíz del proyecto y ciérrala antes de compartir pantalla:

   ```powershell
   .\.tools\node-v24.21.0-win-x64\node.exe .local\demo-azure-20261119\credentials.mjs
   ```

4. Como estudiante, abre la
   [actividad de ensayo](http://127.0.0.1:3400/actividades/d708390b-86ff-4b8b-a298-176d7a737b44/ejercicios/de6a548a-e60c-4dad-89c7-c46348fe6b1a).
   Selecciona **Ver intento #1** y **Mostrar explicación** para consultar la
   respuesta ya guardada. El intento #2 muestra `SUCCESS`. Consultar esta
   ayuda existente no genera otra respuesta.
5. Como profesor, abre la
   [clase preparada](http://127.0.0.1:3400/clases/f67d1ac8-d1ff-457f-a4f0-59ad4042b0b6)
   y el
   [detalle del estudiante](http://127.0.0.1:3400/clases/f67d1ac8-d1ff-457f-a4f0-59ad4042b0b6/estudiantes/20000000-0000-4000-8000-000000000003).

**Conserva la actividad de presentación para mañana.** Su intento inicial
ya está guardado y tiene una explicación reservada. No lo vuelvas a enviar ni
pidas su ayuda para practicar hoy. La reserva vence el **20/11/2026 a las
23:59 de Santiago**; reiniciar los servicios no renueva su vigencia.

## Presentación de 8–10 minutos

1. **Profesor:** muestra en la clase el apunte disponible sobre funciones y
   retorno. Explica: «Alunza recupera fragmentos del material autorizado para
   fundamentar la ayuda». El apunte es ficticio y provisional; indexarlo con
   RAG no entrena ni modifica el modelo.
2. **Estudiante:** abre la
   [actividad reservada](http://127.0.0.1:3400/actividades/fcb0d8a8-3634-4050-8f49-6287da1f3551/ejercicios/3843191d-8d4d-468e-bf69-0363e56cea49)
   y **Ver intento #1**. Di que este intento se guardó durante la preparación.
   Su código calcula la suma dentro de un bloque, pero no devuelve el valor.
3. Pulsa **Pedir explicación** una vez y espera. Abre la ayuda preparada,
   muestra su referencia y descarga el documento original. La respuesta debe
   conservar el diagnóstico del intento; la IA no recalcula el resultado.
4. Introduce esta corrección en el editor:

   ```js
   module.exports.solve = (a, b) => a + b;
   ```

   Pulsa **Enviar intento** y confirma. Muestra `SUCCESS` y los dos intentos
   del historial. El nuevo resultado conserva la evidencia del anterior.

5. Vuelve al profesor y al detalle del estudiante. Muestra ambos intentos y
   la misma ayuda. Si presentas el tablero, filtra la actividad de presentación
   y actualiza el corte después del reintento.
6. Registra la opinión del profesor sobre comprensión, pertinencia de la
   fuente y trazabilidad. Su revisión docente sigue pendiente.

Aclaración técnica para el presentador: el primer diagnóstico es
`RUNTIME_ERROR` porque el ejecutor de Alunza no admite `undefined` como
resultado. Omitir `return` no lanza por sí mismo una excepción de JavaScript.
Esta aclaración no cambia el apunte ni el diagnóstico guardado.

La autorización de este expediente permite una explicación de ensayo y otra
de presentación. No incluye pistas adicionales, carga de otros documentos ni
ayuda para nuevos intentos. No repitas solicitudes si una respuesta degrada.

## Arranque después de reiniciar el Lenovo

**Caso diagnosticado el 20/11 por la tarde:** TEST conserva un bloqueo de
un arranque fallido, sin haber llegado a READY; Azure se cerró después de
agotar el chequeo de disponibilidad de API. Para ese caso se preparó
`Recover-FailedTestStartup.ps1 -Apply`, en lugar del helper de reinicio que
figura abajo. No hace falta detener TEST si no existen sus contenedores.
Consulta el [diagnóstico y condiciones de recuperación](../work/DEMO-recuperacion-arranque-2026-11-20.md)
antes de escoger el procedimiento. La recuperación preparada aún debe
ejecutarla el operador y no acredita que los servicios estén listos.

Abre Docker Desktop y espera a que su motor esté listo. En PowerShell, entra
en el proyecto:

```powershell
Set-Location -LiteralPath 'C:\Users\Lenovo\Desktop\alunza-edu\alunza-edu-laboratorio'
```

Si Windows se reinició sin el cierre ordenado, pueden quedar bloqueos de la
sesión anterior. Compruébalos antes de arrancar:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.local\demo-azure-20261119\operation\Recover-DemoAfterReboot.ps1 -CheckOnly
```

Si informa `LOCKS_ELIGIBLE_FOR_ARCHIVE`, archívalos con el comando siguiente.
Verifica propietario, reinicio posterior, ausencia de procesos y puertos,
rutas y hashes; conserva los bytes originales y el recibo. No borra datos,
no detiene servicios ni llama al proveedor:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.local\demo-azure-20261119\operation\Recover-DemoAfterReboot.ps1 -Apply
```

Si la comprobación indica `testInfrastructureRunning: true`, Docker arrancó
automáticamente los contenedores TEST. Con los consumidores aún detenidos,
cierra sólo esa infraestructura antes de su lanzador; el cierre conserva datos:

```powershell
.\.tools\node-v24.21.0-win-x64\node.exe --input-type=module -e "import { down } from './scripts/local.mjs'; import { testContext } from './scripts/test-environment.mjs'; await down(testContext);"
```

Si cualquiera de estos comandos da error, conserva el mensaje y no continúes
con el arranque. Un PID vigente, archivos cambiados o puertos ocupados necesitan
revisar el propietario; no se deben retirar sus bloqueos manualmente.

Si TEST no responde en 3300, inícialo en una terminal y mantenla abierta hasta
que termine la presentación. Espera `DEMO_READY`:

```powershell
.\.tools\node-v24.21.0-win-x64\node.exe .local\demo-profesor-20261119\launcher.mjs
```

Si Azure local no responde en 3400, ejecuta en otra terminal:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.local\demo-azure-20261119\operation\Start-DemoAzure-Ready.ps1
```

Espera `AZURE_LOCAL_READY` en el registro indicado y comprueba ambos entornos:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.local\demo-azure-20261119\operation\Test-DemoAzure-Ready.ps1
```

El prefijo `-ExecutionPolicy Bypass` permite estos scripts locales revisados
en el proceso hijo de Windows PowerShell; no cambia la política permanente.
La comprobación es de lectura y no solicita IA. Debe devolver `PASS` antes de
la presentación, con ambas ayudas reservadas sin consumo. Si falla, conserva
el mensaje y el recibo. No borres locks ni vuelvas a preparar datos, compilar,
reinicializar bases o cargar documentos para resolverlo.

## Respaldo y cierre

Si falta Internet o la ayuda nueva falla, puedes mostrar la explicación Azure
ya guardada en la actividad de ensayo, identificándola como un resultado del
19/11. Para un recorrido nuevo sin Azure, usa el
[guion TEST](demo-profesor-guion.md) en 3300 y explica que su IA es simulada.
Sus cuentas y actividades son independientes de LAB-EVAL.

Antes de apagar Windows, solicita el cierre de cada demo:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.local\demo-azure-20261119\operation\Stop-DemoAzure.ps1
```

```powershell
.\.tools\node-v24.21.0-win-x64\node.exe .local\demo-profesor-20261119\stop.mjs
```

Espera los recibos `shutdown.json` con `errors: []` y el cierre de los
consumidores. Los datos y las reservas se conservan hasta su vencimiento.

El ejecutor Docker del Lenovo mantiene 128 MiB, 3 s y 64 KiB, pero este ensayo
no reproduce la VM individual de 2 GiB del Ryzen. La calibración tiene cobertura
limitada y no acredita calidad pedagógica general, p95 ni aceptación docente.
La observación automatizada activó los botones reales mediante el DOM; no
certifica interacción con mouse o teclado. Practica hoy con la actividad de
ensayo y su ayuda ya guardada.
Los resultados técnicos se registran en
[recuperación de fuentes](../work/DEMO-recuperacion-fuentes-2026-11-19.md).
