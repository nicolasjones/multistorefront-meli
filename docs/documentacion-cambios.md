---
owner: tecnico
sources:
  - scripts/verificar-documentacion-cambios.mjs
  - scripts/verificar-documentacion-cambios.test.mjs
  - scripts/docs-correspondencia.mjs
  - scripts/docs-correspondencia.test.mjs
  - scripts/docs-lineas.mjs
  - scripts/docs-regex-barrido.test.mjs
  - scripts/docs-yaml.mjs
  - scripts/docs-check.mjs
  - scripts/docs-drift.mjs
  - scripts/docs-enlaces.mjs
  - scripts/docs-inventario.mjs
  - scripts/docs-manifest.mjs
  - .github/workflows/docs.yml
  - .github/workflows/validate.yml
  - apps/web/playwright.capturas.config.ts
---

# Documentación obligatoria de cambios

La documentación es parte del contrato de cada cambio. Cualquier modificación
en `apps/`, `workers/`, `supabase/`, `infra/`, `scripts/`, `packages/` o
`.github/` debe actualizar en el mismo cambio una spec, una guía en `docs/`,
`AGENTS.md`, `CLAUDE.md` o la constitución. En una corrección de bug cuenta también
el registro del flujo oficial en `.specify/bugs/<slug>/` (`assessment.md`,
`fix.md`, `test.md`) y la constitución en `.specify/memory/`; el resto de `.specify/`
(plantillas, scripts, extensiones) no cuenta como documentación.

El control `pnpm docs:check` compara la rama con su base Git y falla si detecta
código o infraestructura sin una actualización documental. En un pull request
el workflow obtiene el historial completo y usa `GITHUB_BASE_REF`; en local se
puede indicar otra base con `DOCUMENTATION_CHECK_BASE`. En `validate.yml` corre en el job `chequeos`
(`pnpm docs:check` y `pnpm test:docs:check`, que prueba el verificador, las trampas conocidas y el YAML del front matter).

La documentación debe registrar la decisión, el contrato afectado, los riesgos,
la validación ejecutada y cualquier limitación pendiente. Los archivos generados
(por ejemplo `docs/schema.html`) no reemplazan la documentación fuente.

## Correspondencia código-doc (MSF-869, modo aviso)

La regla de arriba se satisface con **cualquier** doc, aunque no tenga relación con el cambio (se elude tocando uno
cualquiera: MSF-688). Por eso `verificar-documentacion-cambios.mjs` hace una segunda verificación, por correspondencia,
que **reutiliza el mapa que ya existe**: el `sources:` del front matter de cada `docs/**/*.md` (el mismo que consumen
`docs-manifest.mjs` y `docs-drift.mjs`; no hay otro mapa que mantener). La lógica pura está en
`scripts/docs-correspondencia.mjs`.

- Para cada archivo cambiado de `apps|workers|supabase|infra|scripts|packages|.github` que figure en el `sources:` de uno o más
  docs (por ruta exacta o dentro de una carpeta listada), esos docs deberían cambiar también. Si ninguno de ellos cambió, el
  archivo se reporta.
- **No generan aviso:** archivos que no están en ningún `sources:`; tests (`*.test.*`, `*.spec.*`, `tests/`, `e2e/`, `fixtures/`),
  snapshots, lockfiles y `supabase/migrations/` (las cubre `verificar-migraciones`); fuentes que abarcan un área entera
  (`infra`, `.github/workflows`, una raíz de un solo segmento), porque no identifican un doc concreto; y docs con más de 40 fuentes.
- **Modo aviso (por defecto):** emite una anotación `::warning file=<doc>::` por doc (agrupa sus archivos) y una lista legible
  por doc en la salida, y **sale con 0**: no cambia ningún resultado de CI. El control heredado (código relevante sin ningún doc
  → exit 1) queda idéntico.
- **Modo estricto:** `DOCUMENTACION_CORRESPONDENCIA_ESTRICTA=1 node scripts/verificar-documentacion-cambios.mjs` (o el flag
  `--estricto`) convierte los avisos en `::error` y sale con 1. Para activarlo en el CI, definir esa variable en el job `chequeos`
  de `validate.yml`; conviene hacerlo solo cuando la tasa de ruido sea aceptable para el equipo.
