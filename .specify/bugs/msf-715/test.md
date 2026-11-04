# Bug Test: msf-715

- Test de regresión `comprobante.cobros.test.tsx` («…relee el comprobante… (MSF-715)»): sin el fix falla (1 failed), con el fix pasa.
- Suite `comprobante.cobros.test.tsx` completa: 64 passed.
- Pendiente de CI: lint/build y E2E; no se reprodujo contra una base real.
- Reintento: el bloqueo posterior al cobro lo baja solo la lectura vigente (hallazgo del Revisor, ver commit siguiente); 165 passed en comprobante*.
- CI `web (3)`/`web (2)` (run 41603908451): `tienda-publica/index.test.tsx` «muestra la tienda cuando el Host resuelve» falló con `fetch failed`. Es de la base, no del diff: la rama no toca `tienda-publica` ni `lib/tienda*`. Sobre `aca9e8ca` ese archivo pasa 5/5 y `comprobante*` pasa 168/168 (9 archivos). Sin merge de `origin/dokploy`, sin migraciones.
