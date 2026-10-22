-- F-VTA-04 (MSF-251, épica MSF-139, spec 20261020-100000-ventas-catalogos-de-cobro-y-envio,
-- FR-016): transportes y terminales de retiro de la organización.
--
-- Esquemas (Principio VII), verificados tabla por tabla:
--   dominio.transportes           dominio (nueva)  catálogo del negocio de ventas y despacho
--                                                  (a quién se le entrega la mercadería); el
--                                                  transporte es de la organización, no de una
--                                                  tienda.
--   dominio.transportes_empresas  dominio (nueva)  «Empresas donde se usa»: relación N:M con
--                                                  dominio.empresas, junto a dominio.transportes.
--   dominio.empresas              dominio (existente) solo se referencia.
-- Las RPC viven en `public` (migración siguiente); el disparador de validación en `private`.
--
-- RLS: lectura por organización y sección `ventas` (lectura o edición); escritura solo del
-- Administrador (`private.es_administrador_de`). `dominio.transportes` NO tiene política ni grant
-- DELETE: se desactiva, no se borra. `dominio.transportes_empresas` sí admite DELETE del
-- Administrador porque la RPC reemplaza el conjunto de empresas (no guarda historia).
-- `anon` sin privilegios.
--
-- Migración aditiva (tablas, índices, función, disparadores y políticas nuevas).
-- Camino de reversión (migración posterior, no en este PR; exportar antes los datos):
--   drop trigger transportes_empresas_validar on dominio.transportes_empresas;
--   drop function private.validar_transporte_empresa();
--   drop trigger transportes_normalizar on dominio.transportes;
--   drop function private.normalizar_transporte();
--   drop table dominio.transportes_empresas;
--   drop table dominio.transportes;
-- El drop de las tablas se lleva los transportes cargados (dato nuevo de esta historia).

create table dominio.transportes (
  id uuid primary key default gen_random_uuid(),
  -- La organización sale de la sesión: el llamador no la fija.
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  nombre text not null check (btrim(nombre) <> '' and length(nombre) <= 200),
  tipo text not null check (tipo in ('expreso', 'correo', 'moto_propia')),
  -- Opcional (la moto propia no tiene); si viene, 11 dígitos con dígito verificador válido.
  cuit text check (cuit ~ '^[0-9]{11}$'),
  terminal_retiro text check (length(terminal_retiro) <= 300),
  localidad text check (length(localidad) <= 200),
  telefono text check (length(telefono) <= 50),
  correo text check (length(correo) <= 254),
  persona_contacto text check (length(persona_contacto) <= 200),
  direccion text check (length(direccion) <= 300),
  cobra_contrarreembolso boolean not null default false,
  comision_pct numeric(5, 2) not null default 0 check (comision_pct >= 0 and comision_pct <= 100),
  plazo_rendicion_dias integer not null default 0 check (plazo_rendicion_dias >= 0 and plazo_rendicion_dias <= 3650),
  orden integer not null default 0 check (orden >= 0 and orden <= 100000),
  activa boolean not null default true,
  creado_en timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Habilita la FK compuesta de transportes_empresas.
  unique (id, organizacion_id)
);

comment on table dominio.transportes is
  'Transportes y terminales de retiro de la organización (F-VTA-04). Se desactivan, no se borran: sin política DELETE. Escribe solo el Administrador; lee quien tenga la sección ventas.';
comment on column dominio.transportes.comision_pct is
  'Comisión del transporte por contrarreembolso, en % (0–100). Dato del catálogo; su uso al rendir es de despacho.';
comment on column dominio.transportes.plazo_rendicion_dias is
  'Días en que el transporte rinde lo cobrado (≥ 0). Dato del catálogo; su uso al rendir es de despacho.';

-- Nombre único por organización sin distinguir mayúsculas (incluye inactivos).
-- Lo reconoce esNombreRepetido (apps/web/src/lib/ventas/transportes.ts): si se renombra, actualizar allá.
create unique index transportes_organizacion_nombre_uq
  on dominio.transportes (organizacion_id, lower(btrim(nombre)));

create index transportes_org_orden_idx
  on dominio.transportes (organizacion_id, orden, lower(nombre), id);

