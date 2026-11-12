-- Privilegios de `service_role` sobre `dominio` y los helpers de `private` (migración 20270302105000).
-- Una base creada solo con migraciones debe dejar operar a la API admin (E2E, siembra, workers) sin grants
-- manuales, SIN reabrir las tablas de solo-agregar/inalterables y sin abrir nada nuevo a `anon` ni `authenticated`.
-- Si este test falla porque una tabla NUEVA de `dominio` no tiene grant para service_role, la migración
-- que la crea debe decidir: `grant select, insert, update, delete ... to service_role` (tabla operativa) o dejarla
-- sin grant y agregarla a `inalterables` de este test y de la migración (historial de solo agregar).
begin;

select no_plan();

create temp table inalterables(nombre text primary key) on commit drop;
insert into inalterables values
  ('cotizaciones'), ('historial_comprobantes'), ('historial_cobros'), ('historial_cotizaciones_dolar'),
  ('movimientos_stock'), ('cargas_iniciales_stock'), ('comprobante_impresiones'), ('lotes_stock'),
  ('producto_costos_historial'), ('reparacion_historial'), ('precios_propios_historial'),
  ('consultas');
grant select on inalterables to public;

-- Esquemas.
select ok(has_schema_privilege('service_role', 'dominio', 'usage'), 'service_role tiene USAGE sobre dominio');
select ok(has_schema_privilege('service_role', 'private', 'usage'), 'service_role tiene USAGE sobre private');
select ok(not has_schema_privilege('anon', 'dominio', 'usage'), 'anon sigue sin USAGE sobre dominio');

-- Tablas operativas: lectura y escritura completas.
select is(
  (select coalesce(string_agg(c.relname, ', '), '') from pg_class c
    where c.relnamespace = 'dominio'::regnamespace and c.relkind in ('r', 'p')
      and c.relname not in (select nombre from inalterables)
      and not (has_table_privilege('service_role', c.oid, 'select') and has_table_privilege('service_role', c.oid, 'insert')
               and has_table_privilege('service_role', c.oid, 'update') and has_table_privilege('service_role', c.oid, 'delete'))),
  '', 'service_role escribe y lee todas las tablas operativas de dominio (si falla: falta el grant en la migración de la tabla nueva)'
);

-- Inalterables: nunca escritura (primera barrera, antes del trigger); lectura solo si ya la tenía.
select is(
  (select coalesce(string_agg(c.relname, ', '), '') from pg_class c
    where c.relnamespace = 'dominio'::regnamespace and c.relkind in ('r', 'p') and c.relname in (select nombre from inalterables)
      and (has_table_privilege('service_role', c.oid, 'insert') or has_table_privilege('service_role', c.oid, 'update')
           or has_table_privilege('service_role', c.oid, 'delete') or has_table_privilege('service_role', c.oid, 'truncate'))),
  '', 'service_role no escribe ninguna tabla inalterable'
);
select ok(not has_table_privilege('service_role', 'dominio.precios_propios_historial', p), 'service_role no tiene ' || p || ' sobre precios_propios_historial (MSF-352)')
from unnest(array['select', 'insert', 'update', 'delete', 'truncate']) p;
select ok(has_table_privilege('service_role', 'dominio.' || nombre, 'select'), 'service_role lee ' || nombre)
from inalterables where nombre <> 'precios_propios_historial' order by nombre;
-- Tablas operativas: ni TRUNCATE, ni REFERENCES, ni TRIGGER.
select is(
  (select coalesce(string_agg(c.relname, ', '), '') from pg_class c
    where c.relnamespace = 'dominio'::regnamespace and c.relkind in ('r', 'p')
      and c.relname not in (select nombre from inalterables)
      and (has_table_privilege('service_role', c.oid, 'truncate') or has_table_privilege('service_role', c.oid, 'references')
           or has_table_privilege('service_role', c.oid, 'trigger'))),
  '', 'service_role no tiene TRUNCATE, REFERENCES ni TRIGGER en las tablas operativas'
);
select ok(not has_table_privilege('service_role', 'dominio.cotizaciones', 'insert'), 'service_role no inserta en cotizaciones');

-- Sin privilegios por defecto: una tabla nueva nace sin grant para service_role (hay que darlo en su migración).
create table dominio.zz_tabla_de_prueba(id bigserial primary key);
create view dominio.zz_vista_de_prueba as select id from dominio.zz_tabla_de_prueba;
select ok(not has_table_privilege('service_role', 'dominio.zz_tabla_de_prueba', 'insert'), 'una tabla nueva de dominio nace sin INSERT para service_role');
select ok(not has_sequence_privilege('service_role', 'dominio.zz_tabla_de_prueba_id_seq', 'usage'), 'una secuencia nueva de dominio nace sin USAGE para service_role');

select ok(not has_table_privilege('service_role', 'dominio.zz_vista_de_prueba', p), 'una vista nueva de dominio nace sin ' || p || ' para service_role')
from unnest(array['select', 'insert', 'update', 'delete']) p;

