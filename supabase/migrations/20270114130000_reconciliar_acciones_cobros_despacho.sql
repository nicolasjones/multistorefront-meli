-- Reconcilia las acciones de la matriz de permisos de las dos épicas que la extienden:
--   * cobros y conciliación (MSF-195): registrar_cobro, conciliar_pago, cobrar_contrarreembolso;
--   * despacho (MSF-183, F-VTA-15): despachar.
-- Cada una redefinió el check de `permisos_rol_accion`, `private.matriz_acciones_iniciales` y
-- `private.puede_accion` con SU lista; la que se aplica última pisaba a la otra (el check rechazaba
-- las acciones de cobros y `puede_accion` las daba por desconocidas → false). Esta migración deja
-- las dos listas juntas. Esquema: `public` (matriz de permisos = plataforma, Principio VII); sin
-- tablas nuevas, RLS intacta.
--
-- Migración aditiva. Reversión (en una migración posterior; no se ejecuta en este PR):
--   delete from public.permisos_rol_accion where accion = 'despachar';  -- solo si se descarta despacho
--   restaurar el check, private.matriz_acciones_iniciales() y private.puede_accion(text, text) de
--     20270114120100_marcar_contrarreembolso_cobrado.sql / 20270114110000_conciliar_pago.sql.

do $$
declare
  v_acciones text;
begin
  select string_agg(quote_literal(accion), ', ' order by accion)
    into v_acciones
    from (
      select unnest(array['eliminar', 'exportar', 'ver_costos', 'editar_precio', 'anular',
                         'emitir_nota_credito', 'registrar_cobro', 'conciliar_pago',
                         'cobrar_contrarreembolso', 'despachar']) as accion
      union
      select accion from public.permisos_rol_accion
    ) a;

  alter table public.permisos_rol_accion drop constraint if exists permisos_rol_accion_accion_check;
  execute format(
    'alter table public.permisos_rol_accion add constraint permisos_rol_accion_accion_check check (accion in (%s))',
    v_acciones);
end
$$;

create or replace function private.matriz_acciones_iniciales()
returns table (rol_id text, seccion text, accion text, permitido boolean)
language sql
immutable
set search_path = ''
as $$
  select m.rol_id, m.seccion, a.accion,
    case a.accion
      when 'eliminar' then m.rol_id = 'administrador'
      when 'exportar' then m.rol_id in ('administrador', 'operador', 'administracion')
      when 'editar_precio' then m.rol_id in ('administrador', 'operador')
      when 'anular' then m.rol_id in ('administrador', 'administracion')
      when 'emitir_nota_credito' then m.rol_id in ('administrador', 'administracion')
      when 'registrar_cobro' then m.rol_id in ('administrador', 'administracion', 'mostrador')
      when 'conciliar_pago' then m.rol_id in ('administrador', 'administracion')
      when 'despachar' then m.rol_id in ('administrador', 'deposito')
      else m.rol_id in ('administrador', 'administracion')
    end
  from private.matriz_inicial() m
  cross join (values ('eliminar'), ('exportar'), ('ver_costos'), ('editar_precio'), ('anular'),
    ('emitir_nota_credito'), ('registrar_cobro'), ('conciliar_pago'), ('despachar')) as a(accion)
  where a.accion not in ('editar_precio', 'anular', 'emitir_nota_credito', 'registrar_cobro', 'conciliar_pago', 'despachar')
    or m.seccion = 'ventas';
$$;

comment on function private.matriz_acciones_iniciales() is
  'Valores iniciales PROPUESTOS de permisos por acción (FR-006); pendientes de confirmar con el cliente. editar_precio, anular, emitir_nota_credito, registrar_cobro, conciliar_pago y despachar solo en ventas (cobrar_contrarreembolso se siembra aparte en private.sembrar_permisos).';

create or replace function private.puede_accion(p_seccion text, p_accion text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_accion not in ('eliminar', 'exportar', 'ver_costos', 'editar_precio', 'anular', 'emitir_nota_credito',
                          'registrar_cobro', 'conciliar_pago', 'cobrar_contrarreembolso', 'despachar') then false
    when (select private.is_superadmin())
      and exists (select 1 from public.superadmin_organizacion_activa a where a.user_id = (select auth.uid()))
      then true
    -- Exportar, ver costos y despachar exigen al menos lectura (Depósito despacha con Ventas en lectura);
    -- el resto escribe y exige edición.
    when p_accion not in ('exportar', 'ver_costos', 'despachar')
      and (select private.nivel_seccion(p_seccion)) <> 'edicion' then false
    when (select private.nivel_seccion(p_seccion)) = 'ninguno' then false
    else coalesce(
      (
        select bool_or(private.accion_de_rol(x.organizacion_id, x.rol_id, p_seccion, p_accion))
        from private.roles_de_referencia(p_seccion) x
        where case
          when p_accion not in ('exportar', 'ver_costos', 'despachar')
            then private.nivel_de_rol(x.organizacion_id, x.rol_id, p_seccion) = 'edicion'
          else private.nivel_de_rol(x.organizacion_id, x.rol_id, p_seccion) <> 'ninguno'
        end
      ),
      false
    )
  end;
$$;

comment on function private.puede_accion(text, text) is
  'true si el usuario actual puede eliminar | exportar | ver_costos | editar_precio | anular | emitir_nota_credito | registrar_cobro | conciliar_pago | cobrar_contrarreembolso | despachar en la sección, con la misma resolución por empresa que nivel_seccion. Cualquier otra acción → false.';

revoke execute on function private.puede_accion(text, text) from public, anon;
grant execute on function private.puede_accion(text, text) to authenticated;

-- Organizaciones existentes: la siembra es idempotente (`on conflict do nothing`).
select private.sembrar_permisos(id) from public.organizaciones;
