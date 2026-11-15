-- Seguridad retroactiva de #1011 (exportar_clientes): el evento `clientes.exportados` solo se registraba en el primer lote
-- (`p_despues_de` nulo) y el tope de 50000 filas solo se validaba ahí. Con cualquier cursor se descargaban todos los
-- clientes (documento, correo, teléfono) sin dejar rastro y sin tope.
--
-- Diseño (decisión delegada, 2026-11-15):
--   * Cada llamada que devuelve filas cuenta. Se lleva una ventana de 10 minutos por persona, organización y filtros
--     (tabla `private.clientes_exportaciones_ventana`, sin acceso para los roles de la API) con las filas entregadas
--     (`filas_acumuladas`) y las ya declaradas en eventos (`filas_declaradas`).
--   * Deduplicación: el primer lote de una exportación declara el total de la exportación (como antes: un evento por
--     exportación completa). Los lotes con cursor suman a la ventana y solo generan un evento NUEVO por las filas que
--     superen lo ya declarado (p. ej. quien descarga con cursor sin haber pedido el primer lote). Una exportación paginada
--     normal sigue dejando un solo evento. `registro_actividad` es inalterable (trigger), por eso no se actualiza el
--     detalle de un evento ya escrito: lo que excede se registra como un evento adicional «(continuación)».
--   * Topes (por organización y PERSONA, sin importar los filtros: variar texto, tipo o archivados no abre un cupo nuevo):
--       - ventana deslizante de 10 minutos: 50000 filas entregadas;
--       - tope DIARIO (24 horas deslizantes): 200000 filas entregadas.
--     Los valores viven en `private.tope_exportacion_clientes(text)` para ajustarlos sin tocar la función (aún sin criterio
--     de negocio definitivo: son una constante conservadora, 4 exportaciones completas por día).
--     Al pasarlos la llamada falla con 54000 y `hint` = 'tope_acumulado' (ventana) o 'tope_diario'; el 54000 de una sola
--     exportación demasiado grande (lote) no lleva hint. No entrega filas y no cuenta (la transacción se revierte).
--     Las entregas se llevan en `private.clientes_exportaciones_entregas` (una fila por llamada con filas).
--   * Rechazo temprano: en el primer lote (sin cursor) el servidor ya conoce el total a exportar; si lo ya entregado en la
--     ventana (o en el día) más ese total supera el tope, rechaza el primer lote sin entregar filas ni contar, para que
--     nadie descargue una parte inútil. Un cursor sin primer lote sigue topando por lote.
--   * Sin perdón por reintento: repetir el primer lote cuenta doble contra la ventana y contra el día (comportamiento
--     esperado). Así repetir el primer lote no libera cupo ni permite volver a bajar por cursor con la ventana llena.
--   * La huella de filtros queda solo para deduplicar los eventos de auditoría y calcular lo «declarado».
--   * Privacidad (menor 2): el texto de búsqueda ya no se escribe en la actividad (podía ser un DNI, correo o teléfono):
--     el detalle solo dice «con texto».
--
-- Misma firma, mismo resultado y mismos privilegios: el cliente web no cambia (sigue paginando con cursor).
-- Esquemas (Principio VII): tabla nueva en `private` (infraestructura de control, sin exposición a la API; RLS activa sin
-- políticas), igual que `private.exportaciones_actividad`.
--
-- Reversión (migración posterior): volver a crear `public.exportar_clientes` con la definición de
-- `20270324110000_exportar_clientes_registra_actividad.sql` y luego
--   drop table private.clientes_exportaciones_entregas; drop function private.tope_exportacion_clientes(text);
--   drop table private.clientes_exportaciones_ventana;

create table if not exists private.clientes_exportaciones_ventana (
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  actor_id uuid not null,
  -- Huella de los filtros (nunca el texto en claro).
  filtros_hash text not null,
  desde timestamptz not null default now(),
  filas_acumuladas integer not null default 0,
  filas_declaradas integer not null default 0,
  primary key (organizacion_id, actor_id, filtros_hash)
);
comment on table private.clientes_exportaciones_ventana is
  'Ventana de 10 minutos por persona y filtros de la exportación de clientes: filas entregadas y filas ya declaradas en la actividad. Solo deduplica los eventos de auditoría (filas declaradas); los topes viven en clientes_exportaciones_entregas.';
create index if not exists clientes_exportaciones_ventana_desde_idx on private.clientes_exportaciones_ventana (desde);
alter table private.clientes_exportaciones_ventana enable row level security;
revoke all on private.clientes_exportaciones_ventana from public, anon, authenticated;

