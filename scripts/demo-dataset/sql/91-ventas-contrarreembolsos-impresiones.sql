-- Contrarreembolsos y documentos impresos del módulo 05 (paso SQL final, no vía API).
-- Por qué SQL, dos motivos:
--  1) Contrarreembolsos: la única función que los abre, `private.abrir_contrarreembolso`, no tiene RPC pública (la va a
--     usar la guía de despacho, que todavía no existe), así que por la API no se puede crear ninguno. Se abre acá (como
--     postgres, que es lo que hace el servidor) para las facturas con forma de pago «Contrarreembolso» y transporte que
--     cobra; y se COBRAN llamando a la RPC real `public.marcar_contrarreembolso_cobrado` con la identidad del usuario de
--     Administración (se simula su JWT con `request.jwt.claims`), de modo que el cobro, el cambio a «Cobrado» y la actividad
--     salen exactamente como en la aplicación.
--  2) Impresiones: `registrar_impresion` exige un documento ya «generado», y los PDF los genera un worker externo
--     (Storage + conexión `comprobantes-pdf`) que no existe en la demo. Se insertan los documentos como generados y las
--     impresiones se registran con la RPC real, con la identidad del Operador (algunas dos veces: la segunda es reimpresión).
-- Idempotente: mismas guías, documentos y impresiones no se repiten. Debe correr después del módulo 05.
--   psql "$DEMO_DB_URL" -v org="San Javucho y Mundo JC (demo)" -v sufijo="" -f sql/91-ventas-contrarreembolsos-impresiones.sql
-- Solo para bases demo.
\set ON_ERROR_STOP on
select id as org_id from public.organizaciones where nombre = :'org' \gset
\if :{?org_id}
begin;
select set_config('demo.org', :'org_id', true), set_config('demo.sufijo', :'sufijo', true);

do $$
declare
  v_org uuid := current_setting('demo.org')::uuid;
  v_suf text := current_setting('demo.sufijo');
  v_admin uuid;
  v_ope uuid;
  f record;
  v_cr uuid;
  v_fila dominio.contrarreembolsos;
  n int := 0;
  doc record;
  k int := 0;
begin
  select id into v_admin from auth.users where email = 'administracion' || v_suf || '@demo.msf.test';
  select id into v_ope from auth.users where email = 'operador' || v_suf || '@demo.msf.test';
  if v_admin is null or v_ope is null then
    raise exception 'No están los usuarios demo de Administración y Operador (¿sufijo "%"?)', v_suf;
  end if;

  -- 1) Abrir los contrarreembolsos de las facturas despachadas por un transporte que cobra.
  for f in
    select c.id, c.transporte_id, c.guia
      from dominio.comprobantes_venta c
      join dominio.formas_pago fp on fp.id = c.forma_pago_id
      join dominio.transportes t on t.id = c.transporte_id
     where c.organizacion_id = v_org and c.tipo = 'factura' and fp.tipo = 'contrarreembolso' and t.cobra_contrarreembolso
       and c.guia is not null and c.estado not in ('borrador', 'anulada')
     order by c.empresa_id, c.numero_entero
  loop
    perform private.abrir_contrarreembolso(f.id, f.transporte_id, f.guia);
  end loop;

  -- 2) Cobrar (rinde el transporte) los entregados: uno sí y uno no, así quedan pendientes y cobrados.
  --    Como Administración (única que cobra contrarreembolsos junto con el Administrador).
  --    Solo la primera vez: si ya hay alguno cobrado, otra corrida cobraría más y el reparto cambiaría.
  if not exists (select 1 from dominio.contrarreembolsos where organizacion_id = v_org and estado = 'cobrado') then
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  for f in
    select cr.id, cr.actualizado_en
      from dominio.contrarreembolsos cr
      join dominio.comprobantes_venta c on c.id = cr.comprobante_id
     where cr.organizacion_id = v_org and cr.estado = 'pendiente' and c.estado_despacho = 'entregado' and c.estado <> 'anulada'
     order by cr.empresa_id, c.numero_entero
  loop
    n := n + 1;
    if n % 2 = 1 then
      execute 'set local role authenticated';
      perform public.marcar_contrarreembolso_cobrado(f.id, f.actualizado_en);
      execute 'reset role';
    end if;
  end loop;
  end if;

  -- 3) Documentos e impresiones: facturas entregadas y cobradas, remitos y presupuestos vigentes.
  -- La ruta tiene que ser exactamente organización/empresa/comprobante/id.pdf (check de la tabla): el id se fija antes.
  insert into dominio.comprobante_documentos (id, organizacion_id, empresa_id, comprobante_id, tipo_documento, estado, ruta, solicitado_por, solicitado_en, generado_en)
  select nid, organizacion_id, empresa_id, cid, tipo, 'generado', organizacion_id || '/' || empresa_id || '/' || cid || '/' || nid || '.pdf', v_ope, now(), now()
   from (
  select gen_random_uuid() as nid, c.organizacion_id, c.empresa_id, c.id as cid, d.tipo
    from (
      select c.*, row_number() over (partition by c.tipo order by c.empresa_id, c.numero_entero) as rn
        from dominio.comprobantes_venta c
       where c.organizacion_id = v_org and c.empresa_id is not null
         and ((c.tipo = 'factura' and c.estado = 'cobrado' and c.estado_despacho = 'entregado')
           or (c.tipo = 'presupuesto' and c.estado in ('pendiente', 'aceptado') and (c.valido_hasta is null or c.valido_hasta >= current_date)))
    ) c
    cross join lateral (
      select unnest(case when c.tipo = 'presupuesto' then array['presupuesto'] when c.rn % 2 = 0 then array['factura', 'remito'] else array['factura'] end) as tipo
    ) d
   where c.rn <= 10 and not exists (
     select 1 from dominio.comprobante_documentos x where x.comprobante_id = c.id and x.tipo_documento = d.tipo and x.estado = 'generado')
  ) q;

  -- Impresiones con la identidad del Operador: casi todos una vez, algunos dos (reimpresión) y los últimos sin imprimir.
  perform set_config('request.jwt.claims', json_build_object('sub', v_ope, 'role', 'authenticated')::text, true);
  for doc in
    select d.id from dominio.comprobante_documentos d
     where d.organizacion_id = v_org and d.estado = 'generado' and d.ruta like v_org::text || '/%'
       and not exists (select 1 from dominio.comprobante_impresiones i where i.documento_id = d.id)
     order by d.comprobante_id, d.tipo_documento
  loop
    k := k + 1;
    continue when k % 5 = 0; -- uno de cada cinco queda solo generado
    execute 'set local role authenticated';
    perform public.registrar_impresion(doc.id);
    if k % 3 = 0 then perform public.registrar_impresion(doc.id); end if;
    execute 'reset role';
  end loop;
end $$;
commit;
\else
\echo 'No existe la organización: nada que hacer'
\endif
