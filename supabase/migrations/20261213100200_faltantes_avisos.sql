-- MSF-405 · F-STK-17 (épica MSF-368, spec 20261024-130000-stock-carga-exportacion-y-avisos, FR-308/FR-309):
-- cola y registro del aviso de reposición de cada línea faltante.
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.faltantes_avisos             dominio (nueva)     estado del aviso por línea faltante: dato del
--                                                            producto → `dominio`, nunca `public`.
--   dominio.comprobantes_venta_lineas    dominio (existente) solo se referencia.
--
-- Orden de archivos: esta migración va ANTES de la vista `faltantes_listado` (20261213100300) porque la
-- vista lee `faltantes_avisos`.
--
-- Versión: las tres migraciones de esta historia usan una versión nueva y mayor (20261213100200…) porque
-- `2026120612…` ya quedó por debajo de la cola aplicada en dokploy: con la versión vieja la migración no
-- se aplicaba nunca (guard `scripts/verificar-migraciones.mjs`: versión REUSADA). T025–T027 de tasks.md
-- nombran las versiones viejas; el orden de dependencia se mantiene (tabla → vista → RPC).
--
-- Diseño:
--   * Una fila por línea (`linea_id` es la clave: idempotente). La escribe SOLO `avisar_faltantes`
--     (20261213100400) y las RPC de la Edge Function `enviar-aviso-faltante`.
--   * Estados: `pendiente` (en cola o en reintento; `ultimo_error` guarda el último fallo), `enviado` y
--     `agotado` (se llegó al tope de intentos: la línea vuelve a «Sin avisar» y el error queda registrado).
--     Una línea `agotado` puede avisarse de nuevo (reinicia la cola).
--   * El correo es UNO por cliente: `tomar_aviso_faltante(cliente)` junta todas las líneas pendientes del
--     cliente, cuenta el intento y las reserva 2 minutos (dos barridos simultáneos no mandan el mismo
--     correo; la reserva también es la espera del reintento). El SQL no hace HTTP
--     (docs/adoptar-ciclo-ejecuciones.md §3.1): el barrido lo dispara el flow de Kestra `avisos-faltantes`.
--   * Solo se avisa de faltantes ABiertos: si la reserva se liberó o descontó antes de salir el correo
--     (el faltante se cierra solo, FR-302), la línea en cola vuelve a «Sin avisar» con el motivo y no se
--     manda nada. Lo decide `private.faltante_abierta`, el mismo criterio de la vista del listado.
--
-- Seguridad:
--   * RLS por organización y tienda: lectura con `ventas` en lectura/edición en esa empresa. SIN insert,
--     update ni delete para `authenticated`; `anon` sin privilegios.
--   * Las tres RPC son solo de `service_role` (`revoke … from public, anon, authenticated`).
--   * `private.nivel_ventas_en_empresa` pasa a ser ejecutable por `authenticated`: la usan esta política y
--     la vista `faltantes_listado` (security_invoker). Es `security definer`, solo informa el nivel de
--     quien llama y no recibe datos ajenos.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes `dominio.faltantes_avisos`):
--   drop function public.faltantes_avisos_pendientes(integer, integer);
--   drop function public.tomar_aviso_faltante(uuid, integer);
--   drop function public.cerrar_aviso_faltante(uuid, boolean, text, integer);
--   drop function private.faltante_abierta(uuid);
--   drop table dominio.faltantes_avisos;
--   revoke execute on function private.nivel_ventas_en_empresa(uuid) from authenticated;

grant execute on function private.nivel_ventas_en_empresa(uuid) to authenticated;

create table dominio.faltantes_avisos (
  linea_id uuid primary key references dominio.comprobantes_venta_lineas (id) on delete cascade,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null,
  cliente_id uuid not null references public.clientes (id) on delete cascade,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'agotado')),
  intentos integer not null default 0 check (intentos >= 0),
  ultimo_error text check (ultimo_error is null or length(ultimo_error) <= 500),
  enviado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint faltantes_avisos_empresa_fk foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade
);

comment on table dominio.faltantes_avisos is
  'F-STK-17: aviso de reposición por línea faltante (uno por línea). Solo lo escriben avisar_faltantes y las RPC de service_role de la función enviar-aviso-faltante.';
comment on column dominio.faltantes_avisos.intentos is
  'Intentos de envío tomados (los cuenta tomar_aviso_faltante); el tope lo fija la función.';

create index if not exists faltantes_avisos_pendientes_idx on dominio.faltantes_avisos (cliente_id, updated_at)
  where estado = 'pendiente';
create index if not exists faltantes_avisos_organizacion_idx on dominio.faltantes_avisos (organizacion_id);
create index if not exists faltantes_avisos_empresa_idx on dominio.faltantes_avisos (empresa_id);
create index if not exists faltantes_avisos_cliente_idx on dominio.faltantes_avisos (cliente_id);

alter table dominio.faltantes_avisos enable row level security;

create policy faltantes_avisos_select on dominio.faltantes_avisos
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_ventas_en_empresa(empresa_id)) in ('lectura', 'edicion')
  );

revoke all on dominio.faltantes_avisos from public, anon, authenticated;
grant select on dominio.faltantes_avisos to authenticated;

-- ============================================================================
-- RPC de la Edge Function (solo service_role)
-- ============================================================================

-- Un faltante sigue ABIERTO mientras su línea sea de una factura confirmada «A pedido» y su reserva
-- (referencia `comprobante:<id>:linea:<orden>`) siga activa. Mismo criterio que la vista
-- `public.faltantes_listado`, sin el filtro por persona: lo usan las RPC de la cola, que barren para todas
-- las organizaciones (service_role). `security definer`: no depende de la RLS de quien llama.
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
  );
