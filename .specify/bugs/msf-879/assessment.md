# Bug Assessment: E2E con sesión y fixture compartido (lote L18, 4 bugs consolidados)

- **Slug**: msf-879 (provisto por el usuario)
- **Created**: 2026-11-14
- **Source**: pasted text — "[Lote L18] E2E con sesión y fixture compartido (4 bugs consolidados) (It's a Plan MSF-879) slug=msf-879". Sin URL: no hay nada que traer (no aplica la URL Trust Policy).
- **Verdict**: valid (3 de los 4 hallazgos, verificados en esta base; 1 de los 4 ya está corregido en esta rama)
- **Severity**: medium

## Report (verbatim)

> [Lote L18] E2E con sesión y fixture compartido (4 bugs consolidados)

El reporte llega sólo como título: no trae URL, pasos ni capturas. Los cuatro hallazgos
del lote se reconstruyeron desde el código de la suite E2E y desde las notas de la
revisión que los originó. Cada uno va con su evidencia en el repo.

### Los cuatro hallazgos del lote

| # | Hallazgo | Dónde | Estado en esta base |
| --- | --- | --- | --- |
| 1 | El fixture compartido no exporta los tipos de Playwright: un spec que importe `type Page` de `./fixture` no compila (TS2305) y ningún gate lo detecta | `apps/web/e2e/fixture.ts:10,18,30,64` | **Vigente** (ya rompió el PR #869) |
| 2 | 40 de los 83 specs importan `test`/`expect` de `@playwright/test` en vez del fixture compartido → pierden el video 1920×1080, el `meta.json` y el viewport HD | `apps/web/e2e/*.e2e.ts` (10 son `tienda-*`, que corren en el CI) | **Vigente** |
| 3 | El login de una persona se pide con la **service-role** en la cabecera `Authorization` (en vez de la anon key) → la "sesión" del E2E puede no ser la del rol probado | `apps/web/e2e/semillas.ts:27-31`, `apps/web/e2e/ventas-faltantes-soporte.ts:21-24` | **Vigente** (falta reproducir contra el stack local) |
| 4 | Cualquier sesión abierta alcanza para entrar a `/definir-contrasena` (navegador compartido) | `apps/web/src/pages/tienda-publica/rutas/definir-contrasena.tsx` | **Ya corregido** (MSF-428, `apps/web/src/lib/enlaceAuth.ts`) |

## Symptom

La suite E2E con sesión y el fixture que la sostiene (`apps/web/e2e/fixture.ts` +
`apps/web/e2e/soporte/fixtures.ts` + `apps/web/e2e/semillas.ts`) se apartaron del
estándar que ellos mismos escriben: el fixture declara que "los tests importan
`test`/`expect` de acá, nunca de `@playwright/test`" y que "todo test que pruebe una
historia graba SIEMPRE su video a 1920x1080", pero 40 de los 83 specs no lo usan.
El resultado son tres fallos encadenados:

1. **El fixture no es importable completo.** `fixture.ts` importa `Browser`,
   `BrowserContext`, `Page` y `TestInfo` de `@playwright/test` (línea 10) y los usa en
   firmas públicas (`abrirContextoGrabado`, `cerrarContextoGrabado`), pero no los
   re-exporta: lo único que exporta al final es `expect` (línea 64). Un spec que
   necesite el tipo `Page` no puede tomarlo del fixture ⇒ **TS2305**. Ya pasó en el
   PR #869: `apps/web/e2e/ordenes-compra.e2e.ts:2` (rama `feat/story-MSF-454`) hace
   `import { expect, test, type Page } from './fixture'` y no compila.
2. **El error es invisible.** `apps/web/tsconfig.app.json` tiene `"include": ["src"]`
   (línea 25) y el build de la web es `tsc -b && vite build` (`apps/web/package.json`):
   la carpeta `e2e/` **no entra en ningún type-check**. `oxlint` (`pnpm lint`) tampoco
   type-chequea. El rojo aparece recién cuando alguien compila ese spec a mano.
3. **El escape improvisado rompe la evidencia.** Como el fixture no exporta `Page`,
   la salida fácil es importar todo de `@playwright/test`, y eso es exactamente lo que
   hacen 40 specs (43 usan el fixture; 40 + 43 = 83, el total). Los que así lo hacen
   usan el `page` por defecto de Playwright: **sin `recordVideo` 1920×1080, sin
   `meta.json`, con el viewport del device (1280×720), sin `locale: 'es-AR'` y sin
   `reducedMotion: 'reduce'`** que el fixture sí fija (líneas 19-26). Diez de esos 40
   son `tienda-*` y **corren en el CI** (job `e2e-tienda`), así que el manifiesto de
   cobertura los deja sin video: `scripts/cobertura-e2e.mjs:87-99` (`videoDe`) busca el
   adjunto `video/webm` que agrega el fixture (`cerrarContextoGrabado`, línea 35) y no
   lo encuentra ⇒ `video: null` para esas historias (línea 194).
4. **La "sesión" del E2E no es la del rol que se quiere probar.** `semillas.ts` y
   `ventas-faltantes-soporte.ts` piden el token de una persona a `/auth/v1/token`
   **con la service-role en `Authorization`** (`cabeceras()` → `apps/web/e2e/soporte/fixtures.ts:11-16`),
   mientras el helper equivalente de `importaciones-soporte.ts:60-67` usa la **anon
   key**. Ese token es el que se manda como `Authorization` de la RPC de negocio
   (`semillas.ts:75-77`, `registrar_movimiento_stock`) para comprobar que **ese rol**
   puede mover stock. Si la petición se autentica como service-role, la RPC corre sin
   RLS ⇒ el spec pasa aunque el rol no pudiera ⇒ **verde falso de permisos**.

## Reproduction

### 1. El fixture no exporta los tipos (TS2305)

1. `cd apps/web` y abrir un spec nuevo que necesite el tipo `Page` del fixture.
2. Escribir `import { expect, test, type Page } from './fixture'`.
3. `pnpm exec tsc --noEmit --moduleResolution bundler --module esnext --target es2023 e2e/ordenes-compra.e2e.ts`
   (o el type-check del editor) ⇒ `error TS2305: Module '"./fixture"' has no exported member 'Page'`.
4. `pnpm build` **pasa igual**: `apps/web/tsconfig.app.json` sólo incluye `src`, así que
   `e2e/` nunca se type-chequea. Lo mismo `pnpm lint`.

### 2. Los specs se saltan el fixture compartido (evidencia sin video)

1. `grep -l "import {[^}]*\\btest\\b[^}]*} from '@playwright/test'" apps/web/e2e/*.e2e.ts | grep -v fixture.ts`
   ⇒ 40 archivos (10 `tienda-*` que corren en el job `e2e-tienda`).
2. En cualquiera de ellos (p. ej. `apps/web/e2e/tienda-catalogo.e2e.ts:2`): el `page` es
   el de fábrica, no el del fixture ⇒ **no hay `recordVideo` a 1920×1080** ni `meta.json`.
3. Tras una corrida, `scripts/cobertura-e2e.mjs --report … --results …` deja `video: null`
   para esas historias, y `scripts/publicar-videos-e2e.mjs` las publica como
   «Sin video en esta corrida».

### 3. El login de una persona con la service-role

1. `apps/web/e2e/semillas.ts:27-31` (`tokenDe`): `POST /auth/v1/token?grant_type=password`
   con `headers: cabeceras()` ⇒ `apikey: <service_role>` **y** `authorization: Bearer <service_role>`.
2. `apps/web/e2e/importaciones-soporte.ts:60-67` hace lo mismo con
   `headers: { apikey: anonKey, 'content-type': 'application/json' }` (sin bearer).
3. El token devuelto se usa como `Authorization` de la RPC de negocio
   (`semillas.ts:75-77`). Con el stack local: comparar el `role` del JWT devuelto con
   el del usuario sembrado (`semillas.ts:27-31` + `supabase/seed.sql`).
   [NEEDS CLARIFICATION: hay que confirmar contra la versión de GoTrue del stack local
   si la cabecera `Authorization: Bearer <service_role>` hace que `/token` responda con
   la identidad de servicio; la divergencia entre los tres helpers sí está verificada.]

### 4. El estado compartido entre specs (contextualiza el lote)

1. `apps/web/playwright.config.ts:20` pone `fullyParallel: true` y no limita `workers`.
2. `tienda-cuenta`, `tienda-lista-pedido` y `tienda-presupuesto` encienden y apagan la
   **misma** bandera global `banderas_plataforma.tienda_pedidos` (`beforeAll`/`afterAll`)
   y comparten las dos tiendas del seed.
3. En local, `pnpm test:e2e` corre los archivos en paralelo (workers por defecto) ⇒ uno
   restaura la bandera mientras el otro sigue ⇒ fallo o verde falso. El CI lo tapa con
   `--workers=1` (job `e2e-tienda`), y `docs/e2e-app.md:236` ya lo admite.

### 5. El hallazgo de la ruta de contraseña (ya corregido)

1. `apps/web/src/pages/tienda-publica/rutas/definir-contrasena.tsx:30` exige
   `sesion && llegoPorEnlace()`; `apps/web/src/lib/enlaceAuth.ts` marca en
   `sessionStorage` si la carga vino de un enlace de Auth (invitación o
   restablecimiento).
2. Con una sesión viva **sin** venir de un enlace, la ruta cae en «El enlace venció o ya
   se usó» ⇒ el cambio de contraseña sin conocer la actual no se puede hacer.

## Suspected Code Paths

- `apps/web/e2e/fixture.ts:10` — importa `Browser`, `BrowserContext`, `Page`, `TestInfo`
  de `@playwright/test`; `:18` y `:30` los usan en firmas públicas y `:64` exporta sólo
  `expect`. Falta el re-export de los tipos ⇒ TS2305 al importarlos desde el fixture.
- `apps/web/e2e/fixture.ts:19-26` — el contexto grabado (viewport 1920×1080,
  `recordVideo`, `locale: 'es-AR'`, `reducedMotion`, `ignoreHTTPSErrors`) que se pierde
  cuando el spec usa el `test` de `@playwright/test`.
- `apps/web/e2e/fixture.ts:30-52` (`cerrarContextoGrabado`) — adjunta el video al
  reporte; es el único origen del adjunto que lee `scripts/cobertura-e2e.mjs:87-99`.
- `apps/web/tsconfig.app.json:25` — `"include": ["src"]`: la carpeta `e2e/` no entra en
  `tsc -b` (build de `apps/web/package.json`) ⇒ ningún error de tipos de los specs se ve.
- `apps/web/e2e/ordenes-compra.e2e.ts:2` (rama `feat/story-MSF-454`, PR #869) —
  `import { expect, test, type Page } from './fixture'`: el caso concreto del TS2305.
- `apps/web/e2e/semillas.ts:27-31` — `tokenDe` pide la sesión de una persona con la
  service-role en `Authorization`; `:73-77` usa ese token en la RPC de negocio.
- `apps/web/e2e/ventas-faltantes-soporte.ts:21-24` — mismo `tokenDe` con `cabeceras()`.
- `apps/web/e2e/importaciones-soporte.ts:60-67` — el patrón correcto (anon key, sin
  bearer de service-role) que los otros dos deberían seguir.
- `apps/web/e2e/soporte/fixtures.ts:11-16` — `cabeceras()` con la service-role: es la
  helper correcta para *siembra*, no para *login de una persona*.
- `apps/web/playwright.config.ts:20` — `fullyParallel: true` sin tope de `workers` frente
  a specs que comparten bandera global y tiendas del seed.
- `scripts/cobertura-e2e.mjs:87-99,194` — de dónde sale (o no) el video de cada historia.
- `apps/web/src/pages/tienda-publica/rutas/definir-contrasena.tsx:30` +
  `apps/web/src/lib/enlaceAuth.ts` — el hallazgo de la sesión compartida ya mitigado
  (MSF-428).
- `docs/e2e-app.md:110-125` — la regla escrita del fixture compartido (y la lista de
  specs que aún traen su copia: `ordenes-compra` #869 y `service-cobro-avisos` #691).
  `docs/e2e-app.md:236,262-263` — la bandera global y el `--workers=1` de la tienda.

## Root Cause Hypothesis

Confianza: **alta** para los hallazgos 1, 2 y 4; **media** para el 3.

El fixture compartido grew como un contrato informal, no como una API: expone
`test`/`expect` y dos helpers, pero no los tipos que sus propios consumidores
necesitan (`Page`, `Browser`, `BrowserContext`, `TestInfo`) ni una forma de que un
spec obtenga la *sesión* de una persona con la credencial correcta. Cada hueco se
tapó improvisando en el spec (importar de `@playwright/test`, o pedir el token con la
service-role), y como la carpeta `e2e/` está fuera de todo type-check, nada lo
delata: el repo acumuló 40 specs fuera del estándar, 13 specs con sus propias copias
de `rest`/`leer`/`borrar` (la regla de `docs/e2e-app.md:110-125` los señala) y 41
copias del helper `ingresar`. En paralelo, el fixture quedó como el único lugar donde
se garantiza la evidencia (video 1920×1080 + `meta.json`): los specs que lo evitan no
fallan, simplemente no dejan evidencia, y el manifiesto de cobertura lo refleja como
`video: null` sin que ningún check lo marque. El hallazgo 4 (la ruta de contraseña) es
del mismo lote pero ya fue corregido en esta base por MSF-428.

## Proposed Remediation

**Preferred**: cerrar la API del fixture compartido y hacer que el estándar sea
verificable por un guard.

1. **Fixture completo** (`apps/web/e2e/fixture.ts`): re-exportar los tipos que ya
   importa y usa — `export type { Browser, BrowserContext, Page, TestInfo }` — junto a
   `export { expect }`. Con eso, `import { expect, test, type Page } from './fixture'`
   compila y desaparece la clase de TS2305 (y la excusa para importar de
   `@playwright/test`).
2. **Migrar los 40 specs** que hoy importan `test`/`expect` de `@playwright/test` a
   `./fixture` (cambio mecánico de una línea por archivo: `import { expect, test, type Page } from './fixture'`).
   Revisar archivo por archivo los que usan `browser.newContext()` (35 specs): deben
   seguir usando `abrirContextoGrabado`/`cerrarContextoGrabado` para no perder el video.
   Con esto vuelven el video 1920×1080, el `meta.json`, el viewport HD, `es-AR` y
   `reducedMotion` que el fixture define.
3. **Guard de estándar**: un script nuevo (a la forma de
   `scripts/verificar-e2e-sin-escritura-directa.mjs`) que falle si un archivo de
   `apps/web/e2e` importa `test`/`expect` (valores) de `@playwright/test` o un tipo de
   Playwright sin pasar por `./fixture`, con su test en `scripts/tests/` y un paso en el
   job `application` de `.github/workflows/validate.yml`. Es lo que convierte el
   estándar del fixture en algo que no se puede romper en silencio.
4. **Sesión con la credencial correcta** (`apps/web/e2e/semillas.ts`,
   `apps/web/e2e/ventas-faltantes-soporte.ts`): `tokenDe` debe pedir el token con la
   **anon key** y sin `Authorization: Bearer <service_role>`, igual que
   `importaciones-soporte.ts:60-67`; `cabeceras()` (service-role) queda sólo para la
   siembra y la limpieza. Agregar `SUPABASE_ANON_KEY` a las variables de entorno de los
   jobs de E2E que siembran (el job `e2e-tienda` ya lo exporta, según
   `docs/e2e-app.md:318-320`).
5. **Estado compartido**: serializar los specs que tocan la bandera global y las
   tiendas del seed. Mínimo: documentar y dejar un script `test:e2e:tienda` con
   `--workers=1` (el CI ya lo usa). Mejor: que el spec tome un *advisory lock* de
   Postgres para la bandera y no dependa del orden de los workers.
6. **Type-check de `e2e/`**: agregar un `tsconfig.e2e.json` (o `include` de `e2e` en el
   proyecto de node) y un paso de `tsc --noEmit` en el CI, para que un TS2305 en un
   spec no dependa de que alguien lo compile a mano.

**Alternatives** (con su trade-off):

- *No migrar los 40 specs* y ampliar sólo el contrato del fixture: se arregla el TS2305
  pero la evidencia (video 1920×1080) sigue faltando en 10 specs que corren en el CI ⇒
  el manifiesto de cobertura sigue con `video: null`. Es el arreglo incompleto.
- *Copiar el fixture a un paquete propio* (`e2e/support/`): más orden, pero duplica
  el estándar y deja dos fuentes de verdad.
- *Dejar la sesión como está* y documentar que los specs con rol prueban permisos de
  negocio, no RLS: sólo sirve si se verifica que GoTrue ignora el bearer de
  service-role en `/token` (aún sin confirmar).

**Files likely to change**:

- `apps/web/e2e/fixture.ts` (re-export de los tipos).
- `apps/web/e2e/*.e2e.ts` (40 imports mecánicos; `ordenes-compra.e2e.ts` si el PR #869
  se mergea).
- `apps/web/e2e/semillas.ts`, `apps/web/e2e/ventas-faltantes-soporte.ts`
  (`tokenDe` con la anon key).
- `apps/web/playwright.config.ts` (tope de `workers` o serialización de los specs con
  estado global).
- `apps/web/tsconfig.app.json` / `apps/web/tsconfig.e2e.json` + el paso de `tsc` del CI.
- `scripts/verificar-e2e-fixture-compartido.mjs` (nuevo) + su test en `scripts/tests/`.
- `.github/workflows/validate.yml` (job `application`: el guard nuevo y el type-check de
  `e2e/`).
- `docs/e2e-app.md` (la sección «Fixture compartido»: qué exports tiene el fixture, la
  regla de importación y los specs que ya migraron) — la documentación es parte del
  mismo cambio (`pnpm docs:check`).

**Tests to add or update**:

- Test del guard: un spec con `import { test } from '@playwright/test'` ⇒ el guard
  falla con un mensaje claro (y un spec que usa `./fixture` ⇒ pasa).
- Test del type-check de `e2e/`: que el CI falle si un spec importa un tipo que el
  fixture no exporta (caso `Page`).
- Test de `tokenDe`: contra el stack local, que el JWT devuelto tenga el `role` del
  usuario sembrado y no `service_role` (es el candado del falso verde de permisos).
- E2E de la tienda que ya corre (`tienda-catalogo`, `tienda-contacto`): tras migrarlos
  al fixture, el reporte debe traer el adjunto `video` y `scripts/cobertura-e2e.mjs`
  debe dejar `video` con ruta (no `null`) para esas historias.

## Risks & Considerations

- Migrar 40 specs es un cambio mecánico pero*toca todos los specs con sesión*: un
  error de importación rompe una suite que hoy no corre en el CI (es el mayor riesgo
  operativo de este arreglo: hoy el CI sólo corre `acceso-publico`, `recorrido-publico`
  y los `tienda-*`; el resto sigue sin verificación automática).
- Cambiar el `page` de un spec que hoy usa el de fábrica cambia el **viewport**
  (1280×720 → 1920×1080): puede mover elementos y destapar aserciones que con el
  viewport chico no se veían (y al revés, después de migrar, quedan sin pantalla).
- `recordVideo` en el fixture escribe en `testInfo.outputDir`: al migrar 40 specs, la
  corrida produce 40 videos (hoy sólo los de los specs con el fixture); hay que
  revisar el tiempo de disco y el artefacto del CI.
- Cambiar `tokenDe` a la anon key hace que el spec dependa de `SUPABASE_ANON_KEY`:
  si esa variable falta en algún entorno (local, runner), el login falla ⇒ hay que
  dejar un mensaje claro o derivarla de `supabase status -o env`.
- El `page` del fixture fija `locale: 'es-AR'` y `reducedMotion: 'reduce'`: algunos
  specs pueden depender del idioma del navegador (p. ej. `toHaveURL` o los rótulos de
  los errores del navegador).
- Sin migración de `apps/web/src/pages/tienda-publica/rutas/definir-contrasena.tsx`: el
  hallazgo 4 ya está cerrado por MSF-428; **no tocar ese archivo** salvo que aparezca
  una regresión.
- Sin cambios de base de datos, migraciones ni API: el alcance es `refine` (front) +
  tooling/CI. No aplica RLS ni der:check.

## Open Questions

- [NEEDS CLARIFICATION: ¿la versión de GoTrue del stack local devuelve la identidad
  de servicio cuando `/auth/v1/token` lleva `Authorization: Bearer <service_role>`?]
  De eso depende que el hallazgo 3 sea un falso verde real o sólo una divergencia
  latente. Se verifica en 3 líneas contra el stack local (decodificar el `role` del
  JWT que devuelve `tokenDe`).
- [NEEDS CLARIFICATION: ¿el PR #869 (`feat/story-MSF-454`) entra antes de este arreglo?
  Si entra, el fix de `fixture.ts` es la mitad del arreglo: sin él, ese spec sigue sin
  compilar.]
- [NEEDS CLARIFICATION: ¿los cuatro hallazgos del "lote L18" son exactamente estos? El
  tracker sólo trae el título; si alguno de los cuatro es otro (p. ej. un hallazgo de
  seguridad de la app), la evaluación de severidad cambia.]
- [NEEDS CLARIFICATION: ¿el guard del estándar del fixture debe ser bloqueante en el
  CI o sólo informativo? (La regla equivalente de escritura directa, `e2e:escritura`,
  es bloqueante en `validate.yml`.)]
