-- F-TDA-15 (MSF-413, épica MSF-191): sugerencias de búsqueda de la tienda pública. FR-021, FR-029.
--
-- Esquemas (Principio VII): no se crea ni altera ninguna tabla. publico.sugerencias_busqueda_por_dominio
-- -> `publico` (función de lectura anónima); `publico` sigue SIN tablas.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function publico.sugerencias_busqueda_por_dominio(text, text);

-- Lista blanca de campos. Host desconocido y empresa desactivada devuelven lo mismo: null. `volatile`
-- porque cuenta el pedido en public.limite_pedidos_publicos. Escrita en plpgsql: resuelve en ejecución las
-- funciones de MSF-167.
create or replace function publico.sugerencias_busqueda_por_dominio(host text, q text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  c_tope constant integer := 6;
  c_minimo constant integer := 2;
  v_empresa uuid;
  v_q text := private.normalizar_busqueda(left(coalesce(q, ''), 100));
  v_umbral real := private.umbral_similitud_busqueda();
  v_limite jsonb;
  v_productos jsonb;
begin
  select e.id into v_empresa
    from dominio.tiendas ti
    join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
   where ti.dominio = private.normalizar_host(host) and e.activa;
  if v_empresa is null then
    return null;
  end if;

  -- Texto vacío o corto: lista vacía sin consultar ni contar para el límite.
  if char_length(v_q) < c_minimo then
    return jsonb_build_object('limitado', false, 'espera_segundos', null, 'productos', '[]'::jsonb);
  end if;

  v_limite := private.registrar_pedido_publico(private.visitante_publico(host), private.limite_busquedas_por_minuto());
  if (v_limite ->> 'limitado')::boolean then
    return jsonb_build_object('limitado', true, 'espera_segundos', v_limite -> 'espera_segundos', 'productos', '[]'::jsonb);
  end if;

  with coincidencias as (
    select x.producto_id, x.nombre, x.categoria_id,
           greatest(extensions.word_similarity(v_q, n.norm), extensions.similarity(n.norm, v_q))
             + case when strpos(n.norm, v_q) = 1 then 0.5 when strpos(n.norm, v_q) > 1 then 0.25 else 0 end as puntaje
      from private.catalogo_tienda_efectivo(v_empresa) x
      cross join lateral (select private.normalizar_busqueda(x.nombre) as norm) n
     where x.efectivo
       and (strpos(n.norm, v_q) > 0
            or extensions.word_similarity(v_q, n.norm) >= v_umbral
            or extensions.similarity(n.norm, v_q) >= v_umbral)
  ),
  elegidas as (
    select c.*, row_number() over (order by c.puntaje desc, lower(c.nombre), c.producto_id) as rn
      from coincidencias c
     order by c.puntaje desc, lower(c.nombre), c.producto_id
     limit c_tope
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', g.producto_id,
           'nombre', g.nombre,
           'precio', private.precio_final_publico(g.producto_id, v_empresa),
           'disponible', private.disponible_publico(g.producto_id),
           'imagen', (select i.ruta from dominio.producto_imagenes i
                       where i.producto_id = g.producto_id order by i.posicion limit 1),
           'categoria_id', g.categoria_id
         ) order by g.rn), '[]'::jsonb)
    into v_productos
    from elegidas g;

  return jsonb_build_object('limitado', false, 'espera_segundos', null, 'productos', v_productos);
end;
$$;

revoke execute on function publico.sugerencias_busqueda_por_dominio(text, text) from public, anon;
grant execute on function publico.sugerencias_busqueda_por_dominio(text, text) to anon, authenticated;

comment on function publico.sugerencias_busqueda_por_dominio(text, text) is
  'F-TDA-15: hasta 6 productos visibles de la tienda del host cuyo nombre coincide con q ignorando mayúsculas y tildes y con tolerancia a errores de tipeo. Cuenta para el límite de pedidos por visitante y minuto. Lista blanca de campos; null si el dominio no existe o la empresa está desactivada.';
