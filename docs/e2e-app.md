---
owner: tecnico
sources:
  - specs
---

# Suite E2E de la app (Playwright)

Seguimiento MSF-499. La suite vive en `apps/web/e2e/` (`@playwright/test` 1.61.0,
la misma versión que la imagen de `infra/playwright`, que es un servidor remoto
para workers y **no** corre estos tests).

## Correr

```bash
pnpm build            # el webServer usa `vite preview` sobre el build
pnpm --filter @platform/web exec playwright install chromium   # una vez
pnpm test:e2e         # o E2E_BASE_URL=http://... para apuntar a una web ya servida
```

- Los archivos usan el sufijo `.e2e.ts`: Vitest (`pnpm test`) no los recoge.
- Los recorridos con sesión necesitan `pnpm dev:supabase` y usuarios sembrados;
  el setup sembrará con la API admin desde Node (la service-role key nunca llega
  al navegador).

## Ver y grabar las corridas (control directo)

- **UI interactiva (recomendado):** `pnpm test:e2e:ui` abre el Playwright UI: elegís un test, ves el navegador, el DOM, la línea de tiempo y la traza paso a paso.
- **Con navegador visible:** `pnpm test:e2e:headed`.
- **Grabar todo (video + traza):** `pnpm test:e2e:record`; quedan en `apps/web/test-results/` (video `.webm` + `trace.zip`).
- **Reporte HTML:** `pnpm test:e2e:report` (después de una corrida).
- **Abrir una traza:** `pnpm test:e2e:trace apps/web/test-results/<test>/trace.zip`.
- **Desde GitHub (manual):** Actions → **Validate** → **Run workflow** → activá **«Grabar video + traza»** (por defecto sí; fuerza build + e2e aunque no haya cambios de código, incluido `code=true`); al terminar, bajá el artefacto `playwright-report`.
- **Grabar una interacción y generar el test (codegen):** `pnpm test:e2e:codegen` (con la app corriendo en `http://localhost:4300`; o `E2E_BASE_URL=...`).

En CI (`validate.yml`) el artefacto `playwright-report` incluye el reporte HTML + `test-results` (videos y trazas) y se sube **siempre** (también si el test pasa), con retención de 14 días. Se descarga desde la pestaña **Artifacts** del run y se abre con `npx playwright show-report` o `npx playwright show-trace`.

**Control remoto por Tailscale (opcional):** en el nodo, `pnpm --filter @platform/web test:e2e:ui --ui-host=0.0.0.0 --ui-port=9323` y abrí `http://<nodo>:9323` desde tu máquina en la tailnet. El `webServer` levanta el build/preview; requiere el stack de la app.

## Grabar un recorrido funcional (una sola toma)

Para ver las pantallas de la app sin correr los tests:

1. **Guardá una sesión (una vez).** Con la app corriendo (o `E2E_BASE_URL` apuntando a DEV):
   ```bash
   pnpm test:e2e:storage
   ```
   Se abre el navegador; ingresá y cerralo. Guarda `apps/web/auth.json` (tokens: no se versiona).

2. **Grabá el recorrido:**
   ```bash
   PANTALLAS_APP_URL=https://dev.212-90-120-53.sslip.io    PANTALLAS_ESTADO=apps/web/auth.json    pnpm pantallas:video
   ```
   Queda **`apps/web/pantallas-capturas/app-recorrido.webm`**, con un rótulo por pantalla.

3. **Elegí las rutas** (default `clientes,productos,empresas,usuarios,stock`):
   ```bash
   PANTALLAS_RUTAS=clientes,productos,ventas,historial,reportes PANTALLAS_PAUSA=4000 ...
   ```

Sin `PANTALLAS_APP_URL`, graba el recorrido de los prototipos (`design/pantallas`) como `prototipo-recorrido.webm`.

## Estado de cobertura

