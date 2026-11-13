-- Baja de una organización con datos: la cascada tiene que poder borrar empresas, proveedores (con productos y con
-- contactos), productos, movimientos de stock, ingresos y líneas aunque las claves foráneas entre ellos eran
-- `restrict`/`no action` inmediatas (la baja fallaba), y borrar UN registro usado por otro sigue prohibido (al COMMIT).
--
-- Además fija el ALCANCE de la diferición (MSF-844): sólo las claves del alcance de la baja pueden quedar diferidas.
-- La versión anterior (PR #889) difería las claves de toda la clausura de la cascada (155 tablas, 71 FK) y rompía
-- 42 pruebas de ventas/motos/cotizaciones/stock.
begin;

select plan(11);

insert into public.organizaciones (id, nombre) values ('00000000-0000-0000-0000-00000000ba1a', 'Baja con ingresos');
insert into dominio.empresas (id, organizacion_id, nombre, activa)
  values ('00000000-0000-0000-0000-00000000ba1b', '00000000-0000-0000-0000-00000000ba1a', 'Empresa', true);
insert into dominio.proveedores (id, organizacion_id, razon_social, cuit)
  values ('00000000-0000-0000-0000-00000000ba1c', '00000000-0000-0000-0000-00000000ba1a', 'Proveedor', '20123456786');
insert into dominio.productos (id, organizacion_id, nombre, moneda, precio_lista, proveedor_id)
  values ('00000000-0000-0000-0000-00000000ba1d', '00000000-0000-0000-0000-00000000ba1a', 'Producto', 'ARS', 10,
          '00000000-0000-0000-0000-00000000ba1c');
insert into dominio.proveedores_contactos (organizacion_id, proveedor_id, nombre)
  values ('00000000-0000-0000-0000-00000000ba1a', '00000000-0000-0000-0000-00000000ba1c', 'Contacto');
insert into dominio.motivos_movimiento (id, organizacion_id, nombre, aplica_a)
  values ('00000000-0000-0000-0000-00000000ba1e', '00000000-0000-0000-0000-00000000ba1a', 'Motivo de prueba', '{entrada,salida}')
  on conflict do nothing;
insert into dominio.movimientos_stock (id, organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, fecha)
  select '00000000-0000-0000-0000-00000000ba1f', '00000000-0000-0000-0000-00000000ba1a', '00000000-0000-0000-0000-00000000ba1d',
         'entrada', 1, 1, 1, id, current_date
    from dominio.motivos_movimiento where organizacion_id = '00000000-0000-0000-0000-00000000ba1a' limit 1;
insert into dominio.ingresos_mercaderia (id, organizacion_id, empresa_id, proveedor_id, fecha)
  values ('00000000-0000-0000-0000-00000000ba20', '00000000-0000-0000-0000-00000000ba1a',
          '00000000-0000-0000-0000-00000000ba1b', '00000000-0000-0000-0000-00000000ba1c', current_date);
insert into dominio.ingresos_mercaderia_lineas (ingreso_id, organizacion_id, producto_id, cantidad, costo_unitario_usd, movimiento_id)
  values ('00000000-0000-0000-0000-00000000ba20', '00000000-0000-0000-0000-00000000ba1a',
          '00000000-0000-0000-0000-00000000ba1d', 1, 1, '00000000-0000-0000-0000-00000000ba1f');

-- Un segundo producto que SOLO usa una línea de ingreso (su movimiento es de otro producto): aísla que la clave
-- diferida de la línea protege por sí sola, sin que lo frene antes algún camino de movimientos de stock.
insert into dominio.productos (id, organizacion_id, nombre, moneda, precio_lista)
  values ('00000000-0000-0000-0000-00000000ba2d', '00000000-0000-0000-0000-00000000ba1a', 'Producto solo de línea', 'ARS', 10);
update dominio.ingresos_mercaderia_lineas set producto_id = '00000000-0000-0000-0000-00000000ba2d'
  where ingreso_id = '00000000-0000-0000-0000-00000000ba20';
select throws_ok(
  $t$do $b$ begin
      delete from dominio.productos where id = '00000000-0000-0000-0000-00000000ba2d';
      set constraints all immediate;
    end $b$$t$,
  '23503', null, 'la clave de la línea de ingreso protege por sí sola al producto (sin movimientos propios)');
update dominio.ingresos_mercaderia_lineas set producto_id = '00000000-0000-0000-0000-00000000ba1d'
  where ingreso_id = '00000000-0000-0000-0000-00000000ba20';

-- Borrar UN registro usado por otro sigue prohibido: la comprobación diferida salta al confirmar (se fuerza con
-- set constraints immediate dentro del bloque).
select throws_ok(
  $t$do $b$ begin
      delete from dominio.productos where id = '00000000-0000-0000-0000-00000000ba1d';
      set constraints all immediate;
    end $b$$t$,
  '23503', null, 'no se puede borrar un producto usado por un ingreso');
select throws_ok(
  $t$do $b$ begin
      delete from dominio.proveedores where id = '00000000-0000-0000-0000-00000000ba1c';
      set constraints all immediate;
    end $b$$t$,
  '23503', null, 'no se puede borrar un proveedor con productos y contactos');

select lives_ok(
  $t$do $b$ begin
      delete from public.organizaciones where id = '00000000-0000-0000-0000-00000000ba1a';
      set constraints all immediate;
    end $b$$t$,
  'se puede dar de baja una organización con ingresos, productos con proveedor y contactos');

select is((select count(*)::int from dominio.ingresos_mercaderia where organizacion_id = '00000000-0000-0000-0000-00000000ba1a'), 0,
  'la baja se llevó los ingresos');
select is((select count(*)::int from dominio.proveedores_contactos where organizacion_id = '00000000-0000-0000-0000-00000000ba1a'), 0,
  'la baja se llevó los contactos de proveedor');
select is((select count(*)::int from dominio.productos where organizacion_id = '00000000-0000-0000-0000-00000000ba1a'), 0,
  'la baja se llevó los productos');
select is((select count(*)::int from dominio.proveedores where organizacion_id = '00000000-0000-0000-0000-00000000ba1a'), 0,
  'la baja se llevó los proveedores');

-- ============================================================================
-- Alcance de la diferición (MSF-844): la regresión que se corrige
-- ============================================================================

-- Las claves del alcance de la baja están diferidas (7 pares tabla → destino, 8 claves).
select is(
  (select count(*)::int
     from (values
       ('dominio','proveedores_contactos','dominio','proveedores'),
       ('dominio','productos','dominio','proveedores'),
       ('dominio','productos','dominio','alicuotas_iva'),
       ('dominio','ingresos_mercaderia','dominio','empresas'),
       ('dominio','ingresos_mercaderia','dominio','proveedores'),
       ('dominio','ingresos_mercaderia_lineas','dominio','productos'),
       ('dominio','ingresos_mercaderia_lineas','dominio','movimientos_stock')
     ) as esperados(ns, tabla, ns_destino, destino)
    where exists (
      select 1
        from pg_constraint k
        join pg_class c on c.oid = k.conrelid
        join pg_namespace n on n.oid = c.relnamespace
        join pg_class d on d.oid = k.confrelid
        join pg_namespace dn on dn.oid = d.relnamespace
       where k.contype = 'f'
         and k.condeferrable
         and n.nspname = esperados.ns
         and c.relname = esperados.tabla
         and dn.nspname = esperados.ns_destino
         and d.relname = esperados.destino)),
  7, 'las 7 claves del alcance de la baja están diferidas');

-- Ninguna clave fuera del alcance quedó diferida: la versión anterior difería toda la clausura de la cascada
-- (ventas, motos, cotizaciones, stock) y rompía las pruebas de esos dominios.
select is(
  (select count(*)::int
     from pg_constraint k
     join pg_class c on c.oid = k.conrelid
     join pg_namespace n on n.oid = c.relnamespace
    where k.contype = 'f'
      and k.condeferrable
      and not (n.nspname = 'dominio'
               and c.relname = any (array['proveedores_contactos', 'productos',
                                          'ingresos_mercaderia', 'ingresos_mercaderia_lineas']))),
  0, 'ninguna clave foránea fuera del alcance de la baja quedó diferida');

-- Las claves de ventas, motos, cotizaciones y stock se siguen comprobando en la sentencia.
select is(
  (select count(*)::int
     from pg_constraint k
     join pg_class c on c.oid = k.conrelid
     join pg_namespace n on n.oid = c.relnamespace
    where k.contype = 'f'
      and k.condeferrable
      and (n.nspname, c.relname) in (
        ('dominio','envios_moto'), ('dominio','cotizaciones'), ('dominio','movimientos_stock'))),
  0, 'las claves de ventas, motos, cotizaciones y stock siguen siendo inmediatas');

select * from finish();
rollback;
