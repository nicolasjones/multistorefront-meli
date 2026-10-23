-- F-PRE-03 (MSF-267, épica MSF-116) · FR-010…FR-013: confirmar, recalcular y descartar.
-- Esquema (Principio VII), objeto por objeto:
--   dominio.cotizacion_aplicada          dominio  (NUEVA) dato de negocio: la cotización con la que se
--                                        calculan los precios, una fila por organización. RLS por
--                                        organización; select para quien ve `productos` (igual que
--                                        `cotizacion_inicial`); SIN insert/update/delete para
--                                        `authenticated`: solo escribe `public.confirmar_cotizacion`.
--   private.a_pesos                      private  redefinida (misma firma): lee coalesce(aplicada, inicial).
--   public.confirmar_cotizacion          public   RPC (no almacena datos), SECURITY DEFINER.
--   public.descartar_cotizacion          public   RPC (no almacena datos), SECURITY DEFINER.
--
-- No se guarda ningún precio en pesos (modelo de MSF-114): «recalcular todos los precios» es cambiar,
-- en UNA transacción, la única fila `cotizacion_aplicada` de la organización; por eso ninguna empresa
-- puede quedar con un valor distinto de otra. Bajo el umbral (1 %) la cotización solo se registra.
--
-- `confirmar_cotizacion` y `descartar_cotizacion` son SECURITY DEFINER (excepción acotada al estilo
-- invoker del repo): el historial `cotizaciones` y `cotizacion_aplicada` no tienen escritura para
-- `authenticated`, y los eventos de actividad (`private.insertar_actividad`) tampoco son invocables
-- por la app. Ambas verifican `edicion` en `cotizacion_dolar` y la organización de la SESIÓN dentro
-- de la función; nada viene por parámetro. `anon` sin ejecución.
--
-- Concurrencia: `pg_advisory_xact_lock` por organización + `select … for update` de la pendiente;
-- una sola confirmación gana y la otra recibe `sin_cotizacion_pendiente` (P0002) sin duplicar el
-- historial. Doble clic: igual.
--
-- Decisión de producto (spec, Decisiones abiertas 3): el umbral se mide contra la cotización VIGENTE
-- (última confirmada o inicial), no contra la aplicada. Cambiarlo a «contra la aplicada» es la línea
-- marcada «umbral» abajo.
--
-- «Precios recalculados» = cantidad de precios en USD que cambian de valor, sumando todas las empresas
-- activas (productos activos en USD × empresas activas), el mismo número del mosaico de la vista previa.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes `cotizacion_aplicada`):
--   drop function public.descartar_cotizacion();
--   drop function public.confirmar_cotizacion();
--   restaurar private.a_pesos a leer solo dominio.cotizacion_inicial (cuerpo de 20261022121001);
--   drop table dominio.cotizacion_aplicada;

create table dominio.cotizacion_aplicada (
  organizacion_id uuid primary key references public.organizaciones (id) on delete cascade,
  valor numeric(14, 4) not null check (valor > 0),
  cotizacion_id uuid references dominio.cotizaciones (id),
  aplicada_en timestamptz not null default now()
);

comment on table dominio.cotizacion_aplicada is
  'Cotización con la que se calculan los precios en USD (F-PRE-03). Una por organización; se mueve solo al confirmar una carga que alcanza el umbral. Sin fila, rige cotizacion_inicial.';

alter table dominio.cotizacion_aplicada enable row level security;

create policy cotizacion_aplicada_select on dominio.cotizacion_aplicada
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) in ('lectura', 'edicion')
  );

grant usage on schema dominio to authenticated;
revoke all on dominio.cotizacion_aplicada from public, anon, authenticated;
grant select on dominio.cotizacion_aplicada to authenticated;

