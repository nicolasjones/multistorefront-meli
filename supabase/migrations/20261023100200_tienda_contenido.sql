-- MSF-294 · F-TDA-03 (épica MSF-147, spec 20261022-084830-tienda-dominio-e-identidad,
-- FR-031…FR-036): contenido y textos comerciales de la tienda.
--
-- Esquemas (Principio VII, re-verificado):
--   * `dominio.tienda_contenido` -> `dominio`: textos comerciales de quien vende (entidad de negocio).
--   * `publico.contenido_por_dominio` -> función de lectura anónima en `publico` (sin tablas nuevas).
--   * `public.guardar_tienda_contenido` -> RPC de la app (authenticated) en `public`.
--
-- Límites (D5, ajustables en esta migración): títulos y textos de botón <= 120 caracteres,
-- textos largos <= 300. Todos los textos son texto plano, con espacios recortados; el front los
-- escapa siempre (nunca HTML). Texto vacío = el elemento no se muestra (FR-034).
-- Sin fila en `tienda_contenido` la tienda no muestra textos opcionales.
--
-- RLS por organización: lectura con acceso a Empresas; sin políticas de escritura (la única vía de
-- escritura es la RPC, SECURITY DEFINER con permisos y organización verificados dentro).
-- `anon` no recibe privilegios sobre la tabla; solo ejecuta la función de `publico`.
--
-- Migración aditiva. Reversión (migración posterior, solo mientras no haya datos productivos):
--   drop function publico.contenido_por_dominio(text);
--   drop function public.guardar_tienda_contenido(uuid, text, text, text, text, text, text, text, text);
--   drop trigger tienda_contenido_normalizar on dominio.tienda_contenido;
--   drop function private.normalizar_tienda_contenido();
--   drop table dominio.tienda_contenido;

create schema if not exists publico;
revoke all on schema publico from public;
grant usage on schema publico to anon, authenticated;

-- ============================================================================
-- dominio.tienda_contenido (FR-031, FR-032, FR-033)
-- ============================================================================

create table dominio.tienda_contenido (
  empresa_id uuid primary key,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  titulo text not null default '',
  subtitulo text not null default '',
  texto_boton text not null default '',
  boton_destino text not null default 'catalogo',
  bienvenida text not null default '',
  pie text not null default '',
  aviso_ficha text not null default '',
  texto_boton_contacto text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tienda_contenido_empresa_fk foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade,
  -- Recortados (el trigger los recorta antes de validar).
  constraint tienda_contenido_recortado check (
    titulo = btrim(titulo) and subtitulo = btrim(subtitulo) and texto_boton = btrim(texto_boton)
    and bienvenida = btrim(bienvenida) and pie = btrim(pie) and aviso_ficha = btrim(aviso_ficha)
    and texto_boton_contacto = btrim(texto_boton_contacto)
  ),
  constraint tienda_contenido_limites check (
    char_length(titulo) <= 120
    and char_length(texto_boton) <= 120
    and char_length(texto_boton_contacto) <= 120
    and char_length(subtitulo) <= 300
    and char_length(bienvenida) <= 300
    and char_length(pie) <= 300
    and char_length(aviso_ficha) <= 300
  ),
  -- Lista cerrada (D4): hoy solo «Catálogo completo».
  constraint tienda_contenido_destino check (boton_destino in ('catalogo'))
);

comment on table dominio.tienda_contenido is
  'MSF-294 (F-TDA-03): textos comerciales de la tienda de una empresa (texto plano, recortado, con límites D5). Sin fila = no se muestran textos opcionales. Se escribe solo con public.guardar_tienda_contenido.';
comment on column dominio.tienda_contenido.boton_destino is
  'Lista cerrada de destinos del botón del banner (D4). Hoy: catalogo.';

create index IF NOT EXISTS tienda_contenido_organizacion_id_idx on dominio.tienda_contenido (organizacion_id);

