# IMP-06.07 — Registro del ciclo de consolidación

Fecha: 03/11/2026 (Santiago). Estado: **implementado y verificado funcionalmente en LAB TEST; aceptación integral bloqueada**. [Plan autorizado](IMP-06-governance-phase-plan.md), [matriz de escenarios](IMP-06-governance-phase-matrix.md).

Los 16 escenarios originales aprobaron con seis casos HTTP y seis Cypress sobre el mismo candidato. Aprobaron además 1.513 aserciones SQL, ocho Cypress de regresión y los controles generales/focales descritos abajo. El diagnóstico offline .04 mantiene `HOLD_UNRESOLVED_SECONDARY_ETL`; no se ejecutó CI integral. El agregador devuelve código **2**, con 9/17 contextuales y 0/1 CI final, sin errores de evidencia funcional.

## Base y conservación

Base `1d8d7ac`, rama `codex/imp-06-07-integration`. Se preservan los cambios previos del Office y `apps/web/next-env.d.ts`; hashes/copia privada en `.local/evidence/imp-06/governance-phase-review/initial.json`. El ciclo permite restablecer recursos propios de TEST cuando haga falta y conserva cada fallo. No modifica los paquetes congelados de .04 ni reanuda campañas.

## Contratos de verificación

Seis casos integrados sobre una historia real HTTP/Docker/TEST y 16 escenarios originales. Contratos públicos de producto sin cambios; comandos e informes nuevos identifican el candidato mediante SHA-256 de las fuentes, corte de ejecución, ambiente y cobertura exacta. El inventario vigente es 125/18; el contextual sigue 69/10.

El agregador requiere `--since` con un instante UTC explícito. Para este ciclo el corte mínimo inicial es `2026-11-03T22:33:41.512Z`. No invoca CI y devuelve código 2 cuando la verificación funcional aprueba pero .04 mantiene bloqueada la aceptación integral. El código 1 identifica evidencia inválida/incompleta o pruebas fallidas.

## Verificaciones

Node 24.21.0, npm 11.19.0, Supabase CLI 2.101.0 y Docker 29.7.2. Aprobaron `npm run format:check`, `npm run lint`, `npm run typecheck` y `npm test`: 2.577 pruebas en 144 suites (API 945, web 141, contratos 236, ejecutor 211, IA 378 y preproducción 666). Incluyen rechazo de evidencia ausente, antigua, de otro candidato o incompleta, inventario contextual preservado, barreras de concurrencia y saneamiento de errores asíncronos.

Aprobó `npm run test:imp06:integration` en la segunda corrida `6d68429f-add4-4be6-af52-8b95a49ab0cb`: seis casos HTTP, sin omisiones; 1.513 aserciones SQL en 22 archivos, limpieza completada y huellas de fuentes idénticas antes/después. Las dos carreras observaron dos solicitudes bloqueadas cada una; revisión única y un cambio de gobierno con un conflicto 412. La corrida final se identifica abajo. Logs generales privados en `.local/evidence/imp-06/governance-phase-review/` e informe saneado `.local/reports/imp-06/governance-phase-integration.json`.

Primera corrida HTTP `fb12dc51-454f-4118-8f4e-a6921bd9a1bb`: seis casos fallidos en `beforeEach`, antes de ejecutar sus recorridos. El orquestador común prepara solo identidades; faltaba el seed académico para comprobar una matrícula canónica real de B. Se incorporó `seedAcademic(state)` al comando focal, como ya hace E2E, conservando la aserción y la demo. Formato/lint focales aprobaron tras la corrección. Se preservaron JSON de Jest, hechos vacíos y diagnóstico privado; no se acreditaron regresiones SQL en esa corrida.

Primera corrida Cypress: cuatro casos aprobados (03–06), dos fallidos (01–02), sin pendientes ni omisiones. El foco inicial del editor revalidó acceso y desmontó el historial antes del clic; se adoptó la espera de autorización ya usada en `submissions.cy.ts`, comprobando la lectura del intento correcto. La confirmación de archivo se adelantó a la recarga tras nueva versión y recibió 412 correctamente; ahora se espera el detalle con versión 2 y se exige archivo HTTP 200. Reporte, diagnóstico y descargas se conservaron en `.local/evidence/imp-06/governance-phase-review/e2e-run-01/`. Las aserciones permanecen y no se modificó producto para corregir estos pasos.