- **Formatos de `sources:` aceptados:** lista en bloque, array en línea (`sources: [a, b]`), escalar (`sources: ruta`), `[]`,
  CRLF, comillas y comentarios finales (`- ruta # nota`). Produce el mismo mapa que `docs-manifest.mjs` para los 313 docs con fuentes.
- **Escape de anotaciones:** los nombres de archivo y de doc vienen del PR, así que se escapan como `@actions/core` (mensaje:
  `%`, CR, LF; propiedad `file=`: además `:` y `,`), y las listas legibles salen como `- nombre` en una sola línea y con los `::`
  neutralizados. Un archivo llamado `q%0A::add-mask::x.mjs` no puede inyectar comandos del runner.
- **Tolerancia a errores:** un `docs/*.md` ilegible, un symlink roto o una carpeta `*.md` se omiten; cualquier excepción dentro de
  la verificación por correspondencia emite `::warning ::no se pudo verificar la correspondencia: …` y sale con 0 (en modo estricto,
  `::error` y 1). El guard heredado corre antes y no depende de esto.
- **Rutas con caracteres no ASCII o especiales:** el diff se lee con `git -c core.quotepath=off diff --name-only -z` y se divide por
  `\0`, así `ñ`, espacios, comillas y saltos de línea llegan exactos (antes git los devolvía entre comillas con escapes octales y
  se descartaban sin aviso). Al imprimirlos pasan por el escape de anotaciones y `lineaLista`.