-- Normaliza y valida al escribir: la base es la autoridad (también para llamadas directas).
-- `updated_at` avanza solo ante un cambio real de datos, así el bloqueo optimista no se rompe
-- por una escritura idempotente; si el llamador lo fija explícitamente (cambio solo de empresas)
-- se respeta.
-- `security definer`: llama a private.cuit_valido, que `authenticated` no puede ejecutar.
create or replace function private.normalizar_transporte()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.nombre := btrim(new.nombre);
  if new.nombre = '' then
    raise exception 'El nombre del transporte no puede estar vacío' using errcode = '23514';
  end if;

  if new.cuit is not null and new.cuit ~ '[^0-9\s.\-]' then
    raise exception 'El CUIT solo admite números (con o sin guiones)' using errcode = '22023';
  end if;
  new.cuit := nullif(regexp_replace(coalesce(new.cuit, ''), '[\s.\-]', '', 'g'), '');
  if new.cuit is not null then
    if length(new.cuit) <> 11 then
      raise exception 'El CUIT debe tener 11 dígitos' using errcode = '22023';
    end if;
    if not private.cuit_valido(new.cuit) then
      raise exception 'El CUIT no es válido: revisá el dígito verificador' using errcode = '22023';
    end if;
  end if;

  new.terminal_retiro := nullif(btrim(new.terminal_retiro), '');
  new.localidad := nullif(btrim(new.localidad), '');
  new.telefono := nullif(btrim(new.telefono), '');
  new.correo := nullif(btrim(new.correo), '');
  new.persona_contacto := nullif(btrim(new.persona_contacto), '');
  new.direccion := nullif(btrim(new.direccion), '');
  -- Misma regla que CORREO_VALIDO en apps/web/src/lib/ventas/transportes.ts: mantener alineadas.
  if new.correo is not null and new.correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo no tiene un formato válido' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' then
    if (new.nombre, new.tipo, new.cuit, new.terminal_retiro, new.localidad, new.telefono, new.correo,
        new.persona_contacto, new.direccion, new.cobra_contrarreembolso, new.comision_pct,
        new.plazo_rendicion_dias, new.orden, new.activa)
       is distinct from
       (old.nombre, old.tipo, old.cuit, old.terminal_retiro, old.localidad, old.telefono, old.correo,
        old.persona_contacto, old.direccion, old.cobra_contrarreembolso, old.comision_pct,
        old.plazo_rendicion_dias, old.orden, old.activa) then
      -- now() es constante en la transacción: sin esto dos cambios en la misma
      -- transacción repetirían updated_at y no avanzaría el bloqueo.
      new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.normalizar_transporte() from public, anon, authenticated;

create trigger transportes_normalizar
  before insert or update on dominio.transportes
  for each row execute function private.normalizar_transporte();

-- ============================================================================
-- «Empresas donde se usa». PK compuesta: un transporte no repite empresa.
-- ============================================================================

create table dominio.transportes_empresas (
  transporte_id uuid not null,
  empresa_id uuid not null references dominio.empresas (id) on delete cascade,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (transporte_id, empresa_id),
  -- Un transporte no puede relacionarse con filas de otra organización.
  foreign key (transporte_id, organizacion_id)
    references dominio.transportes (id, organizacion_id) on delete cascade
);

comment on table dominio.transportes_empresas is
  'F-VTA-04: empresas (tiendas) donde se usa cada transporte. Sin filas = «sin disponibilidad» (no se ofrece en ningún comprobante).';

-- Los FK en cascada buscan por estas columnas: sin índice serían scan completo.
create index transportes_empresas_empresa_id_idx on dominio.transportes_empresas (empresa_id);
create index transportes_empresas_organizacion_id_idx on dominio.transportes_empresas (organizacion_id);

-- La empresa debe ser de la organización de la fila (el FK compuesto ya ata el transporte).
create or replace function private.validar_transporte_empresa()
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
    raise exception 'La empresa no pertenece a la organización' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function private.validar_transporte_empresa() from public, anon, authenticated;

create trigger transportes_empresas_validar
  before insert or update on dominio.transportes_empresas
  for each row execute function private.validar_transporte_empresa();

-- ============================================================================
-- RLS (Principio I / VII): lectura por organización y sección `ventas`;
-- escritura solo del Administrador de la organización de la fila.
-- ============================================================================

alter table dominio.transportes enable row level security;
alter table dominio.transportes_empresas enable row level security;

create policy transportes_select on dominio.transportes
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
  );

create policy transportes_insert on dominio.transportes
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.es_administrador_de(organizacion_id))
  );

create policy transportes_update on dominio.transportes
  for update to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.es_administrador_de(organizacion_id))
  )
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.es_administrador_de(organizacion_id))
  );

create policy transportes_empresas_select on dominio.transportes_empresas
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
  );

create policy transportes_empresas_insert on dominio.transportes_empresas
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.es_administrador_de(organizacion_id))
  );

create policy transportes_empresas_delete on dominio.transportes_empresas
  for delete to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.es_administrador_de(organizacion_id))
  );

grant usage on schema dominio to authenticated;
revoke all on dominio.transportes from public, anon, authenticated;
revoke all on dominio.transportes_empresas from public, anon, authenticated;
grant select, insert, update on dominio.transportes to authenticated;
grant select, insert, delete on dominio.transportes_empresas to authenticated;
