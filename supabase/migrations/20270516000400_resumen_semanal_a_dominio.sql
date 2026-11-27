-- MSF-921 (lote 101): `public.resumen_semanal_config` y `public.resumen_semanal_envios` pasan al esquema `dominio` (Principio VII).
--
-- Son datos del negocio de cada organización (si recibe el resumen semanal y la bitácora de lo generado/enviado), no de la
-- plataforma. Solo las leen y escriben funciones `security definer` (anon y authenticated no tienen grants y las políticas deniegan
-- todo), así que el traslado no cambia ningún contrato público: ninguna RPC cambia de nombre, firma ni resultado y ningún cliente
-- las pide por PostgREST (se verificó: el panel no las nombra y el flow de Kestra llama a `/rest/v1/rpc/...`, no a las tablas).
-- Por eso NO hace falta una vista de compatibilidad en `public`. Las demás tablas del inventario de MSF-921 sí la exigirían o
-- son de plataforma: ver docs/higiene-base-datos.md, «MSF-921: inventario».
--
-- Qué hace (mismo método que 20270418000401_clientes_a_dominio.sql):
--   1. `alter table ... set schema dominio` (con la tabla viajan sus políticas, constraints, índices y privilegios).
--   2. Recrea las funciones vivas que nombraban las tablas en `public` (el cuerpo de una función es texto; el barrido usa el
--      catálogo y se autocomprueba: si queda alguna, la migración falla).
--   3. `private.exclusiones_exportacion_total()` lista las dos tablas con el esquema nuevo: se redefine a partir de la definición
--      vigente en la base (cambia solo esas dos filas), así no pisa exclusiones que haya agregado otra migración.
--
-- Lock: `alter table ... set schema` toma ACCESS EXCLUSIVE sobre cada tabla mientras dura la migración (no reescribe datos).
-- Aplicar con el cron y los workers quietos (las funciones se recrean en la misma transacción: sale todo o no sale nada).
--
-- Reversión (migración posterior): alter table dominio.resumen_semanal_config set schema public;
--   alter table dominio.resumen_semanal_envios set schema public; el barrido inverso (el mismo DO con los nombres invertidos) y
--   volver a listar ('public', ...) en private.exclusiones_exportacion_total() y quitar los grants a service_role de arriba.

-- Idempotente: si una tabla ya está en dominio (reaplicación) no hay nada que mover.
do $$
begin
  if to_regclass('public.resumen_semanal_config') is not null then
    alter table public.resumen_semanal_config set schema dominio;
  end if;
  if to_regclass('public.resumen_semanal_envios') is not null then
    alter table public.resumen_semanal_envios set schema dominio;
  end if;
end;
$$;

-- Convención de `dominio` (pgTAP service_role_privilegios): una tabla operativa le da a service_role lectura/escritura completa
-- y NADA más. anon y authenticated siguen sin ningún privilegio (solo las funciones definer llegan a las filas).
revoke all on table dominio.resumen_semanal_config from service_role;
revoke all on table dominio.resumen_semanal_envios from service_role;
grant select, insert, update, delete on table dominio.resumen_semanal_config to service_role;
grant select, insert, update, delete on table dominio.resumen_semanal_envios to service_role;

do $$
declare
  r record;
  v_nueva text;
  v_total integer := 0;
  v_habia_pendientes boolean := exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname not in ('pg_catalog', 'information_schema') and p.prosrc ~ 'public\.resumen_semanal_(config|envios)\M');
begin
  for r in
    select p.oid::regprocedure::text as firma, pg_get_functiondef(p.oid) as definicion
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname not in ('pg_catalog', 'information_schema')
       and p.prokind in ('f', 'p')
       and p.prosrc ~ 'public\.resumen_semanal_(config|envios)\M'
     order by 1
  loop
    v_nueva := regexp_replace(r.definicion, 'public\.resumen_semanal_(config|envios)\M', 'dominio.resumen_semanal_\1', 'g');
    begin
      execute v_nueva;
      v_total := v_total + 1;
    exception when others then
      raise exception 'No se pudo recrear % con el esquema nuevo: %', r.firma, sqlerrm;
    end;
  end loop;

  if v_total = 0 and v_habia_pendientes then
    raise exception 'El barrido no recreó ninguna función: revisar el criterio del traslado';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname not in ('pg_catalog', 'information_schema') and p.prosrc ~ 'public\.resumen_semanal_(config|envios)\M'
  ) then
    raise exception 'Quedaron funciones nombrando las tablas en public: el traslado las dejaría rotas';
  end if;
  if to_regclass('dominio.resumen_semanal_config') is null or to_regclass('dominio.resumen_semanal_envios') is null
     or to_regclass('public.resumen_semanal_config') is not null or to_regclass('public.resumen_semanal_envios') is not null then
    raise exception 'El traslado no dejó las tablas en dominio';
  end if;

  -- Exclusiones de la exportación total: solo cambia el esquema de estas dos filas.
  select pg_get_functiondef('private.exclusiones_exportacion_total()'::regprocedure) into v_nueva;
  v_nueva := replace(v_nueva, '(''public'', ''resumen_semanal_config''', '(''dominio'', ''resumen_semanal_config''');
  v_nueva := replace(v_nueva, '(''public'', ''resumen_semanal_envios''', '(''dominio'', ''resumen_semanal_envios''');
  if v_nueva not like '%(''dominio'', ''resumen_semanal_config''%' or v_nueva not like '%(''dominio'', ''resumen_semanal_envios''%' then
    raise exception 'private.exclusiones_exportacion_total() no listaba las dos tablas del resumen semanal';
  end if;
  execute v_nueva;
end;
$$;