- **Protección contra ReDoS (tiempo lineal medido):** claves (`sources:`), ítems (`- x`) y comentarios (` # nota`) de `sources:` y
  del nav se parsean a mano, con un índice y sin regex que solapen `\s*` con `.*`/`.+`, en `scripts/docs-lineas.mjs`
  (`claveYValor`, `itemDeLista`, `itemDeListaConEspacio`, `sinComentario`). Esas regex eran cuadráticas porque `.` no casa con
  `\n`, `\r`, U+2028 ni U+2029 pero `\s` sí: con 200 000 blancos y un terminador en el medio de la línea el motor probaba todas las
  particiones (decenas de segundos). El helper lo usan `docs-manifest.mjs` (front matter), `docs-correspondencia.mjs`,
  `docs-yaml.mjs` y `docs-check.mjs` (nav). Las barras finales se quitan con un bucle. Las regex que quedan (rutas de código,
  `^---\n([\s\S]*?)\n---`, `^\[(.*)\]$`, bordes de comillas, escapes de un carácter) hacen un solo recorrido sin retroceso útil.
  No se afirma por inspección: `scripts/docs-regex-barrido.test.mjs` **enumera** con `readdirSync` todos los `scripts/docs-*.mjs`
  (sin tests) más `verificar-documentacion-cambios.mjs`, sin lista fija, así que un script nuevo entra solo. Extrae sus regex
  literales (ignora la línea `#!`) y las ejecuta con 100 000 caracteres hostiles: espacio, tab, NBSP, `-`, `#`, `:`, `x`, `\r`,
  U+2028, U+2029, U+0085, comillas, `[`, `,`, `/`, y también dígitos, letras, `.`, `_`, `=`, `<`, `>` y mezclas alfanuméricas
  (sin ellos no se detectan regex exponenciales como `^(\d+)+$` o `^(a|aa)+$`), combinados como prefijo + repetición +
  terminador (también en el medio) + cola (la cola vacía importa). Además importa los scripts que exportan funciones y llama a cada
  función exportada con las mismas entradas y los mismos prefijos. Cada regex o función corre en un `worker_thread` con
  vigilancia: si no hay progreso en 4 s (regex catastrófica) el worker se termina y el test falla en segundos
  **nombrando archivo:línea**; si una ejecución tarda más de 1 s (se repite 3 veces y vale el mínimo, para absorber el ruido de un
  host cargado) también falla. Una regex sin cuantificadores `*`, `+` ni `{}`, sin `?` y sin alternancia `|` hace trabajo
  proporcional a la entrada y se mide con una batería reducida; `?` repetido (`x?x?…x?xx…x`) y la alternancia sí pueden explotar,
  así que van a la batería completa (probado con `x?`×28 + `x`×28). La clasificación es conservadora: un `+` dentro de una clase
  `[+]` también cuenta como cuantificador, lo que solo manda esa regex a la batería completa. Se imprime la tabla de máximos: el
  máximo observado fue ~0,9 s en un host cargado con 4 workers en paralelo (233 ms en serie) y el tope es 1 s. El test completo
  tarda ~65 s.
  - **Qué cubre y qué no:** `docs-drift.mjs` no tiene regex (de él solo se cubre la enumeración). `docs-drift.mjs`,
    `docs-inventario.mjs`, `docs-manifest.mjs` y `verificar-documentacion-cambios.mjs` no exportan nada y corren al importarse:
    no se importan (lista `NO_IMPORTAR` del test) y se miden solo por sus regex literales; el manifest además tiene su test de
    proceso en `docs-manifest.test.mjs`.
  - **Defensa: lista blanca explícita.** El test solo importa los scripts de `IMPORTABLES` (`docs-check`,
    `docs-correspondencia`, `docs-enlaces`, `docs-lineas`, `docs-yaml`). Un `docs-*.mjs` con `export` que no esté ni en
    `IMPORTABLES` ni en `NO_IMPORTAR` hace fallar el test con un mensaje accionable («agregalo a IMPORTABLES tras revisar que no
    tiene efectos al importarse, o quitá el export»): ese script no se importa ni se ejecuta hasta que alguien lo agregue a una de
    las dos listas en un cambio revisado. Eso es cierto solo para los scripts **no listados**.
  - **Los scripts de la lista sí se ejecutan al importarse**, igual que cualquier otro código del PR que corre en la CI (el job
    corre en `pull_request`, sin secretos y sin `pull_request_target`), así que añadirles un efecto es un cambio de código que se
    revisa como cualquier otro. No hay detección automática de efectos: un análisis estático de «este script tiene efectos» no es
    defendible y se descartó. Convención: **un `docs-*.mjs` en `IMPORTABLES` no debe tener efectos al importarse** (proteger su
    main con un guard `import.meta.url`).
  - Mutaciones comprobadas: `^(\d+)+$`, `^(a|aa)+$` y `x?`×28 + `x`×28 hacen fallar el test por tiempo, como literal y las dos
    primeras también como función; `new RegExp('^\\s*-\\s*(.+)$')` en una función exportada y un script nuevo con `export` sin
    listar (que no llega a ejecutarse) lo hacen fallar; volver a cada regex vieja corregida también. Un ítem vacío se descarta
    (antes el manifest podía registrar `''`, que apuntaría a toda la raíz).
- **Tasa de ruido medida (2026-11-25)**, contra los 30 últimos PRs mergeados a `dokploy` (diff `padre1...padre2` de cada merge de
  primer padre): 7 de 30 PRs (23 %) habrían tenido avisos; de 124 archivos relevantes cambiados, 53 (43 %) tenían doc
  correspondiente sin tocar. Dos PRs grandes concentran la mayoría (25 y 5 avisos en `infra/kestra` y workers); el resto trae 3 a
  7. Sin el afinado de fuentes amplias eran 57 archivos y los avisos caían en el runbook `supabase-caido` (que declara `infra`
  y `.github/workflows` enteros). Por eso conviene mantener el modo aviso hasta revisar qué avisos son legítimos.

## Dueños (`owner`) y fuentes (`sources`) de cada página

Cada página de `docs/` declara en su front matter un `owner` y una lista `sources`
(`pnpm docs:wiki:check` falla si falta alguno; `sources: []` es válido solo para páginas
estáticas, como un índice). El validador acepta cualquier texto no vacío como `owner`; la
convención vigente usa cinco valores, según **quién responde por la exactitud de la página**:

