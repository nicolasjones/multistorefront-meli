-- F-VTA-12/13/14 (épica MSF-195, cierre · T031): los datos de prueba de DEV de cobros,
-- conciliación de pagos y contrarreembolsos.
--
-- Qué verifica: que `supabase/seed.sql` deje en la organización de ejemplo «Mundo JC (demo)» los
-- datos que la épica necesita para probar las tres pantallas:
-- · la persona de ejemplo (Administradora activa con las tres acciones de la épica);
-- · dos tiendas (el filtro «Tienda» de Pagos y Transportes con dos opciones);
-- · dos cuentas de cobro activas (más una marcada «No usar») y dos transportes (uno que cobra
--   contrarreembolso y otro que no);
-- · cobros parciales y totales, con pagos repartidos en dos cuentas y dos tiendas, y un pago
--   conciliado (para que la pantalla Pagos muestre las dos tarjetas);
-- · un contrarreembolso pendiente abierto con `private.abrir_contrarreembolso` (la simulación de
--   la guía de despacho de F-VTA-16/MSF-135), con el importe igual al saldo del comprobante.
--
-- También comprueba que los eventos de la épica no lleven el CBU ni el CUIT completos.
--
-- Esta prueba solo lee: no siembra ni modifica nada. Si falla porque faltan datos, la base local
-- está con el seed viejo: `supabase db reset` (el CI siembra antes de correr los pgTAP).

begin;

select no_plan();

-- La organización de ejemplo la siembra MSF-241 (F-TDA-01). Sin ella (una base a la que no se le
-- aplicó el seed) esta prueba falla con este mensaje: no hay datos de DEV que verificar.
select ok(
  exists (
    select 1 from public.organizaciones
     where id = '0f5eed00-0000-4000-8000-000000000001'
  ),
  'la organización de ejemplo «Mundo JC (demo)» existe'
);

-- ============================================================================
-- La persona de ejemplo: sin ella no se puede entrar al panel a ver las tres pantallas
-- ============================================================================

select ok(
  exists (
    select 1
      from auth.users u
      join public.usuarios_organizacion uo on uo.user_id = u.id
     where u.email = 'ventas@local.test'
       and uo.organizacion_id = '0f5eed00-0000-4000-8000-000000000001'
       and uo.estado = 'activo'
       and uo.rol_id = 'administrador'
  ),
  'la persona de ejemplo existe, está activa y es administradora de la organización de ejemplo'
);

-- Las tres acciones de la épica: sin ellas la persona entra pero no puede cobrar, conciliar
-- ni marcar un contrarreembolso como cobrado (F-VTA-12/13/14).
select is(
  (select count(*)::int
     from public.permisos_rol_accion p
    where p.organizacion_id = '0f5eed00-0000-4000-8000-000000000001'
      and p.rol_id = 'administrador'
      and p.seccion = 'ventas'
      and p.accion in ('registrar_cobro', 'conciliar_pago', 'cobrar_contrarreembolso')
      and p.permitido),
  3,
  'la persona de ejemplo tiene las tres acciones de la épica en Ventas (cobrar, conciliar y cobrar el contrarreembolso)'
);

-- Las facturas del seed son del cliente de DEV (número 9100): el resto de los clientes de la
-- organización no las necesita.
select cmp_ok(
  (select count(*)::int
     from dominio.comprobantes_venta c
     join public.clientes cl on cl.id = c.cliente_id and cl.organizacion_id = c.organizacion_id
    where c.organizacion_id = '0f5eed00-0000-4000-8000-000000000001'
      and cl.numero = 9100),
  '>=', 6,
  'el seed dejó las seis facturas de ejemplo del cliente de DEV'
);

-- ============================================================================
-- Tiendas, cuentas de cobro y transportes
-- ============================================================================

select cmp_ok(
  (select count(*)::int from dominio.empresas
    where organizacion_id = '0f5eed00-0000-4000-8000-000000000001'),
  '>=', 2,
  'la organización de ejemplo tiene dos tiendas (el filtro «Tienda» con dos opciones)'
);

select cmp_ok(
  (select count(*)::int from dominio.cuentas_cobro
    where organizacion_id = '0f5eed00-0000-4000-8000-000000000001' and activa),
  '>=', 2,
  'hay al menos dos cuentas de cobro activas'
);

