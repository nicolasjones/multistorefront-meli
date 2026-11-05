-- F-TDA-19 (MSF-247, épica MSF-149): `publico.estado_tienda_por_dominio` (FR-001). Devuelve la marca de la
-- tienda solo si la empresa está DESACTIVADA; `null` para activa, desconocida o host inválido. Lista blanca,
-- activar/desactivar cambia el resultado, aislamiento entre tiendas y `anon` ejecuta la función.
begin;

select plan(14);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno');

insert into dominio.empresas (id, organizacion_id, nombre, activa) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda Pausada A', false),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Tienda Pausada B', false),
  ('e1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Tienda Activa', true);

insert into dominio.tiendas (organizacion_id, empresa_id, dominio) values
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ep-a.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000002', 'ep-b.ejemplo.com'),
  ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000003', 'ep-activa.ejemplo.com');

-- A tiene identidad propia con logo; B no tiene fila (tema base).
insert into dominio.tienda_identidad (empresa_id, organizacion_id, color_primario, color_fondo, tipografia_titulos, tipografia_texto, logo_ruta) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '#AA1111', '#FAF7F0', 'Playfair Display', 'Lato', '11111111-1111-1111-1111-111111111111/e1000000-0000-0000-0000-000000000001/logo.png');

create temp table res (clave text primary key, j jsonb);
grant all on res to anon;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

insert into res values
  ('a', publico.estado_tienda_por_dominio('ep-a.ejemplo.com')),
  ('a_host', publico.estado_tienda_por_dominio('  EP-A.Ejemplo.com.:8080 ')),
  ('b', publico.estado_tienda_por_dominio('ep-b.ejemplo.com')),
  ('activa', publico.estado_tienda_por_dominio('ep-activa.ejemplo.com')),
  ('desconocido', publico.estado_tienda_por_dominio('no-existe.ejemplo.com')),
  ('vacio', publico.estado_tienda_por_dominio('')),
  ('invalido', publico.estado_tienda_por_dominio('http://ep-a.ejemplo.com/ruta'));

reset role;

select is((select j ->> 'estado' from res where clave = 'a'), 'pausada', 'empresa desactivada: estado pausada');
select is((select j ->> 'nombre' from res where clave = 'a'), 'Tienda Pausada A', 'devuelve el nombre comercial de la propia tienda');
select is(
  (select j - 'nombre' from res where clave = 'a'),
  '{"estado": "pausada", "color_primario": "#AA1111", "color_primario_oscuro": "#000000", "color_acento": "#222222", "color_fondo": "#FAF7F0", "tipografia_titulos": "Playfair Display", "tipografia_texto": "Lato", "logo_ruta": "org/a/logo.png"}'::jsonb,
  'devuelve la identidad guardada, con los defaults de identidad_por_dominio donde no hay valor'
);
select is((select j from res where clave = 'a_host'), (select j from res where clave = 'a'), 'el host se normaliza (mayúsculas, espacios, punto final y puerto)');
select is(
  (select j from res where clave = 'b'),
  '{"estado": "pausada", "nombre": "Tienda Pausada B", "color_primario": "#222222", "color_primario_oscuro": "#000000", "color_acento": "#222222", "color_fondo": "#FFFFFF", "tipografia_titulos": "system-ui", "tipografia_texto": "system-ui", "logo_ruta": null}'::jsonb,
  'tienda pausada sin identidad: tema base y sin logo; no mezcla la marca de A (aislamiento)'
);

-- null para activa, desconocida, vacío o inválido
select is((select j from res where clave = 'activa'), null::jsonb, 'empresa activa: null');
select is((select j from res where clave = 'desconocido'), null::jsonb, 'host desconocido: null');
select is((select j from res where clave = 'vacio'), null::jsonb, 'host vacío: null');
select is((select j from res where clave = 'invalido'), null::jsonb, 'host inválido: null');

-- Lista blanca
select is(
  (select array_agg(k order by k) from (select jsonb_object_keys(j) k from res where clave = 'a') s),
  array['color_acento', 'color_fondo', 'color_primario', 'color_primario_oscuro', 'estado', 'logo_ruta', 'nombre', 'tipografia_texto', 'tipografia_titulos'],
  'expone solo la lista blanca (sin organizacion_id, contacto ni datos fiscales)'
);

-- Pasar de activa a desactivada y volver cambia el resultado (SC-003)
update dominio.empresas set activa = true where id = 'e1000000-0000-0000-0000-000000000001';
select is(publico.estado_tienda_por_dominio('ep-a.ejemplo.com'), null::jsonb, 'al reactivar la empresa, deja de estar pausada');
update dominio.empresas set activa = false where id = 'e1000000-0000-0000-0000-000000000003';
select is((publico.estado_tienda_por_dominio('ep-activa.ejemplo.com')) ->> 'estado', 'pausada', 'al desactivar la empresa, pasa a pausada');

-- anon ejecuta la función; no se la entrega a public
select ok(has_function_privilege('anon', 'publico.estado_tienda_por_dominio(text)', 'execute'), 'anon ejecuta la función');
select ok(not exists (
  select 1 from information_schema.routine_privileges
   where routine_schema = 'publico' and routine_name = 'estado_tienda_por_dominio' and grantee = 'PUBLIC'
), 'la función no está concedida a PUBLIC');

select * from finish();
rollback;