| `owner` | Qué páginas |
|---|---|
| `producto` | Guías de uso y funcionales para quien opera el panel (`docs/producto/`, el índice `docs/README.md`, `guia-funcional.md`, `ayuda-en-panel.md`). |
| `tecnico` | Referencia de ingeniería de una funcionalidad: modelo de datos, RPC, RLS, migraciones, decisiones (`docs/tecnico/` y las guías planas `docs/<tema>.md`). Es el valor por defecto. |
| `plataforma` | CI, guardas de migraciones, pruebas, adopción de plantillas, revisiones de seguridad y acceso de soporte auditado. |
| `operacion` | Runbooks y procedimientos de operación: copias y restauración, simulacro, operar y entregar el sistema, pasos manuales en VPS2, monitoreo. |
| `datos` | Analítica y reportes (Superset, tableros y reportes de ventas, inventario, servicio y rentabilidad). |

Las fuentes (`sources`) son rutas que **existen** en el repo y que la propia página cita o
documenta: primero las carpetas `specs/<épica>` mencionadas en el texto, después `infra/`,
`workers/`, `scripts/`, `apps/`, `design/` y, por último, las migraciones o pruebas SQL que la
página nombra. Se usa la ruta más específica (no `specs` entero) para que el *drift* avise solo
cuando cambia algo que la página realmente documenta. Una página sin fuente verificable se
declara estática (`sources: []`); no se inventan fuentes.

Las guías planas `docs/<tema>.md` que tienen una versión reorganizada en `docs/tecnico/<tema>.md`
o `docs/producto/<tema>.md` no se borran: llevan un aviso cruzado con enlaces en ambos sentidos y
figuran en la sección «Guías de referencia» del menú, porque conservan detalle (contratos, RPC,
migraciones) que las versiones reorganizadas no siempre repiten. Los enlaces a `specs/` desde
`docs/` se escriben como ruta entre comillas invertidas, no como enlace Markdown, porque el sitio
solo publica `docs/` (`mkdocs build --strict` aborta con enlaces que salen del árbol). Las anclas
`#...` de MkDocs van sin tildes (`#reversion`, no `#reversión`).

## Control del wiki en `dokploy` y en el Release

`docs.yml` corre solo en PR hacia `main` y en push a `main`. Muchas páginas declaran como fuente un
directorio entero (`specs`, `supabase/migrations`, `apps/web/src`), así que el control de drift
(`node scripts/docs-drift.mjs`) salta con cualquier PR a `dokploy`. Antes del Release (MSF-858): revisar
las páginas que lista el drift y regenerar con `node scripts/docs-inventario.mjs && node scripts/docs-manifest.mjs`
en el PR `dokploy` → `main`. Acotar las fuentes de cada página a su spec o archivo concreto permitiría
volver a correr el control en cada PR.

## Campos del manifest (`docs/manifest.json`) y qué hacer cuando cambia una fuente

Cada página del manifest lleva `pageHash` (el texto de la página), `sourceHash` (las fuentes que la
página declara), `sourceAt` (el commit propio contra el que se calculó ese `sourceHash`) y `commit` (el
commit propio de la página). `sourceAt` y `commit` se calculan con `git log -1 --no-merges`: nunca HEAD,
porque en el CI HEAD es el merge efímero del PR (MSF-950).

- **Si cambia una fuente de una página**, esa página queda vieja (el drift la lista) y hay que
  actualizarla y regenerar el manifest: `node scripts/docs-inventario.mjs && node scripts/docs-manifest.mjs`.
- **`commit` nunca queda vacío** (MSF-895): si el manifest previo no lo traía, se completa con `sourceAt`
  y, si la página no declara fuentes, con el último commit propio de la página. Con eso, en toda página
  con fuentes se cumple `sourceAt == commit` y el drift puede mostrar el commit real en vez de «última: ?».
- **El manifest se regenera después del commit** de los archivos que toca: `sourceAt` es el commit de la
  página, así que regenerarlo antes de commitear dejaría el manifest apuntando al commit anterior.

## Capturas del manual: regla de proceso y estado (MSF-644, MSF-877)

