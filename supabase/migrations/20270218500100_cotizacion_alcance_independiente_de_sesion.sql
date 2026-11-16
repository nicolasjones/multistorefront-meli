-- MSF-352 (revisión de F-PRE-06, hallazgo BAJO de Code): `private.cotizacion_config(org)` devuelve los valores del
-- lanzamiento (alcance «sistema») cuando la SESIÓN pertenece a OTRA organización (sin oráculo entre organizaciones).
-- `private.cotizacion_para` la usaba para saber el alcance, y es la función que calcula el precio de la tienda
-- pública (`precio_final_publico*`, `security definer`, la leen visitantes anónimos Y usuarios con sesión): un usuario
-- con membresía en otra organización que navegara la tienda de una organización con alcance «empresa» veía el precio
-- con la cotización GENERAL, distinto del que ve un visitante anónimo y del que cobra la empresa.
--
-- Corrección: el alcance que decide qué cotización rige un PRECIO no puede depender de quién mira. Se agrega
-- `private.cotizacion_alcance(org)` (definer, sin filtro de sesión, solo devuelve el alcance) y `cotizacion_para` la usa.
-- `cotizacion_config` NO cambia (sigue sin mostrar la configuración ajena a otra sesión).
--
-- Esquema (Principio VII): sin tablas nuevas; solo funciones de `private`. Migración aditiva (create or replace).
-- Reversión (migración posterior): restaurar `private.cotizacion_para` al cuerpo de 20270213100002 y
--   drop function private.cotizacion_alcance(uuid);

create or replace function private.cotizacion_alcance(p_organizacion uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.alcance from dominio.cotizacion_configuracion c where c.organizacion_id = p_organizacion), 'sistema');
$$;

comment on function private.cotizacion_alcance(uuid) is
  'MSF-352: alcance de la cotización de una organización (sistema|empresa) sin depender de la sesión; solo para decidir qué cotización rige un precio. No expone el resto de la configuración.';

revoke execute on function private.cotizacion_alcance(uuid) from public, anon;
grant execute on function private.cotizacion_alcance(uuid) to authenticated;

create or replace function private.cotizacion_para(p_organizacion uuid, p_empresa uuid default null)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select a.valor from dominio.cotizacion_aplicada a
      where p_empresa is not null and a.organizacion_id = p_organizacion and a.empresa_id = p_empresa
        and (select private.cotizacion_alcance(p_organizacion)) = 'empresa'),
    (select a.valor from dominio.cotizacion_aplicada a
      where a.organizacion_id = p_organizacion and a.empresa_id is null),
    (select c.valor from dominio.cotizacion_inicial c where c.organizacion_id = p_organizacion)
  );
$$;

comment on function private.cotizacion_para(uuid, uuid) is
  'F-PRE-06: único punto de lectura de la cotización aplicada. Alcance «empresa»: la de la empresa (o la general si aún no tiene); alcance «sistema»: la general; sin ninguna, la inicial; sin cotización → null. El alcance se lee con private.cotizacion_alcance: no depende de la sesión (MSF-352).';
