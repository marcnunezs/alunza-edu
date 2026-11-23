# IMP-03 — Candidato reproducible de fuentes

Fecha: 16/11/2026, America/Santiago. Alcance: conservar y comprobar las fuentes
actuales para revisar la [decisión del ejecutor](IMP-03-decision-ejecutor-2026-11-16.md).
El paquete identifica código; no aprueba esa propuesta, el producto ni un
proveedor. No crea commits en el repositorio, publica, instala dependencias,
ejecuta migraciones ni arranca servicios.

## Resultado y límites

`scripts/runner-candidate.mjs` prepara una carpeta nueva en
`.local/candidates/<nombre>/` con `source/`, `manifest.json` y
`manifest.sha256`. El manifiesto está fuera de las fuentes: no se incluye a sí
mismo ni se introduce su huella en esta guía. El recibo de consola identifica
el paquete concreto.

Cada archivo conserva bytes, ruta relativa, SHA-256 y modo ejecutable del índice
Git. El inventario ordenado determina `sourceDigest`. La base Git, la indicación
explícita `workingTreeDirty`, los estados de las rutas incluidas y las
eliminaciones acompañan esa identidad. No se recopilan remotes, contenido de
diffs, nombres de autores, credenciales ni contenidos de evidencia privada.
La suciedad puede proceder de archivos fuera del paquete y no implica incluirlos.

La fórmula de esta huella incluye tamaño y modo, y su alcance incluye
documentación. **No es intercambiable** con `sourceDigest` de
`signals-candidate` o `quality:coverage`. Dos preparaciones de los mismos bytes,
modos y estado Git producen el mismo manifiesto; nombres de carpetas y reloj no
intervienen. Los bytes se copian sin normalizar finales de línea.

Es un snapshot de fuentes, **no una imagen, VM, base de datos ni entorno
ejecutable sin preparación**. No contiene `node_modules`, Docker, runtimes ELF,
paquetes del sistema, configuración privada, cuentas, corpus privado ni pruebas
históricas de `.local`. Las referencias a esos artefactos en documentos se
conservan como referencias; sus destinos no se leen ni copian.

El manifiesto incluye el lockfile y su hash, versiones Node/npm declaradas,
migraciones ordenadas con hashes y referencias `FROM ...@sha256` encontradas en
Dockerfiles. `declared-in-source-only` indica comprobación de la referencia en
las fuentes empaquetadas: no se descargó ni inspeccionó una imagen remota.
Tampoco convierte instalaciones `apt` no fijadas en builds binarios
reproducibles. Los binarios, imágenes y capacidades efectivas deberán verificarse
en el entorno de ejecución que se elija.

## Inventario acotado

Se usa el inventario Git de archivos versionados y nuevos no ignorados. Se
incluyen fuentes, contratos, configuración pública y documentación de `apps`,
`packages`, `scripts`, `tests`, `supabase`, `fixtures`, `infra`, `specs`, `docs` y
`.github`, además de manifests, lockfile, instrucciones y configuración raíz
enumerados en el script. Se conservan rutas dinámicas Next.js y los dos PDF
ficticios canónicos de `fixtures/demo/materials`.

Se excluyen `.git`, `.local`, `.codex-remote-attachments`, dependencias, builds,
capturas, Office, archivos de entorno privados y claves privadas generales.
`apps/web/next-env.d.ts` y `packages/contracts/openapi.json` se excluyen como
generados, igual que en las huellas anteriores; Next y `npm run openapi` los
regeneran durante la preparación habitual. No se ejecuta esa preparación para
crear este paquete.

Las tres plantillas públicas de entorno admitidas son `.env.example`,
`apps/web/.env.example` e `infra/preproduction/runtime.env.example`. Los campos
de credenciales deben estar vacíos o contener placeholders; la conexión de
ejemplo solo admite loopback con contraseña `REPLACE...`. `.npmrc` admite
únicamente los ajustes públicos actuales `engine-strict=true` y
`save-exact=true`; una ampliación requiere revisar esa política. Estos controles
no se presentan como un escáner universal de secretos en código arbitrario.

Existe una excepción exacta para el certificado y clave **públicos ficticios**
`tests/fixtures/tls/local-test-only.crt` y `.key`. Su propósito está declarado en
`apps/api/src/database/ssl.spec.ts`: servidor exclusivo de `127.0.0.1`, identidad
`db.alunza.invalid` y rechazo de CA/hostname incorrectos. El script fija los
SHA-256 revisados y marca ambas rutas `testFixtureOnly`; cualquier modificación
del par impide preparar el paquete hasta una nueva revisión. No se autoriza
usar esas claves en aplicaciones o servicios remotos.

