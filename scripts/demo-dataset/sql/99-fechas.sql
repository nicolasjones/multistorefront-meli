-- Reparto coherente de las marcas de tiempo del dataset demo (paso SQL final, no vía API).
--
-- Por qué SQL y no API: todo lo que el dataset crea por RPC queda con `now()` (la hora de la siembra) en `creado_en`,
-- `created_at`, `updated_at`, `registrado_en`, `cargada_en`, `impreso_en`, etc.: las RPC no reciben ningún parámetro para
-- esas marcas (solo algunas reciben la fecha de NEGOCIO: `p_fecha`) y varias tablas de `dominio` son inmutables o tienen
-- triggers de auditoría que pisan `updated_at`. El resultado de la siembra es una demo donde 100 días de historia
-- aparecen cargados en un mismo minuto: el historial de comprobantes, la actividad, los cobros y los listados se ven mal.
-- Este paso reescribe SOLO marcas de tiempo (nunca fechas de negocio: `fecha`, `fecha_envio`, `ingreso_en`, `vence`…).
--
-- Cómo se hace (todo en UNA transacción, como `00-borrar-organizacion.sql`):
--   * `session_replication_role = replica` apaga los triggers de usuario de modo ORIGIN (auditoría de `updated_at`, etc.);
--     los de modo ALWAYS/REPLICA (inmutabilidad de `dominio.cotizaciones`) se apagan de a uno y se restauran al final en su
--     modo exacto. Al final se compara el estado de TODOS los triggers contra el de antes y, si difiere, se aborta.
--   * Fase A (solo lectura): se calcula el calendario de cada entidad en tablas temporales, a partir de las fechas de
--     negocio y de `md5(id)` (nada de random(): dos corridas dan lo mismo; las filas de HOY dependen de la hora de corrida
--     porque se reparten entre las 9 y la última hora en punto transcurrida, nunca en el futuro).
--   * Fase B: se aplican los UPDATE y se enlaza cada fila de `registro_actividad` con su entidad de origen (por número de
--     comprobante + tienda, `R-000N`, `RMA-000N`, SKU, nombre o posición dentro del mismo tipo).
--   * Fase C: se restauran los triggers y se verifican las reglas; si hay una sola violación se aborta (`raise exception`)
--     y no se persiste nada.
--
-- Calendario (días antes de hoy, hora de Buenos Aires, jornada 09:00-20:00, sin domingos salvo que la fecha de negocio lo sea):
--   -100 organización, empresas, usuarios, alícuotas, motivos, transiciones, estados y modelos iniciales, depósito principal
--    -99 proveedores y cotización inicial;  -98 categorías, cuentas de cobro, formas de pago/envío, transportes
--    -97..-93 catálogo de productos (alta, empresas, categoría, precios, costo inicial);  -96 tiendas y consultas (config.)
--    -94 depósitos nuevos;  -93 importación histórica;  -92 reglas de precio y catálogo visible de la tienda
--    -91 carga inicial de stock;  -90 stock mínimo;  -89..-86 estados/modelos de service nuevos
--    -88..hoy una cotización del dólar cada 8 días (la última, hoy);  desde la `fecha` de cada documento: el resto.
--
-- Reglas de coherencia (se verifican al final):
--   1. Nada en el futuro.  2. Un hijo nunca es anterior a su padre (cobro/línea/documento/historial >= comprobante;
--   movimiento/línea de ingreso >= ingreso y producto; reserva/existencia >= producto; ítem/historial >= reparación;
--   cuenta web >= cliente; comprobante/reparación >= cliente; producto >= proveedor y categoría…).
--   3. updated_at/actualizado_en >= creado_en/created_at.  4. Fechas de negocio intactas: `creado_en` de un comprobante =
--   su `fecha` + hora hábil (en orden de número dentro del día); cobro = fecha + 0-10 días según estado; entrega = su
--   fecha de envío; eventos de historial entre el alta y el cobro/entrega, en orden.
-- Único cambio de una fecha: `movimientos_stock.fecha` de los movimientos generados por un documento (venta, anulación,
-- devolución, entrega de reserva, carga inicial): la RPC la fijaba en `current_date` (el día de la siembra) y ahora lleva el
-- día de su documento. Las fechas cargadas a mano (compras, conteos, roturas) no se tocan.
-- Se omite a propósito lo operativo: ventana_vence_en/proximo_intento/reclamado_hasta de las colas, y lo que
-- 90-consultas.sql ya fechó (`consulta.estado_cambiado`, sus consultas, avisos e intereses de WhatsApp).
--   psql "$DEMO_DB_URL" -v org="San Javucho y Mundo JC (demo)" -v sufijo="" -f sql/99-fechas.sql
-- Solo para bases demo. Idempotente: correrlo de nuevo deja las mismas marcas.
\set ON_ERROR_STOP on
select id as org_id from public.organizaciones where nombre = :'org' \gset
\if :{?org_id}
begin;
select set_config('demo.org', :'org_id', true), set_config('demo.sufijo', :'sufijo', true);
set local session_replication_role = replica;

-- Estado de TODOS los triggers antes de tocar nada (se compara al final).
create temp table _trg on commit drop as
select c.oid::regclass::text as tabla, tg.tgname as nombre, tg.tgenabled::text as modo
  from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
 where not tg.tgisinternal;

-- Triggers ALWAYS/REPLICA: se apagan de a uno (patrón de 00-borrar-organizacion.sql) y se restauran en su modo exacto.
do $$
declare g record;
begin
  for g in select tabla, nombre from _trg where modo in ('A', 'R') loop
    execute format('alter table %s disable trigger %I', g.tabla, g.nombre);
  end loop;
end $$;

-- ============================ Funciones auxiliares (solo viven en esta sesión) ============================
-- Número pseudoaleatorio DETERMINÍSTICO en [0,1) a partir de un texto (md5), nunca random().
create or replace function pg_temp.u(t text, salt text default '') returns float8 language sql immutable as
$$ select (('x' || substr(md5(t || '|' || salt), 1, 12))::bit(48)::bigint)::float8 / 281474976710656.0 $$;
create or replace function pg_temp.hoy() returns date language sql stable as
$$ select (now() at time zone 'America/Argentina/Buenos_Aires')::date $$;
create or replace function pg_temp.tope() returns timestamptz language sql stable as
$$ select date_trunc('hour', now() - interval '40 minutes') $$;  -- cambia solo cada hora: dos corridas seguidas dan lo mismo
create or replace function pg_temp.dia_ar(t timestamptz) returns date language sql immutable as
$$ select (t at time zone 'America/Argentina/Buenos_Aires')::date $$;
-- Un domingo se corre al lunes (o al sábado si el lunes sería futuro).
create or replace function pg_temp.sin_domingo(d date) returns date language sql stable as
$$ select case when extract(dow from d) = 0 then case when d + 1 <= pg_temp.hoy() then d + 1 else d - 1 end else d end $$;
-- Instante dentro de la jornada 09:00-20:00 (hora de Buenos Aires) de la fecha d; frac en [0,1). Hoy: hasta la última hora
-- en punto transcurrida menos 40 min (así dos corridas en la misma hora dan lo mismo y nunca cae en el futuro).
create or replace function pg_temp.en_jornada(d date, frac float8) returns timestamptz language plpgsql stable as $$
declare v_ini float8 := 9 * 3600; v_fin float8 := 20 * 3600; v_seg float8;
begin
  if d >= pg_temp.hoy() then
    v_seg := extract(epoch from (now() at time zone 'America/Argentina/Buenos_Aires')::time)::float8;
    v_fin := least(v_fin, floor((v_seg - 2400) / 3600) * 3600);
    if v_fin - v_ini < 3600 then v_ini := 0; v_fin := greatest(floor((v_seg - 2400) / 1800) * 1800, 1800); end if;
  end if;
  return least((d::timestamp + make_interval(secs => v_ini + least(greatest(frac, 0), 0.999) * (v_fin - v_ini)))
               at time zone 'America/Argentina/Buenos_Aires', pg_temp.tope());
end $$;
-- Tramo [a,b) de la jornada: el i-ésimo de n elementos, en orden.
create or replace function pg_temp.tramo(d date, a float8, b float8, i int, n int) returns timestamptz language sql stable as
$$ select pg_temp.en_jornada(d, a + (b - a) * (i + 0.5) / greatest(n, 1)) $$;
-- Día hábil (lun-sáb) número j contando d0 (o el lunes siguiente si d0 es domingo) como 0.
create or replace function pg_temp.dia_habil(d0 date, j int) returns date language sql immutable as
$$ select (s - o) + ((o + j) / 6) * 7 + ((o + j) % 6)
     from (select s, extract(isodow from s)::int - 1 as o
             from (select case when extract(dow from d0) = 0 then d0 + 1 else d0 end as s) a) b $$;
create or replace function pg_temp.n_habiles(d0 date, d1 date) returns int language sql immutable as
$$ select count(*)::int from generate_series(d0::timestamp, d1::timestamp, interval '1 day') g where extract(dow from g) <> 0 $$;
-- El i-ésimo de n eventos repartidos parejo en horas hábiles entre los días d0 y d1.
create or replace function pg_temp.reparto(i int, n int, d0 date, d1 date) returns timestamptz language sql stable as
$$ select pg_temp.en_jornada(pg_temp.dia_habil(d0, j), f - floor(f))
     from (select f, least(floor(f)::int, m - 1) as j
             from (select (i + 0.5) / greatest(n, 1) * m as f, m from (select greatest(pg_temp.n_habiles(d0, d1), 1) as m) q) r) s $$;
-- Coordenada en "tiempo hábil" (día hábil + fracción de la jornada); los domingos comparten el día del lunes.
create or replace function pg_temp.coord(t timestamptz) returns float8 language sql immutable as
$$ select ((n / 7) * 6 + (n % 7))::float8
          + least(greatest((extract(epoch from (t at time zone 'America/Argentina/Buenos_Aires')::time)::float8 - 32400) / 39600, 0), 1)
     from (select (pg_temp.dia_ar(t) - date '2000-01-03') as n) q $$;
-- Punto intermedio (fracción p de 0 a 1) entre t0 y t1 medido en tiempo hábil: queda siempre dentro de la jornada, en
-- orden, y nunca antes de t0 si t1 >= t0 (los eventos de varios días no caen de madrugada ni en domingo).
create or replace function pg_temp.entre(t0 timestamptz, t1 timestamptz, p float8) returns timestamptz language sql stable as
$$ select least(((date '2000-01-03' + (j / 6) * 7 + (j % 6))::timestamp
                + make_interval(secs => 32400 + (c - j) * 39600)) at time zone 'America/Argentina/Buenos_Aires', pg_temp.tope())
     from (select c, floor(c)::int as j
             from (select pg_temp.coord(t0) + (greatest(pg_temp.coord(t1), pg_temp.coord(t0)) - pg_temp.coord(t0)) * p as c) q) r $$;

-- ============================ Fase A: calendario de cada entidad (solo lectura) ============================
create temp table _f on commit drop as
select pg_temp.hoy() as hoy,
       pg_temp.sin_domingo(pg_temp.hoy() - 100) as d_org,
       pg_temp.sin_domingo(pg_temp.hoy() - 99) as d_prov,
       pg_temp.sin_domingo(pg_temp.hoy() - 98) as d_cfg,
       pg_temp.sin_domingo(pg_temp.hoy() - 97) as d_prod0,
       pg_temp.sin_domingo(pg_temp.hoy() - 93) as d_prod1,
       pg_temp.sin_domingo(pg_temp.hoy() - 96) as d_tienda,
       pg_temp.sin_domingo(pg_temp.hoy() - 94) as d_dep,
       pg_temp.sin_domingo(pg_temp.hoy() - 93) as d_migra,
       pg_temp.sin_domingo(pg_temp.hoy() - 92) as d_precio,
       pg_temp.sin_domingo(pg_temp.hoy() - 91) as d_carga,
       pg_temp.sin_domingo(pg_temp.hoy() - 90) as d_min,
       pg_temp.sin_domingo(pg_temp.hoy() - 89) as d_srv0,
       pg_temp.sin_domingo(pg_temp.hoy() - 86) as d_srv1;

create temp table _org on commit drop as select pg_temp.en_jornada(d_org, 0.02) as ts from _f;
create temp table _e on commit drop as
select e.id, e.nombre, (row_number() over (order by e.created_at, e.id))::int as rn
  from dominio.empresas e where e.organizacion_id = :'org_id'::uuid;

-- ---- Catálogo base: proveedores, categorías, cuentas de cobro, formas de pago/envío, transportes
create temp table _t_prov on commit drop as
select p.id, p.razon_social, pg_temp.tramo(f.d_prov, 0.05, 0.6, (row_number() over (order by p.creado_en, p.id) - 1)::int, (count(*) over ())::int) as ts
  from dominio.proveedores p, _f f where p.organizacion_id = :'org_id'::uuid;
