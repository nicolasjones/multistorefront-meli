-- F-SVC-02 (MSF-283, épica MSF-182): reparaciones de Service técnico.
-- Esquema (Principio VII): `dominio.reparaciones` es la entidad de negocio central del producto
-- (el trabajo de taller) → `dominio`, nunca `public`.
--
-- Seguridad:
--   * RLS por organización y nivel de `service_tecnico` (select `lectura`/`edicion`).
--   * SIN políticas ni grants de insert/update/delete: todas las escrituras pasan por las RPC
--     `security definer` de F-SVC-02/03 (numeración, estado inicial, historial y actividad van en
--     la misma transacción). La reparación no se borra: se anula (F-SVC-03).
--   * Los costos internos NO tienen `select` directo: se leen con `public.obtener_reparacion`, que
--     los enmascara sin la acción `ver_costos`. `anon` sin privilegios.
--
-- Migración aditiva (tabla, índices, disparadores y políticas nuevas).
-- Reversión (migración posterior, no en este PR; exportar antes los datos):
--   drop trigger reparaciones_a_normalizar on dominio.reparaciones;
--   drop trigger reparaciones_a_validar on dominio.reparaciones;
--   drop function private.normalizar_reparacion();
--   drop function private.validar_reparacion();
--   drop table dominio.reparaciones;

create table dominio.reparaciones (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  -- Tienda. La pertenencia a la organización la valida el disparador (`dominio.empresas` no
  -- tiene clave compuesta con la organización).
  empresa_id uuid not null references dominio.empresas (id),
  numero integer not null check (numero > 0),
  cliente_id uuid not null,
  contacto text not null default '' check (length(contacto) <= 200),
  modelo_id uuid not null,
  estado_id uuid not null,
  numero_serie text check (numero_serie is null or length(numero_serie) <= 100),
  accesorios text not null default '' check (length(accesorios) <= 500),
  falla text not null default '' check (length(falla) <= 1000),
  -- Costos internos del taller, en ARS sin IVA. Solo con la acción `ver_costos` (FR-021).
  costo_mano_obra numeric(12, 2) not null default 0 check (costo_mano_obra >= 0),
  costo_repuestos numeric(12, 2) not null default 0 check (costo_repuestos >= 0),
  tecnico_id uuid references auth.users (id) on delete set null,
  ingreso_en date not null,
  entrega_prevista date,
  entrega_real date,
  entregado_por text check (entregado_por is null or length(entregado_por) <= 200),
  anulada_en timestamptz,
  anulada_motivo text check (anulada_motivo is null or length(anulada_motivo) <= 500),
  creado_en timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reparaciones_numero_por_empresa_key unique (empresa_id, numero),
  -- Habilita las FK compuestas del historial: no se apunta a una reparación ajena.
  constraint reparaciones_id_organizacion_key unique (id, organizacion_id),
  constraint reparaciones_cliente_fk foreign key (cliente_id, organizacion_id)
    references public.clientes (id, organizacion_id),
  constraint reparaciones_modelo_fk foreign key (modelo_id, organizacion_id)
    references dominio.modelos_equipo (id, organizacion_id),
  constraint reparaciones_estado_fk foreign key (estado_id, organizacion_id)
    references dominio.estados_reparacion (id, organizacion_id),
  constraint reparaciones_entrega_prevista_check
    check (entrega_prevista is null or entrega_prevista >= ingreso_en),
  constraint reparaciones_anulacion_completa_check
    check ((anulada_en is null) = (anulada_motivo is null))
);

comment on table dominio.reparaciones is
  'Reparaciones de Service técnico (F-SVC-02). Sin delete: se anulan. Escritura solo por RPC; costos solo vía obtener_reparacion.';
comment on column dominio.reparaciones.costo_mano_obra is
  'Costo interno en ARS sin IVA. Sin select directo: lo devuelve obtener_reparacion solo con ver_costos.';
