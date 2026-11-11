-- MSF-161 · F-VTA-26 (MSF-257, spec 20261110-100000-ventas-avisos-de-faltantes, FR-006, FR-007):
-- la cola de avisos de faltantes (F-STK-17) aprende a llevar el texto editable del aviso y a reconocer como
-- abiertos los faltantes de venta de `dominio.faltantes_venta` (F-VTA-18).
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   dominio.faltantes_avisos             dominio (existente)  se le suma la columna `mensaje` (dato del aviso).
--   dominio.faltantes_venta              dominio (existente)  solo se lee (faltante abierto de la línea).
--   dominio.comprobantes_venta(_lineas)  dominio (existente)  solo se leen.
--   private.faltante_abierta             private (existente)  `create or replace`, misma firma.
--   public.tomar_aviso_faltante          public  (existente)  `create or replace`, misma firma y `returns table`;
--                                                             sigue siendo solo de service_role (RPC de la
--                                                             Edge Function `enviar-aviso-faltante`).
-- No se crea ninguna tabla: la exportación total no cambia (`faltantes_avisos` sigue siendo cola interna).
--
-- Cambios de comportamiento:
--   * `faltantes_avisos.mensaje`: texto que la persona editó en el diálogo «Avisar a los clientes»
--     (null = texto por defecto de F-STK-17). Tope de 1.000 caracteres por `check`.
--   * `private.faltante_abierta(linea)`: además del criterio de F-STK-17 (factura «A pedido» confirmada con
--     reserva activa) es abierto el faltante cuya línea tiene una fila ABIERTA en `faltantes_venta`. Así
--     `tomar_aviso_faltante` no descarta ni manda avisos de faltantes ya cerrados (FR-007).
--   * `tomar_aviso_faltante`: cada elemento de `lineas` suma `mensaje`; `cantidad` es la cantidad faltante si
--     hay un faltante de venta abierto (si no, la de la línea) y la tanda del cliente incluye solo las líneas
--     pendientes con el mismo `mensaje` que la más antigua (nunca un correo con textos mezclados: las demás
--     salen en el barrido siguiente). Grants de F-STK-17 intactos.
--
-- Migración aditiva e idempotente (`if not exists`, `create or replace`). Reversión (migración posterior):
--   -- restaurar private.faltante_abierta y public.tomar_aviso_faltante a la definición de 20261213100200;
--   alter table dominio.faltantes_avisos drop column if exists mensaje;  -- exportar antes si hay avisos con texto
--   -- (con el cuerpo viejo de tomar_aviso_faltante la columna ya no se lee: se puede quitar después).

alter table dominio.faltantes_avisos
  add column if not exists mensaje text check (mensaje is null or length(mensaje) <= 1000);

comment on column dominio.faltantes_avisos.mensaje is
  'F-VTA-26: texto editable del aviso (máx. 1.000). Nulo = texto por defecto de F-STK-17. El correo lo arma la Edge Function enviar-aviso-faltante.';

create or replace function private.faltante_abierta(p_linea_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from dominio.comprobantes_venta_lineas l
    join dominio.comprobantes_venta c
      on c.id = l.comprobante_id and c.organizacion_id = l.organizacion_id
    join dominio.reservas_stock r
      on r.organizacion_id = l.organizacion_id
     and r.referencia = 'comprobante:' || c.id || ':linea:' || l.orden
     and r.estado = 'activa'
    where l.id = p_linea_id
      and c.tipo = 'factura'
      and c.estado = 'confirmada'
      and l.a_pedido
  ) or exists (
    select 1
    from dominio.comprobantes_venta_lineas l
    join dominio.faltantes_venta f
      on f.comprobante_id = l.comprobante_id
     and f.linea_orden = l.orden
     and f.organizacion_id = l.organizacion_id
     and f.estado = 'abierto'
    where l.id = p_linea_id
  );
$$;

revoke execute on function private.faltante_abierta(uuid) from public, anon, authenticated;

comment on function private.faltante_abierta(uuid) is
  'MSF-405 / F-VTA-26: el faltante de la línea sigue abierto (factura confirmada «A pedido» con reserva activa, o fila abierta en dominio.faltantes_venta). La usan las RPC de la cola de avisos (service_role).';

