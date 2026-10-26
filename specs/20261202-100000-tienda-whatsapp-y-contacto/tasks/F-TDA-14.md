# Marcas de F-TDA-14 (MSF-433)

Las tareas de **esta** historia quedaron hechas (la historia está en el último ciclo de la épica MSF-212).
Se reconcilia por si el Revisor no las marcó.

- [x] T020 — migración `supabase/migrations/20261212121000_tienda_whatsapp.sql` con `publico.registrar_consulta_whatsapp(host, producto, clave_envio)` (FR-025)
- [x] T021 — pgTAP `supabase/tests/database/tienda_whatsapp.test.sql` (SC-006)
- [x] T022 — `apps/web/src/lib/whatsapp.ts` con sus tests (FR-022)
- [x] T023 — `whatsapp/BotonWhatsApp.tsx` y `whatsapp/useContactoWhatsapp.ts` (FR-020, FR-021)
- [x] T024 — `whatsapp/DialogoWhatsApp.tsx` (FR-021, FR-023, FR-026)
- [x] T025 — `apps/web/src/lib/registroWhatsapp.ts` y su llamada desde el diálogo (FR-024)
- [x] T026 — integración en la ficha (`rutas/producto.tsx` / `ficha/DatosProducto.tsx`) (FR-020)
- [x] T027 — Vitest + axe del botón, el diálogo y la ficha (SC-007)
- [x] T028 — E2E `apps/web/e2e/tienda-whatsapp.e2e.ts` (SC-008)

## Evidencia

- Vitest del área (WhatsApp + ficha): 108/108 en verde (`pnpm --filter @platform/web exec vitest run src/lib/whatsapp.test.ts src/lib/registroWhatsapp.test.ts src/pages/tienda-publica/whatsapp src/pages/tienda-publica/FichaWhatsapp.test.tsx src/pages/tienda-publica/FichaProducto.test.tsx src/pages/tienda-publica/FichaMovil.test.tsx`).
- pgTAP de WhatsApp: `database … tienda_whatsapp.test.sql ....................... ok` → `Result: PASS` (CI del PR #445).
- El pgTAP de WhatsApp (35 asserts) cubre además el `search_path` vacío de la RPC, el RLS de `dominio.consultas`, el
  `origen` de cada envío de `dominio.tienda_envios` (`whatsapp` y `formulario`: el cupo es el mismo para los dos
  frentes) y que una falla interna responda el error genérico (con y sin registrar consulta o gastar cupo).
- `pnpm estilos:check`, `pnpm lint`, `pnpm build` y `pnpm docs:check` en verde.
- E2E (`SC-008`): el CI no lo corre (necesita el stack local de Supabase); queda para el stack local — ver `docs/e2e-app.md`.