**Regla (MSF-644).** Todo PR que cambia una pantalla rehace las capturas del manual de usuario que esa pantalla
ilustra. El comando es `pnpm docs:capturas` (raíz; delega en `pnpm --filter @platform/web docs:capturas`, que corre
`playwright test -c playwright.capturas.config.ts`, definido en `apps/web/package.json`). Para un solo spec:
`pnpm docs:capturas 20-ventas`. Los specs están en `apps/web/e2e/capturas/` (`10-primeros-pasos`, `20-ventas`,
`30-stock`, `40-catalogo-tiendas`, `50-service-consultas`, `pantallas`) y escriben en `docs/producto/img/<página>/`
(variable `CAPTURAS_DESTINO` para cambiar el destino). Si el PR no puede rehacerlas (p. ej. no hay stack), lo declara en
su descripción y la página queda anotada como pendiente de recaptura.

**Requisitos.** Stack local de Supabase con el dataset demo (`pnpm demo:dataset -- --reset`, ver `dataset-demo.md`) y la
web servida (`E2E_BASE_URL`) o el build para `vite preview`; variables `SUPABASE_URL` y `SUPABASE_ANON_KEY`. Las
capturas son de solo lectura (no confirman formularios). No corren con `pnpm test:e2e` ni en el CI público (config
aparte a propósito, `apps/web/playwright.capturas.config.ts`).

**Estado (MSF-877, 2026-11-17).** El repo tiene 262 imágenes versionadas bajo `docs/producto/img/`, en 44 carpetas.
La guía de uso es [Capturas del manual de usuario](capturas-documentacion.md). Esta revisión de documentación **no regeneró imágenes**, porque hacerlo exige levantar el stack con el dataset demo.
Las capturas de pantallas cambiadas hoy (Productos con Margen, Empresas, Migración de datos con pestañas, Actividad,
Importaciones) quedan pendientes de recaptura con el comando de arriba. Además, el comentario de
`playwright.capturas.config.ts` remite a `docs/capturas-documentacion.md`, que ahora existe.

## Ramas `main` y `dokploy`: estado y reconciliación de la documentación (MSF-590)

**Estado (medido el 2026-11-17 con `git rev-list --left-right --count origin/main...origin/dokploy`).** `main` tiene 16
commits que `dokploy` no tiene y `dokploy` tiene 4186 que `main` no tiene (ancestro común `54ea7b1b`). Los 16 de `main`
son de documentación salvo dos archivos de configuración: manual de Inicio con capturas (`docs/producto/img/inicio/`), alineación de avisos de
faltantes (MSF-161), cierres documentales de MSF-176, MSF-265, MSF-467 y MSF-469, y el workflow
`.github/workflows/e2e-nocturno.yml` (llevado a `main` para que dispare el cron) y un ajuste de `mkdocs.yml`. Entre
las puntas actuales de ambas ramas difieren 272 archivos de `docs/` (`git diff --stat origin/main origin/dokploy -- docs`);
de ellos, 51 son lo que `main` cambió desde el ancestro común (`git diff --stat 54ea7b1b origin/main -- docs`) y el resto
es lo que `dokploy` agregó o cambió desde entonces. La documentación de usuario quedó escrita en `main` sin el código que la respalda, que vive solo en
`dokploy`.

**Procedimiento de reconciliación (sin tocar `main` desde `dokploy`).**

1. La reconciliación ocurre en el PR `dokploy` → `main` (Release), no con cambios directos en `main`.
2. Antes del Release, en una rama desde `dokploy`: `git merge origin/main`. Los conflictos de `docs/` se resuelven a favor
   del contenido de `dokploy` (que refleja el código vigente) salvo los textos y capturas que solo existen en `main`
   (manual de Inicio), que se revisan contra el código de `dokploy` antes de conservarlos.
3. `docs/manifest.json` y `docs/_generated/` no se resuelven a mano: en ese `git merge origin/main` estás parado en la rama que integra (la de `dokploy`), así que
   `--ours` es tu versión y `--theirs` la de `main` (el estado viejo): `git checkout --ours docs/manifest.json docs/_generated`
   y regenerar con
   `node scripts/docs-inventario.mjs && node scripts/docs-manifest.mjs`.
4. Correr `node scripts/docs-drift.mjs` y `node scripts/docs-check.mjs`; revisar las páginas con deriva (MSF-858).
5. Recién entonces abrir el PR a `main`; `docs.yml` corre en PR hacia `main`.

Pendiente: este procedimiento no se ejecutó en este lote (no se tocó `main`); la integración de `origin/main` en `dokploy`
queda para quien prepare el Release.

