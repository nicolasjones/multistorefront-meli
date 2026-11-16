# Fix MSF-806 — timeout de 5s en NuevoMovimientoDialog.test.tsx

**Causa**: `web (2)` del PR #715 (solo docs, base `main`) falló con `Test timed out in 5000ms`. El `testTimeout: 15000` global (commit 767f745c) está en `dokploy` pero no en `main`, así que en `main` rige el default de 5s y el runner self-hosted cargado lo excede. Es rojo de base, ajeno al diff del PR; `web (1)`/`web (3)` fallaron solo por la cancelación de la matrix.

**Cambio**: `vi.setConfig({ testTimeout: 20000 })` en `apps/web/src/pages/stock/NuevoMovimientoDialog.test.tsx` (mismo idioma que `presupuestos.test.tsx`). No se toca el timeout global ni otros tests.

**Pendiente de proceso**: PR #715 queda `DIRTY`; al actualizar su rama con la base que incluya este fix (o promover `dokploy`→`main`) el shard pasa. Etiqueta `ci-ajeno`.
