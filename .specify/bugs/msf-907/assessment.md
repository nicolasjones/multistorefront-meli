# Bug Assessment: ítems con descripción casi vacía: el runner no deriva criterios y degrada en silencio

- **Slug**: msf-907 (provisto por el usuario)
- **Created**: 2026-11-14
- **Source**: pasted text — "[Auditoría] 13 ítems con descripción casi vacía: el runner no puede derivar criterios (It's a Plan MSF-907) slug=msf-907". Sin URL: no hay nada que traer.
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

> [Auditoría] 13 ítems con descripción casi vacía: el runner no puede derivar criterios.

Una auditoría del flujo de entrega detectó **13 ítems** cuya **descripción está casi vacía**.
El runner que ejecuta cada ítem **no puede derivar los criterios de aceptación** a partir de
esa descripción, así que esos 13 ítems quedan sin criterios: no se puede saber a qué historia
pertenecen ni qué escenarios los cubren, y la evidencia que se genera para ellos sale sin
criterios (y, en algunos casos, mal clasificada o perdida).

El reporte es una línea y no trae más detalle (ni URL, ni el listado de los 13 ítems, ni el
nombre del runner). Lo que sí se puede verificar en el repo es el **mecanismo**: en este
repo el runner del SDLC (la cadena de cobertura E2E → manifiesto → video → panel SDLC)
**deriva todo de la descripción del ítem** y **no valida nunca esa descripción**, de modo que
una descripción casi vacía no falla: degrada en silencio.

## Symptom

El pipeline de cobertura (`scripts/cobertura-e2e.mjs` → `scripts/armar-video-evidencia.mjs` →
`scripts/e2e-cobertura-epicas.py`) trata la **descripción/texto del ítem** como la única
fuente de verdad para tres cosas: a qué **historia** pertenece el ítem, qué **criterios de
aceptación** lo cubren, y si el ítem necesita **video** (pantalla) o es **sólo base de datos**.

Cuando el texto del ítem está casi vacío (o no trae el código de historia `F-XX-NN` de la
forma que el runner espera), la derivación **no falla con error**: devuelve vacío.

- Sin historia → **sin criterios**: la evidencia sale con `criterios: []` y la tarjeta de
  video no muestra ningún escenario; en el panel SDLC el checklist de la historia queda vacío.
- Sin historia → el ítem se agrupa por su id de tarea (`Txxx`) en vez de por su historia, y la
  tarjeta usa el texto del ítem como descripción (que es justamente lo que está vacío).
- Texto vacío en el clasificador pantalla/base → el ítem se cuenta como **«sólo base de
  datos»**, o sea «no necesita E2E con video»: nadie escribe el test y nadie se entera de que
  el ítem se quedó sin cubrir.
- En el reporte de cobertura por épica, el ítem ni siquiera aparece: el runner working-tree
  **nunca calcula la historia** de los ítems, así que el reporte sale `historias=0`,
  `SIN E2E=0`, `sólo base=0` para toda épica cuya spec esté en el working tree.

Esperado: un ítem sin descripción utilizable tiene que quedar **explícitamente** marcado como
«no derivable» (con su motivo), no pasar por una clasificación por omisión.

## Reproduction

### A. El runner de cobertura no deriva criterios de las historias que el repo sí escribe

1. `node -e "import('./scripts/cobertura-e2e.mjs').then(m => console.log(m.leerCriterios('specs/20261021-183246-ingreso-de-mercaderia-por-proveedor/spec.md')))"`
   → devuelve un mapa **vacío**: esa spec tiene tres historias
   (`### User Story 1 - Registrar ingreso de mercadería (MSF-383 · F-PRV-04, P0, talla L)`,
   línea 180) y ninguna es derivable, porque `leerCriterios` (`scripts/cobertura-e2e.mjs:54`)
   exige que el código de historia vaya **inmediatamente después de un `(`**:
   `\((F-[A-Z]+-\d+)\b`.
2. Consecuencia medida sobre todo el repo: de **306 historias** en `specs/*/spec.md`, el runner
   deriva **153**; las **153** restantes son exactamente las que escriben la historia como
   `(MSF-383 · F-PRV-04, P0, talla L)` (código de historia **dentro** de un paréntesis con
   otros datos, no como paréntesis propio).
3. Y dos historias citadas por tests E2E no tienencriteria que derivar:
   `F-CLI-20` (`apps/web/e2e/tienda-cuenta.e2e.ts`) y `F-PRE-11`
   (`apps/web/e2e/tienda-promocion.e2e.ts`) → el manifiesto los marca como
   *«historia F-XX-NN inexistente en los specs»* (`scripts/cobertura-e2e.mjs:173`) y su
   evidencia queda con `criterios: []`.

