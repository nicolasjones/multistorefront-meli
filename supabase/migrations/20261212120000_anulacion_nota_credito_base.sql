-- F-VTA-11 (MSF-377, épica MSF-177, FR-048): base de la anulación y la nota de crédito.
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.comprobantes_venta           dominio (existente, MSF-159)  documento de venta: entidad de negocio.
--                                        Se altera solo de forma aditiva: columnas nulables y el `check` de `tipo`
--                                        (ahora admite `nota_credito`). RLS vigente (select por organización y sección
--                                        `ventas`); sin escritura directa; `anon` sin acceso.
--   dominio.comprobantes_venta_numeracion dominio (existente, MSF-159) solo se amplía el `check` de `tipo`: la nota de
--                                        crédito lleva su propio correlativo por organización y empresa.
--   public.permisos_rol_accion           public (existente, MSF-121/125) solo DATOS: acciones `anular` y
--                                        `emitir_nota_credito` de `ventas` (Administrador y Administración).
-- Ninguna tabla nueva.
--
-- Diseño:
--   · La nota de crédito es un documento propio (`tipo = 'nota_credito'`) con cantidades e importes POSITIVOS; el signo
--     lo da el tipo (`private.signo_comprobante`, en 20261212120500). Se asocia a su factura con `comprobante_origen_id`
--     (FK compuesta: nunca apunta a otra organización).
--   · Las líneas de una nota «Devolución de productos» reutilizan `comprobantes_venta_lineas` sin cambiar su estructura:
--     la línea de la nota lleva el MISMO `orden` que la línea de la factura que acredita (el `orden` es único por
--     comprobante), así el tope por línea se calcula sin columna nueva.
--   · `private.puede_accion_comprobante(empresa, accion)` resuelve la acción con el rol del usuario en ESA empresa
--     (igual que `puede_editar_precio_en_empresa`), no con la suma de sus roles.
--
-- Migración aditiva. Reversión (migración posterior; borrar antes las notas emitidas o exportarlas):
--   delete from dominio.comprobantes_venta_lineas where comprobante_id in (select id from dominio.comprobantes_venta where tipo = 'nota_credito');
--   delete from dominio.comprobantes_venta where tipo = 'nota_credito';
--   delete from dominio.comprobantes_venta_numeracion where tipo = 'nota_credito';
--   alter table dominio.comprobantes_venta drop constraint comprobantes_venta_tipo_ck, drop constraint comprobantes_venta_nc_ck,
--     drop constraint comprobantes_venta_origen_fk, drop constraint comprobantes_venta_nc_tipo_ck,
--     drop column comprobante_origen_id, drop column nc_tipo, drop column nc_concepto, drop column anulado_en,
--     drop column anulado_por, drop column motivo_anulacion;
--   alter table dominio.comprobantes_venta add check (tipo in ('factura', 'presupuesto'));
--   alter table dominio.comprobantes_venta_numeracion drop constraint comprobantes_venta_numeracion_tipo_ck;
--   alter table dominio.comprobantes_venta_numeracion add check (tipo in ('factura', 'presupuesto'));
--   delete from public.permisos_rol_accion where accion in ('anular', 'emitir_nota_credito');
--   restaurar private.siguiente_numero_comprobante, private.matriz_acciones_iniciales y private.puede_accion de
--   20261203100200 y 20261203200200, y el check de permisos_rol_accion_accion_check;
--   drop function private.puede_accion_comprobante(uuid, text);

-- ============================================================================
-- Columnas de la anulación y de la nota de crédito (todas nulables)
-- ============================================================================

alter table dominio.comprobantes_venta
  add column if not exists comprobante_origen_id uuid,
  add column if not exists nc_tipo text,
  add column if not exists nc_concepto text,
  add column if not exists anulado_en timestamptz,
  add column if not exists anulado_por uuid references auth.users (id) on delete set null,
  add column if not exists motivo_anulacion text;

