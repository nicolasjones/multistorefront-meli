# Notas de la épica Ventas motos (MSF-145)

Complemento de [spec.md](./spec.md). Salen de la auditoría retroactiva por roles (2026-11-12).

## Lecciones

- **RLS nueva por empresa, no global.** Una política de lectura nueva sobre datos de una tienda debe usar `private.nivel_ventas_en_empresa` sobre la empresa del registro, no el nivel global (`private.nivel_seccion('ventas')`). La política `envios_moto_select` lo hacía mal y `20270223100000_envios_moto_lectura_por_empresa.sql` la corrigió tras la revisión final (commit e1d50985).
- **Exportación total desde la spec.** Toda épica que crea una tabla con `organizacion_id` debe incluir en `plan.md` y `tasks.md`, desde la spec, la migración que la suma a `private.conjuntos_exportacion_total()` (o a las exclusiones). Acá apareció recién cuando falló el pgTAP de completitud (`20270222300200_exportacion_total_envios_moto.sql`).
- **Épica manual que cambia comportamiento existente.** Se enmienda el cuerpo normativo de la spec en el mismo PR (no solo una nota), con su historial en «Ampliación e historial de cambios».

## Pendientes de Nicolás

1. **Contrarreembolsos por defecto.** La pantalla abre en Contrarreembolsos (orden Contrarreembolsos, Motos, Terminales); la spec original decía Terminales.
2. **Factura anulada después.** Si se anula una factura con envío ya registrado, el envío sigue editable y rendible (decisión provisoria, a confirmar con el cliente).
3. **Borrador en la elegibilidad.** Se puede registrar un envío sobre una factura en borrador (cualquiera salvo anulada); confirmar que es lo deseado.
4. **`abono` sin vínculo con cobros.** `envios_moto.abono` es texto libre numérico sin relación con el libro de cobros:
   - Una nota de crédito posterior no lo ajusta: la migración `20270227150000_notas_credito_sincronizan_estado_y_contrarreembolso.sql` ajusta contrarreembolsos pero no `envios_moto.abono`.
   - `rendir_envios_moto` no registra ningún cobro en el libro de cobros, así que tras rendir puede quedar saldo pendiente o «Deuda» en el comprobante. Decidir si rendir debe registrar el cobro.
5. **Reversión de la rendición.** Fuera de alcance por la decisión del 2026-11-09, que no consideró las notas de crédito; con el punto 4 conviene revisarla.
6. **«Comentarios de clientes» del Code Review.** No se localizaron en el repositorio ni en la spec; Nicolás debe indicar a qué se refieren.
