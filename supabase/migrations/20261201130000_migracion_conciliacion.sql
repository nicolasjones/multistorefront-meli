-- F-MIG-04 (MSF-343, épica MSF-142): informe de conciliación de una carga de migración.
-- Spec: specs/20261023-120000-migracion-inicial-de-datos/ (FR-040, FR-042, FR-044).
--
-- Esquemas (Principio VII): esta migración NO crea ni altera tablas; solo agrega una función.
--   public.informe_conciliacion_migracion  public  función de la herramienta de plataforma
--   (lee public.migracion_cargas / migracion_filas y verifica contra las tablas destino:
--   public.clientes_identificadores_externos, dominio.proveedores, dominio.productos y
--   dominio.archivo_ingresos_mercaderia, todas con RLS y sin cambios de esquema).
--
-- La función es `security definer` (el Administrador no tiene `select` sobre todas las tablas
-- destino), fija `set search_path = ''`, valida rol Administrador y organización de la sesión y
-- filtra TODA lectura por esa organización. `revoke ... from public, anon` y
-- `grant execute ... to authenticated`. Solo lee: repetirla no cambia nada (idempotente).
--
-- Migración aditiva. Reversión (en una migración posterior, no en este PR):
--   drop function public.informe_conciliacion_migracion(uuid);

create or replace function public.informe_conciliacion_migracion(p_carga uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_carga public.migracion_cargas;
  v_nuevos integer;
  v_actualizados integer;
  v_errores integer;
  v_registradas integer;
  v_aplicadas integer;
  v_verificadas integer;
  v_diferencia integer;
  v_diferencia_destino integer;
begin
  if v_org is null or not (select private.puede_escribir()) then
    raise exception 'Solo un administrador puede migrar datos' using errcode = '42501';
  end if;

  select * into v_carga
    from public.migracion_cargas c
   where c.id = p_carga and c.organizacion_id = v_org;
  if not found then
    raise exception 'La carga no existe en tu organización' using errcode = 'P0002';
  end if;

  select count(*) filter (where f.estado = 'nueva'),
         count(*) filter (where f.estado = 'actualizada'),
         count(*) filter (where f.estado = 'error')
    into v_nuevos, v_actualizados, v_errores
    from public.migracion_filas f
   where f.carga_id = p_carga;

  v_aplicadas := v_nuevos + v_actualizados;
  v_registradas := v_aplicadas + v_errores;

  -- Verificación contra el destino: cuántas de las filas aplicadas están realmente en la tabla
  -- destino (de esta organización) con su identificador externo. No confía en el contador.
  select count(*)::integer into v_verificadas
    from public.migracion_filas f
   where f.carga_id = p_carga
     and f.estado in ('nueva', 'actualizada')
     and case v_carga.entidad
       when 'clientes' then exists (
         select 1
           from public.clientes_identificadores_externos v
           join public.clientes c on c.id = v.cliente_id
          where v.sistema = 'panel_actual'
            and v.identificador_externo = f.identificador_externo
            and c.organizacion_id = v_org)
       when 'proveedores' then exists (
         select 1 from dominio.proveedores p
          where p.organizacion_id = v_org and p.id_externo = f.identificador_externo)
       when 'vinculos_proveedor_producto' then exists (
         select 1 from dominio.productos p
          where p.organizacion_id = v_org
            and lower(p.sku) = lower(f.identificador_externo)
            and p.proveedor_id is not null)
       when 'ingresos_archivo' then exists (
         select 1 from dominio.archivo_ingresos_mercaderia a
          where a.organizacion_id = v_org and a.id_externo = f.identificador_externo)
       else false
     end;

  v_diferencia := v_carga.filas_total - v_registradas;
  v_diferencia_destino := v_aplicadas - v_verificadas;

  return jsonb_build_object(
    'carga', p_carga,
    'entidad', v_carga.entidad,
    'archivo', v_carga.archivo,
    'estado', v_carga.estado,
    'creada_en', v_carga.created_at,
    'cerrada_en', v_carga.cerrada_en,
    'origen', jsonb_build_object('filas', v_carga.filas_total),
    'cargado', jsonb_build_object(
      'nuevos', v_nuevos,
      'actualizados', v_actualizados,
      'con_error', v_errores,
      -- Filas del archivo sin resultado registrado (carga incompleta o interrumpida).
      'omitidos', greatest(v_diferencia, 0)
    ),
    'diferencia', v_diferencia,
    'destino', jsonb_build_object('verificadas', v_verificadas, 'diferencia', v_diferencia_destino),
    'conciliado', (
      v_carga.estado = 'aplicada' and v_diferencia = 0 and v_diferencia_destino = 0
    ),
    'errores', coalesce((
      select jsonb_agg(jsonb_build_object('fila', x.fila, 'motivo', x.motivo) order by x.fila)
        from (
          select f.fila, f.motivo
            from public.migracion_filas f
           where f.carga_id = p_carga and f.estado = 'error'
           order by f.fila
           limit 200
        ) as x
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.informe_conciliacion_migracion(uuid) is
  'F-MIG-04: informe de conciliación de una carga: filas del archivo vs. cargadas (nuevos, actualizados, con error, omitidos), diferencia calculada y verificación contra la tabla destino. Solo lee. Solo Administrador, acotado a su organización.';

revoke execute on function public.informe_conciliacion_migracion(uuid) from public, anon;
grant execute on function public.informe_conciliacion_migracion(uuid) to authenticated;
