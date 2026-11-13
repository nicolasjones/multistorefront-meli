# Bug Fix: código sin uso de avisos de consulta (MSF-853)

- **Slug**: msf-853
- **Fixed**: 2026-11-13
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Se elimina el camino directo del aviso de consulta, que quedó sin uso desde MSF-562: la Edge Function
`enviar-aviso-consulta`, su flow de Kestra `avisos-consultas`, la tabla `dominio.consultas_avisos`, sus tres
RPC (`avisos_consulta_pendientes`, `tomar_aviso_consulta`, `cerrar_aviso_consulta`) y el ayudante
`private.correo_avisos_consulta`. El aviso vigente (el que emite `private.emitir_aviso` y manda el flow
`enviar-avisos`) queda intacto.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `supabase/migrations/20270305140001_avisos_consulta_camino_directo.sql` | added | Borra la tabla, las tres RPC y el ayudante; redefine `private.exclusiones_exportacion_total()` sin la fila de la tabla (la prueba de completitud exige que toda exclusión nombre una tabla que exista). Reversión escrita en el encabezado. |
| `supabase/functions/enviar-aviso-consulta/` | removed | `index.ts`, `handler.ts`, `contenido.ts` y `handler.test.ts`. |
| `infra/kestra/flows/avisos-consultas.yml` | removed | Flow que barre la cola vieja. |
| `infra/kestra/validar-avisos-consultas.test.mjs` | removed | Test estático del flow. |
| `infra/kestra/compose.yaml` | modified | Fuera `ENV_AVISOS_CONSULTAS_URL`, `ENV_AVISOS_CONSULTAS_APIKEY` y `SECRET_AVISOS_CONSULTAS_TOKEN`. |
| `infra/kestra/.env.example`, `supabase/functions/.env.example`, `.env.example` | modified | Fuera las variables `AVISOS_CONSULTAS_*` (se conserva `PANEL_URL`, que usa `enviar-resumen-reposicion`). |
| `package.json` | modified | Fuera `test:edge:enviar-aviso-consulta` y `test:kestra:avisos-consultas` (y sus llamadas en `test` y `test:web`). |
| `supabase/tests/database/consultas_aviso.test.sql` | modified | Queda la dirección de avisos por empresa (FR-009) y suma el gate: el camino directo no existe y el camino vigente sigue. |
| `supabase/tests/database/avisos_consulta_nueva.test.sql` | modified | La aserción del camino directo pasa de «la tabla está vacía» a «la tabla no existe». |
| `apps/web/e2e/consultas-recorrido.e2e.ts` | modified | Sin función ni Mailpit: comprueba que el aviso quedó encolado en `public.avisos_pendientes` para la persona de la organización. |
| `apps/web/src/pages/empresas/CorreoAvisosConsultas.tsx` | modified | El texto al usuario ya no promete que la dirección «completa el envío de los avisos encolados». |
| `apps/web/src/pages/empresas/CorreoAvisosConsultas.test.tsx` | modified | Assert del texto actualizado. |
| `docs/consultas.md`, `docs/avisos-por-correo.md` | modified | Describen solo el camino vigente y el retiro del anterior (con su reversión). |

## Diff Highlights

```sql
-- supabase/migrations/20270305140001_avisos_consulta_camino_directo.sql
drop function if exists public.avisos_consulta_pendientes(integer, integer);
drop function if exists public.tomar_aviso_consulta(uuid, integer);
drop function if exists public.cerrar_aviso_consulta(uuid, boolean, text);
drop function if exists private.correo_avisos_consulta(uuid);
drop table if exists dominio.consultas_avisos;
```

## Tests Added or Updated

- `supabase/tests/database/consultas_aviso.test.sql` — gate de MSF-853: la tabla, las tres RPC y
  `private.correo_avisos_consulta` ya no existen; el disparador `consultas_encolar_aviso` y
  `private.encolar_aviso_consulta()` siguen; la dirección de avisos por empresa conserva RLS, permisos
  (`42501`/`22023`/`40001`), idempotencia y registro de actividad.
- `supabase/tests/database/avisos_consulta_nueva.test.sql` — el aviso de consulta nueva sigue saliendo por
  `private.emitir_aviso` y la cola del camino directo ya no existe.
- `apps/web/src/pages/empresas/CorreoAvisosConsultas.test.tsx` — el texto al usuario advierte que la
  dirección ya no se usa (sin mencionar el camino anterior).
- `apps/web/e2e/consultas-recorrido.e2e.ts` — la consulta aparece en la bandeja en menos de 5 s, el aviso
  queda encolado para la persona de la organización y el detalle se abre desde el panel.

## Local Verification

- Commands run:
  - `pnpm lint` → ok (0 errores; solo warnings preexistentes de oxlint).
  - `pnpm build` → ok.
  - `pnpm --filter @platform/web exec vitest run src/pages/empresas/CorreoAvisosConsultas.test.tsx` → 10/10.
  - `node --test infra/kestra/validar-*.test.mjs` → 73/73.
  - `pnpm docs:check` → `Documentación de cambios: OK` y `Migraciones OK: 639 archivo(s), 1 nuevo(s)`.
  - `pnpm infra:config:kestra` → ok.
  - `pnpm calidad` → oxlint, knip (código muerto), jscpd, dependency-cruiser y syncpack ok; gitleaks no se
    pudo correr (docker sin permisos en este entorno) y lo corre el CI.
  - `pnpm exec playwright test --list consultas-recorrido` → el E2E se collected (1 test).
  - `pnpm exec tsc --ignoreConfig --noEmit --strict … e2e/consultas-recorrido.e2e.ts` → 0 errores.
- Manual checks: el grep de todo el repo no deja referencias vivas a la función, al flow, a la tabla ni a
  las variables `AVISOS_CONSULTAS_*` (solo quedan las menciones históricas en `specs/` y las que explican el
  retiro en `docs/` y los tests).
- No corrido localmente: `pnpm test:db` (pgTAP) y el E2E, que necesitan el stack local de Supabase
  (`pnpm dev:supabase`); este entorno no tiene permisos de docker.

## Deviations from Assessment

- El assessment proponía limpiar las variables `AVISOS_CONSULTAS_*`; se conserva `PANEL_URL` en
  `supabase/functions/.env.example` porque la usa `enviar-resumen-reposicion` (si se borraba, esa función
  perdía su enlace).
- La definición de `private.exclusiones_exportacion_total()` se copió de `20270224110206` (la última
  definición vigente) sin la fila de la tabla: el assessment lo mencionaba como riesgo y resultó obligatorio,
  no opcional, por el assert «toda exclusión nombra una tabla que existe» de `exportacion_total.test.sql`.

## Follow-ups

- `dominio.consultas_configuracion` y el campo «Correo para avisos de consultas» de la ficha de la empresa
  quedan sin ningún aviso que los use: es una decisión de producto (borrar el campo o volver a darle
  sentido) y está fuera del alcance de MSF-853. El texto al usuario ya lo advierte.
- La tabla `dominio.consultas_avisos` se borra con sus filas (histórico de avisos ya cerrados). Si algún
  entorno tuviera avisos `pendiente` de esa cola, no se enviarían: al revisar, no hay consumidor vivo y el
  camino vigente los cubre.
