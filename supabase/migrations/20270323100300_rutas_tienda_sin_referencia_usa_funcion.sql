-- MSF-796 (revisión del Lote 1, M3): `public.rutas_tienda_sin_referencia` (FR-062) repetía por su cuenta la lógica de
-- «¿alguna referencia usa esta ruta?» que la política de borrado del bucket tomó de `private.ruta_identidad_referenciada`
-- (20270323100000). Dos copias pueden divergir: la RPC consejera podría decir «se puede borrar» donde la política dice que no
-- (o al revés). Ahora la RPC usa la función privada: una sola fuente de verdad.
--
-- Mismo contrato que antes (firma, permisos, validaciones, prefijo `<organizacion>/<empresa>/`) y mismos grants:
-- `create or replace` conserva el `revoke … from public, anon` y el `grant execute … to authenticated` de 20270205110100.
-- Diferencia sin efecto: la función privada toma la empresa del segundo segmento de la ruta; la RPC ya exige que la ruta
-- empiece con el prefijo de `p_empresa`, así que es la misma empresa.
--
-- Esquemas: solo se reemplaza una función de `public` (sin tablas). Aditiva e idempotente.
-- Reversión (migración posterior): reponer el cuerpo de 20270205110100 (tres `not exists` inline).

create or replace function public.rutas_tienda_sin_referencia(p_empresa uuid, p_rutas text[])
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_prefijo text;
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede editar la tienda de esta empresa' using errcode = '42501';
  end if;
  if not exists (select 1 from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org) then
    raise exception 'La empresa no existe' using errcode = 'P0002';
  end if;
  v_prefijo := v_org::text || '/' || p_empresa::text || '/';

  return coalesce((
    select array_agg(distinct r)
      from unnest(coalesce(p_rutas, '{}'::text[])) as r
     where r is not null
       and left(r, length(v_prefijo)) = v_prefijo
       and not private.ruta_identidad_referenciada(r)
  ), '{}'::text[]);
end;
$$;
