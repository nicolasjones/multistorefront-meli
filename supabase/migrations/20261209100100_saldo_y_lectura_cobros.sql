-- F-VTA-12 (MSF-389, épica MSF-195, spec 20261024-150000-ventas-cobros-y-conciliacion, FR-005, FR-010):
-- saldo del comprobante y lectura de sus cobros.
--
-- Esquema (Principio VII): sin tablas nuevas. Se leen `dominio.comprobantes_venta` y
-- `dominio.cobros_comprobante` (ambos `dominio`); las RPC viven en `public` y la función interna
-- en `private`.
--
-- · `private.saldo_comprobante` es VOLÁTIL a propósito: la usa `private.registrar_cobro_interno`
--   justo después de insertar el cobro y tiene que ver esa fila (una función `stable` usaría el
--   snapshot de la sentencia que la llamó y vería el saldo anterior).
-- · `public.saldo_comprobante` y `public.cobros_de_comprobante` son de LECTURA: `security invoker`
--   (manda la RLS de `dominio`) y además filtran por organización y empresa accesible.
-- · La organización y el actor salen de la sesión, nunca de un argumento.
-- · `public.cobros_de_comprobante` devuelve, además del nombre, el TIPO de la forma de pago y el
--   BANCO y el TITULAR de la cuenta de cobro: el detalle del comprobante (FR-008) muestra
--   «Banco · Titular» y distingue el contrarreembolso por tipo, no por nombre (el nombre lo
--   edita la persona y no es un dato estable).
--
-- Migración aditiva. Reversión (en una migración posterior; no se ejecuta en este PR):
--   drop function public.cobros_de_comprobante(uuid);
--   drop function public.saldo_comprobante(uuid);
--   drop function private.saldo_comprobante(uuid);

-- ============================================================================
-- Saldo interno: total con IVA, cobrado y saldo del comprobante (FR-005)
-- ============================================================================
-- Sin validación de permisos: es la cuenta interna que usa la RPC de cobros, que ya validó la
-- empresa del comprobante. Ve TODOS los cobros del comprobante (es `security definer`).

create or replace function private.saldo_comprobante(p_id uuid)
returns table (total numeric, cobrado numeric, saldo numeric)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_total numeric(14, 2);
  v_cobrado numeric(14, 2);
begin
  select c.total_con_iva into v_total
    from dominio.comprobantes_venta c
   where c.id = p_id;
  if not found then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;

  select coalesce(sum(b.importe), 0) into v_cobrado
    from dominio.cobros_comprobante b
   where b.comprobante_id = p_id;

  total := v_total;
  cobrado := v_cobrado;
  saldo := greatest(v_total - v_cobrado, 0);
  return query select total, cobrado, saldo;
end;
$$;

revoke execute on function private.saldo_comprobante(uuid) from public, anon, authenticated;

comment on function private.saldo_comprobante(uuid) is
  'Saldo del comprobante (total con IVA, cobrado y saldo). Función interna: no la ejecuta authenticated.';

-- ============================================================================
-- Saldo para la pantalla (FR-005)
-- ============================================================================

create or replace function public.saldo_comprobante(p_id uuid)
returns table (total numeric, cobrado numeric, saldo numeric)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select private.nivel_seccion('ventas')) not in ('lectura', 'edicion') then
    raise exception 'Necesitás acceso a Ventas para ver el saldo del comprobante' using errcode = '42501';
  end if;

  return query
  select c.total_con_iva,
         coalesce(sum(b.importe), 0),
         greatest(c.total_con_iva - coalesce(sum(b.importe), 0), 0)
    from dominio.comprobantes_venta c
    left join dominio.cobros_comprobante b
      on b.comprobante_id = c.id
     and b.organizacion_id = c.organizacion_id
     and b.empresa_id in (select private.empresas_accesibles())
   where c.id = p_id
     and c.organizacion_id = (select private.organizacion_id())
     and c.empresa_id in (select private.empresas_accesibles())
   group by c.total_con_iva;

  if not found then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.saldo_comprobante(uuid) from public, anon;
grant execute on function public.saldo_comprobante(uuid) to authenticated;

comment on function public.saldo_comprobante(uuid) is
  'Saldo del comprobante para la pantalla de ventas: total con IVA, cobrado y saldo. Solo lectura (RLS de dominio).';

-- ============================================================================
-- Cobros del comprobante (FR-010)
-- ============================================================================

create or replace function public.cobros_de_comprobante(p_comprobante_id uuid)
returns table (
  id uuid,
  fecha timestamptz,
  forma_pago text,
  forma_pago_tipo text,
  cuenta_cobro text,
  cuenta_cobro_banco text,
  cuenta_cobro_titular text,
  importe numeric,
  origen text,
  conciliado boolean,
  aprobado_por text,
  registrado_por text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select private.nivel_seccion('ventas')) not in ('lectura', 'edicion') then
    raise exception 'Necesitás acceso a Ventas para ver los cobros del comprobante' using errcode = '42501';
  end if;

  if not exists (
    select 1 from dominio.comprobantes_venta c
     where c.id = p_comprobante_id
       and c.organizacion_id = (select private.organizacion_id())
       and c.empresa_id in (select private.empresas_accesibles())
  ) then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;

  return query
  select b.id,
         b.registrado_en,
         f.nombre,
         f.tipo,
         cc.nombre,
         cc.banco,
         cc.titular,
         b.importe,
         b.origen,
         b.aprobado_por is not null,
         b.aprobado_por_nombre,
         b.registrado_por_nombre
    from dominio.cobros_comprobante b
    left join dominio.formas_pago f on f.id = b.forma_pago_id
    left join dominio.cuentas_cobro cc on cc.id = b.cuenta_cobro_id
   where b.comprobante_id = p_comprobante_id
     and b.organizacion_id = (select private.organizacion_id())
     and b.empresa_id in (select private.empresas_accesibles())
   order by b.registrado_en, b.id;
end;
$$;

revoke execute on function public.cobros_de_comprobante(uuid) from public, anon;
grant execute on function public.cobros_de_comprobante(uuid) to authenticated;

comment on function public.cobros_de_comprobante(uuid) is
  'Cobros del comprobante para la pantalla de ventas: fecha, forma de pago (nombre y tipo), cuenta de cobro (nombre, banco y titular), importe, origen, conciliado y quién registró o aprobó. Solo lectura (RLS de dominio).';
