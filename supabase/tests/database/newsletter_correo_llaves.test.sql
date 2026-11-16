-- Newsletter de la tienda: el correo del suscriptor no admite llaves (sintaxis de plantilla de Kestra). Endurecimiento de la revisión de #1057.
begin;

select no_plan();

select is(private.validar_suscripcion_newsletter('{{envs.x}}@ejemplo.com', true), array['correo'], 'el validador rechaza una parte local con llaves');
select is(private.validar_suscripcion_newsletter('a{b}@ejemplo.com', true), array['correo'], 'ni siquiera una llave suelta');
select is(private.validar_suscripcion_newsletter('ana.perez+tag@ejemplo.com', true), '{}'::text[], 'un correo normal sigue valiendo');

insert into organizaciones (id, nombre) values ('11111111-1111-1111-1111-111111111111', 'Organización Uno');
insert into dominio.empresas (id, organizacion_id, nombre, activa) values ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tienda A', true);

select throws_ok(
  $$insert into dominio.newsletter_suscriptores (organizacion_id, empresa_id, correo, version_consentimiento) values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', '{{envs.x}}@ejemplo.com', 'v1')$$,
  '23514', null, 'la tabla también rechaza llaves en el correo');
select lives_ok(
  $$insert into dominio.newsletter_suscriptores (organizacion_id, empresa_id, correo, version_consentimiento) values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-000000000001', 'ana@ejemplo.com', 'v1')$$,
  'un correo normal se guarda');

select * from finish();
rollback;
