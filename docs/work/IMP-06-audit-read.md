# IMP-06.05 — Registro de implementación y verificación

Estado al 02/11/2026 (Santiago): **IMP-06.05 implementado y verificado localmente**. Alcance y autorización en el [plan](IMP-06-audit-read-plan.md); contrato en el [diccionario](IMP-06-audit-read-dictionary.md). Esta nota no acredita aceptación humana ni remota.

## Base y conservación

Checkout `laboratorio` con 327 entradas modificadas/no rastreadas al iniciar. Se preservan cambios anteriores, evidencia Office, servicios DEV y servicios de otros proyectos. El cierre .04 sigue pendiente por su protocolo propio; no se ejecutan campañas PHASE, ON/OFF, ABBA ni CI integral.

La shell inicial tenía Node 24.14.0/npm 11.9.0; los checks usan `scripts/use-node.ps1` para activar Node 24.21.0/npm 11.19.0 solo en la sesión. No se cambian dependencias ni lockfile.

## Pruebas

Verificación local por Codex el 02/11/2026, sobre el checkout con cambios sin commit. Entorno Windows, Node 24.21.0/npm 11.19.0, Supabase CLI 2.101.0/PostgreSQL local y Docker 29.7.2. Auth, NestJS y persistencia reales en LAB TEST; sin invocaciones a proveedores remotos.

| Comando / foco                                        | Resultado observado                                                                                                                                                                                                                      |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                   | Aprobado, incluidos los tipos de Cypress.                                                                                                                                                                                                |
| `npm run lint` y `npm run format:check`               | Aprobados; tipos y lint repetidos después del último ajuste visual. Formato final comprobado tras actualizar este registro.                                                                                                              |
| `npm test`                                            | 2.490 pruebas aprobadas: API 918, web 106, contratos 230, runner 211, IA 378 y preproducción 647.                                                                                                                                        |
| `npm run test -w @alunza/web`, después de los ajustes | 107/107 aprobadas, incluidas las 6 de auditoría. La nueva regresión conserva espacios en acción/tipo y recorta solo UUID. Total vigente de unidades/contratos: 2.491, combinando esta revalidación con las suites generales sin cambios. |
| `npm run test:audit:integration`                      | 9/9 HTTP y 1.419 aserciones pgTAP en 21 archivos, incluidas las 108 nuevas de auditoría. Cinco registros operativos reales correlacionados, con allowlist y sin ámbito solicitado no autorizado.                                         |
| `npm run test:audit:upgrade`                          | Aprobado: migración .04→.05; readiness 503→200; lectura autenticada y auditoría de mutación pública conservadas.                                                                                                                         |
| `npm run test:e2e -- --audit`                         | Repetición final: 8/8 aprobados en Chrome 156.0.8078.80/Cypress 16.0.0; build completo y revisión de artefactos aprobados. Capturas de formulario y tabla revisadas en escritorio, tableta y móvil.                                      |
| `npm run test:audit:performance`                      | Aprobado: 150 muestras válidas y tres primeras peticiones separadas; cero errores y huella de candidato conservada durante la medición.                                                                                                  |

El upgrade conserva los digests de auditoría/membresías y de evidencia pedagógica, incluidos 26 eventos del ámbito de auditoría, 8 intentos, 4 ayudas, 2 episodios y 1 revisión histórica. No crea historia ficticia. Informes locales: `.local/reports/imp-06/audit-integration.json` y `audit-upgrade.json`; salida unitaria: `.local/audit-unit-checks.log` y revalidaciones `.local/audit-final-*.log`.

### Rendimiento y capturas

Perfil local: 10.000 eventos A y 1.000 B, página de 20, concurrencia 1, 50 muestras por superficie, p95 nearest-rank y cero errores. API reiniciada antes de cada superficie, primera petición separada; navegador con build productivo y servicios iniciados, primera navegación separada. Ninguna primera muestra se denomina arranque frío de toda la plataforma.

| Superficie                       | Primera muestra (ms) | Muestras posteriores | p95 (ms) | Errores |
| -------------------------------- | -------------------- | -------------------- | -------- | ------- |
| API, primera página              | 50,15                | 50                   | 20,89    | 0       |
| API, segunda página              | 76,05                | 50                   | 18,73    | 0       |
| API, filtros combinados          | 41,77                | 50                   | 14,15    | 0       |
| Navegación hasta tabla con datos | 224,00               | 50                   | 394,50   | 0       |

Todas las superficies cumplen el umbral local <3.000 ms. Los informes conservan cada muestra, no solo el percentil: `.local/reports/imp-06/audit-api-performance.json`, `audit-ui-performance.json` y `e2e-audit.json`. La huella global de la medición API fue `f83fd3551b7cd4b7e224b79199879a7569248f78b919862ad77c4ca8d57844be`, igual antes/después. La actualización posterior afecta únicamente documentación de cierre; no hubo cambios de código tras esa medición. Su sello UTC es 03/11/2026 00:00:10, aún 02/11 en Santiago.

