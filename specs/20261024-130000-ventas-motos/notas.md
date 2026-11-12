# Notas de la épica Ventas motos (MSF-145)

Complemento de [spec.md](./spec.md). Salen de la auditoría retroactiva por roles (2026-11-12).

## Lecciones

- **RLS nueva por empresa, no global.** Una política de lectura nueva sobre datos de una tienda debe usar `private.nivel_ventas_en_empresa` sobre la empresa del registro, no el nivel global (`private.nivel_seccion('ventas')`). La política `envios_moto_select` lo hacía mal y `20270223100000_envios_moto_lectura_por_empresa.sql` la corrigió tras la revisión final (commit e1d50985).
- **Exportación total desde la spec.** Toda épica que crea una tabla con `organizacion_id` debe incluir en `plan.md` y `tasks.md`, desde la spec, la migración que la suma a `private.conjuntos_exportacion_total()` (o a las exclusiones). Acá apareció recién cuando falló el pgTAP de completitud (`20270222300200_exportacion_total_envios_moto.sql`).
- **Épica manual que cambia comportamiento existente.** Se enmienda el cuerpo normativo de la spec en el mismo PR (no solo una nota), con su historial en «Ampliación e historial de cambios».

## Decisiones tomadas (2026-11-12)

- **Contrarreembolsos por defecto.** La pantalla abre en Contrarreembolsos (orden Contrarreembolsos, Motos, Terminales); la spec original decía Terminales. Aprobada por Nicolás el 2026-11-12 («avanza con todo»)

Nicolás aprobó las recomendaciones el 2026-11-12 («avanza con todo»). Además de la de Contrarreembolsos por defecto, se implementaron en el PR «fix(ventas): motos — factura anulada bloquea, borrador no elegible, rendir cobra (MSF-145)»:

- **Factura anulada después** (antes pendiente 2): el envío queda bloqueado, no se edita (`55000`) ni se rinde (`55000`, todo o nada); el listado trae `puede_editar = false`, `puede_rendir = false` y `bloqueado_motivo`, y la pantalla lo muestra con la etiqueta «Factura anulada» y el motivo. No cuenta en «Motos sin rendir». Migraciones `20270228110000` y `20270228110100`.
- **Borrador en la elegibilidad** (antes pendiente 3): solo facturas emitidas; el borrador no se ofrece en el selector ni se registra (`22023`). Los envíos ya cargados sobre un borrador siguen existiendo; rendirlos con abono mayor que 0 exige confirmar la factura (`55000`). `20270228110000`.
- **`abono` y libro de cobros** (antes pendiente 4): rendir registra el cobro por `least(abono, saldo neto)` por `private.registrar_cobro_interno` (origen `contrarreembolso`, forma de la factura o «Contrarreembolso» de la tienda, sin cuenta) y guarda `cobro_id` en el envío; una nota de crédito posterior baja el abono de los envíos sin rendir hasta el saldo neto (puede quedar en 0) con evento `envio_moto.abono_ajustado`, sin tocar los rendidos y con `skip locked`. `20270228110100` y `20270228110200`.
  - Una factura ya en estado Cobrado no recibe cobro al rendir (estado intacto); un borrador con abono se muestra sin poder rendirse («Confirmá la factura antes de rendir»).
  - Revisión de seguridad (2026-11-12): permiso antes de los locks y el mismo `42501` exista o no el envío o comprobante; superadmin sin membresía avisado antes de empezar; los borradores con abono se listan todos.
  - Límites: si se anula la nota el abono no sube de nuevo; revertir una rendición exige un contra-asiento; con una forma de pago que genera deuda la factura puede quedar en Deuda; la tienda necesita una forma de pago «Contrarreembolso» activa si la factura no tiene forma de pago; un superadmin sin membresía en la organización no puede rendir (lo exige el mecanismo de cobros).

Siguen abiertos: la reversión de la rendición (punto 5, fuera de alcance; ahora además debería revertir el cobro) y los «comentarios de clientes» (punto 6).

## Pendientes de Nicolás

1. ~~**Contrarreembolsos por defecto.**~~ Aprobada el 2026-11-12 (ver arriba).
2. ~~**Factura anulada después.**~~ Decidido el 2026-11-12 (ver arriba).
3. ~~**Borrador en la elegibilidad.**~~ Decidido el 2026-11-12 (ver arriba).
4. ~~**`abono` sin vínculo con cobros.**~~ Decidido el 2026-11-12 (ver arriba).
5. **Reversión de la rendición.** Fuera de alcance por la decisión del 2026-11-09, que no consideró las notas de crédito; ahora que rendir deja un cobro en el libro, revertir tendría que deshacerlo (el libro no se borra: haría falta un contra-asiento). Sigue abierta.
6. **«Comentarios de clientes» del Code Review.** No se localizaron en el repositorio ni en la spec; Nicolás debe indicar a qué se refieren.

## Documentador final (2026-11-12)

Auditoría de `docs/*.md` y specs contra `origin/dokploy` (migraciones, RPC, componentes y ayuda en `apps/web/src/ayuda`). Solo documentación.

- Verificado contra `20270228110000`, `20270228110100` y `20270228110200`: anulada bloquea (`55000`), borrador no elegible en el registro (`22023`) y rendir con abono exige factura confirmada (`55000`), rendir cobra `least(abono, saldo neto)` con origen `contrarreembolso` y la nota de crédito baja el abono pendiente. `docs/ventas-motos.md` y `docs/cobros-por-comprobante.md` coinciden.
- `docs/contrarreembolsos-transporte.md` decía que la tarjeta «Motos sin rendir» va «arriba de las pestañas»; está dentro de la pestaña Motos (`TransportesMotos.tsx`). Corregido (ya lo decía bien `docs/ventas-transportes.md`).
- `docs/roadmap-template.md`: la fila de MSF-145 incluye las decisiones del 2026-11-12.

### Revisión independiente (2026-11-12)

- Precisión: editar o rendir un envío de una factura anulada falla con `55000`; registrar un envío nuevo sobre una factura anulada o en borrador falla con `22023` (`20270228110000`).