create temp table _t_cat on commit drop as
select c.id, (row_number() over (order by c.creado_en, c.id))::int as rn,
       pg_temp.tramo(f.d_cfg, 0.0, 0.3, (row_number() over (order by c.creado_en, c.id) - 1)::int, (count(*) over ())::int) as ts
  from dominio.categorias c, _f f where c.organizacion_id = :'org_id'::uuid;
create temp table _t_cta on commit drop as
select c.id, c.nombre, pg_temp.tramo(f.d_cfg, 0.35, 0.5, (row_number() over (order by c.creado_en, c.id) - 1)::int, (count(*) over ())::int) as ts
  from dominio.cuentas_cobro c, _f f where c.organizacion_id = :'org_id'::uuid;
create temp table _t_fp on commit drop as
select x.id, pg_temp.tramo(f.d_cfg, 0.5, 0.6, (row_number() over (order by x.created_at, x.id) - 1)::int, (count(*) over ())::int) as ts
  from dominio.formas_pago x, _f f where x.organizacion_id = :'org_id'::uuid;
create temp table _t_fe on commit drop as
select x.id, pg_temp.tramo(f.d_cfg, 0.6, 0.7, (row_number() over (order by x.created_at, x.id) - 1)::int, (count(*) over ())::int) as ts
  from dominio.formas_envio x, _f f where x.organizacion_id = :'org_id'::uuid;
create temp table _t_tr on commit drop as
select x.id, pg_temp.tramo(f.d_cfg, 0.7, 0.85, (row_number() over (order by x.creado_en, x.id) - 1)::int, (count(*) over ())::int) as ts
  from dominio.transportes x, _f f where x.organizacion_id = :'org_id'::uuid;

-- ---- Productos: alta repartida en 5 días hábiles, antes de todo el movimiento comercial
create temp table _t_prod on commit drop as
select p.id, p.sku, p.nombre,
       pg_temp.reparto((row_number() over (order by p.creado_en, p.id) - 1)::int, (count(*) over ())::int, f.d_prod0, f.d_prod1) as ts
  from dominio.productos p, _f f where p.organizacion_id = :'org_id'::uuid;

-- ---- Depósitos: el principal con la organización; los demás el día de depósitos
create temp table _t_dep on commit drop as
select d.id, d.nombre, d.por_defecto, (row_number() over (order by d.creado_en, d.id))::int as rn,
       case when d.por_defecto then pg_temp.en_jornada(f.d_org, 0.12)
            else pg_temp.tramo(f.d_dep, 0.1, 0.6, (row_number() over (partition by d.por_defecto order by d.creado_en, d.id) - 1)::int,
                               (count(*) over (partition by d.por_defecto))::int) end as ts
  from dominio.depositos d, _f f where d.organizacion_id = :'org_id'::uuid;

-- ---- Cotizaciones del dólar: una cada 8 días, en el orden de carga; la última, hoy
create temp table _t_cot on commit drop as
select c.id, (row_number() over (order by c.cargada_en, c.id) - 1)::int as i,
       pg_temp.en_jornada(pg_temp.sin_domingo(f.hoy - 8 * (count(*) over () - row_number() over (order by c.cargada_en, c.id))::int),
                          0.1 + 0.3 * pg_temp.u(c.id::text, 'cot')) as ts
  from dominio.cotizaciones c, _f f where c.organizacion_id = :'org_id'::uuid;

-- ---- Comprobantes
create temp table _c on commit drop as
select c.id, c.empresa_id, c.tipo, c.numero, c.estado, c.estado_despacho, c.fecha, c.fecha_envio, c.valido_hasta, c.cliente_id,
       c.comprobante_origen_id, c.confirmado_en is not null as conf, c.entregado_en is not null as entr, c.anulado_en is not null as anul,
       pg_temp.en_jornada(c.fecha, (c.rn - 1 + 0.15 + 0.7 * pg_temp.u(c.id::text, 'creado')) / c.cnt) as creado
  from (select c.*, row_number() over (partition by empresa_id, tipo, fecha order by coalesce(numero_entero, 0), id) as rn,
               count(*) over (partition by empresa_id, tipo, fecha) as cnt
          from dominio.comprobantes_venta c where c.organizacion_id = :'org_id'::uuid) c;
alter table _c add column confirmado timestamptz, add column entregado timestamptz, add column anulado timestamptz,
  add column aceptado timestamptz, add column cobro_ini timestamptz, add column cobro_fin timestamptz, add column envio_ts timestamptz;
update _c set confirmado = least(pg_temp.tope(), case when tipo = 'nota_credito' then creado + interval '1 minute'
                                                      else creado + make_interval(mins => 3 + floor(pg_temp.u(id::text, 'conf') * 40)::int) end)
 where conf;
update _c set envio_ts = least(pg_temp.tope(), confirmado + make_interval(mins => 30 + floor(pg_temp.u(id::text, 'env') * 90)::int))
 where conf and tipo = 'factura';
-- Entrega: el día de su fecha de envío (o 0-1 día después de la fecha), a la tarde, y al menos 3 h después de confirmar.
update _c set entregado = least(pg_temp.tope(), greatest(
    pg_temp.en_jornada(pg_temp.sin_domingo(least(coalesce(fecha_envio, fecha + floor(pg_temp.u(id::text, 'ed') * 2)::int), pg_temp.hoy())),
                       0.35 + 0.5 * pg_temp.u(id::text, 'eh')),
    confirmado + interval '3 hours' + make_interval(mins => floor(pg_temp.u(id::text, 'em') * 120)::int)))
 where entr;
-- Presupuesto aceptado: 1-3 días después de su fecha, sin pasar de su vencimiento ni de hoy.
update _c set aceptado = least(pg_temp.tope(), greatest(creado + interval '1 hour',
    pg_temp.en_jornada(pg_temp.sin_domingo(least(fecha + 1 + floor(pg_temp.u(id::text, 'ac') * 3)::int, coalesce(valido_hasta, fecha + 3), pg_temp.hoy())),
                       0.4 + 0.5 * pg_temp.u(id::text, 'ah'))))
 where tipo = 'presupuesto' and estado = 'aceptado';

-- ---- Cobros (fecha del comprobante + 0-10 días según estado; los de contrarreembolso, cuando el transporte rinde)
create temp table _cb on commit drop as
select cb.id, cb.comprobante_id as cid, cb.origen,
       (row_number() over (partition by cb.comprobante_id order by cb.registrado_en, cb.id))::int as k
  from dominio.cobros_comprobante cb where cb.organizacion_id = :'org_id'::uuid;
alter table _cb add column raw timestamptz, add column ts timestamptz;
update _cb b set raw = case
    when b.origen = 'contrarreembolso' and c.entregado is not null then
      least(pg_temp.tope(), greatest(
        pg_temp.en_jornada(pg_temp.sin_domingo(least(pg_temp.dia_ar(c.entregado) + 3 + floor(pg_temp.u(b.id::text, 'cr') * 6)::int, pg_temp.hoy())),
                           0.3 + 0.6 * pg_temp.u(b.id::text, 'crh')),
        c.entregado + interval '2 days'))
    else greatest(
        pg_temp.en_jornada(pg_temp.sin_domingo(least(c.fecha + least(10,
            case c.estado when 'deuda' then 4 + floor(pg_temp.u(c.id::text, 'd1') * 6)::int
                          when 'confirmada' then 1 + floor(pg_temp.u(c.id::text, 'd1') * 5)::int
                          when 'anulada' then floor(pg_temp.u(c.id::text, 'd1') * 2)::int
                          else floor(pg_temp.u(c.id::text, 'd1') * 4)::int end
            + (b.k - 1) * (1 + floor(pg_temp.u(b.id::text, 'dk') * 3)::int))::int, pg_temp.hoy())),
            0.25 + 0.65 * pg_temp.u(b.id::text, 'ch')),
        c.confirmado + make_interval(mins => 15 + 10 * b.k)) end
  from _c c where c.id = b.cid;
-- Dentro de un comprobante, cada cobro al menos 5 min después del anterior.
update _cb b set ts = least(pg_temp.tope(), x.ts)
  from (select id, max(raw - k * interval '5 minutes') over (partition by cid order by k) + k * interval '5 minutes' as ts from _cb) x
 where x.id = b.id;
update _c c set cobro_ini = x.mn, cobro_fin = x.mx from (select cid, min(ts) mn, max(ts) mx from _cb group by cid) x where x.cid = c.id;
update _c set anulado = least(pg_temp.tope(), greatest(confirmado, coalesce(cobro_fin, confirmado))
                              + make_interval(mins => 45 + floor(pg_temp.u(id::text, 'an') * 2400)::int))
 where anul;

-- ---- Contrarreembolsos, faltantes, documentos e impresiones
create temp table _cr on commit drop as
select cr.id, cr.comprobante_id as cid, cr.cobro_id, cr.cobrado_en is not null as cobrado, c.envio_ts + interval '1 minute' as creado,
       (select b.ts from _cb b where b.id = cr.cobro_id) as cobrado_ts
  from dominio.contrarreembolsos cr join _c c on c.id = cr.comprobante_id where cr.organizacion_id = :'org_id'::uuid;
create temp table _fa on commit drop as
select f.id, f.comprobante_id as cid, f.resuelto_en is not null as res,
       (row_number() over (partition by f.comprobante_id order by f.linea_orden, f.id))::int as k
  from dominio.faltantes_venta f where f.organizacion_id = :'org_id'::uuid;
alter table _fa add column creado timestamptz, add column resuelto timestamptz;
update _fa f set creado = least(pg_temp.tope(), c.confirmado + make_interval(mins => 60 + floor(pg_temp.u(f.id::text, 'f') * 120)::int + 3 * f.k))
  from _c c where c.id = f.cid;
update _fa f set resuelto = least(pg_temp.tope(), greatest(f.creado + interval '4 hours',
    pg_temp.en_jornada(pg_temp.sin_domingo(least(pg_temp.dia_ar(f.creado) + 1 + floor(pg_temp.u(f.id::text, 'fr') * 3)::int, pg_temp.hoy())), 0.5)))
 where f.res;
create temp table _doc on commit drop as
select d.id, d.comprobante_id as cid, d.tipo_documento as tipo,
       least(pg_temp.tope(), case when d.tipo_documento = 'presupuesto' then c.creado + make_interval(mins => 10 + floor(pg_temp.u(d.id::text, 'ds') * 120)::int)
            else coalesce(c.entregado, c.confirmado) + make_interval(mins => 10 + floor(pg_temp.u(d.id::text, 'ds') * 300)::int) end) as solicitado
  from dominio.comprobante_documentos d join _c c on c.id = d.comprobante_id where d.organizacion_id = :'org_id'::uuid;
alter table _doc add column generado timestamptz;
update _doc set generado = least(pg_temp.tope(), solicitado + make_interval(secs => 3 + floor(pg_temp.u(id::text, 'dg') * 20)::int));
create temp table _imp on commit drop as
select i.id, i.documento_id, i.comprobante_id as cid, i.tipo_documento as tipo, i.reimpresion,
       (row_number() over (partition by i.comprobante_id, i.tipo_documento, i.reimpresion order by i.impreso_en, i.id))::int as k,
       least(pg_temp.tope(), case when not i.reimpresion then d.generado + make_interval(secs => 20 + floor(pg_temp.u(i.id::text, 'ip') * 600)::int)
            else greatest(d.generado + interval '1 hour',
                 pg_temp.en_jornada(pg_temp.sin_domingo(least(pg_temp.dia_ar(d.generado) + 1 + floor(pg_temp.u(i.id::text, 'ir') * 5)::int, pg_temp.hoy())),
                                    0.2 + 0.7 * pg_temp.u(i.id::text, 'irh'))) end) as ts
  from dominio.comprobante_impresiones i join _doc d on d.id = i.documento_id where i.organizacion_id = :'org_id'::uuid;

-- ---- Ingresos de mercadería y lotes
create temp table _ing on commit drop as
select i.id, i.fecha, i.comprobante, i.anulado_en is not null as anul,
       pg_temp.en_jornada(i.fecha, (i.rn - 1 + 0.15 + 0.7 * pg_temp.u(i.id::text, 'ing')) / i.cnt) as creado
  from (select i.*, row_number() over (partition by fecha order by creado_en, id) as rn, count(*) over (partition by fecha) as cnt
          from dominio.ingresos_mercaderia i where i.organizacion_id = :'org_id'::uuid) i;
alter table _ing add column anulado timestamptz;
update _ing set anulado = least(pg_temp.tope(), greatest(creado + interval '2 hours',
    pg_temp.en_jornada(pg_temp.sin_domingo(least(fecha + 1 + floor(pg_temp.u(id::text, 'ia') * 4)::int, pg_temp.hoy())), 0.2 + 0.6 * pg_temp.u(id::text, 'iah'))))
 where anul;
