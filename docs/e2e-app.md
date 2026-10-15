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
| Editar la organización | MSF-132 T010/T017 | Pendiente |
| Verificación manual 320/768/1440 px y lector de pantalla | MSF-125 T018 | Pendiente (manual) |

## CI

El job de CI `e2e-web` en `validate.yml` (runner self-hosted: `pnpm build`,
Chromium, `pnpm test:e2e`, subida del informe HTML y trazas como artefacto si
falla) **no está incluido en este PR**: el token de los agentes no tiene scope
`workflow` y GitHub rechaza el push. Queda como tarea de seguimiento (MSF-132);
hasta entonces los specs públicos se corren a mano con `pnpm test:e2e`.

El `globalSetup` (`e2e/global-setup.ts`) falla con un mensaje claro si falta
`apps/web/dist` (no al importar la config, así `--list`/`codegen` siguen
andando). Cuando se agregue el job: Chromium se instala sin `--with-deps`
(requiere sudo), así que el runner debe traer las librerías del sistema de
Chromium (si no, sumarlas a la imagen en `infra/runner/`). Los recorridos con
sesión (tabla de arriba) requieren ampliar el stack de `scripts/supabase-ci.mjs`
(hoy omite `kong,postgrest`) o un job aparte: siguen pendientes y abiertos en
las tasks.md de origen.
