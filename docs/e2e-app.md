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
- **Desde GitHub (manual):** Actions → **Validate** → **Run workflow** → activá **«Grabar video + traza»** (por defecto sí; fuerza build + e2e aunque no haya cambios de código); al terminar, bajá el artefacto `playwright-report`.
- **Grabar una interacción y generar el test (codegen):** `pnpm test:e2e:codegen` (con la app corriendo en `http://localhost:4300`; o `E2E_BASE_URL=...`).

En CI (`validate.yml`) el artefacto `playwright-report` incluye el reporte HTML + `test-results` (videos y trazas) y se sube **siempre** (también si el test pasa), con retención de 14 días. Se descarga desde la pestaña **Artifacts** del run y se abre con `npx playwright show-report` o `npx playwright show-trace`.

**Control remoto por Tailscale (opcional):** en el nodo, `pnpm --filter @platform/web test:e2e:ui --ui-host=0.0.0.0 --ui-port=9323` y abrí `http://<nodo>:9323` desde tu máquina en la tailnet. El `webServer` levanta el build/preview; requiere el stack de la app.

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
