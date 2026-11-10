-- MSF-394 · F-STK-09 (épica MSF-368, FR-201…FR-208): RPC del resumen de reposición. Solo service_role
-- (las llama la Edge Function `enviar-resumen-reposicion`, que dispara el flow de Kestra
-- `avisos-reposicion-stock`). El SQL solo calcula y registra: no hace HTTP (docs/adoptar-ciclo-ejecuciones.md §3.1).
--
-- Esquema (Principio VII): sin tablas nuevas; usa dominio.stock_avisos_reposicion y
-- dominio.stock_alertas_avisadas (20261212140000) y public.stock_estados.
--
-- Diseño:
--   * «Nuevo en alerta» (FR-202): el producto activo está hoy en `stock_bajo`/`sin_stock` y no tiene marca
--     en stock_alertas_avisadas, o la marca es `stock_bajo` y hoy está `sin_stock` (empeoró). Los
--     productos que volvieron a `disponible` pierden la marca al generar el siguiente resumen.
--   * Las marcas se escriben SOLO al cerrar con envío exitoso (FR-206): un fallo no marca nada y el
--     reintento vuelve a incluir los mismos productos (y los que hayan entrado en el medio).
--   * Un resumen pendiente se reserva 2 minutos (como tomar_aviso_consulta): dos barridos
--     simultáneos no mandan el mismo correo. Un resumen fallido o con reserva vencida se reutiliza
--     (suma un intento) hasta el tope; el registro conserva el error sanitizado.
--   * Destinatarios (FR-204): MSF-189 (mecanismo de avisos de Plataforma) no está en `main`. Hasta que
--     exista, `private.destinatarios_resumen_reposicion` es el ÚNICO punto que lo resuelve: correo de
--     los miembros activos con `stock` = edición. Cuando MSF-189 entregue su contrato, solo se
--     reemplaza esa función. Sin destinatarios el resumen queda `sin_destinatario` y no marca.
--
-- Seguridad: security definer, search_path = ''; la organización llega por argumento porque quien
-- llama es service_role (no hay sesión). `revoke … from public, anon, authenticated` + grant a service_role.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.generar_resumen_reposicion(uuid, integer);
--   drop function public.cerrar_resumen_reposicion(uuid, boolean, text);
--   drop function public.organizaciones_con_resumen_pendiente();
--   drop function private.productos_nuevos_en_alerta(uuid);
--   drop function private.destinatarios_resumen_reposicion(uuid);

-- Quién recibe el resumen. Interna (sin grants): la usan las funciones security definer de abajo.
create or replace function private.destinatarios_resumen_reposicion(p_organizacion uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct lower(btrim(u.email))), '{}'::text[])
  from public.usuarios_organizacion uo
  join auth.users u on u.id = uo.user_id
  where uo.organizacion_id = p_organizacion
    and uo.estado = 'activo'
    and u.email is not null
    and btrim(u.email) <> ''
    and coalesce(
      (select p.nivel from public.permisos_rol p
        where p.organizacion_id = uo.organizacion_id and p.rol_id = uo.rol_id and p.seccion = 'stock'),
      (select m.nivel from private.matriz_inicial() m
        where m.rol_id = uo.rol_id and m.seccion = 'stock')
    ) = 'edicion';
$$;

revoke execute on function private.destinatarios_resumen_reposicion(uuid) from public, anon, authenticated;