### B. El ítem y su historia se unen por la descripción, con dos reglas distintas

1. `scripts/armar-video-evidencia.mjs:57` exige que el código de historia esté **al principio**
   del texto del ítem: `String(item?.texto ?? '').match(/^\[(F-[A-Z]+-\d+)\]/)`.
2. `scripts/e2e-cobertura-epicas.py:125` lo busca **en cualquier parte** de la línea:
   `re.search(r"\[(F-[A-Z0-9]+-\d+)\]", txt)`.
3. Hay **611 ítems** en `specs/*/tasks.md` cuyo texto empieza con `[P] [F-XX-NN][USn] …`:
   para ellos la regla de (1) no matchea y el ítem **no se une a su historia**; el video se
   agrupa por id de tarea (`scripts/armar-video-evidencia.mjs:58`) y la tarjeta usa
   `textoItem(item.texto)` como descripción.
4. `textoItem` (`scripts/armar-video-evidencia.mjs:33-40`) recorta el texto en la primera
   frase: en los ítems más cortos del repo la descripción que queda es de 3 a 26 caracteres
   («E2E», «Revisar», «Documentación», «Actualizar el fixture de») — es decir, **la descripción
   casi vacía que ve la auditoría es la que arma el propio runner**.

### C. El reporte de cobertura por épica no ve ningún ítem (working tree)

1. `python3 scripts/e2e-cobertura-epicas.py --epicas MSF-136` (o cualquier épica cuya spec
   esté en el working tree) imprime `historias=0 SIN E2E=0 solo base=0`.
2. Causa: `tareas_de_epica` (línea 87) encuentra la spec en el working tree y devuelve
   `tareas_de(spec.parent)` (línea 145), que arma `{id, hecha, texto}` **sin la clave
   `historia`**; sólo la rama que lee la spec desde una **rama remota** (líneas 121-128)
   calcula `historia` con el `re.search`. Como el caso normal es la spec en el working tree,
   `historias` (línea 177) queda siempre vacío.
3. Medido: hay **1852 ítems** con un código de historia en su texto que ese runner no ve.

### D. Una descripción vacía se clasifica como «sólo base de datos» (silencio)

1. `PANTALLA` (línea 30) y `BASE_DATOS` (línea 36) clasifican el ítem por **regex sobre el
   texto** del ítem.
2. Si el texto está casi vacío no matchea ninguna: el ítem no entra en `faltan_hist`
   (línea 189) y sí en `base_hist` (línea 190) → se reporta como
   **«sólo base de datos (pgTAP, sin video)»**: el ítem **no necesita E2E con video**, nadie lo
   escribe y el reporte no marca nada raro.

## Suspected Code Paths

- `scripts/cobertura-e2e.mjs:49-65` (`leerCriterios`) — **única** fuente de criterios de
  aceptación por historia: exige el encabezado `### User Story N - <título> (F-XX-NN` y las
  líneas numeradas justo debajo. Es la regla que decide si una historia tiene criterios.
- `scripts/cobertura-e2e.mjs:44-46` (`extraerCriterios`) y `:165-196` — los criterios se
  anexan sólo a partir de la etiqueta `[F-XX-NN#n]` del título del test; si la historia no se
  encuentra, el test va a `huerfanos` (`:173`) y la evidencia queda con `criterios: []`.
- `scripts/cobertura-e2e.mjs:125-132` (`leerItems`) — lee el texto del ítem de `tasks.md`
  **sin ningún mínimo de contenido**: un texto vacío es un ítem válido.
- `scripts/armar-video-evidencia.mjs:57-59` — une el ítem con su historia leyendo el código
  `F-XX-NN` **sólo al principio** del texto; si no matchea, el ítem cae al id de tarea y la
  tarjeta muestra `textoItem(item.texto)` (`:33-40`), es decir la descripción recortada.
- `scripts/armar-video-evidencia.mjs:210-212` (`hijoDelItem`) — el video se publica en la
  historia hija de la épica **por coincidencia de título** (`\bTxxx\b` / `\bF-XX-NN\b`); con
  títulos o descripciones vacíos no hay match y el video se adjunta a la épica
  («ninguna historia lo menciona», `:255`), y la historia no recibe el comentario (`:257-259`).
- `scripts/e2e-cobertura-epicas.py:145-155` (`tareas_de`) — parsea el texto del ítem **línea por
  línea** (no une las líneas de continuación) y **no calcula la clave `historia`**: el reporte
  working tree sale siempre en cero (`:177-196`).
- `scripts/e2e-cobertura-epicas.py:30-42, 182-193` — la clasificación pantalla/base es por
  regex sobre el texto; un texto casi vacío cae en «sólo base de datos» sin avisar.