## Preparación, verificación y restauración offline

Desde la raíz del repositorio, con el runtime fijado:

```powershell
node scripts/runner-candidate.mjs prepare --label imp-03-decision-2026-11-16
node scripts/runner-candidate.mjs verify --candidate .local/candidates/imp-03-decision-2026-11-16
```

Conservar `manifestSha256` del recibo fuera del paquete. La verificación de sus
dos archivos internos detecta corrupción; para contrastar identidad frente a
un recibo conocido, añadir `--expect <manifestSha256>`. SHA-256 proporciona
integridad, no firma de autoría.

Para reconstruir exactamente las fuentes en un directorio **nuevo**, cuyo
padre ya exista:

```powershell
node scripts/runner-candidate.mjs restore --candidate .local/candidates/imp-03-decision-2026-11-16 --target .local/candidates/imp-03-decision-2026-11-16-restored --expect <manifestSha256>
node scripts/runner-candidate.mjs verify --candidate .local/candidates/imp-03-decision-2026-11-16 --tree .local/candidates/imp-03-decision-2026-11-16-restored --expect <manifestSha256>
```

`restore` no mezcla, sobrescribe ni borra un destino existente. Verifica antes
de escribir, comprueba nuevamente cada archivo al copiar y contrasta el árbol
resultante. Rechaza rutas absolutas/traversal, nombres no permitidos, enlaces
simbólicos/junctions y archivos enlazados físicamente. `verify` rechaza cambios,
archivos faltantes, archivos adicionales y directorios vacíos inesperados.
Una operación fallida puede dejar su carpeta nueva incompleta para inspección;
no se elimina automáticamente ni se certifica como válida.

El destino restaurado no incluye `.git`: la revisión original queda identificada
en el manifiesto y el estado de trabajo está representado por sus fuentes. Para
ejecutar la aplicación o sus suites después, preparar dependencias y servicios
según las guías existentes y generar una identidad de evidencia apropiada para
ese entorno. Este paquete no transforma los informes de otros candidatos en
pruebas del nuevo árbol.

Ejecutar `verify --tree` **antes** de instalar dependencias o generar `.git`,
builds u otros archivos. Las suites que consultan Git requieren inicializar un
repositorio nuevo **dentro del destino restaurado**, con identidad propia; no
ejecutar `git init` en el padre ni atribuirle el SHA original. Esto evita que una
restauración bajo `.local` herede accidentalmente el repositorio del anfitrión.
Después, seguir la preparación del `README.md` restaurado.

## Verificación del empaquetador

La suite focal es `tests/preproduction/runner-candidate.test.mjs`; usa repositorios
Git temporales con fuentes ficticias, independientes del repositorio del usuario.
Cubre conservación del estado no limpio, reproducibilidad, restauración exacta,
exclusión de privados, alteración/ausencia/adición, manifiesto modificado,
referencia externa de hash, traversal, junctions, rechazo de credenciales y
fixtures TLS no revisados. Un control de inventario advierte si nuevas fuentes
del proyecto quedan fuera de la política.

Comandos de comprobación focal:

```powershell
node --experimental-vm-modules node_modules/jest/bin/jest.js --config tests/preproduction/jest.config.cjs --runInBand --runTestsByPath tests/preproduction/runner-candidate.test.mjs
node node_modules/eslint/bin/eslint.js scripts/runner-candidate.mjs tests/preproduction/runner-candidate.test.mjs
node node_modules/prettier/bin/prettier.cjs --check scripts/runner-candidate.mjs tests/preproduction/runner-candidate.test.mjs docs/work/IMP-03-candidato-reproducible.md
```

Los recibos de preparación/verificación/restauración del candidato final se
entregan fuera de esta guía para evitar una dependencia circular de hashes.
Los campos `productTests=not-run-by-packager`, validación remota no evaluada y
aceptación humana no registrada permanecen explícitos en cada manifiesto.

Verificación del empaquetador ejecutada el 16/11/2026: **43/43 pruebas focales
aprobadas**, una suite, sin omisiones; ESLint y Prettier de los tres archivos
nuevos aprobados. Esto comprueba la herramienta de fuentes y sus rechazos; no
es una ejecución de las suites funcionales de Alunza ni de sus proveedores.