create table if not exists private.clientes_exportaciones_entregas (
  id bigint generated always as identity primary key,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  actor_id uuid not null,
  filtros_hash text not null,
  filas integer not null check (filas > 0),
  creado_en timestamptz not null default now()
);
comment on table private.clientes_exportaciones_entregas is
  'Filas de clientes entregadas por llamada a exportar_clientes, por organización y persona. Base de los topes de ventana (10 minutos) y diario (24 horas). Se purga a las 24 horas.';
create index if not exists clientes_exportaciones_entregas_actor_idx
  on private.clientes_exportaciones_entregas (organizacion_id, actor_id, creado_en desc);
create index if not exists clientes_exportaciones_entregas_creado_idx on private.clientes_exportaciones_entregas (creado_en);
alter table private.clientes_exportaciones_entregas enable row level security;
revoke all on private.clientes_exportaciones_entregas from public, anon, authenticated;

-- Topes de la exportación de clientes por persona. Constantes en una función para poder ajustarlas sin redefinir
-- exportar_clientes. 'ventana': filas en 10 minutos deslizantes; 'dia': filas en 24 horas deslizantes.
create or replace function private.tope_exportacion_clientes(p_periodo text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_periodo when 'ventana' then 50000 when 'dia' then 200000 end;
$$;
revoke execute on function private.tope_exportacion_clientes(text) from public, anon, authenticated;

create or replace function public.exportar_clientes(
  p_texto text default null,
  p_tipo text default null,
  p_archivados boolean default false,
  p_despues_de uuid default null,
  p_limite integer default 1000,
  p_empresa_id uuid default null,
  p_con_cuenta_web boolean default false
)
returns table (
  id uuid,
  numero integer,
  nombre text,
  documento text,
  tipo text,
  correo text,
  telefono text,
  celular text,
  direccion text,
  codigo_postal text,
  localidad text,
  provincia text,
  expreso_preferido text,
  archivado_en timestamptz,
  total bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fila record;
  v_total bigint := 0;
  v_n integer := 0;
  v_texto text := nullif(btrim(coalesce(p_texto, '')), '');
  v_filtros text[] := '{}';
  v_tienda text;
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_hash text;
  v_acumuladas integer;
  v_declaradas integer;
  v_incremento bigint;
  v_en_ventana bigint;
  v_en_dia bigint;
  v_a_entregar bigint;
begin
  -- El permiso, el tope por exportación y el cursor los valida el lote; buffer de filas: si algo falla más abajo,
  -- la función entera se revierte y no se entrega nada.
  for v_fila in
    select * from private.exportar_clientes_lote(p_texto, p_tipo, p_archivados, p_despues_de, p_limite, p_empresa_id, p_con_cuenta_web)
  loop
    v_n := v_n + 1;
    if p_despues_de is null then v_total := v_fila.total; end if;
    id := v_fila.id; numero := v_fila.numero; nombre := v_fila.nombre; documento := v_fila.documento;
    tipo := v_fila.tipo; correo := v_fila.correo; telefono := v_fila.telefono; celular := v_fila.celular;
    direccion := v_fila.direccion; codigo_postal := v_fila.codigo_postal; localidad := v_fila.localidad;
    provincia := v_fila.provincia; expreso_preferido := v_fila.expreso_preferido;
    archivado_en := v_fila.archivado_en; total := v_fila.total;
    return next;
  end loop;

  if v_n = 0 then
    return;
  end if;

  if v_org is null or v_actor is null then
    raise exception 'Se necesita una sesión con organización para exportar clientes' using errcode = '42501';
  end if;

  v_hash := encode(sha256(convert_to(concat_ws('|',
    coalesce(p_tipo, ''), coalesce(p_archivados, false)::text, coalesce(p_empresa_id::text, ''),
    coalesce(p_con_cuenta_web, false)::text, coalesce(lower(v_texto), '')), 'UTF8')), 'hex');

  -- Purga acotada (500 filas por llamada): las tablas de control no crecen sin límite.
  delete from private.clientes_exportaciones_ventana w
   where w.ctid in (select v.ctid from private.clientes_exportaciones_ventana v where v.desde < now() - interval '1 day' limit 500);
  delete from private.clientes_exportaciones_entregas e
   where e.id in (select v.id from private.clientes_exportaciones_entregas v where v.creado_en < now() - interval '1 day' limit 500);

  -- Un solo cupo por organización y persona: dos llamadas simultáneas no lo superan.
  perform pg_advisory_xact_lock(hashtextextended('exportar_clientes|' || v_org::text || '|' || v_actor::text, 0));

  select coalesce(sum(e.filas) filter (where e.creado_en > now() - interval '10 minutes'), 0),
         coalesce(sum(e.filas) filter (where e.creado_en > now() - interval '1 day'), 0)
    into v_en_ventana, v_en_dia
    from private.clientes_exportaciones_entregas e
   where e.organizacion_id = v_org and e.actor_id = v_actor;

  -- Primer lote: el total de la exportación ya se conoce, se rechaza de entrada si no cabe (sin entregar ni contar).
  -- Con cursor se topa por lote. El reintento del primer lote cuenta doble (no se perdona nada).
  v_a_entregar := case when p_despues_de is null then greatest(v_total, v_n) else v_n end;

  if v_en_ventana + v_a_entregar > private.tope_exportacion_clientes('ventana') then
    raise exception 'Exportaste muchos clientes en poco tiempo: esperá unos minutos antes de volver a exportar'
      using errcode = '54000', hint = 'tope_acumulado';
  end if;
  if v_en_dia + v_a_entregar > private.tope_exportacion_clientes('dia') then
    raise exception 'Llegaste al máximo diario de clientes exportados: volvé a intentar mañana'
      using errcode = '54000', hint = 'tope_diario';
  end if;

  insert into private.clientes_exportaciones_entregas (organizacion_id, actor_id, filtros_hash, filas)
  values (v_org, v_actor, v_hash, v_n);

  -- Deduplicación de los eventos de auditoría (por huella de filtros; no es un tope).
  insert into private.clientes_exportaciones_ventana as w (organizacion_id, actor_id, filtros_hash, desde, filas_acumuladas, filas_declaradas)
  values (v_org, v_actor, v_hash, now(), v_n, 0)
  on conflict (organizacion_id, actor_id, filtros_hash) do update
    set filas_acumuladas = case when w.desde <= now() - interval '10 minutes' then 0 else w.filas_acumuladas end + v_n,
        filas_declaradas = case when w.desde <= now() - interval '10 minutes' then 0 else w.filas_declaradas end,
        desde = case when w.desde <= now() - interval '10 minutes' then now() else w.desde end
  returning w.filas_acumuladas, w.filas_declaradas into v_acumuladas, v_declaradas;

  -- Primer lote: declara la exportación completa. Con cursor: solo lo que exceda lo ya declarado.
  if p_despues_de is null then
    v_incremento := v_total;
  else
    v_incremento := greatest(0, v_acumuladas - v_declaradas);
  end if;

  if v_incremento > 0 then
    update private.clientes_exportaciones_ventana w
       set filas_declaradas = w.filas_declaradas + v_incremento
     where w.organizacion_id = v_org and w.actor_id = v_actor and w.filtros_hash = v_hash;

    if p_tipo is not null then v_filtros := v_filtros || ('tipo ' || left(p_tipo, 20)); end if;
    if coalesce(p_archivados, false) then v_filtros := v_filtros || 'archivados'::text; end if;
    if p_empresa_id is not null then
      select e.nombre into v_tienda from dominio.empresas e
       where e.id = p_empresa_id and e.organizacion_id = v_org;
      v_filtros := v_filtros || ('tienda ' || coalesce(v_tienda, 'no disponible'));
    end if;
    if coalesce(p_con_cuenta_web, false) then v_filtros := v_filtros || 'con cuenta web'::text; end if;
    -- Nunca el valor buscado: puede ser un DNI, un correo o un teléfono.
    if v_texto is not null then v_filtros := v_filtros || 'con texto'::text; end if;

    perform private.registrar_actividad(
      'clientes.exportados',
      left(
        format('Exportó %s %s a Excel%s%s',
          v_incremento,
          case when v_incremento = 1 then 'cliente' else 'clientes' end,
          case when cardinality(v_filtros) = 0 then '' else ' (filtros: ' || array_to_string(v_filtros, ', ') || ')' end,
          case when p_despues_de is null then '' else ' (continuación)' end),
        480)
    );
  end if;
end;
$$;

comment on function public.exportar_clientes(text, text, boolean, uuid, integer, uuid, boolean) is
  'Exportación de clientes por lotes (keyset lower(nombre), id). Envoltorio volatile de private.exportar_clientes_lote (permiso clientes/exportar, tope 50000 por exportación, filtros). Topes por persona sin importar los filtros: 50000 filas en 10 minutos y 200000 por día (private.tope_exportacion_clientes); 54000 con hint tope_acumulado/tope_diario. Evento clientes.exportados por las filas no declaradas (el primer lote declara el total; el cursor suma). El texto buscado no se registra. F-CLI-04.';

revoke execute on function public.exportar_clientes(text, text, boolean, uuid, integer, uuid, boolean) from public, anon;
grant execute on function public.exportar_clientes(text, text, boolean, uuid, integer, uuid, boolean) to authenticated;