- `scripts/prototipo-inventario.mjs:80` — el mismo contrato para los ítems de UI: *«Cada ítem
  [ ] debe mapear a un criterio de aceptación de la spec o declararse fuera de alcance
  explícito»*. El inventario saca la etiqueta del texto visible del prototipo, así que 15 ítems
  quedan con descripción casi vacía (7 diálogos titulados `·`, 6 botones `· ▾`, 2 columnas
  `·`/`··`): igual de inubicables en la matriz.

## Root Cause Hypothesis

Confianza **alta** en el mecanismo, **media** en a cuál runner se refiere exactamente la
auditoría (el reporte no lo nombra).

El runner del SDLC trata la **descripción del ítem** como la única fuente de verdad y **no la
valida**: no hay longitud mínima, no hay comprobación de que la descripción lleve el código de
historia, y no hay un estado explícito de «no derivable». Por eso una descripción casi vacía no
produce un error: produce una degradación silenciosa (sin criterios, agrupa por tarea en vez de
por historia, clasificada como «sólo base de datos» y por lo tanto sin E2E, o directamente
invisible en el reporte por épica). Encima, los tres consumidores **no coinciden entre sí**
en cómo se lee el código de historia (`^\[F-XX-NN\]` en el ensamblador de videos,
`\[F-XX-NN\]` en cualquier posición y sólo en la primera línea en el script de cobertura,
`\((F-XX-NN)\b` en el encabezado del spec) y uno de ellos **perdió del todo** la clave
`historia` en su camino principal (working tree).

Es decir: la descripción del ítem es un **contrato de entrada sin contrato**. Cuando el
proveedor (la auditoría que crea los ítems en el tracker) entrega una descripción casi vacía,
el runner no puede derivar los criterios — y además **no lo dice**, que es lo que convierte
13 ítems sin criterios en un problema invisible en lugar de una cola de trabajo visible.

## Proposed Remediation

**Preferred**: hacer que el runner **falle visible** ante una descripción no utilizable y
**unificar** la regla con la que se lee el código de historia. Tres cambios, en el orden:

1. **Criterio explícito de descripción utilizable** (mínimo verificable):
   - `scripts/e2e-cobertura-epicas.py`: `tareas_de()` (línea 145) debe (a) calcular `historia`
     igual que la rama de rama remota (líneas 121-128), (b) unir las líneas de continuación
     del ítem (hoy el texto se corta en la primera línea) y (c) marcar el ítem como
     **«texto insuficiente»** cuando, quitarle las etiquetas, no queda texto o no queda ningún
     código `F-XX-NN`. Ese grupo va en una **columna propia** del reporte, no dentro de
     «sólo base de datos».
   - `scripts/cobertura-e2e.mjs`: `leerItems` (línea 125) marca los ítems con descripción
     inutilizable y `generarManifiesto` los publica en una lista nueva
     `items_sin_descripcion`; la línea de resumen (línea 294) los cuenta. La clave es
     **aditiva**: el panel SDLC (repo vecino) la ignora hasta que la consuma.
   - `scripts/armar-video-evidencia.mjs`: cuando la descripción del ítem no es utilizable, la
     tarjeta no muestra un subtítulo vacío: muestra el id del ítem y la historia, y el video
     se publica marcado **«sin criterios»** en vez de dejar de publicar la historia.
2. **Una sola regla para leer el código de historia**, en un helper compartido por los tres
   scripts: el código puede aparecer en cualquier posición de la primera línea del ítem
   (hoy `armar-video-evidencia.mjs:57` exige que esté al principio y por eso falla en 611
   ítems), y el encabezado de historia del spec se acepta tanto como `(F-XX-NN)` como
   `(MSF-383 · F-PRV-04, …)` (`leerCriterios`, línea 54), que es como están escritas 153
   historias del repo.
