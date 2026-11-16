-- F-MIG-02 (MSF-313, épica MSF-142): importador de proveedores y vínculo con productos.
-- Cubre FR-021 (conciliación por id_externo, idempotencia), FR-020 (CUIT con dígito verificador y
-- único por organización), FR-022 (vínculo por SKU + proveedor; SKU inexistente / proveedor no
-- cargado = error de fila) y FR-024 (solo Administrador, aislamiento por organización, `anon` sin
-- acceso). Datos inventados (CUIT 30-9xxxxxxx con verificador calculado).
-- El fixture corre como postgres (RLS no aplica) y las verificaciones como "authenticated"
-- vía request.jwt.claims, igual que PostgREST.
begin;

select plan(53);

insert into organizaciones (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Organización Uno'),
  ('22222222-2222-2222-2222-222222222222', 'Organización Dos');

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'admin-uno-migprov@example.com'),
  ('e1000000-0000-0000-0000-000000000002', 'consulta-uno-migprov@example.com'),
  ('e2000000-0000-0000-0000-000000000001', 'admin-dos-migprov@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'administrador', 'activo'),
  ('e1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'consulta', 'activo'),
  ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'administrador', 'activo');

-- Productos del catálogo (los migra Catálogo; acá solo se vinculan). El SKU 'SKU-A' existe en las dos organizaciones.
insert into dominio.productos (organizacion_id, nombre, sku, precio_lista) values
  ('11111111-1111-1111-1111-111111111111', 'Producto A Sintético', 'SKU-A', 10),
  ('11111111-1111-1111-1111-111111111111', 'Producto B Sintético', 'SKU-B', 10),
  ('11111111-1111-1111-1111-111111111111', 'Producto C Sintético', 'SKU-C', 10),
  ('22222222-2222-2222-2222-222222222222', 'Producto A Dos Sintético', 'SKU-A', 10);

create temporary table t_res (k text primary key, v jsonb);
grant all on t_res to authenticated, anon;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ============================================================================
-- Esquema y privilegios
-- ============================================================================

select has_column('dominio', 'proveedores', 'id_externo', 'dominio.proveedores tiene id_externo');
select is(
  (select bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('previsualizar_lote_proveedores', 'aplicar_lote_proveedores',
                        'previsualizar_lote_vinculos_proveedor_producto', 'aplicar_lote_vinculos_proveedor_producto')),
  false,
  'anon no ejecuta ninguna RPC de proveedores ni de vínculos'
);
select is(
  (select bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('previsualizar_lote_proveedores', 'aplicar_lote_proveedores',
                        'previsualizar_lote_vinculos_proveedor_producto', 'aplicar_lote_vinculos_proveedor_producto')),
  true,
  'authenticated ejecuta las RPC de proveedores y de vínculos'
);

-- ============================================================================
-- Rol: solo el Administrador migra
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$select public.previsualizar_lote_proveedores('[{"fila":2,"id_externo":"PRV-1"}]'::jsonb)$$,
  '42501', null, 'un rol de consulta no puede previsualizar proveedores'
);
select throws_ok(
  $$select public.previsualizar_lote_vinculos_proveedor_producto('[{"fila":2,"sku":"SKU-A"}]'::jsonb)$$,
  '42501', null, 'un rol de consulta no puede previsualizar vínculos'
);

-- ============================================================================
-- Proveedores · vista previa (no escribe)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