create temp table _ingl on commit drop as
select l.id, l.ingreso_id, l.producto_id, l.movimiento_id, l.movimiento_anulacion_id,
       (row_number() over (partition by l.ingreso_id order by l.creado_en, l.id))::int as rn
  from dominio.ingresos_mercaderia_lineas l where l.organizacion_id = :'org_id'::uuid;
alter table _ingl add column ts timestamptz;
update _ingl l set ts = i.creado + make_interval(secs => l.rn) from _ing i where i.id = l.ingreso_id;
-- Historial de costos: el primero con el alta del producto; los siguientes con la compra (línea de ingreso) k-ésima del producto
create temp table _hc on commit drop as
select h.id, h.producto_id, h.k,
       case when h.k = 1 then p.ts + interval '4 seconds'
            else coalesce(l.ts + interval '1 second', p.ts + make_interval(days => h.k::int, secs => 4)) end as ts
  from (select id, producto_id, row_number() over (partition by producto_id order by vigente_desde, id) as k
          from dominio.producto_costos_historial where organizacion_id = :'org_id'::uuid) h
  join _t_prod p on p.id = h.producto_id
  left join (select producto_id, ts, row_number() over (partition by producto_id order by ts, id) as k from _ingl) l on l.producto_id = h.producto_id and l.k = h.k - 1;
create temp table _lot on commit drop as
select l.id, l.numero, l.fecha,
       pg_temp.en_jornada(l.fecha, (l.rn - 1 + 0.15 + 0.7 * pg_temp.u(l.id::text, 'lot')) / l.cnt) as creado
  from (select l.*, row_number() over (partition by fecha order by creado_en, id) as rn, count(*) over (partition by fecha) as cnt
          from dominio.lotes_stock l where l.organizacion_id = :'org_id'::uuid) l;

-- ---- Reservas de stock (las de pedido, repartidas; las de una línea a pedido, con su comprobante)
create temp table _rs on commit drop as
select r.id, r.producto_id, r.deposito_id, r.estado, r.referencia,
       case when r.referencia like 'comprobante:%' then split_part(r.referencia, ':', 2)::uuid end as cid,
       (row_number() over (partition by (r.referencia like 'comprobante:%') order by r.creado_en, r.id) - 1)::int as k,
       (count(*) over (partition by (r.referencia like 'comprobante:%')))::int as n
  from dominio.reservas_stock r where r.organizacion_id = :'org_id'::uuid;
alter table _rs add column creado timestamptz, add column resuelto timestamptz;
update _rs r set creado = case when r.cid is not null then (select c.confirmado + interval '1 second' from _c c where c.id = r.cid)
                               else pg_temp.reparto(r.k, r.n, (select hoy from _f) - 60, (select hoy from _f) - 8) end;
update _rs r set resuelto = case
    when r.estado = 'activa' then null
    when r.cid is not null then least(pg_temp.tope(), greatest(r.creado + interval '1 hour',
         coalesce((select c.entregado from _c c where c.id = r.cid), (select c.confirmado from _c c where c.id = r.cid) + interval '2 hours')))
    else least(pg_temp.tope(), greatest(r.creado + interval '1 hour',
         pg_temp.en_jornada(pg_temp.sin_domingo(least(pg_temp.dia_ar(r.creado) + 2 + floor(pg_temp.u(r.id::text, 'rs') * 8)::int, pg_temp.hoy())),
                            0.3 + 0.5 * pg_temp.u(r.id::text, 'rsh')))) end;

-- ---- RMA (devoluciones): después de la entrega de la factura; la vinculada a una nota de crédito, antes de ella
create temp table _rma on commit drop as
select r.id, r.numero, r.estado, r.comprobante_id as cid, r.nota_credito_id, r.stock_reingresado_en is not null as reing
  from dominio.rma r where r.organizacion_id = :'org_id'::uuid;
alter table _rma add column creado timestamptz, add column fin timestamptz, add column reingresado timestamptz,
  add column vinculada timestamptz, add column actualizado timestamptz;
update _rma r set creado = greatest(
    pg_temp.en_jornada(pg_temp.sin_domingo(least(pg_temp.dia_ar(coalesce(c.entregado, c.confirmado)) + 1 + floor(pg_temp.u(r.id::text, 'rm') * 12)::int, pg_temp.hoy() - 1)),
                       0.2 + 0.6 * pg_temp.u(r.id::text, 'rmh')),
    coalesce(c.entregado, c.confirmado) + interval '2 hours')
  from _c c where c.id = r.cid;
update _rma r set creado = least(r.creado, nc.creado - interval '1 hour') from _c nc where nc.id = r.nota_credito_id;
update _rma set creado = least(creado, pg_temp.tope() - interval '2 hours');
update _rma set fin = least(pg_temp.tope(), case estado
    when 'cerrado' then pg_temp.entre(creado, creado + make_interval(days => 3 + floor(pg_temp.u(id::text, 'rf') * 8)::int), 1)
    when 'en_gestion' then pg_temp.entre(creado, creado + make_interval(days => 1 + floor(pg_temp.u(id::text, 'rf') * 4)::int), 1)
    else creado end);
update _rma set reingresado = pg_temp.entre(creado, fin, 0.8) where reing;
update _rma r set vinculada = nc.confirmado + interval '1 minute' from _c nc where nc.id = r.nota_credito_id;
update _rma set actualizado = greatest(fin, coalesce(reingresado, creado), coalesce(vinculada, creado));

-- ---- Reparaciones (service técnico)
create temp table _rep on commit drop as
select r.id, r.empresa_id, r.numero, r.cliente_id, r.ingreso_en, r.entrega_real, r.anulada_en is not null as anul,
       pg_temp.en_jornada(r.ingreso_en, (r.rn - 1 + 0.15 + 0.7 * pg_temp.u(r.id::text, 'rep')) / r.cnt) as creado
  from (select r.*, row_number() over (partition by empresa_id, ingreso_en order by numero, id) as rn, count(*) over (partition by empresa_id, ingreso_en) as cnt
          from dominio.reparaciones r where r.organizacion_id = :'org_id'::uuid) r;
create temp table _rh on commit drop as
select h.id, h.reparacion_id as rid, h.tipo,
       (row_number() over (partition by h.reparacion_id, h.tipo order by h.creado_en, h.id))::int as k,
       (count(*) over (partition by h.reparacion_id, h.tipo))::int as n
  from dominio.reparacion_historial h where h.organizacion_id = :'org_id'::uuid;
alter table _rep add column fin timestamptz, add column n_est int;
update _rep r set n_est = (select count(*) from _rh h where h.rid = r.id and h.tipo = 'estado');
-- Fin del tramo: entrega real (a la tarde), anulación 1-3 días después del alta; si sigue en curso, ~1,5 días por estado.
update _rep set fin = least(pg_temp.tope(), case
    when entrega_real is not null then greatest(creado + interval '2 hours',
         pg_temp.en_jornada(pg_temp.sin_domingo(least(entrega_real, pg_temp.hoy())), 0.3 + 0.5 * pg_temp.u(id::text, 'ren')))
    when anul then pg_temp.entre(creado, creado + make_interval(days => 1 + floor(pg_temp.u(id::text, 'ran') * 3)::int), 1)
    else greatest(creado + interval '5 minutes', least(pg_temp.entre(creado, creado + make_interval(days => 1 + ceil((n_est + 1) * (0.5 + pg_temp.u(id::text, 'rcu') * 1.5))::int), 1),
                                                       pg_temp.tope() - make_interval(mins => floor(pg_temp.u(id::text, 'rtp') * 240)::int))) end);
alter table _rh add column ts timestamptz;
update _rh h set ts = case h.tipo
    when 'alta' then r.creado
    when 'estado' then pg_temp.entre(r.creado, r.fin, h.k::float8 / (h.n + 1))
    else r.fin end
  from _rep r where r.id = h.rid;
create temp table _ri on commit drop as
select i.id, i.reparacion_id as rid, (row_number() over (partition by i.reparacion_id order by i.creado_en, i.id))::int as k,
       (count(*) over (partition by i.reparacion_id))::int as n
  from dominio.reparacion_items i where i.organizacion_id = :'org_id'::uuid;
alter table _ri add column ts timestamptz;
update _ri i set ts = pg_temp.entre(r.creado, r.fin, 0.25 + 0.5 * i.k::float8 / (i.n + 1)) from _rep r where r.id = i.rid;

-- ---- Clientes y cuentas web: el alta antes de su primer documento
create temp table _cli on commit drop as
select c.id, c.numero, c.es_consumidor_final as cf, c.archivado_en is not null as arch,
       (select min(x.t) from (select min(creado) t from _c where cliente_id = c.id union all select min(creado) from _rep where cliente_id = c.id) x) as primer_doc,
       (select max(x.t) from (select max(coalesce(anulado, entregado, confirmado, creado)) t from _c where cliente_id = c.id union all select max(fin) from _rep where cliente_id = c.id) x) as ultimo_doc,
       (row_number() over (partition by c.es_consumidor_final order by c.numero, c.id) - 1)::int as k,
       (count(*) over (partition by c.es_consumidor_final))::int as n
  from public.clientes c where c.organizacion_id = :'org_id'::uuid;
alter table _cli add column creado timestamptz, add column archivado timestamptz;
update _cli c set creado = case
    when c.cf then pg_temp.en_jornada(f.d_org, 0.3)
    when c.primer_doc is null then pg_temp.reparto(c.k, c.n, f.hoy - 96, f.hoy - 65)
    else least(pg_temp.reparto(c.k, c.n, f.hoy - 96, f.hoy - 65),
               pg_temp.en_jornada(pg_temp.sin_domingo(pg_temp.dia_ar(c.primer_doc) - 1 - floor(pg_temp.u(c.id::text, 'cl') * 3)::int), pg_temp.u(c.id::text, 'clh'))) end
  from _f f;
update _cli c set archivado = least(pg_temp.tope(), greatest(coalesce(c.ultimo_doc, c.creado) + interval '1 hour',
    pg_temp.en_jornada(pg_temp.sin_domingo(least(pg_temp.dia_ar(greatest(c.creado, coalesce(c.ultimo_doc, c.creado))) + 2 + floor(pg_temp.u(c.id::text, 'ca') * 15)::int, pg_temp.hoy())),
                       0.3 + 0.5 * pg_temp.u(c.id::text, 'cah'))))
 where c.arch;
create temp table _cta_web on commit drop as
select cc.id, cc.cliente_id, cl.numero, e.nombre as empresa,
       (row_number() over (order by cl.numero, cc.empresa_id) - 1)::int as k, (count(*) over ())::int as n
  from public.cuentas_cliente cc join _cli cl on cl.id = cc.cliente_id join dominio.empresas e on e.id = cc.empresa_id
 where cc.organizacion_id = :'org_id'::uuid;
alter table _cta_web add column creado timestamptz;
update _cta_web w set creado = least(pg_temp.tope(), greatest(pg_temp.reparto(w.k, w.n, f.hoy - 80, f.hoy - 20),
    cl.creado + interval '1 day' + make_interval(hours => floor(pg_temp.u(w.id::text, 'cw') * 48)::int)))
  from _f f, _cli cl where cl.id = w.cliente_id;

-- ---- Consultas que cargó el módulo 07 por la vía pública (las de 90-consultas.sql ya tienen fecha y aviso)
create temp table _con on commit drop as
select c.id, c.origen, c.empresa_id, c.nombre, c.contacto,
       (row_number() over (order by c.created_at, c.id) - 1)::int as k, (count(*) over ())::int as n
  from dominio.consultas c
 where c.organizacion_id = :'org_id'::uuid and not exists (select 1 from dominio.consultas_avisos a where a.consulta_id = c.id);
alter table _con add column ts timestamptz;
update _con c set ts = pg_temp.reparto(c.k, c.n, f.hoy - 45, f.hoy - 2) from _f f;

-- ---- Movimientos de stock: _mvl = (movimiento, marca, ¿lleva la fecha de su documento?)
create temp table _mv0 on commit drop as
select m.id, m.fecha, m.nota, m.producto_id, m.deposito_id, m.cantidad, mo.nombre as motivo
  from dominio.movimientos_stock m join dominio.motivos_movimiento mo on mo.id = m.motivo_id where m.organizacion_id = :'org_id'::uuid;
create temp table _mvl (id uuid primary key, ts timestamptz not null, fecha_doc boolean not null default false) on commit drop;
-- carga inicial de stock: un solo día, por depósito (en el orden en que se crearon) y producto
insert into _mvl
select cis.movimiento_id, pg_temp.tramo(f.d_carga, 0.05, 0.9, (row_number() over (order by d.rn, p.sku, cis.id) - 1)::int, (count(*) over ())::int), true
  from dominio.cargas_iniciales_stock cis join _t_dep d on d.id = cis.deposito_id join dominio.productos p on p.id = cis.producto_id, _f f
 where cis.organizacion_id = :'org_id'::uuid and cis.movimiento_id is not null on conflict do nothing;
