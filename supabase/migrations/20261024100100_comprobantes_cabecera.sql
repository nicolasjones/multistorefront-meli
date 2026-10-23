-- F-VTA-05 (MSF-273, épica MSF-159, spec 20261023-100000-ventas-comprobantes, FR-002, FR-003, FR-005):
-- cabecera del comprobante de venta (factura / presupuesto).
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.comprobantes_venta  dominio (existente, F-CLI-08)  documento de venta: entidad de negocio.
--                                                              Se altera solo de forma aditiva.
--   dominio.empresas            dominio (existente)            solo se le agrega un índice único para la FK compuesta.
-- RLS vigente (select por organización y sección `ventas`). Sin políticas ni grants de escritura:
-- se escribe solo por las RPC `security definer` de 20261024100400. `anon` sin acceso (ya revocado).
--
-- Notas de diseño:
--  · Las columnas son nulables o con default: las filas de F-CLI-08 siguen válidas (sin empresa, canal ni operador).
--  · `forma_pago_id` y `envio_id` guardan solo la elección (FR-005). Los catálogos son de MSF-139 y todavía no
--    existen en esta base: no se declara FK; las RPC validan la pertenencia cuando el catálogo exista
--    (`private.validar_catalogo_comprobante`). La FK se agrega en una migración posterior a MSF-139.
--  · `numero_entero` guarda el correlativo aparte de `numero` (texto con formato) para poder cambiar el
--    formato sin migrar datos (Decisiones abiertas 1).
--
-- Migración aditiva. Reversión (en una migración posterior; exportar antes los datos si Ventas ya escribe):
--   drop index dominio.comprobantes_venta_numero_uq;
--   drop index dominio.comprobantes_venta_empresa_fecha_idx;
--   alter table dominio.comprobantes_venta
--     drop constraint comprobantes_venta_empresa_fk,
--     drop constraint comprobantes_venta_canal_ck,
--     drop constraint comprobantes_venta_valido_hasta_ck,
--     drop column empresa_id, drop column canal, drop column operador_id, drop column valido_hasta,
--     drop column forma_pago_id, drop column envio_id, drop column confirmado_en,
--     drop column confirmado_por, drop column numero_entero, drop column updated_at;
--   drop index dominio.empresas_id_organizacion_uq;

-- Habilita la FK compuesta: un comprobante no puede apuntar a una empresa de otra organización.
create unique index if not exists empresas_id_organizacion_uq
  on dominio.empresas (id, organizacion_id);

alter table dominio.comprobantes_venta
  add column if not exists empresa_id uuid,
  add column if not exists canal text,
  add column if not exists operador_id uuid references auth.users (id) on delete set null,
  add column if not exists valido_hasta date,
  add column if not exists forma_pago_id uuid,
  add column if not exists envio_id uuid,
  add column if not exists confirmado_en timestamptz,
  add column if not exists confirmado_por uuid references auth.users (id) on delete set null,
  add column if not exists numero_entero integer check (numero_entero is null or numero_entero > 0),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'comprobantes_venta_empresa_fk' and conrelid = 'dominio.comprobantes_venta'::regclass
  ) then
    alter table dominio.comprobantes_venta
      add constraint comprobantes_venta_empresa_fk
      foreign key (empresa_id, organizacion_id) references dominio.empresas (id, organizacion_id);
  end if;
  -- Mercado Libre queda para la Etapa 2: no es un canal válido todavía.
  if not exists (
    select 1 from pg_constraint
    where conname = 'comprobantes_venta_canal_ck' and conrelid = 'dominio.comprobantes_venta'::regclass
  ) then
    alter table dominio.comprobantes_venta
      add constraint comprobantes_venta_canal_ck
      check (canal is null or canal in ('mostrador', 'tienda_online', 'telefono_whatsapp'));
  end if;
  -- «Válido hasta» solo existe en presupuesto y no es anterior a la fecha.
  if not exists (
    select 1 from pg_constraint
    where conname = 'comprobantes_venta_valido_hasta_ck' and conrelid = 'dominio.comprobantes_venta'::regclass
  ) then
    alter table dominio.comprobantes_venta
      add constraint comprobantes_venta_valido_hasta_ck
      check (valido_hasta is null or (tipo = 'presupuesto' and valido_hasta >= fecha));
  end if;
end
$$;

-- Un número por organización, empresa y tipo (FR-004). Las filas sin empresa (F-CLI-08) no entran en la regla.
create unique index if not exists comprobantes_venta_numero_uq
  on dominio.comprobantes_venta (organizacion_id, empresa_id, tipo, numero)
  where empresa_id is not null;

create index if not exists comprobantes_venta_empresa_fecha_idx
  on dominio.comprobantes_venta (organizacion_id, empresa_id, fecha desc);

comment on column dominio.comprobantes_venta.empresa_id is
  'Tienda dueña del comprobante (F-VTA-05). No cambia una vez creado.';
comment on column dominio.comprobantes_venta.numero_entero is
  'Correlativo por organización, empresa y tipo; `numero` es su formato visible (provisorio: 8 dígitos).';
comment on column dominio.comprobantes_venta.forma_pago_id is
  'Forma de pago elegida (catálogo de MSF-139). Solo la elección; sin FK hasta que el catálogo exista en la base.';
comment on column dominio.comprobantes_venta.envio_id is
  'Forma de envío elegida (catálogo de MSF-139). Solo la elección; sin FK hasta que el catálogo exista en la base.';
comment on column dominio.comprobantes_venta.updated_at is
  'Bloqueo optimista de `guardar_comprobante`: la RPC lo avanza en cada escritura.';

-- RLS y grants intactos: select por organización y sección `ventas`; anon sin acceso; sin escritura directa.