-- Productos que hoy están en alerta y todavía no se avisaron con ese estado o uno peor.
create or replace function private.productos_nuevos_en_alerta(p_organizacion uuid)
returns table (producto_id uuid, nombre text, sku text, cantidad integer, disponible integer, minimo integer, estado text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.producto_id, e.nombre, e.sku, e.cantidad::integer, e.disponible::integer, e.minimo::integer, e.estado
  from public.stock_estados e
  left join dominio.stock_alertas_avisadas a
    on a.organizacion_id = e.organizacion_id and a.producto_id = e.producto_id
  where e.organizacion_id = p_organizacion
    and e.activo
    and e.estado in ('stock_bajo', 'sin_stock')
    and (a.producto_id is null or (a.estado_avisado = 'stock_bajo' and e.estado = 'sin_stock'))
  order by (e.estado = 'sin_stock') desc, e.nombre, e.sku;
$$;

revoke execute on function private.productos_nuevos_en_alerta(uuid) from public, anon, authenticated;

-- Organizaciones que el barrido debe procesar: con productos nuevos en alerta, con un resumen
-- pendiente cuya reserva venció (el proceso murió antes de cerrarlo) o con marcas huérfanas (producto
-- avisado que ya no está en alerta): la limpieza de marcas vive en generar_resumen_reposicion y, sin
-- esta tercera condición, un producto repuesto que vuelve a caer no se re-avisaría (FR-202).
create or replace function public.organizaciones_con_resumen_pendiente()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(o.id order by o.id), '{}'::uuid[])
  from public.organizaciones o
  where exists (select 1 from private.productos_nuevos_en_alerta(o.id))
     or exists (
       select 1 from dominio.stock_avisos_reposicion r
       where r.organizacion_id = o.id and r.estado = 'pendiente'
         and r.updated_at <= now() - interval '2 minutes'
     )
     or exists (
       select 1 from dominio.stock_alertas_avisadas a
       where a.organizacion_id = o.id
         and not exists (
           select 1 from public.stock_estados e
            where e.organizacion_id = a.organizacion_id and e.producto_id = a.producto_id
              and e.activo and e.estado in ('stock_bajo', 'sin_stock')
         )
     );
$$;

