-- MSF-857: la baja de una organización con ingresos de mercadería (cabecera, líneas, movimientos de stock,
-- proveedor y producto) se completa. Cubre las claves diferidas de MSF-844/MSF-847 con datos reales de ingresos.
begin;

select plan(4);

insert into public.organizaciones (id, nombre) values ('00000000-0000-0000-0000-0000000085a1','Baja con ingresos');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values ('00000000-0000-0000-0000-0000000085a2','00000000-0000-0000-0000-0000000085a1','Empresa',true);
insert into dominio.proveedores (id, organizacion_id, razon_social, cuit) values ('00000000-0000-0000-0000-0000000085a3','00000000-0000-0000-0000-0000000085a1','Proveedor','20123456786');
insert into dominio.productos (id, organizacion_id, nombre, moneda, precio_lista, proveedor_id) values ('00000000-0000-0000-0000-0000000085a4','00000000-0000-0000-0000-0000000085a1','Producto','ARS',10,'00000000-0000-0000-0000-0000000085a3');
insert into dominio.existencias (producto_id, organizacion_id, cantidad) values ('00000000-0000-0000-0000-0000000085a4','00000000-0000-0000-0000-0000000085a1',5)
  on conflict do nothing;
insert into dominio.movimientos_stock (id, organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, fecha)
  select '00000000-0000-0000-0000-0000000085a5','00000000-0000-0000-0000-0000000085a1','00000000-0000-0000-0000-0000000085a4','entrada',5,5,5,id,current_date
  from dominio.motivos_movimiento where organizacion_id='00000000-0000-0000-0000-0000000085a1' limit 1;
insert into dominio.ingresos_mercaderia (id, organizacion_id, empresa_id, proveedor_id, fecha)
  values ('00000000-0000-0000-0000-0000000085a6','00000000-0000-0000-0000-0000000085a1','00000000-0000-0000-0000-0000000085a2','00000000-0000-0000-0000-0000000085a3',current_date);
insert into dominio.ingresos_mercaderia_lineas (ingreso_id, organizacion_id, producto_id, cantidad, costo_unitario_usd, movimiento_id)
  values ('00000000-0000-0000-0000-0000000085a6','00000000-0000-0000-0000-0000000085a1','00000000-0000-0000-0000-0000000085a4',5,1,'00000000-0000-0000-0000-0000000085a5');

select is((select count(*)::int from dominio.ingresos_mercaderia_lineas
            where ingreso_id = '00000000-0000-0000-0000-0000000085a6'), 1, 'el ingreso tiene su línea');

select lives_ok(
  $t$delete from public.organizaciones where id = '00000000-0000-0000-0000-0000000085a1'$t$,
  'la baja de una organización con ingresos de mercadería se completa');

select is((select count(*)::int from dominio.ingresos_mercaderia
            where organizacion_id = '00000000-0000-0000-0000-0000000085a1')
        + (select count(*)::int from dominio.ingresos_mercaderia_lineas
            where organizacion_id = '00000000-0000-0000-0000-0000000085a1')
        + (select count(*)::int from dominio.movimientos_stock
            where organizacion_id = '00000000-0000-0000-0000-0000000085a1'),
        0, 'la cascada borra ingresos, líneas y movimientos');

select is((select count(*)::int from dominio.proveedores
            where organizacion_id = '00000000-0000-0000-0000-0000000085a1')
        + (select count(*)::int from dominio.productos
            where organizacion_id = '00000000-0000-0000-0000-0000000085a1'),
        0, 'la cascada borra proveedores y productos');

select * from finish();
rollback;
