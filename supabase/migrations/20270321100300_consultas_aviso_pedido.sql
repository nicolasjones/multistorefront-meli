-- MSF-176 · Tienda compra y cuentas, historia B1 «Lista de pedido sin cobro», T036. FR-030; amenaza 1.5 (asunto sin datos del visitante).
--
-- Esquemas (Principio VII): no se crea ni altera ninguna tabla. Dos funciones `private` (lógica interna, sin acceso de API).
--
-- Aviso por correo de una consulta nueva (`private.emitir_aviso('consulta_nueva', …)`, MSF-562): hasta hoy lo armaba el disparador
-- `consultas_encolar_aviso` con la fila recién insertada. Un pedido (`origen = 'pedido'`) tiene además sus ÍTEMS, que se insertan DESPUÉS
-- de la consulta (la FK los obliga), así que el disparador no los ve. Por eso:
--   * `private.emitir_aviso_consulta(p_consulta_id)` arma y emite el aviso leyendo la consulta y, si es un pedido, sus ítems
--     (resumen en una línea, hasta 10 productos y «y N más», más el cliente de la cuenta activa si lo hay).
--   * `private.encolar_aviso_consulta()` (disparador) sigue emitiendo el aviso de TODA consulta que no sea un pedido, con el mismo
--     contenido de siempre; para un pedido NO emite (lo hace `private.crear_consulta_pedido` cuando ya insertó los ítems).
-- El correo lo manda el flow `enviar-avisos` (HTML escapado con `escape`); el ASUNTO sale del nombre del tipo de aviso («Consulta
-- nueva»): nunca lleva datos del visitante. Un fallo al emitir no frena el alta: se registra solo con `sqlstate`.
--
-- Migración aditiva (`create or replace`). Reversión (migración posterior): volver a crear `private.encolar_aviso_consulta()` con el
-- cuerpo de 20261210130300_consultas_aviso_emitir.sql y `drop function private.emitir_aviso_consulta(uuid)`.

create or replace function private.emitir_aviso_consulta(p_consulta_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_lineas constant integer := 10;
  v_c dominio.consultas%rowtype;
  v_empresa text;
  v_producto text;
  v_resumen text;
  v_total integer;
  v_cliente text;
begin
  select * into v_c from dominio.consultas c where c.id = p_consulta_id;
  if not found then
    return;
  end if;

  select e.nombre into v_empresa
    from dominio.empresas e
   where e.id = v_c.empresa_id and e.organizacion_id = v_c.organizacion_id;

  if v_c.producto_id is not null then
    select p.nombre into v_producto
      from dominio.productos p
     where p.id = v_c.producto_id and p.organizacion_id = v_c.organizacion_id;
  end if;

  if v_c.origen = 'pedido' then
    select count(*)::integer into v_total from dominio.consulta_items i where i.consulta_id = v_c.id;
    select string_agg(l.cantidad::text || ' × ' || l.descripcion || coalesce(' (' || l.sku || ')', ''), ' · ' order by l.orden)
      into v_resumen
      from (select i.orden, i.cantidad, i.descripcion, i.sku
              from dominio.consulta_items i
             where i.consulta_id = v_c.id
             order by i.orden
             limit c_max_lineas) l;
    if v_total > c_max_lineas then
      v_resumen := v_resumen || ' · y ' || (v_total - c_max_lineas)::text || ' más';
    end if;
    if v_c.cliente_id is not null then
      select 'Nº ' || cl.numero::text || ' · ' || cl.nombre into v_cliente
        from public.clientes cl
       where cl.id = v_c.cliente_id and cl.organizacion_id = v_c.organizacion_id;
    end if;
  end if;

  begin
    perform private.emitir_aviso(
      'consulta_nueva',
      v_c.organizacion_id,
      jsonb_strip_nulls(jsonb_build_object(
        'Empresa', v_empresa,
        'Origen', case v_c.origen when 'whatsapp' then 'WhatsApp' when 'pedido' then 'Pedido de la tienda' else 'Formulario de contacto' end,
        'Nombre', v_c.nombre,
        'Contacto', v_c.contacto,
        'Producto', v_producto,
        'Pedido', v_resumen,
        'Cliente', v_cliente,
        'Mensaje', left(nullif(btrim(coalesce(v_c.mensaje, '')), ''), 300)
      )),
      v_c.empresa_id
    );
  exception when others then
    -- Solo sqlstate: sqlerrm puede traer datos del visitante.
    raise warning 'No se pudo emitir el aviso de la consulta %: %', v_c.id, sqlstate;
  end;
end;
$$;

comment on function private.emitir_aviso_consulta(uuid) is
  'MSF-176 (B1, FR-030): emite el aviso consulta_nueva de una consulta con private.emitir_aviso. Para un pedido suma el resumen de ítems (hasta 10 y «y N más») y el cliente de la cuenta activa. El asunto del correo no lleva datos del visitante. Un fallo se registra (sqlstate) y no frena el alta. Sin acceso de API.';

revoke execute on function private.emitir_aviso_consulta(uuid) from public, anon, authenticated;

-- Disparador: emite el aviso de toda consulta que no sea un pedido (el pedido lo emite `crear_consulta_pedido` con sus ítems).
create or replace function private.encolar_aviso_consulta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origen <> 'pedido' then
    perform private.emitir_aviso_consulta(new.id);
  end if;
  return new;
end;
$$;

comment on function private.encolar_aviso_consulta() is
  'MSF-562 (FR-012) + MSF-176: al crearse una consulta que no es un pedido emite el aviso consulta_nueva (private.emitir_aviso_consulta). El pedido lo emite private.crear_consulta_pedido cuando ya insertó sus ítems. Un fallo se registra y no frena el alta.';

revoke execute on function private.encolar_aviso_consulta() from public, anon, authenticated;