-- compras de ingresos (y su anulación) y de lotes
insert into _mvl select l.movimiento_id, l.ts, false from _ingl l where l.movimiento_id is not null on conflict do nothing;
insert into _mvl select l.movimiento_anulacion_id, i.anulado + make_interval(secs => l.rn), true
  from _ingl l join _ing i on i.id = l.ingreso_id where l.movimiento_anulacion_id is not null and i.anulado is not null on conflict do nothing;
insert into _mvl select m.id, l.creado + make_interval(secs => (row_number() over (partition by m.lote_id order by m.id))::int), false
  from dominio.movimientos_stock m join _lot l on l.id = m.lote_id where m.organizacion_id = :'org_id'::uuid on conflict do nothing;
-- ventas: la línea de la factura confirmada que las originó (mismo número, producto, depósito y cantidad)
insert into _mvl
select v.id, c.confirmado + make_interval(secs => l.orden), true
  from (select m.id, (regexp_match(m.nota, '^Factura ([0-9-]+)'))[1] as numero, m.producto_id, m.deposito_id, m.cantidad,
               row_number() over (partition by (regexp_match(m.nota, '^Factura ([0-9-]+)'))[1], m.producto_id, m.deposito_id, m.cantidad order by m.id) as rk
          from _mv0 m where m.motivo = 'Venta de factura') v
  join (select l.orden, c.numero, l.producto_id, l.deposito_id, l.cantidad, c.id as cid,
               row_number() over (partition by c.numero, l.producto_id, l.deposito_id, l.cantidad order by c.empresa_id, l.id) as rk
          from dominio.comprobantes_venta_lineas l join dominio.comprobantes_venta c on c.id = l.comprobante_id
         where c.organizacion_id = :'org_id'::uuid and c.tipo = 'factura' and c.confirmado_en is not null) l
    on l.numero = v.numero and l.producto_id = v.producto_id and l.deposito_id = v.deposito_id and l.cantidad = v.cantidad and l.rk = v.rk
  join _c c on c.id = l.cid
on conflict do nothing;
-- anulación de factura
insert into _mvl
select x.id, c.anulado + make_interval(secs => x.rk), true
  from (select m.id, (regexp_match(m.nota, 'factura ([0-9-]+)$'))[1] as numero, m.producto_id, m.deposito_id, m.cantidad,
               row_number() over (partition by (regexp_match(m.nota, 'factura ([0-9-]+)$'))[1], m.producto_id, m.deposito_id, m.cantidad order by m.id) as rk
          from _mv0 m where m.motivo = 'Anulación de factura') x
  join (select c.id as cid, c.numero, l.producto_id, l.deposito_id, l.cantidad,
               row_number() over (partition by c.numero, l.producto_id, l.deposito_id, l.cantidad order by c.empresa_id, l.id) as rk
          from _c c join dominio.comprobantes_venta_lineas l on l.comprobante_id = c.id where c.tipo = 'factura' and c.anul) l
    on l.numero = x.numero and l.producto_id = x.producto_id and l.deposito_id = x.deposito_id and l.cantidad = x.cantidad and l.rk = x.rk
  join _c c on c.id = l.cid
on conflict do nothing;
-- devolución de cliente por nota de crédito
insert into _mvl
select x.id, nc.confirmado + make_interval(secs => (row_number() over (partition by nc.id order by x.id))::int), true
  from (select m.id, (regexp_match(m.nota, 'Nota de crédito ([0-9-]+) sobre la factura ([0-9-]+)'))[1] as n_nc,
               (regexp_match(m.nota, 'Nota de crédito ([0-9-]+) sobre la factura ([0-9-]+)'))[2] as n_f
          from _mv0 m where m.motivo = 'Devolución de cliente') x
  join _c nc on nc.tipo = 'nota_credito' and nc.numero = x.n_nc
  join _c f on f.id = nc.comprobante_origen_id and f.numero = x.n_f
on conflict do nothing;
-- entrega de una reserva
insert into _mvl
select m.id, r.resuelto + interval '1 second', true
  from _mv0 m join _rs r on r.referencia = substr(m.nota, 9) where m.motivo = 'Entrega de producto a pedido' and r.resuelto is not null
on conflict do nothing;
-- reingreso por devolución (RMA-000N)
insert into _mvl
select m.id, r.reingresado + interval '1 second', true
  from _mv0 m join _rma r on r.numero = (regexp_match(m.nota, '^(RMA-[0-9]+)'))[1] where r.reingresado is not null
on conflict do nothing;
-- el resto (compras directas, conteos, roturas, traslados…): su propia fecha + hora hábil, en el orden original dentro del día
insert into _mvl
select x.id, pg_temp.en_jornada(x.fecha, (x.rn - 1 + 0.15 + 0.7 * pg_temp.u(x.id::text, 'mv')) / x.cnt), false
  from (select m.id, m.fecha, row_number() over (partition by m.fecha order by m2.creado_en, m.id) as rn, count(*) over (partition by m.fecha) as cnt
          from _mv0 m join dominio.movimientos_stock m2 on m2.id = m.id where not exists (select 1 from _mvl l where l.id = m.id)) x
on conflict do nothing;

-- ============================ Actividad: de qué entidad es cada evento ============================
create temp table _a on commit drop as
select a.id, a.tipo, a.empresa_id, a.detalle, a.creado_en as orig,
       (regexp_match(a.detalle, '(factura|presupuesto|remito|nota de crédito) ([0-9][0-9-]*)'))[1] as kind,
       (regexp_match(a.detalle, '(factura|presupuesto|remito|nota de crédito) ([0-9][0-9-]*)'))[2] as num,
       null::uuid as cid
  from public.registro_actividad a where a.organizacion_id = :'org_id'::uuid;
update _a set num = (regexp_match(detalle, ' como ([0-9][0-9-]*)'))[1], kind = 'presupuesto' where tipo = 'presupuesto.copiado';
update _a a set cid = (select c.id from _c c where c.empresa_id = a.empresa_id and c.numero = a.num
                          and c.tipo = case a.kind when 'factura' then 'factura' when 'remito' then 'factura' when 'presupuesto' then 'presupuesto' else 'nota_credito' end)
 where a.num is not null and (a.tipo like 'comprobante.%' or a.tipo like 'despacho.%' or a.tipo like 'presupuesto.%' or a.tipo like 'contrarreembolso.%');

create temp table _ts (id uuid primary key, ts timestamptz not null, cid uuid) on commit drop;
-- Comprobantes
insert into _ts select a.id, c.creado, c.id from _a a join _c c on c.id = a.cid where a.tipo = 'comprobante.creado' on conflict do nothing;
insert into _ts select r.id, pg_temp.entre(c.creado, coalesce(c.confirmado, c.creado + interval '30 minutes'), r.rt::float8 / (r.nt + 1)), c.id
  from (select a.id, a.cid, row_number() over (partition by a.cid order by a.orig, a.id) as rt, count(*) over (partition by a.cid) as nt
          from _a a where a.tipo = 'comprobante.editado') r join _c c on c.id = r.cid on conflict do nothing;
insert into _ts select a.id, c.confirmado, c.id from _a a join _c c on c.id = a.cid where a.tipo = 'comprobante.confirmado' and c.confirmado is not null on conflict do nothing;
insert into _ts select a.id, c.aceptado, c.id from _a a join _c c on c.id = a.cid where a.tipo = 'presupuesto.aceptado' and c.aceptado is not null on conflict do nothing;
insert into _ts select a.id, c.creado + interval '1 minute', c.id from _a a join _c c on c.id = a.cid where a.tipo = 'presupuesto.copiado' on conflict do nothing;
insert into _ts select r.id, case
      when r.destino = 'Cobrado' and c.cobro_fin is not null then c.cobro_fin + make_interval(secs => r.rt)
      when r.destino = 'Deuda' and c.cobro_ini is not null then c.cobro_ini + interval '1 second'
      when r.destino = 'Aceptado' and c.aceptado is not null then c.aceptado + interval '1 second'
      else pg_temp.entre(coalesce(c.confirmado, c.creado), greatest(coalesce(c.entregado, coalesce(c.confirmado, c.creado) + interval '6 hours'), coalesce(c.confirmado, c.creado) + interval '1 hour'),
                 r.rt::float8 / (r.nt + 1)) end, c.id
  from (select a.id, a.cid, split_part(split_part(a.detalle, '→ ', 2), ' en ', 1) as destino,
               row_number() over (partition by a.cid order by a.orig, a.id) as rt, count(*) over (partition by a.cid) as nt
          from _a a where a.tipo = 'comprobante.estado_cambiado') r join _c c on c.id = r.cid on conflict do nothing;
insert into _ts select a.id, b.ts, a.cid
  from (select a.id, a.cid, row_number() over (partition by a.cid order by a.orig, a.id) as rt from _a a where a.tipo = 'comprobante.cobro_registrado') a
  join _cb b on b.cid = a.cid and b.k = a.rt on conflict do nothing;
insert into _ts select a.id, c.anulado, c.id from _a a join _c c on c.id = a.cid where a.tipo = 'comprobante.anulado' and c.anulado is not null on conflict do nothing;
insert into _ts select a.id, c.confirmado, c.id from _a a join _c c on c.id = a.cid where a.tipo = 'comprobante.nota_credito_emitida' on conflict do nothing;
insert into _ts select a.id, i.ts, a.cid
  from (select a.id, a.cid, a.kind, a.tipo, row_number() over (partition by a.cid, a.kind, a.tipo order by a.orig, a.id) as rt
          from _a a where a.tipo in ('comprobante.impreso', 'comprobante.reimpreso')) a
  join _imp i on i.cid = a.cid and i.tipo = a.kind and i.reimpresion = (a.tipo = 'comprobante.reimpreso') and i.k = a.rt on conflict do nothing;
-- Despacho
insert into _ts select r.id, c.envio_ts + make_interval(mins => 15 * (r.rt - 1)::int), c.id
  from (select a.id, a.cid, row_number() over (partition by a.cid order by a.orig, a.id) as rt from _a a where a.tipo = 'despacho.envio_guardado') r
  join _c c on c.id = r.cid where c.envio_ts is not null on conflict do nothing;
insert into _ts select r.id, case when c.entregado is not null
         then pg_temp.entre(c.confirmado + interval '20 minutes', c.entregado, r.rt::float8 / r.nt)
         else pg_temp.entre(c.confirmado + interval '20 minutes', c.confirmado + interval '20 minutes' + make_interval(hours => 2 * (r.nt + 1)::int), r.rt::float8 / (r.nt + 1)) end, c.id
  from (select a.id, a.cid, row_number() over (partition by a.cid order by a.orig, a.id) as rt, count(*) over (partition by a.cid) as nt
          from _a a where a.tipo = 'despacho.estado_cambiado') r join _c c on c.id = r.cid where c.confirmado is not null on conflict do nothing;
insert into _ts select a.id, f.creado, a.cid
  from (select a.id, a.cid, row_number() over (partition by a.cid order by a.orig, a.id) as rt from _a a where a.tipo = 'despacho.faltante_registrado') a
  join _fa f on f.cid = a.cid and f.k = a.rt on conflict do nothing;
insert into _ts select a.id, case a.tipo when 'contrarreembolso.abierto' then cr.creado + interval '1 second' else coalesce(cr.cobrado_ts, cr.creado + interval '1 second') end, a.cid
  from _a a join _cr cr on cr.cid = a.cid where a.tipo in ('contrarreembolso.abierto', 'contrarreembolso.cobrado') on conflict do nothing;
-- RMA (por su número RMA-000N, único en la organización)
insert into _ts select a.id, r.creado, null from _a a join _rma r on r.numero = (regexp_match(a.detalle, 'RMA-[0-9]+'))[1] where a.tipo = 'rma.registrada' on conflict do nothing;
insert into _ts select x.id, pg_temp.entre(r.creado, r.fin, x.rt::float8 / x.nt), null
  from (select a.id, (regexp_match(a.detalle, 'RMA-[0-9]+'))[1] as num,
               row_number() over (partition by (regexp_match(a.detalle, 'RMA-[0-9]+'))[1] order by a.orig, a.id) as rt,
               count(*) over (partition by (regexp_match(a.detalle, 'RMA-[0-9]+'))[1]) as nt from _a a where a.tipo = 'rma.estado_cambiado') x
  join _rma r on r.numero = x.num on conflict do nothing;
insert into _ts select a.id, r.reingresado, null from _a a join _rma r on r.numero = (regexp_match(a.detalle, 'RMA-[0-9]+'))[1] where a.tipo = 'rma.stock_reingresado' and r.reingresado is not null on conflict do nothing;
insert into _ts select a.id, r.vinculada, null from _a a join _rma r on r.numero = (regexp_match(a.detalle, 'RMA-[0-9]+'))[1] where a.tipo = 'rma.nota_credito_vinculada' and r.vinculada is not null on conflict do nothing;
-- Service: reparaciones por (tienda, R-000N)
create temp table _arep on commit drop as
select a.id, a.tipo, a.orig, r.id as rid
  from _a a join _rep r on r.empresa_id = a.empresa_id and 'R-' || lpad(r.numero::text, 4, '0') = (regexp_match(a.detalle, 'R-[0-9]+'))[1]
 where a.tipo like 'reparacion.%';
