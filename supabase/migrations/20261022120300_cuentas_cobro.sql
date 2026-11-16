-- F-VTA-03 (MSF-240, épica MSF-139): cuentas de cobro de la organización y su habilitación por empresa.
-- Esquemas (Principio VII), verificados tabla por tabla:
--   dominio.cuentas_cobro          dominio (nueva)     dato de negocio y sensible del producto: a dónde cobra la organización.
--   dominio.cuentas_cobro_empresas dominio (nueva)     relación del negocio («Disponible en»), junto a la cuenta.
--   dominio.empresas               dominio (existente) solo se referencia.
-- La cuenta es de la organización (no de una tienda) y se habilita por empresa. «No usar» = `activa = false`:
-- no se ofrece al cargar un comprobante pero conserva su historial; nada se borra (sin política ni grant DELETE).
--
-- Permisos: lectura con `ventas` ≥ lectura; escritura solo Administrador (`private.es_administrador_de`), en la
-- política y en las RPC. `anon` sin privilegios. La habilitación por empresa se escribe solo por las RPC
-- (security definer, en la misma transacción que la cuenta), nunca por grant directo.
-- La validación de CBU/CUIT y la actividad llegan en las migraciones 20261020120100 y 20261020120300.
--
-- Migración aditiva (tablas, índices, función, disparador y políticas nuevas).
-- Reversión (en una migración posterior, no en este PR; exportar antes los datos):
--   drop trigger cuentas_cobro_empresas_validar on dominio.cuentas_cobro_empresas;
--   drop function private.validar_cuenta_cobro_empresa();
--   drop table dominio.cuentas_cobro_empresas;
--   drop table dominio.cuentas_cobro;

create table dominio.cuentas_cobro (
  id uuid primary key default gen_random_uuid(),
  -- La organización sale de la sesión: el llamador no la fija (sin grant de columna).
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  nombre text not null check (btrim(nombre) <> '' and length(nombre) <= 120),
  titular text check (length(titular) <= 200),
  cuit text check (cuit ~ '^[0-9]{11}$'),
  banco text check (length(banco) <= 120),
  alias text check (length(alias) <= 60),
  cbu text check (cbu ~ '^[0-9]{22}$'),
  tipo text not null default 'cuenta_corriente'
    check (tipo in ('cuenta_corriente', 'caja_ahorro', 'billetera_virtual')),
  moneda text not null default 'ARS' check (moneda in ('ARS', 'USD')),
  orden integer not null default 0 check (orden >= 0),
  activa boolean not null default true,
  notas text check (length(notas) <= 2000),
  creado_en timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Habilita la FK compuesta de la habilitación por empresa y de los comprobantes futuros:
  -- no se puede apuntar a una cuenta de otra organización.
  unique (id, organizacion_id)
);

comment on table dominio.cuentas_cobro is
  'Cuentas de cobro de la organización (F-VTA-03). Se marca «No usar» (activa = false), no se borra: sin política DELETE. Dato sensible: lectura con Ventas, escritura solo Administrador.';
comment on column dominio.cuentas_cobro.cbu is
  'CBU/CVU: 22 dígitos con ambos dígitos verificadores (validado por disparador). Nunca va completo al registro de actividad.';
comment on column dominio.cuentas_cobro.cuit is
  'CUIT del titular: solo dígitos (11) con dígito verificador válido; se muestra como XX-XXXXXXXX-X.';

create index cuentas_cobro_org_orden_idx
  on dominio.cuentas_cobro (organizacion_id, orden, lower(nombre), id);

-- Habilitación por empresa («Disponible en»). PK compuesta: una cuenta no repite empresa.
create table dominio.cuentas_cobro_empresas (
  cuenta_id uuid not null references dominio.cuentas_cobro (id) on delete cascade,
  empresa_id uuid not null references dominio.empresas (id) on delete cascade,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (cuenta_id, empresa_id)
);

comment on table dominio.cuentas_cobro_empresas is
  'F-VTA-03: empresas donde está disponible una cuenta de cobro. Escritura solo por las RPC de cuentas de cobro; lectura por RLS de organización y sección ventas.';

create index cuentas_cobro_empresas_empresa_id_idx on dominio.cuentas_cobro_empresas (empresa_id);
create index cuentas_cobro_empresas_organizacion_id_idx on dominio.cuentas_cobro_empresas (organizacion_id);

-- La cuenta y la empresa deben ser de la organización de la fila: protege la tabla ante cualquier vía de escritura.
create or replace function private.validar_cuenta_cobro_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from dominio.cuentas_cobro c
    where c.id = new.cuenta_id and c.organizacion_id = new.organizacion_id
  ) then
    raise exception 'La cuenta de cobro no pertenece a la organización' using errcode = '23514';
  end if;
  if not exists (
    select 1 from dominio.empresas e
    where e.id = new.empresa_id and e.organizacion_id = new.organizacion_id
  ) then
    raise exception 'La empresa no pertenece a la organización' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function private.validar_cuenta_cobro_empresa() from public, anon, authenticated;

create trigger cuentas_cobro_empresas_validar
  before insert or update on dominio.cuentas_cobro_empresas
  for each row execute function private.validar_cuenta_cobro_empresa();

-- ============================================================================
-- RLS: lectura por organización y sección `ventas`; escritura solo Administrador; sin DELETE
-- ============================================================================

alter table dominio.cuentas_cobro enable row level security;

create policy cuentas_cobro_select on dominio.cuentas_cobro
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
  );

create policy cuentas_cobro_insert on dominio.cuentas_cobro
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.es_administrador_de(organizacion_id))
  );

create policy cuentas_cobro_update on dominio.cuentas_cobro
  for update to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.es_administrador_de(organizacion_id))
  )
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.es_administrador_de(organizacion_id))
  );

alter table dominio.cuentas_cobro_empresas enable row level security;

create policy cuentas_cobro_empresas_select on dominio.cuentas_cobro_empresas
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
  );

-- ============================================================================
-- Grants: `anon` sin privilegios, sin DELETE, columnas explícitas. El llamador no fija
-- `organizacion_id`, `creado_en` ni `updated_at`.
-- ============================================================================

grant usage on schema dominio to authenticated;

revoke all on dominio.cuentas_cobro, dominio.cuentas_cobro_empresas from public, anon, authenticated;

grant select on dominio.cuentas_cobro, dominio.cuentas_cobro_empresas to authenticated;
grant insert (id, nombre, titular, cuit, banco, alias, cbu, tipo, moneda, orden, activa, notas)
  on dominio.cuentas_cobro to authenticated;
grant update (nombre, titular, cuit, banco, alias, cbu, tipo, moneda, orden, activa, notas)
  on dominio.cuentas_cobro to authenticated;