-- Único punto de lectura de la cotización: cambia la fuente, no la firma ni a quienes la llaman.
create or replace function private.a_pesos(p_importe numeric, p_moneda text, p_organizacion uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when p_importe is null then null
    when p_moneda = 'ARS' then p_importe
    when p_moneda = 'USD' then
      round(p_importe * coalesce(
        (select a.valor from dominio.cotizacion_aplicada a where a.organizacion_id = p_organizacion),
        (select c.valor from dominio.cotizacion_inicial c where c.organizacion_id = p_organizacion)
      ), 2)
    else null
  end;
$$;

comment on function private.a_pesos(numeric, text, uuid) is
  'F-PRE-01/F-PRE-03: importe en pesos. ARS tal cual; USD × cotización aplicada de la organización (o la inicial si no hay aplicada); sin cotización → null.';

create or replace function public.confirmar_cotizacion()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_usuario uuid := (select auth.uid());
  v_pendiente dominio.cotizacion_pendiente;
  v_vigente numeric;
  v_variacion numeric;
  v_recalcula boolean;
  v_precios integer := 0;
  v_nombre text;
  v_id uuid;
  v_valor_txt text;
begin
  if v_organizacion is null or v_usuario is null
     or (select private.nivel_seccion('cotizacion_dolar')) <> 'edicion' then
    raise exception 'Tu rol no puede confirmar la cotización del dólar' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cotizacion:' || v_organizacion::text, 0));

  select * into v_pendiente from dominio.cotizacion_pendiente p
   where p.organizacion_id = v_organizacion and p.expira_en > now()
   for update;
  if not found then
    raise exception 'sin_cotizacion_pendiente' using errcode = 'P0002';
  end if;

  -- umbral: se mide contra la cotización VIGENTE (Decisión abierta 3 de la spec).
  v_vigente := private.cotizacion_vigente(v_organizacion);
  v_variacion := case when v_vigente is null then null else round((v_pendiente.valor / v_vigente - 1) * 100, 4) end;
  v_recalcula := v_vigente is null or abs(v_pendiente.valor - v_vigente) * 100 >= v_vigente;

  if v_recalcula then
    select coalesce(sum(u.precios), 0)::integer into v_precios from private.precios_usd_por_empresa(v_organizacion) u;
  end if;

  select coalesce(nullif(btrim(concat_ws(' ', pf.nombre, pf.apellido)), ''), u.email::text)
    into v_nombre
    from auth.users u
    left join public.perfiles_usuario pf on pf.user_id = u.id
   where u.id = coalesce(v_pendiente.cargada_por, v_usuario);
  v_nombre := coalesce(v_nombre, 'Usuario');

  insert into dominio.cotizaciones (
    organizacion_id, valor, valor_anterior, variacion_pct, cargada_por, cargada_por_nombre,
    cargada_en, recalculo_aplicado, precios_recalculados
  ) values (
    v_organizacion, v_pendiente.valor, v_vigente, v_variacion, coalesce(v_pendiente.cargada_por, v_usuario), v_nombre,
    clock_timestamp(), v_recalcula, v_precios
  ) returning id into v_id;

  if v_recalcula then
    insert into dominio.cotizacion_aplicada as a (organizacion_id, valor, cotizacion_id, aplicada_en)
    values (v_organizacion, v_pendiente.valor, v_id, now())
    on conflict (organizacion_id) do update
      set valor = excluded.valor, cotizacion_id = excluded.cotizacion_id, aplicada_en = excluded.aplicada_en;
  end if;

  delete from dominio.cotizacion_pendiente where organizacion_id = v_organizacion;

  v_valor_txt := trim_scale(v_pendiente.valor)::text;
  perform private.insertar_actividad(
    v_organizacion, v_usuario, 'cotizacion.cargada',
    format('Confirmó la cotización del dólar: $ %s', v_valor_txt), null
  );
  if v_recalcula then
    perform private.insertar_actividad(
      v_organizacion, v_usuario, 'recalculo.aplicado',
      format('Recalculó %s precios con el dólar a $ %s', v_precios, v_valor_txt), null
    );
  else
    perform private.insertar_actividad(
      v_organizacion, v_usuario, 'recalculo.omitido',
      format('Registró el dólar a $ %s sin recalcular: la variación es menor al umbral de 1 %%', v_valor_txt), null
    );
  end if;

  return jsonb_build_object('id', v_id, 'recalculo_aplicado', v_recalcula, 'precios_recalculados', v_precios);
end;
$$;

comment on function public.confirmar_cotizacion() is
  'F-PRE-03: confirma la cotización pendiente en una transacción: historial, cotización aplicada (si la variación alcanza el 1 %), eventos. 42501 sin edición; P0002 sin_cotizacion_pendiente (no hay, venció o ya se confirmó).';

create or replace function public.descartar_cotizacion()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_usuario uuid := (select auth.uid());
  v_valor numeric;
begin
  if v_organizacion is null or v_usuario is null
     or (select private.nivel_seccion('cotizacion_dolar')) <> 'edicion' then
    raise exception 'Tu rol no puede descartar la cotización del dólar' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cotizacion:' || v_organizacion::text, 0));

  delete from dominio.cotizacion_pendiente p
   where p.organizacion_id = v_organizacion
  returning p.valor into v_valor;

  -- Sin pendiente no hay nada que descartar: no es un error ni deja evento.
  if found then
    perform private.insertar_actividad(
      v_organizacion, v_usuario, 'cotizacion.descartada',
      format('Descartó la cotización del dólar cargada: $ %s', trim_scale(v_valor)::text), null
    );
  end if;
end;
$$;

comment on function public.descartar_cotizacion() is
  'F-PRE-03: descarta la cotización pendiente (acción Cancelar). Idempotente: sin pendiente no hace nada. 42501 sin edición.';

revoke execute on function public.confirmar_cotizacion() from public, anon;
revoke execute on function public.descartar_cotizacion() from public, anon;
grant execute on function public.confirmar_cotizacion() to authenticated;
grant execute on function public.descartar_cotizacion() to authenticated;
