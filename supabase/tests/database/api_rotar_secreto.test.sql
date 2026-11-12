-- F-API-01 (MSF-233) · seguimiento MSF-839: rotación del secreto de firma de una suscripción con gracia de 24 h.
--   · rotar crea un secreto nuevo, deja el actual como anterior hasta dentro de 24 h y devuelve el nuevo una sola vez;
--   · la entrega recibe los dos secretos mientras dura la gracia y solo el nuevo después;
--   · rotar durante la gracia reemplaza al anterior y borra el de antes de Vault;
--   · la purga diaria limpia el anterior vencido; borrar la suscripción borra los dos;
--   · solo el Administrador de la organización rota; los secretos nunca llegan al navegador.
begin;

select no_plan();

insert into organizaciones (id, nombre) values
  ('a5000000-0000-0000-0000-000000000001', 'Organización rotación A'),
  ('a5000000-0000-0000-0000-000000000002', 'Organización rotación B');

insert into auth.users (id, email) values
  ('f5000000-0000-0000-0000-000000000001', 'admin-rot-a@example.com'),
  ('f5000000-0000-0000-0000-000000000002', 'miembro-rot-a@example.com'),
  ('f5000000-0000-0000-0000-000000000003', 'admin-rot-b@example.com');

insert into usuarios_organizacion (user_id, organizacion_id, rol_id, estado) values
  ('f5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000001', 'administrador', 'activo'),
  ('f5000000-0000-0000-0000-000000000002', 'a5000000-0000-0000-0000-000000000001', 'miembro', 'activo'),
  ('f5000000-0000-0000-0000-000000000003', 'a5000000-0000-0000-0000-000000000002', 'administrador', 'activo');

create temporary table vault_rot (clave text primary key, id uuid not null);
grant all on vault_rot to authenticated;

do $$
begin
  insert into vault_rot values ('original', vault.create_secret('secreto-original'));
  insert into public.api_suscripciones (id, organizacion_id, url, tipos, secreto_vault_id) values
    ('d5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000001', 'https://ejemplo.com/rotar', array['stock.actualizado'],
     (select id from vault_rot where clave = 'original'));
end $$;

-- Una entrega reclamada para poder pedir el secreto como lo hace entregar-webhook.
insert into public.cola_eventos (id, organizacion_id, tipo, clave_idempotencia, carga) values
  ('e5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000001', 'stock.actualizado', 'rot-1', '{"ocurrido_en":"2027-03-02T00:00:00Z"}');
insert into public.api_entregas (id, organizacion_id, evento_id, suscripcion_id, estado, intentos, reclamada_en, vence_en) values
  ('c5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001',
   'd5000000-0000-0000-0000-000000000001', 'reclamada', 1, now(), now() + interval '5 minutes');

-- Antes de rotar no hay secreto anterior.
select is(
  (select secreto_anterior from public.api_entrega_para_entregar('c5000000-0000-0000-0000-000000000001')), null,
  'antes de rotar la entrega no trae secreto anterior');
select is(
  (select secreto from public.api_entrega_para_entregar('c5000000-0000-0000-0000-000000000001')), 'secreto-original',
  'y el secreto es el original');

-- ============================================================================
-- Rotar
-- ============================================================================

create temporary table devuelto (secreto text, id uuid);
grant all on devuelto to authenticated;