-- Recorta los textos antes de los checks y mantiene updated_at.
create or replace function private.normalizar_tienda_contenido()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.titulo := btrim(coalesce(new.titulo, ''));
  new.subtitulo := btrim(coalesce(new.subtitulo, ''));
  new.texto_boton := btrim(coalesce(new.texto_boton, ''));
  new.bienvenida := btrim(coalesce(new.bienvenida, ''));
  new.pie := btrim(coalesce(new.pie, ''));
  new.aviso_ficha := btrim(coalesce(new.aviso_ficha, ''));
  new.texto_boton_contacto := btrim(coalesce(new.texto_boton_contacto, ''));
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function private.normalizar_tienda_contenido() from public, anon, authenticated;

create trigger tienda_contenido_normalizar
  before insert or update on dominio.tienda_contenido
  for each row execute function private.normalizar_tienda_contenido();

alter table dominio.tienda_contenido enable row level security;

create policy tienda_contenido_select on dominio.tienda_contenido
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('empresas')) in ('lectura', 'edicion')
  );

revoke all on dominio.tienda_contenido from public, anon, authenticated;
grant select on dominio.tienda_contenido to authenticated;

-- ============================================================================
-- public.guardar_tienda_contenido (FR-035)
-- ============================================================================

-- Upsert idempotente: guardar dos veces lo mismo deja el mismo estado y registra una sola vez
-- `tienda.contenido_actualizado` (solo si algo cambió). Valida permisos, empresa de la
-- organización y límites; ante un error no se guarda nada. El `hint` del error nombra el campo.
create or replace function public.guardar_tienda_contenido(
  p_empresa_id uuid,
  p_titulo text,
  p_subtitulo text,
  p_texto_boton text,
  p_boton_destino text,
  p_bienvenida text,
  p_pie text,
  p_aviso_ficha text,
  p_texto_boton_contacto text
)
returns dominio.tienda_contenido
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_empresa text;
  v_nuevo dominio.tienda_contenido;
  v_titulo text := btrim(coalesce(p_titulo, ''));
  v_subtitulo text := btrim(coalesce(p_subtitulo, ''));
  v_texto_boton text := btrim(coalesce(p_texto_boton, ''));
  v_destino text := coalesce(nullif(btrim(coalesce(p_boton_destino, '')), ''), 'catalogo');
  v_bienvenida text := btrim(coalesce(p_bienvenida, ''));
  v_pie text := btrim(coalesce(p_pie, ''));
  v_aviso text := btrim(coalesce(p_aviso_ficha, ''));
  v_contacto text := btrim(coalesce(p_texto_boton_contacto, ''));
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede editar el contenido de la tienda' using errcode = '42501';
  end if;

  select e.nombre into v_empresa
    from dominio.empresas e
   where e.id = p_empresa_id and e.organizacion_id = v_org;
  if not found then
    raise exception 'La empresa no existe o no pertenece a tu organización' using errcode = '42501';
  end if;

  if char_length(v_titulo) > 120 then
    raise exception 'El título no puede superar los 120 caracteres' using errcode = '22023', hint = 'titulo';
  end if;
  if char_length(v_subtitulo) > 300 then
    raise exception 'El subtítulo no puede superar los 300 caracteres' using errcode = '22023', hint = 'subtitulo';
  end if;
  if char_length(v_texto_boton) > 120 then
    raise exception 'El texto del botón no puede superar los 120 caracteres' using errcode = '22023', hint = 'texto_boton';
  end if;
  if v_destino not in ('catalogo') then
    raise exception 'El destino del botón no es válido' using errcode = '22023', hint = 'boton_destino';
  end if;
  if char_length(v_bienvenida) > 300 then
    raise exception 'El mensaje de bienvenida no puede superar los 300 caracteres' using errcode = '22023', hint = 'bienvenida';
  end if;
  if char_length(v_pie) > 300 then
    raise exception 'El texto del pie no puede superar los 300 caracteres' using errcode = '22023', hint = 'pie';
  end if;
  if char_length(v_aviso) > 300 then
    raise exception 'El aviso de la ficha no puede superar los 300 caracteres' using errcode = '22023', hint = 'aviso_ficha';
  end if;
  if char_length(v_contacto) > 120 then
    raise exception 'El texto del botón de contacto no puede superar los 120 caracteres' using errcode = '22023', hint = 'texto_boton_contacto';
  end if;

  -- El upsert toma el bloqueo de la fila: dos guardados simultáneos se serializan. El `where`
  -- del DO UPDATE evita escribir (y auditar) cuando nada cambió → idempotente.
  insert into dominio.tienda_contenido as c (
    empresa_id, organizacion_id, titulo, subtitulo, texto_boton, boton_destino,
    bienvenida, pie, aviso_ficha, texto_boton_contacto
  ) values (
    p_empresa_id, v_org, v_titulo, v_subtitulo, v_texto_boton, v_destino,
    v_bienvenida, v_pie, v_aviso, v_contacto
  )
  on conflict (empresa_id) do update set
    titulo = excluded.titulo,
    subtitulo = excluded.subtitulo,
    texto_boton = excluded.texto_boton,
    boton_destino = excluded.boton_destino,
    bienvenida = excluded.bienvenida,
    pie = excluded.pie,
    aviso_ficha = excluded.aviso_ficha,
    texto_boton_contacto = excluded.texto_boton_contacto
  where (c.titulo, c.subtitulo, c.texto_boton, c.boton_destino, c.bienvenida, c.pie, c.aviso_ficha, c.texto_boton_contacto)
    is distinct from
    (excluded.titulo, excluded.subtitulo, excluded.texto_boton, excluded.boton_destino, excluded.bienvenida, excluded.pie, excluded.aviso_ficha, excluded.texto_boton_contacto)
  returning * into v_nuevo;

  if v_nuevo.empresa_id is null then
    -- Sin cambios: no se duplica la auditoría.
    select * into v_nuevo from dominio.tienda_contenido where empresa_id = p_empresa_id;
    return v_nuevo;
  end if;

  perform private.insertar_actividad(
    v_org,
    (select auth.uid()),
    'tienda.contenido_actualizado',
    format('Actualizó los textos de la tienda de «%s»', v_empresa),
    p_empresa_id
  );
  return v_nuevo;