-- Genera (o reintenta) el resumen de una organización y lo reserva 2 minutos. Devuelve 0 filas si
-- no hay productos nuevos en alerta o si otro barrido lo tiene reservado; con filas y
-- `destinatarios` vacío, el resumen quedó `sin_destinatario` y no hay nada que enviar.
create or replace function public.generar_resumen_reposicion(p_organizacion uuid, p_tope integer default 5)
returns table (
  resumen_id uuid,
  sin_stock integer,
  stock_bajo integer,
  productos jsonb,
  destinatarios text[]
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tope integer := greatest(coalesce(p_tope, 5), 1);
  v_resumen dominio.stock_avisos_reposicion%rowtype;
  v_productos jsonb;
  v_sin integer;
  v_bajo integer;
  v_destinos text[];
begin
  if p_organizacion is null or not exists (select 1 from public.organizaciones where id = p_organizacion) then
    return;
  end if;

  -- Un solo generador por organización a la vez.
  perform pg_advisory_xact_lock(hashtextextended('resumen_reposicion:' || p_organizacion::text, 0));

  -- Un producto que volvió a `disponible` (o dejó de existir/estar activo) pierde la marca: si vuelve
  -- a entrar en alerta, se avisa de nuevo (FR-202).
  delete from dominio.stock_alertas_avisadas a
   where a.organizacion_id = p_organizacion
     and not exists (
       select 1 from public.stock_estados e
        where e.organizacion_id = a.organizacion_id and e.producto_id = a.producto_id
          and e.activo and e.estado in ('stock_bajo', 'sin_stock')
     );

  -- Un pendiente con la reserva vencida que ya agotó los intentos no se retoma: se cierra como fallido.
  update dominio.stock_avisos_reposicion
     set estado = 'fallido',
         ultimo_error = coalesce(ultimo_error, 'Se agotaron los intentos del resumen'),
         updated_at = now()
   where organizacion_id = p_organizacion and estado = 'pendiente'
     and intentos >= v_tope and updated_at <= now() - interval '2 minutes';

  select * into v_resumen
    from dominio.stock_avisos_reposicion r
   where r.organizacion_id = p_organizacion
     and (r.estado = 'sin_destinatario'
          or (r.estado in ('pendiente', 'fallido') and r.intentos < v_tope))
   order by r.generado_en desc
   limit 1
   for update;

  -- Reservado por otra invocación que todavía puede estar enviando.
  if found and v_resumen.estado = 'pendiente' and v_resumen.intentos > 0
     and v_resumen.updated_at > now() - interval '2 minutes' then
    return;
  end if;

  select coalesce(jsonb_agg(to_jsonb(n) order by (n.estado = 'sin_stock') desc, n.nombre, n.sku), '[]'::jsonb),
         (count(*) filter (where n.estado = 'sin_stock'))::integer,
         (count(*) filter (where n.estado = 'stock_bajo'))::integer
    into v_productos, v_sin, v_bajo
    from private.productos_nuevos_en_alerta(p_organizacion) n;

  -- Sin novedades (FR-201): no se genera ni se envía nada. Un pendiente con la reserva vencida cuyos
  -- productos ya no están en alerta no puede quedar abierto.
  if v_sin + v_bajo = 0 then
    if v_resumen.id is not null and v_resumen.estado = 'pendiente' then
      update dominio.stock_avisos_reposicion
         set estado = 'fallido',
             ultimo_error = 'Los productos del resumen ya no están en alerta al reintentar',
             updated_at = now()
       where id = v_resumen.id;
    end if;
    return;
  end if;

  v_destinos := private.destinatarios_resumen_reposicion(p_organizacion);

  if v_resumen.id is null then
    insert into dominio.stock_avisos_reposicion (organizacion_id, productos, sin_stock, stock_bajo)
    values (p_organizacion, v_productos, v_sin, v_bajo)
    returning * into v_resumen;
  end if;

  -- FR-204: sin destinatarios queda registrado y no marca productos (se reevalúa en el próximo barrido).
  if coalesce(array_length(v_destinos, 1), 0) = 0 then
    update dominio.stock_avisos_reposicion
       set estado = 'sin_destinatario', productos = v_productos, sin_stock = v_sin, stock_bajo = v_bajo,
           ultimo_error = null, updated_at = now()
     where id = v_resumen.id;
    return query select v_resumen.id, v_sin, v_bajo, v_productos, '{}'::text[];
    return;
  end if;

  update dominio.stock_avisos_reposicion
     set estado = 'pendiente', intentos = intentos + 1, productos = v_productos,
         sin_stock = v_sin, stock_bajo = v_bajo, updated_at = now()
   where id = v_resumen.id;

  return query select v_resumen.id, v_sin, v_bajo, v_productos, v_destinos;
end;
$$;

-- Cierra un resumen tomado. Solo actúa sobre uno `pendiente`: un cierre repetido no pisa un `enviado`.
-- Con envío exitoso marca los productos como avisados (FR-206); con fallo guarda el error sanitizado.
create or replace function public.cerrar_resumen_reposicion(p_resumen uuid, p_enviado boolean, p_error text default null)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_resumen dominio.stock_avisos_reposicion%rowtype;
begin
  select * into v_resumen
    from dominio.stock_avisos_reposicion r
   where r.id = p_resumen and r.estado = 'pendiente'
   for update;
  if not found then
    return null;
  end if;

  if p_enviado then
    insert into dominio.stock_alertas_avisadas (organizacion_id, producto_id, estado_avisado, avisado_en)
    select v_resumen.organizacion_id, (p ->> 'producto_id')::uuid, p ->> 'estado', now()
      from jsonb_array_elements(v_resumen.productos) p
     where p ->> 'estado' in ('stock_bajo', 'sin_stock')
       and exists (select 1 from dominio.productos pr
                    where pr.id = (p ->> 'producto_id')::uuid and pr.organizacion_id = v_resumen.organizacion_id)
    on conflict (organizacion_id, producto_id)
      do update set estado_avisado = excluded.estado_avisado, avisado_en = excluded.avisado_en;

    update dominio.stock_avisos_reposicion
       set estado = 'enviado', enviado_en = now(), ultimo_error = null, updated_at = now()
     where id = p_resumen;
    return 'enviado';
  end if;

  update dominio.stock_avisos_reposicion
     set estado = 'fallido',
         ultimo_error = left(nullif(btrim(regexp_replace(coalesce(p_error, ''), '\s+', ' ', 'g')), ''), 500),
         updated_at = now()
   where id = p_resumen;
  return 'fallido';
end;
$$;

revoke execute on function public.generar_resumen_reposicion(uuid, integer) from public, anon, authenticated;
revoke execute on function public.cerrar_resumen_reposicion(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.organizaciones_con_resumen_pendiente() from public, anon, authenticated;
grant execute on function public.generar_resumen_reposicion(uuid, integer) to service_role;
grant execute on function public.cerrar_resumen_reposicion(uuid, boolean, text) to service_role;
grant execute on function public.organizaciones_con_resumen_pendiente() to service_role;

comment on function public.generar_resumen_reposicion(uuid, integer) is
  'MSF-394: genera o reintenta el resumen de reposición de una organización y lo reserva 2 minutos. Solo service_role (Edge Function enviar-resumen-reposicion).';
comment on function public.cerrar_resumen_reposicion(uuid, boolean, text) is
  'MSF-394: cierra el resumen tomado; solo con envío exitoso marca los productos como avisados. Solo service_role.';
comment on function public.organizaciones_con_resumen_pendiente() is
  'MSF-394: organizaciones con productos nuevos en alerta por resumir. Solo service_role.';