$$;

revoke execute on function private.faltante_abierta(uuid) from public, anon, authenticated;

comment on function private.faltante_abierta(uuid) is
  'MSF-405: el faltante de la línea sigue abierto (factura confirmada «A pedido» con reserva activa). La usan las RPC de la cola de avisos (service_role).';

-- Clientes con avisos por enviar o reintentar: líneas pendientes sin tocar, o ya intentadas cuya reserva
-- venció (bajo el tope, o en el tope para que `tomar` las cierre como agotadas y no se pierdan).
-- `p_tope` se acepta para simetría con `tomar_aviso_faltante`: el tope se aplica al tomar y al cerrar, no
-- al listar (una línea en el tope tiene que seguir listándose para que `tomar` la cierre como agotada).
create or replace function public.faltantes_avisos_pendientes(p_tope integer default 5, p_limite integer default 50)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(x.cliente_id), '{}'::uuid[])
  from (
    select a.cliente_id
    from dominio.faltantes_avisos a
    where a.estado = 'pendiente'
      and (a.intentos = 0 or a.updated_at <= now() - interval '2 minutes')
    group by a.cliente_id
    order by min(a.created_at)
    limit least(greatest(coalesce(p_limite, 50), 1), 200)
  ) x;
$$;

-- Toma los avisos pendientes de un cliente para mandarle UN correo con todos sus faltantes. Sin filas =
-- nada que enviar ahora (otra invocación lo tiene reservado, ya se envió, el faltante se cerró o no quedó
-- nada vigente).
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

  -- El faltante se cerró antes de salir el correo (reserva liberada o descontada): no se avisa de un
  -- faltante que ya no existe (FR-302: el faltante se cierra solo, sin cierre manual). La línea vuelve a
  -- «Sin avisar» con el motivo; una línea en vuelo (intento tomado hace menos de 2 minutos) no se toca:
  -- ese correo ya salió y lo cierra el envío que lo tomó.
  update dominio.faltantes_avisos a
     set estado = 'agotado',
         ultimo_error = 'El faltante se cerró antes de enviar el aviso',
         updated_at = now()
   where a.cliente_id = p_cliente and a.estado = 'pendiente'
     and (a.intentos = 0 or a.updated_at <= now() - interval '2 minutes')
     and not private.faltante_abierta(a.linea_id);

  select array_agg(a.linea_id order by a.created_at, a.linea_id) into v_ids
    from dominio.faltantes_avisos a
   where a.cliente_id = p_cliente and a.estado = 'pendiente'
     and a.intentos < v_tope
     and (a.intentos = 0 or a.updated_at <= now() - interval '2 minutes')
     and private.faltante_abierta(a.linea_id);
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
             'producto', p.nombre, 'sku', p.sku, 'cantidad', l.cantidad, 'comprobante', c.numero
           ) order by c.numero, l.orden)
      from dominio.faltantes_avisos a
      join dominio.comprobantes_venta_lineas l on l.id = a.linea_id
      join dominio.comprobantes_venta c on c.id = l.comprobante_id and c.organizacion_id = l.organizacion_id
      join dominio.productos p on p.id = l.producto_id and p.organizacion_id = l.organizacion_id
     where a.linea_id = any (v_ids);
end;
$$;

-- Cierra los avisos tomados de un cliente: enviado, o fallido (queda pendiente para el reintento y, al
-- llegar al tope, agotado: vuelve a «Sin avisar» con el error útil, sin datos personales).
create or replace function public.cerrar_aviso_faltante(
  p_cliente uuid,
  p_enviado boolean,
  p_error text default null,
  p_tope integer default 5
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tope integer := greatest(coalesce(p_tope, 5), 1);
  v_error text := left(nullif(btrim(coalesce(p_error, '')), ''), 500);
begin
  if p_enviado then
    update dominio.faltantes_avisos a
       set estado = 'enviado', enviado_en = now(), ultimo_error = null, updated_at = now()
     where a.cliente_id = p_cliente and a.estado = 'pendiente' and a.intentos > 0;
  else
    -- No se toca `updated_at`: la reserva de 2 minutos corre desde la toma y es la espera del reintento.
    update dominio.faltantes_avisos a
       set estado = case when a.intentos >= v_tope then 'agotado' else 'pendiente' end,
           ultimo_error = coalesce(v_error, 'Error de envío sin detalle')
     where a.cliente_id = p_cliente and a.estado = 'pendiente' and a.intentos > 0;
  end if;
end;
$$;

revoke execute on function public.faltantes_avisos_pendientes(integer, integer) from public, anon, authenticated;
revoke execute on function public.tomar_aviso_faltante(uuid, integer) from public, anon, authenticated;
revoke execute on function public.cerrar_aviso_faltante(uuid, boolean, text, integer) from public, anon, authenticated;
grant execute on function public.faltantes_avisos_pendientes(integer, integer) to service_role;
grant execute on function public.tomar_aviso_faltante(uuid, integer) to service_role;
grant execute on function public.cerrar_aviso_faltante(uuid, boolean, text, integer) to service_role;

comment on function public.tomar_aviso_faltante(uuid, integer) is
  'MSF-405: reserva los avisos pendientes de un cliente para mandarle un correo (cuenta el intento). Solo service_role (Edge Function enviar-aviso-faltante).';
comment on function public.cerrar_aviso_faltante(uuid, boolean, text, integer) is
  'MSF-405: marca como enviados o fallidos los avisos tomados de un cliente; al llegar al tope quedan agotados. Solo service_role.';
comment on function public.faltantes_avisos_pendientes(integer, integer) is
  'MSF-405: ids de clientes con avisos de faltantes por enviar o reintentar. Solo service_role.';
