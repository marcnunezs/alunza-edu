# Skills recomendadas para desarrollar Alunza

Selección revisada el **10 de septiembre de 2026**, contrastando los specs, el catálogo de skills disponible en esta sesión, archivos `SKILL.md` locales y repositorios de sus autores. Tras la solicitud del usuario, **se instalaron ocho skills nuevas** en el perfil local de Codex. El registro de revisiones y verificaciones figura al final; no se inició la implementación de Alunza.

## Selección inicial

Aprovecha las skills de Next.js, shadcn/ui, React y Supabase que ya están disponibles. La base se completó con **`nestjs-best-practices`, `cypress-author`, `cypress-docs` y `security-best-practices`**. También se instalaron las cuatro opciones de Azure, revisión de amenazas y diagnóstico de CI de la tabla de tareas específicas; cárgalas cuando la tarea las necesite.

La prioridad y el encaje con Alunza son una evaluación de este proyecto. Que una skill sea oficial o esté instalada no acredita que la aplicación cumpla sus requisitos ni que sus herramientas estén configuradas. Los ejemplos deben comprobarse contra las versiones elegidas en DEC-007.

Lee [AGENTS.md](../../AGENTS.md) y la [guía del área](README.md) antes de aplicar recomendaciones externas. Las skills aportan procedimientos técnicos; los [specs de arquitectura](../../specs/05-arquitectura.md) conservan las responsabilidades y los contratos de Alunza.

## Skills ya disponibles

Disponibilidad observada en los plugins locales **Vercel 0.21.4** y **Supabase 1.0.0**. Se revisaron sus archivos principales; no se ejecutaron las integraciones remotas.

| Skill exacta | Uso en Alunza | Límite o adaptación |
| --- | --- | --- |
| `vercel:nextjs` | App Router, layouts, estados de carga/error y separación Server/Client en `apps/web` | NestJS conserva la API de dominio. Los ejemplos de Server Actions y Route Handlers no trasladan operaciones de negocio a Next.js |
| `vercel:shadcn` | Formularios, diálogos de confirmación, tablas y componentes accesibles | Ajustar al diseño y mockups del proyecto; los valores visuales por defecto de la skill no son decisiones aprobadas |
| `vercel:react-best-practices` | Revisar TSX, carga del editor, peticiones y renderizados | Evitar cachés que compartan datos privados entre ámbitos; no introducir dependencias por aparecer en un ejemplo |
| `supabase:supabase` | Auth, JWT, RLS, Storage y configuración de claves | La autorización debe comprobar estado, rol, organización y clase. Una política de propietario aislada no cubre el modelo institucional |
| `supabase:supabase-postgres-best-practices` | Índices, transacciones, pooling, consultas y rendimiento de RLS | Conservar aislamiento e integridad; comprobar resultados en PostgreSQL/pgvector reales y mantener migraciones versionadas |
| `vercel:verification` | Seguir un flujo desde UI hasta API y persistencia | Complementar Jest/Cypress; corregir y volver a comprobar los fallos dentro de la tarea autorizada |
| `vercel:agent-browser`, `vercel:agent-browser-verify` | Inspección visual, consola, formularios y navegación del servidor local | Requieren herramientas de navegador disponibles; no sustituyen la suite Cypress ni la comprobación de accesibilidad |
| `vercel:env-vars` | Variables públicas/servidor, preview y producción de la web | Su ámbito es Vercel. Revisar archivos y destinos antes de sobrescribir configuración local |
| `vercel:deployments-cicd`, `vercel:vercel-cli` | Build, preview, despliegue y rollback de `apps/web` | Mantener NestJS en Azure Container Apps y verificar la autorización vigente para publicar |
| `vercel:vercel-sandbox` | Referencia parcial de creación, destrucción y credenciales del SDK | El cuerpo instalado se centra en Chromium/agent-browser. No proporciona el supervisor estudiantil requerido por Alunza |

Para localizar las fuentes de esta revisión, usa el catálogo del agente. En este entorno se encuentran bajo estas rutas, donde `<nombre>` es la parte posterior a `vercel:` o `supabase:`:

```text
$CODEX_HOME/plugins/cache/openai-curated-remote/vercel/0.21.4/skills/<nombre>/SKILL.md
$CODEX_HOME/plugins/cache/openai-curated-remote/supabase/1.0.0/skills/<nombre>/SKILL.md
```

