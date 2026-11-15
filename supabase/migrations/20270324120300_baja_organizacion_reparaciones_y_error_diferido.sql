-- Baja de organización: amplía el alcance a reparaciones (MSF-847) y traduce el 23503 diferido (MSF-848).
--
-- MSF-847: `dominio.reparaciones.empresa_id → dominio.empresas` es `no action` inmediata; al borrar una organización
-- con reparaciones la cascada puede borrar empresas antes que reparaciones y falla con 23503. Se pasa a
-- `deferrable initially deferred` (la comprobación ocurre al COMMIT, cuando la cascada ya terminó). Se aplica el mismo
-- criterio acotado de MSF-844: solo claves cuyo ORIGEN está en el alcance declarado y cuyo DESTINO también se borra en la
-- cascada de `public.organizaciones`. El alcance es el de MSF-844 más `dominio.reparaciones`. Idempotente, y no
-- depende de que la migración de MSF-844 esté aplicada (si lo está, no encuentra nada que cambiar de sus tablas).
-- Sigue fuera del alcance: ventas, motos, cotizaciones y stock (ver docs/empresas.md, Límites conocidos).
--
-- MSF-848: una clave diferida lanza el 23503 en el COMMIT, fuera de cualquier `exception when` de una RPC.
-- `private.confirmar_claves_diferidas()` fuerza la comprobación en ese punto (`set constraints all immediate`) y
-- traduce `foreign_key_violation` a un error de negocio explícito (P0001, con la restricción y la tabla en `detail`).
-- Una RPC que borre estas tablas la llama al final de su cuerpo. Hoy ninguna RPC las borra.
--
-- REVERSIÓN: `drop function private.confirmar_claves_diferidas();` y
-- `alter table dominio.reparaciones alter constraint reparaciones_empresa_id_fkey not deferrable;`

do $$
declare
  v record;
  v_definicion text;
begin
  for v in
    with recursive cierre(rel) as (
      select 'public.organizaciones'::regclass
      union
      select k.conrelid
        from pg_constraint k
        join cierre c on k.confrelid = c.rel
       where k.contype = 'f' and k.confdeltype = 'c'
    ),
    alcance(rel) as (
      select 'dominio.empresas'::regclass
      union select 'dominio.proveedores'::regclass
      union select 'dominio.proveedores_contactos'::regclass
      union select 'dominio.productos'::regclass
      union select 'dominio.ingresos_mercaderia'::regclass
      union select 'dominio.ingresos_mercaderia_lineas'::regclass
      union select 'dominio.reparaciones'::regclass
    )
    select k.oid, k.conrelid::regclass as tabla, k.conname, k.confdeltype
      from pg_constraint k
     where k.contype = 'f'
       and k.confdeltype in ('r', 'a')
       and not k.condeferrable
       and k.conrelid in (select rel from alcance)
       and k.confrelid in (select rel from cierre)
     order by k.conrelid::regclass::text, k.conname
  loop
    if v.confdeltype = 'a' then
      execute format('alter table %s alter constraint %I deferrable initially deferred', v.tabla, v.conname);
    else
      v_definicion := regexp_replace(pg_get_constraintdef(v.oid), ' ON DELETE RESTRICT', '');
      execute format('alter table %s drop constraint %I', v.tabla, v.conname);
      execute format('alter table %s add constraint %I %s deferrable initially deferred not valid', v.tabla, v.conname, v_definicion);
      execute format('alter table %s validate constraint %I', v.tabla, v.conname);
    end if;
  end loop;
end
$$;

create or replace function private.confirmar_claves_diferidas()
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_restriccion text;
  v_tabla text;
begin
  begin
    set constraints all immediate;
  exception when foreign_key_violation then
    get stacked diagnostics v_restriccion = constraint_name, v_tabla = table_name;
    raise exception 'No se puede borrar: el registro está en uso por otros datos.'
      using errcode = 'P0001',
            detail = format('restricción %s, tabla %s', coalesce(v_restriccion, '?'), coalesce(v_tabla, '?')),
            hint = 'Eliminá o reasigná primero los datos que lo usan.';
  end;
  set constraints all deferred;
end
$$;

comment on function private.confirmar_claves_diferidas() is
  'MSF-848: fuerza la comprobación de las claves foráneas diferidas y traduce el 23503 a un error de negocio (P0001). Llamarla al final de una RPC que borre tablas con claves diferidas.';

revoke execute on function private.confirmar_claves_diferidas() from public, anon, authenticated;
