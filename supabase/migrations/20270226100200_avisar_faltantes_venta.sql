-- MSF-161 · F-VTA-26 (MSF-257, spec 20261110-100000-ventas-avisos-de-faltantes, FR-001, FR-003, FR-004,
-- FR-005): `public.avisar_faltantes_venta(p_ids, p_mensaje, p_reavisar)`, el aviso a clientes desde la
-- pantalla «Ventas · Faltantes».
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   dominio.faltantes_venta              dominio (existente)  el faltante que se avisa (id = el de listar_faltantes).
--   dominio.faltantes_avisos             dominio (existente)  la cola de F-STK-17: se escribe una fila por línea.
--   dominio.comprobantes_venta(_lineas)  dominio (existente)  la factura y la línea del faltante.
--   public.clientes                      plataforma           solo se lee el correo del cliente.
--   public.avisar_faltantes_venta        public  (NUEVA RPC)  la llama el navegador autenticado.
-- Ninguna tabla se crea ni se altera: es solo la RPC.
--
-- Reglas:
--   * La organización y el actor salen de la sesión, nunca de un argumento. Sin sesión, o sin `ventas` en
--     `edicion` (el rol Consulta incluido) -> 42501.
--   * 1 a 200 ids (22023); `p_mensaje` se recorta y no puede pasar de 1.000 caracteres (22023); vacío = null
--     (texto por defecto). Todo o nada solo en la validación: cada faltante se procesa por separado y devuelve
--     su resultado (`encolado`, `ya_avisado`, `en_cola`, `sin_correo`, `sin_permiso`, `no_abierto`).
--   * Un id inexistente, de otra organización, resuelto o de una tienda que la persona ni siquiera puede
--     leer responde igual (`no_abierto`): no delata nada. `sin_permiso` es solo para tiendas visibles donde
--     no hay `ventas` en `edicion`.
--   * Cliente sin correo: se omite SIN marcar (`sin_correo`).
--   * Cola (`dominio.faltantes_avisos`, clave `linea_id`): `pendiente` nunca se toca (`en_cola`); `enviado`
--     solo se reinicia con `p_reavisar` (si no, `ya_avisado`); `agotado` se reinicia siempre. Reiniciar =
--     estado `pendiente`, intentos 0, `ultimo_error` y `enviado_en` nulos, `created_at = updated_at = now()`
--     y el `mensaje` nuevo. El correo (uno por cliente) lo manda la Edge Function `enviar-aviso-faltante`.
--   * Actividad `ventas.faltantes_avisados` con las cantidades de faltantes y clientes (sin correos).
--
-- Seguridad: `security definer`, `search_path = ''`, `revoke … from public, anon` + `grant … to authenticated`.
--
-- Migración aditiva e idempotente (`create or replace`). Reversión (migración posterior):
--   drop function if exists public.avisar_faltantes_venta(uuid[], text, boolean);

