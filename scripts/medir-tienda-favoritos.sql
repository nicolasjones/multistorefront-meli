-- Medición de rendimiento de guardar favoritos y de otras RPC de la tienda con un catálogo grande (MSF-176, historia A).
-- Respalda la cifra del contrato (`specs/20270306-100000-tienda-compra-y-cuentas/contracts/tienda-compra-y-cuentas.md`,
-- «Rendimiento (medido)»): guardar un favorito evalúa `private.catalogo_tienda_efectivo` una sola vez por llamada.
--
-- Uso (SOLO en una base LOCAL o de pruebas con todas las migraciones aplicadas; NUNCA contra dev, staging ni producción):
--   psql -X -q -v N=10000 -v BASE_DESCARTABLE=si -f scripts/medir-tienda-favoritos.sql <base-local>
-- Crea una organización, una tienda con N productos, un cliente y su cuenta, llama a las RPC y hace ROLLBACK de todo: no deja datos.
-- Imprime un NOTICE con los milisegundos de cada llamada. La medición del contrato se hizo en Postgres 17 (imagen de Supabase) local:
-- N = 2000 → guardar ~12 ms; N = 10000 → guardar ~35-50 ms; `precios_cliente_por_dominio` de 1 producto ~12 ms y ~35 ms.
-- Es una estimación local (sin carga concurrente ni red): sirve para comparar órdenes de magnitud, no como SLA.
-- GUARD DE ENTORNO (H-6 de la revisión de seguridad integral): el script escribe (aunque lo deshace con ROLLBACK) y llama a funciones con efectos, así que se NIEGA a
-- correr salvo que se declare que la base es descartable y que se vea como tal:
--   * hay que pasar `-v BASE_DESCARTABLE=si` (sin eso aborta);
--   * se niega si la base tiene más de 5 organizaciones (una base de pruebas tiene las del seed o ninguna; dev, staging y producción tienen más);
--   * se niega si la base es la de una organización real: cualquier organización que no sea del seed ni de prueba y tenga clientes con comprobantes confirmados no se cuenta
--     acá, así que el tope de organizaciones es la barrera simple y la variable es la confirmación explícita de la persona.
\set ON_ERROR_STOP on
\if :{?BASE_DESCARTABLE}
\else
  \echo 'ABORTADO: falta -v BASE_DESCARTABLE=si (solo una base LOCAL o de pruebas descartable).'
  do $$ begin raise exception 'medir-tienda-favoritos: abortado por el guard de entorno'; end $$;
\endif
select (:'BASE_DESCARTABLE' = 'si') as confirmada \gset
\if :confirmada
\else
  \echo 'ABORTADO: BASE_DESCARTABLE debe valer «si».'
  do $$ begin raise exception 'medir-tienda-favoritos: abortado por el guard de entorno'; end $$;
\endif
select (select count(*) from public.organizaciones) > 5 as demasiadas \gset
\if :demasiadas
  \echo 'ABORTADO: la base tiene más de 5 organizaciones: no parece una base de pruebas descartable.'
  do $$ begin raise exception 'medir-tienda-favoritos: abortado por el guard de entorno'; end $$;
\endif
begin;
insert into organizaciones (id, nombre) values ('99999999-9999-9999-9999-999999999999','Medicion');
insert into auth.users (id,email) values ('f9000000-0000-0000-0000-000000000001','m@example.com');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values ('e9000000-0000-0000-0000-000000000001','99999999-9999-9999-9999-999999999999','T',true);
insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values ('99999999-9999-9999-9999-999999999999','e9000000-0000-0000-0000-000000000001','med.ejemplo.com');
insert into dominio.productos (id, organizacion_id, nombre, sku, precio_lista, moneda, activo)
 select ('b9000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'99999999-9999-9999-9999-999999999999','P'||n,'S'||n,100,'ARS',true from generate_series(1,:N) n;
insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
 select id,'e9000000-0000-0000-0000-000000000001',organizacion_id from dominio.productos where organizacion_id='99999999-9999-9999-9999-999999999999';
insert into clientes (id, organizacion_id, numero, nombre, tipo) values ('c9000000-0000-0000-0000-000000000001','99999999-9999-9999-9999-999999999999',5000,'C','minorista');
insert into clientes_empresas values ('c9000000-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000001','99999999-9999-9999-9999-999999999999');
insert into cuentas_cliente (organizacion_id, cliente_id, empresa_id, auth_user_id, estado) values ('99999999-9999-9999-9999-999999999999','c9000000-0000-0000-0000-000000000001','e9000000-0000-0000-0000-000000000001','f9000000-0000-0000-0000-000000000001','activa');
update public.banderas_plataforma set activa=true where clave='tienda_pedidos';
select set_config('request.jwt.claims','{"sub":"f9000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
do $$ declare t0 timestamptz; r jsonb; i int; begin
 for i in 1..5 loop
  t0:=clock_timestamp();
  r:=publico.cambiar_favorito_por_dominio('med.ejemplo.com',('b9000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,true);
  raise notice 'guardar % -> % ms', r->>'estado', round(extract(epoch from clock_timestamp()-t0)*1000);
 end loop;
 t0:=clock_timestamp(); r:=publico.mis_favoritos_por_dominio('med.ejemplo.com'); raise notice 'mis_favoritos -> % ms', round(extract(epoch from clock_timestamp()-t0)*1000);
 t0:=clock_timestamp(); r:=publico.precios_cliente_por_dominio('med.ejemplo.com', array[('b9000000-0000-0000-0000-'||lpad('1',12,'0'))::uuid]); raise notice 'precios_cliente(1) -> % ms', round(extract(epoch from clock_timestamp()-t0)*1000);
end $$;
rollback;
