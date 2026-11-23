# Preparación de Azure for Students para la demo — 19/11/2026

**Actualización posterior:** acceso, recurso e indexación reales quedaron
comprobados. La corrección de recuperación aprobó calibración en Azure05;
Azure07 ya produjo ayuda `SUPPORTED` con fuente, revisión `ACCEPT` y reintento
`SUCCESS`, después de corregir una pista indebida en FEEDBACK. La comprobación
en navegador pasó para alumno y profesor, con confirmación de lectura real.
El consumo acumulado es US$0,004342, con 310
recibos completos y cero inciertos. Véanse el
[registro de recuperación](DEMO-recuperacion-fuentes-2026-11-19.md) y el
[guion Azure](../guides/demo-profesor-azure.md). TEST permanece como respaldo.

Los apartados siguientes conservan el corte anterior de las corridas01–02,
sus rechazos y su cierre; no describen el estado posterior de Azure07 ni
constituyen aceptación pedagógica.

## Alcance y autorización

El usuario confirmó mediante captura una suscripción **Azure for Students**
activa, con rol Propietario, y reiteró la autorización para configurar la IA
real y ensayarla con un máximo de **US$5 de inferencia**. El crédito estudiantil
de US$100 no amplía ese máximo. El alcance sigue limitado a un recurso Azure
OpenAI y dos deployments de modelos; web, API, datos y ejecución permanecen
locales. No se autoriza capacidad aprovisionada ni otro servicio de pago.

