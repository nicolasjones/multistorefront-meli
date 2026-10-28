-- F-VTA-12 (MSF-389, épica MSF-195, spec 20261024-150000-ventas-cobros-y-conciliacion, FR-001):
-- tabla de cobros por comprobante (parciales o totales) de una factura.
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.cobros_comprobante   dominio (nueva)  el cobro de un documento de venta: entidad de
--                                                 negocio del producto (dinero que entra), nunca
--                                                 `public`. Guarda también la aprobación de la
--                                                 conciliación (F-VTA-13) en columnas nulables.
--   dominio.comprobantes_venta   dominio (existente) se referencia (FK compuesta).
--   dominio.empresas              dominio (existente) se referencia (FK compuesta).
--   dominio.formas_pago          dominio (existente) se referencia (FK compuesta).
--   dominio.cuentas_cobro         dominio (existente) se referencia (FK compuesta, nulable).
--   public.organizaciones         public (existente)  dueña multi-tenant.
--
-- Reglas del dato:
-- · `importe` > 0 con dos decimales: un cobro de 0 o negativo es un error de carga, no un cobro.
-- · `cuenta_cobro_id` es NULABLE: el efectivo no va a ninguna cuenta.
-- · `origen` ∈ ('manual', 'contrarreembolso'): 'contrarreembolso' lo usa F-VTA-14.
-- · Un cobro NO se borra ni se edita (salvo la aprobación): es un libro de dinero. Sin política
--   ni grant de INSERT/UPDATE/DELETE: escribe solo la RPC `security definer` de cobros
--   (`private.registrar_cobro_interno`, migración 20270114100200) y, más adelante, la de
--   conciliación (F-VTA-13).
-- · `registrado_por`/`aprobado_por` guardan el uuid y una foto del nombre: el historial sobrevive
--   a la cuenta de la persona (mismo criterio que `dominio.movimientos_stock.actor_id`).
--
-- RLS (FR-001): lectura por organización, empresa accesible y sección `ventas` (lectura o edición).
-- `anon` sin privilegios.
--
-- VERSIONES: las cinco migraciones de esta historia usan la banda `20270114100000`…`20270114100400`
-- (tabla → saldo y lectura → registro interno → RPC pública → lectura del permiso). Es una banda
-- **nueva y mayor** a propósito: con los números que nombra `tasks.md` (`20261209100…`) quedaban
-- por debajo de la cola ya aplicada en dokploy (`20270112150000`) y `supabase db push` las rechaza
-- («found local migration files to be inserted before the last migration on remote database»); el
-- guard `scripts/verificar-migraciones.mjs` lo marca como «versión REUSADA». F-VTA-13 usa
-- `20270114110000`…, F-VTA-14 `20270114120000`… y el cierre reconcilia en `20270114130000`.
--
-- Migración aditiva. Reversión (en una migración posterior; no se ejecuta en este PR; exportar
-- antes los cobros ya cargados):
--   drop trigger cobros_comprobante_validar on dominio.cobros_comprobante;
--   drop function private.validar_cobro_comprobante();
--   drop table dominio.cobros_comprobante;
--   drop index dominio.formas_pago_id_organizacion_uq;

-- Habilita la FK compuesta de la forma de pago: una forma no puede apuntar a otra organización.
create unique index if not exists formas_pago_id_organizacion_uq
  on dominio.formas_pago (id, organizacion_id);

create table dominio.cobros_comprobante (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  -- La empresa (tienda) es la del comprobante: el cobro nunca es de otra tienda.
  empresa_id uuid not null,
  comprobante_id uuid not null,
  -- Un cobro siempre vale algo: cero o negativo es un error de carga (FR-003).
  importe numeric(14, 2) not null check (importe > 0),
  forma_pago_id uuid not null,
  -- Nulo para el efectivo y las formas que no van a una cuenta bancaria.
  cuenta_cobro_id uuid,
  -- 'manual' lo registra una persona; 'contrarreembolso', el transporte (F-VTA-14).
  origen text not null default 'manual' check (origen in ('manual', 'contrarreembolso')),
  -- Sin FK a auth.users: el cobro sobrevive a la baja de la cuenta que lo registró.
  registrado_por uuid not null,
  registrado_por_nombre text not null check (length(registrado_por_nombre) <= 200),
  registrado_en timestamptz not null default now(),
  -- La conciliación (F-VTA-13) los completa; mientras tanto quedan nulos.
  aprobado_por uuid,
  aprobado_por_nombre text check (length(aprobado_por_nombre) <= 200),
  aprobado_en timestamptz,
  -- Bloqueo optimista de la conciliación (F-VTA-13).
  actualizado_en timestamptz not null default now(),
  -- La aprobación va entera o no va: nunca a medias.
  constraint cobros_comprobante_aprobacion_ck check (
    (aprobado_por is null and aprobado_por_nombre is null and aprobado_en is null)
    or (aprobado_por is not null and aprobado_por_nombre is not null and aprobado_en is not null)
  ),
  -- FK compuestas: el cobro no puede apuntar a otra organización (ni a otra empresa, ni a otra
  -- forma de pago, ni a otra cuenta de cobro).
  foreign key (comprobante_id, organizacion_id)
    references dominio.comprobantes_venta (id, organizacion_id),
  foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id),
  foreign key (forma_pago_id, organizacion_id)
    references dominio.formas_pago (id, organizacion_id),
  foreign key (cuenta_cobro_id, organizacion_id)
    references dominio.cuentas_cobro (id, organizacion_id),
  unique (id, organizacion_id)
);

