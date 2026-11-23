# IMP-03 — Demostración local de práctica, intentos e historial

Fecha de preparación: 23/10/2026. Esta guía describe el recorrido implementado
y comprobado localmente: **34/34 recorridos Cypress aprobados** junto con API,
SQL y ejecutor reales. La [entrega](IMP-03-implementation.md) y su evidencia
registran los resultados. **CI local aprobó sus 14 controles**, incluido SUBMIT
concurrente (p95 3,50 s, objetivo <5 s). El ensayo personal de presentación, la aceptación
del profesor y la operación remota permanecen pendientes.

Se verificaron funcionalmente 14 de los 27 RF: los nueve del corte IMP-02
y ALZ-RF-005/007/009/011/014, equivalentes a **14/27 = 51,9 % local**.
El conteo funcional es independiente de RNF-REN-02, verificado con su perfil local de carga.
ALZ-RF-010 aporta envío e intento técnico persistente,
pero conserva estado parcial porque este corte no integra la ayuda IA posterior.
No se cuentan pantallas, archivos o incrementos técnicos como requisitos completos.

## Preparar el equipo y conservar los datos

Trabajar desde la raíz Git del proyecto principal, con Docker Desktop y el motor
Linux activos. La demostración utiliza exclusivamente los servicios y datos ficticios de Alunza.

```powershell
Set-Location C:\Users\Lenovo\Desktop\alunza-edu\alunza-edu
git rev-parse --show-toplevel
. ./scripts/use-node.ps1
npm ci
npm run local:doctor
npm run local:up
npm run db:migrate
npm run db:seed
npm run runner:prepare
npm run runner:doctor
npm run demo
```

