-- F-VTA-24 (épica MSF-145, spec 20261024-130000-ventas-motos, FR-002): tabla `dominio.envios_moto`,
-- el registro de los envíos con mensajería propia (motos): mensajero, guía, costo, abono y rendición.
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.envios_moto            dominio (nueva)      entidad de negocio del despacho de ventas, igual
--                                                        que `comprobantes_venta` y `formas_envio`. Nunca
--                                                        en `public`: no es un dato de plataforma.
--   dominio.comprobantes_venta     dominio (existente)  se referencia (FK compuesta): la factura enviada.
--                                                        La empresa del envío es la de su comprobante: no
--                                                        se duplica en `envios_moto`.
--   public.organizaciones          public (existente)   dueña multi-tenant.
--   public.registro_actividad      public (existente)   sin cambio: lo escriben las RPC (20270221100200).
--
-- Reglas del dato:
-- · UN envío por comprobante: `unique (organizacion_id, comprobante_id)`.
-- · `mensajero` es texto libre, obligatorio y NORMALIZADO (sin espacios sobrantes; la comparación y el
--   agrupado ignoran mayúsculas: `lower(mensajero)`). No hay tabla de mensajeros (decisión de producto 1).
-- · `guia` es opcional; si viene, sin espacios sobrantes.
-- · `costo_envio` y `abono` no nulos y `>= 0` (cero es válido), en `numeric(14,2)`.
-- · `rendido` y `rendido_en` son coherentes (check) y SOLO los escribe la RPC `rendir_envios_moto`
--   (20270221200100). Ninguna otra RPC ni escritura directa los toca. La reversión de una rendición
--   queda fuera de alcance.
-- · NO se escribe por escrito ni se borra: sin política ni grant de INSERT/UPDATE/DELETE. Escriben solo las
--   RPC `security definer` (20270221100200 y 20270221200100).
-- · `updated_at` es el bloqueo optimista de `actualizar_envio_moto`: lo avanza la RPC.
--
-- RLS: lectura por organización, empresa accesible (la del comprobante) y sección `ventas` en lectura o
-- edición. `anon` sin privilegios (la tabla nace sin grants).
--
-- VERSIONES: `tasks.md` nombra `20261205…`, por debajo de la cola ya aplicada en dokploy
-- (`20270220180000`); con ese número `supabase db push` las rechaza y el guard
-- `scripts/verificar-migraciones.mjs` las marca como REUSADAS. Se renumeraron a `20270221100100`,
-- `20270221100200` (F-VTA-24) y `20270221200100` (F-VTA-25). `tasks.md` es la spec compartida y no se edita.
--
-- Migración aditiva (tabla, función, índices y política nuevos). Reversión (en una migración posterior;
-- no se ejecuta en este PR; exportar antes los envíos ya cargados):
--   drop function if exists private.normalizar_mensajero(text);
--   drop table if exists dominio.envios_moto;

-- Normaliza el nombre del mensajero: sin espacios sobrantes en los bordes y con los espacios
-- internos repetidos colapsados a uno. La comparación sin mayúsculas se hace con `lower()`.
create or replace function private.normalizar_mensajero(p_mensajero text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(coalesce(p_mensajero, ''), '\s+', ' ', 'g'));
$$;

revoke execute on function private.normalizar_mensajero(text) from public, anon, authenticated;

comment on function private.normalizar_mensajero(text) is
  'Normaliza el mensajero de un envío en moto (F-VTA-24): sin espacios sobrantes ni repetidos. La comparación y el agrupado usan lower() sobre este valor. Solo la llaman las RPC de envíos en moto.';

create table if not exists dominio.envios_moto (
  id uuid primary key default gen_random_uuid(),
  -- La organización sale de la sesión: el llamador no la fija.
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  comprobante_id uuid not null,
  mensajero text not null
    check (btrim(mensajero) <> '' and length(mensajero) <= 100 and mensajero = btrim(mensajero)),
  guia text
    check (guia is null or (btrim(guia) <> '' and guia = btrim(guia) and length(guia) <= 100)),
  costo_envio numeric(14, 2) not null default 0 check (costo_envio >= 0),
  abono numeric(14, 2) not null default 0 check (abono >= 0),
  enviado boolean not null default false,
  -- Solo los escribe `rendir_envios_moto`.
  rendido boolean not null default false,
  rendido_en timestamptz,
  created_at timestamptz not null default now(),
  -- Bloqueo optimista de `actualizar_envio_moto`.
  updated_at timestamptz not null default now(),
  -- FK compuesta: el envío no puede apuntar a un comprobante de otra organización.
  foreign key (comprobante_id, organizacion_id)
    references dominio.comprobantes_venta (id, organizacion_id),
  -- Un envío por comprobante.
  unique (organizacion_id, comprobante_id),
  unique (id, organizacion_id),
  -- La rendición va entera o no va: rendido con fecha, no rendido sin fecha.
  constraint envios_moto_rendido_ck check (rendido or rendido_en is null),
  constraint envios_moto_rendido_en_ck check (not rendido or rendido_en is not null)
);

comment on table dominio.envios_moto is
  'Envíos con mensajería propia en moto (F-VTA-24): mensajero, guía, costo, abono y rendición de un comprobante. Sin escritura directa ni borrado; escriben las RPC registrar/actualizar/rendir_envios_moto.';
comment on column dominio.envios_moto.mensajero is
  'Texto libre normalizado (sin espacios sobrantes); se compara y agrupa sin distinguir mayúsculas. No hay tabla de mensajeros.';
comment on column dominio.envios_moto.abono is
  'Efectivo que el mensajero cobra al entregar («Abona al recibir»). El total de la rendición es la suma de este campo.';
comment on column dominio.envios_moto.costo_envio is
  'Costo del envío. Se muestra aparte en la rendición; no se resta del total.';
comment on column dominio.envios_moto.rendido is
  'Solo lo escribe la RPC rendir_envios_moto. No se revierte en esta épica.';
comment on column dominio.envios_moto.rendido_en is
  'Momento de la rendición; nulo mientras no está rendido. Solo lo escribe la RPC rendir_envios_moto.';
comment on column dominio.envios_moto.updated_at is
  'Bloqueo optimista de actualizar_envio_moto: la RPC lo avanza en cada escritura.';

-- Agrupar por mensajero sin distinguir mayúsculas (la rendición no mezcla mensajeros).
create index if not exists envios_moto_org_mensajero_idx
  on dominio.envios_moto (organizacion_id, lower(mensajero));
-- La tarjeta «Motos sin rendir» y el listado miran lo pendiente de rendir.
create index if not exists envios_moto_org_rendido_idx
  on dominio.envios_moto (organizacion_id, rendido, created_at desc);

-- ============================================================================
-- RLS (FR-002): lectura por organización, empresa accesible y sección ventas; sin escritura directa
-- ============================================================================

alter table dominio.envios_moto enable row level security;

drop policy if exists envios_moto_select on dominio.envios_moto;
create policy envios_moto_select on dominio.envios_moto
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    -- La empresa del envío es la de su comprobante.
    and exists (
      select 1
        from dominio.comprobantes_venta c
       where c.id = envios_moto.comprobante_id
         and c.organizacion_id = envios_moto.organizacion_id
         and c.empresa_id in (select private.empresas_accesibles())
    )
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
  );

-- ============================================================================
-- Grants: `anon` sin privilegios; `authenticated` solo lectura (escriben las RPC)
-- ============================================================================

grant usage on schema dominio to authenticated;

revoke all on dominio.envios_moto from public, anon, authenticated;

grant select on dominio.envios_moto to authenticated;
