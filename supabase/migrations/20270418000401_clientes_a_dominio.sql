-- MSF-505 / MSF-882 (Lote L22 · Clientes): `public.clientes` pasa al esquema `dominio` (Principio VII).
--
-- Por qué: Clientes es una entidad de negocio y el resto del negocio ya vive en `dominio`. La excepción
-- documentada desde MSF-180 («tabla preexistente y expuesta») quedó abierta y se cierra acá: el traslado es
-- la deuda [MSF-505] de docs/tecnico/datos.md y docs/tecnico/clientes.md.
--
-- Esquemas (Principio VII, re-verificado): NO se crean tablas ni columnas. La tabla pasa de `public`
-- (plataforma) a `dominio` (producto). `public.clientes_identificadores_externos` y `public.clientes_empresas`
-- siguen en `public`: quedan fuera del alcance de MSF-505 (que pide ajustar, no mover, la primera) y su FK a
-- `clientes` sigue al OID de la tabla, así que no hay que tocar nada para que siga apuntando al cliente.
--
-- Qué hace, en este orden:
--   1. `alter table public.clientes set schema dominio`. Con la tabla se van sus políticas de RLS, sus
--      disparadores, sus índices, sus constraints y sus privilegios (todo eso vive en el OID de la tabla):
--      el aislamiento por organización y por sección queda igual, sin reescribir una sola política.
--   2. Las funciones vivas que nombraban `public.clientes` en su cuerpo se recrean con `dominio.clientes`.
--      El cuerpo de una función es TEXTO: sin esto, la primera consulta que use esa función falla en runtime
--      con `relation "public.clientes" does not exist` (no falla la migración). El barrido usa el CATÁLOGO
--      (`pg_proc`), no una lista escrita a mano, así que no puede quedar ninguna función atrás; y el barrido
--      se autocomprueba (abajo): si queda alguna, la migración falla en voz alta.
--   3. `private.conjuntos_exportacion_total()` pasa a listar `('dominio', 'clientes')`: el archivo del
--      volcado de la organización cambia de `public/clientes.csv` a `dominio/clientes.csv`.
--
-- Lo que NO cambia: los datos, la firma ni el resultado de las RPC, los permisos, el comportamiento de la
-- búsqueda y de la exportación (el filtro de texto unificado va en la migración siguiente) y el aislamiento.
-- PostgREST NO resuelve nombres sin calificar por el `extra_search_path`: elige el esquema por el
-- encabezado Accept-Profile / Content-Profile. Por eso el panel y los scripts pasan a pedir
-- `.schema('dominio').from('clientes')` (igual que `productos`); sin eso la API responde 404.
--
-- Lock: `alter table ... set schema` toma ACCESS EXCLUSIVE sobre la tabla mientras dura la migración; no
-- reescribe la tabla ni sus índices (los mueve). Las funciones se recrean en la misma transacción: o sale
-- todo o no sale nada.
-- Deadlock: el barrido recrea unas 60 funciones mientras otras sesiones pueden estar usándolas. En una base con
-- tráfico puede fallar con `deadlock detected` (se vio en dev vivo): aplicarla con cron y workers quietos, o
-- reintentar (la migración es una sola transacción, no deja nada a medias).
--
-- Reversión (en una migración posterior, NO en este PR):
--   alter table dominio.clientes set schema public;
--   -- y el barrido inverso: recrear las funciones que nombren `dominio.clientes` con `public.clientes`
--   -- (el mismo DO de esta migración, con los dos nombres invertidos);
--   -- y volver a listar ('public', 'clientes') en private.conjuntos_exportacion_total().

-- ============================================================================
-- 1. El traslado
-- ============================================================================

alter table public.clientes set schema dominio;

-- Convención de `dominio` (test service_role_privilegios): una tabla operativa le da a service_role
-- lectura/escritura completa y NADA más (en `public` tenía otros privilegios que viajaron con la tabla).
revoke all on table dominio.clientes from service_role;
grant select, insert, update, delete on table dominio.clientes to service_role;

-- ============================================================================
-- 2. Barrido de las funciones que nombraban la tabla en `public`
-- ============================================================================

do $$
declare
  r record;
  v_def text;
  v_nueva text;
  v_total integer := 0;
