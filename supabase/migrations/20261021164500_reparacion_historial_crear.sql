-- F-SVC-02 (MSF-283, épica MSF-182): historial de la reparación y alta (`crear_reparacion`).
-- Esquema (Principio VII): `dominio.reparacion_historial` es parte del dominio del producto
-- (bitácora de cada reparación) → `dominio`. Las funciones viven en `public` (RPC) y `private`.
--
-- Historial: solo lectura para el llamador (RLS por organización y nivel; sin grants de escritura).
-- Lo escriben las RPC `security definer` en la misma transacción que la operación. Tipos `alta`,
-- `estado`, `entrega` y `anulacion` (los tres últimos los usa F-SVC-03).
--
-- `crear_reparacion` es SECURITY DEFINER (la tabla no admite insert directo): valida a mano la
-- organización de la sesión, el nivel `edicion` de `service_tecnico`, la tienda accesible, y que
-- cliente, modelo activo y técnico sean de la organización. Los costos solo se aceptan con la
-- acción `ver_costos`. La organización sale de la sesión, nunca del llamador.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los datos):
--   drop function public.crear_reparacion(uuid, uuid, uuid, text, text, text, text, numeric, numeric, uuid, date);
--   drop function private.reparacion_json(uuid);
--   drop function private.es_tecnico_de_service(uuid);
--   drop table dominio.reparacion_historial;

create table dominio.reparacion_historial (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  reparacion_id uuid not null,
  tipo text not null check (tipo in ('alta', 'estado', 'entrega', 'anulacion')),
  estado_anterior_id uuid,
  estado_nuevo_id uuid,
  nota text check (nota is null or length(nota) <= 500),
  usuario_id uuid references auth.users (id) on delete set null,
  creado_en timestamptz not null default now(),
  constraint reparacion_historial_reparacion_fk foreign key (reparacion_id, organizacion_id)
    references dominio.reparaciones (id, organizacion_id),
  constraint reparacion_historial_anterior_fk foreign key (estado_anterior_id, organizacion_id)
    references dominio.estados_reparacion (id, organizacion_id),
  constraint reparacion_historial_nuevo_fk foreign key (estado_nuevo_id, organizacion_id)
    references dominio.estados_reparacion (id, organizacion_id)
);

comment on table dominio.reparacion_historial is
  'Bitácora de cada reparación (F-SVC-02). Solo lectura: la escriben las RPC en la misma transacción.';

create index IF NOT EXISTS reparacion_historial_reparacion_idx
  on dominio.reparacion_historial (reparacion_id, creado_en desc);

alter table dominio.reparacion_historial enable row level security;

create policy reparacion_historial_select on dominio.reparacion_historial
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('service_tecnico')) in ('lectura', 'edicion')
  );

grant usage on schema dominio to authenticated;

revoke all on dominio.reparacion_historial from public, anon, authenticated;
grant select on dominio.reparacion_historial to authenticated;

-- ¿Es el usuario un técnico elegible? Miembro activo de la organización de la sesión con
-- `service_tecnico` en `edicion` según su rol de organización.
create or replace function private.es_tecnico_de_service(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.usuarios_organizacion u
     where u.user_id = p_user_id
       and u.organizacion_id = (select private.organizacion_id())
       and u.estado = 'activo'
       and private.nivel_de_rol(u.organizacion_id, u.rol_id, 'service_tecnico') = 'edicion'
  );
$$;

revoke execute on function private.es_tecnico_de_service(uuid) from public, anon, authenticated;

-- Reparación como JSON para la pantalla. Enmascara los costos internos sin `ver_costos`
-- (llegan nulos). Solo devuelve filas de la organización de la sesión.
create or replace function private.reparacion_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id,
    'numero', r.numero,
    'codigo', private.codigo_reparacion(r.numero),
    'empresa_id', r.empresa_id,
    'empresa', e.nombre,
    'cliente_id', r.cliente_id,
    'cliente', c.nombre,
    'contacto', r.contacto,
    'modelo_id', r.modelo_id,
    'equipo', m.equipo,
    'modelo', m.modelo,
    'estado_id', r.estado_id,
    'estado', s.nombre,
    'estado_cierra', s.cierra,
    'estado_tono', s.tono,
    'numero_serie', r.numero_serie,
    'accesorios', r.accesorios,
    'falla', r.falla,
    'puede_ver_costos', v.ver,
    'costo_mano_obra', case when v.ver then r.costo_mano_obra end,
    'costo_repuestos', case when v.ver then r.costo_repuestos end,
    'tecnico_id', r.tecnico_id,
    'ingreso_en', r.ingreso_en,
    'entrega_prevista', r.entrega_prevista,
    'entrega_real', r.entrega_real,
    'entregado_por', r.entregado_por,
    'anulada_en', r.anulada_en,
    'anulada_motivo', r.anulada_motivo,
    'updated_at', r.updated_at
  )
  from dominio.reparaciones r
  join dominio.empresas e on e.id = r.empresa_id
  join public.clientes c on c.id = r.cliente_id and c.organizacion_id = r.organizacion_id
  join dominio.modelos_equipo m on m.id = r.modelo_id and m.organizacion_id = r.organizacion_id
  join dominio.estados_reparacion s on s.id = r.estado_id and s.organizacion_id = r.organizacion_id
  cross join (select private.puede_accion('service_tecnico', 'ver_costos') as ver) v
  where r.id = p_id
    and r.organizacion_id = (select private.organizacion_id());
