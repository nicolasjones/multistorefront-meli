-- MSF-207 · F-CON-03 (épica MSF-122, spec 20261023-120000-consultas-bandeja-y-aviso, FR-011/FR-012):
-- cola de avisos por correo de cada consulta nueva.
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.consultas_avisos  dominio (nueva)  registro del aviso de una consulta (estado,
--                                              intentos, error útil): dato del producto → `dominio`.
--   dominio.consultas         dominio (existente, F-CON-01), solo se referencia.
--
-- Diseño:
--   * Un disparador AFTER INSERT en `dominio.consultas` encola UN aviso por consulta en la misma
--     transacción del alta (`consulta_id` es la clave: idempotente, sin pérdida).
--   * Decisión abierta 4: el repo prohíbe disparar HTTP desde SQL (`pg_net`, ver
--     docs/adoptar-ciclo-ejecuciones.md §3.1), así que el disparador SOLO encola. El envío lo hace la
--     Edge Function `enviar-aviso-consulta`, invocada por un flow de Kestra que barre los pendientes
--     (infra/kestra/flows/avisos-consultas.yml). Un fallo de envío nunca toca la consulta.
--   * La función toma el aviso con `tomar_aviso_consulta` (cuenta el intento y reserva el aviso 2
--     minutos, así dos barridos simultáneos no mandan el mismo correo) y lo cierra con
--     `cerrar_aviso_consulta`. Las tres RPC son solo de `service_role`.
--
-- Seguridad:
--   * RLS por organización; lectura solo con `empresas` = edición y empresa accesible.
--   * SIN insert, update ni delete desde la app. `anon` y `authenticated` sin ejecución sobre las RPC.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop trigger consultas_encolar_aviso on dominio.consultas;
--   drop function private.encolar_aviso_consulta();
--   drop function public.avisos_consulta_pendientes(integer, integer);
--   drop function public.tomar_aviso_consulta(uuid, integer);
--   drop function public.cerrar_aviso_consulta(uuid, boolean, text);
--   drop table dominio.consultas_avisos;

create table dominio.consultas_avisos (
  consulta_id uuid primary key references dominio.consultas (id) on delete cascade,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'enviado', 'fallido', 'sin_destinatario')),
  intentos integer not null default 0 check (intentos >= 0),
  ultimo_error text check (ultimo_error is null or length(ultimo_error) <= 500),
  enviado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint consultas_avisos_empresa_fk foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade
);

comment on table dominio.consultas_avisos is
  'F-CON-03: cola y registro del aviso por correo de cada consulta (uno por consulta). Se encola por disparador; solo lo escriben las RPC de service_role de la función enviar-aviso-consulta.';
comment on column dominio.consultas_avisos.intentos is
  'Intentos de envío tomados (los cuenta tomar_aviso_consulta); el tope lo fija la función.';

create index if not exists consultas_avisos_pendientes_idx on dominio.consultas_avisos (created_at)
  where estado in ('pendiente', 'fallido');
create index if not exists consultas_avisos_organizacion_id_idx on dominio.consultas_avisos (organizacion_id);
create index if not exists consultas_avisos_empresa_id_idx on dominio.consultas_avisos (empresa_id);

alter table dominio.consultas_avisos enable row level security;

create policy consultas_avisos_select on dominio.consultas_avisos
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (select private.nivel_seccion('empresas')) = 'edicion'
  );

revoke all on dominio.consultas_avisos from public, anon, authenticated;
grant select on dominio.consultas_avisos to authenticated;

-- ============================================================================
-- Disparador: encola el aviso en la misma transacción del alta
-- ============================================================================

create or replace function private.encolar_aviso_consulta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into dominio.consultas_avisos (consulta_id, organizacion_id, empresa_id)
  values (new.id, new.organizacion_id, new.empresa_id)
  on conflict (consulta_id) do nothing;
  return new;
end;
$$;

revoke execute on function private.encolar_aviso_consulta() from public, anon, authenticated;

create trigger consultas_encolar_aviso
  after insert on dominio.consultas
  for each row execute function private.encolar_aviso_consulta();

-- ============================================================================
-- RPC de la Edge Function (solo service_role)
-- ============================================================================

