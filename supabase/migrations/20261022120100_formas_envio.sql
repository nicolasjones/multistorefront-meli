-- F-VTA-02 (MSF-225, épica MSF-139, spec 20261020-100000-ventas-catalogos-de-cobro-y-envio, FR-006):
-- formas de envío por empresa. Catálogo que el comprobante de venta (MSF-159) ofrecerá al despachar.
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.formas_envio  dominio (nueva)      regla de negocio del producto (cómo despacha
--                                              cada tienda), no un dato de plataforma.
--   dominio.empresas      dominio (existente)  solo se referencia.
-- Las RPC viven en `public` (migración 20261021164300).
--
-- RLS: lectura por organización, empresa accesible y sección `ventas` (lectura o edición);
-- escritura solo del Administrador de la organización (o superadmin con organización activa).
-- Sin política ni grant de DELETE: se desactiva, no se borra. `anon` sin privilegios.
--
-- Migración aditiva (tabla, índices, función y disparador nuevos). Camino de reversión
-- (migración posterior; no se ejecuta en este PR):
--   drop trigger formas_envio_normalizar on dominio.formas_envio;
--   drop function private.normalizar_forma_envio();
--   drop table dominio.formas_envio;   -- se lleva los datos cargados (dato nuevo de este PR)

create table dominio.formas_envio (
  id uuid primary key default gen_random_uuid(),
  -- La organización sale de la sesión: el llamador no la fija (sin grant de columna).
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null references dominio.empresas (id) on delete cascade,
  nombre text not null check (btrim(nombre) <> '' and length(nombre) <= 100),
  tipo text not null
    check (tipo in ('retiro_local', 'correo', 'expreso', 'moto', 'terminal')),
  exige_transporte_guia boolean not null default false,
  -- ARS; nulo = sin costo por defecto (la lista muestra «—»).
  costo_defecto numeric(12, 2) check (costo_defecto is null or costo_defecto >= 0),
  estado_despacho_inicial text not null default 'sin_armar'
    check (estado_despacho_inicial in ('sin_armar', 'armando', 'listo_para_despachar')),
  orden integer not null default 1 check (orden between 0 and 9999),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table dominio.formas_envio is
  'F-VTA-02: formas de envío de cada empresa (tienda). Se desactiva, no se borra: sin política DELETE. Escritura solo del Administrador (RPC crear/actualizar/cambiar_estado_forma_envio).';
comment on column dominio.formas_envio.estado_despacho_inicial is
  'Estado con el que entra el pedido al tablero de despacho al elegir esta forma de envío: sin_armar, armando o listo_para_despachar.';

-- Un nombre por empresa, sin distinguir mayúsculas; en otra empresa puede repetirse.
-- Es la única restricción 23505 de la tabla: apps/web/src/lib/ventas/formasEnvio.ts la traduce por código.
create unique index IF NOT EXISTS formas_envio_empresa_nombre_key
  on dominio.formas_envio (empresa_id, lower(nombre));
create index IF NOT EXISTS formas_envio_organizacion_id_idx on dominio.formas_envio (organizacion_id);

-- Normaliza al escribir (la base es la autoridad). `updated_at` avanza solo ante un cambio
-- real, así una escritura idempotente no rompe el bloqueo optimista. Valida además que la
-- empresa sea de la organización de la fila (defensa ante cualquier vía de escritura).
create or replace function private.normalizar_forma_envio()
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
    if (new.nombre, new.tipo, new.exige_transporte_guia, new.costo_defecto, new.estado_despacho_inicial,
        new.orden, new.activo)
       is not distinct from
       (old.nombre, old.tipo, old.exige_transporte_guia, old.costo_defecto, old.estado_despacho_inicial,
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

revoke execute on function private.normalizar_forma_envio() from public, anon, authenticated;

create trigger formas_envio_normalizar
  before insert or update on dominio.formas_envio
  for each row execute function private.normalizar_forma_envio();

-- ============================================================================
-- RLS (FR-001): sin DELETE
-- ============================================================================

alter table dominio.formas_envio enable row level security;

create policy formas_envio_select on dominio.formas_envio
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
  );

create policy formas_envio_insert on dominio.formas_envio
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (select private.es_administrador_de(organizacion_id))
  );

create policy formas_envio_update on dominio.formas_envio
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

revoke all on dominio.formas_envio from public, anon, authenticated;

grant select on dominio.formas_envio to authenticated;
grant insert (empresa_id, nombre, tipo, exige_transporte_guia, costo_defecto, estado_despacho_inicial, orden, activo)
  on dominio.formas_envio to authenticated;
grant update (nombre, tipo, exige_transporte_guia, costo_defecto, estado_despacho_inicial, orden, activo)
  on dominio.formas_envio to authenticated;
