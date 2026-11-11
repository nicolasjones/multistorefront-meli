-- F-API-01 (MSF-233): la paginación por cursor avanza. Regresión: `api_decodificar_cursor` no devolvía fila y toda
-- lectura servía siempre la primera página.
begin;

select no_plan();

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización paginada');

insert into dominio.productos (id, organizacion_id, nombre, sku, moneda, precio_lista, activo)
select ('b1000000-0000-0000-0000-00000000000' || n)::uuid, '11111111-1111-1111-1111-111111111111', 'Producto ' || n, 'P-' || n, 'ARS', 1000 * n, true
  from generate_series(1, 5) n;

select is((select count(*)::int from private.api_decodificar_cursor(null)), 0, 'sin cursor, el decodificador no devuelve fila');
select is(
  (select p_clave from private.api_decodificar_cursor(private.api_codificar_cursor('2026-01-01T00:00:00Z'::timestamptz, 'b1000000-0000-0000-0000-000000000001'::uuid))),
  '1767225600000000|b1000000-0000-0000-0000-000000000001',
  'con un cursor válido, el decodificador devuelve su clave'
);

create temp table paginas (n int, skus text[], siguiente text);

do $$
declare
  v_cursor text := null;
  v_fila record;
  v_n int := 0;
begin
  loop
    v_n := v_n + 1;
    select r.filas, r.siguiente_cursor into v_fila
      from private.api_leer_productos('11111111-1111-1111-1111-111111111111', v_cursor, 2, null) r;
    insert into paginas
    select v_n, array(select e->>'sku' from jsonb_array_elements(v_fila.filas) e), v_fila.siguiente_cursor;
    v_cursor := v_fila.siguiente_cursor;
    exit when v_cursor is null or v_n >= 10;
  end loop;
end $$;

select is((select count(*)::int from paginas), 3, '5 productos con límite 2 se recorren en 3 páginas');
select is((select count(distinct s)::int from paginas, unnest(skus) s), 5, 'las páginas no repiten filas: 5 productos distintos');
select is((select cardinality(skus) from paginas where n = 3), 1, 'la última página trae lo que queda');
select is((select siguiente from paginas where n = 3), null, 'la última página no trae siguiente_cursor');

select finish();
rollback;