**Páginas planas fuera del menú.** `mkdocs.yml` no lista todas las páginas planas de `docs/` (p. ej. `control-ci.md`,
`deployment.md`, `documentacion-cambios.md`, `capturas-documentacion.md` y `decisiones-2026-11-17.md`): el menú solo
muestra las guías de uso y las «Guías de referencia» elegidas, y `docs-check` valida que cada entrada del menú exista y
que los enlaces internos resuelvan, pero no exige que toda página esté en el menú. Esas páginas se publican igual y se
llegan por enlace; por eso `capturas-documentacion.md` se enlaza desde esta página y desde `dataset-demo.md`.

**Límites conocidos del validador de enlaces.** `docs-check` (`scripts/docs-enlaces.mjs`) valida, fuera de los bloques de
código, los enlaces en línea (también anidados, como una imagen dentro de un enlace), los destinos entre `<…>` con
espacios, las definiciones de referencia y las etiquetas HTML `a` (atributo `href`) e `img` (atributo `src`). Falla si un
enlace excede un tope (texto 1500, destino 300, título 1000 y blancos 1000 caracteres; una etiqueta HTML de más de 1000 no falla: simplemente no se analiza, ver abajo) o si un bloque de
código queda sin cerrar. No valida, con ejemplo:

```text
Uso de una referencia:        [texto][x]  y  [x][]   (solo se valida el destino de su definición «[x]: destino»;
                                                       una referencia sin definición se muestra literal)
Otras etiquetas HTML:         <source src=…>  <link href=…>  <video src=…>  srcset=…
Destino con espacios sin <>:  [a](mi archivo.md)
Corchete escapado en texto:   [a\]b](x.md)   (los escapes con barra no se interpretan, igual que antes; así
                              `\[c](y.md)` SÍ se valida aunque no se muestre como enlace)
Etiqueta HTML > 1000 car.:    <img … 1000 caracteres de atributos … src=…>   (no se analiza y no da error)
Destino entre <> en 2 líneas: [x](<a + salto de línea + b>)
Texto y destino en 2 líneas:  [a] + salto de línea + (b.md)   (CommonMark tampoco lo trata como enlace)
Fence con sangría 2-3 sin lista: un fence de nivel superior sangrado 2 o 3 espacios se trata como de un ítem de lista;
                              si su código tiene líneas con menos sangría, se reporta como sin cerrar
Fence sangrado 4 o más:       un fence con 4+ espacios de sangría abre bloque igual (tolerancia para listas anidadas)
Comentario HTML:              <!-- [a](roto.md) -->   SÍ se valida (un comentario no se enmascara)
Paréntesis en el destino:     [a](x(1).md)   extrae «x(1» (el destino termina en el primer «)»)
Fence en bloque HTML:         <div> + línea con ``` o ~~~ sin línea vacía entre medio: no abre fence (se valida de más);
                              si es ambiguo se analiza de las dos formas y se validan los enlaces de ambas
Fence mal anidado:            «- > ```» cerrado por «> ```» (pila de contenedores distinta) o un ítem hermano de la lista:
                              el fence termina, se reporta «bloque de código sin cerrar» y se valida lo que sigue
No se extraen (dokploy tampoco): [x](<a + salto de línea + b>)   <a/href=roto.md>   y en <a href="x" href="roto.md"> solo
                              cuenta el primer href
Tipos de fence:               ~~~ cuenta como fence; un fence de backticks con backtick en la info (``` a`b) no abre
Sangría 4+ y fences en cita:  un fence con 4+ espacios de sangría combinado con fences dentro de citas o listas puede
                              ocultar un enlace sin error (el extractor anterior también lo ocultaba)
Destino con backticks:        [a](`x`.md) y similares: el extractor anterior lo leía con otro prefijo; ambos dan un
                              destino roto, y se reporta el actual
Código con sangría de 4:      un enlace dentro de un bloque con sangría, o dentro de código en línea, SÍ se valida
```

Un bloque con fences mezclados se interpreta como CommonMark: cierra solo con el mismo carácter (backtick o tilde) y una
longitud igual o mayor a la de apertura.
