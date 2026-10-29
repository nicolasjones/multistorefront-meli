-- F-VTA-32 (MSF-340, épica MSF-193, spec 20261027-100000-ventas-mejoras, FR-010): descuento porcentual
-- por cliente.
--
-- Esquema (Principio VII, re-verificado): `public.clientes` ya vive en `public` (decisión histórica,
-- MSF-180); solo se agrega una columna nulable. Sin tablas nuevas; RLS vigente de `clientes`.
--
-- `descuento`: porcentaje 0..100 con 2 decimales; null = sin descuento. Solo lo edita un Administrador:
-- el grant por columna permite el UPDATE y el disparador rechaza (42501) a quien no es administrador de la
-- organización. No se concede en INSERT: un cliente nace sin descuento. Cambiarlo registra
-- `cliente.descuento_editado` (actor y cliente, sin el valor en datos de contacto) en la misma transacción.
--
-- Migración aditiva. Reversión (migración posterior; no destruye datos de otras tablas):
--   drop trigger clientes_descuento_registrar_actividad on public.clientes;
--   drop trigger clientes_descuento_solo_admin on public.clientes;
--   drop function private.registrar_actividad_cliente_descuento();
--   drop function private.exigir_admin_descuento_cliente();
--   revoke update (descuento) on public.clientes from authenticated;
--   alter table public.clientes drop column descuento;  -- recién cuando 20270115090100 (lineas_descuento) ya no lo lea

alter table public.clientes
  add column if not exists descuento numeric(5, 2);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clientes_descuento_ck' and conrelid = 'public.clientes'::regclass
  ) then
    alter table public.clientes
      add constraint clientes_descuento_ck check (descuento is null or (descuento >= 0 and descuento <= 100));
  end if;
end
$$;

comment on column public.clientes.descuento is
  'F-VTA-32: descuento porcentual (0..100) que Ventas aplica sobre el neto de escala de cada línea. null = sin descuento. Solo lo edita un Administrador.';

grant update (descuento) on public.clientes to authenticated;

-- Solo el Administrador de la organización (o superadmin) cambia el descuento. Las cargas sin sesión
-- (importación, API de servicio) no pasan por acá: auth.uid() es null.
create or replace function private.exigir_admin_descuento_cliente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.descuento is distinct from old.descuento
     and (select auth.uid()) is not null
     and not (select private.es_administrador_de(new.organizacion_id)) then
    raise exception 'Solo un administrador puede cambiar el descuento del cliente'
      using errcode = '42501', hint = 'descuento';
  end if;
  return new;
end;
$$;

revoke execute on function private.exigir_admin_descuento_cliente() from public, anon, authenticated;

create trigger clientes_descuento_solo_admin
  before update of descuento on public.clientes
  for each row execute function private.exigir_admin_descuento_cliente();

create or replace function private.registrar_actividad_cliente_descuento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.descuento is distinct from old.descuento and (select auth.uid()) is not null then
    perform private.registrar_actividad(
      'cliente.descuento_editado',
      format('Cambió el descuento del cliente Nº %s · %s', new.numero, new.nombre)
    );
  end if;
  return new;
end;
$$;

revoke execute on function private.registrar_actividad_cliente_descuento() from public, anon, authenticated;

create trigger clientes_descuento_registrar_actividad
  after update of descuento on public.clientes
  for each row execute function private.registrar_actividad_cliente_descuento();
