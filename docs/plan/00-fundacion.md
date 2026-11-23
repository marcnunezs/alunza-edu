# IMP-00 — Base ejecutable y reducción de incertidumbre

**Estado inicial: pendiente de implementación.** Esta fase prepara la base de desarrollo; no cierra requisitos de negocio. Véanse el [plan general](README.md), la [arquitectura](../../specs/05-arquitectura.md) y la [guía de fundación](../agent/02-fundacion-y-arquitectura.md).

Actualización 10/09/2026: IMP-00.01–IMP-00.04 cuentan con implementación y evidencia local en [el registro de fundación](../work/IMP-00-foundation.md). IMP-00.05 incorpora CI configurada y Cypress probado con servicios reales; la ejecución remota de GitHub Actions permanece pendiente. IMP-00.06–IMP-00.08 incorporan ensayos locales de ejecución y pgvector/IA, además de configuración desplegable condicionada a recursos y presupuesto autorizados. Véanse [CI/Cypress](../work/IMP-00.05-ci-y-cypress.md), [los ensayos y sus brechas](../work/IMP-00.06-08-ensayos.md) y [la matriz de control](09-control-y-trazabilidad.md). No se acredita Sandbox, Azure OpenAI ni preproducción remotos. Este corte no completa IMP-00 ni RF de negocio. La siguiente unidad de implementación es IMP-01.01, sin iniciarla en este encargo.

## Resultado que podremos demostrar

Desde una instalación limpia, levantar la web, la API y Supabase local con comandos documentados; comprobar conectividad real, una petición protegida permitida y otra denegada; ejecutar las primeras pruebas y builds. Disponer de evidencia inicial sobre la viabilidad del ejecutor y de las interfaces IA.

La pantalla inicial solo necesita navegación y estados técnicos honestos. El acceso protegido de esta fase verifica la infraestructura de identidad; la gestión completa de cuentas y permisos se entrega en IMP-01.

## Entradas y decisiones

- Inspeccionar el árbol, procesos y cambios previos. Al redactar este plan solo existen documentación y specs; las ocho skills nuevas sí están instaladas en el perfil local.
- Mantener Next.js en Vercel, NestJS en Azure Container Apps, Supabase, Vercel Sandbox y Azure OpenAI. El esquema de monorepo es una propuesta, no una obligación de instalar otro framework.
- Resolver empíricamente DEC-007: versiones exactas, gestor, lockfile, módulos y compatibilidad de tests. Revisar DEC-006 para el diccionario inicial y DEC-004 para contratos mínimos.
- Preparar ensayos para DEC-003/008/010 y una distribución ficticia incremental bajo DEC-012. No exigir resolver todas las decisiones del producto antes del primer build.
- Referencias de calidad: RNF-MAN-01/02/03/04, RNF-POR-01/03 y RNF-SEG-01/03. Sus garantías se amplían con cada capacidad posterior.

## Incrementos, en orden

Cada fila es una unidad de trabajo que puede encargarse por separado. Las rutas son entregables propuestos, que se adaptarán al repositorio real.

| ID | Trabajo y resultado observable | Artefactos previstos | Comprobación al terminar |
| --- | --- | --- | --- |
| IMP-00.01 | Inspeccionar el entorno y fijar una combinación compatible del stack, con formato de módulos y gestor único | Registro DEC-007; manifests mínimos y lockfile cuando se pruebe la combinación | Versiones locales/CI coherentes; prueba real de NestJS con Jest y build Next.js; discrepancias documentadas |
| IMP-00.02 | Crear workspace mínimo, web y API separadas; comenzar la estructura visual con navegación y estados técnicos | `apps/web`, `apps/api`, configuración TS y scripts de desarrollo/build | Arranque y compilación de ambas aplicaciones; navegador comunica un error real si la API no está disponible |
| IMP-00.03 | Levantar Supabase local y preparar la primera migración revisada, roles/grants y fixture mínimo de identidad | `supabase`, Compose, diccionario inicial y comandos de migración | Instalación vacía reproducible; rollback o avance correctivo definido; conexión real con rol limitado, sin depender de credenciales privilegiadas ordinarias |
| IMP-00.04 | Integrar web→NestJS→BD, configuración validada, salud, correlación, errores y autenticación mínima | Ruta real de salud/readiness y consulta protegida mínima; contratos públicos; `.env.example` | Acceso válido, JWT ausente/inválido, BD caída y variable requerida ausente; no secretos en respuesta o bundle |
| IMP-00.05 | Establecer CI y una primera prueba de recorrido, usando únicamente comandos que ya funcionen | `.github/workflows`, pruebas Jest pertinentes y smoke Cypress | Lint/formato, tipos, tests y builds fallan correctamente ante un defecto; GitHub Actions solo se declara verificado tras una ejecución real |
| IMP-00.06 | Ensayar el contrato del ejecutor local y la viabilidad productiva con programas ficticios mínimos | Prototipo acotado de supervisor/adaptador y registro DEC-003 | Bucle infinito, memoria total, exceso de salida, canal de control y acceso prohibido. Registrar qué garantiza Docker y qué falta probar en Sandbox |
| IMP-00.07 | Ensayar interfaces de embeddings/generación, schema de ayuda y recuperación mínima con corpus ficticio | Contratos y prueba técnica acotada para DEC-010; configuración propuesta | Rechazo de salida inválida; prueba de dimensión y llamada real a Azure cuando exista configuración autorizada; el doble de prueba queda identificado |
| IMP-00.08 | Preparar el camino de preproducción y ejecutar smoke remoto temprano si hay acceso autorizado; cerrar instrucciones de arranque | Configuración desplegable de web/API, matriz de variables/servicios y evidencia por entorno | Web→API→datos real; conectividad Azure→Sandbox/Azure OpenAI cuando esté disponible; regiones, tiempos/costos observados y pendientes explícitos |

