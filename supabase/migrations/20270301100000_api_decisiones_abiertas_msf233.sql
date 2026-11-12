-- F-API-01 (MSF-233): cierre de las cuatro decisiones que dejaron abiertas las revisiones QA y Código/Seguridad.
--
-- 1. `api_leer_precios` recorría y agrupaba TODOS los productos de la organización en cada página. Ahora solo agrupa los
--    candidatos que pueden caer en la página (producto o alguna escala tocados desde el cursor / `actualizado_desde`),
--    con un índice por (organización, updated_at, producto) en las escalas. La sincronización incremental pasa a costar
--    lo que cambió; una carga completa inicial sigue leyendo el catálogo (no hay columna materializada de «último cambio»).
-- 2. `creada_por` de claves y suscripciones ya no borra la clave o la suscripción cuando se elimina a la persona que la
--    creó (`on delete set null`): la integración del cliente no se corta por una baja de usuario. Además, borrar una
--    suscripción por CUALQUIER vía (también por cascada de organización o de usuario) borra su secreto de Vault.
-- 3. Tope por organización: 50 claves vigentes (100 al rotar) y 20 suscripciones. Un administrador (o un script) no puede crear sin límite.
--    La purga diaria borra además las claves revocadas o vencidas hace más de 90 días (la tabla no crecía sin cota).
-- 4. El decodificado del cursor estaba repetido en cuatro funciones: ahora vive en `private.api_cursor_partes`. De paso, un
--    cursor de stock con un tercer valor que no es un uuid devuelve CURSOR_INVALIDO (400) en vez de un error interno.
--
-- Migración aditiva. Reversión (en una migración posterior): volver a las definiciones de
-- 20270224110203_api_lectura.sql y 20270224110201/20270224110204 (crear_*), y
--   drop index if exists public.api_suscripciones_secreto_vault_uidx;
--   drop trigger if exists api_suscripciones_borrar_secreto on public.api_suscripciones;
--   drop function if exists private.api_borrar_secreto_suscripcion();
--   drop function if exists private.api_cursor_partes(text, integer);
--   drop index if exists dominio.producto_precios_escala_org_updated_idx;
--   (y volver a `on delete cascade` en las dos claves foráneas `creada_por`; antes de `alter column creada_por set not null`
--   hay que rellenar o borrar las filas que ya quedaron con `creada_por` nulo).

-- ============================================================================
-- 4. Cursor: una sola función de decodificado.
-- ============================================================================

create or replace function private.api_cursor_partes(p_cursor text, p_partes integer)
returns table (fecha timestamptz, id uuid, extra uuid)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_clave text;
  v_partes text[];
begin
  select d.p_clave into v_clave from private.api_decodificar_cursor(p_cursor) d;
  if v_clave is null then
    return;
  end if;

  v_partes := string_to_array(v_clave, '|');
  if array_length(v_partes, 1) is distinct from p_partes then
    raise exception 'CURSOR_INVALIDO' using errcode = '22023';
  end if;

  begin
    fecha := timestamptz 'epoch' + v_partes[1]::numeric * interval '1 microsecond';
    id := v_partes[2]::uuid;
    extra := case when p_partes = 3 then v_partes[3]::uuid end;
  exception when others then
    raise exception 'CURSOR_INVALIDO' using errcode = '22023';
  end;

  return next;
end;
$$;

comment on function private.api_cursor_partes(text, integer) is
  'F-API-01: decodifica el cursor de paginación (fecha, id y, si son 3 partes, un uuid extra). CURSOR_INVALIDO (22023) si no coincide.';

revoke execute on function private.api_cursor_partes(text, integer) from public, anon, authenticated;

