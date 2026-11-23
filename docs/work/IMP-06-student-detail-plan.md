# Plan aprobado IMP-06.03 — Detalle docente de estudiante

Fecha: 27/10/2026, America/Santiago. Alcance autorizado: implementar únicamente
IMP-06.03, ALZ-RF/HU/CU/PT-017 E1–E4 y UX-11, sobre la base real IMP-03/04/05
y el gobierno del banco .01/.02. Se preservan los cambios previos del workspace.

Ejecución: **cierre técnico local de IMP-06.03**. El
[registro de implementación y pruebas](IMP-06-student-detail.md) conserva los
focos, la CI final 17/17 con fuentes/documentación congeladas y los fallos
anteriores por separado. .04–.07 y aceptación humana/remota siguen pendientes.

## Contrato y decisiones

El profesor ACTIVE asignado consulta un estudiante de la matrícula vigente
CURRENT_ACTIVE de su clase. ADMIN no obtiene lectura pedagógica. Se mantienen
los permisos actuales también al consultar cortes pasados y recursos históricos.

El usuario eligió **solo ayudas entregadas**: explicación con FEEDBACK_VIEWED
o pista con HINT_DELIVERED persistido hasta `asOf`. Se excluye ayuda preparada,
presentada sin ACK o entregada después del corte, incluso en acceso directo.
Una fuente revocada deja únicamente metadatos seguros y `help:null`; la consulta
docente no suprime registros, genera ayuda, confirma lecturas ni crea eventos.

Las nueve rutas GET quedan bajo
`/api/v1/classes/{classId}/students/{studentId}`: progreso, evidencia, intento,
historial/detalle de ayuda, referencia/documento y listado/detalle de señales.
Los DTO estrictos se componen en `packages/contracts/src/student-detail.ts`.
Se conservan código/resultados canónicos, contexto de versión fija, pruebas
visibles y el resumen `hiddenChecksPassed`, sin detalles de pruebas ocultas.

`from` limita observaciones, no progreso acumulado ni última actividad; señales
conservan su semántica sin `from`. La primera respuesta fija `asOf` y los enlaces
y páginas lo conservan. Evidencia/señales: 50 por defecto, máximo 100; ayudas:
20, por fecha de entrega e ID descendentes. Cursores ligados a actor, clase,
estudiante, filtros y corte. No se promete snapshot entre peticiones.

## Implementación coordinada

1. Migración aditiva de funciones/proyecciones y permisos mínimos; kernels de
   señales con filtro de estudiante antes de conteos y páginas, preservando
   wrappers de clase. Sin tablas nuevas, backfill ni grants de lectura general.
2. NestJS usa `readAs` con el actor docente; readiness exige las ocho funciones.
   Las descargas verifican hash/tamaño y reautorizan después de Storage.
3. Página `/clases/[classId]/estudiantes/[studentId]`, enlazada al tablero;
   filtros y corte conservados al volver. Presentación pura de intentos, ayuda
   y señales; sin acciones estudiantiles ni revisión de señales.
4. Error de autorización retira todo el detalle; respuestas anteriores se
   descartan. Un fallo de ayuda recuperable conserva la evidencia técnica.

Datos, web y aceptación se delegan en archivos separados; el agente principal
integra contratos/API, revisa resultados y coordina las suites exclusivas TEST.
Se aplican las guías de backend, datos, UX, progreso, seguridad y pruebas,
manteniendo DEC-001/002/005 y concretando DEC-004/006 para este incremento.

## Verificación y cierre previstos

- Contratos/unidad: filtros, corte preciso, scope y proyecciones; corrupción o
  revocación de documento entre autorizaciones impide entregar bytes.
- SQL/HTTP reales E1–E4: alumno en dos clases, roles ajenos, retiro/deshabilitación,
  reasignación docente, cursores incompatibles, cortes y paginación de señales.
- Comparación antes/después demuestra lecturas sin cambios en intentos, ayudas,
  presentación, eventos, ledger IA, progreso ni episodios.
- Cypress desde tablero hasta intento Docker real, ayuda TEST entregada y cita;
  filtros, vacíos/503, revocación, ocultas fuera de red/DOM, teclado y tres tamaños.
- Actualización .02→.03 con datos conservados y readiness 503→200; rendimiento
  API/pantalla con perfiles existentes y objetivo p95 <3 s.
- Formato, lint, tipos, pruebas, build y CI completa. Congelar **todo código y
  documentación** durante CI, incluida evaluación de ayuda; conservar fallos.

Los resultados se registrarán en `IMP-06-student-detail.md`. No se inicia
IMP-06.04–.07 ni se despliega, llama a proveedores remotos o atribuye aceptación
humana/CAPSTONE a los resultados locales.
