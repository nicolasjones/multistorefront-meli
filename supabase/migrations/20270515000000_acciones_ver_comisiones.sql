-- MSF-957 (S-6 de MSF-118, D-12): acción propia `ver_comisiones` de la sección `service_tecnico`, separada de `ver_costos`.
--
-- Decisión por delegación (Nicolás delegó la decisión de requisitos en Claude, 2026-11-26): las comisiones de los técnicos
-- tienen su permiso propio. `ver_comisiones` permite ver las comisiones de TODOS los técnicos y cargar las reglas de
-- comisión; `ver_costos` NO lo implica ni al revés. Quien no lo tiene ve solo lo propio en «Mis comisiones».
--
-- Esquema (Principio VII): sin tablas nuevas. `public.permisos_rol_accion` (plataforma) recibe una acción más como DATO:
-- se amplía su `check`, `private.sembrar_permisos` siembra la fila SOLO para `service_tecnico` (Administrador y
-- Administración en true; el resto en false, como `ver_costos` pero ya independiente) y `private.puede_accion` la reconoce.
-- Como `ver_costos`, exige al menos `lectura` en la sección. `public.permisos_actuales()` devuelve la columna nueva para
-- que la UI muestre u oculte la pantalla (la autoridad real es la base).
--
-- Ojo: `private.puede_accion` lee `private.superadmin_contexto_vigente` (accesos de soporte sin vencidos), no la tabla cruda
-- (la guardia acceso_soporte_sin_lecturas_crudas lo exige; 20270207100003 reescribe así las funciones existentes).
-- Las definiciones parten de las VIGENTES: `private.puede_accion` de 20270114130000 y `private.sembrar_permisos` de
-- 20270114120100 (cobrar_contrarreembolso); no se pierde ninguna acción.
--
-- Migración aditiva. Reversión (en una migración posterior; no se ejecuta en este PR):
--   delete from public.permisos_rol_accion where accion = 'ver_comisiones';
--   restaurar el check de permisos_rol_accion sin 'ver_comisiones' (misma lista que 20270114130000),
--   private.sembrar_permisos(uuid) de 20270114120100_marcar_contrarreembolso_cobrado.sql,
--   private.puede_accion(text, text) de 20270114130000_reconciliar_acciones_cobros_despacho.sql y
--   public.permisos_actuales() de 20261013130002_roles_basicos_permisos.sql (sin la columna ver_comisiones).

do $$
declare
  v_acciones text;
begin
  select string_agg(quote_literal(accion), ', ' order by accion)
    into v_acciones
    from (
      select unnest(array['eliminar', 'exportar', 'ver_costos', 'editar_precio', 'anular',
                         'emitir_nota_credito', 'registrar_cobro', 'conciliar_pago',
                         'cobrar_contrarreembolso', 'despachar', 'ver_comisiones']) as accion
      union
      select distinct accion from private.matriz_acciones_iniciales()
      union
      select accion from public.permisos_rol_accion
    ) a;

  alter table public.permisos_rol_accion drop constraint if exists permisos_rol_accion_accion_check;
  execute format(
    'alter table public.permisos_rol_accion add constraint permisos_rol_accion_accion_check check (accion in (%s))',
    v_acciones);
end
$$;

comment on constraint permisos_rol_accion_accion_check on public.permisos_rol_accion is
  'Acciones por rol y sección. ver_comisiones (MSF-957) vive solo en service_tecnico.';

