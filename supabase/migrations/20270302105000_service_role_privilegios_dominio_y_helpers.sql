-- Privilegios de `service_role` en una base creada solo con migraciones (suite E2E, scripts de siembra,
-- Edge Functions y workers que usan la service-role key).
--
-- Síntoma: contra un Supabase local limpio (migraciones + seed) la API admin fallaba con
-- «permission denied for schema dominio», «permission denied for table empresas» y «permission denied for
-- function quitar_prefijo_importacion / normalizar_host / documento_normalizado / nivel_seccion».
-- `service_role` ya omite RLS (`bypassrls`), pero RLS no reemplaza a los GRANT: sin USAGE sobre el esquema
-- ni privilegio sobre la tabla, Postgres rechaza la consulta antes de mirar las políticas. En dev/stg/prd los
-- grants existían porque alguien los dio a mano; la base reproducible no los tenía.
--
-- Qué se da, y solo a `service_role` (nada nuevo para `anon` ni `authenticated`):
--   1. USAGE sobre el esquema `dominio`.
--   2. Sobre las tablas de `dominio`: SELECT/INSERT/UPDATE/DELETE, SALVO las tablas de solo-agregar o
--      inalterables (lista `inalterables` más abajo). Esas conservan la decisión de mínimo privilegio con la
--      que se crearon (p. ej. MSF-352: `precios_propios_historial` solo lo escriben `fijar_precio_propio` y
--      `quitar_precio_propio`, y el pgTAP `cotizacion_historial` fija que `service_role` no puede tocar
--      `cotizaciones` «primero por falta de grants, después por el trigger»): `precios_propios_historial` no
--      recibe nada (ya se le había revocado todo a propósito) y el resto recibe solo SELECT. También queda sin
--      escritura `consultas`: las consultas públicas entran solo por la RPC `publico.crear_consulta_publica` y
--      el pgTAP `consultas` exige que un INSERT directo con `service_role` falle con 42501. La lista se obtuvo
--      comparando la suite pgTAP completa con y sin esta migración (la única diferencia fue `consultas`) y
--      con los `revoke ... from service_role` previos (solo `precios_propios_historial` sobre `dominio`).
--      Por eso NO se usa `grant ... on all tables`: habría revertido esos `revoke`. Las vistas (si las
--      hubiera) reciben solo SELECT, nunca DML.
--   3. EXECUTE sobre los helpers que se llaman en nombre de quien escribe o lee (no son `security definer`, así
--      que el permiso se evalúa con el rol que opera): `dominio.nombre_norm(dominio.productos)`,
--      `private.quitar_prefijo_importacion`, `private.normalizar_host`, `private.documento_normalizado`,
--      `private.nivel_seccion`, `private.normalizar_busqueda` (índice trigram `productos_nombre_busqueda_trgm`; el grant ya lo daba
--      `20261203110000_tienda_busqueda_base`: se repite a propósito, es idempotente y protege ante una re-creación de la
--      función que pierda su ACL) y
--      `private.clave_texto` (índices únicos `modelos_equipo_org_equipo_modelo_key` y
--      `estados_reparacion_org_nombre_key`). Son helpers puros (texto o lectura de la matriz de permisos).
--      La lista no es a ojo: se derivó por catálogo en una base limpia, tomando (a) las funciones referidas por
--      defaults, columnas generadas, CHECK e índices por expresión (`pg_depend`: `pg_attrdef`, `pg_constraint` e
--      índices) y (b) las que llaman por nombre (`prosrc`) los disparadores de `dominio` que NO son
--      `security definer` (corren con el rol que escribe), de forma transitiva. Las vistas y las políticas RLS no
--      cuentan: las funciones de una vista se evalúan con el dueño y `service_role` omite RLS. El pgTAP repite esa
--      consulta y falla si aparece una función sin EXECUTE para `service_role`. Limitación: solo ve nombres que
--      figuran literales en `prosrc`; no detecta funciones llamadas por SQL dinámico con el nombre armado en tiempo
--      de ejecución (p. ej. `format('select public.%I(1)', ...)`).
--
-- `dominio` no tiene secuencias hoy (claves uuid): no se da nada sobre secuencias; si una tabla futura las usa, su
-- migración da el grant. NO se usa `alter default privileges`: daría escritura a toda tabla futura y obligaría a acordarse de revocar
-- a mano en cada tabla sensible (invierte la convención del repo). En su lugar el pgTAP
-- `service_role_privilegios` falla si una tabla operativa de `dominio` queda sin grant para `service_role`
-- (y no está en la lista de inalterables): quien cree una tabla nueva decide explícitamente, en su migración,
-- si `service_role` la escribe. Regla para helpers: todo helper puro que use un trigger, una columna generada o
-- una vista lleva EXECUTE para `service_role` (y `authenticated` si lo usa la app); el pgTAP lo exige para los
-- que se pueden detectar por dependencias del catálogo.
--
-- Idempotente: se puede repetir sin efecto. No crea ni altera tablas (Principio VII). Si el rol no existe
-- (Postgres sin Supabase) no hace nada.
--
-- Reversión (solo para bases reproducibles: en dev/stg/prd estos grants ya existían a mano y revocarlos los
-- quitaría también): revoke execute on function dominio.nombre_norm(dominio.productos),
-- private.quitar_prefijo_importacion(text), private.normalizar_host(text), private.documento_normalizado(text),
-- private.nivel_seccion(text), private.normalizar_busqueda(text), private.clave_texto(text) from service_role; revoke all on all tables in schema dominio from service_role;
-- revoke usage on schema dominio from service_role.
-- (`private` ya tenía USAGE para `service_role`; no se toca.)

do $$
declare
  inalterables constant text[] := array[
    'cotizaciones', 'historial_comprobantes', 'historial_cobros', 'historial_cotizaciones_dolar',
    'movimientos_stock', 'cargas_iniciales_stock', 'comprobante_impresiones', 'lotes_stock',
    'producto_costos_historial', 'reparacion_historial', 'precios_propios_historial',
    'consultas'
  ];
  sin_ningun_privilegio constant text[] := array['precios_propios_historial'];
  t record;
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    return;
  end if;

  grant usage on schema dominio to service_role;

  for t in
    select c.oid::regclass as rel, c.relname, c.relkind
      from pg_catalog.pg_class c
     where c.relnamespace = 'dominio'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
  loop
    if t.relname = any (sin_ningun_privilegio) then
      execute format('revoke all on %s from service_role', t.rel);
    elsif t.relkind in ('v', 'm') or t.relname = any (inalterables) then
      execute format('grant select on %s to service_role', t.rel);
    else
      execute format('grant select, insert, update, delete on %s to service_role', t.rel);
    end if;
  end loop;

  grant execute on function dominio.nombre_norm(dominio.productos) to service_role;
  grant execute on function private.quitar_prefijo_importacion(text) to service_role;
  grant execute on function private.normalizar_host(text) to service_role;
  grant execute on function private.documento_normalizado(text) to service_role;
  grant execute on function private.nivel_seccion(text) to service_role;
  grant execute on function private.normalizar_busqueda(text) to service_role;
  grant execute on function private.clave_texto(text) to service_role;
end
$$;
