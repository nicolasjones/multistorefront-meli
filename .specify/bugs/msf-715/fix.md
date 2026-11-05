# Bug Fix: msf-715

- **Slug**: msf-715
- **Assessment**: .specify/bugs/msf-715/assessment.md

## Cambio aplicado

- `comprobante.tsx`: nueva prop `onCobroRegistrado` → `releerTrasCobro()` relee el comprobante (estado y `updated_at`; transiciones, historial y despacho se refrescan por su `updated_at`). `onRecargar` (el «Reintentar» de Cobros) vuelve a recargar solo cobros y saldo.
- La relectura post-cobro no toca el formulario; si falla, avisa sin tirar la pantalla al error general y deja sin acciones de estado. Mientras relee, Estado, Anular, Nota de crédito, Guardar y Confirmar quedan bloqueados.
- «Envío y transporte» y «Responsables del despacho» siguen visibles en solo lectura con la factura `cobrado`/`deuda` (`soloLectura`).
- `docs/cobros-por-comprobante.md` documenta el comportamiento. No cambia la RPC ni hay migración.

## Tests

`comprobante.cobros.test.tsx` (bloque MSF-715): estado «Cobrado» y acción siguiente con `updated_at` nuevo, «Deuda», cobro fallido no relee, «Reintentar» no pisa ediciones, relectura fallida, bloqueo durante la relectura. `comprobante.envio.test.tsx` y `comprobante.despacho.test.tsx`: solo lectura con la factura cobrada.

## Riesgos

Ninguna relectura post-cobro pisa el formulario. Quedan visibles, sin edición, envío y responsables de una factura cobrada.
