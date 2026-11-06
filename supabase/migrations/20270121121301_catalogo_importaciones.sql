-- MSF-375 (F-CAT-10, épica MSF-202): importación de productos desde CSV. Tablas, bucket temporal de
-- imágenes y capacidad del worker. Las RPC viven en las migraciones siguientes.
--
-- Esquemas (Principio VII), verificados objeto por objeto:
--   dominio.importaciones_productos        dominio (nueva)  una importación: estado, totales, clave de
--                                                           idempotencia, ejecución del worker. Dato del producto.
--   dominio.importaciones_productos_filas  dominio (nueva)  filas ya validadas (carga útil del worker) y su resultado.
--   storage `productos-importaciones`      Storage          bucket temporal de imágenes (no es tabla).
--   public.organizaciones / public.conexiones / public.capacidades_ejecucion: existentes (plataforma).
--
-- RLS: lectura solo para el Administrador de la organización; sin políticas de escritura para
-- `authenticated` (escriben las RPC `security definer` y el worker); `anon` sin privilegios.
--
-- Migración aditiva. Reversión (migración posterior, nunca en este PR; exportar antes los datos):
--   drop table dominio.importaciones_productos_filas;
--   drop table dominio.importaciones_productos;
--   drop function private.capacidad_importacion_productos();
--   drop function private.codigo_tienda(text);
--   delete from storage.objects where bucket_id = 'productos-importaciones';
--   delete from storage.buckets where id = 'productos-importaciones';

-- ============================================================================
-- dominio.importaciones_productos
-- ============================================================================

create table dominio.importaciones_productos (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  -- Idempotencia (FR-107, Decisión 10): la misma clave devuelve la misma importación. También es
  -- el prefijo (bajo la organización) de las imágenes en el bucket temporal.
  clave uuid not null,
  solicitante uuid not null,
  estado text not null default 'en_cola' check (estado in ('en_cola', 'aplicando', 'terminada', 'fallida')),
  -- El costo solo se escribe si quien importó tenía edición en Rentabilidad al solicitar (FR-106).
  con_costo boolean not null default false,
  total_filas integer not null check (total_filas between 1 and 2000),
  importables integer not null check (importables >= 0),
  procesadas integer not null default 0 check (procesadas >= 0),
  omitidas integer not null default 0 check (omitidas >= 0),
  -- Ejecución del worker (public.ejecuciones_worker, plataforma). Nula mientras otra importación
  -- de la organización está en curso (FR-109: se serializan).
  ejecucion_id uuid,
  mensaje_fallo text check (length(mensaje_fallo) <= 500),
  creada_en timestamptz not null default now(),
  iniciada_en timestamptz,
  terminada_en timestamptz,
  unique (organizacion_id, clave),
  unique (id, organizacion_id)
);

comment on table dominio.importaciones_productos is
  'Importación de productos desde CSV (F-CAT-10). Sin escritura para authenticated: la crean solicitar_importacion_productos y la cierra el worker.';

create index importaciones_productos_org_idx on dominio.importaciones_productos (organizacion_id, creada_en desc);
create unique index importaciones_productos_ejecucion_uidx
  on dominio.importaciones_productos (ejecucion_id) where ejecucion_id is not null;

-- ============================================================================
-- dominio.importaciones_productos_filas
-- ============================================================================

create table dominio.importaciones_productos_filas (
  id uuid primary key default gen_random_uuid(),
  importacion_id uuid not null,
  organizacion_id uuid not null,
  -- Número de fila en el archivo (el encabezado es la 1).
  fila integer not null check (fila >= 2),
  sku text not null default '' check (length(sku) <= 200),
  accion text not null check (accion in ('nuevo', 'actualiza')),
  -- Resultado de validar al solicitar: lo que se mostró en la vista previa.
  validacion text not null check (validacion in ('ok', 'aviso', 'error')),
  validacion_mensaje text not null default '' check (length(validacion_mensaje) <= 1000),
  carga jsonb not null,
  resultado text not null default 'pendiente' check (resultado in ('pendiente', 'aplicada', 'omitida')),
  resultado_mensaje text not null default '' check (length(resultado_mensaje) <= 1000),
  producto_id uuid,
  aplicada_en timestamptz,
  foreign key (importacion_id, organizacion_id)
    references dominio.importaciones_productos (id, organizacion_id) on delete cascade,
  unique (importacion_id, fila)
);

comment on table dominio.importaciones_productos_filas is
  'Filas de una importación de productos (F-CAT-10): carga validada y resultado por fila. Sin escritura para authenticated.';

