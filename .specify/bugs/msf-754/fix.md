# Fix MSF-754 — job `web` rojo en `show.reparaciones.test.tsx`

**Causa**: no era una aserción desactualizada. El contador «N reparaciones» existe en `ReparacionesDeCliente.tsx`. La pestaña se carga con `lazy()` (`show.tsx`), y con el shard cargado el import dinámico tarda más que el 1 s por defecto de `findBy*`. Aislado el test pasa (12/12): es un flake de tiempo.

**Cambio** (solo test, sin cambio de comportamiento): `configure({ asyncUtilTimeout: 10000 })` en `show.reparaciones.test.tsx` (beforeAll/afterAll). El tope por test sigue siendo `testTimeout` (15 s).

**Reversión**: `git revert` del commit.