La revisión detectó además que un reporte rechazado podía aportar filas «aprobadas» aunque el resultado global fallara. Tres regresiones reprodujeron el defecto antes de corregirlo: la cobertura solo incorpora superficies completamente válidas y requiere candidato, ventana e inventario válidos. `npm run test:preproduction` posterior aprobó 669 pruebas en 36 suites, incluidas las tres nuevas; las demás 1.911 pruebas generales anteriores corresponden a fuentes de producto sin cambios. Formato, lint y tipos focales aprobaron tras los ajustes de Cypress.

Segunda corrida Cypress: cuatro aprobados (03–06) y dos fallidos (01–02). La nueva cadena `should('not.have.attr', 'readonly').click()` entregó un sujeto indefinido; se separó la consulta del clic. También se observó 412 al crear versión tras cambiar visibilidad: se exige completar PATCH y recarga GET antes de abrir el formulario siguiente. Reporte y artefactos preservados en `governance-phase-review/e2e-run-02/`; formato, lint y tipos E2E aprobaron después. Se mantienen los rechazos y condiciones de aceptación originales.

Regresión `npm run test:e2e -- --audit-export`: ocho casos aprobados, sin omisiones, Chrome 156.0.8078.80/Cypress 16.0.0. También aprobaron build completo y comprobación de artefactos sin secretos/centinelas del servidor. El perfil existente conservó 10.000 eventos A/1.000 B, concurrencia uno, primera navegación 1.846,8 ms y p95 1.903,3 ms sobre 50 recorridos completos; umbral de 3.000 ms intacto. Es evidencia sintética de capacidad, separada de la historia funcional .07. Reporte, muestras, capturas y descargas se preservaron en `.local/evidence/imp-06/governance-phase-review/audit-export-regression-01/`.

Tercera corrida `npm run test:e2e -- --governance-phase`: seis aprobados, cero fallidos/pendientes/omitidos, cobertura exacta de seis casos y un spec. Chrome 156.0.8078.80/Cypress 16.0.0, build completo y control de artefactos aprobados. Huella de fuentes antes/después `653646f5f28f58a5a0d54735e77723d96445b3e527024fa3d94f1344b94b5aad`. Reporte y artefactos preservados en `governance-phase-review/e2e-run-03/`.

La tercera corrida HTTP `da367527-9af7-4cbc-831e-d3babb3452f6` volvió a aprobar seis casos y las 1.513 aserciones SQL, con limpieza completada y la misma huella antes/después que Cypress. `npm run test:imp06:acceptance -- --since 2026-11-03T22:33:41.512Z` confirmó los 16 escenarios y cero errores: `functionalStatus=passed`, `acceptanceStatus=blocked`, código 2. El informe saneado es `.local/reports/imp-06/governance-phase-acceptance.json`; los bloqueos explícitos son `IMP06_04_PENDING` e `INTEGRAL_CI_NOT_EXECUTED`.

Teclado: Enter, Tab, Escape, cancelación y devolución de foco comprobados. Capturas verificadas en 1440×900, 768×1024 y 390×844; inspección visual del agente confirma texto, controles y foco legibles y diálogo sin recorte horizontal observado. Evidencia privada `governance-phase-review/visual-review.json`, con hashes. No equivale a estudio con personas ni evaluación WCAG completa.

## Diagnóstico offline .04

El paquete nuevo `resumption-15` conserva la preparación v1 fallida antes de compilar/abrir ETL: el mapa de archivos de evidencia no incluía la dependencia Node externa a esa carpeta. La revisión v2 verifica esa dependencia por hash directo. La falla de preparación no consumió una lectura real.

Aprobaron 10 aserciones nativas y 49 de protocolo. La única lectura secundaria contabilizó cinco eventos, dos proveedores y cinco formas; duró 41,5 ms y produjo 1.511 bytes, sin pérdidas declaradas. La integridad posterior conservó 13.676 archivos previos y ambos ETL. Las familias EventTrace y PerfInfo/Mark se identificaron parcialmente en fuentes fijadas de TraceEvent 3.2.8, pero falta prueba del productor y del papel completo del archivo. Se mantiene **HOLD_UNRESOLVED_SECONDARY_ETL**; no se abrió el principal ni se evaluó su cobertura. Los manifiestos privados conservan comandos, límites, fuentes y hashes, sin reemplazar los paquetes o rechazos anteriores.

## Límites

Se mantienen 9/17 campañas .04 y 0/1 CI final. La cobertura temporal del ETL, si se verifica, no resuelve por sí sola el sensor. No se reanudaron capturas ETW, PHASE, ON/OFF, ABBA ni CI completa; la regresión local de capacidad .06 se identifica por separado arriba. Azure/Sandbox remotos, aceptación humana, publicación, despliegue e IMP-07/08 quedan pendientes y fuera de este ciclo.
