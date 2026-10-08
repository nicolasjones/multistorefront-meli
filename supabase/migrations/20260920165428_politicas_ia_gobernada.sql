-- Contratos y políticas globales IA (spec 016, US2).

create or replace function private.guardar_contrato_ia(
  p_codigo text,
  p_version integer,
  p_consumidor_codigo text,
  p_esquema_entrada jsonb,
  p_esquema_salida jsonb,
  p_clasificacion_datos jsonb,
  p_acciones_permitidas jsonb,
  p_verificadores jsonb,
  p_estado text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if not private.is_superadmin() then raise exception 'Solo el superadmin puede guardar contratos IA' using errcode = '42501'; end if;
  if p_estado not in ('borrador', 'aprobado', 'retirado') or p_version < 1 or p_codigo !~ '^[a-z0-9-]+$' then raise exception 'Contrato IA inválido' using errcode = '22023'; end if;
  if jsonb_typeof(p_esquema_entrada) <> 'object' or jsonb_typeof(p_esquema_salida) <> 'object' or jsonb_typeof(p_clasificacion_datos) <> 'object' or jsonb_typeof(p_acciones_permitidas) <> 'array' or jsonb_typeof(p_verificadores) <> 'array' then raise exception 'Esquema de contrato IA inválido' using errcode = '22023'; end if;
  insert into public.ia_contratos_consumidor (codigo, version, consumidor_codigo, esquema_entrada, esquema_salida, clasificacion_datos, acciones_permitidas, verificadores, estado, creado_por)
  values (p_codigo, p_version, p_consumidor_codigo, p_esquema_entrada, p_esquema_salida, p_clasificacion_datos, p_acciones_permitidas, p_verificadores, p_estado, auth.uid())
  on conflict (codigo, version) do update set consumidor_codigo = excluded.consumidor_codigo, esquema_entrada = excluded.esquema_entrada, esquema_salida = excluded.esquema_salida, clasificacion_datos = excluded.clasificacion_datos, acciones_permitidas = excluded.acciones_permitidas, verificadores = excluded.verificadores, estado = excluded.estado
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.guardar_politica_ia(
  p_codigo text, p_version integer, p_contrato_id uuid, p_perfil_principal_id uuid, p_perfil_fallback_id uuid, p_limite_intentos smallint, p_limite_segundos integer, p_estado text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if not private.is_superadmin() then raise exception 'Solo el superadmin puede guardar políticas IA' using errcode = '42501'; end if;
  if p_estado not in ('borrador', 'aprobada', 'retirada') or p_version < 1 or p_codigo !~ '^[a-z0-9-]+$' then raise exception 'Política IA inválida' using errcode = '22023'; end if;
  if p_estado = 'aprobada' and not exists (select 1 from public.ia_contratos_consumidor where id = p_contrato_id and estado = 'aprobado') then raise exception 'Una política aprobada requiere contrato aprobado' using errcode = '22023'; end if;
  if not exists (select 1 from public.ia_perfiles_modelo perfil join public.ia_credenciales_proveedor credencial on credencial.id = perfil.credencial_id join public.ia_proveedores proveedor on proveedor.id = credencial.proveedor_id where perfil.id = p_perfil_principal_id and perfil.activo and credencial.activa and proveedor.habilitado and proveedor.retencion_verifica_hasta > clock_timestamp()) then raise exception 'Perfil principal IA no disponible' using errcode = '22023'; end if;
  if p_perfil_fallback_id is not null and not exists (select 1 from public.ia_perfiles_modelo perfil join public.ia_credenciales_proveedor credencial on credencial.id = perfil.credencial_id join public.ia_proveedores proveedor on proveedor.id = credencial.proveedor_id where perfil.id = p_perfil_fallback_id and perfil.activo and credencial.activa and proveedor.habilitado and proveedor.retencion_verifica_hasta > clock_timestamp()) then raise exception 'Perfil fallback IA no disponible' using errcode = '22023'; end if;
  insert into public.ia_politicas (codigo, version, contrato_id, perfil_principal_id, perfil_fallback_id, limite_intentos, limite_segundos, estado, aprobada_por)
  values (p_codigo, p_version, p_contrato_id, p_perfil_principal_id, p_perfil_fallback_id, p_limite_intentos, p_limite_segundos, p_estado, case when p_estado = 'aprobada' then auth.uid() else null end)
  on conflict (codigo, version) do update set contrato_id = excluded.contrato_id, perfil_principal_id = excluded.perfil_principal_id, perfil_fallback_id = excluded.perfil_fallback_id, limite_intentos = excluded.limite_intentos, limite_segundos = excluded.limite_segundos, estado = excluded.estado, aprobada_por = excluded.aprobada_por, updated_at = clock_timestamp()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.resolver_politica_ia(p_codigo text)
returns table (politica_id uuid, contrato_id uuid, perfil_principal_id uuid, perfil_fallback_id uuid, limite_intentos smallint, limite_segundos integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not pg_catalog.pg_has_role(session_user, 'workers_orquestacion', 'member') then raise exception 'Runtime no autorizado para IA' using errcode = '42501'; end if;
  return query select p.id, p.contrato_id, p.perfil_principal_id, p.perfil_fallback_id, p.limite_intentos, p.limite_segundos
  from public.ia_politicas p
  join public.ia_contratos_consumidor contrato on contrato.id = p.contrato_id and contrato.estado = 'aprobado'
  join public.ia_perfiles_modelo principal on principal.id = p.perfil_principal_id
  join public.ia_credenciales_proveedor credencial_principal on credencial_principal.id = principal.credencial_id
  join public.ia_proveedores proveedor_principal on proveedor_principal.id = credencial_principal.proveedor_id
  left join public.ia_perfiles_modelo fallback on fallback.id = p.perfil_fallback_id
  left join public.ia_credenciales_proveedor credencial_fallback on credencial_fallback.id = fallback.credencial_id
  left join public.ia_proveedores proveedor_fallback on proveedor_fallback.id = credencial_fallback.proveedor_id
  where p.codigo = p_codigo and p.estado = 'aprobada'
    and principal.activo and credencial_principal.activa and proveedor_principal.habilitado and proveedor_principal.retencion_verifica_hasta > clock_timestamp()
    and (p.perfil_fallback_id is null or (fallback.activo and credencial_fallback.activa and proveedor_fallback.habilitado and proveedor_fallback.retencion_verifica_hasta > clock_timestamp()));
end;
$$;

create or replace function public.guardar_contrato_ia(p_codigo text, p_version integer, p_consumidor_codigo text, p_esquema_entrada jsonb, p_esquema_salida jsonb, p_clasificacion_datos jsonb, p_acciones_permitidas jsonb, p_verificadores jsonb, p_estado text)
returns uuid language sql security definer set search_path = '' as $$ select private.guardar_contrato_ia(p_codigo, p_version, p_consumidor_codigo, p_esquema_entrada, p_esquema_salida, p_clasificacion_datos, p_acciones_permitidas, p_verificadores, p_estado); $$;

create or replace function public.guardar_politica_ia(p_codigo text, p_version integer, p_contrato_id uuid, p_perfil_principal_id uuid, p_perfil_fallback_id uuid, p_limite_intentos smallint, p_limite_segundos integer, p_estado text)
returns uuid language sql security definer set search_path = '' as $$ select private.guardar_politica_ia(p_codigo, p_version, p_contrato_id, p_perfil_principal_id, p_perfil_fallback_id, p_limite_intentos, p_limite_segundos, p_estado); $$;

revoke all on function private.guardar_contrato_ia(text, integer, text, jsonb, jsonb, jsonb, jsonb, jsonb, text), private.guardar_politica_ia(text, integer, uuid, uuid, uuid, smallint, integer, text) from public, anon, authenticated;
revoke all on function public.guardar_contrato_ia(text, integer, text, jsonb, jsonb, jsonb, jsonb, jsonb, text), public.guardar_politica_ia(text, integer, uuid, uuid, uuid, smallint, integer, text) from public, anon;
grant execute on function public.guardar_contrato_ia(text, integer, text, jsonb, jsonb, jsonb, jsonb, jsonb, text), public.guardar_politica_ia(text, integer, uuid, uuid, uuid, smallint, integer, text) to authenticated;