3. **Cerrar el pedido del tracker**: con (1) sale una lista determinista de los ítems que hay
   que completar; el relleno de la descripción de los 13 ítems es **externo al repo** (están en
   It's a Plan) y hay que hacerlo en el tracker: descripción con el código de historia y la
   referencia a los criterios.

**Alternatives** (con su trade-off):

- **Resolver la historia desde el spec en vez de desde la descripción del ítem** (el ítem sólo
  aporta su id `Txxx`): elimina de raíz la dependencia de la descripción, pero cambia el
  contrato del manifiesto (`items[].texto` deja de ser la fuente) y obliga a tocar el panel
  SDLC. Es la solución de fondo si el tracker va a seguir feeding ítems al runner.
- **Hacer que el runner salga con código ≠ 0** cuando hay ítems no derivables: más fuerte
  (roba el foco en el CI) pero convierte un hueco silencioso en un rojo por cada épica con
  specs viejas; conviene como reporte + gate aparte, no como el comportamiento por defecto.
- **Sólo rellenar las 13 descripciones en el tracker**: deja el mecanismo intacto: el próximo
  ítem con descripción floja vuelve a degradar en silencio.

**Files likely to change**:

- `scripts/e2e-cobertura-epicas.py` (y un test nuevo: hoy el script **no tiene ninguno**)
- `scripts/cobertura-e2e.mjs`, `scripts/cobertura-e2e.test.mjs`
- `scripts/armar-video-evidencia.mjs`, `scripts/armar-video-evidencia.test.mjs`
- `docs/e2e-app.md` (la sección «Cobertura por historia con video» documenta el contrato del
  manifiesto y del runner: cualquier clave nueva va documentada ahí)
- `package.json` (el script de cobertura por épica no tiene entrada propia hoy: hace falta una
  forma de correrlo y ver la columna nueva)

**Tests to add or update**:

- `scripts/e2e-cobertura-epicas.py`: ítem con texto vacío → aparece en «texto insuficiente» y
  **no** en «sólo base de datos»; ítem con `[P] [F-XX-NN][US1] …` → su historia se calcula;
  ítem cuya descripción sigue en la línea siguiente → el texto se une (no se corta).
- `scripts/cobertura-e2e.test.mjs`: un `spec.md` con encabezado `(MSF-383 · F-PRV-04, P0, talla L)`
  **sí** produce criterios con `leerCriterios`; un ítem con texto vacío queda en
  `items_sin_descripcion` y no se cuela en `sin_cubrir` como si estuviera cubierto.
- `scripts/armar-video-evidencia.test.mjs`: el código de historia se lee con la misma regla
  que el runner de cobertura (ítem con `[P] [F-XX-NN]…` → se une a la historia); un ítem con
  descripción inutilizable no genera una tarjeta con subtítulo vacío.

## Risks & Considerations

- **Contrato del manifiesto**: `cobertura-e2e.json` lo consume el panel SDLC (repo vecino).
  Agregar `items_sin_descripcion` es aditivo, pero hay que avisarlo al dueño del panel para que
  la lista no quede invisible del otro lado. [NEEDS CLARIFICATION: quién consume el manifiesto
  y si tolera una clave nueva.]
- **Ruido en los números**: cambiar la clasificación de `e2e-cobertura-epicas.py` cambia el
  reporte de «necesita E2E con video» (hoy, con el bug, ese número es 0 en el working tree):
  la primera corrida después del arreglo va a mostrar una cifra muy distinta. Hay que
  rebaselinear y decirlo en el PR.
- **Ambigüedad al relajar el regex del encabezado**: aceptar el código de historia en
  cualquier posición del paréntesis puede matchear dos historias del mismo spec. Hay que
  reportar la ambigüedad (el manifiesto ya tiene `hallado.ambiguo` para el caso equivalente
  de las tareas) en vez de elegir en silencio.
- **No arregla los 13 ítems**: el repo no puede completar descripciones que viven en el
  tracker. El arreglo los hace **visibles**; el texto de los 13 sigue siendo trabajo de quien
  los creó.
- **Sin riesgo de datos ni de seguridad**: es tooling de desarrollo (scripts y su salida);
  no toca migraciones, RLS, API ni secretos.

## Open Questions

- [NEEDS CLARIFICATION: cuál es exactamente el «runner» de la auditoría — ¿el runner de
  cobertura E2E de este repo (`scripts/cobertura-e2e.mjs`), el runner del panel SDLC (repo
  vecino, `POST {runner}/correr`) o el agente que implementa los ítems del tracker? El
  reporte no lo dice. En los dos primeros casos el mecanismo descrito arriba es el mismo; en el
  tercero, la evidencia del repo es sólo indirecta (la descripción del ítem del tracker es la
  entrada del agente).]
- [NEEDS CLARIFICATION: dónde están los 13 ítems (proyecto/clave en It's a Plan) y cuál es el
  contenido mínimo que cuenta como «descripción utilizable»: ¿el código de historia
  (`F-XX-NN`), un mínimo de caracteres, o los dos?]
- [NEEDS CLARIFICATION: la «descripción» de la auditoría es la del ítem en el tracker o el
  texto del ítem en `tasks.md`? De eso depende si el arreglo es de scripts (este repo) o de
  datos (tracker).]
- [NEEDS CLARIFICATION: ¿las 153 historias con el encabezado `(MSF-383 · F-PRV-04, …)` deben
  contar como histories con criterios (y por lo tanto generar evidencia con escenarios), o el
  formato nuevo es intencional y lo que hay que corregir es el runner para que acepte ambos
  formatos?]
