-- Grants mínimos de `service_role` sobre tablas de `public` que usa la suite E2E de la tienda
-- (migración 20270307100000). Todo en `public` (Principio VII); no se crean ni alteran tablas.
-- Verifica que `service_role` tiene lo necesario y que `anon` y `authenticated` no ganaron nada.
begin;

select plan(11);

select ok(
  has_table_privilege('service_role', 'public.usuarios_organizacion', 'select')
    and has_table_privilege('service_role', 'public.usuarios_organizacion', 'insert')
    and has_table_privilege('service_role', 'public.usuarios_organizacion', 'delete'),
  'service_role lee, inserta y borra membresías (siembra y limpieza del E2E)'
);
select ok(
  has_table_privilege('service_role', 'public.usuario_empresa_activa', 'select')
    and has_table_privilege('service_role', 'public.usuario_empresa_activa', 'insert')
    and has_table_privilege('service_role', 'public.usuario_empresa_activa', 'delete'),
  'service_role fija y limpia la empresa activa'
);
select ok(
  has_table_privilege('service_role', 'public.banderas_plataforma', 'select')
    and has_table_privilege('service_role', 'public.banderas_plataforma', 'update'),
  'service_role lee y actualiza las banderas de plataforma'
);
select ok(
  not has_table_privilege('service_role', 'public.banderas_plataforma', 'insert')
    and not has_table_privilege('service_role', 'public.banderas_plataforma', 'delete'),
  'service_role no crea ni borra banderas (las crea una migración)'
);

select ok(
  not has_table_privilege('anon', 'public.usuarios_organizacion', 'select')
    and not has_table_privilege('anon', 'public.usuario_empresa_activa', 'select')
    and not has_table_privilege('anon', 'public.banderas_plataforma', 'select'),
  'anon no tiene SELECT sobre ninguna de las tres'
);
select ok(
  not has_table_privilege('authenticated', 'public.usuarios_organizacion', 'insert')
    and not has_table_privilege('authenticated', 'public.usuarios_organizacion', 'delete')
    and not has_table_privilege('authenticated', 'public.usuarios_organizacion', 'update'),
  'authenticated sigue sin escribir membresías'
);
select ok(
  not has_table_privilege('authenticated', 'public.usuario_empresa_activa', 'insert')
    and not has_table_privilege('authenticated', 'public.usuario_empresa_activa', 'delete')
    and not has_table_privilege('authenticated', 'public.usuario_empresa_activa', 'update'),
  'authenticated sigue sin escribir la empresa activa (solo por RPC)'
);
select ok(
  not has_table_privilege('authenticated', 'public.banderas_plataforma', 'insert')
    and not has_table_privilege('authenticated', 'public.banderas_plataforma', 'update')
    and not has_table_privilege('authenticated', 'public.banderas_plataforma', 'delete'),
  'authenticated sigue sin escribir banderas'
);
select ok(
  has_table_privilege('authenticated', 'public.usuarios_organizacion', 'select')
    and has_table_privilege('authenticated', 'public.usuario_empresa_activa', 'select')
    and has_table_privilege('authenticated', 'public.banderas_plataforma', 'select'),
  'authenticated conserva su SELECT'
);
select ok(
  not has_table_privilege('anon', 'public.usuarios_organizacion', 'insert')
    and not has_table_privilege('anon', 'public.usuario_empresa_activa', 'insert')
    and not has_table_privilege('anon', 'public.banderas_plataforma', 'update'),
  'anon no escribe ninguna de las tres'
);
select ok(
  not has_table_privilege('service_role', 'public.usuarios_organizacion', 'update')
    and not has_table_privilege('service_role', 'public.usuario_empresa_activa', 'update'),
  'service_role no recibió UPDATE de más'
);

select * from finish();
rollback;