Son ubicaciones de referencia de esta sesión, no rutas que deba crear el repositorio. Si cambia la versión del plugin, vuelve a localizar y leer su skill.

### Límites importantes de la selección instalada

El ejecutor de Alunza exige dos capas de recursos y protección de pruebas ocultas. Los ejemplos de navegador de `vercel:vercel-sandbox` usan tiempos de 120/300 segundos y no implementan los límites estudiantiles de 128 MB, 3 segundos totales y 64 KB de salida. Tampoco resuelven por sí solos la autenticación de la llamada desde Azure. Usa la [guía de ejecución segura](06-ejecucion-segura.md) y valida el supervisor con evidencia real.

La guía general de Supabase no cambia el diseño de acceso: NestJS concentra el dominio; las consultas usan identidad verificada y el rol de aplicación no evade RLS. Conserva los controles de [datos y migraciones](04-datos-y-migraciones.md) y [seguridad](09-seguridad-y-permisos.md), incluso cuando un ejemplo externo opere directamente desde el navegador.

## Skills prioritarias instaladas

Estas cuatro skills se instalaron con sus carpetas de soporte completas. Los enlaces de esta tabla apuntan a la rama principal de su autor; el registro final identifica los commits exactos instalados. La instalación pertenece al perfil local, por lo que otro equipo deberá reproducirla.