create index importaciones_productos_filas_pendientes_idx
  on dominio.importaciones_productos_filas (importacion_id, fila) where resultado = 'pendiente';

-- ============================================================================
-- RLS: solo lectura, solo Administrador de la organización
-- ============================================================================

alter table dominio.importaciones_productos enable row level security;
alter table dominio.importaciones_productos_filas enable row level security;

create policy importaciones_productos_select on dominio.importaciones_productos
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.es_administrador_de(organizacion_id))
  );

create policy importaciones_productos_filas_select on dominio.importaciones_productos_filas
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.es_administrador_de(organizacion_id))
  );

revoke all on dominio.importaciones_productos, dominio.importaciones_productos_filas
  from public, anon, authenticated;
grant select on dominio.importaciones_productos, dominio.importaciones_productos_filas to authenticated;

-- ============================================================================
-- Bucket temporal de imágenes: <organizacion_id>/<clave de la importación>/<archivo>
-- Sube y borra solo el Administrador de la organización; lo lee además el worker con la clave
-- de servicio del servidor (nunca en el navegador). JPG/PNG/WebP de hasta 2 MB (FR-103).
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'productos-importaciones', 'productos-importaciones', false, 2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create policy productos_importaciones_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'productos-importaciones'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.es_administrador_de((select private.organizacion_id())))
  );

create policy productos_importaciones_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'productos-importaciones'
    and array_length(storage.foldername(name), 1) = 2
    and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.es_administrador_de((select private.organizacion_id())))
  );

create policy productos_importaciones_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'productos-importaciones'
    and (storage.foldername(name))[1] = (select private.organizacion_id())::text
    and (select private.es_administrador_de((select private.organizacion_id())))
  );

-- ============================================================================
-- Código corto de una tienda (columna `tiendas`, FR-103): iniciales de cada palabra; una palabra
-- toda en mayúsculas (de 2+ letras) entra completa. «San Javucho» → SJ · «Mundo JC» → MJC.
-- ============================================================================

create or replace function private.codigo_tienda(p_nombre text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(string_agg(
    case when length(t.w) > 1 and t.w = upper(t.w) and t.w ~ '[A-Z]' then t.w else upper(left(t.w, 1)) end, '' order by t.n
  ), '')
  from regexp_split_to_table(btrim(coalesce(p_nombre, '')), '\s+') with ordinality as t(w, n)
  where t.w <> '';
$$;

revoke execute on function private.codigo_tienda(text) from public, anon;
grant execute on function private.codigo_tienda(text) to authenticated;

-- ============================================================================
-- Capacidad `importar-productos`: una por organización, creada de forma perezosa al primer uso.
-- Cuelga de la conexión `importar-productos` de la organización (mismo patrón que el historial de
-- ventas, MSF-293): la ejecución es auditable y `iniciar_ejecucion_worker` rechaza una segunda
-- ejecución simultánea (la serialización de FR-109 la resuelve solicitar_importacion_productos).
-- ============================================================================

create or replace function private.capacidad_importacion_productos()
returns table (conexion_id uuid, clave_capacidad text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_conexion uuid;
begin
  if v_org is null or not (select private.es_administrador_de(v_org)) then
    raise exception 'NO_AUTORIZADO: solo el Administrador importa productos' using errcode = '42501';
  end if;

  insert into public.sistemas_externos (id, descripcion)
  values ('importar-productos', 'Importación de productos desde CSV, sin sistema externo real')
  on conflict (id) do nothing;

  select c.id into v_conexion
  from public.conexiones c
  where c.organizacion_id = v_org and c.sistema_externo = 'importar-productos'
  order by c.created_at desc
  limit 1;
  if v_conexion is null then
    raise exception 'SIN_CONEXION_IMPORTACION: la organización no tiene habilitada la importación de productos'
      using errcode = 'P0001';
  end if;

  insert into public.capacidades_ejecucion (organizacion_id, conexion_id, clave, tiempo_max_seg)
  values (v_org, v_conexion, 'importar-productos', 3600)
  on conflict on constraint capacidades_ejecucion_conexion_id_clave_key do nothing;

  return query select v_conexion, 'importar-productos'::text;
end;
$$;

comment on function private.capacidad_importacion_productos() is
  'F-CAT-10: conexión importar-productos de la organización de la sesión y su capacidad (se crea al primer uso). Solo Administrador.';

revoke execute on function private.capacidad_importacion_productos() from public, anon;
grant execute on function private.capacidad_importacion_productos() to authenticated;
