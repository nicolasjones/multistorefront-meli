-- Habilita la funcionalidad «Service técnico» para la organización demo (paso SQL, no vía API).
-- Por qué SQL: `public.habilitar_feature` exige ser superadmin de plataforma y, en los entornos compartidos
-- (dev/stg), ni `authenticated` ni `service_role` tienen INSERT ni SELECT en `public.features` ni en
-- `public.organizaciones_features`: la funcionalidad se registra y se habilita solo por SQL (o por un superadmin).
-- Idempotente. Se corre con un rol que escriba en `public` (postgres):
--   psql "$DEMO_DB_URL" -v org="San Javucho y Mundo JC (demo)" -v sufijo="" -f sql/02-funcionalidad.sql
-- Sin esta fila la pantalla de Service técnico responde «No tenés acceso a esta sección» incluso al Administrador.
\set ON_ERROR_STOP on
insert into public.features (id, nombre, descripcion, creado_por)
select 'service-tecnico', 'Service técnico', 'Reparaciones, ítems, modelos y estados de service',
       (select id from auth.users where email = 'admin' || :'sufijo' || '@demo.msf.test')
 where not exists (select 1 from public.features where id = 'service-tecnico');

insert into public.organizaciones_features (feature_id, organizacion_id, habilitado_por)
select 'service-tecnico', o.id,
       (select id from auth.users where email = 'admin' || :'sufijo' || '@demo.msf.test')
  from public.organizaciones o
 where o.nombre = :'org'
on conflict (feature_id, organizacion_id) do nothing;

select o.nombre as organizacion, f.feature_id as funcionalidad, 'habilitada' as estado
  from public.organizaciones_features f
  join public.organizaciones o on o.id = f.organizacion_id
 where o.nombre = :'org' and f.feature_id = 'service-tecnico';
