-- Dar de baja una organización con ingresos de mercadería (MSF-844).
--
-- `delete from public.organizaciones` borra en cascada todo lo suyo (docs/empresas.md), pero hay
-- claves foráneas INMEDIATAS (`restrict`) entre tablas que se borran en esa misma cascada: Postgres
-- comprueba cada paso de la cascada por separado y falla si borra primero el lado «padre» (p. ej.
-- «ingresos_mercaderia_lineas → productos», «productos → proveedores»). La acción referencial
-- `restrict` no admite diferirse, así que se recrea como `no action deferrable initially deferred`
-- (la comprobación pasa al COMMIT, cuando la cascada ya terminó).
--
-- QUÉ CAMBIA (alcance acotado, a diferencia del intento anterior del PR #889 que difería las
-- claves de toda la clausura: 155 tablas y 71 FK, incluidas ventas, motos, cotizaciones y stock):
-- sólo las claves foráneas inmediatas cuya tabla ORIGEN está en el alcance declarado de esta baja
--
--     dominio.empresas, dominio.proveedores, dominio.proveedores_contactos, dominio.productos,
--     dominio.ingresos_mercaderia, dominio.ingresos_mercaderia_lineas
--
-- y cuya tabla DESTINO también se borra en la cascada de `public.organizaciones`. Con el alcance
-- declarado quedan diferidas 8 claves: 7 `restrict` (proveedores_contactos → proveedores,
-- productos → proveedores, ingresos_mercaderia → empresas, ingresos_mercaderia → proveedores,
-- ingresos_mercaderia_lineas → productos y las dos de ingresos_mercaderia_lineas → movimientos_stock)
-- y 1 `no action` (productos → alicuotas_iva).
--
-- QUÉ NO CAMBIA:
-- * `dominio.movimientos_stock` NO entra en el alcance. Sus claves (`no action`) dejan eventos de
--   trigger pendientes y `truncate dominio.movimientos_stock` pasa a fallar con 55006
--   («cannot TRUNCATE … because it has pending trigger events»), que rompe el pgTAP
--   `stock_historial.test.sql`. No hacen falta para esta baja: la cascada ya borra los movimientos
--   antes que las existencias y los motivos (lo prueba `stock_historial.test.sql`, «se puede borrar
--   una organización con movimientos (cascada)»).
-- * Las claves de ventas, motos, cotizaciones y stock NO se tocan: siguen comprobándose en la
--   sentencia, como antes.
-- * Borrar UN registro que otro usa (un producto de un ingreso, un proveedor con productos) sigue
--   prohibido: el error es el mismo (23503) pero ahora llega al COMMIT. Ninguna función SQL del
--   repositorio atrapa `foreign_key_violation`.
--
-- RIESGO: una clave diferida deja eventos de trigger pendientes hasta el COMMIT; si otra migración
-- altera estas tablas (`alter table`) en la MISMA transacción después de tocar filas, Postgres falla
-- con «cannot ALTER TABLE because it has pending trigger events». Las migraciones corren sin filas
-- previas en la transacción, así que no ocurre hoy; tenelo presente al escribir migraciones que
-- muevan datos y alteren estas tablas a la vez.
--
-- REVERSIÓN (migración posterior; no en este PR):
--   alter table dominio.proveedores_contactos alter constraint <clave> not deferrable;   -- y las que
--   ...                                                                    -- eran `restrict`,
--   ...                                                                    -- recrearlas con
--   ...                                                                    -- `on delete restrict`.
--   Las 8 claves afectadas son las de la lista del bloque `do` (ver la prueba pgTAP, que las cuenta).
--   La reversión deja el comportamiento anterior (la baja con ingresos vuelve a fallar por FK).
--
-- IDEMPOTENTE: una segunda ejecución no encuentra claves inmediatas en el alcance y no cambia nada.

do $$
declare
  v record;
  v_definicion text;
begin
  for v in
    with recursive cierre(rel) as (
      select 'public.organizaciones'::regclass
      union
      select k.conrelid
        from pg_constraint k
        join cierre c on k.confrelid = c.rel
       where k.contype = 'f' and k.confdeltype = 'c'
    ),
    alcance(rel) as (
      select 'dominio.empresas'::regclass
      union select 'dominio.proveedores'::regclass
      union select 'dominio.proveedores_contactos'::regclass
      union select 'dominio.productos'::regclass
      union select 'dominio.ingresos_mercaderia'::regclass
      union select 'dominio.ingresos_mercaderia_lineas'::regclass
    )
    select k.oid, k.conrelid::regclass as tabla, k.conname, k.confdeltype
      from pg_constraint k
     where k.contype = 'f'
       and k.confdeltype in ('r', 'a')
       and not k.condeferrable
       and k.conrelid in (select rel from alcance)
       and k.confrelid in (select rel from cierre)
     order by k.conrelid::regclass::text, k.conname
  loop
    if v.confdeltype = 'a' then
      execute format('alter table %s alter constraint %I deferrable initially deferred', v.tabla, v.conname);
    else
      v_definicion := regexp_replace(pg_get_constraintdef(v.oid), ' ON DELETE RESTRICT', '');
      execute format('alter table %s drop constraint %I', v.tabla, v.conname);
      execute format('alter table %s add constraint %I %s deferrable initially deferred not valid', v.tabla, v.conname, v_definicion);
      execute format('alter table %s validate constraint %I', v.tabla, v.conname);
    end if;
  end loop;
end
$$;
