-- F-VTA-01 (MSF-210, épica MSF-139, spec 20261020-100000-ventas-catalogos-de-cobro-y-envio, FR-001):
-- formas de pago por empresa. Catálogo que el comprobante de venta (MSF-159) ofrecerá al cobrar.
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.formas_pago   dominio (nueva)      regla de negocio del producto (qué cobros acepta
--                                              cada tienda), no un dato de plataforma.
--   dominio.empresas      dominio (existente)  solo se referencia.
-- Las RPC viven en `public` (migración 20261020100100).
--
-- RLS: lectura por organización, empresa accesible y sección `ventas` (lectura o edición);
-- escritura solo del Administrador de la organización (o superadmin con organización activa).
-- Sin política ni grant de DELETE: se desactiva, no se borra. `anon` sin privilegios.
--
-- Migración aditiva (tabla, índices, función y disparador nuevos). Camino de reversión
-- (migración posterior; no se ejecuta en este PR):
--   drop trigger formas_pago_normalizar on dominio.formas_pago;
--   drop function private.normalizar_forma_pago();
--   drop table dominio.formas_pago;   -- se lleva los datos cargados (dato nuevo de este PR)

create table dominio.formas_pago (
  id uuid primary key default gen_random_uuid(),
  -- La organización sale de la sesión: el llamador no la fija (sin grant de columna).
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null references dominio.empresas (id) on delete cascade,
  nombre text not null check (btrim(nombre) <> '' and length(nombre) <= 100),
  tipo text not null
    check (tipo in ('efectivo', 'transferencia', 'contrarreembolso', 'tarjeta', 'otro')),
  exige_cuenta_cobro boolean not null default false,
  genera_deuda boolean not null default false,
  estado_inicial text not null default 'pendiente'
    check (estado_inicial in ('pendiente', 'aceptado', 'cobrado', 'deuda')),
  orden integer not null default 1 check (orden between 0 and 9999),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table dominio.formas_pago is
  'F-VTA-01: formas de pago de cada empresa (tienda). Se desactiva, no se borra: sin política DELETE. Escritura solo del Administrador (RPC crear/actualizar/cambiar_estado_forma_pago).';
comment on column dominio.formas_pago.estado_inicial is
  'Estado con el que se crea el comprobante al elegir esta forma de pago: pendiente, aceptado, cobrado o deuda.';

-- Un nombre por empresa, sin distinguir mayúsculas; en otra empresa puede repetirse.
-- Nombre del índice: lo reconoce esNombreRepetido (apps/web/src/lib/ventas/formasPago.ts).
create unique index formas_pago_empresa_nombre_key
  on dominio.formas_pago (empresa_id, lower(nombre));
create index formas_pago_organizacion_id_idx on dominio.formas_pago (organizacion_id);

-- Normaliza al escribir (la base es la autoridad). `updated_at` avanza solo ante un cambio
-- real, así una escritura idempotente no rompe el bloqueo optimista. Valida además que la
-- empresa sea de la organización de la fila (defensa ante cualquier vía de escritura).
create or replace function private.normalizar_forma_pago()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.nombre := btrim(new.nombre);
  if new.nombre = '' then
    raise exception 'El nombre no puede estar vacío' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if not exists (
      select 1 from dominio.empresas e
      where e.id = new.empresa_id and e.organizacion_id = new.organizacion_id
    ) then
      raise exception 'La empresa no pertenece a la organización' using errcode = '23514';
    end if;
  else
    if (new.nombre, new.tipo, new.exige_cuenta_cobro, new.genera_deuda, new.estado_inicial,
        new.orden, new.activo)
       is not distinct from
       (old.nombre, old.tipo, old.exige_cuenta_cobro, old.genera_deuda, old.estado_inicial,
        old.orden, old.activo) then
      new.updated_at := old.updated_at;
    else
      -- now() es constante en la transacción: sin esto dos cambios en la misma
      -- transacción repetirían updated_at y no avanzaría el bloqueo.
      new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.normalizar_forma_pago() from public, anon, authenticated;

create trigger formas_pago_normalizar
  before insert or update on dominio.formas_pago
  for each row execute function private.normalizar_forma_pago();

-- ============================================================================
-- RLS (FR-001): sin DELETE
-- ============================================================================

alter table dominio.formas_pago enable row level security;

create policy formas_pago_select on dominio.formas_pago
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
  );

create policy formas_pago_insert on dominio.formas_pago
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (select private.es_administrador_de(organizacion_id))
  );

create policy formas_pago_update on dominio.formas_pago
  for update to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (select private.es_administrador_de(organizacion_id))
  )
  with check (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (select private.es_administrador_de(organizacion_id))
  );

-- ============================================================================
-- Grants: `anon` sin privilegios, sin DELETE, columnas explícitas. El llamador no fija
-- `organizacion_id`, `created_at` ni `updated_at`; la empresa no se cambia al editar.
-- ============================================================================

grant usage on schema dominio to authenticated;

revoke all on dominio.formas_pago from public, anon, authenticated;

grant select on dominio.formas_pago to authenticated;
grant insert (empresa_id, nombre, tipo, exige_cuenta_cobro, genera_deuda, estado_inicial, orden, activo)
  on dominio.formas_pago to authenticated;
grant update (nombre, tipo, exige_cuenta_cobro, genera_deuda, estado_inicial, orden, activo)
  on dominio.formas_pago to authenticated;
