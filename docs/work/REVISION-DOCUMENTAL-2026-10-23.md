# Revisión documental — 23/10/2026

Se revisaron el estado vigente, las especificaciones, el plan progresivo y los registros de implementación para reflejar **14/27 RF probados localmente (51,9 %)**, con 3 parciales y 10 pendientes. La actualización afecta **47 archivos Markdown**, incluido este registro. Los resultados históricos permanecen asociados a su fecha y no se atribuyen a reuniones anteriores al corte IMP-03. La [síntesis vigente](ESTADO-ACTUAL.md) identifica capacidades, pruebas y pendientes.

## Documentos y presentaciones CAPSTONE

Se actualizaron seis documentos Word de Fase 2 conservando sus plantillas y estilos: informe de avance, guía de desarrollo 2.4, informe final 2.6, Documento de Arquitectura del Sistema, Diccionario de Datos y Documento de Proceso de Negocio. Se alinearon cobertura, funciones de RUN/SUBMIT, historial propio, avance por actividad, pruebas locales, límites y brechas. El diccionario describe **25 tablas, 292 atributos y cuatro migraciones**, con cinco fichas nuevas; su versión final tiene 43 páginas.

Las dos presentaciones de Fase 2 reflejan el mismo corte: versión simple de 13 diapositivas y versión con diseño de 14, con índice. Ambas mantienen tablas editables; la versión con diseño también conserva un gráfico editable con 14 completos, 3 parciales y 10 pendientes.

Las 11 minutas conservan numeración y calendario históricos desde el martes 08/09/2026 hasta el viernes 16/10/2026, omitiendo el feriado del 18/09. Los documentos de Fase 1 también mantienen sus cortes; no se trasladaron a ellos resultados posteriores de IMP-03.

## Comprobación de formato y referencias

Se revisaron las páginas renderizadas de los seis Word y las 27 diapositivas de ambas presentaciones, con atención a tablas, títulos, fuentes, pies, desbordamientos y legibilidad. Se corrigió la paginación de la ficha final del diccionario para reunir su contenido y fuente sin reducir la tipografía.

La inspección de los 49 archivos Office existentes —41 DOCX, 5 PPTX y 3 XLSX— incluyó texto XML y relaciones del paquete. No se encontraron referencias a las fuentes excluidas por el encargo. Las referencias de la documentación revisada remiten a especificaciones, código, migraciones, evidencia local y antecedentes académicos autorizados. Los enlaces locales Markdown y los hashes de las copias originales y versiones revisadas se verificaron por separado.

## Integridad de la evidencia existente

No se ejecutaron nuevas suites, migraciones ni llamadas remotas durante esta revisión. No se cambió código, contrato, fixture, prueba o configuración de infraestructura. Los JSON de resultados y su manifiesto original se conservan sin alteraciones.

Se comparó SHA-256 de los 28 artefactos enumerados en [el manifiesto histórico](evidence/imp-03/manifest.json). 27 coinciden exactamente. La única revisión posterior es `README.md` de esa carpeta, por actualización de texto y referencias; la copia anterior coincide con el hash del manifiesto. Por eso el manifiesto describe el corte original y no se presenta como un nuevo manifiesto del README revisado.

| Documento revisado | SHA-256 original | SHA-256 actual |
| --- | --- | --- |
| `docs/work/evidence/imp-03/README.md` | `7a4a6086003925958bc07e35cb1ca5772909bdaa151bfc5f9c1cafd03a22a202` | `03d4a6de0ef48ca81cf82c592947f603e25a1d1579a7fd994e1508fa717b750d` |
| `apps/web/README.md` | `0c12ff7aaaf41195d171cb83be664d0b60a94d088a2bcc0000f6358337bdc9cd` | `c1cfa36718981747c5560b67f82f150b21e26702f8567a26c46252f459436e38` |
| `infra/preproduction/README.md` | `6b8a182bd89efa3b6a5ace5dcd856eff1e23bc4fd35da3137395d5c49d0f9a4a` | `416672b052759935934f3962bd71540af098496d0199aa7b60f1d0b27df874d0` |
| `infra/runner/README.md` | `ed6217ebf8df6d2a6af69391afd6ca96b1e530b67be0914d4cd00698275967f0` | `8f6f61fb852eaa8ac79c36fea303ac5fe17fa655e84735ac91031b1ad45d073d` |
| `tests/e2e/README.md` | `8d50cfb7634f8e8426e4ae4701913c90612340e6fa39f788ad5ac16833a94da1` | `273d63c70ccaadbf6604da31e579ba43f595b33193ff63afa8c96cf202758bd4` |

## Huella del candidato y cambio documental

La huella de 290 archivos usada por CI se volvió a calcular antes de editar y coincidió con `5a5ec24f2a9535101f7cb7a303460d479a06bdf866c4b592ab1b1fcf61076194`. El algoritmo excluye `docs/`, `specs/`, README raíz y el archivo generado `next-env.d.ts`, pero incluye todos los archivos bajo `apps/`, `tests/` e `infra/`, también sus README.

Al cambiar cuatro README dentro de ese conjunto —`apps/web/README.md`, `tests/e2e/README.md`, `infra/preproduction/README.md` e `infra/runner/README.md`— la huella del árbol pasa a `08d637575e76826dce3f915bdd99ea2d95a18ca99cd5ec26f6c5cb09b53dc61b`. La reconstrucción usando el contenido anterior de esos cuatro archivos produce exactamente la huella del candidato probado: ningún otro archivo del conjunto difiere. La nueva huella identifica una revisión documental; **no acredita un CI ejecutado sobre una nueva versión** ni reemplaza el hash histórico de los informes.

Los cortes IMP-00/01/02 conservan sus pruebas y métricas originales con una referencia explícita al estado vigente. Las especificaciones mantienen los 27 RF, 29 RNF, decisiones de arquitectura y presupuestos originales, diferenciando implementación local, componentes futuros y aceptación académica pendiente.
