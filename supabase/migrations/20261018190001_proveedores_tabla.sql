-- F-PRV-01 (MSF-336, épica MSF-205): tabla de proveedores con CUIT validado.
-- Esquema (Principio VII): `dominio.proveedores` es una entidad del negocio del
-- producto (a quién se le compra), no de la plataforma → `dominio`, nunca `public`.
-- Proveedores es una sección compartida entre empresas: el proveedor pertenece a la
-- organización, no a una tienda.
--
-- El CUIT se normaliza y valida en la base (disparador), no solo en el formulario:
-- solo dígitos, 11 dígitos, dígito verificador módulo 11, único por organización
-- (incluye inactivos). Se desactiva, no se borra: sin política DELETE ni grant DELETE.
--
-- Migración aditiva (tabla, índices, funciones, disparador y políticas nuevas).
-- Reversión (en una migración posterior, no en este PR; exportar antes los datos):
--   drop trigger proveedores_normalizar on dominio.proveedores;
--   drop function private.normalizar_proveedor();
--   drop function private.cuit_valido(text);
--   drop table dominio.proveedores;

-- ============================================================================
-- Validación del CUIT (módulo 11) — mismos vectores que apps/web/src/lib/cuit.ts
-- ============================================================================

create or replace function private.cuit_valido(p_cuit text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_pesos int[] := array[5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  v_suma int := 0;
  v_resto int;
  v_digito int;
  i int;
begin
  if p_cuit is null or p_cuit !~ '^[0-9]{11}$' then
    return false;
  end if;
  for i in 1..10 loop
    v_suma := v_suma + substr(p_cuit, i, 1)::int * v_pesos[i];
  end loop;
  v_resto := v_suma % 11;
  v_digito := case when v_resto = 0 then 0 else 11 - v_resto end;
  -- Resto 1 daría dígito 10: no existe como dígito, el CUIT es inválido.
  return v_digito <= 9 and v_digito = substr(p_cuit, 11, 1)::int;
end;
$$;

revoke execute on function private.cuit_valido(text) from public, anon, authenticated;

-- ============================================================================
-- dominio.proveedores (FR-001, FR-002)
-- ============================================================================

create table dominio.proveedores (
  id uuid primary key default gen_random_uuid(),
  -- La organización sale de la sesión: el llamador no la fija (sin grant de columna).
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  razon_social text not null check (btrim(razon_social) <> '' and length(razon_social) <= 200),
  cuit text not null check (cuit ~ '^[0-9]{11}$'),
  persona_contacto text check (length(persona_contacto) <= 200),
  correo text check (length(correo) <= 254),
  telefono text check (length(telefono) <= 50),
  direccion text check (length(direccion) <= 300),
  observaciones text check (length(observaciones) <= 2000),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Habilita la FK compuesta de productos (F-PRV-03): no se puede apuntar a un
  -- proveedor de otra organización.
  unique (id, organizacion_id),
  -- Incluye los desactivados: el CUIT identifica al proveedor fiscalmente.
  -- Nombre por defecto `proveedores_organizacion_id_cuit_key`: lo reconoce esCuitRepetido (apps/web/src/lib/proveedores.ts).
  unique (organizacion_id, cuit)
);

comment on table dominio.proveedores is
  'Proveedores de la organización (F-PRV-01). Se desactiva, no se borra: sin política DELETE.';
comment on column dominio.proveedores.cuit is
  'Solo dígitos (11) con dígito verificador válido; se muestra como XX-XXXXXXXX-X.';

create index proveedores_org_razon_social_idx
  on dominio.proveedores (organizacion_id, lower(razon_social), id);

-- Normaliza y valida al escribir: la base es la autoridad (también para llamadas
-- directas). `updated_at` avanza solo ante un cambio real, así el bloqueo optimista
-- no se rompe por una escritura idempotente.
-- `security definer`: el disparador llama a private.cuit_valido, que `authenticated` no puede ejecutar.
create or replace function private.normalizar_proveedor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.razon_social := btrim(new.razon_social);
  if new.razon_social = '' then
    raise exception 'La razón social no puede estar vacía' using errcode = '23514';
  end if;

  if new.cuit is not null and new.cuit ~ '[^0-9\s.\-]' then
    raise exception 'El CUIT solo admite números (con o sin guiones)' using errcode = '22023';
  end if;
  new.cuit := regexp_replace(coalesce(new.cuit, ''), '[\s.\-]', '', 'g');
  if length(new.cuit) <> 11 then
    raise exception 'El CUIT debe tener 11 dígitos' using errcode = '22023';
  end if;
  if not private.cuit_valido(new.cuit) then
    raise exception 'El CUIT no es válido: revisá el dígito verificador' using errcode = '22023';
  end if;

  new.persona_contacto := nullif(btrim(new.persona_contacto), '');
  new.correo := nullif(btrim(new.correo), '');
  new.telefono := nullif(btrim(new.telefono), '');
  new.direccion := nullif(btrim(new.direccion), '');
  new.observaciones := nullif(btrim(new.observaciones), '');
  -- Misma regla que CORREO_VALIDO en apps/web/src/lib/proveedores.ts: mantener alineadas.
  if new.correo is not null and new.correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo no tiene un formato válido' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' then
    if (new.razon_social, new.cuit, new.persona_contacto, new.correo, new.telefono,
        new.direccion, new.observaciones, new.activo)
       is not distinct from
       (old.razon_social, old.cuit, old.persona_contacto, old.correo, old.telefono,
        old.direccion, old.observaciones, old.activo) then
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

revoke execute on function private.normalizar_proveedor() from public, anon, authenticated;

create trigger proveedores_normalizar
  before insert or update on dominio.proveedores
  for each row execute function private.normalizar_proveedor();

-- ============================================================================
-- RLS por organización y sección `proveedores`; sin DELETE (FR-001)
-- ============================================================================

alter table dominio.proveedores enable row level security;

create policy proveedores_select on dominio.proveedores
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('proveedores')) in ('lectura', 'edicion')
  );

create policy proveedores_insert on dominio.proveedores
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('proveedores')) = 'edicion'
  );

create policy proveedores_update on dominio.proveedores
  for update to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('proveedores')) = 'edicion'
  )
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('proveedores')) = 'edicion'
  );

-- ============================================================================
-- Grants: `anon` sin privilegios, sin DELETE, columnas explícitas. El llamador no
-- fija `organizacion_id`, `creado_en` ni `updated_at`.
-- ============================================================================

grant usage on schema dominio to authenticated;

revoke all on dominio.proveedores from public, anon, authenticated;

grant select on dominio.proveedores to authenticated;
grant insert (id, razon_social, cuit, persona_contacto, correo, telefono, direccion, observaciones)
  on dominio.proveedores to authenticated;
grant update (razon_social, cuit, persona_contacto, correo, telefono, direccion, observaciones, activo)
  on dominio.proveedores to authenticated;