insert into t_res select 'cp1', to_jsonb(public.iniciar_carga_migracion('proveedores', 'proveedores-sinteticos.csv', 5));
select isnt((select v #>> '{}' from t_res where k = 'cp1'), null, 'el Administrador abre la carga de proveedores');

select is(
  (select jsonb_agg(x ->> 'estado' order by (x ->> 'fila')::int)
     from jsonb_array_elements(public.previsualizar_lote_proveedores(
       '[{"fila":2,"id_externo":"PRV-1","razon_social":"Proveedor Uno Sintético SRL","cuit":"30-90000011-8","correo":"uno@example.com"},
         {"fila":3,"id_externo":"PRV-2","razon_social":"Proveedor Dos Sintético SRL","cuit":"30900000126"},
         {"fila":4,"id_externo":"PRV-3","razon_social":"CUIT con verificador malo","cuit":"30900000119"},
         {"fila":5,"id_externo":"PRV-4","razon_social":"Sin CUIT"},
         {"fila":6,"id_externo":"PRV-5","razon_social":"Correo malo","cuit":"30900000134","correo":"noesmail"}]'::jsonb
     )) as x),
  '["nueva", "nueva", "error", "error", "error"]'::jsonb,
  'la vista previa clasifica nueva / nueva / error / error / error'
);
reset role;
select is(
  (select count(*) from dominio.proveedores where id_externo is not null),
  0::bigint,
  'la vista previa no escribe proveedores'
);

-- ============================================================================
-- Proveedores · aplicar el lote 1 (FR-020, FR-021)
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.aplicar_lote_proveedores((select (v #>> '{}')::uuid from t_res where k = 'cp1'), 1,
     '[{"fila":2,"id_externo":"PRV-1"}]'::jsonb)$$,
  '42501', null, 'un rol de consulta no puede aplicar un lote de proveedores'
);

select pg_temp.como('e2000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.aplicar_lote_proveedores((select (v #>> '{}')::uuid from t_res where k = 'cp1'), 1,
     '[{"fila":2,"id_externo":"PRV-1"}]'::jsonb)$$,
  'P0002', null, 'el Administrador de otra organización no encuentra la carga'
);

select pg_temp.como('e1000000-0000-0000-0000-000000000001');

select lives_ok(
  $$insert into t_res select 'lp1', public.aplicar_lote_proveedores((select (v #>> '{}')::uuid from t_res where k = 'cp1'), 1,
     '[{"fila":2,"id_externo":"PRV-1","razon_social":"Proveedor Uno Sintético SRL","cuit":"30-90000011-8","correo":"uno@example.com"},
       {"fila":3,"id_externo":"PRV-2","razon_social":"Proveedor Dos Sintético SRL","cuit":"30900000126"},
       {"fila":4,"id_externo":"PRV-3","razon_social":"CUIT con verificador malo","cuit":"30900000119"},
       {"fila":5,"id_externo":"PRV-4","razon_social":"Sin CUIT"},
       {"fila":6,"id_externo":"PRV-5","razon_social":"Correo malo","cuit":"30900000134","correo":"noesmail"}]'::jsonb)$$,
  'se aplica el lote 1 de proveedores'
);
select is(
  (select v - 'errores' from t_res where k = 'lp1'),
  '{"nuevos": 2, "actualizados": 0, "omitidos": 0}'::jsonb,
  'el lote 1 crea 2 proveedores'
);
select is(
  (select v -> 'errores' from t_res where k = 'lp1'),
  '[{"fila": 4, "motivo": "El CUIT no es válido: revisá el dígito verificador"},
    {"fila": 5, "motivo": "Falta el CUIT"},
    {"fila": 6, "motivo": "El correo no tiene un formato válido"}]'::jsonb,
  'las filas inválidas informan su motivo y no frenan a las demás'
);

reset role;
select is(
  (select array_agg(id_externo order by id_externo) from dominio.proveedores where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  array['PRV-1', 'PRV-2'],
  'quedan cargados PRV-1 y PRV-2 con su identificador externo'
);
select is(
  (select cuit from dominio.proveedores where id_externo = 'PRV-1' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  '30900000118',
  'el CUIT queda normalizado (solo dígitos)'
);

-- Idempotencia: reaplicar el mismo lote no duplica ni vuelve a crear.
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$insert into t_res select 'lp1b', public.aplicar_lote_proveedores((select (v #>> '{}')::uuid from t_res where k = 'cp1'), 1,
     '[{"fila":2,"id_externo":"PRV-1","razon_social":"Proveedor Uno Sintético SRL","cuit":"30-90000011-8","correo":"uno@example.com"},
       {"fila":3,"id_externo":"PRV-2","razon_social":"Proveedor Dos Sintético SRL","cuit":"30900000126"},
       {"fila":4,"id_externo":"PRV-3","razon_social":"CUIT con verificador malo","cuit":"30900000119"}]'::jsonb)$$,
  'se reaplica el mismo lote'
);
select is(
  (select v - 'errores' from t_res where k = 'lp1b'),
  '{"nuevos": 0, "actualizados": 0, "omitidos": 2}'::jsonb,
  'las filas ya aplicadas se omiten (idempotencia por carga y fila)'
);
reset role;
select is(
  (select count(*) from dominio.proveedores where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  2::bigint,
  'reaplicar no duplica proveedores'
);

-- ============================================================================
-- Proveedores · segunda carga: actualiza por id_externo, no pisa con celdas vacías,
-- rechaza CUIT repetido y el identificador repetido en el archivo; cierra la carga
-- ============================================================================

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
insert into t_res select 'cp2', to_jsonb(public.iniciar_carga_migracion('proveedores', 'proveedores-2.csv', 4));

select lives_ok(
  $$insert into t_res select 'lp2', public.aplicar_lote_proveedores((select (v #>> '{}')::uuid from t_res where k = 'cp2'), 1,
     '[{"fila":2,"id_externo":"PRV-1","razon_social":"Proveedor Uno Renombrado Sintético","cuit":"30900000118","correo":"","telefono":"011-5555-0001"},
       {"fila":3,"id_externo":"PRV-9","razon_social":"Usa el CUIT de otro","cuit":"30900000126"},
       {"fila":4,"id_externo":"PRV-6","razon_social":"Proveedor Seis Sintético SRL","cuit":"30900000142"}]'::jsonb)$$,
  'lote 1 de la segunda carga'
);
select lives_ok(
  $$insert into t_res select 'lp2b', public.aplicar_lote_proveedores((select (v #>> '{}')::uuid from t_res where k = 'cp2'), 2,
     '[{"fila":5,"id_externo":"PRV-6","razon_social":"Seis otra vez","cuit":"30900000150"}]'::jsonb)$$,
  'lote 2 de la segunda carga'
);
select is(
  (select v - 'errores' from t_res where k = 'lp2'),
  '{"nuevos": 1, "actualizados": 1, "omitidos": 0}'::jsonb,
  'el id_externo existente se actualiza y el nuevo se crea'
);
select is(
  (select v -> 'errores' from t_res where k = 'lp2'),
  '[{"fila": 3, "motivo": "Ya existe un proveedor con ese CUIT"}]'::jsonb,
  'un CUIT ya usado por otro proveedor de la organización es error de fila'
);
select is(
  (select v -> 'errores' from t_res where k = 'lp2b'),
  '[{"fila": 5, "motivo": "El identificador está repetido en el archivo"}]'::jsonb,
  'el mismo identificador en otro lote del archivo es error (gana la primera fila)'
);

reset role;
select is(
  (select razon_social from dominio.proveedores where id_externo = 'PRV-1' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'Proveedor Uno Renombrado Sintético',
  'la actualización por id_externo cambia la razón social'
);
select is(
  (select correo from dominio.proveedores where id_externo = 'PRV-1' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'uno@example.com',
  'una celda vacía no borra el correo existente'
);
select is(
  (select telefono from dominio.proveedores where id_externo = 'PRV-1' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  '011-5555-0001',
  'una celda con valor sí actualiza el teléfono'
);
select is(
  (select count(*) from dominio.proveedores where organizacion_id = '11111111-1111-1111-1111-111111111111'),
  3::bigint,
  'quedan 3 proveedores (PRV-1, PRV-2, PRV-6): ningún duplicado'
);

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
insert into t_res select 'cierre2', public.cerrar_carga_migracion((select (v #>> '{}')::uuid from t_res where k = 'cp2'));
select is(
  (select v - 'errores' - 'carga' from t_res where k = 'cierre2'),
  '{"entidad": "proveedores", "archivo": "proveedores-2.csv", "estado": "aplicada", "error": null, "filas_total": 4,
    "nuevos": 1, "actualizados": 1, "con_error": 2}'::jsonb,
  'el cierre cuadra con el archivo: 1 nuevo + 1 actualizado + 2 con error = 4 filas'
);

-- ============================================================================
-- Proveedores · aislamiento entre organizaciones
-- ============================================================================

select pg_temp.como('e2000000-0000-0000-0000-000000000001');
insert into t_res select 'cp3', to_jsonb(public.iniciar_carga_migracion('proveedores', 'proveedores-dos.csv', 1));
select lives_ok(
  $$insert into t_res select 'lp3', public.aplicar_lote_proveedores((select (v #>> '{}')::uuid from t_res where k = 'cp3'), 1,
     '[{"fila":2,"id_externo":"PRV-1","razon_social":"Proveedor de la Organización Dos Sintético","cuit":"30900000118"}]'::jsonb)$$,
  'otra organización puede usar el mismo id_externo y CUIT'
);
select is(
  (select v - 'errores' from t_res where k = 'lp3'),
  '{"nuevos": 1, "actualizados": 0, "omitidos": 0}'::jsonb,
  'se crea en su organización sin tocar al proveedor de la primera'
);
reset role;
select is(
  (select razon_social from dominio.proveedores where id_externo = 'PRV-1' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'Proveedor Uno Renombrado Sintético',
  'el proveedor de la primera organización no cambió'
);

-- ============================================================================
-- Vínculos proveedor ↔ producto (FR-022)
-- ============================================================================

-- SKU-C ya tenía a PRV-2 con un código viejo: el vínculo lo cambia a PRV-1.
update dominio.productos
   set proveedor_id = (select id from dominio.proveedores where id_externo = 'PRV-2' and organizacion_id = '11111111-1111-1111-1111-111111111111'),
       codigo_proveedor = 'VIEJO'
 where sku = 'SKU-C' and organizacion_id = '11111111-1111-1111-1111-111111111111';

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
insert into t_res select 'cv1', to_jsonb(public.iniciar_carga_migracion('vinculos_proveedor_producto', 'vinculos-sinteticos.csv', 5));

select is(
  (select jsonb_agg(x ->> 'estado' order by (x ->> 'fila')::int)
     from jsonb_array_elements(public.previsualizar_lote_vinculos_proveedor_producto(
       '[{"fila":2,"sku":"SKU-A","proveedor_id_externo":"PRV-1","codigo_proveedor":"COD-A"},
         {"fila":3,"sku":"sku-b","proveedor_id_externo":"PRV-2","codigo_proveedor":"COD-B"},
         {"fila":4,"sku":"SKU-C","proveedor_id_externo":"PRV-1"},
         {"fila":5,"sku":"NO-EXISTE","proveedor_id_externo":"PRV-1"},
         {"fila":6,"sku":"SKU-A","proveedor_id_externo":"PRV-NO-CARGADO"}]'::jsonb
     )) as x),
  '["nueva", "nueva", "actualizada", "error", "error"]'::jsonb,
  'la vista previa de vínculos clasifica nueva / nueva / actualizada / error / error'
);
reset role;
select is(
  (select count(*) from dominio.productos where proveedor_id is not null and organizacion_id = '11111111-1111-1111-1111-111111111111'),
  1::bigint,
  'la vista previa no vincula nada (solo SKU-C tenía proveedor)'
);

select pg_temp.como('e1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$select public.aplicar_lote_vinculos_proveedor_producto((select (v #>> '{}')::uuid from t_res where k = 'cv1'), 1,
     '[{"fila":2,"sku":"SKU-A","proveedor_id_externo":"PRV-1"}]'::jsonb)$$,
  '42501', null, 'un rol de consulta no puede aplicar vínculos'
);

select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.aplicar_lote_vinculos_proveedor_producto((select (v #>> '{}')::uuid from t_res where k = 'cp1'), 1,
     '[{"fila":2,"sku":"SKU-A","proveedor_id_externo":"PRV-1"}]'::jsonb)$$,
  '22023', null, 'una carga de proveedores no admite un lote de vínculos'
);

select lives_ok(
  $$insert into t_res select 'lv1', public.aplicar_lote_vinculos_proveedor_producto((select (v #>> '{}')::uuid from t_res where k = 'cv1'), 1,
     '[{"fila":2,"sku":"SKU-A","proveedor_id_externo":"PRV-1","codigo_proveedor":"COD-A"},
       {"fila":3,"sku":"sku-b","proveedor_id_externo":"PRV-2","codigo_proveedor":"COD-B"},
       {"fila":4,"sku":"SKU-C","proveedor_id_externo":"PRV-1","codigo_proveedor":""},
       {"fila":5,"sku":"NO-EXISTE","proveedor_id_externo":"PRV-1"},
       {"fila":6,"sku":"SKU-A","proveedor_id_externo":"PRV-2","codigo_proveedor":"COD-X"}]'::jsonb)$$,
  'se aplica el lote de vínculos'
);
select is(
  (select v - 'errores' from t_res where k = 'lv1'),
  '{"nuevos": 2, "actualizados": 1, "omitidos": 0}'::jsonb,
  'crea 2 vínculos y actualiza 1'
);
select is(
  (select v -> 'errores' from t_res where k = 'lv1'),
  '[{"fila": 5, "motivo": "El SKU no existe en el catálogo"},
    {"fila": 6, "motivo": "El SKU está repetido en el archivo"}]'::jsonb,
  'SKU inexistente y SKU repetido en el archivo son errores de fila'
);

reset role;
select is(
  (select p.proveedor_id = pr.id and p.codigo_proveedor = 'COD-A'
     from dominio.productos p, dominio.proveedores pr
    where p.sku = 'SKU-A' and p.organizacion_id = '11111111-1111-1111-1111-111111111111'
      and pr.id_externo = 'PRV-1' and pr.organizacion_id = '11111111-1111-1111-1111-111111111111'),
  true,
  'SKU-A queda con PRV-1 y su código'
);
select is(
  (select p.proveedor_id = pr.id and p.codigo_proveedor = 'COD-B'
     from dominio.productos p, dominio.proveedores pr
    where p.sku = 'SKU-B' and p.organizacion_id = '11111111-1111-1111-1111-111111111111'
      and pr.id_externo = 'PRV-2' and pr.organizacion_id = '11111111-1111-1111-1111-111111111111'),
  true,
  'el SKU se encuentra sin distinguir mayúsculas'
);
select is(
  (select p.proveedor_id = pr.id and p.codigo_proveedor is null
     from dominio.productos p, dominio.proveedores pr
    where p.sku = 'SKU-C' and p.organizacion_id = '11111111-1111-1111-1111-111111111111'
      and pr.id_externo = 'PRV-1' and pr.organizacion_id = '11111111-1111-1111-1111-111111111111'),
  true,
  'al cambiar de proveedor con código vacío, el código viejo se limpia'
);

-- Idempotencia de los vínculos.
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select lives_ok(
  $$insert into t_res select 'lv1b', public.aplicar_lote_vinculos_proveedor_producto((select (v #>> '{}')::uuid from t_res where k = 'cv1'), 1,
     '[{"fila":2,"sku":"SKU-A","proveedor_id_externo":"PRV-1","codigo_proveedor":"COD-A"},
       {"fila":3,"sku":"sku-b","proveedor_id_externo":"PRV-2","codigo_proveedor":"COD-B"},
       {"fila":4,"sku":"SKU-C","proveedor_id_externo":"PRV-1","codigo_proveedor":""}]'::jsonb)$$,
  'se reaplica el mismo lote de vínculos'
);
select is(
  (select v - 'errores' from t_res where k = 'lv1b'),
  '{"nuevos": 0, "actualizados": 0, "omitidos": 3}'::jsonb,
  'reaplicar los vínculos los omite: no se repiten'
);
insert into t_res select 'cierrev', public.cerrar_carga_migracion((select (v #>> '{}')::uuid from t_res where k = 'cv1'));
select is(
  (select v ->> 'estado' from t_res where k = 'cierrev'),
  'aplicada',
  'la carga de vínculos cierra aplicada: 2 + 1 + 2 con error = 5 filas'
);

-- Proveedor desactivado: no se vincula.
reset role;
update dominio.proveedores set activo = false
 where id_externo = 'PRV-2' and organizacion_id = '11111111-1111-1111-1111-111111111111';
select pg_temp.como('e1000000-0000-0000-0000-000000000001');
select is(
  (select x ->> 'motivo'
     from jsonb_array_elements(public.previsualizar_lote_vinculos_proveedor_producto(
       '[{"fila":2,"sku":"SKU-A","proveedor_id_externo":"PRV-2"}]'::jsonb)) as x),
  'El proveedor está desactivado',
  'un proveedor desactivado es error de fila'
);

-- ============================================================================
-- Vínculos · aislamiento entre organizaciones
-- ============================================================================

select pg_temp.como('e2000000-0000-0000-0000-000000000001');
insert into t_res select 'cv2', to_jsonb(public.iniciar_carga_migracion('vinculos_proveedor_producto', 'vinculos-dos.csv', 2));
select lives_ok(
  $$insert into t_res select 'lv2', public.aplicar_lote_vinculos_proveedor_producto((select (v #>> '{}')::uuid from t_res where k = 'cv2'), 1,
     '[{"fila":2,"sku":"SKU-A","proveedor_id_externo":"PRV-1","codigo_proveedor":"DOS-A"},
       {"fila":3,"sku":"SKU-B","proveedor_id_externo":"PRV-1"}]'::jsonb)$$,
  'otra organización aplica sus vínculos'
);
select is(
  (select v from t_res where k = 'lv2'),
  '{"nuevos": 1, "actualizados": 0, "omitidos": 0, "errores": [{"fila": 3, "motivo": "El SKU no existe en el catálogo"}]}'::jsonb,
  'solo ve sus productos: el SKU-B de la primera organización no existe para ella'
);
reset role;
select is(
  (select p.codigo_proveedor from dominio.productos p
    where p.sku = 'SKU-A' and p.organizacion_id = '11111111-1111-1111-1111-111111111111'),
  'COD-A',
  'el producto de la primera organización no cambió'
);
select is(
  (select pr.organizacion_id from dominio.productos p join dominio.proveedores pr on pr.id = p.proveedor_id
    where p.sku = 'SKU-A' and p.organizacion_id = '22222222-2222-2222-2222-222222222222'),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'el vínculo de la segunda organización apunta a un proveedor de la misma organización'
);

-- anon: sin acceso a las RPC.
set local role anon;

select throws_ok(
  $$select public.aplicar_lote_proveedores('00000000-0000-0000-0000-000000000000', 1, '[]'::jsonb)$$,
  '42501', null, 'anon no puede aplicar un lote de proveedores'
);
select throws_ok(
  $$select public.previsualizar_lote_proveedores('[]'::jsonb)$$,
  '42501', null, 'anon no puede previsualizar proveedores'
);
select throws_ok(
  $$select public.aplicar_lote_vinculos_proveedor_producto('00000000-0000-0000-0000-000000000000', 1, '[]'::jsonb)$$,
  '42501', null, 'anon no puede aplicar un lote de vínculos'
);
select throws_ok(
  $$select public.previsualizar_lote_vinculos_proveedor_producto('[]'::jsonb)$$,
  '42501', null, 'anon no puede previsualizar vínculos'
);

reset role;
select * from finish();
rollback;
