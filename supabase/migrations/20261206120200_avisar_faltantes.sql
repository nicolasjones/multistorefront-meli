-- MSF-405 · F-STK-17 (épica MSF-368, FR-307, FR-309): `avisar_faltantes(p_lineas)`.
--
-- Esquema (Principio VII): sin tablas nuevas; escribe en dominio.faltantes_avisos (20261206120000) y lee
-- public.faltantes_listado (20261206120100).
--
-- Reglas: toma solo las líneas VISIBLES para quien llama (la vista filtra por tienda) y con `ventas` en
-- `edicion` en su tienda; omite las ya avisadas, las de producto sin stock disponible hoy y las de
-- clientes sin correo; registra el aviso por línea (idempotente: una fila por línea; una línea `agotado`
-- se reencola) y devuelve los conteos. El correo sale uno por cliente por la Edge Function
-- `enviar-aviso-faltante`. Un fallo nunca toca la venta ni el stock.
--
-- Seguridad: security definer, `search_path = ''`, organización de la sesión (nunca del pedido),
-- `revoke … from public, anon` y `grant execute … to authenticated`.
--
-- Migración aditiva. Reversión (migración posterior): drop function public.avisar_faltantes(uuid[]);

create or replace function public.avisar_faltantes(p_lineas uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_fila record;
  v_filas integer;
  v_ya integer := 0;
  v_sin_stock integer := 0;
  v_sin_correo integer := 0;
  v_sin_permiso integer := 0;
  v_avisadas integer := 0;
  v_clientes uuid[] := '{}';
begin
  if v_actor is null or v_org is null
     or (select private.nivel_seccion('stock')) not in ('lectura', 'edicion') then
    raise exception 'No tenés permiso para avisar faltantes' using errcode = '42501';
  end if;
  if p_lineas is null or cardinality(p_lineas) = 0 or cardinality(p_lineas) > 200 then
    raise exception 'Elegí entre 1 y 200 faltantes' using errcode = '22023';
  end if;

  for v_fila in
    select v.linea_id, v.empresa_id, v.cliente_id, v.estado_stock, v.aviso,
           nullif(btrim(c.correo), '') as correo
      from public.faltantes_listado v
      join public.clientes c on c.id = v.cliente_id and c.organizacion_id = v.organizacion_id
     where v.linea_id = any (p_lineas) and v.organizacion_id = v_org
     order by v.linea_id
  loop
    if (select private.nivel_ventas_en_empresa(v_fila.empresa_id)) <> 'edicion' then
      v_sin_permiso := v_sin_permiso + 1;
    elsif v_fila.aviso = 'avisado' then
      v_ya := v_ya + 1;
    elsif v_fila.estado_stock = 'sin_stock' then
      v_sin_stock := v_sin_stock + 1;
    elsif v_fila.correo is null then
      v_sin_correo := v_sin_correo + 1;
    else
      insert into dominio.faltantes_avisos (linea_id, organizacion_id, empresa_id, cliente_id)
      values (v_fila.linea_id, v_org, v_fila.empresa_id, v_fila.cliente_id)
      on conflict (linea_id) do update
        set estado = 'pendiente', intentos = 0, ultimo_error = null, enviado_en = null,
            updated_at = now()
        where dominio.faltantes_avisos.estado = 'agotado';
      get diagnostics v_filas = row_count;
      if v_filas = 0 then
        v_ya := v_ya + 1;  -- otra sesión la avisó entre la lectura y la escritura
      else
        v_avisadas := v_avisadas + 1;
        v_clientes := v_clientes || v_fila.cliente_id;
      end if;
    end if;
  end loop;

  if v_avisadas > 0 then
    perform private.registrar_actividad(
      'stock.faltantes_avisados',
      format('Aviso de reposición encolado para %s faltantes', v_avisadas)
    );
  end if;

  return jsonb_build_object(
    'encolados', (select count(distinct x) from unnest(v_clientes) x),
    'lineas_avisadas', v_avisadas,
    'omitidos_ya_avisados', v_ya,
    'omitidos_sin_stock', v_sin_stock,
    'omitidos_sin_correo', v_sin_correo,
    'omitidos_sin_permiso', v_sin_permiso
  );
end;
$$;

revoke execute on function public.avisar_faltantes(uuid[]) from public, anon;
grant execute on function public.avisar_faltantes(uuid[]) to authenticated;

comment on function public.avisar_faltantes(uuid[]) is
  'MSF-405: encola el aviso de reposición de los faltantes elegidos (uno por línea, un correo por cliente). Exige ventas en edición en la tienda; omite ya avisados, sin stock y sin correo.';