comment on table dominio.cobros_comprobante is
  'Cobros (parciales o totales) de una factura (F-VTA-12). Libro de dinero: sin escritura directa ni borrado; escribe la RPC de cobros. Guarda la conciliación en columnas nulables (F-VTA-13).';
comment on column dominio.cobros_comprobante.cuenta_cobro_id is
  'Cuenta de cobro del pago: nula si la forma de pago no exige cuenta (efectivo).';
comment on column dominio.cobros_comprobante.registrado_por_nombre is
  'Foto del nombre de quien registró el cobro: el historial sobrevive a la baja de la cuenta.';
comment on column dominio.cobros_comprobante.aprobado_en is
  'Momento de la conciliación contra el extracto (F-VTA-13). Nulo mientras no se aprueba.';

-- Saldo y lectura por comprobante: el índice que usa `private.saldo_comprobante`.
create index if not exists cobros_comprobante_comprobante_idx
  on dominio.cobros_comprobante (comprobante_id, registrado_en desc);
create index if not exists cobros_comprobante_org_empresa_idx
  on dominio.cobros_comprobante (organizacion_id, empresa_id, registrado_en desc);
-- Conciliación (F-VTA-13): solo los cobros con cuenta de cobro.
create index if not exists cobros_comprobante_cuenta_idx
  on dominio.cobros_comprobante (cuenta_cobro_id, registrado_en desc)
  where cuenta_cobro_id is not null;

-- ============================================================================
-- Integridad del cobro (defensa ante cualquier vía de escritura)
-- ============================================================================
-- El comprobante, la forma de pago y la cuenta de cobro tienen que ser los de la empresa del
-- cobro. Solo en el INSERT: después el cobro es inmutable y la conciliación (F-VTA-13) solo
-- mueve `aprobado_*`; si la cuenta se desactiva después, el cobro ya registrado se conserva.

create or replace function private.validar_cobro_comprobante()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from dominio.comprobantes_venta c
     where c.id = new.comprobante_id
       and c.organizacion_id = new.organizacion_id
  ) then
    raise exception 'El comprobante no es de la organización del cobro' using errcode = '23514';
  end if;

  if not exists (
    select 1 from dominio.comprobantes_venta c
     where c.id = new.comprobante_id
       and c.empresa_id = new.empresa_id
  ) then
    raise exception 'El comprobante no es de la empresa del cobro' using errcode = '23514';
  end if;

  if not exists (
    select 1 from dominio.formas_pago f
     where f.id = new.forma_pago_id
       and f.organizacion_id = new.organizacion_id
       and f.empresa_id = new.empresa_id
  ) then
    raise exception 'La forma de pago no es de la empresa del cobro' using errcode = '23514';
  end if;

  if not exists (
    select 1 from dominio.formas_pago f
     where f.id = new.forma_pago_id and f.activo
  ) then
    raise exception 'La forma de pago está desactivada' using errcode = '23514';
  end if;

  if new.cuenta_cobro_id is not null then
    if not exists (
      select 1 from dominio.cuentas_cobro c
       where c.id = new.cuenta_cobro_id
         and c.organizacion_id = new.organizacion_id
    ) then
      raise exception 'La cuenta de cobro no es de la organización del cobro' using errcode = '23514';
    end if;
    if not exists (
      select 1 from dominio.cuentas_cobro c
       where c.id = new.cuenta_cobro_id and c.activa
    ) then
      raise exception 'La cuenta de cobro está marcada «No usar»' using errcode = '23514';
    end if;
    if not exists (
      select 1 from dominio.cuentas_cobro_empresas ce
       where ce.cuenta_id = new.cuenta_cobro_id
         and ce.empresa_id = new.empresa_id
         and ce.organizacion_id = new.organizacion_id
    ) then
      raise exception 'La cuenta de cobro no está habilitada en la empresa del cobro'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function private.validar_cobro_comprobante() from public, anon, authenticated;

create trigger cobros_comprobante_validar
  before insert on dominio.cobros_comprobante
  for each row execute function private.validar_cobro_comprobante();

-- ============================================================================
-- RLS (FR-001): lectura por organización y empresa accesible; sin escritura directa
-- ============================================================================

alter table dominio.cobros_comprobante enable row level security;

create policy cobros_comprobante_select on dominio.cobros_comprobante
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
  );

-- ============================================================================
-- Grants: `anon` sin privilegios; `authenticated` solo lectura (escribe la RPC)
-- ============================================================================

grant usage on schema dominio to authenticated;

revoke all on dominio.cobros_comprobante from public, anon, authenticated;

grant select on dominio.cobros_comprobante to authenticated;
