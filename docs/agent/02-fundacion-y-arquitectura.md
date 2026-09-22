# Fundación técnica y arquitectura

Usa esta guía al crear la base del proyecto o cambiar dependencias, módulos o fronteras entre servicios. Lee [arquitectura](../../specs/05-arquitectura.md), [operación](../../specs/11-operacion-y-despliegue.md) y DEC-004/006/007 en [decisiones](12-decisiones-pendientes.md).

## Inspecciona antes de generar

Busca manifests, workspace, lockfile, configuración TypeScript, scripts, infraestructura y convenciones ya existentes. Continúa esa base si satisface el contrato. No ejecutes un generador sobre la raíz para reemplazar archivos ajenos o documentación.

Si no existe código, prepara una estructura mínima siguiendo los módulos de los specs. Genera en una ruta acotada y revisa los archivos antes de integrarlos. No crees carpetas vacías para todas las funciones futuras ni implementaciones ficticias para hacer pasar el build.

## Fija las versiones

Conserva las familias documentadas: Node.js 24 LTS, NestJS 12, React 19, TypeScript 5.x, Next.js App Router, Tailwind CSS, shadcn/ui, Recharts y Zod; Supabase con objetivo PostgreSQL 17/pgvector; Jest, Cypress y GitHub Actions. La familia documentada no prueba compatibilidad de cualquier patch.

Antes de instalar, verifica versiones y restricciones de las dependencias afectadas en documentación oficial vigente, usando las herramientas permitidas. Fija una combinación concreta y un lockfile. Revisa el formato de módulos y compatibilidad Jest/Nest; no aceptes herramientas diferentes por defecto del generador sin una decisión explícita que preserve el requisito o registre su cambio.

Si existe gestor de paquetes y lockfile, consérvalos. Si no, elige uno compatible como decisión técnica reversible y documenta la elección; no mantengas varios lockfiles. No instales herramientas globales ni cambies el entorno del usuario sin necesidad de la tarea.

Si una versión requerida es incompatible o ya no está soportada al implementar, demuestra el problema, acota el impacto y tramita la decisión conforme a DEC-007. No escondas el cambio usando una versión distinta en Docker, CI y local.

## Crea responsabilidades claras

Usa como punto de partida la estructura propuesta, ajustándola al árbol real:

```text
apps/web/               Next.js: rutas, componentes y sesión
apps/api/               NestJS: dominio, autorización y orquestación
packages/contracts/     DTO y esquemas públicos
packages/domain/        Reglas puras reutilizables si hace falta compartirlas
packages/runner/        Supervisor, protocolo y adaptadores
supabase/               Migraciones, permisos y pruebas de BD
fixtures/demo/          Datos ficticios y corpus versionado
tests/                  Integración y recorridos E2E
infra/                  Configuración de entorno y despliegue
```

Estas rutas no prescriben un framework adicional de monorepo. Evita una abstracción compartida si solo tiene un consumidor y no resuelve un problema real.

En NestJS separa controlador/DTO, caso de uso, reglas de dominio y adaptadores. El controlador valida y delega; no concentra SQL, SDKs externos, autorización informal y cálculo de negocio en una misma función. Las reglas de progreso/señales deben probarse con reloj y datos controlados sin red ni LLM.

En Next.js conserva la presentación y gestión de sesión. Un callback de Auth o una capa de transporte no se convierte en una segunda API de dominio. Las acciones de organización, publicación, envío y seguimiento deben usar los mismos casos de uso y permisos en NestJS.

## Implementa puertos antes de integrar proveedores

Define interfaces mínimas para ejecución, almacenamiento, embeddings y generación. Incluye cargas, respuestas, errores, cancelación/plazos y correlación necesarios; evita una interfaz genérica que permita ejecutar comandos o SQL arbitrarios.

Mantén secretos, tests ocultos y tipos internos fuera del paquete importable por el navegador. Exporta DTO públicos construidos mediante proyección explícita. Un tipo TypeScript no valida entradas de red: usa schemas/validadores también en runtime.

Los adaptadores Docker y Vercel Sandbox deben cumplir un mismo contrato funcional. Los dobles de prueba se seleccionan explícitamente en tests/local y nunca se activan como fallback silencioso productivo. Azure OpenAI sigue siendo proveedor inicial aunque uses un doble para probar errores.

## Prepara contratos y configuración

1. Fija los catálogos cerrados de los specs en una ubicación única de contrato. Mantén separados los estados de trabajo, diagnóstico, actividad, RAG y señal.
2. Define DTO de la primera vertical, schemas estrictos, proyección pública y mapping de columnas. Resuelve fechas de clase y período académico antes de serializarlos.
3. Valida configuración al iniciar y crea `.env.example` sin secretos reales, con comentario de consumidor y sensibilidad.
4. Configura la conexión de dominio con rol limitado y contexto transaccional conforme a [datos](04-datos-y-migraciones.md). La clave privilegiada no es un acceso general para requests.
5. Implementa correlación de requests y manejo de errores seguros. Distingue infraestructura fallida de resultados del programa del estudiante.
6. Implementa salud mínima. Define disponibilidad de BD como requisito de escritura y degradación de IA como capacidad separada.
7. Publica un esquema de API verificable cuando existan rutas reales, generado o mantenido con los DTO de implementación. No entregues documentación OpenAPI que prometa endpoints vacíos.

## Construye una primera comprobación vertical

Levanta web/API y Supabase local mediante scripts existentes o recién implementados. Aplica una migración inicial revisada y un fixture ficticio mínimo. Comprueba un endpoint protegido permitido y uno denegado contra API/BD reales de prueba. Después conecta la interfaz correspondiente.

Incluye desde el inicio instalación reproducible, lint/formato, tipos, prueba unitaria pertinente y build. La base de CI ejecuta lo que existe; no usa pruebas vacías, fallos tolerados o servicios falsos para declarar preparación completa.

## Aceptación de la fundación

Entrega configuración consistente entre local y CI, paquetes fijados, separación de secretos y contratos públicos, web/API arrancables, migraciones iniciales verificadas y una ruta protegida comprobada. Registra comandos y resultados reales con sus limitaciones.

El código generado no acredita seguridad, cumplimiento de los 27 RF ni despliegue remoto. Continúa con la fase autorizada del [plan](01-plan-de-implementacion.md) cuando la fundación sea suficiente; no sobrediseñes infraestructura antes del flujo de producto.