| Recorrido | Tarea | Estado |
| --- | --- | --- |
| Ruta protegida → ingreso, camino a recuperación, enlace vencido, sin registro | MSF-119 T020 (parte pública) | Hecho: `e2e/acceso-publico.e2e.ts` |
| Ingreso con sesión, cierre de sesión | MSF-119 T020 | Pendiente: fixtures por rol |
| Acceso restringido + Rentabilidad por URL | MSF-125 T019 | Pendiente |
| Rentabilidad con tres roles: Administrador edita el umbral (10 % → 3 %) y desaparece el aviso; Administración ve el aviso sin el botón; Operador y Consulta ven «No tenés acceso a esta sección» (SC-008) | MSF-120 T032 | Escrito: `e2e/rentabilidad-roles.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; no corre en el CI público). Desvío: no se ejecutó por falta de Docker; se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e rentabilidad-roles`. No monta Superset: valida aviso, diálogo y acceso contra la base. Detalle: `docs/tecnico/rentabilidad.md` |
| Editar/suspender/reactivar usuarios | MSF-125 T036 | Pendiente |
| Matriz de permisos | MSF-125 T043b | Pendiente |
| Empresas (listar, editar, pausar/reactivar, cambiar) | MSF-138 T011/T017/T021/T025 | Pendiente |
| Permisos por empresa: asignar desde Usuarios, cambiar de empresa activa y nivel de edición resuelto | MSF-121 T022 | Escrito: `e2e/permisos-por-empresa.e2e.ts` (con sesión; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). No hay pantalla de una sección por empresa (Ventas/Consultas) todavía: el nivel se comprueba sobre la respuesta de `permisos_actuales` que decide los botones de edición |
| Editar la organización y restablecer contraseña | MSF-132 T010/T017 | Pendiente (seguimiento MSF-499); cubierto por Vitest (`pages/organizacion`, `pages/usuarios`) y pgTAP |
| Actividad: ruta sin sesión → ingreso | MSF-463 T015 (parte pública) | Hecho: `e2e/acceso-publico.e2e.ts` |
| Actividad: listado con filtros, búsqueda y paginación (administrador/operador) | MSF-463 T015 | Pendiente: fixtures por rol (seguimiento) |
| Clientes: alta, búsqueda y exportación a Excel (SC-001) | MSF-180 T017 | Pendiente: fixtures por rol (seguimiento MSF-499); cubierto mientras tanto por Vitest (`pages/clientes`, `lib/exportarClientes`) y pgTAP |
| Cuenta web del cliente: invitación → definir contraseña → ingresar; suspendida/sin cuenta/no habilitada no entran; recuperar responde igual con y sin cuenta (SC-005, SC-006) | MSF-237 T027 | Escrito: `e2e/cuenta-web-cliente.e2e.ts` (con las dos tiendas del seed; requiere `pnpm dev:supabase` y no corre en el CI público). Cubierto además por pgTAP `cuentas_cliente*` y Vitest de `tiendaCuenta`/`rutas` |
| Service técnico: recorrido completo (alta, ítems, estados, entrega y remito sin costos) (SC-007, MSF-199) | MSF-538 T030 | Escrito: `e2e/service-recorrido.e2e.ts`; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` y no corre en el CI público. Cubierto además por pgTAP `service_items`/`service_listado` y Vitest de listado, ítems e impresión |
| Service técnico: repuestos con stock por depósito — agregar descuenta del depósito elegido, el exceso se rechaza con «No hay stock suficiente», quitar devuelve y anular devuelve lo no consumido (SC-009, MSF-217) | MSF-575 T033 | Escrito: `e2e/service-repuestos-stock.e2e.ts` (rótulo `[MSF-575:T033]`); recorre por **API** (PostgREST con la sesión de la persona), no la interfaz; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` y aborta si el Supabase no es local. Cubierto además por pgTAP `service_repuestos_*` y Vitest de `ItemsReparacion`/`AnularDialog`. **Pendiente:** el rótulo debería ser `[MSF-217:T033]` (el manifiesto resuelve la épica por `**Jira Epic**:` del spec, que es MSF-217) y falta un E2E de navegador del selector de depósito, «Dejar pendiente» y el indicador del listado |
| Stock: entrada 10 → salida 4 → ajuste a 3 → stock 3 y tres filas en el historial; salida de 5 rechazada con «No hay stock suficiente» (SC-001) | MSF-136 T021 | Escrito: `e2e/stock-movimientos.e2e.ts` (con sesión; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Desvío: no se pudo correr en el entorno del Desarrollador (sin acceso al daemon de Docker); se corre a mano con `pnpm dev:supabase` antes del merge (T024) y aborta si `SUPABASE_URL` no es local. Seguimiento: MSF-499 |
| Ingreso de mercadería: proveedor → ingreso de dos productos con costo → stock sube → historial → anular → stock vuelve y queda «Anulado» (SC-001…003) | MSF-219 T019 | Escrito: `e2e/ingresos-mercaderia.e2e.ts` (con sesión; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Desvío: no se ejecutó en el entorno del Desarrollador (sin stack local); se corre a mano con `pnpm dev:supabase`. Seguimiento: MSF-499 |
| Catálogo: crear, editar, subir fotos y desactivar con Administrador y Operador; eventos en Actividad sin costo (SC-001, SC-006) | MSF-456 T025 | Desvío: pendiente de fixtures por rol (MSF-499); cubierto por pgTAP `catalogo_*` y Vitest de `pages/productos` |
| Dólar: vigente 1000 → carga 1050, vista previa por empresa, confirma y comprueba precios; carga 1005 (0,5 %) y no recalcula (SC-009) | MSF-547 T031 (MSF-116) | Escrito: `e2e/cotizacion-recalculo.e2e.ts` (con sesión; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público y aborta si el Supabase no es local). Cubierto además por pgTAP `cotizacion_*` y Vitest de `pages/cotizacion` |
| Verificación manual 320/768/1440 px y lector de pantalla | MSF-125 T018 | Pendiente (manual) |

### Quién ejecuta el E2E con sesión (`permisos-por-empresa.e2e.ts`)

Ningún job del CI público lo corre: necesita el stack local de Supabase. Se ejecuta a mano antes
del merge, en el runner self-hosted o en la máquina de desarrollo:

```bash
pnpm dev:supabase
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm test:e2e -- permisos-por-empresa.e2e.ts
```

El test siembra su propia organización, empresas y usuarios, y los borra en un `finally`. En el
entorno del Desarrollador de MSF-510 no hay Docker ni CLI de Supabase, así que esta corrida
queda como paso previo al merge (T024/T026), no como evidencia ya obtenida.

## CI

`validate.yml` corre los specs públicos como pasos del job de plataforma (después de
`pnpm build`: instala Chromium con `--with-deps` y ejecuta `pnpm test:e2e -- acceso-publico.e2e.ts`).
Sube `playwright-report` y `test-results` como artefacto **siempre** (`if: always()`, retención 14 días): incluye videos y trazas también de las corridas verdes.
El `WEB_PORT` en CI se deriva del run (`4400 + run_id % 100`) para no colisionar si dos jobs corren en
paralelo en el runner self-hosted.

El comando del `webServer` ejecuta antes `e2e/verificar-dist.mjs`, que falla con
un mensaje claro si falta `apps/web/dist` (Playwright levanta el `webServer`
antes que `globalSetup`; tampoco corre al importar la config, así
`--list`/`codegen` siguen andando). Si ya hay un servidor en `WEB_PORT` se
reutiliza (fuera de CI); los specs afirman headings propios de la app, así que
otro servicio ahí falla en vez de dar falso verde. Chromium se instala con `--with-deps`
(al runner self-hosted le faltaban las librerías del sistema). Los recorridos con
sesión (tabla de arriba) requieren ampliar el stack de `scripts/supabase-ci.mjs`
(hoy omite `kong,postgrest`) o un job aparte: siguen pendientes y abiertos en
las tasks.md de origen.

## Cobertura por historia con video (spec 022)

Cada test E2E declara qué cubre en su título con `[EPICA:TASK]` (la épica es la
clave MSF de Jira, el ítem es el Txxx del `tasks.md` de su spec):

```ts
test('[MSF-136:T021] entrada 10, salida 4 y ajuste …', async ({ browser }) => {
```

El visor **no vive en MSF**: es una pantalla del panel SDLC
(`http://<host-del-panel>:8098/?v=e2e`), que agrupa **Componente → Épica →
Historia** con progreso (`cubiertos / total` ítems, contando también los
`sin_cubrir`), buscador, filtro por estado, checklist y el video de cada test.

El panel importa la última corrida exitosa de este repo (botón «Importar
última» o automático cada 5 minutos), baja los artefactos y sirve los videos; no
hay bucket ni secretos en MSF. Desde la ficha de una épica se puede lanzar el
recorrido («Correr este recorrido»): el runner del panel dispara este workflow
con `e2e_grep=<clave>`, modo visible y video, y al terminar publica el video.

El componente se declara en el `spec.md`, junto a la épica de Jira:

```md
**Componente**: Acceso

**Jira Epic**: MSF-119 — Acceso, organización y permisos · Acceso y organización
```

En cada PR, el job `application` graba los E2E públicos y deja **un solo
comentario** (lo edita en cada push) con el link al visor, tomado de la variable
`EVIDENCIAS_E2E_VIEWER_URL`; sin esa variable o sin los secretos del bucket no
comenta y la corrida no falla.

Sin esa línea la épica cae en "Sin clasificar" (no se pierde ninguna historia).
El nombre visible de la épica sale de la línea `**Jira Epic**`: se muestra la
historia (lo que sigue al último `·`), no el código; la clave MSF queda en su chip.
Tanto la lista como la ficha intentan primero el bucket y, si no está
configurado, el manifiesto local `apps/web/public/cobertura-e2e.json` (útil para
probar el visor sin secretos); la lista lo marca con la insignia "Manifiesto local".

Pipeline:

1. La corrida E2E emite además el reporte JSON (`--reporter=json`,
   `PLAYWRIGHT_JSON_OUTPUT_NAME`): `validate.yml` lo genera en cada corrida web.
2. `pnpm cobertura:e2e -- --report <json> --results <test-results> --specs specs --out <cobertura.json> --run-id <id> [--modo on|retain]`
   Las claves del bucket se sanean a ASCII (`edición` → `edicion`): Storage
   rechaza nombres con acentos, y el manifiesto se reescribe con la misma clave
   para que el visor no pida una ruta inexistente.
   cruza títulos × `tasks.md` × videos y emite el manifiesto (evidencias,
   huérfanos sin etiqueta o con clave inexistente, e ítems sin cubrir).
3. El CI adjunta el manifiesto al artefacto `playwright-report` y, si existen
   los secretos `EVIDENCIAS_E2E_URL` / `EVIDENCIAS_E2E_SERVICE_ROLE_KEY`, lo sube
   junto a los videos al bucket privado `evidencias-e2e` (`<run-id>/…` más el
   puntero `latest/` que lee el visor). Sin secretos, la subida se omite sin
   fallar. Los videos se firman bajo demanda (URL firmada de 5 minutos); la
   ficha nunca descarga videos hasta pedirlos.

## Estándar: toda prueba deja su video

Todo test E2E que pruebe una historia sigue tres reglas:

1. **Importa de `./fixture`**, nunca de `@playwright/test`: `import { expect, test } from './fixture'`.
   El fixture reemplaza `page` por una página que graba **siempre** a 1920×1080 y adjunta el video al reporte
   (el nativo de Playwright se reduce a 800×450). Si el test abre sus propias sesiones, usa
   `abrirContextoGrabado` / `cerrarContextoGrabado` (cerrar en el `finally`: el video también sirve cuando falla).
2. **Lleva `[EPICA:TASK]` en el título**: `test('[MSF-136:T021] …')`. Con eso `pnpm cobertura:e2e`
   ata el video a la historia (el Txxx de su `tasks.md`) y, por la clave MSF, a la épica; sin etiqueta queda
   como huérfano en el manifiesto.
3. **Narra con `paso(page, 'Qué hace', …)`** (`visible.ts`): con `E2E_VISIBLE=1` muestra cursor, clics y rótulos
   grandes (44 px); sin la variable no cambia nada.

Comando para generar el video de muestra: `pnpm test:e2e:evidencia` (= `E2E_VISIBLE=1 playwright test`;
con `E2E_BASE_URL` apunta a una web ya servida). El ejemplo de referencia es `e2e/evidencia.e2e.ts`.
Los videos quedan en `apps/web/test-results/<test>/attachments/` y siguen el flujo de «Cobertura por historia con video».

**Pendiente (anotado):** mostrar el video también a nivel **épica** en el visor del panel SDLC (hoy se agrupa
Componente → Épica → Historia y el video cuelga de la historia): una vista de la épica con el resumen de sus
recorridos y un único video de muestra (intro + clips de sus historias + cierre).

## Videos de prueba por funcionalidad, en ItsAPlan

Un video por **funcionalidad** (no uno por escenario, ni uno por épica): cada test agrupa los escenarios de
aceptación que son el mismo recorrido y los declara en el título.

```ts
test('[F-STK-02#1-4,8] el Operador registra entrada, salida y ajuste …', …)   // escenarios 1 a 4 y 8 de la historia F-STK-02
test('[F-STK-02#5] [F-STK-05#4] Consulta ve el stock sin poder registrar …', …) // un test puede cubrir varias historias
test('[MSF-136:T025] el Administrador agrega un motivo …', …)                  // sin escenario en el spec: por tarea
```

- `[F-XXX-NN#n]` apunta a los escenarios numerados de la historia en `spec.md` (`### User Story N - … (F-XXX-NN`).
  `pnpm cobertura:e2e` los resuelve (`historia`, `criterios`) y lista en `criterios_sin_cubrir` los que ningún test cita.
- Lo que no tiene pantalla (RLS, concurrencia, escritura directa) queda en pgTAP y no necesita video.
- `pnpm armar-video:e2e` arma, **sin IA**, un MP4 1920×1080 por test: tarjeta de entrada con los escenarios que
  cubre, el recorrido narrado y tarjeta de resultado. Una tarea `[F-XXX-NN][US1]` cuelga de su historia.

```bash
pnpm cobertura:e2e -- --report e2e-report.json --results apps/web/test-results --specs specs --out cobertura.json --run-id local --modo on
pnpm armar-video:e2e -- --manifiesto cobertura.json --videos apps/web/test-results --out videos [--epica MSF-136]
ITSAPLAN_API_KEY=… pnpm armar-video:e2e -- --manifiesto cobertura.json --videos apps/web/test-results --out videos --publicar
```

Con `--publicar`: cada video se adjunta a la **historia** hija de la épica cuyo título menciona su clave
(`F-STK-02` o `Txxx`; si ninguna la menciona, a la épica), cada historia recibe un comentario con los links de
sus videos y la **épica** recibe un único comentario con los links de todos, agrupados por historia. Requiere
`ffmpeg` y el Chromium de Playwright; usa `ITSAPLAN_API_URL` (por defecto `https://api.plan.agenmatica.com`)
e `ITSAPLAN_API_KEY`.

Cuándo generarlos: solo para las épicas que pasan a Review In DEV o cuando cambia un test de la épica
(`tests-afectados.mjs` dice cuáles), con `E2E_VISIBLE=1`; la corrida normal de CI sigue sin cámara lenta.
Los E2E con sesión (`e2e/semillas.ts`) necesitan el Supabase local (`pnpm dev:supabase`).

## Recorrido visible (video para mirar)

Con `E2E_VISIBLE=1` (automático cuando el run manual lleva "Grabar video +
traza"), la suite se comporta como un recorrido guiado: viewport 1920×1080,
cámara lenta, cursor rojo gigante con onda en cada clic y un rótulo que narra
cada paso (`apps/web/e2e/visible.ts`, helpers `prepararPaginaVisible`/`paso`).
Sin la variable, `paso` ejecuta la acción sin tocar nada: los asserts y los
tiempos del CI no cambian.

Los videos quedan en `apps/web/test-results/<test>/video.webm` (uno por test,
con el rótulo quemado en la imagen) y viajan en el artefacto
`playwright-report`; el manifiesto `cobertura-e2e.json` los referencia por
historia para el visor del panel SDLC.

## Ver-para-aprobar sin descargar artefactos

1. **Panel SDLC** (`?v=e2e`): importa la última corrida y reproduce los videos
   por componente/épica/historia. Es la vía normal.
2. **Servidor local con tailnet**: tras una corrida local con video
   (`E2E_VIDEO=on E2E_VISIBLE=1 pnpm test:e2e`), publicar con
   `node scripts/publicar-videos-e2e.mjs --manifiesto <cobertura.json> --videos apps/web/test-results --run-id local`
   y abrir la URL `http://<ip-tailnet>:9324/<run-id>/` que imprime.
   (En el runner de CI no sirve: es un contenedor sin tailnet.)
3. **Artefacto** `playwright-report` del run: siempre disponible, retención 14 días.

## Recorrido público completo

`apps/web/e2e/recorrido-publico.e2e.ts` ([MSF-119:T020]) es el tour mir-able
de la parte pública: un solo test, un solo video. Abre `/`, `/stock`,
`/clientes` y `/empresas` sin sesión (todas piden ingresar), escribe un correo
en la recuperación (sin enviar nada) y recorre el caso de enlace vencido. Solo
navega y verifica textos: no toca el backend y corre en el CI público.

## E2E con sesión en CI (manual)

El job `e2e-visible-sesion` (solo `workflow_dispatch` con `e2e_sesion: true`)
levanta el stack Supabase del CI, lo resetea, buildea la app contra él y corre
los specs con sesión en modo visible (`permisos-por-empresa.e2e.ts`, que siembra
sus propios datos). Deja videos + manifiesto en el artefacto
`playwright-report-sesion`. Los runs de PR omiten estos specs (siguen con
`test.skip` sin `SUPABASE_URL`).

### Requisitos para armar/publicar los videos

- **ffmpeg con libx264**: el ensamblador arma el MP4 (tarjeta de intro + recorrido + cierre). El ffmpeg que
  trae Playwright es una build mínima (no sirve: no tiene `-preset`/libx264). En Linux:
  `apt-get install -y ffmpeg`.
- El **reporte JSON** de Playwright tiene que ser el de la corrida actual: si no se pasa
  `PLAYWRIGHT_JSON_OUTPUT_NAME`, el archivo `e2e-report.json` puede ser de una corrida vieja y los videos
  que se buscan no existen.
- Un test **omitido** (nunca se ejecutó) no tiene video: el manifiesto lo marca `omitido` y el ensamblador lo
  salta (no es un error).


---

## Receta A — dejar una HISTORIA con evidencia E2E (a mano)

Objetivo: que la historia quede con un **video** publicable. El pipeline ata el video a la historia por el
**rótulo del título del test**: `[MSF-<epica>:<TASK>]` (o `[F-XXX-NN#n]` para criterios sueltos).

### Qué necesitás
- La historia con su **código** (`F-XXX-NN`) y su **TASK** en el `tasks.md` de la épica
  (`specs/<slug>/tasks.md`, p.ej. `T020`).
- Un entorno donde corra la app (DEV: `https://dev.212-90-120-53.sslip.io`) o el stack local (Receta B).

### Pasos

1. **Creá el spec** `apps/web/e2e/<funcionalidad>.e2e.ts` a partir de la plantilla
   `apps/web/e2e/acceso-publico.e2e.ts` (copiá los imports y el `beforeEach`):

   ```ts
   import { expect, test } from './fixture'          // NUNCA de '@playwright/test': el fixture graba el video
   import { paso, prepararPaginaVisible } from './visible'

   test.describe('<Funcionalidad>', () => {
     test.beforeEach(async ({ page }) => { await prepararPaginaVisible(page) })

     test('[MSF-<epica>:T0yy] <qué hace>', async ({ page }) => {
       await paso(page, 'Abre /ruta', () => page.goto('/ruta'))
       await paso(page, 'Verifica X', async () => {
         await expect(page.getByRole('heading', { name: 'Titulo' })).toBeVisible()
       })
     })
   })
   ```

   - El **rótulo va en el TÍTULO del test** (es lo que lee el pipeline).
   - `paso()`/`rotulo()`/`clic()`/`escribir()` de `./visible` son los que hacen el video legible
     (cursor grande + rótulos). `clic`/`escribir` además anotan la pantalla.
   - Si el flujo necesita sesión/rol: `semillas.ts` (`sembrarStock`, `ingresar`) o el `storageState` de rol.

2. **Correlo con evidencia** (1920×1080, cursor y rótulos):

   ```bash
   cd apps/web
   E2E_BASE_URL=https://dev.212-90-120-53.sslip.io E2E_VIDEO=on npx playwright test e2e/<funcionalidad>.e2e.ts
   ```

   - En `apps/web/test-results/<test>/attachments/` queda el `.webm`.
   - Si lo vas a **publicar**, el reporte JSON tiene que ser de **esta** corrida:
     `PLAYWRIGHT_JSON_OUTPUT_NAME=/ruta/apps/web/e2e-report.json`.

3. **Armá el manifiesto y los MP4** (desde la raíz del repo):

   ```bash
   node scripts/cobertura-e2e.mjs \
     --report apps/web/e2e-report.json --results apps/web/test-results --specs specs \
     --out cobertura-e2e.json --run-id local --modo on
   node scripts/armar-video-evidencia.mjs \
     --manifiesto cobertura-e2e.json --videos apps/web/test-results --out videos
   ```

   - Sale un MP4 por funcionalidad, con tarjeta de intro y de cierre: `videos/<EPICA>-<TASK>-<n>.mp4`.
   - Necesita **ffmpeg con libx264** (`apt-get install -y ffmpeg`); el de Playwright es una build mínima.

4. **Publicá** (los videos se adjuntan a la historia/epica y se deja un comentario con los links):

   ```bash
   ITSAPLAN_API_KEY=… node scripts/armar-video-evidencia.mjs \
     --manifiesto cobertura-e2e.json --videos apps/web/test-results --out videos --publicar
   ```

### Qué probar (checklist) para darlo por bueno
- [ ] El test **pasa** (`npx playwright test` en verde) y el `.webm` existe en `test-results/`.
- [ ] El título del test empieza con `[MSF-<epica>:T0yy]` (o `[F-XXX-NN#n]`).
- [ ] `cobertura-e2e.json` lista la evidencia con `estado: "pasado"` y **no** aparece en `sin_cubrir`.
- [ ] El MP4 existe, se **reproduce** (intro + recorrido + cierre) y dura lo razonable.
- [ ] Tras `--publicar`, el issue tiene los `.mp4` adjuntos y el comentario con los links.

## Receta B — stack Supabase AISLADO para los E2E que siembran datos

Los tests que siembran (ej. `stock-historias.e2e.ts`) necesitan **base propia**: siembran filas y las borran.
Con **PRD/STG** no se toca nada: levantá un stack local.

### Pasos (en el nodo o en tu máquina, con Docker)

1. **Levantá el stack local** (el repo ya trae el CLI como devDependency):

   ```bash
   cd /ruta/del/repo
   pnpm dev:supabase            # = supabase start  (API en :9300, Studio en :4301)
   pnpm exec supabase status     # imprime anon key y SERVICE_ROLE key
   ```

   Los puertos están en `.env.example` (`SUPABASE_API_PORT=9300`, `SUPABASE_DB_PORT=7634`, …).

2. **Levantá la web** apuntando al stack local:

   ```bash
   cp apps/web/.env.example apps/web/.env    # y poné la ANON key que imprime `supabase status`
   pnpm --filter @platform/web dev            # http://127.0.0.1:4300
   ```

3. **Corré los E2E que siembran** (con las dos variables que el `semillas.ts` exige):

   ```bash
   cd apps/web
   SUPABASE_URL=http://127.0.0.1:9300 \
   SUPABASE_SERVICE_ROLE_KEY=<service_role de `supabase status`> \
   E2E_BASE_URL=http://127.0.0.1:4300 \
   E2E_VIDEO=on \
   npx playwright test e2e/stock-historias.e2e.ts
   ```

   - Sin esas dos variables el test se **omite** (no falla): por eso veías `9 skipped`.
   - Con elas, siembra lo suyo (`semillas.ts`) y corre.

4. Después seguí con los pasos 3 y 4 de la **Receta A** (manifiesto → MP4 → publicar).

### Qué probar (checklist)
- [ ] `pnpm exec supabase status` responde y la API `:9300` contesta.
- [ ] `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` exportadas → los tests **no** se omiten.
- [ ] El test pasa y deja su `.webm`.
- [ ] Las filas sembradas se **borran** al final (si no, la base local queda sucia: se reinicia el stack).
- [ ] El manifiesto los marca `pasado` y el MP4 se arma y se publica.


---

## Script: las dos recetas en un comando

`scripts/e2e-evidencia.sh` hace la Receta A y la Receta B de punta a punta (crear el spec, correr con video,
manifiesto, MP4 y publicar):

```bash
scripts/e2e-evidencia.sh checklist MSF-119        # qué falta para que la épica tenga evidencia
scripts/e2e-evidencia.sh epica MSF-119 T021 T022  # crea los spec base de esas tareas, corre y publica
scripts/e2e-evidencia.sh correr e2e/stock-historias.e2e.ts   # corre un spec y publica
scripts/e2e-evidencia.sh stack                    # Receta B: stack Supabase aislado + .env + claves
scripts/e2e-evidencia.sh publicar                 # sólo manifiesto + MP4 + publicar
```

- `epica` **reusa** el spec que ya tenga el rótulo (no crea otro) y, si falta, crea una **plantilla** por tarea
  (`[MSF-xxx:T0yy]` en el título + `fixture`/`visible`): hay que editarla antes de que la evidencia valga.
- Sin `ITSAPLAN_API_KEY` arma los MP4 pero **no publica** (y te dice el comando exacto para publicar).
- Necesita **Node ≥ 20**, `pnpm install` hecho y **ffmpeg con libx264**.
- Con `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` exportadas corren los tests que **siembran** (sin eso se
  omiten).