create or replace function private.sembrar_permisos(p_organizacion_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.permisos_rol (organizacion_id, rol_id, seccion, nivel)
  select p_organizacion_id, m.rol_id, m.seccion, m.nivel from private.matriz_inicial() m
  on conflict do nothing;

  insert into public.permisos_rol_accion (organizacion_id, rol_id, seccion, accion, permitido)
  select p_organizacion_id, a.rol_id, a.seccion, a.accion, a.permitido
    from private.matriz_acciones_iniciales() a
  on conflict do nothing;

  -- F-VTA-14 (FR-041): `cobrar_contrarreembolso` es de Ventas y la pueden Administración y Administrador.
  insert into public.permisos_rol_accion (organizacion_id, rol_id, seccion, accion, permitido)
  select p_organizacion_id, m.rol_id, 'ventas', 'cobrar_contrarreembolso',
         m.rol_id in ('administrador', 'administracion')
    from (select distinct rol_id from private.matriz_inicial()) m
  on conflict do nothing;

  -- MSF-957: `ver_comisiones` es de Service técnico; la pueden Administración y Administrador. Los demás roles quedan
  -- en `false` (la matriz los muestra y se pueden cambiar a mano; Técnico tiene matriz fija y solo ve lo propio).
  insert into public.permisos_rol_accion (organizacion_id, rol_id, seccion, accion, permitido)
  select p_organizacion_id, m.rol_id, 'service_tecnico', 'ver_comisiones',
         m.rol_id in ('administrador', 'administracion')
    from (select distinct rol_id from private.matriz_inicial()) m
  on conflict do nothing;
$$;

create or replace function private.puede_accion(p_seccion text, p_accion text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_accion not in ('eliminar', 'exportar', 'ver_costos', 'editar_precio', 'anular', 'emitir_nota_credito',
                          'registrar_cobro', 'conciliar_pago', 'cobrar_contrarreembolso', 'despachar',
                          'ver_comisiones') then false
    when (select private.is_superadmin())
      and exists (select 1 from private.superadmin_contexto_vigente a where a.user_id = (select auth.uid()))
      then true
    -- Exportar, ver costos, ver comisiones y despachar exigen al menos lectura (Depósito despacha con Ventas en
    -- lectura); el resto escribe y exige edición.
    when p_accion not in ('exportar', 'ver_costos', 'ver_comisiones', 'despachar')
      and (select private.nivel_seccion(p_seccion)) <> 'edicion' then false
    when (select private.nivel_seccion(p_seccion)) = 'ninguno' then false
    else coalesce(
      (
        select bool_or(private.accion_de_rol(x.organizacion_id, x.rol_id, p_seccion, p_accion))
        from private.roles_de_referencia(p_seccion) x
        where case
          when p_accion not in ('exportar', 'ver_costos', 'ver_comisiones', 'despachar')
            then private.nivel_de_rol(x.organizacion_id, x.rol_id, p_seccion) = 'edicion'
          else private.nivel_de_rol(x.organizacion_id, x.rol_id, p_seccion) <> 'ninguno'
        end
      ),
      false
    )
  end;
$$;

comment on function private.puede_accion(text, text) is
  'true si el usuario actual puede eliminar | exportar | ver_costos | editar_precio | anular | emitir_nota_credito | registrar_cobro | conciliar_pago | cobrar_contrarreembolso | despachar | ver_comisiones en la sección, con la misma resolución por empresa que nivel_seccion. Cualquier otra acción → false.';

revoke execute on function private.puede_accion(text, text) from public, anon;
grant execute on function private.puede_accion(text, text) to authenticated;

-- La columna nueva cambia el tipo de retorno: hay que recrear la función y sus grants.
drop function if exists public.permisos_actuales();

create function public.permisos_actuales()
returns table (seccion text, nivel text, eliminar boolean, exportar boolean, ver_costos boolean, ver_comisiones boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.seccion,
    (select private.nivel_seccion(s.seccion)),
    (select private.puede_accion(s.seccion, 'eliminar')),
    (select private.puede_accion(s.seccion, 'exportar')),
    (select private.puede_accion(s.seccion, 'ver_costos')),
    (select private.puede_accion(s.seccion, 'ver_comisiones'))
  from (select distinct m.seccion from private.matriz_inicial() m) s
  order by s.seccion;
$$;

comment on function public.permisos_actuales() is
  'Niveles y acciones del usuario actual por sección, solo para presentar menú y rutas. La autorización real la hace RLS con private.nivel_seccion/puede_accion.';

revoke all on function public.permisos_actuales() from public, anon;
grant execute on function public.permisos_actuales() to authenticated;

-- Organizaciones existentes: la siembra es idempotente (`on conflict do nothing`) y no pisa filas editadas.
select private.sembrar_permisos(id) from public.organizaciones;
