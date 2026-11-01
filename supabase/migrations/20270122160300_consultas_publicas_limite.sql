-- F-SVC-22 (MSF-157, épica MSF-124): límite de tasa de la consulta pública (FR-043).
-- Esquema (Principio VII): `public.consultas_publicas_intentos` es plataforma/transversal (contador de un endpoint
-- público, no una entidad del taller) → `public`. No lleva `organizacion_id`: la IP precede a saber de qué
-- organización es el token. Guarda un hash de la IP con sal de servidor, nunca la IP.
--
-- Seguridad: RLS habilitada SIN políticas y SIN grants. `registrar_consulta_publica` es ejecutable SOLO por
-- `service_role` (la Edge Function `consultar-estado-reparacion`).
--
-- Ventana fija: el contador de `(ip_hash, ventana)` sube con un `upsert` atómico; permitido mientras
-- `cuenta <= limite`. Cada llamada purga, de forma acotada (100 filas), las ventanas vencidas.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.registrar_consulta_publica(text, integer, integer);
--   drop table public.consultas_publicas_intentos;

create table public.consultas_publicas_intentos (
  ip_hash text not null check (length(ip_hash) between 1 and 128),
  ventana timestamptz not null,
  cuenta integer not null default 0 check (cuenta >= 0),
  primary key (ip_hash, ventana)
);

comment on table public.consultas_publicas_intentos is
  'Contador de límite de tasa de la consulta pública de reparaciones (F-SVC-22). Hash de IP con sal; sin políticas ni grants: solo registrar_consulta_publica.';

create index consultas_publicas_intentos_ventana_idx on public.consultas_publicas_intentos (ventana);

alter table public.consultas_publicas_intentos enable row level security;

revoke all on public.consultas_publicas_intentos from public, anon, authenticated;

create or replace function public.registrar_consulta_publica(p_ip_hash text, p_ventana_seg integer, p_limite integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ahora timestamptz := now();
  v_ventana timestamptz;
  v_cuenta integer;
begin
  if p_ip_hash is null or length(p_ip_hash) not between 1 and 128
     or p_ventana_seg is null or p_ventana_seg not between 1 and 86400
     or p_limite is null or p_limite not between 1 and 100000 then
    raise exception 'Parámetros inválidos' using errcode = '22023';
  end if;

  v_ventana := to_timestamp(floor(extract(epoch from v_ahora) / p_ventana_seg) * p_ventana_seg);

  insert into public.consultas_publicas_intentos as i (ip_hash, ventana, cuenta)
  values (p_ip_hash, v_ventana, 1)
  on conflict (ip_hash, ventana) do update set cuenta = i.cuenta + 1
  returning i.cuenta into v_cuenta;

  -- Purga acotada de ventanas vencidas (al menos dos ventanas atrás).
  delete from public.consultas_publicas_intentos d
   where (d.ip_hash, d.ventana) in (
     select p.ip_hash, p.ventana
       from public.consultas_publicas_intentos p
      where p.ventana < v_ventana - make_interval(secs => p_ventana_seg * 2)
      limit 100
   );

  return jsonb_build_object(
    'permitido', v_cuenta <= p_limite,
    'restantes', greatest(p_limite - v_cuenta, 0),
    'reintentar_en', greatest(ceil(extract(epoch from (v_ventana + make_interval(secs => p_ventana_seg) - v_ahora)))::integer, 1)
  );
end;
$$;

comment on function public.registrar_consulta_publica(text, integer, integer) is
  'F-SVC-22: cuenta una consulta pública por hash de IP en una ventana fija y dice si está permitida. Solo service_role.';

revoke execute on function public.registrar_consulta_publica(text, integer, integer) from public, anon, authenticated;
grant execute on function public.registrar_consulta_publica(text, integer, integer) to service_role;
