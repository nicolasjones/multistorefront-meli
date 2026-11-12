-- MSF-825 (MSF-828): el prefijo de importación («&ua», «&u+», «&+»…) no llega a la base. El disparador
-- productos_normalizar lo quita del nombre y de la descripción en el alta y en la edición.
begin;

select plan(9);

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo, descripcion) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '&ua ADAPTADOR HDMI A DVI 24+1 (3010)', 'PI-1', 10, 'ARS', true, '&ua ADAPTADOR HDMI A DVI 24+1 (3010)'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '&u+ MOCHILA', 'PI-2', 10, 'ARS', true, null),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '&uaCONSOLA', 'PI-3', 10, 'ARS', true, null),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '&+ COOLER PS2 70X', 'PI-4', 10, 'ARS', true, null),
  ('a1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '&amp; Compañía', 'PI-5', 10, 'ARS', true, null),
  ('a1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', '&ua', 'PI-6', 10, 'ARS', true, null),
  ('a1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Joystick Pro', 'PI-7', 10, 'ARS', true, 'Sin cambios');

select is((select nombre from dominio.productos where sku = 'PI-1'), 'ADAPTADOR HDMI A DVI 24+1 (3010)', 'el alta quita «&ua » del nombre');
select is((select descripcion from dominio.productos where sku = 'PI-1'), 'ADAPTADOR HDMI A DVI 24+1 (3010)', 'y de la descripción');
select is((select nombre from dominio.productos where sku = 'PI-2'), 'MOCHILA', 'quita «&u+ »');
select is((select nombre from dominio.productos where sku = 'PI-3'), 'CONSOLA', 'quita el prefijo pegado al nombre («&uaCONSOLA»)');
select is((select nombre from dominio.productos where sku = 'PI-4'), 'COOLER PS2 70X', 'quita «&+ »');
select is((select nombre from dominio.productos where sku = 'PI-5'), '&amp; Compañía', 'una entidad HTML no es un prefijo y se conserva');
select is((select nombre from dominio.productos where sku = 'PI-6'), '&ua', 'un nombre que es solo el prefijo no se vacía');
select is((select nombre || '|' || descripcion from dominio.productos where sku = 'PI-7'), 'Joystick Pro|Sin cambios', 'un nombre normal no cambia');

update dominio.productos set nombre = '&uu BOTÓN' where sku = 'PI-7';
select is((select nombre from dominio.productos where sku = 'PI-7'), 'BOTÓN', 'la edición también lo quita');

select * from finish();
rollback;
