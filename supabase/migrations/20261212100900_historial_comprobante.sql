-- F-VTA-10 (MSF-365, épica MSF-177, FR-025): `public.historial_comprobante`, los eventos de un comprobante
-- (cuándo, acción, quién, tienda) leídos de `public.registro_actividad`, para la tarjeta «Historial de estados y
-- acciones» del detalle.
--
-- Esquema (Principio VII): sin tablas nuevas; solo lee `public.registro_actividad` y `dominio.*`.
--
-- Seguridad: el contrato original decía `security invoker`, pero `registro_actividad` solo se puede leer con la
-- sección `actividad` y un vendedor (Mostrador) no la tiene: con `invoker` vería su propio historial vacío. Por eso
-- la función es `security definer`, con `search_path = ''`, y el control lo hace ella: organización de la sesión,
-- `ventas` ≥ `lectura` EN LA EMPRESA del comprobante (`nivel_ventas_en_empresa`) y solo eventos de ESA empresa y de
-- ESE comprobante. No expone nada que el usuario no pueda ver en el detalle del propio comprobante.
-- `revoke … from public, anon` y `grant execute … to authenticated` explícitos.
--
-- Qué eventos: `registro_actividad` no guarda el id de la entidad, así que se reconocen por tipo
-- (`comprobante.%`) y por el texto «factura|presupuesto <número>» que cada evento lleva en su detalle (con el número
-- completo, no como prefijo de otro). El número es único por organización, empresa y tipo. En los cambios de estado se
-- quita el sufijo « en la factura N» para mostrar «Estado: Pendiente → Aceptado». Orden descendente (el más
-- reciente primero); `quien` es «Sistema» cuando lo hizo el cobro automático.
--
-- Migración aditiva. Reversión (migración posterior): drop function public.historial_comprobante(uuid);

create or replace function public.historial_comprobante(p_id uuid)
returns table (cuando timestamptz, accion text, quien text, empresa_id uuid, empresa text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
  v_patron text;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver el historial de un comprobante' using errcode = '42501';
  end if;
  select * into v_c from dominio.comprobantes_venta c where c.id = p_id and c.organizacion_id = v_org;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver comprobantes de esta tienda' using errcode = '42501';
  end if;

  -- «factura 0003-00001251» como palabra completa: el número se escapa y no puede seguir otro carácter de número.
  v_patron := v_c.tipo || ' ' || regexp_replace(v_c.numero, '([^A-Za-z0-9])', E'\\\\\\1', 'g') || '([^A-Za-z0-9]|$)';

  return query
  select a.creado_en,
         case when a.tipo = 'comprobante.estado_cambiado'
              then regexp_replace(a.detalle, ' en la factura .*$', '')
              else a.detalle end,
         coalesce(nullif(btrim(a.actor_nombre), ''), case when a.actor_id is null then 'Sistema' else 'Usuario sin nombre' end),
         a.empresa_id,
         e.nombre
    from public.registro_actividad a
    left join dominio.empresas e on e.id = a.empresa_id and e.organizacion_id = a.organizacion_id
   where a.organizacion_id = v_org
     and a.empresa_id = v_c.empresa_id
     and a.tipo like 'comprobante.%'
     and a.detalle ~ v_patron
   order by a.creado_en desc, a.id desc;
end;
$$;

revoke execute on function public.historial_comprobante(uuid) from public, anon;
grant execute on function public.historial_comprobante(uuid) to authenticated;

comment on function public.historial_comprobante(uuid) is
  'Eventos de un comprobante (cuándo, acción, quién, tienda) desde registro_actividad, más recientes primero (F-VTA-10, FR-025). Exige ventas ≥ lectura en la empresa del comprobante.';
