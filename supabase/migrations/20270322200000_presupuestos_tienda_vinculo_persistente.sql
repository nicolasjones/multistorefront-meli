-- MSF-176 · Tienda compra y cuentas, PR de cierre, H-2 de la revisión de seguridad integral (T070): el vínculo de un presupuesto de la tienda sobrevive a la baja de la cuenta.
--
-- `dominio.presupuestos_tienda_cuenta_fk` era `on delete cascade`: si se borraba la cuenta web (la fusión de clientes da de baja la cuenta no elegida con un `delete`, y borrar el
-- usuario de Auth o la cuenta también la elimina) se borraba el VÍNCULO del presupuesto, y con él el rótulo «Tienda online (cliente)», la «Nota del cliente» y el conteo de los topes, aunque el
-- comprobante siguiera existiendo. Ahora la columna `cuenta_cliente_id` admite nulo y la FK es `on delete set null (cuenta_cliente_id)` (PostgreSQL 15 o más): el vínculo queda, sin cuenta.
-- Con `MATCH SIMPLE` una fila con la cuenta nula no se valida contra `cuentas_cliente`. Efectos:
--   * el rótulo, la nota y la exportación total siguen mostrando el presupuesto (la cuenta no es parte del rótulo: se deriva de la existencia del vínculo);
--   * los topes por cuenta (5 por día, 10 abiertos) y la idempotencia cuentan por `cuenta_cliente_id`: las filas sin cuenta ya no cuentan para ninguna cuenta nueva (el cliente fusionado
--     conserva su cuenta, que se re-vincula al cliente conservado);
--   * la unicidad `(cuenta_cliente_id, clave_envio)` no aplica a las filas sin cuenta (nulos distintos), y nadie puede reusar esa clave: la cuenta ya no existe.
-- `dominio.favoritos_cliente` sigue `on delete cascade` (son datos privados de la cuenta: se van con ella).
--
-- Efecto colateral que obliga a tocar también las otras dos FK «no action»: con la FK de la cuenta en `set null`, la baja de una ORGANIZACIÓN (que borra cuentas, clientes, comprobantes y
-- empresas en cascada) ya no borra el vínculo por el camino de la cuenta, y los controles `no action` de `cliente_fk` y `comprobante_fk` (que PostgreSQL evalúa al terminar cada
-- borrado en cascada) veían el vínculo todavía vivo y bloqueaban la baja de la organización. Un vínculo no tiene sentido sin su cliente ni su comprobante, así que ambas pasan a
-- `on delete cascade` (el cliente archivado por la fusión NO se borra, y un comprobante no se borra en el flujo normal: solo la baja de la organización llega acá).
--
-- Esquemas (Principio VII): ninguna tabla nueva; se altera `dominio.presupuestos_tienda` (de `dominio`). DDL idempotente. Migración aditiva.
-- Reversión (migración posterior): borrar o reasignar las filas con `cuenta_cliente_id` nulo, `alter column cuenta_cliente_id set not null`, volver la FK de la cuenta a `on delete cascade` y las de
-- cliente y comprobante a `no action`.

alter table dominio.presupuestos_tienda alter column cuenta_cliente_id drop not null;

alter table dominio.presupuestos_tienda drop constraint if exists presupuestos_tienda_cuenta_fk;
alter table dominio.presupuestos_tienda
  add constraint presupuestos_tienda_cuenta_fk
    foreign key (cuenta_cliente_id, organizacion_id, empresa_id)
    references public.cuentas_cliente (id, organizacion_id, empresa_id) on delete set null (cuenta_cliente_id);

alter table dominio.presupuestos_tienda drop constraint if exists presupuestos_tienda_cliente_fk;
alter table dominio.presupuestos_tienda
  add constraint presupuestos_tienda_cliente_fk
    foreign key (cliente_id, organizacion_id)
    references public.clientes (id, organizacion_id) on delete cascade;

alter table dominio.presupuestos_tienda drop constraint if exists presupuestos_tienda_comprobante_fk;
alter table dominio.presupuestos_tienda
  add constraint presupuestos_tienda_comprobante_fk
    foreign key (comprobante_id, organizacion_id)
    references dominio.comprobantes_venta (id, organizacion_id) on delete cascade;
