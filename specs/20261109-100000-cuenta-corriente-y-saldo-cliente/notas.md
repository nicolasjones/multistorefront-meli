# Notas: Cuenta corriente y saldo del cliente (F-CLI-19, MSF-451)

Lecciones y pendientes de la auditoría retroactiva por roles de MSF-450 (2026-11-11). El comportamiento está en `spec.md` (*Ampliación (2026-11-11)*) y en `docs/clientes.md`.

## Lecciones

1. **Antes de cambiar la «fuente única de saldo», listá todos los lectores del saldo.** Hacé `grep` de
   `total_con_iva - ... cobros` (y variantes) en `supabase/migrations` y alineá cada uno o declará la diferencia por
   escrito. Acá la cuenta corriente restó las notas de crédito (20270227110000) mientras `saldo_comprobante` no, y la
   revisión lo encontró tarde (20270227140000). Todavía quedan lectores sin alinear (ver *Pendientes de Nicolás*).
2. **Si una decisión de Nicolás modifica el comportamiento de Ventas, abrí primero una spec de ampliación y un gate
   antes de migrar.** Las migraciones 20270227140000 y 20270227150000 cambian el tope de cobro, el estado de las
   facturas y el importe de los contrarreembolsos, y se mergearon como «seguimientos» sin ampliar antes la spec de
   Ventas (MSF-195). La spec se ordenó después (*Ampliación (2026-11-11)*).
3. **Un E2E que no corre en el CI no cuenta como verificación.** `cuenta-corriente-cliente.e2e.ts` se omite sin
   `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`: hay que declararlo en *Desvíos* de la tarea o activar esas variables en el
   job del CI.

## Decisiones tomadas (2026-11-12)

Todas: Aprobada por Nicolás el 2026-11-12 («avanza con todo»).

- **¿Cobrada ≠ deuda?** Hoy una factura en «Cobrado» no entra a la cuenta corriente aunque su cobro no esté en el libro. Confirmado: la cobrada no es deuda.
- **Saldo por tiendas accesibles vs. por organización.** La cuenta corriente suma las tiendas a las que la persona
   accede (`private.empresas_accesibles()`), pero la sección «Compras» de la misma ficha es de toda la organización:
   inconsistencia dentro de la misma pantalla. Confirmado: el saldo respeta `empresas_accesibles()`.
- **Permiso `clientes` en lectura.** Quien lo tiene ve total, cobrado, notas de crédito y saldo aunque no acceda a Ventas. Confirmado.
- **Aprobación retroactiva de las migraciones `20270227140000` y `20270227150000`**, que cambian el comportamiento de
   Ventas (ver lección 2). Si no las aprueba, se revierten (`docs/clientes.md`, *Reversión*). Aprobadas.

## Pendientes de Nicolás

Decisiones que el desarrollo tomó de forma provisoria y que él tiene que confirmar o cambiar. Las 1, 3, 4 y 8 de la lista original se movieron arriba (2026-11-12). Las demás siguen acá; los puntos 7 y 8 de abajo tienen su recomendación **aprobada el 2026-11-12, en implementación** (otros PRs; el 8 es el HOLD en ItsAPlan).

2. **Estados «Pendiente» y «Confirmada» como deuda.** Hoy cuentan los siete estados vivos (`confirmada`, `pendiente`,
   `aceptado`, `en_proceso`, `deuda`, `armando`, `incompleto`); un pgTAP los fija uno por uno.
5. **Sin saldo a favor (confirmado) y su consecuencia.** Una factura de 1.000 con 800 cobrados y una nota de 400
   desaparece de la cuenta corriente aunque el cliente, en rigor, tendría 200 a favor: ese excedente no se acredita en
   ningún lado.
6. **«Facturado» del ranking en pesos enteros vs. saldo con centavos.** Son dos presentaciones distintas (y dos bases:
   sin IVA y con IVA).
7. **Alinear `resumen_pagos` y `listar_pagos` «Solo con saldo» (seguimiento abierto; aprobada el 2026-11-12, en implementación).** `resumen_pagos`
   (`20270114110200`, CTE `saldos`, `greatest(total_con_iva − Σ cobros, 0)`) y `listar_pagos` con «Solo con saldo»
   (`20270114110100`, `greatest(c.total_con_iva − cobrado, 0) > 0`) NO restan las notas de crédito: la tarjeta «Saldo
   pendiente de clientes» de Pagos puede diferir de la cuenta corriente de la ficha. Seguimiento abierto en
   Ventas (MSF-195).
8. **MSF-452, MSF-453 y MSF-454** (las ideas F-CLI-20, F-CLI-21 y F-PRV-09 de la épica; HOLD aprobado el 2026-11-12, en implementación) no tienen requisitos por diseño,
   pero tienen un «Implementation Report» de runs fallidos en It's a Plan. Hay que ponerlas en HOLD/espera para que el
   poller no las redespache. **Esto lo hace Nicolás o el orquestador; acá solo se anota.**
