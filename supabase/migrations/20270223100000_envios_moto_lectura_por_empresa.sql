-- F-VTA-24 (MSF-145, épica MSF-145): la lectura directa de `dominio.envios_moto` se acota por la tienda del envío.
--
-- Hallazgo de la revisión final: la política `envios_moto_select` exigía el nivel de `ventas` GLOBAL
-- (`private.nivel_seccion('ventas')`, el más alto entre las tiendas de la persona), así que alguien con
-- `ventas` en edición en la tienda A y sin `ventas` en la tienda B podía leer por la API (el esquema `dominio` está
-- expuesto en PostgREST) los envíos de B —mensajero, guía, abono—, mientras `listar_envios_moto` y la tarjeta de motos
-- sin rendir le devolvían 0. La RPC ya filtraba por `private.nivel_ventas_en_empresa`; ahora la política también, igual
-- que `dominio.faltantes_avisos`.
--
-- Esquema (Principio VII): sin tablas nuevas; solo se reemplaza una política de `dominio.envios_moto`.
-- Migración aditiva: no destruye datos ni cambia columnas. Reversión (en una migración posterior): recrear la política
-- anterior de `20270222200100_envios_moto.sql`.

drop policy if exists envios_moto_select on dominio.envios_moto;
create policy envios_moto_select on dominio.envios_moto
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    -- La empresa del envío es la de su comprobante: debe ser accesible y la persona debe tener `ventas` en ELLA.
    and exists (
      select 1
        from dominio.comprobantes_venta c
       where c.id = envios_moto.comprobante_id
         and c.organizacion_id = envios_moto.organizacion_id
         and c.empresa_id in (select private.empresas_accesibles())
         and (select private.nivel_ventas_en_empresa(c.empresa_id)) in ('lectura', 'edicion')
    )
  );

-- ============================================================================
-- public.puedo_registrar_envios_moto: el permiso que la pantalla usa para mostrar «Registrar envío»
-- ============================================================================
-- Hallazgo de la revisión final: el botón se mostraba con `ventas` en edición, pero registrar exige además el rol
-- Operador o Administrador en la tienda (Mostrador tiene `ventas` en edición y veía un botón que no podía usar: el
-- diálogo decía «No hay facturas con envío en moto sin registrar»). Esta RPC de solo lectura responde con la MISMA regla
-- que las RPC de escritura (`private.puede_registrar_envio_moto_en_empresa`), sin exponer ese helper.
-- Con `p_empresa_id` nulo (filtro «Todas las tiendas») es verdadero si puede registrar en alguna tienda accesible.
create or replace function public.puedo_registrar_envios_moto(p_empresa_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null or (select private.organizacion_id()) is null then false
    when p_empresa_id is not null then
      p_empresa_id in (select private.empresas_accesibles())
      and (select private.puede_registrar_envio_moto_en_empresa(p_empresa_id))
    else exists (
      select 1
        from (select private.empresas_accesibles() as empresa_id) a
       where (select private.puede_registrar_envio_moto_en_empresa(a.empresa_id))
    )
  end;
$$;

revoke execute on function public.puedo_registrar_envios_moto(uuid) from public, anon;
grant execute on function public.puedo_registrar_envios_moto(uuid) to authenticated;

comment on function public.puedo_registrar_envios_moto(uuid) is
  'F-VTA-24: true si la persona puede registrar envíos en moto en la tienda indicada (o en alguna accesible si es nulo): ventas en edición y rol Operador o Administrador, la misma regla que registrar_envio_moto. Solo lectura; la autoridad sigue siendo la RPC de escritura.';
