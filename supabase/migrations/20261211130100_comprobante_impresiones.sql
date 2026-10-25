-- F-VTA-21 (MSF-256, épica MSF-213, spec 20261024-100000-ventas-impresion, FR-030): registro de cada impresión de un
-- documento de venta (factura, remito y, en F-VTA-20, presupuesto).
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   dominio.comprobante_impresiones   dominio  hecho de negocio del producto (quién imprimió qué y cuándo).
-- RLS: select por organización y nivel de `ventas` (lectura o edición) EN LA EMPRESA del comprobante, con el mismo
-- helper que la tabla de documentos (`private.puede_leer_documento_empresa`, 20261211120100). Sin grants ni políticas
-- de escritura para `authenticated`: se escribe solo por `public.registrar_impresion` (20261211130200, security
-- definer). `anon` sin acceso.
-- Append-only: ni `authenticated` ni `anon` tienen `update`/`delete`/`truncate`, y un trigger rechaza `update` y
-- `delete` directos incluso del dueño. La única baja posible es el borrado en cascada de la organización entera
-- (FK `on delete cascade`), que corre dentro de otro trigger (`pg_trigger_depth() > 1`).
--
-- Migración aditiva. Reversión (migración posterior; exportar antes si se quiere conservar el historial):
--   drop table dominio.comprobante_impresiones;
--   drop function private.impresiones_solo_agregar();

create table dominio.comprobante_impresiones (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null,
  comprobante_id uuid not null,
  tipo_documento text not null check (tipo_documento in ('factura', 'remito', 'presupuesto')),
  documento_id uuid not null references dominio.comprobante_documentos (id),
  -- Quién imprimió: el de la sesión. Si la cuenta se borra, la impresión se conserva sin nombre.
  impreso_por uuid references auth.users (id) on delete set null,
  impreso_en timestamptz not null default now(),
  -- Verdadero desde la segunda impresión del mismo documento del mismo comprobante (evento `comprobante.reimpreso`).
  reimpresion boolean not null default false,
  foreign key (empresa_id, organizacion_id) references dominio.empresas (id, organizacion_id),
  foreign key (comprobante_id, organizacion_id) references dominio.comprobantes_venta (id, organizacion_id)
);

comment on table dominio.comprobante_impresiones is
  'F-VTA-21: una fila por impresión de un documento de venta. Append-only; se escribe solo por public.registrar_impresion.';

create index comprobante_impresiones_comprobante_idx
  on dominio.comprobante_impresiones (organizacion_id, comprobante_id, tipo_documento, impreso_en desc);
create index comprobante_impresiones_empresa_idx
  on dominio.comprobante_impresiones (empresa_id, organizacion_id);
create index comprobante_impresiones_documento_idx
  on dominio.comprobante_impresiones (documento_id);

create or replace function private.impresiones_solo_agregar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- El borrado en cascada de una organización corre dentro del trigger de integridad referencial (profundidad > 1).
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'Las impresiones registradas no se modifican ni se borran' using errcode = '42501';
end;
$$;

revoke execute on function private.impresiones_solo_agregar() from public, anon, authenticated;

create trigger comprobante_impresiones_solo_agregar
  before update or delete on dominio.comprobante_impresiones
  for each row execute function private.impresiones_solo_agregar();

alter table dominio.comprobante_impresiones enable row level security;

create policy comprobante_impresiones_select on dominio.comprobante_impresiones
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.puede_leer_documento_empresa(empresa_id))
  );

revoke all on dominio.comprobante_impresiones from public, anon, authenticated;
grant select on dominio.comprobante_impresiones to authenticated;
