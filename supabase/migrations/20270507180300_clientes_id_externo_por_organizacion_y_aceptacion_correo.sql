-- MSF-596 y MSF-666 (lote 32, MSF-647): identificador externo de clientes por organización y aceptación de correo masivo en
-- la migración de clientes.
--
-- ── MSF-596 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- `public.clientes_identificadores_externos` no tenía organización y su único era `(sistema, identificador_externo)` en
-- toda la instancia: dos organizaciones no podían vincular el mismo identificador del mismo sistema y
-- `vincular_identificador_externo` respondía «ya está vinculado a otro cliente» (23505) aunque el otro cliente fuera de OTRA
-- organización, lo que además revelaba que ese identificador existe en otro tenant.
-- Decisión tomada: unicidad por `(organizacion_id, sistema, identificador_externo)`.
--   · Columna `organizacion_id` (se rellena desde el cliente, `not null`), mantenida por un disparador `before insert or
--     update of cliente_id` que la toma SIEMPRE del cliente (nadie puede escribir una organización distinta a la del cliente).
--   · Se reemplaza el único global por el único por organización (el único global es lo que se quita: imprescindible).
--   · Se reescriben, partiendo de sus definiciones VIGENTES (`public.clientes` ya es `dominio.clientes`) las cuatro
--     funciones que lo usan: `vincular_identificador_externo` (conflicto y lectura acotados a la organización: un
--     identificador de otra organización ya no choca ni se revela), `aplicar_lote_clientes` (carga),
--     `private.clasificar_fila_cliente` (busca el identificador solo en la organización de la carga; sin la rama de
--     «identificador de otra organización», que ya no puede ocurrir) e `informe_conciliacion_migracion` (verifica solo
--     contra los vínculos de la organización).
--
-- ── MSF-666 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- La importación no cargaba la aceptación de correo masivo: la base migrada quedaba con cero destinatarios elegibles.
-- Decisión tomada: columna opcional `acepta_correo` en la importación (sí/no) MÁS una acción masiva «marcar aceptación»
-- con registro de quién y cuándo, sin valor por defecto: vacío = sin aceptación (el cliente existente conserva lo que tenía).
--   · `dominio.clientes.acepta_correo_masivo_en` y `acepta_correo_masivo_por` (nulables): los llena un disparador cuando
--     el interruptor pasa a verdadero (momento y usuario de la sesión; nulo si lo apagó una baja por enlace) y los vacía al
--     apagarse. Sin grants de escritura para `authenticated`: no se pueden falsificar.
--   · `aplicar_lote_clientes` y `private.validar_fila_cliente_migracion` leen `acepta_correo` (sí/no/s/n/true/false/1/0;
--     otro valor es un error de fila). Una celda vacía no toca el dato existente; un cliente nuevo sin valor queda en no.
--   · `public.marcar_aceptacion_correo_clientes(uuid[], boolean)`: acción masiva, solo administrador, hasta 5000 clientes de
--     su organización (los ajenos se ignoran), deja el evento de Actividad `clientes.aceptacion_correo_marcada` con la
--     cantidad y quién. Devuelve cuántos cambiaron.
--
-- Seguridad: todas `security definer` con `search_path = ''` y objetos calificados; grants explícitos.
-- Migración aditiva salvo el reemplazo del único global. Reversión: drop function
-- public.marcar_aceptacion_correo_clientes(uuid[], boolean); drop function private.parsear_acepta_correo(text); drop trigger
-- clientes_consentimiento_correo on dominio.clientes; drop function private.marcar_consentimiento_correo(); alter table
-- dominio.clientes drop column acepta_correo_masivo_en, drop column acepta_correo_masivo_por; recrear las cuatro funciones
-- con las definiciones de 20270507170000 (aplicar_lote_clientes y validar_fila_cliente_migracion), 20261201130000
-- (informe_conciliacion_migracion), 20261201100000 (clasificar_fila_cliente) y 20260930140000 (vincular_identificador_externo);
-- y, solo si no hay dos organizaciones con el mismo identificador, recrear el único global
-- `(sistema, identificador_externo)` y dropear `organizacion_id` y su disparador.

