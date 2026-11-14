-- MSF-176 · Tienda compra y cuentas, historia B2 «Presupuesto desde la tienda», T053. FR-054, FR-057, FR-058; amenazas 2.5, 2.6, 2.9, 2.11, 2.12.
--
-- Esquemas (Principio VII, re-verificado tabla por tabla):
--   * dominio.presupuestos_tienda (tabla NUEVA)                  -> `dominio`: registro del negocio atado a un comprobante de `dominio`: qué cuenta de
--                                                                   la tienda pidió qué presupuesto (idempotencia, topes por cuenta y trazabilidad para el
--                                                                   operador). No es identidad de plataforma: la cuenta (que sí vive en `public`) solo se referencia.
--   * private.siguiente_numero_comprobante_org(org, empresa, tipo) -> `private`: lógica de numeración con la organización EXPLÍCITA (no hay sesión de
--                                                                   panel). La de panel (`siguiente_numero_comprobante`) no se toca.
--
-- Seguridad de `dominio.presupuestos_tienda`:
--   * RLS por organización, empresa accesible y sección `ventas` >= lectura (igual que el listado de comprobantes del panel).
--   * `select` solo para `authenticated`; SIN políticas ni grants de escritura (la única escritura es `publico.crear_presupuesto_tienda`, `security definer`);
--     `anon` sin ningún privilegio. `service_role` opera la tabla como toda tabla operativa de `dominio`.
--   * FK compuestas con `organizacion_id`: un vínculo no puede apuntar a un comprobante, una empresa, un cliente ni una cuenta de otra organización,
--     y la cuenta debe ser de ESA empresa. Únicas `(cuenta_cliente_id, clave_envio)` (idempotencia: repetir una clave devuelve el mismo presupuesto) y
--     `(comprobante_id)` (un presupuesto, un vínculo).
--   * `nota` (<= 500): la nota opcional que escribió la persona. Los comprobantes no tienen dónde guardarla; se guarda acá y la ficha del comprobante la
--     muestra al operador como texto (desvío de la spec, que no la ubicaba: DER y contrato actualizados).
--
-- `private.siguiente_numero_comprobante_org(p_org, p_empresa, p_tipo) → integer`: el mismo `insert … on conflict do update` atómico que la de panel
--   (dos llamadas simultáneas = dos números distintos, sin saltos; si la transacción falla el contador revierte). Valida el tipo y que la empresa sea de la
--   organización. `security definer`, `search_path = ''`, SIN execute para la API (solo la llaman funciones `security definer` de la tienda).
--
-- DDL idempotente (`if [not] exists`). Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR):
--   drop function if exists private.siguiente_numero_comprobante_org(uuid, uuid, text);
--   drop table if exists dominio.presupuestos_tienda;   -- (los presupuestos creados son comprobantes de Ventas y se ANULAN con el flujo normal; no se borran)

create table if not exists dominio.presupuestos_tienda (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null,
  empresa_id uuid not null,
  cuenta_cliente_id uuid not null,
  cliente_id uuid not null,
  comprobante_id uuid not null,
  clave_envio uuid not null,
  nota text,
  creado_en timestamptz not null default now(),
  constraint presupuestos_tienda_nota_ck check (nota is null or (btrim(nota) <> '' and length(nota) <= 500)),
  constraint presupuestos_tienda_clave_uq unique (cuenta_cliente_id, clave_envio),
  constraint presupuestos_tienda_comprobante_uq unique (comprobante_id),
  constraint presupuestos_tienda_comprobante_fk
    foreign key (comprobante_id, organizacion_id)
    references dominio.comprobantes_venta (id, organizacion_id),
  constraint presupuestos_tienda_empresa_fk
    foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade,
  constraint presupuestos_tienda_cliente_fk
    foreign key (cliente_id, organizacion_id)
    references public.clientes (id, organizacion_id),
  -- La cuenta debe ser de ESTA empresa y de ESTA organización.
  constraint presupuestos_tienda_cuenta_fk
    foreign key (cuenta_cliente_id, organizacion_id, empresa_id)
    references public.cuentas_cliente (id, organizacion_id, empresa_id) on delete cascade
);

-- Topes por cuenta (5 por día, 10 abiertos): se cuentan por (cuenta, fecha de alta).
create index if not exists presupuestos_tienda_cuenta_fecha_idx on dominio.presupuestos_tienda (cuenta_cliente_id, creado_en desc);
create index if not exists presupuestos_tienda_organizacion_idx on dominio.presupuestos_tienda (organizacion_id);
create index if not exists presupuestos_tienda_empresa_idx on dominio.presupuestos_tienda (empresa_id, organizacion_id);
create index if not exists presupuestos_tienda_cliente_idx on dominio.presupuestos_tienda (cliente_id, organizacion_id);

comment on table dominio.presupuestos_tienda is
  'MSF-176 (B2): vínculo entre un presupuesto (comprobante de venta, canal tienda_online) y la cuenta web que lo pidió desde la tienda: idempotencia por (cuenta, clave_envio), topes por cuenta y trazabilidad. Solo lo escribe publico.crear_presupuesto_tienda (security definer); el panel lo lee con RLS por organización, empresa accesible y ventas.';
comment on column dominio.presupuestos_tienda.nota is
  'Nota opcional (<= 500) que escribió la persona al pedir el presupuesto. Texto plano: se muestra como texto, nunca como HTML.';

alter table dominio.presupuestos_tienda enable row level security;

drop policy if exists presupuestos_tienda_select on dominio.presupuestos_tienda;
create policy presupuestos_tienda_select on dominio.presupuestos_tienda
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
  );

revoke all on dominio.presupuestos_tienda from public, anon, authenticated;
grant select on dominio.presupuestos_tienda to authenticated;
-- service_role (API admin) opera la tabla como toda tabla operativa de dominio (pgTAP `service_role_privilegios`).
grant select, insert, update, delete on dominio.presupuestos_tienda to service_role;

-- ============================================================================
-- Numeración con la organización explícita (sin sesión de panel)
-- ============================================================================
create or replace function private.siguiente_numero_comprobante_org(p_org uuid, p_empresa uuid, p_tipo text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_numero integer;
begin
  if p_org is null or p_empresa is null then
    raise exception 'Falta la organización o la tienda' using errcode = '22023';
  end if;
  if p_tipo is null or p_tipo not in ('factura', 'presupuesto', 'nota_credito') then
    raise exception 'El tipo de comprobante no es válido' using errcode = '22023';
  end if;
  if not exists (select 1 from dominio.empresas e where e.id = p_empresa and e.organizacion_id = p_org) then
    raise exception 'La tienda no existe' using errcode = '22023';
  end if;

  insert into dominio.comprobantes_venta_numeracion as n (organizacion_id, empresa_id, tipo, ultimo)
  values (p_org, p_empresa, p_tipo, 1)
  on conflict (organizacion_id, empresa_id, tipo) do update set ultimo = n.ultimo + 1
  returning n.ultimo into v_numero;

  return v_numero;
end;
$$;

revoke execute on function private.siguiente_numero_comprobante_org(uuid, uuid, text) from public, anon, authenticated, service_role;

comment on function private.siguiente_numero_comprobante_org(uuid, uuid, text) is
  'MSF-176 (B2): siguiente número correlativo de un tipo de comprobante de una empresa, con la organización EXPLÍCITA (mismo insert … on conflict atómico que siguiente_numero_comprobante, que exige sesión de panel). Sin execute para la API: solo la llaman funciones security definer de la tienda.';
