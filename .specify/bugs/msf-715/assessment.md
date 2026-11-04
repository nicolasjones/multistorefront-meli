# Bug Assessment: Detalle del comprobante queda desactualizado tras registrar un cobro

- **Slug**: msf-715
- **Created**: 2026-11-01
- **Source**: pasted text (MSF-715, It's a Plan; sin URL)
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

"[Bug] Tras registrar un cobro, el detalle del comprobante queda con estado y `updated_at` viejos y las acciones siguientes fallan con «Otra persona modificó este comprobante»."

## Symptom

Después de registrar un cobro, la tarjeta de cobros se actualiza, pero el comprobante en pantalla conserva el `estado` y el `updated_at` anteriores. La base ya los cambió, así que la siguiente acción que envía el `updated_at` viejo recibe el conflicto `40001`. Esperado: el detalle se relee tras el cobro y las acciones usan el `updated_at` vigente.

## Reproduction

1. Abrir una factura confirmada con saldo pendiente y permiso `registrar_cobro`.
2. «Registrar cobro» por el saldo completo (estado pasa a `cobrado`) o parcial con forma de pago que genera deuda (pasa a `deuda`).
3. Sin recargar la página, ejecutar una acción que envíe `updated_at`: cambiar estado, anular, guardar líneas o registrar faltantes.
4. Falla con «Otra persona modificó este comprobante».

[NEEDS CLARIFICATION: no se corrió contra una base real; la conclusión sale de leer el código y las migraciones.]

## Suspected Code Paths

- `apps/web/src/components/ventas/CobrosComprobante.tsx:288-290` — tras `registrarCobro` llama `onRegistrado(mensaje)`, `onRecargar()` y `onCerrar()`.
- `apps/web/src/pages/ventas/comprobante.tsx:860-861` — `onRecargar` está cableado a `recargarCobros()` y `onRegistrado` a `setExito`. Ninguno llama a `cargar()`, que es lo único que relee el comprobante.
- `apps/web/src/pages/ventas/comprobante.tsx:247-275` — `recargarCobros` solo relee cobros, saldo y permiso, no el comprobante.
- `supabase/migrations/20270114100200_registrar_cobro_interno.sql:13-15,157-159` — la RPC llama a `private.marcar_estado_cobro_comprobante(..., 'cobrado'|'deuda')`, que cambia `estado` y `updated_at`.
- `apps/web/src/pages/ventas/comprobante.tsx:416,453,532,967` — las acciones posteriores envían `comprobante.updated_at` del estado local, que quedó viejo (control optimista de concurrencia → `40001`).
- Contraste: en faltantes, nota, anulación y envío el handler llama `cargar()` (`comprobante.tsx:~960`, `onCambio={() => void cargar()}`), pero el de cobros no.

## Root Cause Hypothesis

`registrar_cobro` modifica el comprobante en la base (estado `cobrado`/`deuda` y `updated_at`). La pantalla, al terminar el cobro, solo relee la lista de cobros y el saldo, nunca el comprobante. El estado local queda con `estado` y `updated_at` previos, así que el badge, las transiciones permitidas y el historial (`claveRecarga` depende de `updated_at`) no se refrescan. Las acciones que envían ese `updated_at` chocan con el bloqueo optimista. Confianza: alta (lectura de código y de la migración; falta reproducir).

## Proposed Remediation

**Preferred**: en `comprobante.tsx`, cuando el cobro se registra con éxito, llamar también a `cargar()` además de `recargarCobros()`. Lo más simple es que `onRecargar` ejecute ambos (`void cargar(); void recargarCobros()`). Así `comprobante` y `updated_at` se actualizan, y los efectos que dependen de `estado`/`updated_at` (transiciones permitidas, detalle de acciones, historial) se disparan solos. Revisar que `cargar()` no deje la pantalla en blanco: no pone `cargado` en false, así que solo reemplaza datos. También conviene que `setFormulario(aFormulario(existente))` no pise ediciones sin guardar; en una factura confirmada el formulario es de solo lectura, pero hay que comprobarlo.

**Alternatives**:
- Hacer que `registrarCobro` devuelva el comprobante actualizado y aplicarlo con `setComprobante`. Cambia el contrato de la RPC y requiere migración, así que es peor.
- Reintentar automáticamente ante `40001`. Esconde el conflicto real de concurrencia y no corrige el estado visible.

**Files likely to change**:
- `apps/web/src/pages/ventas/comprobante.tsx`
- `apps/web/src/pages/ventas/comprobante.cobros.test.tsx`

**Tests to add or update**:
- Registrar un cobro que salda la factura: `obtenerComprobante` vuelve a llamarse y el estado mostrado pasa a «Cobrado».
- Tras el cobro, una acción posterior (cambiar estado) envía el `updated_at` nuevo, no el viejo.
- Cobro parcial con forma de pago que genera deuda: se muestra «Deuda».
- Cobro fallido: no se relee el comprobante.

## Risks & Considerations

- Releer el comprobante reinicia `formulario`; verificar que no se pierda nada editable.
- Doble petición simultánea (`cargar` y `recargarCobros`): ya hay guardas por contador `ultimaPeticion*`.
- No hay cambios de base ni de RLS. Documentar en `docs/` o en la spec de cobros según la regla de documentación obligatoria.
- Revisar otras vías que mutan el comprobante sin releerlo (p. ej. marcar contrarreembolso cobrado, conciliar pago) por el mismo patrón.

## Open Questions

- [NEEDS CLARIFICATION: ¿«Marcar contrarreembolso cobrado» y «Conciliar pago» también dejan el detalle viejo? Comparten la RPC interna.]
