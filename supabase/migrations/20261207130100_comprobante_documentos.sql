-- F-VTA-19 (MSF-230, épica MSF-213, spec 20261024-100000-ventas-impresion, FR-003): pedidos de documentos
-- imprimibles de un comprobante (factura, remito y, en F-VTA-20, presupuesto) y su bucket privado.
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   dominio.comprobante_documentos   dominio  documento de venta generado (pedido, estado y archivo): entidad de
--                                             negocio del producto.
--   bucket `comprobantes-documentos` y sus políticas sobre `storage.objects`: infraestructura de plataforma
--                                             (patrón de `tienda-identidad` / `productos-imagenes`).
-- RLS: select por organización, sección `ventas` (lectura o edición) y empresa accesible. Sin políticas ni grants
-- de escritura para `authenticated`: se escribe solo por las RPC `security definer` (20261207130300) y por las
-- funciones del worker (20261207130200). `anon` sin acceso. El bucket es privado: el navegador lee con URL firmada
-- (política `select` acotada) y nadie con rol de usuario escribe; sube el worker con la clave de servicio.
--
-- Migración aditiva. Reversión (migración posterior; vaciar el bucket antes):
--   drop policy comprobantes_documentos_objetos_select on storage.objects;
--   delete from storage.buckets where id = 'comprobantes-documentos';   (tras vaciarlo)
--   drop table dominio.comprobante_documentos;

create table dominio.comprobante_documentos (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null,
  comprobante_id uuid not null,
  -- `presupuesto` lo habilita F-VTA-20 en la RPC; la tabla ya lo admite para no alterar la restricción después.
  tipo_documento text not null check (tipo_documento in ('factura', 'remito', 'presupuesto')),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'generado', 'fallido')),
  -- Ruta dentro del bucket: <organizacion>/<empresa>/<comprobante>/<documento>.pdf (solo si `generado`).
  ruta text,
  -- Motivo sanitizado y corto: nunca el detalle técnico (trazas, rutas, claves).
  error text check (error is null or length(error) <= 500),
  solicitado_por uuid references auth.users (id) on delete set null,
  solicitado_en timestamptz not null default now(),
  generado_en timestamptz,
  -- Ejecución del ciclo de workers (spec 016/019) que genera el PDF; sin FK para no atar el documento a su vida.
  ejecucion_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (empresa_id, organizacion_id) references dominio.empresas (id, organizacion_id),
  foreign key (comprobante_id, organizacion_id) references dominio.comprobantes_venta (id, organizacion_id),
  constraint comprobante_documentos_generado_ck check (
    (estado = 'generado' and ruta is not null and generado_en is not null)
    or (estado <> 'generado' and ruta is null)
  ),
  -- La ruta nunca sale de la carpeta del propio comprobante ni de otra organización o empresa.
  constraint comprobante_documentos_ruta_ck check (
    ruta is null or ruta = organizacion_id::text || '/' || empresa_id::text || '/' || comprobante_id::text || '/' || id::text || '.pdf'
  )
);

comment on table dominio.comprobante_documentos is
  'F-VTA-19: pedido de un documento imprimible (factura, remito) de un comprobante y su PDF generado por el worker comprobantes-pdf. Se escribe solo por RPC y funciones del worker.';
comment on column dominio.comprobante_documentos.error is
  'Motivo sanitizado del fallo; el detalle técnico no se guarda ni se muestra.';

-- No puede haber dos pedidos pendientes del mismo comprobante y tipo (FR-005): el doble clic es un solo pedido.
create unique index if not exists comprobante_documentos_pendiente_uq
  on dominio.comprobante_documentos (comprobante_id, tipo_documento)
  where estado = 'pendiente';

create index if not exists comprobante_documentos_comprobante_idx
  on dominio.comprobante_documentos (organizacion_id, comprobante_id, tipo_documento, estado);
create index if not exists comprobante_documentos_empresa_idx
  on dominio.comprobante_documentos (empresa_id, organizacion_id);

alter table dominio.comprobante_documentos enable row level security;

create policy comprobante_documentos_select on dominio.comprobante_documentos
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
    and empresa_id in (select private.empresas_accesibles())
  );

revoke all on dominio.comprobante_documentos from public, anon, authenticated;
grant select on dominio.comprobante_documentos to authenticated;

-- ============================================================================
-- Bucket privado `comprobantes-documentos`
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes-documentos', 'comprobantes-documentos', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists comprobantes_documentos_objetos_select on storage.objects;

-- Solo lectura para la app, acotada a la organización, a `ventas` y a las empresas accesibles. Sin políticas de
-- insert/update/delete: el único que escribe es el worker, con la clave de servicio (que no pasa por RLS).
create policy comprobantes_documentos_objetos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'comprobantes-documentos'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.nivel_seccion('ventas')) in ('lectura', 'edicion')
    and (storage.foldername(name))[2] in (select e::text from private.empresas_accesibles() e)
  );
