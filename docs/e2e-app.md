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

## Estado de cobertura

| Recorrido | Tarea | Estado |
| --- | --- | --- |
| Ruta protegida → ingreso, camino a recuperación, enlace vencido, sin registro | MSF-119 T020 (parte pública) | Hecho: `e2e/acceso-publico.e2e.ts` |
| Ingreso con sesión, cierre de sesión | MSF-119 T020 | Pendiente: fixtures por rol |
| Acceso restringido + Rentabilidad por URL | MSF-125 T019 | Pendiente |
| Rentabilidad con tres roles: Administrador edita el umbral (10 % → 3 %) y desaparece el aviso; Administración ve el aviso sin el botón; Operador y Consulta ven «No tenés acceso a esta sección» (SC-008) | MSF-553 T032 | Escrito: `e2e/rentabilidad-roles.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Desvío: no se ejecutó en el entorno del Desarrollador (sin acceso al daemon de Docker); se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e rentabilidad-roles`. No monta el tablero de Superset (necesita un Superset real): el aviso, el diálogo y el acceso salen de la base y la pantalla. La limpieza borra también la Actividad de la organización de prueba (el umbral guardado deja un evento). Guía: `docs/rentabilidad.md` |
| Ventas impresión de punta a punta: factura confirmada → imprimir factura y remito → marca y reimpresión → presupuesto → PDF → correo; registra la latencia de generación (SC-009) | MSF-565 T035 | Escrito: `e2e/ventas-impresion.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`). Corre el worker real compilado contra el Postgres local; el tramo SMTP exige `E2E_CORREO_KESTRA=1`. Desvío: no se ejecutó en el entorno del Desarrollador (sin stack local). Guía: `docs/ventas-impresion.md` |
| Reportes de ventas: Operador y Consulta ven «No tenés acceso a esta sección» (y el servidor rechaza `leer_ranking_ventas` con 42501), Administración y Administrador ven la pantalla, el cambio de empresa reencuadra el filtro de tienda y el Administrador exporta el ranking a `.xlsx` | MSF-338 T015 | Escrito: `e2e/ventas-reportes.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`). El tablero de Superset no se monta (necesita un Superset real). Desvío: no se ejecutó en el entorno del Desarrollador (sin stack local). Guía: `docs/ventas-reportes.md` |
| Editar/suspender/reactivar usuarios | MSF-125 T036 | Pendiente |
| Matriz de permisos | MSF-125 T043b | Pendiente |
| Empresas (listar, editar, pausar/reactivar, cambiar) | MSF-138 T011/T017/T021/T025 | Pendiente |
| Permisos por empresa: asignar desde Usuarios, cambiar de empresa activa y nivel de edición resuelto | MSF-121 T022 | Escrito: `e2e/permisos-por-empresa.e2e.ts` (con sesión; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). No hay pantalla de una sección por empresa (Ventas/Consultas) todavía: el nivel se comprueba sobre la respuesta de `permisos_actuales` que decide los botones de edición |
| Editar la organización | MSF-132 T010/T017 | Pendiente |
| Actividad: ruta sin sesión → ingreso | MSF-463 T015 (parte pública) | Hecho: `e2e/acceso-publico.e2e.ts` |
| Actividad: listado con filtros, búsqueda y paginación (administrador/operador) | MSF-463 T015 | Pendiente: fixtures por rol (seguimiento) |
| Clientes: alta, búsqueda y exportación a Excel (SC-001) | MSF-180 T017 | Pendiente: fixtures por rol (seguimiento MSF-499); cubierto mientras tanto por Vitest (`pages/clientes`, `lib/exportarClientes`) y pgTAP |
| Ingreso de mercadería: dos productos con costo → stock sube → historial → anular → stock vuelve a 0 y el ingreso queda anulado (SC-001…003) | MSF-219 T019 | Escrito: `e2e/ingresos-mercaderia.e2e.ts` (con sesión; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Aborta si `SUPABASE_URL` no es local. |
| Stock: entrada 10 → salida 4 → ajuste a 3 → stock 3 y tres filas en el historial; salida de 5 rechazada con «No hay stock suficiente» (SC-001) | MSF-136 T021 | Escrito: `e2e/stock-movimientos.e2e.ts` (con sesión; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Desvío: no se pudo correr en el entorno del Desarrollador (sin acceso al daemon de Docker); se corre a mano con `pnpm dev:supabase` antes del merge (T024) y aborta si `SUPABASE_URL` no es local. Seguimiento: MSF-499 |
| Precios: producto en USD con costo → precio en dos empresas con reglas distintas → interruptor de IVA → precio final y margen (SC-009) | MSF-114 T043 | Escrito: `e2e/precios-iva.e2e.ts` (con sesión; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Desvío: no se pudo correr en el entorno del Desarrollador (sin acceso al daemon de Docker ni al CLI de Supabase); se corre a mano con `pnpm dev:supabase` antes del merge del cierre. Seguimiento: MSF-499 |
| Dólar y recálculo: cargar 1050 con vigente 1000 → vista previa por empresa → confirmar → precios recalculados; cargar 1005 → se registra sin recalcular (SC-009) | MSF-547 T031 | Escrito: `e2e/cotizacion-recalculo.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público; aborta si `SUPABASE_URL` no es local). Desvío: no se ejecutó en el entorno del Desarrollador (sin acceso al daemon de Docker); se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e cotizacion-recalculo` |
| Stock: 20 salidas simultáneas sobre stock 10 → 10 aceptadas, 10 rechazadas, stock 0, 10 movimientos y 10 eventos `stock.actualizado` (SC-001) | MSF-249 T007 | Escrito: `e2e/stock-concurrencia.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Desvío: no se pudo correr en el entorno del Desarrollador (sin acceso al daemon de Docker); se corre a mano con `pnpm dev:supabase` antes del merge. Contrato y cola: `docs/stock-eventos.md` |
| Stock completo: 2.º depósito → entrada 10 → trasladar 4 → reservar 3 → disponible 7 → descontar → cantidad 7 y reservado 0; concurrencia mixta (traslado + reserva + salida, 18 RPC en paralelo) sin sobreventa (SC-003, SC-008) | MSF-546 T032 | Escrito: `e2e/stock-depositos-reservas.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Aborta si `SUPABASE_URL` no es local. Desvío: no se corrió en el entorno del Desarrollador (sin daemon de Docker); se corre a mano con `pnpm dev:supabase` antes del merge. Detalle: `docs/stock.md` |
| Catálogo: crear, editar, subir fotos y desactivar con Administrador y Operador; eventos en Actividad sin costo (SC-001, SC-006) | MSF-456 T025 | Desvío: pendiente de fixtures por rol (MSF-499); cubierto por pgTAP `catalogo_*` y Vitest de `pages/productos` |
| Service técnico: alta con 2 ítems (total 5.500), estados hasta «Entregado» con «María Pérez», remito sin costos y aparición en el listado (SC-007) | MSF-538 T030 | Escrito: `e2e/service-recorrido.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Desvío: no se ejecutó en el entorno del Desarrollador (sin stack local); se corre con `pnpm dev:supabase` y luego `pnpm --filter @platform/web test:e2e service-recorrido` |
| Tienda online: con los dos dominios del seed, identidad, textos y catálogo visible de cada tienda cambian solo la propia (SC-003) | MSF-543 T038 | Escrito: `e2e/tienda-dos-dominios.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Desvío: no se ejecutó en el entorno del Desarrollador (sin Docker); se corre con `pnpm dev:supabase` y luego `pnpm --filter @platform/web test:e2e tienda-dos-dominios`. Siembra y limpia con la API admin y aborta si `SUPABASE_URL` no es local |
| Cuenta web del cliente: invitación → definir contraseña → ingresar → salir; suspendida / sin cuenta en la tienda / no habilitada no entran con el mismo mensaje; recuperar responde igual con y sin cuenta (SC-005, SC-006) | MSF-428 T027 | Escrito: `e2e/cuenta-web-cliente.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; el caso de recuperar además necesita `supabase functions serve` y se omite si la Edge Function no responde). Desvío: no se ejecutó en el entorno del Desarrollador (sin Supabase CLI ni Docker); se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e cuenta-web-cliente`. El enlace de definir contraseña se pide con `generate_link` (Admin API) en vez de leer el correo; siembra y limpia con la API admin y aborta si `SUPABASE_URL` no es local |
| Tienda online: el menú de cada tienda del seed lista solo sus categorías y una categoría oculta o de la otra tienda muestra la 404 (SC-003 de MSF-167) | MSF-386 T009 | Escrito: `e2e/tienda-categorias.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`). Desvío: no se ejecutó en el entorno del Desarrollador (sin Docker); se corre con `pnpm dev:supabase` y luego `pnpm --filter @platform/web test:e2e tienda-categorias`. Siembra y limpia con la API admin y aborta si `SUPABASE_URL` no es local |
| Catálogo: Administrador ve la columna Costo y el Operador no; ambos ven la disponibilidad, filtran por «A pedido» y encuentran un producto escaneando su código de barras (FR-016, SC-005) | MSF-540 T022 | Escrito: `e2e/catalogo-costo-disponibilidad.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público; aborta si `SUPABASE_URL` no es local). Desvío: no se ejecutó en el entorno del Desarrollador (sin acceso al daemon de Docker); se corre con `pnpm dev:supabase` y `pnpm --filter @platform/web test:e2e catalogo-costo-disponibilidad` |
| Consultas: la tienda envía por la RPC pública → aparece en la bandeja en menos de 5 s → llega el aviso a Mailpit → el enlace abre el detalle → asignar, anotar y resolver; Lectura solo ve, Mostrador no accede y otra organización no la ve (SC-004, SC-008) | MSF-548 T026 | Escrito: `e2e/consultas-recorrido.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Desvío: no se ejecutó en el entorno del Desarrollador (sin acceso al daemon de Docker); se corre con `pnpm dev:supabase` y la función servida, ver `docs/consultas.md` |
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
El paso `build` corre si el diff tiene `code` **o** afecta a la app web (`web`): un cambio que toca
`apps/web` sin ser código por extensión (p. ej. `apps/web/nginx.conf`) deja `code=false` pero
`web=true`, y sin el build el e2e fallaba por `apps/web/dist` ausente.
Si el E2E falla, sube `playwright-report` y `test-results` como artefacto (`if: failure()`).
El `WEB_PORT` en CI se deriva del run (`4400 + run_id % 100`) para no colisionar si dos jobs corren en
paralelo en el runner self-hosted.

El comando del `webServer` ejecuta antes `e2e/verificar-dist.mjs`, que falla con
un mensaje claro si falta `apps/web/dist` (Playwright levanta el `webServer`
antes que `globalSetup`; tampoco corre al importar la config, así
`--list`/`codegen` siguen andando). Si ya hay un servidor en `WEB_PORT` se
reutiliza (fuera de CI); los specs afirman headings propios de la app, así que
otro servicio ahí falla en vez de dar falso verde. Chromium se instala con `--with-deps`
(al runner self-hosted le faltaban las librerías del sistema) y, aun con **cache hit** del
binario, se corre `playwright install-deps chromium`: el cache de `~/.cache/ms-playwright`
guarda el **binario**, no las libs del SO (`libglib-2.0`, etc.), y sin ellas el browser moría
con `error while loading shared libraries` → falso rojo de e2e en PRs ajenos (2026-10-19).
Los recorridos con
sesión (tabla de arriba) requieren ampliar el stack de `scripts/supabase-ci.mjs`
(hoy omite `kong,postgrest`) o un job aparte: siguen pendientes y abiertos en
las tasks.md de origen.

## E2E con sesión en CI (experimental)
- El job **`e2e-sesion`** (en `validate.yml`, sólo al cierre `e2e`) levanta el stack **completo** de Supabase
  (incluye `kong`/`postgrest`), corre `db:reset:ci`, expone `SUPABASE_URL`/`SERVICE_ROLE_KEY` y
  `VITE_SUPABASE_*` al build, y ejecuta los specs con login (`permisos-por-empresa`, `stock-*`).
- Por ahora es **no bloqueante** (`continue-on-error`): se itera hasta estabilizarlo y luego se vuelve requerido.
- El job **`e2e-sesion`** exporta `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` al build y
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` a los specs (desde `supabase status -o env`).
- El job reinicia el stack del CI (`supabase stop/start`) para incluir **kong/postgrest**; el `database`
  lo deja sólo con pgTAP. El stack de CI es efímero (no toca datos de STG/PRD).

### Estado del E2E con sesión en CI
- El job está **preparado** en `templates/calidad/e2e-sesion.job.yml` (kit) pero **no activo** en `validate.yml`.
- Bloqueo: `supabase start` con **kong/postgrest** falla porque postgrest arranca **antes** de que las
  migraciones creen el schema `dominio` (`schema "dominio" does not exist` → `/rest-admin/v1/ready`).
- Para activarlo: iniciar sin postgrest → `db:reset:ci` (crea `dominio`) → levantar postgrest después
  (o pre-crear el schema antes del start). Mientras tanto corre local/nightly; no se activa para no dar falsos verdes.
