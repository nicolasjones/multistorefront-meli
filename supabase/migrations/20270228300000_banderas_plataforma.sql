-- MSF-363 (decisión 15, aprobada 2026-11-12): bandera de apagado para promociones de precio y precios masivos.
--
-- Esquema (Principio VII): `public.banderas_plataforma` es configuración de plataforma (no entidad de negocio) -> `public`.
-- Mismo patrón que `public.tienda_dns_plataforma` (20270205110000): configuración por entorno que carga el equipo técnico
-- por SQL; `authenticated` solo lee (la pantalla decide qué mostrar), sin política de escritura y `anon` sin privilegios.
-- No lleva `organizacion_id`: la bandera rige para todo el entorno (no es un dato de una organización).
--
-- Claves (todas APAGADAS por defecto):
--   promociones_precio : promociones visibles/aplicadas (precio promocional y tachado en la tienda pública, pantalla
--                        Promociones y alta/edición de promociones).
--   precios_masivos    : «Actualizar precios» (vista previa y aplicar).
-- Encender:  update public.banderas_plataforma set activa = true  where clave = 'promociones_precio';
-- Apagar:    update public.banderas_plataforma set activa = false where clave = 'promociones_precio';
-- `private.bandera_activa(clave)` devuelve false si la clave no existe: lo desconocido está apagado.
--
-- Migración aditiva. Reversión (migración posterior; la bandera encendida ya revierte el comportamiento sin migrar):
-- ORDEN: primero recrear SIN la bandera `private.promocion_vigente` (20270221100003), `guardar_promocion_precio`
-- (20270225100000), `previsualizar_actualizacion_precios` (20270223200100) y `aplicar_actualizacion_precios`
-- (20270221100008) y `public.capacidades_precios()` (se borra); solo después:
--   drop trigger banderas_plataforma_tocar on public.banderas_plataforma;
--   drop function private.tocar_bandera_plataforma();
--   drop function private.bandera_activa(text);
--   drop table public.banderas_plataforma;
-- Borrar `bandera_activa` antes de recrear esas funciones las rompería (dependen de ella).

create table if not exists public.banderas_plataforma (
  clave text primary key check (clave ~ '^[a-z][a-z0-9_]{0,62}$'),
  activa boolean not null default false,
  descripcion text not null,
  updated_at timestamptz not null default now()
);

comment on table public.banderas_plataforma is
  'MSF-363: banderas de apagado por entorno (apagadas por defecto). La carga y cambia el equipo técnico por SQL; sin secretos y sin política de escritura.';

alter table public.banderas_plataforma enable row level security;

drop policy if exists banderas_plataforma_select on public.banderas_plataforma;
create policy banderas_plataforma_select on public.banderas_plataforma
  for select to authenticated
  using (true);

revoke all on public.banderas_plataforma from public, anon, authenticated;
grant select on public.banderas_plataforma to authenticated;

create or replace function private.tocar_bandera_plataforma()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function private.tocar_bandera_plataforma() from public, anon, authenticated;

drop trigger if exists banderas_plataforma_tocar on public.banderas_plataforma;
create trigger banderas_plataforma_tocar
  before update on public.banderas_plataforma
  for each row execute function private.tocar_bandera_plataforma();

insert into public.banderas_plataforma (clave, activa, descripcion) values
  ('promociones_precio', false, 'Promociones de precio visibles y aplicadas (tienda pública, pantalla Promociones, alta y edición).'),
  ('precios_masivos', false, 'Actualización masiva de precios («Actualizar precios»): vista previa y aplicar.')
on conflict (clave) do nothing;

-- true solo si la bandera existe y está encendida. Sin acceso directo: la usan funciones security definer.
create or replace function private.bandera_activa(p_clave text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select b.activa from public.banderas_plataforma b where b.clave = p_clave), false);
$$;

revoke execute on function private.bandera_activa(text) from public, anon, authenticated;

comment on function private.bandera_activa(text) is
  'MSF-363: true si la bandera de plataforma existe y está encendida; una clave desconocida cuenta como apagada.';