`npm ci` se necesita en una preparación inicial o tras cambios del lockfile.
En un entorno instalado, ejecutar únicamente los pasos pendientes. El script
portable fija Node 24.21.0/npm 11.19.0 en esa sesión; no reemplaza Node global.
`db:migrate` aplica la migración incremental y prepara la configuración local
de API/web; el ejecutor de host se habilita únicamente en local/test.
`runner:prepare` construye la cápsula con QuickJS/WASM y `runner:doctor` comprueba
Docker Linux, cgroup v2, identidad, límites efectivos y limpieza. Si falla,
corregir la causa antes de presentar ejecución; la salud de la API por sí sola
no demuestra que el ejecutor esté listo. `npm run demo` compila todos los paquetes,
incluido el runner que importa la API, y luego inicia la API compilada y la web
mediante `next start`. La API lee `apps/api/.env.local` y el build web utiliza
`apps/web/.env.local`, generados por `db:migrate`. No habilita el servidor MCP
de `next dev`, afectado por el [aviso oficial de Next](https://github.com/vercel/next.js/security/advisories/GHSA-39w2-rjm5-chcv).
El comando `npm run dev` queda disponible para desarrollo con
recarga automática; detenerlo antes de iniciar la demo.

La auditoría del 23/10/2026 conserva las mismas 14 entradas de paquetes
vulnerables de HEAD: 5 críticas, 7 altas y 2 moderadas. Los paquetes QuickJS
0.32.0 incorporados no añaden entradas señaladas. Los archivos locales
`.local/audit-imp-03-baseline.json` y `.local/audit-imp-03-current.json` guardan
la comparación. Usar `next start` evita el endpoint MCP de desarrollo; las
otras alertas requieren revisión y actualización pendiente antes de publicar.
La demo local no acredita ausencia de vulnerabilidades ni despliegue seguro.

Abrir [Alunza local](http://127.0.0.1:3000). La API usa `127.0.0.1:4000` y Auth
`127.0.0.1:15421`; PostgreSQL/Studio/correo ficticio usan `15422/15423/15424`.
El ensayo automatizado tiene puertos distintos: web `3100`, API `4100` y Supabase
`16421–16424`. No ejecutar dos suites integradas simultáneamente.

La variante `compose:up` conserva el ejecutor de host deshabilitado: sirve para
su recorrido académico, pero **no es el arranque de esta demo RUN/SUBMIT**.
La interfaz y API deben usar el arranque compilado anterior.

El seed conserva dos organizaciones, dos administradores, dos profesores, ocho
estudiantes, tres clases y diez ejercicios. No reinicia el desarrollo ni elimina
intentos anteriores. Usar una actividad nueva para cada ensayo o continuar su
historia; no borrar datos para fabricar un estado inicial. Detener la demo
con `Ctrl+C` y Supabase propio con `npm run local:down`, que conserva volúmenes.

## Cuentas y preparación del recorrido

Las cuentas son ficticias; consultar la contraseña común mediante
`npm run local:credentials` en una terminal interactiva local. No colocar su
valor, tokens, códigos vigentes ni archivos privados de `.local` en las láminas.

| Actor           | Cuenta                  | Uso                                                                         |
| --------------- | ----------------------- | --------------------------------------------------------------------------- |
| Administrador A | `admin.a@alunza.test`   | Mostrar organización, curso, asignación docente y conceptos ya persistidos. |
| Profesor A      | `teacher.a@alunza.test` | Configurar clase, publicar actividad y cerrarla al terminar.                |
| Estudiante A    | `student.a@alunza.test` | Incorporarse, ejecutar, enviar y consultar historia propia.                 |
| Estudiante B    | `student.b@alunza.test` | Comprobar que una URL de A no revela su ejercicio ni sus intentos.          |

El estudiante A comienza sin inscripción en una instalación recién sembrada.
Profesor A puede generar un código vigente para **Programación I · Sección 1**;
Estudiante A lo verifica y confirma desde **Mis clases e incorporación**. Si ya
pertenece, abrir la clase existente. No resembrar para retirar su inscripción.

La creación de cursos, clases, conceptos y ejercicios se conserva como en
[la guía IMP-02](IMP-02-demo.md). Para un recorrido breve y reproducible, Profesor A
crea una actividad titulada, por ejemplo, «Avance de práctica 23-10-2026», con
un único ejercicio requerido de suma, una prueba visible `[1,2] → 3` y otra
prueba requerida oculta que exija sumar argumentos distintos. Mantener esa
prueba fuera de las capturas del estudiante. Usar una plantilla `function solve(a, b) {}`,
conceptos activos y las fechas opcionales vacías para disponibilidad inmediata.
Publicar mediante la confirmación de la interfaz.

## Guion principal ante el profesor

1. **Persistencia y permisos.** Desde las cuentas administrador/profesor,
   mostrar clase, ejercicio y actividad guardados. Recargar la actividad y
   comprobar su estado Publicada. Entrar como Estudiante A, abrir la clase y
   la actividad; mostrar instrucciones, fecha y avance **0/1 · Sin intentos**.
2. **Borrador.** Abrir **Preparar solución**. Mostrar enunciado, conceptos y
   pruebas visibles; editar el código y recargar para recuperar el borrador.
   Tab debe salir del editor. El texto solo se conserva en esta pestaña y se
   elimina al cerrar sesión.
3. **Práctica sin intento.** Escribir `function solve() { return 3; }` y pulsar
   **Ejecutar**. La única prueba visible pasa: debe mostrarse `SUCCESS` como
   resultado temporal, sin fila nueva de historial ni cambio de 0/1.
   Esto todavía no acredita las verificaciones ocultas.
4. **Confirmación y resultado guardado.** Pulsar **Enviar intento**, revisar el
   código capturado y cancelar una vez: no debe aparecer un intento. Volver a
   enviar y confirmar. El servidor ejecuta todas las verificaciones y confirma
   persistencia: debe aparecer un ID/fecha y `FAILED_TEST`, con las visibles
   superadas y las ocultas no superadas, sin revelar sus entradas/salidas.
   El avance sigue en 0/1. Mostrar que recargar conserva ese intento.
5. **Reintento con historia.** Elegir **Ver intento #1 → Copiar al editor para
   reintentar → Confirmar copia**. Cambiar a
   `function solve(a, b) { return a + b; }` y confirmar un nuevo envío. Debe
   crearse otro ID, obtener `SUCCESS` y actualizar el avance a 1/1. Comparar
   ambos intentos: la comparación muestra únicamente pruebas visibles y no
   constituye una nota. El primer intento permanece intacto.
6. **Logro acumulado.** Enviar deliberadamente `function solve() { return 0; }`.
   Debe guardarse otro fallo sin borrar el éxito anterior: avance 1/1 e historia
   con tres intentos. Volver a la actividad y clase para comprobar la misma
   fracción calculada por el servidor.
7. **Límite y borrador.** Ejecutar, sin enviar,
   `function solve() { while (true) {} }`. Debe terminar con `TIMEOUT`, conservar
   el código y no añadir un intento ni modificar el avance. Restaurar una copia
   de la solución correcta mediante el historial.
8. **Cierre e historia.** Conservar la sesión estudiante y cerrar la actividad
   desde una sesión separada de Profesor A. En el editor, pulsar **Comprobar
   disponibilidad**: debe quedar de solo lectura y conservar el borrador.
   Desde la clase, abrir **Historial de mis actividades → Ver intentos**.
   La actividad cerrada permite consultar los intentos propios; esa ruta no
   vuelve a mostrar la plantilla ni habilita editor, copia o nuevos envíos.
9. **Aislamiento y cierre de sesión.** Copiar la URL del historial, cerrar sesión
   y entrar como Estudiante B. La consulta debe denegarse sin código ni resultados
   de A. Volver con A permite consultar sus intentos guardados; su borrador y
   solicitudes locales anteriores ya fueron retirados al cerrar sesión.

Un envío admitido antes del cierre puede terminar y persistirse después; uno
admitido posteriormente se rechaza. La API decide esa carrera, y la entrega o
recuperación siempre exige permisos vigentes. No presentar el cierre como
cancelación de trabajo ya admitido ni como pérdida del intento.

## Recuperación y verificaciones complementarias

Si una respuesta se pierde, la interfaz no anuncia un intento guardado: presenta
**Recuperar envío**. Esa acción conserva la clave y el código originales aunque
el borrador haya cambiado; recargar la misma pestaña conserva la recuperación.
También está disponible en la ruta histórica si la actividad cerró. Confirmar
otro envío significa una intención nueva y puede crear otro intento. Cerrar
sesión elimina las solicitudes locales pendientes, pero no borra intentos ya
persistidos: consultarlos al volver antes de decidir un nuevo envío.

Los ensayos deterministas de transporte viven en
[submissions.cy.ts](../../tests/e2e/submissions.cy.ts): pérdida de respuesta,
reinicio y cierre (`IMP03-05`); respuesta tardía después de cambio de cuenta
(`IMP03-07`); dos confirmaciones con respuestas invertidas (`IMP03-08`). Retienen
o fallan únicamente la entrega al navegador después de una respuesta real;
no reemplazan la API, la persistencia ni el ejecutor por resultados fijos.
No simular esos resultados manualmente en una presentación.

`IMP03-09`, en [practice.cy.ts](../../tests/e2e/practice.cy.ts), interrumpe solo
la consulta de avance en el navegador: muestra un error sin inventar un cero
ni «Sin intentos» y recupera la evidencia real al reintentar.

Comprobaciones ejecutables del candidato, desde la raíz con Node portable:

```powershell
npm run test:runner
npm run runner:probe -- --adapter docker
npm run test:migration:practice
npm run test:integration
npm run cypress:install
npm run test:e2e
npm run test:practice:performance
npm run test:practice:performance -- --submit
npm run ci:verify
```

La secuencia enumera controles disponibles; `ci:verify` ya agrupa los necesarios
para su cierre y no exige repetirlos todos por separado si no hubo cambios.
Cada suite integrada usa y reconstruye únicamente TEST aislado. Los resultados
IMP-03 se guardan en `.local/reports/imp-03/`, incluidos `e2e.json`,
`academic-upgrade.json`, `run-performance.json`, `submit-performance.json` y
`ci.json`. Registrar fecha, candidato, navegador, resultados y limitaciones;
la existencia de un script o un reporte de otro candidato no acredita un PASS.

Antes de presentar, recorrer además cancelación con Escape, foco después de
copiar un intento, errores de carga/servicio y ancho móvil. La revisión estática
de etiquetas, diálogos y regiones de estado no sustituye ese ensayo ni acredita
conformidad WCAG completa. Se mantienen fuera de este corte materiales, RAG,
pistas, progreso por concepto, tablero/señales, aceptación académica y ejecución
productiva en Vercel Sandbox.