insert into _ts select a.id, r.creado, null from _arep a join _rep r on r.id = a.rid where a.tipo = 'reparacion.creada' on conflict do nothing;
insert into _ts select a.id, r.creado + interval '2 minutes', null from _arep a join _rep r on r.id = a.rid where a.tipo = 'reparacion.editada' on conflict do nothing;
insert into _ts select x.id, h.ts, null
  from (select a.id, a.rid, row_number() over (partition by a.rid order by a.orig, a.id) as rt from _arep a where a.tipo = 'reparacion.estado_cambiado') x
  join _rh h on h.rid = x.rid and h.tipo = 'estado' and h.k = x.rt on conflict do nothing;
insert into _ts select a.id, h.ts, null from _arep a join _rh h on h.rid = a.rid and h.tipo = 'entrega' where a.tipo = 'reparacion.entregada' on conflict do nothing;
insert into _ts select a.id, h.ts, null from _arep a join _rh h on h.rid = a.rid and h.tipo = 'anulacion' where a.tipo = 'reparacion.anulada' on conflict do nothing;
insert into _ts select x.id, i.ts, null
  from (select a.id, a.rid, row_number() over (partition by a.rid order by a.orig, a.id) as rt from _arep a where a.tipo = 'reparacion.item_agregado') x
  join _ri i on i.rid = x.rid and i.k = x.rt on conflict do nothing;
-- Catálogo, proveedores, categorías, cuentas de cobro
insert into _ts select a.id, p.ts + interval '1 second', null from _a a join _t_prod p on p.sku = (regexp_match(a.detalle, '\(SKU (.+)\)$'))[1] where a.tipo = 'producto.creado' on conflict do nothing;
insert into _ts select a.id, p.ts + interval '2 seconds', null from _a a join _t_prod p on p.sku = (regexp_match(a.detalle, '\(SKU (.+)\)'))[1] where a.tipo = 'producto.categoria_asignada' on conflict do nothing;
insert into _ts select a.id, p.ts + interval '3 seconds', null from _a a join _t_prod p on p.sku = (regexp_match(a.detalle, '\(SKU (.+)\)'))[1] where a.tipo = 'producto.empresas_actualizadas' on conflict do nothing;
insert into _ts select x.id, p.ts + interval '10 seconds' + make_interval(secs => 2 * x.rt::int), null
  from (select a.id, (regexp_match(a.detalle, 'escala x[0-9]+ de (.*)$'))[1] as nombre,
               row_number() over (partition by (regexp_match(a.detalle, 'escala x[0-9]+ de (.*)$'))[1] order by a.orig, a.id) as rt
          from _a a where a.tipo = 'producto.precio_actualizado') x
  join (select distinct on (nombre) nombre, ts from _t_prod order by nombre, id) p on p.nombre = x.nombre on conflict do nothing;
insert into _ts select x.id, h.ts, null
  from (select a.id, p.id as pid, row_number() over (partition by p.id order by a.orig, a.id) as rt
          from _a a join (select distinct on (nombre) nombre, id from _t_prod order by nombre, id) p on a.detalle = 'Cambió el costo de ' || p.nombre
         where a.tipo = 'producto.precio_actualizado') x
  join _hc h on h.producto_id = x.pid and h.k = x.rt + 1 on conflict do nothing;
insert into _ts select a.id, p.ts + interval '1 second', null from _a a join _t_prov p on a.detalle = 'Creó el proveedor ' || p.razon_social where a.tipo = 'proveedor.creado' on conflict do nothing;
insert into _ts select a.id, c.ts + interval '1 second', null
  from (select a.id, row_number() over (order by a.orig, a.id) as rt from _a a where a.tipo = 'categoria.creada') a join _t_cat c on c.rn = a.rt on conflict do nothing;
insert into _ts select a.id, c.ts + interval '1 second', null from _a a join _t_cta c on a.detalle = 'Creó la cuenta de cobro ' || c.nombre where a.tipo = 'cuenta_cobro.creada' on conflict do nothing;
-- Cotizaciones del dólar: la k-ésima carga, el k-ésimo recálculo (aplicado u omitido)
insert into _ts select a.id, c.ts, null
  from (select a.id, row_number() over (order by a.orig, a.id) - 1 as i from _a a where a.tipo = 'cotizacion.cargada') a join _t_cot c on c.i = a.i on conflict do nothing;
insert into _ts select a.id, c.ts + interval '1 second', null
  from (select a.id, row_number() over (order by a.orig, a.id) - 1 as i from _a a where a.tipo in ('recalculo.aplicado', 'recalculo.omitido')) a join _t_cot c on c.i = a.i on conflict do nothing;
-- Depósitos, cargas y movimientos de stock
insert into _ts select a.id, d.ts + interval '1 second', null from _a a join _t_dep d on a.detalle = 'Depósito creado: ' || d.nombre where a.tipo = 'stock.deposito_creado' on conflict do nothing;
insert into _ts select a.id, pg_temp.en_jornada(f.d_dep, 0.02), null from _a a join _t_dep d on a.detalle = 'Depósito editado: ' || d.nombre, _f f where a.tipo = 'stock.deposito_editado' on conflict do nothing;
insert into _ts select a.id, coalesce((select max(l.ts) from _mvl l join dominio.movimientos_stock m on m.id = l.id where m.deposito_id = d.id), d.ts) + interval '1 day', null
  from _a a join _t_dep d on a.detalle = 'Depósito desactivado: ' || d.nombre where a.tipo = 'stock.deposito_activo' on conflict do nothing;
insert into _ts select a.id, (select max(l.ts) from _mvl l join dominio.cargas_iniciales_stock cis on cis.movimiento_id = l.id where cis.deposito_id = d.id) + interval '1 second', null
  from _a a join _t_dep d on a.detalle like 'Carga de stock por planilla en ' || d.nombre || ':%' where a.tipo = 'stock.carga_inicial' on conflict do nothing;
insert into _ts select distinct on (e.id) e.id, l.ts + interval '1 second', null
  from (select a.id, a.tipo, regexp_match(a.detalle, '^(Entrada|Salida|Ajuste) de .* \(SKU (.*)\) en (.*): (-?[0-9]+) unidades, stock resultante (-?[0-9]+)$') as r
          from _a a where a.tipo in ('stock.entrada', 'stock.salida', 'stock.ajuste')) e
  join dominio.productos p on p.organizacion_id = :'org_id'::uuid and p.sku = e.r[2]
  join dominio.depositos d on d.organizacion_id = :'org_id'::uuid and d.nombre = e.r[3]
  join dominio.movimientos_stock m on m.producto_id = p.id and m.deposito_id = d.id and m.saldo = e.r[5]::int
       and (m.cantidad = e.r[4]::int or abs(m.diferencia) = e.r[4]::int) and m.tipo = lower(e.r[1])
  join _mvl l on l.id = m.id
 order by e.id, m.id on conflict do nothing;
insert into _ts select x.id, pg_temp.tramo(f.d_min, 0.05, 0.9, (x.rt - 1)::int, x.nt::int), null
  from (select a.id, row_number() over (order by a.orig, a.id) as rt, count(*) over () as nt from _a a where a.tipo = 'stock.minimo') x, _f f on conflict do nothing;
insert into _ts select a.id, l.creado + interval '1 second', null from _a a join _lot l on a.detalle like 'Lote de stock ' || l.numero || ' de %' where a.tipo = 'stock.lote_registrado' on conflict do nothing;
insert into _ts select a.id, i.creado + interval '1 second', null
  from (select a.id, row_number() over (partition by coalesce((regexp_match(a.detalle, '\(comprobante ([^)]*)\)'))[1], '') order by a.orig, a.id) as rt,
               coalesce((regexp_match(a.detalle, '\(comprobante ([^)]*)\)'))[1], '') as comp from _a a where a.tipo = 'ingreso.registrado') a
  join (select i.id, i.creado, coalesce(i.comprobante, '') as comprobante, row_number() over (partition by coalesce(i.comprobante, '') order by i.creado, i.id) as rt from _ing i) i
    on i.comprobante = a.comp and i.rt = a.rt on conflict do nothing;
insert into _ts select a.id, i.anulado + interval '1 second', null
  from (select a.id, row_number() over (order by a.orig, a.id) as rt from _a a where a.tipo = 'ingreso.anulado') a
  join (select i.id, i.anulado, row_number() over (order by i.anulado, i.id) as rt from _ing i where i.anul) i on i.rt = a.rt on conflict do nothing;
-- Reservas: la k-ésima de cada clase, en el orden en que se creó / resolvió
insert into _ts select a.id, r.creado + interval '1 second', null
  from (select a.id, row_number() over (order by a.orig, a.id) as rt from _a a where a.tipo = 'stock.reserva') a
  join (select r.id, r.creado, row_number() over (order by r.creado, r.id) as rt from _rs r where r.cid is null) r on r.rt = a.rt on conflict do nothing;
insert into _ts select a.id, r.resuelto, null
  from (select a.id, row_number() over (order by a.orig, a.id) as rt from _a a where a.tipo = 'stock.reserva_descontada') a
  join (select r.id, r.resuelto, row_number() over (order by r.resuelto, r.id) as rt from _rs r where r.estado = 'descontada') r on r.rt = a.rt on conflict do nothing;
insert into _ts select a.id, r.resuelto, null
  from (select a.id, row_number() over (order by a.orig, a.id) as rt from _a a where a.tipo = 'stock.reserva_liberada') a
  join (select r.id, r.resuelto, row_number() over (order by r.resuelto, r.id) as rt from _rs r where r.estado = 'liberada') r on r.rt = a.rt on conflict do nothing;
-- Traslados: el par de movimientos de cada traslado
insert into _ts select x.id, t.ts + interval '1 second', null
  from (select a.id, row_number() over (order by a.orig, a.id) as rt from _a a where a.tipo = 'stock.traslado') x
  join (select m.traslado_id, min(l.ts) as ts, row_number() over (order by min(l.ts), m.traslado_id) as rt
          from dominio.movimientos_stock m join _mvl l on l.id = m.id where m.traslado_id is not null and m.organizacion_id = :'org_id'::uuid group by m.traslado_id) t on t.rt = x.rt on conflict do nothing;
-- Clientes y cuentas web
insert into _ts select a.id, c.creado + interval '1 second', null from _a a join _cli c on c.numero = (regexp_match(a.detalle, 'Nº ([0-9]+)'))[1]::int where a.tipo = 'cliente.creado' on conflict do nothing;
insert into _ts select a.id, c.archivado, null from _a a join _cli c on c.numero = (regexp_match(a.detalle, 'Nº ([0-9]+)'))[1]::int where a.tipo = 'cliente.archivado' and c.archivado is not null on conflict do nothing;
insert into _ts select x.id, case x.tipo when 'cliente.cuenta_creada' then w.creado
         else greatest(w.creado + interval '1 hour', pg_temp.en_jornada(pg_temp.sin_domingo(least(pg_temp.dia_ar(w.creado) + 3 * x.rt::int + floor(pg_temp.u(x.id::text, 'cu') * 5)::int, pg_temp.hoy())), 0.5)) end, null
  from (select a.id, a.tipo, (regexp_match(a.detalle, 'Nº ([0-9]+)'))[1]::int as numero, (regexp_match(a.detalle, '^.* en (.*)$'))[1] as empresa,
               row_number() over (partition by (regexp_match(a.detalle, 'Nº ([0-9]+)'))[1]::int, (regexp_match(a.detalle, '^.* en (.*)$'))[1] order by a.tipo, a.orig, a.id) - 1 as rt
          from _a a where a.tipo in ('cliente.cuenta_creada', 'cliente.cuenta_restablecida', 'cliente.cuenta_suspendida')) x
  join _cta_web w on w.numero = x.numero and x.empresa = w.empresa on conflict do nothing;
-- Tienda, avisos de consultas, reglas de precio, usuarios
insert into _ts select a.id, pg_temp.tramo(f.d_tienda, 0.1, 0.3, e.rn - 1, 2) + interval '1 second', null
  from _a a join _e e on a.detalle like '%«' || e.nombre || '»%', _f f where a.tipo = 'tienda.dominio_configurado' on conflict do nothing;
insert into _ts select a.id, pg_temp.tramo(f.d_precio, v.a, v.b, e.rn - 1, 2), null
  from _a a join _e e on a.detalle like '%«' || e.nombre || '»%'
  join (values ('tienda.identidad_actualizada', 0.4, 0.5), ('tienda.contenido_actualizado', 0.5, 0.6), ('tienda.catalogo_actualizado', 0.6, 0.7),
               ('consulta.avisos_actualizados', 0.75, 0.85)) v(tipo, a, b) on v.tipo = a.tipo, _f f on conflict do nothing;
