# Marcas de F-INI-02 (MSF-361)

Las tareas de **esta** historia están hechas; la evidencia está en la rama `feat/story-MSF-361`.

- [x] T008 — `supabase/migrations/20270115100000_alertas_inicio_tabla.sql` (RLS, sin escritura desde la app, reversión documentada)
- [x] T009 — `supabase/migrations/20270115100100_alertas_inicio_recalculo.sql` (cinco tipos, enlaces de lista cerrada, advisory lock)
- [x] T010 — `supabase/migrations/20270115100200_alertas_inicio_visibles.sql` (`security_invoker`, grants solo a `authenticated`)
- [x] T011 — `supabase/tests/database/alertas_inicio.test.sql`
- [x] T012 — `supabase/functions/recalcular-alertas-inicio/` (`handler.ts`, `handler.test.ts`)
- [x] T013 — `infra/kestra/flows/alertas-inicio.yml` + `infra/kestra/validar-alertas-inicio.test.mjs`
- [x] T014 — `apps/web/src/pages/inicio/AlertasInicio.tsx` + `alertas-lista.test.tsx`
- [x] T015 — aviso de demora en `AlertasInicio.tsx` + `alertas-demora.test.tsx`
- [x] T016 — `feature-ml.test.tsx`; en BD el check de `tipo` no admite alertas de Mercado Libre (pgTAP, `alertas_inicio.test.sql`)