create or replace function private.api_leer_productos(
  p_organizacion_id uuid,
  p_cursor text,
  p_limite integer,
  p_actualizado_desde timestamptz
)
returns table (filas jsonb, siguiente_cursor text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limite integer := coalesce(p_limite, 50);
  v_fecha timestamptz;
  v_id uuid;
  v_filas jsonb;
  v_siguiente text;
begin
  if v_limite < 1 or v_limite > 100 then
    raise exception 'LIMITE_INVALIDO' using errcode = '22023';
  end if;

  select c.fecha, c.id into v_fecha, v_id from private.api_cursor_partes(p_cursor, 2) c;

  with pagina as (
    select p.id, p.nombre, p.sku, p.activo, p.categoria_id,
      (select private.ruta_categoria(p.categoria_id)) as categoria,
      p.moneda, p.precio_lista, p.updated_at as actualizado_en
      from dominio.productos p
     where p.organizacion_id = p_organizacion_id
       and (p_actualizado_desde is null or p.updated_at >= p_actualizado_desde)
       and (v_id is null or (p.updated_at, p.id) > (v_fecha, v_id))
     order by p.updated_at, p.id
     limit v_limite + 1
  ), recortada as (
    select * from pagina limit v_limite
  )
  select
    coalesce((select jsonb_agg(to_jsonb(r) order by r.actualizado_en, r.id) from recortada r), '[]'::jsonb),
    case
      when (select count(*) from pagina) > v_limite then
        (select private.api_codificar_cursor(r.actualizado_en, r.id)
           from recortada r order by r.actualizado_en desc, r.id desc limit 1)
      else null
    end
  into v_filas, v_siguiente;

  return query select v_filas, v_siguiente;
end;
$$;

create or replace function private.api_leer_stock(
  p_organizacion_id uuid,
  p_cursor text,
  p_limite integer,
  p_actualizado_desde timestamptz
)
returns table (filas jsonb, siguiente_cursor text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limite integer := coalesce(p_limite, 50);
  v_fecha timestamptz;
  v_id uuid;
  v_deposito uuid;
  v_filas jsonb;
  v_siguiente text;
begin
  if v_limite < 1 or v_limite > 100 then
    raise exception 'LIMITE_INVALIDO' using errcode = '22023';
  end if;

  select c.fecha, c.id, c.extra into v_fecha, v_id, v_deposito from private.api_cursor_partes(p_cursor, 3) c;

  with pagina as (
    select e.producto_id, pr.nombre, pr.sku, e.deposito_id, dep.nombre as deposito,
      e.cantidad, e.reservado, e.cantidad - e.reservado as disponible,
      e.updated_at as actualizado_en
      from dominio.existencias_deposito e
      join dominio.productos pr
        on pr.id = e.producto_id and pr.organizacion_id = e.organizacion_id
      join dominio.depositos dep
        on dep.id = e.deposito_id and dep.organizacion_id = e.organizacion_id
     where e.organizacion_id = p_organizacion_id
       and (p_actualizado_desde is null or e.updated_at >= p_actualizado_desde)
       and (v_id is null or (e.updated_at, e.producto_id, e.deposito_id) > (v_fecha, v_id, v_deposito))
     order by e.updated_at, e.producto_id, e.deposito_id
     limit v_limite + 1
  ), recortada as (
    select * from pagina limit v_limite
  )
  select
    coalesce((select jsonb_agg(to_jsonb(r) order by r.actualizado_en, r.producto_id, r.deposito_id) from recortada r), '[]'::jsonb),
    case
      when (select count(*) from pagina) > v_limite then
        (select private.api_codificar_cursor(r.actualizado_en, r.producto_id, r.deposito_id)
           from recortada r order by r.actualizado_en desc, r.producto_id desc, r.deposito_id desc limit 1)
      else null
    end
  into v_filas, v_siguiente;

  return query select v_filas, v_siguiente;
end;
$$;

create or replace function private.api_leer_ventas(
  p_organizacion_id uuid,
  p_cursor text,
  p_limite integer,
  p_actualizado_desde timestamptz
)
returns table (filas jsonb, siguiente_cursor text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limite integer := coalesce(p_limite, 50);
  v_fecha timestamptz;
  v_id uuid;
  v_filas jsonb;
  v_siguiente text;
begin
  if v_limite < 1 or v_limite > 100 then
    raise exception 'LIMITE_INVALIDO' using errcode = '22023';
  end if;

  select c.fecha, c.id into v_fecha, v_id from private.api_cursor_partes(p_cursor, 2) c;

  with pagina as (
    select c.id, c.numero, c.fecha, c.empresa_id, c.total_sin_iva, c.total_con_iva, c.estado,
      c.confirmado_en
      from dominio.comprobantes_venta c
     where c.organizacion_id = p_organizacion_id
       and c.tipo = 'factura'
       -- Confirmada (con `confirmado_en`) y no anulada, en cualquier estado posterior: una factura confirmada que pasa a
       -- cobrado, deuda, aceptado, en proceso o armando sigue siendo una venta y NO desaparece de la API.
       and c.confirmado_en is not null
       and c.estado <> 'anulada'
       and (p_actualizado_desde is null or c.confirmado_en >= p_actualizado_desde)
       and (v_id is null or (c.confirmado_en, c.id) > (v_fecha, v_id))
     order by c.confirmado_en, c.id
     limit v_limite + 1
  ), recortada as (
    select * from pagina limit v_limite
  )
  select
    coalesce((select jsonb_agg(to_jsonb(r) order by r.confirmado_en, r.id) from recortada r), '[]'::jsonb),
    case
      when (select count(*) from pagina) > v_limite then
        (select private.api_codificar_cursor(r.confirmado_en, r.id)
           from recortada r order by r.confirmado_en desc, r.id desc limit 1)
      else null
    end
  into v_filas, v_siguiente;

  return query select v_filas, v_siguiente;
end;
$$;

-- ============================================================================
-- 1. Precios: solo agrupa los candidatos de la página.
-- ============================================================================

create index if not exists producto_precios_escala_org_updated_idx
  on dominio.producto_precios_escala (organizacion_id, updated_at, producto_id);

create or replace function private.api_leer_precios(
  p_organizacion_id uuid,
  p_cursor text,
  p_limite integer,
  p_actualizado_desde timestamptz
)
returns table (filas jsonb, siguiente_cursor text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limite integer := coalesce(p_limite, 50);
  v_fecha timestamptz;
  v_id uuid;
  v_desde timestamptz;
  v_filas jsonb;
  v_siguiente text;
begin
  if v_limite < 1 or v_limite > 100 then
    raise exception 'LIMITE_INVALIDO' using errcode = '22023';
  end if;

  select c.fecha, c.id into v_fecha, v_id from private.api_cursor_partes(p_cursor, 2) c;

  -- Cota inferior de `actualizado_en` que exigen el filtro y el cursor (`greatest` ignora los nulos). Un producto cuyo
  -- último cambio es anterior a esa cota no puede caer en la página: ni él ni ninguna de sus escalas se tocaron desde entonces.
  v_desde := greatest(v_fecha, p_actualizado_desde);

  -- `actualizado_en` es lo ÚLTIMO que cambió del producto: él o cualquiera de sus escalas (un cambio solo de escala no toca
  -- `productos.updated_at` y la sincronización incremental lo perdía aunque se emitiera `precio.actualizado`). El filtro
  -- `actualizado_desde` y el cursor usan ese mismo valor.
  with candidatos as (
    -- Productos tocados desde la cota (por el índice de productos) y productos con una escala tocada desde la cota
    -- (por el índice de escalas). Sin cota (primera página de una carga completa) son todos.
    select p.id
      from dominio.productos p
     where p.organizacion_id = p_organizacion_id
       and (v_desde is null or p.updated_at >= v_desde)
    union
    select x.producto_id
      from dominio.producto_precios_escala x
     where x.organizacion_id = p_organizacion_id
       and v_desde is not null
       and x.updated_at >= v_desde
  ), base as (
    select p.id as producto_id, p.nombre, p.sku, p.moneda, p.precio_lista,
      max(e.precio) filter (where e.escala = 'x5') as precio_x5,
      max(e.precio) filter (where e.escala = 'x10') as precio_x10,
      max(e.precio) filter (where e.escala = 'x50') as precio_x50,
      greatest(p.updated_at, coalesce(max(e.updated_at), p.updated_at)) as actualizado_en
      from candidatos c
      join dominio.productos p on p.id = c.id and p.organizacion_id = p_organizacion_id
      left join dominio.producto_precios_escala e
        on e.producto_id = p.id and e.organizacion_id = p.organizacion_id
     group by p.id, p.nombre, p.sku, p.moneda, p.precio_lista, p.updated_at
  ), pagina as (
    select b.*
      from base b
     where (p_actualizado_desde is null or b.actualizado_en >= p_actualizado_desde)
       and (v_id is null or (b.actualizado_en, b.producto_id) > (v_fecha, v_id))
     order by b.actualizado_en, b.producto_id
     limit v_limite + 1
  ), recortada as (
    select * from pagina limit v_limite
  )
  select
    coalesce((select jsonb_agg(to_jsonb(r) order by r.actualizado_en, r.producto_id) from recortada r), '[]'::jsonb),
    case
      when (select count(*) from pagina) > v_limite then
        (select private.api_codificar_cursor(r.actualizado_en, r.producto_id)
           from recortada r order by r.actualizado_en desc, r.producto_id desc limit 1)
      else null
    end
  into v_filas, v_siguiente;

  return query select v_filas, v_siguiente;
end;
$$;

-- ============================================================================
-- 2. `creada_por` no borra la integración; el secreto de Vault se va con la suscripción.
-- ============================================================================

alter table public.api_claves alter column creada_por drop not null;
alter table public.api_claves drop constraint if exists api_claves_creada_por_fkey;
alter table public.api_claves
  add constraint api_claves_creada_por_fkey foreign key (creada_por) references auth.users (id) on delete set null not valid;
alter table public.api_claves validate constraint api_claves_creada_por_fkey;

alter table public.api_suscripciones alter column creada_por drop not null;
alter table public.api_suscripciones drop constraint if exists api_suscripciones_creada_por_fkey;
alter table public.api_suscripciones
  add constraint api_suscripciones_creada_por_fkey foreign key (creada_por) references auth.users (id) on delete set null not valid;
alter table public.api_suscripciones validate constraint api_suscripciones_creada_por_fkey;

create or replace function private.api_borrar_secreto_suscripcion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id = old.secreto_vault_id;
  return old;
end;
$$;

revoke execute on function private.api_borrar_secreto_suscripcion() from public, anon, authenticated;

drop trigger if exists api_suscripciones_borrar_secreto on public.api_suscripciones;
create trigger api_suscripciones_borrar_secreto
  after delete on public.api_suscripciones
  for each row execute function private.api_borrar_secreto_suscripcion();

-- El trigger borra el secreto por id: dos suscripciones no pueden compartir el mismo secreto de Vault (defensa en
-- profundidad: hoy el único alta es crear_suscripcion_api, que crea un secreto nuevo por suscripción).
create unique index if not exists api_suscripciones_secreto_vault_uidx
  on public.api_suscripciones (secreto_vault_id);

-- El borrado del secreto es ahora del trigger: la RPC ya no lo repite.
create or replace function public.eliminar_suscripcion_api(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid := (select private.organizacion_id());
begin
  if v_organizacion_id is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede eliminar suscripciones a avisos' using errcode = '42501';
  end if;

  -- El trigger api_suscripciones_borrar_secreto borra el secreto de Vault junto con la fila.
  delete from public.api_suscripciones
   where public.api_suscripciones.id = p_id
     and organizacion_id = v_organizacion_id;

  if not found then
    raise exception 'La suscripción no existe' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.eliminar_suscripcion_api(uuid) is
  'F-API-01: elimina una suscripción a avisos de la organización; el trigger api_suscripciones_borrar_secreto borra su secreto de Vault.';

revoke execute on function public.eliminar_suscripcion_api(uuid) from public, anon;
grant execute on function public.eliminar_suscripcion_api(uuid) to authenticated;

-- Las claves revocadas o vencidas hace más de la retención no se acumulan: `api_claves` no crecía sin cota. Las llamadas
-- viejas quedan con `clave_id` nulo (on delete set null) y se purgan por su propia retención.
create or replace function private.purgar_api_llamadas(p_retencion_dias integer default 90)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_borradas integer;
begin
  if p_retencion_dias is null or p_retencion_dias < 1 or p_retencion_dias > 3650 then
    raise exception 'RETENCION_INVALIDA' using errcode = '22023';
  end if;

  -- Una reserva de límite (102) que sigue así pasados 5 minutos es una llamada
  -- cuya función murió antes de completarla: se deja como error del servidor.
  update public.api_llamadas
     set estado_http = 500
   where public.api_llamadas.estado_http = 102
     and public.api_llamadas.creada_en < now() - interval '5 minutes';

  delete from public.api_llamadas
   where creada_en < now() - make_interval(days => p_retencion_dias);

  get diagnostics v_borradas = row_count;

  delete from public.api_claves
   where (public.api_claves.revocada_en is not null and public.api_claves.revocada_en < now() - make_interval(days => p_retencion_dias))
      or (public.api_claves.vence_en is not null and public.api_claves.vence_en < now() - make_interval(days => p_retencion_dias));

  return v_borradas;
end;
$$;

revoke execute on function private.purgar_api_llamadas(integer) from public, anon, authenticated;
grant execute on function private.purgar_api_llamadas(integer) to kestra_orquestacion, service_role;

-- ============================================================================
-- 3. Tope por organización.
-- ============================================================================

create or replace function public.crear_clave_api(
  p_nombre text,
  p_alcances text[],
  p_vence_en timestamptz default null
)
returns table (id uuid, valor text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid := (select private.organizacion_id());
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_alcances text[];
  v_prefijo text;
  v_token text;
  v_id uuid;
begin
  if v_organizacion_id is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede crear claves de API' using errcode = '42501';
  end if;

  if v_nombre = '' or length(v_nombre) > 120 then
    raise exception 'El nombre de la clave es obligatorio' using errcode = '22023';
  end if;

  select coalesce(array_agg(u.t order by u.ord), '{}'::text[]) into v_alcances
    from (select distinct on (btrim(t)) btrim(t) as t, ord
            from unnest(coalesce(p_alcances, '{}'::text[])) with ordinality as u(t, ord)
           where btrim(t) <> ''
           order by btrim(t), ord) u;

  if cardinality(v_alcances) = 0 then
    raise exception 'La clave necesita al menos un alcance' using errcode = '22023';
  end if;

  if not (v_alcances <@ array['productos', 'stock', 'precios', 'ventas']::text[]) then
    raise exception 'Alcance inválido' using errcode = '22023';
  end if;

  if p_vence_en is not null and p_vence_en <= now() then
    raise exception 'El vencimiento debe ser un instante futuro' using errcode = '22023';
  end if;

  -- Tope de 50 claves vigentes por organización (revocadas y vencidas no cuentan). El candado serializa las altas de la
  -- misma organización para que dos llamadas simultáneas no pasen el tope juntas.
  perform pg_advisory_xact_lock(hashtextextended('api_claves:' || v_organizacion_id::text, 0));
  if (select count(*) from public.api_claves k
       where k.organizacion_id = v_organizacion_id
         and k.revocada_en is null
         and (k.vence_en is null or k.vence_en > now())) >= 50 then
    raise exception 'La organización llegó al máximo de 50 claves vigentes: revocá alguna antes de crear otra'
      using errcode = '54000';
  end if;

  v_prefijo := (select private.api_prefijo_aleatorio());
  v_token := 'msf_' || v_prefijo || '_' || (select private.api_secreto_aleatorio());

  insert into public.api_claves (organizacion_id, nombre, prefijo, hash, alcances, vence_en, creada_por)
  values (v_organizacion_id, v_nombre, v_prefijo, extensions.digest(v_token, 'sha256'), v_alcances,
    p_vence_en, (select auth.uid()))
  returning api_claves.id into v_id;

  return query select v_id, v_token;
end;
$$;

comment on function public.crear_clave_api(text, text[], timestamptz) is
  'F-API-01: el Administrador crea una clave de lectura de su organización (máximo 50 vigentes). Devuelve el valor una sola vez; solo queda el hash.';

revoke execute on function public.crear_clave_api(text, text[], timestamptz) from public, anon;
grant execute on function public.crear_clave_api(text, text[], timestamptz) to authenticated;

create or replace function public.crear_suscripcion_api(p_url text, p_tipos text[])
returns table (id uuid, secreto text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid := (select private.organizacion_id());
  v_url text := btrim(coalesce(p_url, ''));
  v_tipos text[];
  v_secreto text;
  v_vault_id uuid;
  v_id uuid;
begin
  if v_organizacion_id is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede crear suscripciones a avisos' using errcode = '42501';
  end if;

  if not (select private.api_url_destino_valida(v_url)) then
    raise exception 'La URL del aviso no es válida: tiene que ser https y apuntar a un destino público' using errcode = '22023';
  end if;

  select coalesce(array_agg(u.t order by u.ord), '{}'::text[]) into v_tipos
    from (select distinct on (btrim(t)) btrim(t) as t, ord
            from unnest(coalesce(p_tipos, '{}'::text[])) with ordinality as u(t, ord)
           where btrim(t) <> ''
           order by btrim(t), ord) u;

  if cardinality(v_tipos) = 0 then
    raise exception 'La suscripción necesita al menos un tipo de evento' using errcode = '22023';
  end if;

  if not (v_tipos <@ array['stock.actualizado', 'precio.actualizado', 'venta.registrada']::text[]) then
    raise exception 'Tipo de evento inválido' using errcode = '22023';
  end if;

  -- Tope de 20 suscripciones por organización (cada una genera una entrega por evento).
  perform pg_advisory_xact_lock(hashtextextended('api_suscripciones:' || v_organizacion_id::text, 0));
  if (select count(*) from public.api_suscripciones s where s.organizacion_id = v_organizacion_id) >= 20 then
    raise exception 'La organización llegó al máximo de 20 suscripciones: eliminá alguna antes de crear otra'
      using errcode = '54000';
  end if;

  v_secreto := encode(extensions.gen_random_bytes(32), 'hex');
  v_vault_id := vault.create_secret(v_secreto);

  insert into public.api_suscripciones (organizacion_id, url, tipos, secreto_vault_id, creada_por)
  values (v_organizacion_id, v_url, v_tipos, v_vault_id, (select auth.uid()))
  returning api_suscripciones.id into v_id;

  return query select v_id, v_secreto;
end;
$$;

comment on function public.crear_suscripcion_api(text, text[]) is
  'F-API-01: crea una suscripción a avisos (máximo 20 por organización). El secreto de firma se muestra una sola vez y queda en Vault.';

revoke execute on function public.crear_suscripcion_api(text, text[]) from public, anon;
grant execute on function public.crear_suscripcion_api(text, text[]) to authenticated;

-- Rotar no se bloquea por el tope de 50, pero tiene un tope duro de 100 vigentes (la clave anterior sigue vigente 24 h:
-- sin él, rotar en bucle crearía claves sin límite) y toma el mismo candado que crear.
create or replace function public.rotar_clave_api(p_clave_id uuid)
returns table (id uuid, valor text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clave public.api_claves;
  v_organizacion_id uuid := (select private.organizacion_id());
  v_prefijo text;
  v_token text;
  v_id uuid;
begin
  if v_organizacion_id is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede rotar claves de API' using errcode = '42501';
  end if;

  -- `public.api_claves.id` va cualificado: el parámetro de salida de la RPC
  -- también se llama `id` y, sin calificar, la referencia sería ambigua.
  select * into v_clave from public.api_claves where public.api_claves.id = p_clave_id;
  if not found then
    raise exception 'La clave no existe' using errcode = 'P0002';
  end if;

  if v_clave.organizacion_id <> v_organizacion_id then
    raise exception 'La clave pertenece a otra organización' using errcode = '42501';
  end if;

  if v_clave.revocada_en is not null then
    raise exception 'La clave está revocada' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('api_claves:' || v_organizacion_id::text, 0));
  if (select count(*) from public.api_claves k
       where k.organizacion_id = v_organizacion_id
         and k.revocada_en is null
         and (k.vence_en is null or k.vence_en > now())) >= 100 then
    raise exception 'La organización tiene demasiadas claves vigentes: revocá las que no uses antes de rotar'
      using errcode = '54000';
  end if;

  -- La gracia de 24 h (D-3) se otorga UNA sola vez y nunca revive una clave
  -- vencida: rotar dos veces la misma clave no extiende la ventana, y rotar
  -- una clave ya vencida entrega la nueva sin resucitar la vieja.
  if (v_clave.vence_en is null or v_clave.vence_en > now()) and v_clave.rotada_en is null then
    -- La gracia nunca alarga la vida de la clave anterior: vence en 24 h o en su
    -- vencimiento original, lo que ocurra primero.
    update public.api_claves
       set vence_en = least(coalesce(public.api_claves.vence_en, 'infinity'::timestamptz), now() + interval '24 hours'),
           rotada_en = now()
     where public.api_claves.id = p_clave_id;
  end if;

  v_prefijo := (select private.api_prefijo_aleatorio());
  v_token := 'msf_' || v_prefijo || '_' || (select private.api_secreto_aleatorio());

  -- La clave nueva hereda el vencimiento de la original si todavía está en el
  -- futuro; si la original ya había vencido, nace sin vencimiento (rotar una
  -- clave vencida es la forma de renovarla).
  insert into public.api_claves (organizacion_id, nombre, prefijo, hash, alcances, limite_por_minuto, vence_en, creada_por)
  values (v_clave.organizacion_id, v_clave.nombre, v_prefijo, extensions.digest(v_token, 'sha256'),
    v_clave.alcances, v_clave.limite_por_minuto,
    case when v_clave.vence_en > now() then v_clave.vence_en end, (select auth.uid()))
  returning api_claves.id into v_id;

  return query select v_id, v_token;
end;
$$;

comment on function public.rotar_clave_api(uuid) is
  'F-API-01: rota una clave de API. La anterior vence en 24 h (D-3, una sola vez) y la nueva conserva nombre, alcances y límite. Una clave ya vencida no revive. Tope duro de 100 vigentes por organización.';

revoke execute on function public.rotar_clave_api(uuid) from public, anon;
grant execute on function public.rotar_clave_api(uuid) to authenticated;