Las tres capturas de tabla tienen 1440×900, 768×1024 y 390×844, comprobadas en `audit-ui-screenshots.json`; las tres capturas adicionales muestran la cabecera y el formulario completos. Archivos en `.local/evidence/imp-06/screenshots/audit.cy.ts/`, prefijos `imp06-audit-` e `imp06-audit-filters-`. Revisión visual del agente: etiquetas legibles, campos sin desbordamiento global y resultado traducido con código original, sin duplicación de valores desconocidos. La tabla conserva desplazamiento horizontal accesible por teclado.

### Trazabilidad del alcance

| Criterio                            | Evidencia del incremento                                                                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF/HU/CU/PT-027, E1 en consulta     | Filtros exactos, ocho campos, corte inclusivo y paginación comprobados por contratos, SQL, HTTP y `IMP06-AUDIT-01`. La parte CSV continúa pendiente.                                           |
| HU-027-E2 en consulta               | Fechas, tipos, parámetros, límite de página y cursores inválidos rechazados; recuperación en `IMP06-AUDIT-02`. Límite de exportación pertenece a .06.                                          |
| HU-027-E3; RNF-SEG-03/05            | Roles/estados reales, ámbito antes de conteo, proyección cerrada y registro operativo sin secretos; `IMP06-AUDIT-03/04/07`, SQL y HTTP.                                                        |
| Vacío y falla del visor             | Vacío 200 separado de error, respuestas obsoletas descartadas, caída real de API y reintento en `IMP06-AUDIT-02/05`. No acredita E4 de exportación.                                            |
| RNF-USA-01 a USA-04                 | Teclado, foco y desbordamiento horizontal limitado a la tabla; tres tamaños y revisión visual de capturas por el agente. Sin declaración de conformidad WCAG completa ni estudio con usuarios. |
| RNF-REN-01, perfil local de DEC-008 | 10.000 eventos A/1.000 B; primera petición/navegación separada, 50 muestras por superficie, p95 nearest-rank <3 s y cero errores. No acredita producción.                                      |

Revisión cruzada entre agentes del SQL/RPC, contratos y arneses: sin nuevos defectos bloqueantes después de las correcciones registradas. No se atribuye revisión humana a esa colaboración.

### Incidencias conservadas

- La primera compilación del contrato detectó incompatibilidad del genérico de entrada de `z.coerce.number` tras una unión; se corrigió sin ampliar tipos admitidos. El foco posterior aprobó 25 contratos y 9 pruebas API.
- La primera prueba del log HTTP no capturaba stdout porque `restoreMocks` restaura el spy de `beforeAll`; se corrigió la captura local de la prueba, sin alterar el registro de producto. Repetición: 42 pruebas API de los tres focos aprobadas.
- Revisión independiente detectó que el guard SQL de corte futuro se mapeaba como 400 compartido y que mayúsculas/HEAD omitían el evento operativo. Se corrigió el mapeo local a 422 y el registro de estas variantes, conservando los lectores previos.
- Primera integración: **9 HTTP aprobados** y cinco observaciones reales correlacionadas verificadas; pgTAP se interrumpió por un paréntesis sobrante en la nueva prueba 021, línea 106. Los 20 archivos previos aprobaron; 16 aserciones nuevas ejecutadas antes del error. El error completo se conserva en `.local/evidence/imp-06/audit-integration-run1-error.log` y el resultado en `.local/reports/imp-06/audit-integration-run1.json`. Se corrigió la sintaxis conservando las 108 aserciones; la repetición aprobó 1.419 aserciones.
- La revisión de UI detectó normalización indebida de espacios en acción/tipo. Se corrigió para conservar la comparación exacta y se verificó hasta la construcción de la URL; UUID sigue recortando espacios exteriores.
- Primera ejecución Cypress: 8/8 aprobados, navegación inicial 174,6 ms, 50 navegaciones válidas y p95 397,6 ms. La inspección de capturas encontró `SUCCESS` duplicado en la celda de resultado; se corrigió su etiqueta y se agregaron capturas del formulario, manteniendo las de tabla. La ejecución original, muestras y capturas se conservan en `.local/evidence/imp-06/audit-e2e-run1/`; la repetición posterior aprobó los ocho casos y su perfil de rendimiento.

## Límites

RF-027 permanece parcial hasta CSV IMP-06.06. No se acredita cierre .04/.07, CI integral/Linux, despliegue ni aceptación CAPSTONE. El registro operativo a stdout no demuestra captura o retención centralizada.
