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
| Editar/suspender/reactivar usuarios | MSF-125 T036 | Pendiente |
| Matriz de permisos | MSF-125 T043b | Pendiente |
| Empresas (listar, editar, pausar/reactivar, cambiar) | MSF-138 T011/T017/T021/T025 | Pendiente |
| Permisos por empresa: asignar desde Usuarios, cambiar de empresa activa y nivel de edición resuelto | MSF-121 T022 | Escrito: `e2e/permisos-por-empresa.e2e.ts` (con sesión; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). No hay pantalla de una sección por empresa (Ventas/Consultas) todavía: el nivel se comprueba sobre la respuesta de `permisos_actuales` que decide los botones de edición |
| Editar la organización | MSF-132 T010/T017 | Pendiente |
| Actividad: ruta sin sesión → ingreso | MSF-463 T015 (parte pública) | Hecho: `e2e/acceso-publico.e2e.ts` |
| Actividad: listado con filtros, búsqueda y paginación (administrador/operador) | MSF-463 T015 | Pendiente: fixtures por rol (seguimiento) |
| Clientes: alta, búsqueda y exportación a Excel (SC-001) | MSF-180 T017 | Pendiente: fixtures por rol (seguimiento MSF-499); cubierto mientras tanto por Vitest (`pages/clientes`, `lib/exportarClientes`) y pgTAP |
| Stock: entrada 10 → salida 4 → ajuste a 3 → stock 3 y tres filas en el historial; salida de 5 rechazada con «No hay stock suficiente» (SC-001) | MSF-136 T021 | Escrito: `e2e/stock-movimientos.e2e.ts` (con sesión; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Desvío: no se pudo correr en el entorno del Desarrollador (sin acceso al daemon de Docker); se corre a mano con `pnpm dev:supabase` antes del merge (T024) y aborta si `SUPABASE_URL` no es local. Seguimiento: MSF-499 |
| Stock: 20 salidas simultáneas sobre stock 10 → 10 aceptadas, 10 rechazadas, stock 0, 10 movimientos y 10 eventos `stock.actualizado` (SC-001) | MSF-249 T007 | Escrito: `e2e/stock-concurrencia.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, no corre en el CI público). Desvío: no se pudo correr en el entorno del Desarrollador (sin acceso al daemon de Docker); se corre a mano con `pnpm dev:supabase` antes del merge. Contrato y cola: `docs/stock-eventos.md` |
| Catálogo: crear, editar, subir fotos y desactivar con Administrador y Operador; eventos en Actividad sin costo (SC-001, SC-006) | MSF-456 T025 | Desvío: pendiente de fixtures por rol (MSF-499); cubierto por pgTAP `catalogo_*` y Vitest de `pages/productos` |
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