-- El `check` real de `tipo` es el de la tabla original (20261018100000, sin nombre): se busca por su definición
-- y se reemplaza por uno nombrado que admite `nota_credito`. Lo mismo en la numeración (20261203100200).
do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass as tabla, c.conname
      from pg_constraint c
     where c.contype = 'c'
       and c.conrelid in ('dominio.comprobantes_venta'::regclass, 'dominio.comprobantes_venta_numeracion'::regclass)
       and pg_get_constraintdef(c.oid) ilike '%factura%'
       and pg_get_constraintdef(c.oid) ilike '%presupuesto%'
       and pg_get_constraintdef(c.oid) not ilike '%nota_credito%'
  loop
    execute format('alter table %s drop constraint %I', r.tabla, r.conname);
  end loop;

  if not exists (select 1 from pg_constraint where conname = 'comprobantes_venta_tipo_ck' and conrelid = 'dominio.comprobantes_venta'::regclass) then
    alter table dominio.comprobantes_venta
      add constraint comprobantes_venta_tipo_ck check (tipo in ('factura', 'presupuesto', 'nota_credito'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'comprobantes_venta_numeracion_tipo_ck' and conrelid = 'dominio.comprobantes_venta_numeracion'::regclass) then
    alter table dominio.comprobantes_venta_numeracion
      add constraint comprobantes_venta_numeracion_tipo_ck check (tipo in ('factura', 'presupuesto', 'nota_credito'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'comprobantes_venta_origen_fk' and conrelid = 'dominio.comprobantes_venta'::regclass) then
    alter table dominio.comprobantes_venta
      add constraint comprobantes_venta_origen_fk
      foreign key (comprobante_origen_id, organizacion_id) references dominio.comprobantes_venta (id, organizacion_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'comprobantes_venta_nc_tipo_ck' and conrelid = 'dominio.comprobantes_venta'::regclass) then
    alter table dominio.comprobantes_venta
      add constraint comprobantes_venta_nc_tipo_ck
      check (nc_tipo is null or nc_tipo in ('devolucion_productos', 'devolucion_importe', 'descuento'));
  end if;
  -- Una nota siempre cuelga de una factura y trae su tipo; ningún otro documento los lleva.
  if not exists (select 1 from pg_constraint where conname = 'comprobantes_venta_nc_ck' and conrelid = 'dominio.comprobantes_venta'::regclass) then
    alter table dominio.comprobantes_venta
      add constraint comprobantes_venta_nc_ck
      check (
        (tipo = 'nota_credito' and comprobante_origen_id is not null and nc_tipo is not null)
        or (tipo <> 'nota_credito' and comprobante_origen_id is null and nc_tipo is null and nc_concepto is null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'comprobantes_venta_motivo_anulacion_ck' and conrelid = 'dominio.comprobantes_venta'::regclass) then
    alter table dominio.comprobantes_venta
      add constraint comprobantes_venta_motivo_anulacion_ck
      check (motivo_anulacion is null or (btrim(motivo_anulacion) <> '' and length(motivo_anulacion) <= 300));
  end if;
end
$$;

create index if not exists comprobantes_venta_origen_idx
  on dominio.comprobantes_venta (organizacion_id, comprobante_origen_id)
  where comprobante_origen_id is not null;

comment on column dominio.comprobantes_venta.comprobante_origen_id is
  'Factura que acredita una nota de crédito (F-VTA-11). Solo la nota la lleva.';
comment on column dominio.comprobantes_venta.nc_tipo is
  'Motivo de la nota de crédito: devolucion_productos | devolucion_importe | descuento (F-VTA-11).';
comment on column dominio.comprobantes_venta.anulado_en is
  'Cuándo se anuló la factura (F-VTA-11). El número no se reutiliza.';
comment on column dominio.comprobantes_venta.motivo_anulacion is
  'Motivo obligatorio de la anulación (F-VTA-11).';

-- La numeración admite el correlativo propio de las notas de crédito.
create or replace function private.siguiente_numero_comprobante(p_empresa_id uuid, p_tipo text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_numero integer;
begin
  if v_org is null then
    raise exception 'Se necesita una sesión con organización' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('factura', 'presupuesto', 'nota_credito') then
    raise exception 'El tipo de comprobante no es válido' using errcode = '22023';
  end if;
  if not exists (select 1 from dominio.empresas e where e.id = p_empresa_id and e.organizacion_id = v_org) then
    raise exception 'La tienda no existe' using errcode = '22023';
  end if;

  insert into dominio.comprobantes_venta_numeracion as n (organizacion_id, empresa_id, tipo, ultimo)
  values (v_org, p_empresa_id, p_tipo, 1)
  on conflict (organizacion_id, empresa_id, tipo) do update set ultimo = n.ultimo + 1
  returning n.ultimo into v_numero;

  return v_numero;
end;
$$;

revoke execute on function private.siguiente_numero_comprobante(uuid, text) from public, anon, authenticated;

-- ============================================================================
-- Acciones `anular` y `emitir_nota_credito` (FR-048)
-- ============================================================================

alter table public.permisos_rol_accion drop constraint if exists permisos_rol_accion_accion_check;
alter table public.permisos_rol_accion
  add constraint permisos_rol_accion_accion_check
  check (accion in ('eliminar', 'exportar', 'ver_costos', 'editar_precio', 'anular', 'emitir_nota_credito'));

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
      else m.rol_id in ('administrador', 'administracion')
    end
  from private.matriz_inicial() m
  cross join (values ('eliminar'), ('exportar'), ('ver_costos'), ('editar_precio'), ('anular'), ('emitir_nota_credito')) as a(accion)
  where (a.accion not in ('editar_precio', 'anular', 'emitir_nota_credito') or m.seccion = 'ventas');
$$;

comment on function private.matriz_acciones_iniciales() is
  'Valores iniciales PROPUESTOS de permisos por acción (FR-006); pendientes de confirmar con el cliente. editar_precio (F-VTA-06) solo en ventas: Administrador y Operador. anular y emitir_nota_credito (F-VTA-11) solo en ventas: Administrador y Administración.';

create or replace function private.puede_accion(p_seccion text, p_accion text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_accion not in ('eliminar', 'exportar', 'ver_costos', 'editar_precio', 'anular', 'emitir_nota_credito') then false
    when (select private.is_superadmin())
      and exists (select 1 from public.superadmin_organizacion_activa a where a.user_id = (select auth.uid()))
      then true
    when p_accion in ('eliminar', 'editar_precio', 'anular', 'emitir_nota_credito')
      and (select private.nivel_seccion(p_seccion)) <> 'edicion' then false
    when (select private.nivel_seccion(p_seccion)) = 'ninguno' then false
    else coalesce(
      (
        select bool_or(private.accion_de_rol(x.organizacion_id, x.rol_id, p_seccion, p_accion))
        from private.roles_de_referencia(p_seccion) x
        where case
          when p_accion in ('eliminar', 'editar_precio', 'anular', 'emitir_nota_credito')
            then private.nivel_de_rol(x.organizacion_id, x.rol_id, p_seccion) = 'edicion'
          else private.nivel_de_rol(x.organizacion_id, x.rol_id, p_seccion) <> 'ninguno'
        end
      ),
      false
    )
  end;
$$;

comment on function private.puede_accion(text, text) is
  'true si el usuario actual puede eliminar | exportar | ver_costos | editar_precio | anular | emitir_nota_credito en la sección, con la misma resolución por empresa que nivel_seccion. Cualquier otra acción → false.';

revoke execute on function private.puede_accion(text, text) from public, anon;
grant execute on function private.puede_accion(text, text) to authenticated;

-- Acción de `ventas` resuelta con el rol del usuario en la empresa del comprobante (edición + acción permitida).
create or replace function private.puede_accion_comprobante(p_empresa_id uuid, p_accion text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_accion not in ('anular', 'emitir_nota_credito') then false
    when (select private.nivel_ventas_en_empresa(p_empresa_id)) <> 'edicion' then false
    when (select private.is_superadmin())
      and exists (select 1 from public.superadmin_organizacion_activa a where a.user_id = (select auth.uid()))
      then true
    else coalesce(
      (select private.accion_de_rol(
        (select private.organizacion_id()), (select private.rol_en_empresa(p_empresa_id)), 'ventas', p_accion)),
      false)
  end;
$$;

revoke execute on function private.puede_accion_comprobante(uuid, text) from public, anon, authenticated;

comment on function private.puede_accion_comprobante(uuid, text) is
  'anular | emitir_nota_credito de ventas con el rol del usuario en la empresa del comprobante (F-VTA-11, FR-048). Solo la llaman las RPC security definer.';

-- Siembra las acciones nuevas en las organizaciones existentes (las nuevas las siembra el trigger de alta).
select private.sembrar_permisos(id) from public.organizaciones;
