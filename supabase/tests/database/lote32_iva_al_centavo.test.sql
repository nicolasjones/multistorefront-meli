-- MSF-720 (lote 32): `private.aplicar_iva` redondea al centavo, igual que el total con IVA del comprobante.
begin;

select no_plan();

select is(private.aplicar_iva(1000, 21, false), 1210.00::numeric, 'neto redondo: 1000 + 21 % = 1210,00');
select is(private.aplicar_iva(100.10, 21, false), 121.12::numeric, '100,10 + 21 % = 121,121 → 121,12 (antes 121 al peso)');
select is(private.aplicar_iva(333.33, 10.5, false), 368.33::numeric, '333,33 + 10,5 % = 368,33265 → 368,33');
select is(private.aplicar_iva(0.01, 21, false), 0.01::numeric, 'el centavo mínimo no se pierde (0,0121 → 0,01)');
select is(private.aplicar_iva(99.99, 27, false), 126.99::numeric, '99,99 + 27 % = 126,9873 → 126,99');
select is(private.aplicar_iva(100, 0, false), 100::numeric, 'alícuota 0 % deja el neto');
select is(private.aplicar_iva(1234.56, 21, true), 1234.56::numeric, 'Exento ⇒ final = neto, sin redondear de más');
select is(private.aplicar_iva(null, 21, false), null::numeric, 'sin neto → nulo');
select is(private.aplicar_iva(100, null, false), null::numeric, 'sin porcentaje → nulo');
select is(private.aplicar_iva(100, null, true), null::numeric, 'sin porcentaje (aun exento) → nulo, como antes');

-- Coincide con el redondeo del total del comprobante (2 decimales) para una barrida de netos.
select is(
  (select count(*)::int from generate_series(1, 5000) g(i)
    where private.aplicar_iva(g.i * 1.37, 21, false) <> round(g.i * 1.37 * 1.21, 2)),
  0, 'para 5000 netos el final es round(neto × (1 + alícuota), 2)');
select is(
  (select count(*)::int from generate_series(1, 5000) g(i)
    where private.aplicar_iva(g.i * 1.37, 21, false) <> round(private.aplicar_iva(g.i * 1.37, 21, false), 2)),
  0, 'nunca tiene más de dos decimales');

-- Seguridad: anon no la ejecuta; sigue siendo inmutable y sin search_path abierto.
select is(has_function_privilege('anon', 'private.aplicar_iva(numeric,numeric,boolean)', 'execute'), false, 'anon no ejecuta aplicar_iva');
select is(has_function_privilege('authenticated', 'private.aplicar_iva(numeric,numeric,boolean)', 'execute'), true, 'authenticated la ejecuta (la usan las vistas)');
select is((select provolatile::text from pg_proc where oid = 'private.aplicar_iva(numeric,numeric,boolean)'::regprocedure), 'i', 'sigue inmutable');
select is((select proconfig from pg_proc where oid = 'private.aplicar_iva(numeric,numeric,boolean)'::regprocedure), array['search_path=""']::text[], 'search_path vacío');

-- La cotización admite hasta 4 decimales (ya validado en SQL): se conserva.
select is((select numeric_scale::int from information_schema.columns where table_schema = 'dominio' and table_name = 'cotizaciones' and column_name = 'valor'), 4, 'la cotización guarda 4 decimales');

select * from finish();
rollback;