create or replace function public.tomar_aviso_faltante(p_cliente uuid, p_tope integer default 5)
returns table (cliente text, correo text, lineas jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tope integer := greatest(coalesce(p_tope, 5), 1);
  v_correo text;
  v_nombre text;
  v_ids uuid[];
begin
  -- Serializa por cliente: dos barridos simultáneos no toman las mismas líneas.
  perform 1 from dominio.faltantes_avisos a where a.cliente_id = p_cliente and a.estado = 'pendiente' for update;

  -- Tope cumplido y reserva vencida (el proceso murió en el último intento): queda agotado y visible.
  update dominio.faltantes_avisos a
     set estado = 'agotado',
         ultimo_error = coalesce(a.ultimo_error, 'Se agotaron los intentos de envío sin que el último llegara a cerrarse'),
         updated_at = now()
   where a.cliente_id = p_cliente and a.estado = 'pendiente'
     and a.intentos >= v_tope and a.updated_at <= now() - interval '2 minutes';

  -- El faltante se cerró antes de salir el correo (reserva liberada o descontada, o faltante de venta
  -- resuelto): no se avisa de un faltante que ya no existe. La línea vuelve a «Sin avisar» con el motivo; una
  -- línea en vuelo (intento tomado hace menos de 2 minutos) no se toca: ese correo ya salió y lo cierra el
  -- envío que lo tomó.
  update dominio.faltantes_avisos a
     set estado = 'agotado',
         ultimo_error = 'El faltante se cerró antes de enviar el aviso',
         updated_at = now()
   where a.cliente_id = p_cliente and a.estado = 'pendiente'
     and (a.intentos = 0 or a.updated_at <= now() - interval '2 minutes')
     and not private.faltante_abierta(a.linea_id);

  -- Un envío del mismo cliente puede estar EN VUELO (tanda reservada hace menos de 2 minutos): no se abre
  -- otra tanda para ese cliente. Así el cliente recibe UN correo por tanda y el cierre —que es por
  -- cliente— no pisa otra tanda. La línea que entró en cola durante el envío espera a que venza la reserva
  -- y sale en el siguiente barrido.
  if exists (
    select 1
    from dominio.faltantes_avisos a
    where a.cliente_id = p_cliente
      and a.estado = 'pendiente'
      and a.intentos > 0
      and a.updated_at > now() - interval '2 minutes'
  ) then
    return;
  end if;

  -- La tanda: las líneas pendientes vigentes del cliente con el MISMO texto que la más antigua (F-VTA-26:
  -- nunca un correo con textos mezclados; `is not distinct from` trata null como un texto más).
  with cand as (
    select a.linea_id, a.mensaje, a.created_at
      from dominio.faltantes_avisos a
     where a.cliente_id = p_cliente and a.estado = 'pendiente'
       and a.intentos < v_tope
       and (a.intentos = 0 or a.updated_at <= now() - interval '2 minutes')
       and private.faltante_abierta(a.linea_id)
  ), primera as (
    select c.mensaje from cand c order by c.created_at, c.linea_id limit 1
  )
  select array_agg(c.linea_id order by c.created_at, c.linea_id) into v_ids
    from cand c
   where c.mensaje is not distinct from (select p.mensaje from primera p);
  if v_ids is null then
    return;
  end if;

  select nullif(btrim(c.correo), ''), c.nombre into v_correo, v_nombre
    from public.clientes c where c.id = p_cliente;
  if v_correo is null then
    update dominio.faltantes_avisos a
       set estado = 'agotado', ultimo_error = 'El cliente no tiene correo', updated_at = now()
     where a.linea_id = any (v_ids);
    return;
  end if;

  update dominio.faltantes_avisos a
     set intentos = a.intentos + 1, updated_at = now()
   where a.linea_id = any (v_ids);

  return query
    select v_nombre, v_correo,
           jsonb_agg(jsonb_build_object(
             'producto', p.nombre,
             'sku', p.sku,
             'cantidad', coalesce(fv.cantidad_faltante, l.cantidad),
             'comprobante', c.numero,
             'mensaje', a.mensaje
           ) order by c.numero, l.orden)
      from dominio.faltantes_avisos a
      join dominio.comprobantes_venta_lineas l on l.id = a.linea_id
      join dominio.comprobantes_venta c on c.id = l.comprobante_id and c.organizacion_id = l.organizacion_id
      join dominio.productos p on p.id = l.producto_id and p.organizacion_id = l.organizacion_id
      left join dominio.faltantes_venta fv
        on fv.comprobante_id = l.comprobante_id and fv.linea_orden = l.orden
       and fv.organizacion_id = l.organizacion_id and fv.estado = 'abierto'
     where a.linea_id = any (v_ids);
end;
$$;

revoke execute on function public.tomar_aviso_faltante(uuid, integer) from public, anon, authenticated;
grant execute on function public.tomar_aviso_faltante(uuid, integer) to service_role;

comment on function public.tomar_aviso_faltante(uuid, integer) is
  'MSF-405 / F-VTA-26: reserva los avisos pendientes de un cliente (con el mismo texto) para mandarle un correo (cuenta el intento). No abre una segunda tanda del mismo cliente mientras hay un envío en vuelo. Solo service_role (Edge Function enviar-aviso-faltante).';