## Detalle de las decisiones técnicas

### Compatibilidad antes de generar el proyecto

La [guía oficial de NestJS](https://docs.nestjs.com/migration-guide), consultada el 10/09/2026, distingue los requisitos del runtime de los generadores, trata los paquetes ESM y señala nuevos valores por defecto de pruebas. Por ello IMP-00.01 debe comprobar la combinación con **Jest**, conservando la línea base, antes de propagar una configuración a todo el repositorio. No basta instalar dependencias sin ejecutar build y test.

Comprobar también React 19, TypeScript 5.x, la versión concreta de Next.js, Tailwind/shadcn/ui, los SDKs que se incorporen y el PostgreSQL/pgvector real del entorno. No instalar hoy todos los paquetes de fases futuras: fijarlos cuando tengan un consumidor, manteniendo el mismo lockfile.

### Modelo inicial y ruta protegida

Preparar un diccionario revisable de organizaciones, perfiles y membresías, y una primera migración local bajo el estado real de DEC-006. Las decisiones de permisos no resueltas no se codifican como acceso global. La consulta de prueba debe usar JWT real de Supabase local y datos ficticios; un token constante en el código no demuestra autenticación.

Las [políticas RLS de Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security) complementan la autorización de NestJS. El ensayo tiene que ejecutarse con el rol que utilizará la aplicación, incluyendo contexto por transacción; probar como propietario o con privilegios de bypass no demuestra el aislamiento requerido.

### Dos ensayos acotados, con resultado técnico

El ensayo de ejecución debe responder si se puede supervisar el proceso completo, terminar su árbol, limitar recursos y proteger el protocolo de resultados. La [documentación de Vercel Sandbox](https://vercel.com/docs/sandbox) sirve para configurar el adaptador, pero sus garantías de infraestructura no sustituyen los límites internos del programa. Evitar construir todavía todo el editor o banco para descubrir ese riesgo.

El ensayo IA debe responder qué configuración se necesita, cómo se valida la salida y cómo se detectan falta de evidencia y caída de proveedor. No necesita un intento estudiantil porque prueba el adaptador/ingestión de forma aislada; en el flujo de ayuda de producto seguirá siendo obligatorio persistir el intento antes de invocar IA/RAG para él.

Ambos ensayos terminan en evidencia y una decisión o brecha concreta. Una prueba fallida no habilita sustituir silenciosamente proveedor o familia de stack. No ampliar indefinidamente el prototipo: continuar con las capacidades no afectadas y mantener bloqueada solo la integración que no pueda demostrarse.

### Servicios y accesos

Preparar una matriz con consumidor, ambiente y responsable de configuración para Vercel, Azure Container Apps, Supabase, Sandbox y Azure OpenAI. Distinguir claves públicas de secretos de API/worker y credenciales de administración. Preferir valores ficticios en ejemplos, validar configuración al arrancar y separar preview de producción.

La fase permite preparar archivos desplegables. Para crear recursos, gastar cuota o publicar, aplicar la autorización vigente. Si falta acceso, cerrar la base local y marcar el ensayo remoto **pendiente**, con el comando/configuración necesarios; no declararlo integrado. Volver a comprobar la integración completa en IMP-03/04/07, porque un smoke inicial no acepta esos RF.

## Criterios de cierre

- [ ] Otra sesión reproduce instalación, migración local, arranque y build con los comandos entregados.
- [ ] La web consume NestJS y existe evidencia real de BD, acceso permitido y rechazo.
- [ ] Configuración, errores y logs no filtran secretos; dominio y paquetes del navegador están separados.
- [ ] Hay tests útiles ejecutados, scripts válidos y CI configurada; el estado remoto de CI se declara con precisión.
- [ ] Cada ensayo tiene entrada, salida, medidas observadas y decisión/pendiente, sin convertirlo en un RF terminado.
- [ ] La preproducción tiene preparación concreta y estado de prueba explícito; las dependencias remotas no demostradas permanecen abiertas.
- [ ] DEC-007 y el diccionario inicial tienen evidencia suficiente para empezar IMP-01, con supuestos reversibles identificados.

## Qué sigue y cómo encargar el inicio

La siguiente fase es [IMP-01 Identidad](01-identidad-y-aislamiento.md). No se implementan todavía publicación, señales ni ayuda pedagógica completa.

Para empezar poco a poco, encargar primero **IMP-00.01 a IMP-00.04**, luego **IMP-00.05**, y después los ensayos **IMP-00.06 a IMP-00.08**. Son grupos de trabajo, no estimaciones de días ni permisos adicionales automáticos.

```text
Implementa únicamente IMP-00.01 a IMP-00.04 del plan docs/plan/00-fundacion.md.
Lee AGENTS.md, inspecciona el repositorio y reutiliza lo existente. Conserva el
stack, verifica compatibilidad real y entrega una base local web/API/datos con
acceso permitido y denegado, comandos reproducibles y pruebas pertinentes.
Registra decisiones y límites con evidencia; no marques RF de negocio completos.
Al cerrar este incremento, detén la ampliación de alcance y reporta el resultado
y la siguiente unidad pendiente. No comiences otras fases.
```
