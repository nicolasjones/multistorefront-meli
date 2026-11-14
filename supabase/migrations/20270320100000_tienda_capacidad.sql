-- MSF-176 · Tienda compra y cuentas (spec 20270306-100000-tienda-compra-y-cuentas), cimientos transversales (T001).
-- FR-014, D-19, D-24, D-27.
--
-- Esquemas (Principio VII, re-verificado):
--   * public.banderas_plataforma (tabla existente, una fila nueva) -> `public`: configuración de plataforma por entorno, no
--     entidad de negocio. Sin cambios de estructura, RLS ni grants.
--   * publico.capacidades_tienda_por_dominio -> `publico`: función de lectura mínima por Host; `publico` sigue SIN tablas.
--
-- Bandera `tienda_pedidos`: APAGADA por defecto en todo entorno (D-19). Se enciende solo en dev, por
-- `scripts/tienda-pedidos-dev.mjs` (D-24); ninguna migración ni despliegue la enciende. Con ella apagada, toda RPC de la épica
-- responde el error/sin_acceso genérico de su familia sin tocar datos (el servidor lo impone).
--
-- `publico.capacidades_tienda_por_dominio(host)` es lo único que el front público necesita para dibujar o no «Mi cuenta»,
-- «Mi lista», «Guardar en favoritos» y «Agregar a la lista»: la bandera vive en `public.banderas_plataforma`, que `anon` no lee.
-- Devuelve solo `{estado, pedidos}`; host desconocido, empresa desactivada y tienda pausada responden lo mismo (`error`).
--
-- Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR):
--   drop function if exists publico.capacidades_tienda_por_dominio(text);
--   delete from public.banderas_plataforma where clave = 'tienda_pedidos';

insert into public.banderas_plataforma (clave, activa, descripcion) values
  ('tienda_pedidos', false, 'Tienda compra y cuentas (MSF-176): «Mi cuenta», favoritos, lista de pedido y presupuesto desde la tienda. Solo se enciende en dev.')
on conflict (clave) do nothing;

create or replace function publico.capacidades_tienda_por_dominio(host text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
begin
  if not exists (
    select 1
      from dominio.tiendas ti
      join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
     where ti.dominio = private.normalizar_host(host) and e.activa
  ) then
    return jsonb_build_object('estado', 'error');
  end if;

  return jsonb_build_object('estado', 'ok', 'pedidos', private.bandera_activa('tienda_pedidos'));
exception when others then
  -- Rastro en el servidor solo con sqlstate; nunca el texto del error.
  raise warning 'capacidades_tienda_por_dominio falló: %', sqlstate;
  return jsonb_build_object('estado', 'error');
end;
$$;

revoke execute on function publico.capacidades_tienda_por_dominio(text) from public, anon;
grant execute on function publico.capacidades_tienda_por_dominio(text) to anon, authenticated;

comment on function publico.capacidades_tienda_por_dominio(text) is
  'MSF-176 (D-27): {estado, pedidos} con el valor de la bandera tienda_pedidos para la tienda del host. Host desconocido, empresa desactivada y tienda pausada → {estado: error} idéntico. No devuelve ningún otro dato.';