comment on column dominio.reparaciones.numero is
  'Correlativo por empresa asignado por private.siguiente_numero_reparacion; se presenta como R-0001.';

create index IF NOT EXISTS reparaciones_org_empresa_idx on dominio.reparaciones (organizacion_id, empresa_id);
create index IF NOT EXISTS reparaciones_cliente_idx on dominio.reparaciones (cliente_id);
create index IF NOT EXISTS reparaciones_modelo_idx on dominio.reparaciones (modelo_id);
create index IF NOT EXISTS reparaciones_estado_idx on dominio.reparaciones (estado_id);
create index IF NOT EXISTS reparaciones_tecnico_idx on dominio.reparaciones (tecnico_id) where tecnico_id is not null;

-- Coherencia que las FK no cubren: la tienda y el técnico son de la organización de la fila.
create or replace function private.validar_reparacion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from dominio.empresas e
    where e.id = new.empresa_id and e.organizacion_id = new.organizacion_id
  ) then
    raise exception 'La tienda no pertenece a la organización' using errcode = '23514';
  end if;
  if new.tecnico_id is not null and not exists (
    select 1 from public.usuarios_organizacion u
    where u.user_id = new.tecnico_id and u.organizacion_id = new.organizacion_id
  ) then
    raise exception 'El técnico no pertenece a la organización' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function private.validar_reparacion() from public, anon, authenticated;

create trigger reparaciones_a_validar
  before insert or update on dominio.reparaciones
  for each row execute function private.validar_reparacion();

-- Normaliza, protege los costos y mantiene `updated_at` (bloqueo optimista) solo ante un cambio
-- real. Los costos solo los puede fijar quien tiene `ver_costos` (FR-021); sin sesión
-- (`auth.uid()` nulo: migraciones, sembrados) no se aplica el control.
create or replace function private.normalizar_reparacion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_costos_cambian boolean;
begin
  new.contacto := btrim(coalesce(new.contacto, ''));
  new.accesorios := btrim(coalesce(new.accesorios, ''));
  new.falla := btrim(coalesce(new.falla, ''));
  new.numero_serie := nullif(btrim(coalesce(new.numero_serie, '')), '');
  new.costo_mano_obra := round(new.costo_mano_obra, 2);
  new.costo_repuestos := round(new.costo_repuestos, 2);

  if v_actor is not null then
    if tg_op = 'INSERT' then
      v_costos_cambian := new.costo_mano_obra <> 0 or new.costo_repuestos <> 0;
    else
      v_costos_cambian := (new.costo_mano_obra, new.costo_repuestos)
                          is distinct from (old.costo_mano_obra, old.costo_repuestos);
    end if;
    if v_costos_cambian and not (select private.puede_accion('service_tecnico', 'ver_costos')) then
      raise exception 'Tu rol no puede cargar costos internos' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'updated_at') is not distinct from (to_jsonb(old) - 'updated_at') then
      new.updated_at := old.updated_at;
    else
      new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.normalizar_reparacion() from public, anon, authenticated;

create trigger reparaciones_a_normalizar
  before insert or update on dominio.reparaciones
  for each row execute function private.normalizar_reparacion();

-- RLS por organización y nivel; sin insert/update/delete (FR-011).
alter table dominio.reparaciones enable row level security;

create policy reparaciones_select on dominio.reparaciones
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('service_tecnico')) in ('lectura', 'edicion')
  );

grant usage on schema dominio to authenticated;

revoke all on dominio.reparaciones from public, anon, authenticated;

-- Todas las columnas salvo los costos internos.
grant select (
  id, organizacion_id, empresa_id, numero, cliente_id, contacto, modelo_id, estado_id, numero_serie,
  accesorios, falla, tecnico_id, ingreso_en, entrega_prevista, entrega_real, entregado_por,
  anulada_en, anulada_motivo, creado_en, updated_at
) on dominio.reparaciones to authenticated;