select set_config('request.jwt.claims',
  json_build_object('sub', 'f5000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into devuelto select r.secreto, r.id from public.rotar_secreto_suscripcion_api('d5000000-0000-0000-0000-000000000001') r;
reset role;

select is((select id from devuelto), 'd5000000-0000-0000-0000-000000000001'::uuid, 'rotar devuelve la suscripción');
select matches((select secreto from devuelto), '^[0-9a-f]{64}$', 'y un secreto nuevo de 32 bytes en hexadecimal');
select isnt((select secreto from devuelto), 'secreto-original', 'distinto del anterior');

select is(
  (select decrypted_secret from vault.decrypted_secrets
    where id = (select secreto_vault_id from public.api_suscripciones where id = 'd5000000-0000-0000-0000-000000000001')),
  (select secreto from devuelto), 'el secreto nuevo es el que quedó en Vault');
select is(
  (select secreto_anterior_vault_id from public.api_suscripciones where id = 'd5000000-0000-0000-0000-000000000001'),
  (select id from vault_rot where clave = 'original'), 'el secreto de antes quedó como anterior');
select ok(
  (select secreto_anterior_vence_en between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute'
     from public.api_suscripciones where id = 'd5000000-0000-0000-0000-000000000001'),
  'con una gracia de 24 horas');

-- ============================================================================
-- La entrega recibe los dos secretos durante la gracia
-- ============================================================================

select is(
  (select secreto from public.api_entrega_para_entregar('c5000000-0000-0000-0000-000000000001')), (select secreto from devuelto),
  'durante la gracia la entrega trae el secreto nuevo');
select is(
  (select secreto_anterior from public.api_entrega_para_entregar('c5000000-0000-0000-0000-000000000001')), 'secreto-original',
  'y también el anterior');

update public.api_suscripciones set secreto_anterior_vence_en = now() - interval '1 minute'
 where id = 'd5000000-0000-0000-0000-000000000001';
select is(
  (select secreto_anterior from public.api_entrega_para_entregar('c5000000-0000-0000-0000-000000000001')), null,
  'pasada la gracia, la entrega ya no trae el anterior');
select is(
  (select secreto from public.api_entrega_para_entregar('c5000000-0000-0000-0000-000000000001')), (select secreto from devuelto),
  'y sigue trayendo el nuevo');

-- ============================================================================
-- Rotar durante la gracia reemplaza al anterior y lo borra de Vault
-- ============================================================================

update public.api_suscripciones set secreto_anterior_vence_en = now() + interval '12 hours'
 where id = 'd5000000-0000-0000-0000-000000000001';
insert into vault_rot values ('segundo', (select secreto_vault_id from public.api_suscripciones where id = 'd5000000-0000-0000-0000-000000000001'));

set local role authenticated;
select lives_ok($$select public.rotar_secreto_suscripcion_api('d5000000-0000-0000-0000-000000000001')$$, 'se puede rotar de nuevo durante la gracia');
reset role;

select is(
  (select secreto_anterior_vault_id from public.api_suscripciones where id = 'd5000000-0000-0000-0000-000000000001'),
  (select id from vault_rot where clave = 'segundo'), 'el anterior pasa a ser el segundo secreto');
select is(
  (select count(*)::int from vault.secrets where id = (select id from vault_rot where clave = 'original')), 0,
  'el secreto de antes del anterior se borró de Vault');

-- ============================================================================
-- Purga y borrado
-- ============================================================================

update public.api_suscripciones set secreto_anterior_vence_en = now() - interval '1 minute'
 where id = 'd5000000-0000-0000-0000-000000000001';
select lives_ok($$select private.purgar_api_llamadas(90)$$, 'la purga corre');
select is(
  (select secreto_anterior_vault_id from public.api_suscripciones where id = 'd5000000-0000-0000-0000-000000000001'), null,
  'la purga limpia el secreto anterior vencido de la fila');
select is(
  (select count(*)::int from vault.secrets where id = (select id from vault_rot where clave = 'segundo')), 0,
  'y lo borra de Vault');
select is(
  (select count(*)::int from vault.secrets where id = (select secreto_vault_id from public.api_suscripciones where id = 'd5000000-0000-0000-0000-000000000001')), 1,
  'sin tocar el secreto vigente');

-- Borrar la suscripción borra los dos secretos.
do $$
declare
  v_a uuid := vault.create_secret('vigente');
  v_b uuid := vault.create_secret('anterior');
begin
  insert into public.api_suscripciones (id, organizacion_id, url, tipos, secreto_vault_id, secreto_anterior_vault_id, secreto_anterior_vence_en)
  values ('d5000000-0000-0000-0000-000000000002', 'a5000000-0000-0000-0000-000000000001', 'https://ejemplo.com/dos', array['stock.actualizado'],
          v_a, v_b, now() + interval '1 hour');
  insert into vault_rot values ('vigente', v_a), ('anterior', v_b);
end $$;
delete from public.api_suscripciones where id = 'd5000000-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from vault.secrets where id in ((select id from vault_rot where clave = 'vigente'), (select id from vault_rot where clave = 'anterior'))), 0,
  'borrar la suscripción borra el secreto vigente y el anterior de Vault');

-- ============================================================================
-- Aislamiento y permisos
-- ============================================================================

select set_config('request.jwt.claims',
  json_build_object('sub', 'f5000000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select public.rotar_secreto_suscripcion_api('d5000000-0000-0000-0000-000000000001')$$, 'P0002', 'La suscripción no existe',
  'el Administrador de otra organización no la ve ni la rota');
reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', 'f5000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select public.rotar_secreto_suscripcion_api('d5000000-0000-0000-0000-000000000001')$$, '42501',
  'Solo un administrador puede rotar el secreto de una suscripción', 'un miembro sin permiso de escritura no rota');
reset role;

select is(has_function_privilege('anon', 'public.rotar_secreto_suscripcion_api(uuid)', 'EXECUTE'), false, 'anon no rota');
select is(has_function_privilege('authenticated', 'public.rotar_secreto_suscripcion_api(uuid)', 'EXECUTE'), true, 'authenticated sí (la RPC valida el rol)');
select is(has_function_privilege('authenticated', 'public.api_entrega_para_entregar(uuid)', 'EXECUTE'), false, 'authenticated no pide los secretos de una entrega');
select is(has_function_privilege('anon', 'public.api_entrega_para_entregar(uuid)', 'EXECUTE'), false, 'anon tampoco');
select is(has_function_privilege('service_role', 'public.api_entrega_para_entregar(uuid)', 'EXECUTE'), true, 'solo la función de entrega (service_role)');
select is(has_function_privilege('authenticated', 'private.api_secreto_o_nulo(uuid)', 'EXECUTE'), false, 'authenticated no lee secretos de Vault');
select is(has_column_privilege('authenticated', 'public.api_suscripciones', 'secreto_anterior_vence_en', 'SELECT'), true,
  'la pantalla puede mostrar hasta cuándo vale el secreto anterior');
select is(has_column_privilege('authenticated', 'public.api_suscripciones', 'secreto_anterior_vault_id', 'SELECT'), false,
  'pero no la referencia a Vault del anterior');
select is(has_column_privilege('authenticated', 'public.api_suscripciones', 'secreto_vault_id', 'SELECT'), false,
  'ni la del vigente');

-- ============================================================================
-- Coherencia y lectura tolerante
-- ============================================================================

select throws_ok(
  $$update public.api_suscripciones set secreto_anterior_vault_id = gen_random_uuid() where id = 'd5000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'no puede haber un secreto anterior sin fecha de vencimiento');
select is(private.api_secreto_o_nulo(gen_random_uuid()), null, 'un secreto que no existe en Vault se lee como nulo');
select is(private.api_secreto_o_nulo(null), null, 'y un id nulo también');

select finish();
rollback;