-- ============================================================================
-- MSF-596: organización en el vínculo
-- ============================================================================
alter table public.clientes_identificadores_externos add column if not exists organizacion_id uuid;

update public.clientes_identificadores_externos v
   set organizacion_id = c.organizacion_id
  from dominio.clientes c
 where c.id = v.cliente_id and v.organizacion_id is null;

alter table public.clientes_identificadores_externos alter column organizacion_id set not null;

create or replace function private.clientes_identificadores_externos_organizacion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select c.organizacion_id into new.organizacion_id from dominio.clientes c where c.id = new.cliente_id;
  if new.organizacion_id is null then
    raise exception 'El cliente % no existe', new.cliente_id using errcode = 'P0002';
  end if;
  return new;
end;
$$;

revoke execute on function private.clientes_identificadores_externos_organizacion() from public, anon, authenticated;

drop trigger if exists clientes_identificadores_externos_organizacion on public.clientes_identificadores_externos;
create trigger clientes_identificadores_externos_organizacion
  before insert or update of cliente_id on public.clientes_identificadores_externos
  for each row execute function private.clientes_identificadores_externos_organizacion();

alter table public.clientes_identificadores_externos
  drop constraint if exists clientes_identificadores_externos_sistema_identificador_key;
alter table public.clientes_identificadores_externos
  add constraint clientes_identificadores_externos_org_sistema_identificador_key
  unique (organizacion_id, sistema, identificador_externo);

comment on table public.clientes_identificadores_externos is
  'Mapeo genérico entre un cliente y su identidad en un sistema externo. sistema es texto libre (no hay catálogo de sistemas externos). Desde MSF-596 lleva organizacion_id (la mantiene un disparador desde el cliente) y el identificador es único por (organización, sistema, identificador).';

comment on column public.clientes_identificadores_externos.organizacion_id is
  'MSF-596: organización del cliente (la mantiene un disparador). El identificador externo es único por (organización, sistema, identificador).';


-- ============================================================================
-- MSF-596: funciones reescritas desde sus definiciones vigentes
-- ============================================================================
CREATE OR REPLACE FUNCTION public.vincular_identificador_externo(p_cliente_id uuid, p_sistema text, p_identificador_externo text)
 RETURNS clientes_identificadores_externos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_organizacion_id uuid;
  v_vinculo public.clientes_identificadores_externos;
begin
  select c.organizacion_id into v_organizacion_id
  from dominio.clientes c
  where c.id = p_cliente_id;

  if v_organizacion_id is null then
    raise exception 'El cliente % no existe', p_cliente_id using errcode = 'P0002';
  end if;

  if not (select private.es_administrador_de(v_organizacion_id)) then
    raise exception 'No puede gestionar identificadores externos de esta organización' using errcode = '42501';
  end if;

  insert into public.clientes_identificadores_externos (cliente_id, organizacion_id, sistema, identificador_externo)
  values (p_cliente_id, v_organizacion_id, p_sistema, p_identificador_externo)
  on conflict (organizacion_id, sistema, identificador_externo) do nothing
  returning * into v_vinculo;

  if v_vinculo is null then
    select * into v_vinculo
    from public.clientes_identificadores_externos
    where organizacion_id = v_organizacion_id and sistema = p_sistema and identificador_externo = p_identificador_externo;

    if v_vinculo.cliente_id <> p_cliente_id then
      raise exception 'El identificador externo ya está vinculado a otro cliente' using errcode = '23505';
    end if;
  end if;

  return v_vinculo;
end;
$function$;

revoke execute on function public.vincular_identificador_externo(uuid, text, text) from public, anon, authenticated;
grant execute on function public.vincular_identificador_externo(uuid, text, text) to authenticated;

CREATE OR REPLACE FUNCTION private.clasificar_fila_cliente(p_org uuid, p_fila jsonb, OUT o_estado text, OUT o_cliente uuid, OUT o_motivo text)
 RETURNS record
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_org_cliente uuid;
  v_documento text;