select ok(
  exists (
    select 1 from dominio.cuentas_cobro
     where organizacion_id = '0f5eed00-0000-4000-8000-000000000001' and not activa
  ),
  'hay una cuenta de cobro marcada «No usar» (conserva su historial y no recibe cobros nuevos)'
);

select ok(
  exists (
    select 1 from dominio.cuentas_cobro_empresas ce
      join dominio.cuentas_cobro c on c.id = ce.cuenta_id and c.organizacion_id = ce.organizacion_id
     where ce.organizacion_id = '0f5eed00-0000-4000-8000-000000000001'
       and c.activa
       and ce.empresa_id = '0f5eed01-0000-4000-8000-000000000003'
  ),
  'las cuentas de cobro están habilitadas en la segunda tienda'
);

select ok(
  exists (
    select 1 from dominio.transportes
     where organizacion_id = '0f5eed00-0000-4000-8000-000000000001' and cobra_contrarreembolso
  ),
  'hay un transporte que cobra contrarreembolso'
);

select ok(
  exists (
    select 1 from dominio.transportes
     where organizacion_id = '0f5eed00-0000-4000-8000-000000000001' and not cobra_contrarreembolso
  ),
  'hay un transporte que NO cobra contrarreembolso'
);

-- ============================================================================
-- El producto de ejemplo no deja a la organización en alerta de reposición
-- ============================================================================
--
-- El producto de ejemplo se crea sin existencias y el trigger `productos_crear_existencias` las
-- deja en 0: con 0 (`cantidad - reservado <= 0`) el estado es «sin_stock» y la organización de
-- ejemplo entraba en el barrido de alertas de reposición de Stock (MSF-394), que devuelve las
-- organizaciones con productos en alerta. Eso rompía el pgTAP de MSF-394 en el CI y disparaba
-- avisos de reposición para datos inventados. El seed deja el producto con stock; esta prueba lo
-- verifica para que no vuelva a pasar.

select cmp_ok(
  (select count(*)::int from public.stock_estados
    where organizacion_id = '0f5eed00-0000-4000-8000-000000000001'
      and estado = 'disponible'),
  '>', 0,
  'el producto de ejemplo queda «disponible» (no en alerta de reposición)'
);

select ok(
  not exists (
    select 1
      from unnest(public.organizaciones_con_resumen_pendiente()) o
     where o = '0f5eed00-0000-4000-8000-000000000001'::uuid
  ),
  'la organización de ejemplo no aparece en el barrido de resúmenes de reposición'
);

-- ============================================================================
-- Cobros: parciales y totales
-- ============================================================================

select ok(
  exists (
    select 1
      from dominio.cobros_comprobante b
      join dominio.comprobantes_venta c on c.id = b.comprobante_id and c.organizacion_id = b.organizacion_id
     where b.organizacion_id = '0f5eed00-0000-4000-8000-000000000001'
       and b.importe < c.total_con_iva
  ),
  'hay un cobro parcial: la factura queda con saldo'
);

select ok(
  exists (
    select 1
      from dominio.cobros_comprobante b
      join dominio.comprobantes_venta c on c.id = b.comprobante_id and c.organizacion_id = b.organizacion_id
     where b.organizacion_id = '0f5eed00-0000-4000-8000-000000000001'
       and b.importe = c.total_con_iva
  ),
  'hay un cobro total: la factura queda con saldo 0'
);

select ok(
  exists (
    select 1
      from dominio.cobros_comprobante b
      join dominio.comprobantes_venta c on c.id = b.comprobante_id and c.organizacion_id = b.organizacion_id
     where b.organizacion_id = '0f5eed00-0000-4000-8000-000000000001'
       and b.importe < c.total_con_iva
       and b.registrado_por is not null
  ),
  'el cobro parcial deja quién lo registró'
);

-- ============================================================================
-- Pagos: dos cuentas y dos tiendas (para la pantalla Pagos)
-- ============================================================================

select cmp_ok(
  (select count(distinct b.cuenta_cobro_id)::int
     from dominio.cobros_comprobante b
    where b.organizacion_id = '0f5eed00-0000-4000-8000-000000000001'
      and b.cuenta_cobro_id is not null),
  '>=', 2,
  'hay pagos en dos cuentas de cobro'
);