end;
$$;

comment on function public.guardar_tienda_contenido(uuid, text, text, text, text, text, text, text, text) is
  'MSF-294: guarda los textos comerciales de la tienda de una empresa. Solo con edición en Empresas; valida organización y límites (hint = campo); idempotente; registra tienda.contenido_actualizado solo si algo cambió.';

revoke execute on function public.guardar_tienda_contenido(uuid, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.guardar_tienda_contenido(uuid, text, text, text, text, text, text, text, text) to authenticated;

-- ============================================================================
-- publico.contenido_por_dominio (FR-036)
-- ============================================================================

-- Textos públicos por host crudo. Lista blanca de columnas (sin ids ni organización). Dominio
-- desconocido y empresa desactivada devuelven cero filas (como tienda_por_dominio). Tienda
-- válida sin fila de contenido = una fila con todo vacío (no se muestra ningún texto opcional).
-- `aviso_ficha` y `texto_boton_contacto` quedan expuestos para la ficha de producto (MSF-167).
create or replace function publico.contenido_por_dominio(host text)
returns table (
  titulo text,
  subtitulo text,
  texto_boton text,
  boton_destino text,
  bienvenida text,
  pie text,
  aviso_ficha text,
  texto_boton_contacto text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(c.titulo, ''),
    coalesce(c.subtitulo, ''),
    coalesce(c.texto_boton, ''),
    coalesce(c.boton_destino, 'catalogo'),
    coalesce(c.bienvenida, ''),
    coalesce(c.pie, ''),
    coalesce(c.aviso_ficha, ''),
    coalesce(c.texto_boton_contacto, '')
  from dominio.tiendas t
  join dominio.empresas e on e.id = t.empresa_id and e.organizacion_id = t.organizacion_id
  left join dominio.tienda_contenido c on c.empresa_id = t.empresa_id
  where t.dominio = private.normalizar_host(host)
    and e.activa;
$$;

revoke execute on function publico.contenido_por_dominio(text) from public;
grant execute on function publico.contenido_por_dominio(text) to anon, authenticated;

comment on function publico.contenido_por_dominio(text) is
  'MSF-294: textos comerciales públicos por host. Lista blanca de columnas; vacío si el dominio no existe o la empresa está desactivada.';