begin
  o_motivo := private.validar_fila_cliente_migracion(p_fila);
  if o_motivo is not null then
    o_estado := 'error';
    return;
  end if;

  select v.cliente_id, c.organizacion_id
    into o_cliente, v_org_cliente
    from public.clientes_identificadores_externos v
    join dominio.clientes c on c.id = v.cliente_id
   where v.sistema = 'panel_actual'
     and v.organizacion_id = p_org
     and v.identificador_externo = btrim(p_fila ->> 'id_externo');

  -- Unicidad de DNI/CUIT por organización (igual que el alta); solo si la fila trae el documento.
  v_documento := private.documento_normalizado(p_fila ->> 'documento');
  if v_documento is not null and exists (
    select 1 from dominio.clientes c
     where c.organizacion_id = p_org
       and private.documento_normalizado(c.documento) = v_documento
       and c.id is distinct from o_cliente
  ) then
    o_estado := 'error';
    o_cliente := null;
    o_motivo := 'Ya existe un cliente con ese DNI/CUIT';
    return;
  end if;

  o_estado := case when o_cliente is null then 'nueva' else 'actualizada' end;
end;
$function$;

revoke execute on function private.clasificar_fila_cliente(uuid, jsonb) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.informe_conciliacion_migracion(p_carga uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_carga public.migracion_cargas;
  v_nuevos integer;
  v_actualizados integer;
  v_errores integer;
  v_registradas integer;
  v_aplicadas integer;
  v_verificadas integer;
  v_diferencia integer;
  v_diferencia_destino integer;
begin
  if v_org is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede migrar datos' using errcode = '42501';
  end if;

  select * into v_carga
    from public.migracion_cargas c
   where c.id = p_carga and c.organizacion_id = v_org;
  if not found then
    raise exception 'La carga no existe en tu organización' using errcode = 'P0002';
  end if;

  select count(*) filter (where f.estado = 'nueva'),
         count(*) filter (where f.estado = 'actualizada'),
         count(*) filter (where f.estado = 'error')
    into v_nuevos, v_actualizados, v_errores
    from public.migracion_filas f
   where f.carga_id = p_carga;

  v_aplicadas := v_nuevos + v_actualizados;
  v_registradas := v_aplicadas + v_errores;

  -- Verificación contra el destino: cuántas de las filas aplicadas están realmente en la tabla
  -- destino (de esta organización) con su identificador externo. No confía en el contador.
  select count(*)::integer into v_verificadas
    from public.migracion_filas f
   where f.carga_id = p_carga
     and f.estado in ('nueva', 'actualizada')
     and case v_carga.entidad
       when 'clientes' then exists (
         select 1
           from public.clientes_identificadores_externos v
           join dominio.clientes c on c.id = v.cliente_id
          where v.sistema = 'panel_actual'
            and v.organizacion_id = v_org
            and v.identificador_externo = f.identificador_externo
            and c.organizacion_id = v_org)
       when 'proveedores' then exists (
         select 1 from dominio.proveedores p
          where p.organizacion_id = v_org and p.id_externo = f.identificador_externo)
       -- Alcance acotado: verifica que el SKU exista con algún proveedor asignado, no que sea el
       -- proveedor del archivo (un SKU vinculado antes por otro camino cuenta como verificado).
       when 'vinculos_proveedor_producto' then exists (
         select 1 from dominio.productos p
          where p.organizacion_id = v_org
            and lower(p.sku) = lower(f.identificador_externo)
            and p.proveedor_id is not null)
       when 'ingresos_archivo' then exists (
         select 1 from dominio.archivo_ingresos_mercaderia a
          where a.organizacion_id = v_org and a.id_externo = f.identificador_externo)
       else false
     end;

  v_diferencia := v_carga.filas_total - v_registradas;
  v_diferencia_destino := v_aplicadas - v_verificadas;

  return jsonb_build_object(
    'carga', p_carga,
    'entidad', v_carga.entidad,
    'archivo', v_carga.archivo,
    'estado', v_carga.estado,
    'creada_en', v_carga.created_at,
    'cerrada_en', v_carga.cerrada_en,
    'origen', jsonb_build_object('filas', v_carga.filas_total),
    'cargado', jsonb_build_object(
      'nuevos', v_nuevos,
      'actualizados', v_actualizados,
      'con_error', v_errores,
      -- Filas del archivo sin resultado registrado (carga incompleta o interrumpida).
      'omitidos', greatest(v_diferencia, 0)
    ),
    'diferencia', v_diferencia,
    'destino', jsonb_build_object('verificadas', v_verificadas, 'diferencia', v_diferencia_destino),
    'conciliado', (
      v_carga.estado = 'aplicada' and v_diferencia = 0 and v_diferencia_destino = 0
    ),
    'errores', coalesce((
      select jsonb_agg(jsonb_build_object('fila', x.fila, 'motivo', x.motivo) order by x.fila)
        from (
          select f.fila, f.motivo
            from public.migracion_filas f
           where f.carga_id = p_carga and f.estado = 'error'
           order by f.fila
           limit 200
        ) as x
    ), '[]'::jsonb)
  );
end;
$function$;

revoke execute on function public.informe_conciliacion_migracion(uuid) from public, anon, authenticated;
grant execute on function public.informe_conciliacion_migracion(uuid) to authenticated;

-- ============================================================================
-- MSF-666: aceptación de correo masivo
-- ============================================================================
alter table dominio.clientes
  add column if not exists acepta_correo_masivo_en timestamptz,
  add column if not exists acepta_correo_masivo_por uuid;

comment on column dominio.clientes.acepta_correo_masivo_en is
  'MSF-666: momento en que se marcó la aceptación de correo masivo (lo escribe el disparador). Nulo si no acepta o si se marcó antes de esta columna.';
comment on column dominio.clientes.acepta_correo_masivo_por is
  'MSF-666: usuario de la sesión que marcó la aceptación (lo escribe el disparador). Sin FK: sobrevive a la baja de la cuenta.';

create or replace function private.marcar_consentimiento_correo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.acepta_correo_masivo then
      new.acepta_correo_masivo_en := now();
      new.acepta_correo_masivo_por := (select auth.uid());
    else
      new.acepta_correo_masivo_en := null;
      new.acepta_correo_masivo_por := null;
    end if;
    return new;
  end if;
  if new.acepta_correo_masivo is distinct from old.acepta_correo_masivo then
    new.acepta_correo_masivo_en := case when new.acepta_correo_masivo then now() else null end;
    new.acepta_correo_masivo_por := case when new.acepta_correo_masivo then (select auth.uid()) else null end;
  else
    new.acepta_correo_masivo_en := old.acepta_correo_masivo_en;
    new.acepta_correo_masivo_por := old.acepta_correo_masivo_por;
  end if;
  return new;
end;
$$;

revoke execute on function private.marcar_consentimiento_correo() from public, anon, authenticated;

drop trigger if exists clientes_consentimiento_correo on dominio.clientes;
create trigger clientes_consentimiento_correo
  before insert or update on dominio.clientes
  for each row execute function private.marcar_consentimiento_correo();

create or replace function private.parsear_acepta_correo(p_valor text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(btrim(p_valor), '') is null then null
    when lower(btrim(p_valor)) in ('si', 'sí', 's', 'true', 'verdadero', '1') then true
    else false
  end;
$$;

revoke execute on function private.parsear_acepta_correo(text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION private.validar_fila_cliente_migracion(p_fila jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_campo record;
  v_correo text := nullif(btrim(p_fila ->> 'correo'), '');
  v_tipo text := nullif(lower(btrim(p_fila ->> 'tipo')), '');
  v_acepta text := nullif(lower(btrim(p_fila ->> 'acepta_correo')), '');
begin
  if nullif(btrim(p_fila ->> 'id_externo'), '') is null then
    return 'Falta el identificador del panel actual';
  end if;
  if char_length(btrim(p_fila ->> 'id_externo')) > 200 then
    return 'El identificador del panel actual supera 200 caracteres';
  end if;
  if nullif(btrim(p_fila ->> 'nombre'), '') is null then
    return 'Falta el nombre o la razón social';
  end if;
  for v_campo in
    select * from (values
      ('nombre', 'El nombre', 200),
      ('documento', 'El DNI/CUIT', 40),
      ('correo', 'El correo', 200),
      ('telefono', 'El teléfono', 60),
      ('celular', 'El celular', 60),
      ('direccion', 'La dirección', 200),
      ('codigo_postal', 'El CP', 20),
      ('localidad', 'La localidad', 120),
      ('provincia', 'La provincia', 120),
      ('expreso_preferido', 'El expreso preferido', 120),
      ('condicion_iva', 'La condición de IVA', 60)
    ) as t (campo, etiqueta, maximo)
  loop
    if char_length(btrim(coalesce(p_fila ->> v_campo.campo, ''))) > v_campo.maximo then
      return format('%s supera %s caracteres', v_campo.etiqueta, v_campo.maximo);
    end if;
  end loop;
  if v_correo is not null and v_correo !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    return 'El correo no tiene un formato válido';
  end if;
  if v_tipo is not null and v_tipo not in ('minorista', 'mayorista') then
    return 'El tipo de cliente debe ser minorista o mayorista';
  end if;
  -- MSF-666: `acepta_correo` es opcional; vacío = sin aceptación (no cambia nada). Solo sí/no.
  if v_acepta is not null and v_acepta not in ('si', 'sí', 's', 'true', 'verdadero', '1', 'no', 'n', 'false', 'falso', '0') then
    return 'La aceptación de correo debe ser sí o no';
  end if;
  return null;
end;
$function$;

revoke execute on function private.validar_fila_cliente_migracion(jsonb) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.aplicar_lote_clientes(p_carga uuid, p_lote integer, p_filas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := (select private.organizacion_id());
  v_carga public.migracion_cargas;
  v_fila jsonb;
  v_num integer;
  v_ext text;
  v_estado text;
  v_cliente uuid;
  v_acepta boolean;
  v_motivo text;
  v_resultado text;
  v_nuevos integer := 0;
  v_actualizados integer := 0;
  v_omitidos integer := 0;
  v_errores jsonb := '[]'::jsonb;
begin
  if v_org is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede migrar datos' using errcode = '42501';
  end if;
  if p_lote is null or p_lote < 0 then
    raise exception 'El número de lote no es válido' using errcode = '22023';
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'Las filas deben ser una lista' using errcode = '22023';
  end if;
  if jsonb_array_length(p_filas) > 500 then
    raise exception 'Un lote admite hasta 500 filas' using errcode = '54000';
  end if;

  -- Bloquea la carga: serializa lotes concurrentes de la misma carga.
  select * into v_carga
    from public.migracion_cargas c
   where c.id = p_carga and c.organizacion_id = v_org
     for update;
  if not found then
    raise exception 'La carga no existe en tu organización' using errcode = 'P0002';
  end if;
  if v_carga.entidad <> 'clientes' then
    raise exception 'La carga no es de clientes' using errcode = '22023';
  end if;

  for v_fila in select e.value from jsonb_array_elements(p_filas) as e (value) loop
    if jsonb_typeof(v_fila -> 'fila') is distinct from 'number' then
      raise exception 'Cada fila debe traer su número de fila' using errcode = '22023';
    end if;
    v_num := (v_fila ->> 'fila')::integer;
    v_ext := nullif(btrim(v_fila ->> 'id_externo'), '');
    v_resultado := null;
    v_motivo := null;
    v_acepta := private.parsear_acepta_correo(v_fila ->> 'acepta_correo');

    -- Ya aplicada en un intento anterior de esta carga: no se repite.
    if exists (
      select 1 from public.migracion_filas f
       where f.carga_id = p_carga and f.fila = v_num and f.estado in ('nueva', 'actualizada')
    ) then
      v_omitidos := v_omitidos + 1;
      continue;
    end if;

    begin
      select k.o_estado, k.o_cliente, k.o_motivo
        into v_estado, v_cliente, v_motivo
        from private.clasificar_fila_cliente(v_org, v_fila) as k;

      -- El mismo identificador DOS VECES EN EL ARCHIVO (en cualquier lote): la primera fila
      -- aplicada gana (FR-004). Se compara contra las filas de ESTA carga ya aplicadas
      -- (migracion_filas), no contra datos previos: reimportar un identificador de otra carga
      -- sigue siendo un upsert (FR-005).
      if v_estado <> 'error' and v_ext is not null and exists (
        select 1 from public.migracion_filas f
         where f.carga_id = p_carga and f.fila <> v_num
           and f.identificador_externo = left(v_ext, 200)
           and f.estado in ('nueva', 'actualizada')
           and f.fila < v_num
      ) then
        v_estado := 'error';
        v_motivo := 'El identificador está repetido en el archivo';
      end if;

      if v_estado = 'actualizada' then
        -- Solo se pisan las columnas que el archivo trae con valor: las no mapeadas y las celdas
        -- vacías dejan el dato existente como está (nunca se borra un dato por reimportar).
        update dominio.clientes c set
          nombre = btrim(v_fila ->> 'nombre'),
          documento = coalesce(nullif(btrim(v_fila ->> 'documento'), ''), c.documento),
          correo = coalesce(nullif(btrim(v_fila ->> 'correo'), ''), c.correo),
          telefono = coalesce(nullif(btrim(v_fila ->> 'telefono'), ''), c.telefono),
          celular = coalesce(nullif(btrim(v_fila ->> 'celular'), ''), c.celular),
          direccion = coalesce(nullif(btrim(v_fila ->> 'direccion'), ''), c.direccion),
          codigo_postal = coalesce(nullif(btrim(v_fila ->> 'codigo_postal'), ''), c.codigo_postal),
          localidad = coalesce(nullif(btrim(v_fila ->> 'localidad'), ''), c.localidad),
          provincia = coalesce(nullif(btrim(v_fila ->> 'provincia'), ''), c.provincia),
          expreso_preferido = coalesce(nullif(btrim(v_fila ->> 'expreso_preferido'), ''), c.expreso_preferido),
          condicion_iva = coalesce(nullif(btrim(v_fila ->> 'condicion_iva'), ''), c.condicion_iva),
          acepta_correo_masivo = coalesce(v_acepta, c.acepta_correo_masivo),
          tipo = coalesce(nullif(lower(btrim(v_fila ->> 'tipo')), ''), c.tipo)
        where c.id = v_cliente and c.organizacion_id = v_org;
        if found then
          v_resultado := 'actualizada';
        else
          v_motivo := 'El cliente ya no existe';
        end if;
      elsif v_estado = 'nueva' then
        insert into dominio.clientes (
          organizacion_id, nombre, documento, correo, telefono, celular, direccion,
          codigo_postal, localidad, provincia, expreso_preferido, condicion_iva, tipo, acepta_correo_masivo
        ) values (
          v_org, btrim(v_fila ->> 'nombre'), nullif(btrim(v_fila ->> 'documento'), ''),
          nullif(btrim(v_fila ->> 'correo'), ''), nullif(btrim(v_fila ->> 'telefono'), ''),
          nullif(btrim(v_fila ->> 'celular'), ''), nullif(btrim(v_fila ->> 'direccion'), ''),
          nullif(btrim(v_fila ->> 'codigo_postal'), ''), nullif(btrim(v_fila ->> 'localidad'), ''),
          nullif(btrim(v_fila ->> 'provincia'), ''),
          nullif(btrim(v_fila ->> 'expreso_preferido'), ''),
          nullif(btrim(v_fila ->> 'condicion_iva'), ''),
          coalesce(nullif(lower(btrim(v_fila ->> 'tipo')), ''), 'minorista'),
          coalesce(v_acepta, false)
        ) returning id into v_cliente;

        insert into public.clientes_identificadores_externos (cliente_id, organizacion_id, sistema, identificador_externo)
        values (v_cliente, v_org, 'panel_actual', v_ext);

        -- Como cualquier alta (F-CLI-05): habilitado en todas las tiendas de la organización.
        insert into public.clientes_empresas (cliente_id, empresa_id, organizacion_id)
        select v_cliente, e.id, v_org from dominio.empresas e where e.organizacion_id = v_org
        on conflict do nothing;
        v_resultado := 'nueva';
      end if;
    exception
      when unique_violation then
        v_resultado := null;
        v_motivo := case
          when sqlerrm like '%clientes_org_documento_uq%' then 'Ya existe un cliente con ese DNI/CUIT'
          else 'El identificador ya está en uso'
        end;
      when insufficient_privilege then
        v_resultado := null;
        v_motivo := 'Este cliente no se puede modificar';
    end;

    if v_resultado = 'nueva' then
      v_nuevos := v_nuevos + 1;
    elsif v_resultado = 'actualizada' then
      v_actualizados := v_actualizados + 1;
    else
      v_errores := v_errores || jsonb_build_object('fila', v_num, 'motivo', v_motivo);
    end if;

    insert into public.migracion_filas (carga_id, lote, fila, estado, identificador_externo, motivo)
    values (p_carga, p_lote, v_num, coalesce(v_resultado, 'error'), left(v_ext, 200), left(v_motivo, 300))
    on conflict (carga_id, fila) do update
      set lote = excluded.lote,
          estado = excluded.estado,
          identificador_externo = excluded.identificador_externo,
          motivo = excluded.motivo;
  end loop;

  return jsonb_build_object(
    'nuevos', v_nuevos,
    'actualizados', v_actualizados,
    'omitidos', v_omitidos,
    'errores', v_errores
  );
end;
$function$;

revoke execute on function public.aplicar_lote_clientes(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.aplicar_lote_clientes(uuid, integer, jsonb) to authenticated;

create or replace function public.marcar_aceptacion_correo_clientes(p_cliente_ids uuid[], p_acepta boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_cambiados integer;
begin
  if v_org is null or v_actor is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede marcar la aceptación de correo' using errcode = '42501';
  end if;
  if p_acepta is null then
    raise exception 'Indicá si los clientes aceptan o no el correo masivo' using errcode = '22023';
  end if;
  if p_cliente_ids is null or coalesce(cardinality(p_cliente_ids), 0) = 0 then
    raise exception 'Elegí al menos un cliente' using errcode = '22023';
  end if;
  if cardinality(p_cliente_ids) > 5000 then
    raise exception 'Se pueden marcar hasta 5000 clientes por vez' using errcode = '22023';
  end if;

  update dominio.clientes c
     set acepta_correo_masivo = p_acepta
   where c.id = any (p_cliente_ids)
     and c.organizacion_id = v_org
     and c.acepta_correo_masivo is distinct from p_acepta;
  get diagnostics v_cambiados = row_count;

  perform private.insertar_actividad(
    v_org,
    v_actor,
    'clientes.aceptacion_correo_marcada',
    format('Marcó %s cliente(s) como %s el correo masivo', v_cambiados, case when p_acepta then 'que aceptan' else 'que no aceptan' end),
    null
  );
  return v_cambiados;
end;
$$;

revoke execute on function public.marcar_aceptacion_correo_clientes(uuid[], boolean) from public, anon;
grant execute on function public.marcar_aceptacion_correo_clientes(uuid[], boolean) to authenticated;

comment on function public.marcar_aceptacion_correo_clientes(uuid[], boolean) is
  'MSF-666: marca (o desmarca) la aceptación de correo masivo de varios clientes de la organización; solo administrador; deja quién y cuándo en el cliente y un evento de Actividad. Devuelve cuántos cambiaron.';