Microsoft incluye acceso a Azure OpenAI en Azure for Students, con crédito de
US$100 para doce meses. Esto no acredita disponibilidad ni cuota de una versión
concreta en la suscripción del usuario. No se debe confundir esta oferta con
Students Starter ni con ofertas de terceros en Marketplace.
Fuentes: [Students](https://azure.microsoft.com/en-us/free/students/),
[condiciones de la oferta](https://azure.microsoft.com/en-us/pricing/offers/ms-azr-0170p/)
y [cuotas de Azure OpenAI](https://learn.microsoft.com/en-us/azure/foundry/openai/quotas-limits).

El trabajo afecta al ensayo de RF-006/010/012/013/025 y a la evidencia de
RNF-IA-01–04, RNF-CON-01–03 y RNF-REN-03/04. No cambia esos contratos ni
acredita calidad pedagógica o aceptación docente. Los resultados deterministas
y los límites de ejecución se conservan. La demo Docker del Lenovo mantiene
el alcance funcional descrito en el [registro local](DEMO-profesor-2026-11-19.md);
no sustituye la validación física del Ryzen.

## Acceso preparado

Se instaló la distribución ZIP oficial de Azure CLI **2.93.0** en
`.tools/azure-cli-2.93.0-x64`, sin modificar PATH global ni instalar un MSI.
Se comprobó la integridad interna del ZIP de 92.891.833 bytes y sus 13.476
entradas, SHA-256
`92a140542917fb9983784189f8cfc1c9986d525bb56267d497e3674ba7642dd6`.
`az version` devolvió 2.93.0 y ninguna extensión instalada. El hash es el
recibo del archivo descargado; no se presenta como una firma del editor.
Fuente del procedimiento: [instalación oficial](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-windows).

El directorio privado de autenticación está bajo
`.local/demo-azure-20261119/azure-config`, con ACL para el usuario local y
SYSTEM. El auxiliar `azure-login.ps1` solicita autenticación por dispositivo,
selecciona exclusivamente la suscripción mostrada por el usuario y consulta
su estado. El usuario completa personalmente el inicio de sesión; no se
solicitan contraseñas, tokens ni códigos MFA en el chat. El código temporal de
inicio no se copia a este registro.
Fuente: [autenticación interactiva de Azure CLI](https://learn.microsoft.com/en-us/cli/azure/authenticate-azure-cli-interactively).

`azure-readiness.mjs` prepara consultas de solo lectura a suscripción,
proveedor, inventario, políticas, modelos y cuotas, con recibos separados y
sin inferencia. El acceso WAM terminó correctamente: Azure CLI devolvió la
suscripción esperada en estado `Enabled`, aunque el usuario no vio una ventana.
Las consultas autenticadas ya comprobaron políticas, inventario y cuota.

### Rechazo del flujo por dispositivo

El primer código expiró sin completar el acceso. Con un código nuevo, el
usuario mostró un rechazo institucional: la cuenta se autenticó, pero no
cumplía los criterios de acceso al recurso. La captura no muestra el código
técnico ni identifica la política aplicada, por lo que no permite concluir
que toda la suscripción o Azure OpenAI estén bloqueados.

Se detuvo ese intento y se inició el acceso nativo de Windows mediante
`azure-login-interactive.ps1`, que usa `az login` con Web Account Manager.
Este segundo método terminó correctamente mediante la sesión disponible.
No se modificaron políticas, tenant, permisos ni estado del dispositivo.
No se renovaron códigos repetidamente ante el rechazo institucional.

Microsoft documenta que Conditional Access puede restringir específicamente
el flujo por dispositivo y que WAM es el inicio predeterminado de Azure CLI
en Windows. La causa concreta en esta cuenta sigue sin confirmarse.
Fuentes: [condiciones por flujo](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-authentication-flows),
[autenticación interactiva](https://learn.microsoft.com/en-us/cli/azure/authenticate-azure-cli-interactively)
y [diagnóstico de rechazos](https://learn.microsoft.com/en-us/entra/identity/conditional-access/troubleshoot-conditional-access).

### Región, cuota y perfil comprobados

Se registró `Microsoft.CognitiveServices`, requisito del recurso autorizado,
y se comprobó su estado `Registered`. La suscripción estaba sin recursos.
La política de ubicaciones permite Canadá Central, Sudáfrica Norte, Centro
Norte de EE. UU., Nueva Zelanda Norte y Chile Central. East US 2, propuesto
inicialmente, no está permitido y no se intentó crear allí ni alterar la política.

Las consultas del 19/11 a las 17:38 UTC en `northcentralus` muestran cuota cero
para GPT-4o y cuota disponible de 200 unidades de mil tokens/minuto para
`OpenAI.GlobalStandard.gpt4.1-mini`, además de 1000 para embeddings pequeños
Global Standard. El catálogo devuelve `gpt-4.1-mini` versión `2025-04-14`
como Legacy; la documentación pública lo describe como Deprecated. Se conserva
esa diferencia y la creación efectiva del deployment decide si es utilizable
en esta cuenta. No se solicita aumento de cuota.

El adaptador existente admite `gpt-4.1-mini-2025-04-14`, `o200k_base`,
Chat Completions v1 y JSON Schema estricto, sin cambiar presupuestos de tokens,
plazos ni lógica de revisión. Se verificaron precios Global Standard de
USD 0,0004/1000 tokens de entrada y USD 0,0016/1000 de salida; embeddings,
USD 0,00002/1000. El recibo público completo se conserva en
`public-retail-prices-northcentralus-gpt41mini.json`. Son tarifas de referencia,
no consumo observado. La modalidad global no garantiza procesamiento exclusivo
en la región del recurso.

Se crearon el grupo `rg-alunza-demo-20261119` y únicamente el recurso OpenAI S0
`alunza-demo-2d94aa86-20261119`. Ambos deployments devolvieron `Succeeded`:
`alunza-demo-generation`, GPT-4.1 mini `2025-04-14`, capacidad 60, y
`alunza-demo-embedding`, embeddings pequeños versión 1, capacidad 120.
Usan Global Standard de consumo y `NoAutoUpgrade`; las capacidades son
asignaciones dentro de la cuota existente, no unidades de capacidad aprovisionada.
La respuesta efectiva confirma que esta cuenta admite el modelo para el ensayo.
No se creó otro servicio ni se desplegó la aplicación.

El descriptor público validado fija las tarifas y perfiles efectivos. Su reserva
máxima es **25.854 microUSD (US$0,025854)**: ingestión 4800, calibración 40 y
funcional 21.014. Mantiene 25 llamadas máximas, incluidos los reintentos de
ingestión existentes y la ayuda reservada para la presentación. No es gasto
observado. Claves y caché de autenticación permanecen en archivos privados;
el descriptor y los informes no las contienen.

## Separación local y consumo

La demo TEST conserva su web 3300 y API 4300. Su listener privado de evaluación
se trasladó de 4401 a **4411**, mediante configuración del lanzador existente,
para liberar el puerto requerido por LAB-EVAL. Después del cierre y reinicio,
la salud aprobó y la auditoría conservó el mismo grant, corpus, doce recibos,
cero trabajos pendientes y la ayuda reservada sin consumir. No se cambió el
producto ni se duplicó el permiso de ayuda.

Se preparó LAB-EVAL como destino local independiente, web 3400, API 4400,
operaciones 4401, Auth 19421 y PostgreSQL 19422. Se comprobó que el destino no
existía antes de iniciar su creación aditiva; sus fixtures iniciales no
reemplazan datos de TEST o DEV. La API Azure no debe arrancar antes de tener
un perfil válido y los controles de consumo configurados.

El lote previsto contiene cuatro casos técnicos de calibración/validación,
cinco documentos incluyendo el apunte provisional y dos ayudas vinculadas
a intentos persistidos: ensayo y presentación. Las reservas deben incluir
embeddings, generación, revisión y los reintentos existentes de ingestión.
El máximo autorizado se comprueba en el registro antes de despachar llamadas;
una alerta de facturación no sustituye ese control.

La inicialización aditiva completó 29 migraciones, doce perfiles canónicos,
tres clases y diez ejercicios. La auditoría de las 14:22 de Santiago registró
cero intentos, ayudas, corridas o recibos en LAB-EVAL, y cero trabajos pendientes
en ambos destinos. TEST quedó READY; los puertos 3400, 4400 y 4401 de los
consumidores Azure permanecieron libres. El recibo está en
`operation/readiness-1795108932058.json`.

La web Azure se compiló en una copia privada de 101 archivos fuente, con sus
orígenes 3400/4400/19421. Los builds `.next` y `.next-e2e` originales se
conservaron. Los auxiliares de operación pasaron comprobación sintáctica, pero
el lanzador Azure no se ejecutó sin recurso, perfil y credencial reales.
El auxiliar de navegador aprobó siete controles offline; no se inició Chrome
ni se hicieron peticiones para este nuevo destino.

El preparador reducido aprobó diez pruebas offline y comprobación de formato.
Valida destino, corpus, vinculación de intentos, presupuesto, activación de
calibración y reintento enlazado al anterior. Reserva como máximo 25 llamadas
incluyendo los tres intentos existentes de ingestión. Con las tarifas públicas
provisionales de GPT-4o y embeddings, su techo calculado es US$0,136546; todavía
no es un plan autorizado para un recurso concreto ni consumo observado.
El recibo de pruebas está en `run-preparation/offline-check-receipt.json`.
El descriptor conserva campos pendientes y no se creó ningún expediente de
campaña real ni se ejecutó ingestión, calibración o ayuda Azure.

Los auxiliares privados se preparan en
`.local/demo-azure-20261119/run-preparation/`, `operation/` y `browser/`.
No deben ingerir documentos ni invocar modelos solo por importar o validar
su configuración. El corpus docente en revisión se conserva y el apunte
adicional sigue pendiente de validación humana.

## Estado de este corte

### Primer ensayo real: ingestión aprobada, calibración rechazada

El candidato `34906caac727372db8b611a19b3d6c7e158332b2d4829ec6c31ad065308617c7`
se congeló con inventario y preimágenes en `run-preparation/campaigns/azure-01`.
La API real arrancó en LAB-EVAL y persistió seis intentos: cuatro RUNTIME_ERROR
del contrato de calibración y dos FAILED_TEST para ensayo y presentación.
El manifiesto se autorizó mediante la función de mantenimiento existente.
Los cinco documentos terminaron READY, con bytes/versiones/hashes contrastados.

Las cuatro consultas de calibración devolvieron HTTP 200 y recibos completos,
pero el artefacto fue rechazado. El positivo de entrenamiento midió
0,416166972900952 y el reservado de validación 0,461707237493143. El algoritmo
fija el umbral en la distancia pertinente de entrenamiento, por lo que aceptó
cero positivos de validación. Los negativos midieron 0,7761449815 y
0,6905896866: ninguno se aceptó. La función existente reprodujo
`CALIBRATION_INVALID`; el worker detuvo la corrida sin publicar artefacto.
No fue un fallo de autenticación, cuota o transporte.

Se conservan los nueve recibos AZURE COMPLETED, 1050 tokens de entrada y
**25 microUSD (US$0,000025)** contabilizados con las tarifas del manifiesto.
No hubo generación, revisión, ayuda ni reintento. La cifra es cálculo del registro
con uso observado, no conciliación de la factura Azure.
`status-after-calibration-failure.json`, `calibration-diagnostic.json` y
`calibration-gate-analysis.json` preservan el resultado; no se alteran sus datos,
etiquetas ni autorizaciones.

### Revisión explícita de la muestra

El conjunto mínimo de un positivo y un negativo de entrenamiento fue insuficiente
para generalizar a la validación. Se prepara una segunda muestra técnica dentro
de la misma autorización global de US$5. Los cuatro casos ya observados pasan
explícitamente a desarrollo/calibración, se añaden cuatro positivos de funciones
y `return`, y otra tarea redacta cuatro casos inéditos de validación sin consultar
distancias ni entrenamiento. El apunte de demostración sigue en una clase aparte.
Las etiquetas son autorales provisionales; no equivalen a revisión docente.

Se congelarán contenidos y reservas antes de volver a medir. No se modifica el
algoritmo ni se introduce un umbral manual, ni se recicla validación observada como
si fuera nueva. El gasto ya registrado debe sumarse al máximo de la nueva reserva,
y no hay campañas automáticas hasta conseguir un resultado favorable. El segundo
perfil aún no se ha ejecutado; la ayuda Azure sigue sin habilitarse.

El perfil v2 contiene doce casos, trece documentos y dos ayudas como antes:
ocho casos de entrenamiento y cuatro de validación inédita. El archivo reservado
se congeló con SHA-256
`806592f0db93a1ad9a392e5200e8ba5f0fad07f231faaa9f51cc66dc1a70887a`.
Sus trece controles offline aprobaron. La reserva de 57 llamadas suma
33.614 microUSD; añadidos los 25 microUSD anteriores, el máximo acumulado es
**US$0,033639**. Aumenta el tamaño explícito de la muestra, no los límites por
llamada, el presupuesto global de US$5 ni los límites de ejecución estudiantil.
Los auxiliares y datos v1 se conservan; v2 está separado y sólo admite el nuevo
expediente `azure-02`, sin reemplazar el anterior.

Los auxiliares de operación conservan un cierre por propietario y una reanudación
de los ocho contenedores LAB-EVAL ya existentes, con identidad, imagen, etiquetas,
red y montajes comprobados. La inspección y siete guardas aprobaron sin reiniciar
contenedores; no se usa inicialización, seed ni reset para reanudar. El selector
de perfiles sólo admite los dos tipos explícitos de corpus y rechaza los demás.

### Segundo ensayo real y decisión para la presentación

La corrida `azure-02`, `b029d4bf-7364-49d0-bedf-6063d05f4f1b`, preparó
catorce intentos. Se alcanzó una cuota temporal de diez envíos dentro de su
ventana: se conservó `QUOTA_WAIT`, se esperó la ventana real y se reanudó el
mismo diario con las mismas claves, sin duplicar intentos ni ampliar cuotas.
La autorización durable fijó la reserva nueva y verificó los 25 microUSD previos.
Los trece documentos terminaron READY con hashes/versiones contrastados.

Las doce mediciones Azure terminaron correctamente. El umbral aprendido fue
**0,59446742328461**, que cubrió los seis positivos de entrenamiento.
Los positivos inéditos de validación midieron **0,643789670824993** y
**0,671026452469597**, y quedaron fuera; los negativos midieron
0,699841068722096 y 0,65058136064382. El artefacto volvió a ser rechazado por
`validationAccepted=0`, sin aceptaciones falsas. Se reprodujo el rechazo
localmente con la función existente, sin otra llamada al proveedor.

Una fuente insuficiente quedó más cerca que uno de los positivos pertinentes.
Por tanto, subir manualmente un único umbral para incluir ambos positivos
admitiría también ese negativo. No es una solución aceptable ni un problema
que se resuelva aumentando el presupuesto o la cuota de Azure.

La corrida quedó STOPPED sin artefacto, sin FUNCTIONAL, HELP, generación,
revisión generativa, reintento funcional ni ACK. No se ejecutó el auxiliar de
Chrome Azure porque faltaban sus precondiciones; sus nueve comprobaciones
offline no equivalen a una prueba de navegador real. No se abre otra campaña
para buscar un resultado favorable.

| Evidencia                           | Azure-01 | Azure-02 | Total de esta preparación |
| ----------------------------------- | -------: | -------: | ------------------------: |
| Documentos indexados                |        5 |       13 |                        18 |
| Intentos persistidos de preparación |        6 |       14 |                        20 |
| Llamadas Azure completas            |        9 |       25 |                        34 |
| Tokens de entrada observados        |     1050 |     2877 |                      3927 |
| Coste contabilizado, microUSD       |       25 |       69 |                        94 |
| Generaciones/revisiones de ayuda    |        0 |        0 |                         0 |

El total **US$0,000094** deriva de tokens observados y tarifas fijadas, con
redondeo por llamada; no es una conciliación de factura. No hubo llamadas
desconocidas, reintentos ocultos ni otros servicios contratados. Los modelos
están creados, pero la generación GPT-4.1 mini no quedó ensayada por la aplicación.

Para la presentación del 20/11 se mantiene el
[guion TEST comprobado](../guides/demo-profesor-guion.md), identificando
claramente su IA simulada. Se puede explicar el avance real de ingestión Azure
y el control que impidió habilitar ayuda sin calibración aceptada, sin mostrar
respuestas TEST como si provinieran de Azure.

El siguiente trabajo es revisar la representación de consulta de
`buildHelpQuery` y su relación con los fragmentos pedagógicos, junto con el
corpus y sus etiquetas. La comparación de distancias demuestra el problema de
separación; todavía no demuestra cuál modificación de recuperación lo resolverá.
Los casos ya medidos son evidencia de desarrollo. Una nueva evaluación debe
versionar el candidato y reservar validación inédita antes de consumir, manteniendo
el presupuesto acumulado y el mismo criterio de aceptación. La revisión docente
continúa pendiente y no fue reemplazada por etiquetas de agentes.

Evidencia privada: los dos directorios `run-preparation/campaigns/azure-01` y
`azure-02`, sus planes/manifiestos, preimágenes, diarios, logs de cada paso,
`status-after-calibration-failure.json`, `calibration-diagnostic.json` y
`calibration-gate-analysis.json`. La documentación de cierre es posterior a los
candidatos congelados; no se presenta el checkout documental final como idéntico
al de esas corridas.

### Cierre operativo verificado

La auditoría independiente de las 18:00:43 UTC confirmó ambos runs STOPPED,
18 fuentes READY, 20 intentos, 34 recibos completos, cero ayudas y cero trabajos
pendientes o consumos desconocidos. La API y web Azure terminaron normalmente,
sin errores de cierre; 3400/4400/4401 quedaron libres y el lock fue retirado por
su propietario. Los ocho contenedores LAB-EVAL, sus datos y los recursos Azure
se conservaron. No se ejecutarán más inferencias desde estas corridas detenidas.

TEST conserva web 3300 y API 4300 con HTTP 200, cero pendientes y la explicación
de presentación sin consumir: 0 de 1 operaciones y cero solicitudes para ese
intento. Su grant sigue vigente hasta el 20/11 a las 23:59 de Santiago.
Recibo: `operation/final-audit-azure-02.json`. El cierre documental aprobó
formato, `git diff --check` y 149 enlaces locales sin destinos faltantes.