-- Avisos que el barrido debe procesar: pendientes sin tocar, o ya intentados cuya reserva venció
-- (la reserva de 2 minutos también es la espera entre reintentos), bajo el tope de intentos.
create or replace function public.avisos_consulta_pendientes(p_tope integer default 5, p_limite integer default 50)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.consulta_id
  from dominio.consultas_avisos a
  where a.estado in ('pendiente', 'fallido')
    and a.intentos < greatest(coalesce(p_tope, 5), 1)
    and (a.intentos = 0 or a.updated_at <= now() - interval '2 minutes')
  order by a.created_at
  limit least(greatest(coalesce(p_limite, 50), 1), 200);
$$;

-- Toma el aviso para enviarlo. `resultado`: enviar | ya_enviado | sin_destinatario | agotado |
-- en_proceso | no_existe. Solo con `enviar` vienen los datos del correo.
create or replace function public.tomar_aviso_consulta(p_consulta_id uuid, p_tope integer default 5)
returns table (
  resultado text,
  destinatario text,
  empresa_nombre text,
  origen text,
  nombre text,
  contacto text,
  mensaje text,
  producto_nombre text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_aviso dominio.consultas_avisos%rowtype;
  v_tope integer := greatest(coalesce(p_tope, 5), 1);
  v_destino text;
begin
  select * into v_aviso from dominio.consultas_avisos a where a.consulta_id = p_consulta_id for update;
  if not found then
    return query select 'no_existe'::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;
  if v_aviso.estado = 'enviado' then
    return query select 'ya_enviado'::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;
  if v_aviso.estado = 'sin_destinatario' then
    return query select 'sin_destinatario'::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;
  if v_aviso.intentos >= v_tope then
    return query select 'agotado'::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;
  -- Reservado por otra invocación que todavía puede estar enviando.
  if v_aviso.intentos > 0 and v_aviso.updated_at > now() - interval '2 minutes' then
    return query select 'en_proceso'::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  v_destino := private.correo_avisos_consulta(v_aviso.empresa_id);
  if v_destino is null then
    update dominio.consultas_avisos
       set estado = 'sin_destinatario', ultimo_error = null, updated_at = now()
     where consulta_id = p_consulta_id;
    return query select 'sin_destinatario'::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  update dominio.consultas_avisos
     set estado = 'pendiente', intentos = intentos + 1, updated_at = now()
   where consulta_id = p_consulta_id;

  return query
    select 'enviar'::text, v_destino, e.nombre, c.origen, c.nombre, c.contacto, c.mensaje, p.nombre
      from dominio.consultas c
      join dominio.empresas e on e.id = c.empresa_id
      left join dominio.productos p on p.id = c.producto_id
     where c.id = p_consulta_id;
end;
$$;

-- Cierra un aviso tomado: `enviado` o `fallido` (con el error útil, sin datos del visitante).
-- Solo actúa sobre un aviso pendiente (tomado): un cierre repetido no pisa un `enviado`.
create or replace function public.cerrar_aviso_consulta(p_consulta_id uuid, p_enviado boolean, p_error text default null)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_estado text;
begin
  update dominio.consultas_avisos
     set estado = case when p_enviado then 'enviado' else 'fallido' end,
         enviado_en = case when p_enviado then now() else enviado_en end,
         ultimo_error = case when p_enviado then null else left(nullif(btrim(coalesce(p_error, '')), ''), 500) end,
         updated_at = now()
   where consulta_id = p_consulta_id and estado = 'pendiente'
  returning estado into v_estado;
  return v_estado;
end;
$$;

revoke execute on function public.avisos_consulta_pendientes(integer, integer) from public, anon, authenticated;
revoke execute on function public.tomar_aviso_consulta(uuid, integer) from public, anon, authenticated;
revoke execute on function public.cerrar_aviso_consulta(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.avisos_consulta_pendientes(integer, integer) to service_role;
grant execute on function public.tomar_aviso_consulta(uuid, integer) to service_role;
grant execute on function public.cerrar_aviso_consulta(uuid, boolean, text) to service_role;

comment on function public.tomar_aviso_consulta(uuid, integer) is
  'MSF-207: reserva el aviso de una consulta para enviarlo (cuenta el intento). Solo service_role (Edge Function enviar-aviso-consulta).';
comment on function public.cerrar_aviso_consulta(uuid, boolean, text) is
  'MSF-207: marca el aviso tomado como enviado o fallido. Solo service_role.';
comment on function public.avisos_consulta_pendientes(integer, integer) is
  'MSF-207: ids de consultas con aviso por enviar o reintentar bajo el tope. Solo service_role.';