create or replace function public.avisar_faltantes_venta(
  p_ids uuid[],
  p_mensaje text default null,
  p_reavisar boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_mensaje text := nullif(btrim(coalesce(p_mensaje, '')), '');
  v_reavisar boolean := coalesce(p_reavisar, false);
  v_fila record;
  v_nivel text;
  v_filas integer;
  v_resultado text;
  v_detalle jsonb := '[]'::jsonb;
  v_encolados integer := 0;
  v_ya integer := 0;
  v_cola integer := 0;
  v_sin_correo integer := 0;
  v_sin_permiso integer := 0;
  v_no_abiertos integer := 0;
  v_clientes uuid[] := '{}';
begin
  if v_actor is null or v_org is null
     or (select private.nivel_seccion('ventas')) is distinct from 'edicion' then
    raise exception 'No tenés permiso para avisar faltantes' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 200 then
    raise exception 'Elegí entre 1 y 200 faltantes' using errcode = '22023';
  end if;
  if length(v_mensaje) > 1000 then
    raise exception 'El texto del aviso no puede pasar de 1.000 caracteres' using errcode = '22023';
  end if;

  for v_fila in
    select u.id,
           f.empresa_id,
           f.id as faltante_id,
           l.id as linea_id,
           c.cliente_id,
           nullif(btrim(cl.correo), '') as correo,
           a.estado as cola
      from (select distinct x as id from unnest(p_ids) x where x is not null) u
      left join dominio.faltantes_venta f
        on f.id = u.id and f.organizacion_id = v_org and f.estado = 'abierto'
      left join dominio.comprobantes_venta c
        on c.id = f.comprobante_id and c.organizacion_id = f.organizacion_id
      left join dominio.comprobantes_venta_lineas l
        on l.comprobante_id = f.comprobante_id and l.orden = f.linea_orden
       and l.organizacion_id = f.organizacion_id
      left join public.clientes cl
        on cl.id = c.cliente_id and cl.organizacion_id = c.organizacion_id
      left join dominio.faltantes_avisos a on a.linea_id = l.id
     order by u.id
  loop
    v_resultado := null;
    if v_fila.faltante_id is null or v_fila.linea_id is null then
      v_resultado := 'no_abierto';
    else
      v_nivel := (select private.nivel_ventas_en_empresa(v_fila.empresa_id));
      if v_nivel is distinct from 'edicion' then
        -- Una tienda que ni se puede leer no delata que el faltante existe.
        v_resultado := case when v_nivel = 'lectura' then 'sin_permiso' else 'no_abierto' end;
      elsif v_fila.correo is null then
        v_resultado := 'sin_correo';
      elsif v_fila.cola = 'pendiente' then
        v_resultado := 'en_cola';
      elsif v_fila.cola = 'enviado' and not v_reavisar then
        v_resultado := 'ya_avisado';
      else
        insert into dominio.faltantes_avisos (linea_id, organizacion_id, empresa_id, cliente_id, mensaje)
        values (v_fila.linea_id, v_org, v_fila.empresa_id, v_fila.cliente_id, v_mensaje)
        on conflict (linea_id) do update
          set estado = 'pendiente', intentos = 0, ultimo_error = null, enviado_en = null,
              created_at = now(), updated_at = now(), mensaje = excluded.mensaje
          where dominio.faltantes_avisos.estado = 'agotado'
             or (dominio.faltantes_avisos.estado = 'enviado' and v_reavisar);
        get diagnostics v_filas = row_count;
        if v_filas > 0 then
          v_resultado := 'encolado';
          v_clientes := v_clientes || v_fila.cliente_id;
        else
          -- Otra sesión la dejó en cola o la avisó entre la lectura y la escritura.
          v_resultado := case
            when (select a.estado from dominio.faltantes_avisos a where a.linea_id = v_fila.linea_id) = 'pendiente'
              then 'en_cola'
            else 'ya_avisado'
          end;
        end if;
      end if;
    end if;

    case v_resultado
      when 'encolado' then v_encolados := v_encolados + 1;
      when 'ya_avisado' then v_ya := v_ya + 1;
      when 'en_cola' then v_cola := v_cola + 1;
      when 'sin_correo' then v_sin_correo := v_sin_correo + 1;
      when 'sin_permiso' then v_sin_permiso := v_sin_permiso + 1;
      else v_no_abiertos := v_no_abiertos + 1;
    end case;
    v_detalle := v_detalle || jsonb_build_object('id', v_fila.id, 'resultado', v_resultado);
  end loop;

  if jsonb_array_length(v_detalle) = 0 then
    raise exception 'Elegí entre 1 y 200 faltantes' using errcode = '22023';
  end if;

  if v_encolados > 0 then
    perform private.registrar_actividad(
      'ventas.faltantes_avisados',
      left(format('Aviso de faltantes encolado para %s faltantes de %s clientes', v_encolados,
                  (select count(distinct x) from unnest(v_clientes) x)), 500)
    );
  end if;

  return jsonb_build_object(
    'encolados', (select count(distinct x) from unnest(v_clientes) x),
    'lineas_avisadas', v_encolados,
    'omitidos_ya_avisados', v_ya,
    'omitidos_en_cola', v_cola,
    'omitidos_sin_correo', v_sin_correo,
    'omitidos_sin_permiso', v_sin_permiso,
    'omitidos_no_abiertos', v_no_abiertos,
    'detalle', v_detalle
  );
end;
$$;

revoke execute on function public.avisar_faltantes_venta(uuid[], text, boolean) from public, anon;
grant execute on function public.avisar_faltantes_venta(uuid[], text, boolean) to authenticated;

comment on function public.avisar_faltantes_venta(uuid[], text, boolean) is
  'F-VTA-26: encola el aviso de los faltantes de venta elegidos (uno por línea, un correo por cliente) con el texto editable. Exige ventas en edición (global y en la tienda); omite ya avisados (salvo p_reavisar), en cola, sin correo y de tiendas sin edición. La organización y el actor salen de la sesión.';