| Skill y procedencia | Aporte concreto | Aplicación y límites |
| --- | --- | --- |
| [nestjs-best-practices](https://github.com/Kadajett/agent-nestjs-skills/blob/main/skills/nestjs-best-practices/SKILL.md) — Kadajett, comunitaria, versión declarada 1.2.0 | Módulos, inyección de dependencias, guards, errores, transacciones y pruebas del backend | Desde IMP-00/01. No declara una matriz que certifique NestJS 12/Node 24; verificar DEC-007. Los ejemplos de ORM, microservicios o colas no deciden nuevas dependencias |
| [cypress-author](https://github.com/cypress-io/ai-toolkit/blob/main/skills/cypress-author/SKILL.md) — Cypress, oficial, versión declarada 1.0.1 | Crear y corregir pruebas E2E y de componentes siguiendo el proyecto existente | Desde el primer flujo funcional. Delimitar RF/HU/escenarios y conservar pruebas de integración reales. No usarla para sustituir pruebas unitarias Jest |
| [cypress-docs](https://github.com/cypress-io/ai-toolkit/blob/main/skills/cypress-docs/SKILL.md) — Cypress, oficial, versión declarada 1.0.0 | Verificar comandos, configuración y comportamiento en documentación oficial | Compañera de `cypress-author`; proporcionar la versión real del proyecto para evitar asumir la última estable |
| [security-best-practices](https://github.com/openai/skills/blob/main/skills/.curated/security-best-practices/SKILL.md) — catálogo oficial de OpenAI | Desarrollo seguro y revisión de JavaScript/TypeScript con referencias por framework | Invocarla al pedir expresamente código seguro o una revisión de seguridad. Complementa los controles institucionales y del ejecutor; no acredita una auditoría especializada de esos componentes |

La documentación de [Cypress AI Skills](https://docs.cypress.io/app/tooling/ai-skills) confirma su publicación y uso por agentes. Para Alunza, el primer par aporta autoría y consulta técnica sin exigir adoptar Cypress Cloud. Los tests generados siguen necesitando ejecución y revisión contra los escenarios del proyecto.

La skill de NestJS incluye una [regla de pruebas con TestingModule y Jest](https://github.com/Kadajett/agent-nestjs-skills/blob/main/skills/nestjs-best-practices/rules/test-use-testing-module.md). Sirve como apoyo al backend; la [guía de pruebas de Alunza](10-pruebas-y-evidencias.md) determina qué comprobar y qué evidencia conservar.

## Opciones para tareas específicas

Las siguientes cuatro skills también quedaron instaladas. No es necesario cargarlas todas para comenzar; sus credenciales, herramientas y recursos externos se configuran cuando corresponda a la tarea.

| Skill y fuente | Cuándo aporta valor | Condiciones |
| --- | --- | --- |
| [security-threat-model](https://github.com/openai/skills/blob/main/skills/.curated/security-threat-model/SKILL.md) — OpenAI | Revisión explícita de amenazas: aislamiento institucional, código no confiable, archivos y RAG | Distinguir arquitectura prevista de controles implementados. Su procedimiento incluye validar supuestos con el usuario antes del informe final |
| [azure-identity-ts](https://github.com/microsoft/skills/blob/main/.github/plugins/azure-sdk-typescript/skills/azure-identity-ts/SKILL.md) — Microsoft | Credenciales de servicio y managed identity del backend hacia Azure | Aplicar si se elige autenticación con Azure Identity. No reemplaza Supabase Auth ni agrega SSO para estudiantes o profesores |
| [azure-diagnostics](https://github.com/microsoft/azure-skills/blob/main/skills/azure-diagnostics/SKILL.md) — Microsoft | Diagnóstico de Container Apps: arranque, descarga de imágenes, puertos, probes y logs | Útil al desplegar u operar. Requiere recursos identificados y acceso a CLI/MCP apropiado; no construye la API NestJS |
| [gh-fix-ci](https://github.com/openai/skills/blob/main/skills/.curated/gh-fix-ci/SKILL.md) — OpenAI | Investigar checks fallidos de un PR en GitHub Actions | Requiere `gh` autenticado y logs accesibles. Su flujo pide aprobación antes de implementar; comprobar primero si la solicitud vigente ya autoriza la reparación |

Para preparar despliegues Azure existe [azure-prepare](https://github.com/microsoft/azure-skills/blob/main/skills/azure-prepare/SKILL.md). Su descripción limita el uso a una elección explícita de Azure Developer CLI (`azd`) o a un proyecto con `azure.yaml`. Como Alunza aún no ha decidido ese flujo, queda como candidata condicional. No debe introducir por sí sola otra plataforma de datos ni desplegar el frontend fuera de Vercel.

No se identificó en esta búsqueda una skill oficial que cubra de forma suficiente el adaptador **Azure OpenAI en TypeScript más el RAG pedagógico de Alunza**. Mantén la [guía de IA y RAG](07-ia-y-rag.md) como instrucción específica, y verifica el SDK, modelos, embeddings y autenticación al implementar. Una skill de Foundry Projects o agentes no equivale al contrato de ayuda del MVP.

## Selección por tarea para el agente

Consulta solo las skills pertinentes que estén disponibles. Una candidata no instalada no bloquea el trabajo: usa la guía de Alunza y documentación oficial, e informa de la limitación si afecta el resultado.

| Trabajo | Skills que conviene cargar | Guía de Alunza |
| --- | --- | --- |
| Fundación y API NestJS | `nestjs-best-practices`; `vercel:nextjs` cuando afecte a la web | [Fundación](02-fundacion-y-arquitectura.md), [backend](03-backend-y-api.md) |
| Identidad, esquema y RLS | Las dos skills de Supabase; `security-best-practices` para una tarea explícita de seguridad | [Datos](04-datos-y-migraciones.md), [permisos](09-seguridad-y-permisos.md) |
| Pantallas por rol y editor | `vercel:nextjs`, `vercel:shadcn`, `vercel:react-best-practices` | [Frontend y UX](05-frontend-y-ux.md) |
| Práctica y ejecución | `nestjs-best-practices`; Sandbox solo como referencia parcial del SDK | [Ejecución segura](06-ejecucion-segura.md) |
| Integración Azure OpenAI y RAG | `azure-identity-ts` si corresponde a la autenticación elegida; skills de Supabase para persistencia | [IA y RAG](07-ia-y-rag.md) |
| Pruebas de flujos y regresiones | `cypress-author`, `cypress-docs`, `vercel:verification` | [Pruebas y evidencias](10-pruebas-y-evidencias.md) |
| Entrega y operación | `vercel:env-vars`, `vercel:deployments-cicd`, `vercel:vercel-cli`; diagnóstico Azure o CI según el fallo | [Operación y entrega](11-operacion-y-entrega.md) |

## Cómo reproducir o actualizar la instalación

1. Selecciona la skill por su nombre y repositorio exactos. Evita instalar un catálogo completo para conseguir una sola capacidad.
2. Vuelve a comprobar el `SKILL.md`, referencias, scripts y requisitos de herramientas de la revisión que se vaya a instalar. Registra su commit o versión; los enlaces a `main` pueden cambiar.
3. Usa el instalador de skills del agente con la carpeta completa. Copiar solo `SKILL.md` puede dejar referencias o subskills ausentes. Comprueba después que aparezca disponible para la sesión.
4. Aplica las instrucciones del usuario y los permisos del entorno. Una skill no autoriza publicaciones, servicios adicionales ni cambios de arquitectura; tampoco obliga a repetir una aprobación ya concedida.
5. Pruébala en una tarea pequeña con un resultado verificable. Por ejemplo, un módulo NestJS y su prueba, o un recorrido Cypress asociado a un escenario. Registra los resultados reales.

Las carpetas exactas de las cuatro skills prioritarias son:

| Repositorio | Carpeta de la skill |
| --- | --- |
| `Kadajett/agent-nestjs-skills` | `skills/nestjs-best-practices` |
| `cypress-io/ai-toolkit` | `skills/cypress-author` |
| `cypress-io/ai-toolkit` | `skills/cypress-docs` |
| `openai/skills` | `skills/.curated/security-best-practices` |

## Capacidades que siguen siendo propias del proyecto

La protección de tests ocultos, el supervisor con límites totales, la autorización institucional, los estados RAG exactos y las fórmulas de progreso/señales necesitan las guías de Alunza y sus pruebas. No se encontró una skill genérica que las resuelva conjuntamente. En particular, las skills de Expo/React Native, proveedores de identidad alternativos, Vercel AI Gateway y agentes de producto no forman parte de esta selección: no corresponden a la línea base actual.

## Registro de instalación

Instalación completada el **10 de septiembre de 2026** mediante `skill-installer`, en `C:/Users/Lenovo/.codex/skills/`. Cada descarga utilizó el commit completo indicado por su enlace, en lugar de una rama móvil. Se conservaron las skills preexistentes.

| Skill | Revisión de origen instalada | Archivos instalados |
| --- | --- | --- |
| `nestjs-best-practices` | [3986e0cede33](https://github.com/Kadajett/agent-nestjs-skills/tree/3986e0cede33958e000f959031cbee0cd83c2941/skills/nestjs-best-practices) | 43 |
| `cypress-author` | [005d8ae7545b](https://github.com/cypress-io/ai-toolkit/tree/005d8ae7545b3fe61cf9764557ce4d105d4af01b/skills/cypress-author) | 8 |
| `cypress-docs` | [005d8ae7545b](https://github.com/cypress-io/ai-toolkit/tree/005d8ae7545b3fe61cf9764557ce4d105d4af01b/skills/cypress-docs) | 1 |
| `security-best-practices` | [49f948faa925](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/security-best-practices) | 13 |
| `security-threat-model` | [49f948faa925](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/security-threat-model) | 5 |
| `gh-fix-ci` | [49f948faa925](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/gh-fix-ci) | 6 |
| `azure-identity-ts` | [cf77b1efbf31](https://github.com/microsoft/skills/tree/cf77b1efbf3117501f4727c476894751311ee885/.github/plugins/azure-sdk-typescript/skills/azure-identity-ts) | 3 |
| `azure-diagnostics` | [6be6587fe52e](https://github.com/microsoft/azure-skills/tree/6be6587fe52e6e5bfbb5a1d37fef68f0a81bb181/skills/azure-diagnostics) | 51 |

Verificación realizada: ocho instalaciones exitosas, 130 archivos presentes, nombre y descripción en cada cabecera, referencias locales directas de los ocho `SKILL.md` resueltas y contenido de cada archivo principal idéntico al de su commit remoto. También se revisaron las referencias internas de `cypress-author` y `azure-diagnostics`, sin dependencias documentales faltantes fuera de sus carpetas.

Codex podrá descubrir las skills nuevas en el siguiente turno posterior a la instalación. No se instalaron SDKs de aplicación, no se configuraron credenciales y no se ejecutaron los scripts operativos de las skills. Sus prerrequisitos de uso siguen indicados en las tablas. `azure-prepare` permanece como candidata condicional sin instalar, porque todavía no se eligió el flujo `azd`.

Esta verificación acredita la instalación de instrucciones y recursos. No certifica compatibilidad de sus ejemplos con una aplicación todavía por construir.