select cmp_ok(
  (select count(distinct b.empresa_id)::int
     from dominio.cobros_comprobante b
    where b.organizacion_id = '0f5eed00-0000-4000-8000-000000000001'
      and b.cuenta_cobro_id is not null),
  '>=', 2,
  'hay pagos en dos tiendas'
);

select ok(
  exists (
    select 1 from dominio.cobros_comprobante
     where organizacion_id = '0f5eed00-0000-4000-8000-000000000001'
       and aprobado_por is not null
       and aprobado_por_nombre is not null
       and aprobado_en is not null
  ),
  'hay un pago conciliado (con «Aprobado por»): la tarjeta «Conciliado» no queda en cero'
);

select ok(
  exists (
    select 1 from dominio.cobros_comprobante
     where organizacion_id = '0f5eed00-0000-4000-8000-000000000001'
       and cuenta_cobro_id is not null
       and aprobado_por is null
  ),
  'hay un pago por conciliar (con «Solo con saldo» se ve el saldo de la factura)'
);

-- ============================================================================
-- Contrarreembolso pendiente (simulación de la guía de despacho)
-- ============================================================================

select ok(
  exists (
    select 1 from dominio.contrarreembolsos
     where organizacion_id = '0f5eed00-0000-4000-8000-000000000001'
       and estado = 'pendiente'
       and guia = 'GUIA-DEV-0001'
  ),
  'hay un contrarreembolso pendiente abierto con la guía de DEV'
);

select ok(
  exists (
    select 1
      from dominio.contrarreembolsos cr
      join dominio.transportes t on t.id = cr.transporte_id and t.organizacion_id = cr.organizacion_id
     where cr.organizacion_id = '0f5eed00-0000-4000-8000-000000000001'
       and t.cobra_contrarreembolso
  ),
  'el contrarreembolso lo abrió un transporte que cobra al entregar'
);

select ok(
  not exists (
    select 1
      from dominio.contrarreembolsos cr
      join dominio.transportes t on t.id = cr.transporte_id and t.organizacion_id = cr.organizacion_id
     where cr.organizacion_id = '0f5eed00-0000-4000-8000-000000000001'
       and not t.cobra_contrarreembolso
  ),
  'el transporte que no cobra al entregar no abrió ningún contrarreembolso'
);

select ok(
  exists (
    select 1
      from dominio.contrarreembolsos cr
      join dominio.comprobantes_venta c on c.id = cr.comprobante_id and c.organizacion_id = cr.organizacion_id
     where cr.organizacion_id = '0f5eed00-0000-4000-8000-000000000001'
       and cr.estado = 'pendiente'
       and cr.importe = greatest(
             c.total_con_iva - coalesce(
               (select sum(b.importe) from dominio.cobros_comprobante b
                where b.comprobante_id = c.id and b.organizacion_id = c.organizacion_id),
               0),
             0)
  ),
  'el importe del contrarreembolso es el saldo del comprobante'
);

select ok(
  exists (
    select 1 from dominio.contrarreembolsos
     where organizacion_id = '0f5eed00-0000-4000-8000-000000000001'
       and cobrado_por is null
       and cobro_id is null
  ),
  'el contrarreembolso pendiente no tiene cobro asociado todavía'
);

-- ============================================================================
-- La actividad de la épica no lleva datos bancarios completos
-- ============================================================================

select ok(
  not exists (
    select 1 from public.registro_actividad r
     where r.organizacion_id = '0f5eed00-0000-4000-8000-000000000001'
       and r.tipo in (
         'comprobante.cobro_registrado',
         'pago.conciliado',
         'pago.conciliacion_revertida',
         'contrarreembolso.abierto',
         'contrarreembolso.cobrado'
       )
       and (
         r.detalle like '%0170099220000067797370%'
         or r.detalle like '%2850590940090418135201%'
         or r.detalle like '%20304050609%'
         or r.detalle like '%30714236896%'
       )
  ),
  'los eventos de cobros, pagos y contrarreembolsos no llevan el CBU ni el CUIT completos'
);

select * from finish();

rollback;
