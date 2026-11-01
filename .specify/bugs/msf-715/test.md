# Bug Test: msf-715

- Test de regresión `comprobante.cobros.test.tsx` («…relee el comprobante… (MSF-715)»): sin el fix falla (1 failed), con el fix pasa.
- Suite `comprobante.cobros.test.tsx` completa: 64 passed.
- Pendiente de CI: lint/build y E2E; no se reprodujo contra una base real.
- Reintento: el bloqueo posterior al cobro lo baja solo la lectura vigente (hallazgo del Revisor, ver commit siguiente); 165 passed en comprobante*.