$$;

revoke execute on function private.reparacion_json(uuid) from public, anon, authenticated;

create or replace function public.crear_reparacion(
  p_empresa_id uuid,
  p_cliente_id uuid,
  p_modelo_id uuid,
  p_contacto text default '',
  p_numero_serie text default null,
  p_accesorios text default '',
  p_falla text default '',
  p_costo_mano_obra numeric default null,
  p_costo_repuestos numeric default null,
  p_tecnico_id uuid default null,
  p_entrega_prevista date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_estado uuid;
  v_numero integer;
  v_id uuid;
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede crear reparaciones' using errcode = '42501';
  end if;
  if p_empresa_id is null then
    raise exception 'Elegí la tienda' using errcode = '22023', hint = 'empresa_id';
  end if;
  if not exists (select 1 from private.empresas_accesibles() a(id) where a.id = p_empresa_id) then
    raise exception 'No tenés acceso a esa tienda' using errcode = '42501';
  end if;
  if p_cliente_id is null then
    raise exception 'Elegí el cliente' using errcode = '22023', hint = 'cliente_id';
  end if;
  if not exists (
    select 1 from public.clientes c
     where c.id = p_cliente_id and c.organizacion_id = v_org and c.archivado_en is null
  ) then
    raise exception 'El cliente no existe o está archivado' using errcode = '22023', hint = 'cliente_id';
  end if;
  if p_modelo_id is null then
    raise exception 'Elegí el modelo' using errcode = '22023', hint = 'modelo_id';
  end if;
  if not exists (
    select 1 from dominio.modelos_equipo m
     where m.id = p_modelo_id and m.organizacion_id = v_org and m.activo
  ) then
    raise exception 'El modelo no existe o está desactivado' using errcode = '22023', hint = 'modelo_id';
  end if;
  if p_costo_mano_obra < 0 then
    raise exception 'El costo de mano de obra no puede ser negativo' using errcode = '22023', hint = 'costo_mano_obra';
  end if;
  if p_costo_repuestos < 0 then
    raise exception 'El costo de repuestos no puede ser negativo' using errcode = '22023', hint = 'costo_repuestos';
  end if;
  if (p_costo_mano_obra is not null or p_costo_repuestos is not null)
     and not (select private.puede_accion('service_tecnico', 'ver_costos')) then
    raise exception 'Tu rol no puede cargar costos internos' using errcode = '42501';
  end if;
  if p_tecnico_id is not null and not private.es_tecnico_de_service(p_tecnico_id) then
    raise exception 'El técnico no es válido' using errcode = '22023', hint = 'tecnico_id';
  end if;
  if p_entrega_prevista is not null and p_entrega_prevista < v_hoy then
    raise exception 'La entrega prevista no puede ser anterior al ingreso' using errcode = '22023', hint = 'entrega_prevista';
  end if;

  -- Primer estado activo por `orden` (FR-013).
  select s.id into v_estado
    from dominio.estados_reparacion s
   where s.organizacion_id = v_org and s.activo
   order by s.orden, s.id
   limit 1;
  if v_estado is null then
    raise exception 'No hay estados de reparación activos: activá uno en Estados de reparación' using errcode = '22023';
  end if;

  v_numero := private.siguiente_numero_reparacion(p_empresa_id);

  insert into dominio.reparaciones (
    organizacion_id, empresa_id, numero, cliente_id, contacto, modelo_id, estado_id, numero_serie,
    accesorios, falla, costo_mano_obra, costo_repuestos, tecnico_id, ingreso_en, entrega_prevista
  ) values (
    v_org, p_empresa_id, v_numero, p_cliente_id, coalesce(p_contacto, ''), p_modelo_id, v_estado,
    p_numero_serie, coalesce(p_accesorios, ''), coalesce(p_falla, ''),
    coalesce(p_costo_mano_obra, 0), coalesce(p_costo_repuestos, 0), p_tecnico_id, v_hoy, p_entrega_prevista
  )
  returning id into v_id;

  insert into dominio.reparacion_historial (organizacion_id, reparacion_id, tipo, estado_nuevo_id, usuario_id)
  values (v_org, v_id, 'alta', v_estado, (select auth.uid()));

  return private.reparacion_json(v_id);
end;
$$;

comment on function public.crear_reparacion(uuid, uuid, uuid, text, text, text, text, numeric, numeric, uuid, date) is
  'F-SVC-02: alta de reparación (número por empresa, primer estado activo, ingreso de hoy, evento alta). Solo con edición en Service técnico; costos solo con ver_costos.';

revoke execute on function public.crear_reparacion(uuid, uuid, uuid, text, text, text, text, numeric, numeric, uuid, date) from public, anon;
grant execute on function public.crear_reparacion(uuid, uuid, uuid, text, text, text, text, numeric, numeric, uuid, date) to authenticated;