begin
  for r in
    select p.oid::regprocedure::text as firma, pg_get_functiondef(p.oid) as definicion
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname not in ('pg_catalog', 'information_schema')
       and p.prokind in ('f', 'p')
       and p.prosrc like '%public.clientes%'
     order by 1
  loop
    -- Sólo se reemplaza la palabra EXACTA `public.clientes` (`\M` = fin de palabra): `public.clientes_empresas`,
    -- `public.clientes_identificadores_externos` y la función `public.clientes_inactivos` NO se mueven.
    v_nueva := regexp_replace(r.definicion, '\mpublic\.clientes\M', 'dominio.clientes', 'g');
    begin
      execute v_nueva;
      v_total := v_total + 1;
    exception when others then
      raise exception 'No se pudo recrear % con el esquema nuevo: %', r.firma, sqlerrm;
    end;
  end loop;

  -- Autocomprobación: si el barrido no encontró nada es que el criterio no ve lo que cree (o que ya no
  -- hay funciones con el nombre viejo); y si queda alguna función nombrando `public.clientes`, el
  -- traslado dejaría funciones rotas en runtime.
  if v_total = 0 then
    raise exception 'El barrido no recreó ninguna función: revisar el criterio del traslado';
  end if;
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname not in ('pg_catalog', 'information_schema')
       and p.prosrc ~ '\mpublic\.clientes\M'
  ) then
    raise exception 'Quedaron funciones nombrando public.clientes: el traslado dejaría funciones rotas';
  end if;
  if to_regclass('dominio.clientes') is null or to_regclass('public.clientes') is not null then
    raise exception 'El traslado no dejó la tabla en dominio.clientes';
  end if;
end;
$$;

-- ============================================================================
-- 3. La exportación total: el conjunto pasa a `dominio`
-- ============================================================================