insert into _ts select a.id, pg_temp.tramo(f.d_precio, 0.05, 0.3, e.rn - 1, 2), null
  from _a a join _e e on a.detalle like '%' || e.nombre || '%', _f f where a.tipo = 'empresa.regla_precio_actualizada' on conflict do nothing;
insert into _ts select x.id, pg_temp.en_jornada(f.d_org, 0.2 + 0.01 * x.rt), null
  from (select a.id, row_number() over (order by a.orig, a.id) as rt from _a a where a.tipo = 'usuario.empresas_asignadas') x, _f f on conflict do nothing;
-- Service (estados y modelos): config. repartida en 4 días hábiles, antes de la primera reparación
insert into _ts select x.id, pg_temp.reparto((x.rt - 1)::int, x.nt::int, f.d_srv0, f.d_srv1), null
  from (select a.id, row_number() over (order by a.orig, a.id) as rt, count(*) over () as nt from _a a where a.tipo like 'estado.%') x, _f f on conflict do nothing;
insert into _ts select x.id, pg_temp.reparto((x.rt - 1)::int, x.nt::int, f.d_srv0, f.d_srv1), null
  from (select a.id, row_number() over (order by a.orig, a.id) as rt, count(*) over () as nt from _a a where a.tipo like 'modelo.%') x, _f f on conflict do nothing;

-- Último recurso: lo que no se pudo enlazar con una entidad se reparte en los últimos 60 días, en su orden original
-- (se excluye `consulta.estado_cambiado`: 90-consultas.sql ya lo fechó con las fechas de sus consultas).
create temp table _sin on commit drop as
select a.id, a.tipo, a.orig from _a a where a.tipo <> 'consulta.estado_cambiado' and not exists (select 1 from _ts t where t.id = a.id);
insert into _ts select x.id, pg_temp.reparto((x.rt - 1)::int, x.nt::int, f.hoy - 60, f.hoy), null
  from (select s.id, row_number() over (order by s.orig, s.id) as rt, count(*) over () as nt from _sin s) x, _f f;
update _ts set ts = least(ts, pg_temp.tope());

-- ============================ Fase B: aplicar ============================
select 'actividad sin entidad (repartida al azar determinístico)' as dato, count(*) as filas from _sin;
select 'actividad sin entidad, por tipo: ' || coalesce(string_agg(tipo || '=' || n, ', '), 'ninguna') as dato from (select tipo, count(*) n from _sin group by tipo order by tipo) z;

-- Organización y usuarios
update public.organizaciones o set created_at = x.ts from _org x where o.id = :'org_id'::uuid;
update dominio.empresas e set created_at = pg_temp.en_jornada(f.d_org, 0.05 + 0.01 * x.rn), updated_at = pg_temp.en_jornada(f.d_org, 0.05 + 0.01 * x.rn)
  from _e x, _f f where x.id = e.id;
update public.usuarios_organizacion u set created_at = x.ts
  from (select u.user_id, pg_temp.en_jornada(f.d_org, 0.08 + 0.02 * row_number() over (order by u.created_at, u.user_id)) as ts
          from public.usuarios_organizacion u, _f f where u.organizacion_id = :'org_id'::uuid) x
 where u.user_id = x.user_id and u.organizacion_id = :'org_id'::uuid;
update public.usuarios_empresas ue set created_at = greatest(uo.created_at, e.created_at) + interval '2 minutes'
  from public.usuarios_organizacion uo, dominio.empresas e
 where ue.organizacion_id = :'org_id'::uuid and uo.user_id = ue.user_id and uo.organizacion_id = ue.organizacion_id and e.id = ue.empresa_id;
update public.usuario_empresa_activa a set updated_at = ue.created_at + interval '1 minute'
  from public.usuarios_empresas ue where ue.user_id = a.user_id and ue.empresa_id = a.empresa_id and ue.organizacion_id = :'org_id'::uuid;
update public.eventos_seguridad_usuario s
   set created_at = pg_temp.en_jornada(pg_temp.sin_domingo(f.hoy - 1 - floor(pg_temp.u(s.id::text, 'ev') * 25)::int), pg_temp.u(s.id::text, 'evh'))
  from _f f where s.user_id in (select user_id from public.usuarios_organizacion where organizacion_id = :'org_id'::uuid);
update dominio.alicuotas_iva set creado_en = (select ts from _org) + interval '5 minutes' where organizacion_id = :'org_id'::uuid;
update dominio.transiciones_estado_comprobante set creado_en = (select ts from _org) + interval '6 minutes' where organizacion_id = :'org_id'::uuid;
update dominio.motivos_movimiento set creado_en = (select ts from _org) + interval '7 minutes' where organizacion_id = :'org_id'::uuid;
update dominio.cotizacion_inicial set updated_at = pg_temp.en_jornada((select d_prov from _f), 0.02) where organizacion_id = :'org_id'::uuid;

-- Proveedores, categorías, cuentas de cobro, formas de pago/envío, transportes (y sus vínculos con las empresas)
update dominio.proveedores p set creado_en = x.ts, updated_at = x.ts from _t_prov x where x.id = p.id;
update dominio.proveedores_empresas pe set created_at = x.ts + interval '2 seconds' from _t_prov x where x.id = pe.proveedor_id;
update dominio.categorias c set creado_en = x.ts, updated_at = x.ts from _t_cat x where x.id = c.id;
update dominio.categorias_empresa ce set creado_en = x.ts + interval '2 seconds' from _t_cat x where x.id = ce.categoria_id;
update dominio.cuentas_cobro c set creado_en = x.ts, updated_at = x.ts from _t_cta x where x.id = c.id;
update dominio.cuentas_cobro_empresas ce set created_at = x.ts + interval '1 second' from _t_cta x where x.id = ce.cuenta_id;
update dominio.formas_pago c set created_at = x.ts, updated_at = x.ts from _t_fp x where x.id = c.id;
update dominio.formas_envio c set created_at = x.ts, updated_at = x.ts from _t_fe x where x.id = c.id;
update dominio.transportes c set creado_en = x.ts, updated_at = x.ts from _t_tr x where x.id = c.id;
update dominio.transportes_empresas ce set created_at = x.ts + interval '1 second' from _t_tr x where x.id = ce.transporte_id;

-- Productos y todo lo que cuelga de su alta
update dominio.productos p set creado_en = x.ts, updated_at = x.ts from _t_prod x where x.id = p.id;
update dominio.producto_empresa pe set creado_en = x.ts + interval '3 seconds' from _t_prod x where x.id = pe.producto_id;
update dominio.producto_precios_escala pe set updated_at = x.ts + interval '10 seconds' from _t_prod x where x.id = pe.producto_id;
-- Historial de costos: el primero con el alta del producto; los siguientes con la compra (línea de ingreso) k-ésima del producto
update dominio.producto_costos_historial h set vigente_desde = x.ts from _hc x where x.id = h.id;
update dominio.producto_costos c set updated_at = x.ts
  from (select producto_id, max(vigente_desde) as ts from dominio.producto_costos_historial group by producto_id) x where x.producto_id = c.producto_id;
update dominio.precios_empresa pe set updated_at = coalesce((select max(t.ts) from _ts t join _a a on a.id = t.id join _e e on e.id = pe.empresa_id
      where a.tipo = 'empresa.regla_precio_actualizada' and a.detalle like '%' || e.nombre || '%'), pe.updated_at)
 where pe.organizacion_id = :'org_id'::uuid;

-- Depósitos
update dominio.depositos d set creado_en = x.ts, updated_at = x.ts from _t_dep x where x.id = d.id;
update dominio.depositos_empresas de set created_at = x.ts + interval '1 minute' from _t_dep x where x.id = de.deposito_id;

-- Cotizaciones del dólar (orden de carga)
update dominio.cotizaciones c set cargada_en = x.ts from _t_cot x where x.id = c.id;
update dominio.cotizacion_aplicada ca set aplicada_en = c.cargada_en + interval '1 second'
  from dominio.cotizaciones c where c.id = ca.cotizacion_id and ca.organizacion_id = :'org_id'::uuid;

-- Ingresos y lotes
update dominio.ingresos_mercaderia i set creado_en = x.creado, anulado_en = x.anulado from _ing x where x.id = i.id;
update dominio.ingresos_mercaderia_lineas l set creado_en = x.ts from _ingl x where x.id = l.id;
update dominio.lotes_stock l set creado_en = x.creado from _lot x where x.id = l.id;
update dominio.cargas_iniciales_stock c set creado_en = l.ts from _mvl l where l.id = c.movimiento_id;
-- Importación histórica (planilla de ingresos anteriores): una vez, el día de importación
update public.migracion_cargas m set created_at = pg_temp.en_jornada(f.d_migra, 0.3), cerrada_en = pg_temp.en_jornada(f.d_migra, 0.3) + interval '20 minutes'
  from _f f where m.organizacion_id = :'org_id'::uuid;
update public.migracion_filas fi set created_at = m.created_at + make_interval(secs => fi.fila)
  from public.migracion_cargas m where m.id = fi.carga_id and m.organizacion_id = :'org_id'::uuid;
update dominio.archivo_ingresos_mercaderia a set creado_en = m.created_at + make_interval(secs => x.rn::int)
  from public.migracion_cargas m,
       (select id, row_number() over (order by creado_en, id) as rn from dominio.archivo_ingresos_mercaderia where organizacion_id = :'org_id'::uuid) x
 where m.id = a.carga_id and x.id = a.id;