-- Ningún privilegio por defecto en dominio (para ningún rol): una tabla futura no nace abierta a nadie.
select is(
  (select coalesce(string_agg(d.defaclrole::regrole::text || ':' || d.defaclobjtype::text || ':' || d.defaclacl::text, '; '), '')
     from pg_default_acl d where d.defaclnamespace = 'dominio'::regnamespace),
  '', 'dominio no tiene privilegios por defecto (anon, authenticated ni service_role)'
);

-- Helpers.
select ok(has_function_privilege('service_role', f, 'execute'), 'service_role ejecuta ' || f)
from unnest(array[
  'dominio.nombre_norm(dominio.productos)', 'private.quitar_prefijo_importacion(text)', 'private.normalizar_host(text)',
  'private.documento_normalizado(text)', 'private.nivel_seccion(text)', 'private.normalizar_busqueda(text)', 'private.clave_texto(text)'
]) f;

-- Guard por catálogo: ninguna función que se evalúe con el rol que escribe puede quedar sin EXECUTE para service_role.
-- Entran (a) las funciones de defaults, columnas generadas, CHECK e índices por expresión y (b) las que llaman por
-- nombre (prosrc), de forma transitiva, los disparadores de dominio que no son security definer. Los disparadores
-- security definer cortan la cadena (sus llamadas corren con el dueño). Si falla: dar EXECUTE en la migración de la
-- función (o de la tabla/índice que la usa) a service_role. LIMITACIÓN: solo detecta nombres literales en prosrc; no
-- ve funciones llamadas por SQL dinámico con el nombre armado en ejecución (p. ej. format('select public.%I(1)', ...)).
-- Regla complementaria: ningún E2E escribe directo en las tablas inalterables ni en dominio.consultas (se siembra por RPC).
select is(
  (with recursive
    fn as (
      select p.oid, p.proname, p.prosecdef, p.prosrc, p.prorettype = 'trigger'::regtype as es_trigger
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('private', 'dominio', 'publico', 'public')
         and not exists (select 1 from pg_depend e where e.objid = p.oid and e.deptype = 'e')
    ),
    trig as (
      select distinct t.tgfoid as oid from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where c.relnamespace = 'dominio'::regnamespace and not t.tgisinternal
    ),
    directas as (
      select distinct d.refobjid as oid from pg_depend d
       where d.refclassid = 'pg_proc'::regclass
         and (d.classid in ('pg_attrdef'::regclass, 'pg_constraint'::regclass)
              or (d.classid = 'pg_class'::regclass and (select x.relkind from pg_class x where x.oid = d.objid) = 'i'))
    ),
    cl(oid) as (
      select oid from directas
      union
      select f.oid from trig t join fn r on r.oid = t.oid and not r.prosecdef
        join fn f on f.oid <> r.oid and r.prosrc ~ ('\m' || f.proname || '\M') and not f.es_trigger
      union
      select f.oid from cl join fn r on r.oid = cl.oid and not r.prosecdef
        join fn f on f.oid <> r.oid and r.prosrc ~ ('\m' || f.proname || '\M') and not f.es_trigger
    )
   select coalesce(string_agg(distinct f.oid::regprocedure::text, ', '), '')
     from cl join fn f on f.oid = cl.oid
    where not has_function_privilege('service_role', f.oid, 'execute')),
  '', 'service_role ejecuta toda función evaluada por defaults, CHECK, índices o disparadores de dominio'
);

-- Nada nuevo para anon ni authenticated.
select ok(not has_function_privilege('anon', f, 'execute'), 'anon no ejecuta ' || f)
from unnest(array[
  'dominio.nombre_norm(dominio.productos)', 'private.quitar_prefijo_importacion(text)', 'private.normalizar_host(text)',
  'private.documento_normalizado(text)', 'private.nivel_seccion(text)', 'private.normalizar_busqueda(text)', 'private.clave_texto(text)'
]) f;
select ok(not has_function_privilege('authenticated', 'private.normalizar_host(text)', 'execute'), 'authenticated sigue sin ejecutar private.normalizar_host');
select is(
  (select coalesce(string_agg(c.relname, ', '), '') from pg_class c
    where c.relnamespace = 'dominio'::regnamespace and c.relkind in ('r', 'p')
      and (c.relname in (select nombre from inalterables) or c.relname = 'zz_tabla_de_prueba')
      and (has_table_privilege('authenticated', c.oid, 'insert') or has_table_privilege('authenticated', c.oid, 'update')
           or has_table_privilege('authenticated', c.oid, 'delete') or has_table_privilege('authenticated', c.oid, 'truncate'))),
  '', 'authenticated no escribe las tablas inalterables ni ganó acceso a una tabla nueva'
);
select is(
  (select count(*)::int from pg_class c where c.relnamespace = 'dominio'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
     and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert'))),
  0, 'anon no tiene privilegios sobre tablas de dominio'
);

select * from finish();
rollback;