-- exportacion-total: se quita public.clientes (la tabla pasa a dominio.clientes, que se agrega en esta misma lista)
-- Redefine `private.conjuntos_exportacion_total()` (misma firma y privilegios) sobre la definición
-- vigente (`20270349000200_gastos_exportacion_total.sql`) con la fila de clientes movida a `dominio`.
create or replace function private.conjuntos_exportacion_total()
returns table (esquema text, tabla text, columnas text[])
language sql
stable
security definer
set search_path = ''
as $$
  select p.esquema, p.tabla, array_agg(a.attname::text order by a.attnum) as columnas
  from (values
    ('public', 'organizaciones'),
    ('dominio', 'actualizaciones_precio'),
    ('dominio', 'alicuotas_iva'),
    ('dominio', 'archivo_ingresos_mercaderia'),
    ('dominio', 'campana_correo_destinatarios'),
    ('dominio', 'campanas_correo'),
    ('dominio', 'cargas_iniciales_stock'),
    ('dominio', 'categorias'),
    ('dominio', 'categorias_empresa'),
    ('dominio', 'categorias_tienda'),
    ('dominio', 'clientes'),
    ('dominio', 'cobros_comprobante'),
    ('dominio', 'comprobante_impresiones'),
    ('dominio', 'comprobantes_venta'),
    ('dominio', 'comprobantes_venta_lineas'),
    ('dominio', 'comprobantes_venta_numeracion'),
    ('dominio', 'consulta_items'),
    ('dominio', 'consultas'),
    ('dominio', 'consultas_configuracion'),
    ('dominio', 'contactos'),
    ('dominio', 'contrarreembolsos'),
    ('dominio', 'costos_adicionales_canal'),
    ('dominio', 'cotizacion_aplicada'),
    ('dominio', 'cotizacion_configuracion'),
    ('dominio', 'cotizacion_inicial'),
    ('dominio', 'cotizacion_pendiente'),
    ('dominio', 'cotizaciones'),
    ('dominio', 'cuentas_cobro'),
    ('dominio', 'cuentas_cobro_empresas'),
    ('dominio', 'depositos'),
    ('dominio', 'depositos_empresas'),
    ('dominio', 'empresas'),
    ('dominio', 'envios_moto'),
    ('dominio', 'estados_consulta'),
    ('dominio', 'estados_reparacion'),
    ('dominio', 'existencias'),
    ('dominio', 'existencias_deposito'),
    ('dominio', 'existencias_variante'),
    ('dominio', 'faltantes_venta'),
    ('dominio', 'formas_envio'),
    ('dominio', 'formas_pago'),
    ('dominio', 'gastos'),
    ('dominio', 'historial_cobros'),
    ('dominio', 'historial_comprobantes'),
    ('dominio', 'historial_cotizaciones_dolar'),
    ('dominio', 'ingresos_mercaderia'),
    ('dominio', 'ingresos_mercaderia_lineas'),
    ('dominio', 'intereses_whatsapp'),
    ('dominio', 'listas_precios'),
    ('dominio', 'lotes_stock'),
    ('dominio', 'modelos_equipo'),
    ('dominio', 'motivos_movimiento'),
    ('dominio', 'movimientos_stock'),
    ('dominio', 'newsletter_configuracion'),
    ('dominio', 'newsletter_suscriptores'),
    ('dominio', 'opiniones_producto'),
    ('dominio', 'ordenes_compra'),
    ('dominio', 'ordenes_compra_items'),
    ('dominio', 'precios_empresa'),
    ('dominio', 'precios_propios_empresa'),
    ('dominio', 'precios_propios_historial'),
    ('dominio', 'presupuestos_tienda'),
    ('dominio', 'producto_costos'),
    ('dominio', 'producto_costos_historial'),
    ('dominio', 'producto_empresa'),
    ('dominio', 'producto_imagenes'),
    ('dominio', 'producto_precios_escala'),
    ('dominio', 'producto_relacionados'),
    ('dominio', 'producto_variantes'),
    ('dominio', 'productos'),
    ('dominio', 'productos_tienda'),
    ('dominio', 'promociones_precio'),
    ('dominio', 'proveedores'),
    ('dominio', 'proveedores_contactos'),
    ('dominio', 'proveedores_empresas'),
    ('dominio', 'rentabilidad_config'),
    ('dominio', 'reparacion_adjuntos'),
    ('dominio', 'reparacion_historial'),
    ('dominio', 'reparacion_items'),
    ('dominio', 'reparaciones'),
    ('dominio', 'reservas_stock'),
    ('dominio', 'respuestas_rapidas'),
    ('dominio', 'rma'),
    ('dominio', 'rma_items'),
    ('dominio', 'tienda_analitica'),
    ('dominio', 'tienda_borrador'),
    ('dominio', 'tienda_contenido'),
    ('dominio', 'tienda_envios'),
    ('dominio', 'tienda_identidad'),
    ('dominio', 'tienda_legal_enlaces'),
    ('dominio', 'tienda_paginas'),
    ('dominio', 'tienda_registros_dns'),
    ('dominio', 'tienda_versiones'),
    ('dominio', 'tiendas'),
    ('dominio', 'transiciones_estado_comprobante'),
    ('dominio', 'transportes'),
    ('dominio', 'transportes_empresas'),
    ('public', 'clientes_empresas'),
    ('public', 'cuentas_cliente'),
    ('public', 'documentos'),
    ('public', 'permisos_rol'),
    ('public', 'permisos_rol_accion'),
    ('public', 'usuarios_empresas'),
    ('public', 'usuarios_organizacion')
  ) as p (esquema, tabla)
  join pg_catalog.pg_namespace n on n.nspname = p.esquema
  join pg_catalog.pg_class c on c.relnamespace = n.oid and c.relname = p.tabla and c.relkind in ('r', 'p')
  join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where a.attname !~* '(secret|token|password|passwd|api_?key|vault|credencial|private_key)'
    -- MSF-468 (RF-NL-23): el SHA-256 del token de confirmación no sale en el volcado.
    and not (p.tabla = 'newsletter_suscriptores' and a.attname = 'confirmacion_hash')
  group by p.esquema, p.tabla
  order by p.esquema, p.tabla;
$$;

comment on function private.conjuntos_exportacion_total() is
  'F-OPS-06 (FR-031): lista permitida de conjuntos (esquema, tabla, columnas) de la exportación total. Las columnas salen del catálogo y excluyen las que parecen secretos. Sin datos de ninguna organización. `clientes` vive en `dominio` desde MSF-882 (MSF-505): su archivo es `dominio/clientes.csv`.';