-- Movimientos de stock (y la fecha de los que genera un documento: la RPC la fijó en el día de la siembra)
update dominio.movimientos_stock m set creado_en = l.ts, fecha = case when l.fecha_doc then pg_temp.dia_ar(l.ts) else m.fecha end from _mvl l where l.id = m.id;
update public.cola_eventos q set created_at = l.ts, updated_at = l.ts, proximo_intento_en = l.ts,
       carga = jsonb_set(q.carga::jsonb, '{ocurrido_en}', to_jsonb(to_char(l.ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00:00'))::json
  from _mvl l where q.organizacion_id = :'org_id'::uuid and q.carga->>'movimiento_id' = l.id::text;
update public.cola_eventos q set created_at = t.ts, updated_at = t.ts, proximo_intento_en = t.ts,
       carga = jsonb_set(q.carga::jsonb, '{ocurrido_en}', to_jsonb(to_char(t.ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00:00'))::json
  from (select r.id, r.creado + interval '1 second' as ts, 'reserva' as tipo from _rs r
        union all select r.id, coalesce(r.resuelto, r.creado) + interval '1 second', 'liberacion' from _rs r) t
 where q.organizacion_id = :'org_id'::uuid and q.carga->>'reserva_id' = t.id::text and q.carga->>'tipo_movimiento' = t.tipo;
update dominio.reservas_stock r set creado_en = x.creado, resuelto_en = x.resuelto, updated_at = coalesce(x.resuelto, x.creado) from _rs x where x.id = r.id;
-- Existencias: el último movimiento (o reserva) de cada producto / depósito
update dominio.existencias e set ultimo_movimiento_en = x.ts, updated_at = greatest(x.ts, coalesce(y.ts, x.ts))
  from (select m.producto_id, max(m.creado_en) as ts from dominio.movimientos_stock m group by m.producto_id) x
  left join (select producto_id, max(coalesce(resuelto, creado)) as ts from _rs group by producto_id) y on y.producto_id = x.producto_id
 where e.producto_id = x.producto_id and e.organizacion_id = :'org_id'::uuid;
update dominio.existencias e set updated_at = p.ts + interval '1 hour' from _t_prod p
 where p.id = e.producto_id and e.organizacion_id = :'org_id'::uuid and not exists (select 1 from dominio.movimientos_stock m where m.producto_id = e.producto_id);
update dominio.existencias_deposito e set updated_at = x.ts
  from (select m.producto_id, m.deposito_id, max(m.creado_en) as ts from dominio.movimientos_stock m group by 1, 2) x
 where e.producto_id = x.producto_id and e.deposito_id = x.deposito_id and e.organizacion_id = :'org_id'::uuid;
update dominio.existencias_deposito e set updated_at = p.ts + interval '1 hour' from _t_prod p
 where p.id = e.producto_id and e.organizacion_id = :'org_id'::uuid
   and not exists (select 1 from dominio.movimientos_stock m where m.producto_id = e.producto_id and m.deposito_id = e.deposito_id);
-- Depósitos: última actualización (edición / desactivación)
update dominio.depositos d set updated_at = greatest(d.creado_en, coalesce((select max(t.ts) from _ts t join _a a on a.id = t.id
      where a.tipo in ('stock.deposito_editado', 'stock.deposito_activo') and a.detalle like '%: ' || d.nombre), d.creado_en))
 where d.organizacion_id = :'org_id'::uuid;

-- Comprobantes y todo lo que cuelga de ellos
update dominio.comprobantes_venta_lineas l set creado_en = c.creado + make_interval(secs => 1 + l.orden) from _c c where c.id = l.comprobante_id;
update dominio.cobros_comprobante cb set registrado_en = b.ts, actualizado_en = b.ts from _cb b where b.id = cb.id;
update dominio.contrarreembolsos cr set creado_en = x.creado, cobrado_en = case when x.cobrado then x.cobrado_ts end, actualizado_en = coalesce(x.cobrado_ts, x.creado)
  from _cr x where x.id = cr.id;
update dominio.faltantes_venta f set creado_en = x.creado, resuelto_en = x.resuelto from _fa x where x.id = f.id;
update dominio.comprobante_documentos d set solicitado_en = x.solicitado, generado_en = x.generado, created_at = x.solicitado, updated_at = x.generado from _doc x where x.id = d.id;
update dominio.comprobante_impresiones i set impreso_en = x.ts from _imp x where x.id = i.id;
update dominio.comprobantes_venta c set creado_en = x.creado, confirmado_en = x.confirmado, entregado_en = x.entregado, anulado_en = x.anulado,
       updated_at = greatest(x.creado, x.confirmado, x.entregado, x.anulado, x.cobro_fin, x.aceptado, x.envio_ts,
                             (select max(t.ts) from _ts t where t.cid = x.id),
                             (select max(d.generado) from _doc d where d.cid = x.id),
                             (select max(i.ts) from _imp i where i.cid = x.id),
                             (select max(f.resuelto) from _fa f where f.cid = x.id))
  from _c x where x.id = c.id;

-- RMA
update dominio.rma r set creado_en = x.creado, actualizado_en = x.actualizado, stock_reingresado_en = x.reingresado from _rma x where x.id = r.id;
update dominio.rma_items i set creado_en = r.creado + interval '1 second' from _rma r where r.id = i.rma_id;

-- Service técnico
update dominio.reparaciones r set creado_en = x.creado, anulada_en = case when x.anul then x.fin end,
       updated_at = greatest(x.creado, x.fin, (select max(i.ts) from _ri i where i.rid = x.id))
  from _rep x where x.id = r.id;
update dominio.reparacion_historial h set creado_en = x.ts from _rh x where x.id = h.id;
update dominio.reparacion_items i set creado_en = x.ts from _ri x where x.id = i.id;
-- Estados y modelos de service: los creados por RPC llevan la marca de su evento; los iniciales, la de la organización
update dominio.estados_reparacion e set creado_en = (select ts from _org) + interval '8 minutes' where e.organizacion_id = :'org_id'::uuid;
update dominio.estados_reparacion e set creado_en = t.ts
  from _ts t join _a a on a.id = t.id where a.tipo = 'estado.creado' and a.detalle = 'Creó el estado de reparación ' || e.nombre and e.organizacion_id = :'org_id'::uuid;
update dominio.estados_reparacion e set updated_at = greatest(e.creado_en, coalesce((select max(t.ts) from _ts t join _a a on a.id = t.id
      where a.tipo like 'estado.%' and (a.detalle like '% ' || e.nombre || ' (lugar%' or a.detalle like '% ' || e.nombre)), e.creado_en))
 where e.organizacion_id = :'org_id'::uuid;
update dominio.modelos_equipo m set creado_en = (select ts from _org) + interval '9 minutes', updated_at = (select ts from _org) + interval '9 minutes'
 where m.organizacion_id = :'org_id'::uuid;
update dominio.modelos_equipo m set creado_en = t.ts, updated_at = t.ts
  from _ts t join _a a on a.id = t.id where a.tipo = 'modelo.creado' and a.detalle = 'Creó el modelo ' || m.equipo || ' ' || m.modelo and m.organizacion_id = :'org_id'::uuid;
update dominio.modelos_equipo m set updated_at = greatest(m.creado_en, (select max(t.ts) from _ts t join _a a on a.id = t.id
      where a.tipo in ('modelo.editado', 'modelo.reactivado') and a.detalle like '% el modelo ' || m.equipo || ' ' || m.modelo))
 where m.organizacion_id = :'org_id'::uuid
   and exists (select 1 from _a a where a.tipo in ('modelo.editado', 'modelo.reactivado') and a.detalle like '% el modelo ' || m.equipo || ' ' || m.modelo);

-- Clientes y cuentas web
update public.clientes c set created_at = x.creado, archivado_en = x.archivado, updated_at = greatest(x.creado, coalesce(x.archivado, x.creado)) from _cli x where x.id = c.id;
update public.clientes_empresas ce set created_at = x.creado + interval '1 minute' from _cli x where x.id = ce.cliente_id;
update public.clientes_identificadores_externos ie set created_at = x.creado + interval '5 minutes' from _cli x where x.id = ie.cliente_id;
update public.cuentas_cliente cc set created_at = x.creado from _cta_web x where x.id = cc.id;

-- Tienda y consultas
update dominio.tiendas t set created_at = pg_temp.tramo(f.d_tienda, 0.1, 0.3, e.rn - 1, 2), updated_at = pg_temp.tramo(f.d_tienda, 0.1, 0.3, e.rn - 1, 2)
  from _e e, _f f where e.id = t.empresa_id and t.organizacion_id = :'org_id'::uuid;
update dominio.tienda_identidad ti set created_at = t.created_at + interval '1 minute',
       updated_at = greatest(t.created_at + interval '1 minute', coalesce((select max(x.ts) from _ts x join _a a on a.id = x.id join _e e on e.id = ti.empresa_id
         where a.tipo = 'tienda.identidad_actualizada' and a.detalle like '%«' || e.nombre || '»%'), t.created_at))
  from dominio.tiendas t where t.empresa_id = ti.empresa_id and ti.organizacion_id = :'org_id'::uuid;
update dominio.tienda_contenido ti set created_at = t.created_at + interval '1 minute',
       updated_at = greatest(t.created_at + interval '1 minute', coalesce((select max(x.ts) from _ts x join _a a on a.id = x.id join _e e on e.id = ti.empresa_id
         where a.tipo = 'tienda.contenido_actualizado' and a.detalle like '%«' || e.nombre || '»%'), t.created_at))
  from dominio.tiendas t where t.empresa_id = ti.empresa_id and ti.organizacion_id = :'org_id'::uuid;
update dominio.productos_tienda pt set updated_at = coalesce((select max(x.ts) from _ts x join _a a on a.id = x.id join _e e on e.id = pt.empresa_id
         where a.tipo = 'tienda.catalogo_actualizado' and a.detalle like '%«' || e.nombre || '»%'), pt.updated_at)
 where pt.organizacion_id = :'org_id'::uuid;
update dominio.categorias_tienda pt set updated_at = coalesce((select max(x.ts) from _ts x join _a a on a.id = x.id join _e e on e.id = pt.empresa_id
         where a.tipo = 'tienda.catalogo_actualizado' and a.detalle like '%«' || e.nombre || '»%'), pt.updated_at)
 where pt.organizacion_id = :'org_id'::uuid;
update dominio.consultas_configuracion cc set created_at = pg_temp.en_jornada((select d_tienda from _f), 0.4),
       updated_at = greatest(pg_temp.en_jornada((select d_tienda from _f), 0.4), coalesce((select max(x.ts) from _ts x join _a a on a.id = x.id join _e e on e.id = cc.empresa_id
         where a.tipo = 'consulta.avisos_actualizados' and a.detalle like '%«' || e.nombre || '»%'), pg_temp.en_jornada((select d_tienda from _f), 0.4)))
 where cc.organizacion_id = :'org_id'::uuid;
update dominio.estados_consulta set creado_en = pg_temp.en_jornada((select d_tienda from _f), 0.45) where organizacion_id = :'org_id'::uuid;
update dominio.consultas c set created_at = x.ts, updated_at = x.ts from _con x where x.id = c.id;
update dominio.tienda_envios te set creado_en = c.ts - interval '1 second'
  from (select id, row_number() over (partition by (origen = 'whatsapp') order by creado_en, id) as rt, (origen = 'whatsapp') as wa
          from dominio.tienda_envios where organizacion_id = :'org_id'::uuid) y
  join (select id, ts, row_number() over (partition by (origen = 'whatsapp') order by ts, id) as rt, (origen = 'whatsapp') as wa from _con) c
    on c.wa = y.wa and c.rt = y.rt
 where te.id = y.id;
update public.avisos_pendientes ap set creado_en = c.ts + interval '1 second'
  from _con c where ap.organizacion_id = :'org_id'::uuid and ap.datos->>'Nombre' = c.nombre and ap.datos->>'Contacto' = c.contacto;
update dominio.intereses_whatsapp i
   set created_at = pg_temp.en_jornada(pg_temp.sin_domingo(f.hoy - 2 - floor(pg_temp.u(i.id::text, 'iw') * 28)::int), pg_temp.u(i.id::text, 'iwh'))
  from _f f where i.organizacion_id = :'org_id'::uuid and i.created_at >= now() - interval '1 day';

-- Actividad
update public.registro_actividad a set creado_en = t.ts from _ts t where t.id = a.id;

-- ============================ Fase C: restaurar triggers y verificar ============================
do $$
declare g record;
begin
  for g in select tabla, nombre, modo from _trg where modo in ('A', 'R') loop
    execute format('alter table %s enable %s trigger %I', g.tabla, case g.modo when 'A' then 'always' else 'replica' end, g.nombre);
  end loop;
end $$;

do $$
declare
  v_org uuid := current_setting('demo.org')::uuid;
  v_n bigint; v_tot bigint := 0; v_msg text := ''; r record; q text;
  v_ahora timestamptz := now();
begin
  -- 0) triggers: idéntico estado que antes (tabla, nombre y modo)
  select count(*) into v_n from (
    (select tabla, nombre, modo from _trg except select c.oid::regclass::text, tg.tgname, tg.tgenabled::text from pg_trigger tg join pg_class c on c.oid = tg.tgrelid where not tg.tgisinternal)
    union all
    (select c.oid::regclass::text, tg.tgname, tg.tgenabled::text from pg_trigger tg join pg_class c on c.oid = tg.tgrelid where not tg.tgisinternal except select tabla, nombre, modo from _trg)) d;
  if v_n > 0 then v_msg := v_msg || format(E'\n  triggers con otro modo: %s', v_n); v_tot := v_tot + v_n; end if;
  raise notice 'triggers (A|R|O) = %|%|%', (select count(*) from pg_trigger where not tgisinternal and tgenabled = 'A'),
    (select count(*) from pg_trigger where not tgisinternal and tgenabled = 'R'), (select count(*) from pg_trigger where not tgisinternal and tgenabled = 'O');

  -- 1) nada en el futuro (todas las columnas de marca de tiempo de las tablas con organizacion_id, salvo las de planificación de colas)
  for r in
    select c.table_schema as s, c.table_name as t, c.column_name as col
      from information_schema.columns c join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
     where c.table_schema in ('public', 'dominio') and c.data_type like 'timestamp%'
       and c.column_name not in ('ventana_vence_en', 'proximo_intento', 'reclamado_hasta', 'vence_en', 'retencion_verifica_hasta')
       and exists (select 1 from information_schema.columns k where k.table_schema = c.table_schema and k.table_name = c.table_name and k.column_name = 'organizacion_id')
  loop
    execute format('select count(*) from %I.%I where organizacion_id = $1 and %I > $2', r.s, r.t, r.col) into v_n using v_org, v_ahora;
    if v_n > 0 then v_msg := v_msg || format(E'\n  futuro: %s.%s.%s = %s', r.s, r.t, r.col, v_n); v_tot := v_tot + v_n; end if;
  end loop;

  -- 2) actualizado >= creado
  for r in
    select * from (values
      ('dominio','categorias','updated_at','creado_en'), ('dominio','comprobante_documentos','updated_at','created_at'), ('dominio','comprobantes_venta','updated_at','creado_en'),
      ('dominio','consultas','updated_at','created_at'), ('dominio','contrarreembolsos','actualizado_en','creado_en'), ('dominio','cuentas_cobro','updated_at','creado_en'),
      ('dominio','depositos','updated_at','creado_en'), ('dominio','empresas','updated_at','created_at'), ('dominio','estados_reparacion','updated_at','creado_en'),
      ('dominio','formas_envio','updated_at','created_at'), ('dominio','formas_pago','updated_at','created_at'), ('dominio','modelos_equipo','updated_at','creado_en'),
      ('dominio','productos','updated_at','creado_en'), ('dominio','proveedores','updated_at','creado_en'), ('dominio','reparaciones','updated_at','creado_en'),
      ('dominio','reservas_stock','updated_at','creado_en'), ('dominio','rma','actualizado_en','creado_en'), ('dominio','tiendas','updated_at','created_at'),
      ('dominio','transportes','updated_at','creado_en'), ('dominio','cobros_comprobante','actualizado_en','registrado_en'), ('public','clientes','updated_at','created_at'),
      ('dominio','tienda_identidad','updated_at','created_at'), ('dominio','tienda_contenido','updated_at','created_at'), ('dominio','consultas_configuracion','updated_at','created_at'),
      ('dominio','consultas_avisos','updated_at','created_at')) as v(s, t, act, cre)
  loop
    execute format('select count(*) from %I.%I where organizacion_id = $1 and %I < %I', r.s, r.t, r.act, r.cre) into v_n using v_org;
    if v_n > 0 then v_msg := v_msg || format(E'\n  actualizado < creado: %s.%s = %s', r.s, r.t, v_n); v_tot := v_tot + v_n; end if;
  end loop;

  -- 3) un hijo nunca es anterior a su padre, y reglas propias de cada flujo
  for r in
    select * from (values
      ('cobro < comprobante', $q$select count(*) from dominio.cobros_comprobante cb join dominio.comprobantes_venta c on c.id = cb.comprobante_id where cb.organizacion_id = $1 and (cb.registrado_en < c.creado_en or cb.registrado_en < c.confirmado_en)$q$),
      ('cobro manual a más de 12 días de la fecha del comprobante', $q$select count(*) from dominio.cobros_comprobante cb join dominio.comprobantes_venta c on c.id = cb.comprobante_id where cb.organizacion_id = $1 and cb.origen <> 'contrarreembolso' and (cb.registrado_en at time zone 'America/Argentina/Buenos_Aires')::date > c.fecha + 12$q$),
      ('línea < comprobante', $q$select count(*) from dominio.comprobantes_venta_lineas l join dominio.comprobantes_venta c on c.id = l.comprobante_id where l.organizacion_id = $1 and l.creado_en < c.creado_en$q$),
      ('confirmado/entregado/anulado fuera de orden', $q$select count(*) from dominio.comprobantes_venta c where c.organizacion_id = $1 and (c.confirmado_en < c.creado_en or c.entregado_en < c.confirmado_en or c.anulado_en < c.confirmado_en)$q$),
      ('comprobante < cliente', $q$select count(*) from dominio.comprobantes_venta c join public.clientes cl on cl.id = c.cliente_id where c.organizacion_id = $1 and c.creado_en < cl.created_at$q$),
      ('NC < factura de origen', $q$select count(*) from dominio.comprobantes_venta n join dominio.comprobantes_venta o on o.id = n.comprobante_origen_id where n.organizacion_id = $1 and n.creado_en < o.creado_en$q$),
      ('documento < comprobante', $q$select count(*) from dominio.comprobante_documentos d join dominio.comprobantes_venta c on c.id = d.comprobante_id where d.organizacion_id = $1 and (d.solicitado_en < c.creado_en or d.generado_en < d.solicitado_en)$q$),
      ('impresión < documento', $q$select count(*) from dominio.comprobante_impresiones i join dominio.comprobante_documentos d on d.id = i.documento_id where i.organizacion_id = $1 and i.impreso_en < d.generado_en$q$),
      ('contrarreembolso < comprobante o cobrado antes de abrirse', $q$select count(*) from dominio.contrarreembolsos cr join dominio.comprobantes_venta c on c.id = cr.comprobante_id where cr.organizacion_id = $1 and (cr.creado_en < c.confirmado_en or cr.cobrado_en < cr.creado_en)$q$),
      ('contrarreembolso cobrado distinto del cobro', $q$select count(*) from dominio.contrarreembolsos cr join dominio.cobros_comprobante cb on cb.id = cr.cobro_id where cr.organizacion_id = $1 and cr.cobrado_en <> cb.registrado_en$q$),
      ('faltante < comprobante', $q$select count(*) from dominio.faltantes_venta f join dominio.comprobantes_venta c on c.id = f.comprobante_id where f.organizacion_id = $1 and (f.creado_en < c.confirmado_en or f.resuelto_en < f.creado_en)$q$),
      ('línea de ingreso < ingreso', $q$select count(*) from dominio.ingresos_mercaderia_lineas l join dominio.ingresos_mercaderia i on i.id = l.ingreso_id where l.organizacion_id = $1 and l.creado_en < i.creado_en$q$),
      ('ingreso anulado antes de crearse', $q$select count(*) from dominio.ingresos_mercaderia i where i.organizacion_id = $1 and i.anulado_en < i.creado_en$q$),
      ('movimiento < producto', $q$select count(*) from dominio.movimientos_stock m join dominio.productos p on p.id = m.producto_id where m.organizacion_id = $1 and m.creado_en < p.creado_en$q$),
      ('movimiento < depósito', $q$select count(*) from dominio.movimientos_stock m join dominio.depositos d on d.id = m.deposito_id where m.organizacion_id = $1 and m.creado_en < d.creado_en$q$),
      ('movimiento de ingreso < ingreso', $q$select count(*) from dominio.ingresos_mercaderia_lineas l join dominio.ingresos_mercaderia i on i.id = l.ingreso_id join dominio.movimientos_stock m on m.id = l.movimiento_id where l.organizacion_id = $1 and m.creado_en < i.creado_en$q$),
      ('movimiento de anulación de ingreso < anulación', $q$select count(*) from dominio.ingresos_mercaderia_lineas l join dominio.ingresos_mercaderia i on i.id = l.ingreso_id join dominio.movimientos_stock m on m.id = l.movimiento_anulacion_id where l.organizacion_id = $1 and m.creado_en < i.anulado_en$q$),
      ('fecha de movimiento posterior al día de su marca', $q$select count(*) from dominio.movimientos_stock m where m.organizacion_id = $1 and m.fecha > (m.creado_en at time zone 'America/Argentina/Buenos_Aires')::date$q$),
      ('reserva < producto o resuelta antes de crearse', $q$select count(*) from dominio.reservas_stock r join dominio.productos p on p.id = r.producto_id where r.organizacion_id = $1 and (r.creado_en < p.creado_en or r.resuelto_en < r.creado_en)$q$),
      ('existencia < producto', $q$select count(*) from dominio.existencias e join dominio.productos p on p.id = e.producto_id where e.organizacion_id = $1 and (e.updated_at < p.creado_en or e.ultimo_movimiento_en < p.creado_en)$q$),
      ('existencia por depósito < depósito/producto', $q$select count(*) from dominio.existencias_deposito e join dominio.productos p on p.id = e.producto_id join dominio.depositos d on d.id = e.deposito_id where e.organizacion_id = $1 and (e.updated_at < p.creado_en or e.updated_at < d.creado_en)$q$),
      ('producto < proveedor/categoría', $q$select count(*) from dominio.productos p left join dominio.proveedores v on v.id = p.proveedor_id left join dominio.categorias c on c.id = p.categoria_id where p.organizacion_id = $1 and (p.creado_en < v.creado_en or p.creado_en < c.creado_en)$q$),
      ('producto_empresa/precios/costos < producto', $q$select (select count(*) from dominio.producto_empresa x join dominio.productos p on p.id = x.producto_id where x.organizacion_id = $1 and x.creado_en < p.creado_en) + (select count(*) from dominio.producto_precios_escala x join dominio.productos p on p.id = x.producto_id where x.organizacion_id = $1 and x.updated_at < p.creado_en) + (select count(*) from dominio.producto_costos_historial x join dominio.productos p on p.id = x.producto_id where x.organizacion_id = $1 and x.vigente_desde < p.creado_en) + (select count(*) from dominio.producto_costos x join dominio.productos p on p.id = x.producto_id where x.organizacion_id = $1 and x.updated_at < p.creado_en)$q$),
      ('hijos de reparación < reparación', $q$select (select count(*) from dominio.reparacion_historial h join dominio.reparaciones r on r.id = h.reparacion_id where h.organizacion_id = $1 and h.creado_en < r.creado_en) + (select count(*) from dominio.reparacion_items h join dominio.reparaciones r on r.id = h.reparacion_id where h.organizacion_id = $1 and h.creado_en < r.creado_en)$q$),
      ('entrega/anulación de reparación antes de un cambio de estado', $q$select count(*) from dominio.reparacion_historial e join dominio.reparacion_historial s on s.reparacion_id = e.reparacion_id and s.tipo = 'estado' where e.organizacion_id = $1 and e.tipo in ('entrega', 'anulacion') and e.creado_en < s.creado_en$q$),
      ('reparación < cliente', $q$select count(*) from dominio.reparaciones r join public.clientes c on c.id = r.cliente_id where r.organizacion_id = $1 and r.creado_en < c.created_at$q$),
      ('RMA < entrega de su factura / ítem < RMA / reingreso < RMA', $q$select (select count(*) from dominio.rma r join dominio.comprobantes_venta c on c.id = r.comprobante_id where r.organizacion_id = $1 and r.creado_en < coalesce(c.entregado_en, c.confirmado_en)) + (select count(*) from dominio.rma_items i join dominio.rma r on r.id = i.rma_id where i.organizacion_id = $1 and i.creado_en < r.creado_en) + (select count(*) from dominio.rma r where r.organizacion_id = $1 and r.stock_reingresado_en < r.creado_en)$q$),
      ('cuenta web < cliente', $q$select count(*) from public.cuentas_cliente cc join public.clientes c on c.id = cc.cliente_id where cc.organizacion_id = $1 and cc.created_at < c.created_at$q$),
      ('cliente / usuario < organización', $q$select (select count(*) from public.clientes c join public.organizaciones o on o.id = c.organizacion_id where c.organizacion_id = $1 and c.created_at < o.created_at) + (select count(*) from public.usuarios_organizacion u join public.organizaciones o on o.id = u.organizacion_id where u.organizacion_id = $1 and u.created_at < o.created_at)$q$),
      ('cotizaciones: la cadena valor_anterior no sigue el orden de carga', $q$select count(*) from (select valor_anterior, lag(valor) over (order by cargada_en, id) as prev from dominio.cotizaciones where organizacion_id = $1) x where x.prev is not null and x.valor_anterior is distinct from x.prev$q$),
      ('la última cotización no es de hoy', $q$select case when (select max(cargada_en at time zone 'America/Argentina/Buenos_Aires')::date from dominio.cotizaciones where organizacion_id = $1) = (now() at time zone 'America/Argentina/Buenos_Aires')::date then 0 else 1 end$q$),
      ('cola de eventos: ocurrido_en distinto de created_at', $q$select count(*) from public.cola_eventos where organizacion_id = $1 and (carga->>'ocurrido_en')::timestamptz <> created_at$q$)
    ) as v(nombre, consulta)
  loop
    execute r.consulta into v_n using v_org;
    if v_n > 0 then v_msg := v_msg || format(E'\n  %s = %s', r.nombre, v_n); v_tot := v_tot + v_n; end if;
  end loop;

  -- 4) actividad: ningún evento antes de la entidad a la que pertenece (misma resolución que `historial_comprobante`) ni de su organización
  select count(*) into v_n from public.registro_actividad a
    join dominio.comprobantes_venta c on c.organizacion_id = a.organizacion_id and c.empresa_id = a.empresa_id
     and a.tipo like 'comprobante.%' and a.detalle ~ (c.tipo || ' ' || c.numero || '([^A-Za-z0-9]|$)')
   where a.organizacion_id = v_org and a.creado_en < c.creado_en;
  if v_n > 0 then v_msg := v_msg || format(E'\n  evento de comprobante anterior a su comprobante = %s', v_n); v_tot := v_tot + v_n; end if;
  select count(*) into v_n from public.registro_actividad a join public.organizaciones o on o.id = a.organizacion_id where a.organizacion_id = v_org and a.creado_en < o.created_at;
  if v_n > 0 then v_msg := v_msg || format(E'\n  actividad anterior a la organización = %s', v_n); v_tot := v_tot + v_n; end if;
  select count(*) into v_n from public.registro_actividad a where a.organizacion_id = v_org
     and a.tipo in ('producto.creado', 'producto.categoria_asignada', 'producto.empresas_actualizadas', 'producto.precio_actualizado')
     and exists (select 1 from dominio.productos p where p.organizacion_id = v_org and a.detalle like '%' || p.nombre || '%' and a.creado_en < p.creado_en);
  if v_n > 0 then v_msg := v_msg || format(E'\n  evento de producto anterior al producto = %s', v_n); v_tot := v_tot + v_n; end if;

  raise notice 'verificación: % violaciones%', v_tot, v_msg;
  if v_tot > 0 then raise exception 'Fechas incoherentes tras el reparto (% violaciones):%', v_tot, v_msg; end if;
end $$;

select 'actividad con marca de la última hora (esperado: solo lo de HOY)' as dato, count(*) as filas
  from public.registro_actividad where organizacion_id = :'org_id'::uuid and creado_en > now() - interval '1 hour';
select 'cotización más reciente' as dato, max(cargada_en)::text as valor from dominio.cotizaciones where organizacion_id = :'org_id'::uuid;
commit;
select 'fechas repartidas: ' || :'org' as resultado;
\else
\echo 'No existe la organización: nada que hacer'
\endif
