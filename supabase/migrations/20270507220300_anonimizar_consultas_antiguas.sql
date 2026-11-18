-- Lote 39 (decisión de producto de MSF-668, retención de consultas; seguimiento de MSF-944): anonimización de consultas antiguas.
--
-- Plazo: 24 MESES desde la última actividad de la consulta (`updated_at`: cada cambio de estado, responsable o nota la mueve).
-- Pasado el plazo se ANONIMIZAN los datos personales de `dominio.consultas`:
--   · `nombre` y `contacto` pasan a «[anonimizado]»; `mensaje` pasa a «[anonimizado]» si la consulta es de formulario (la base
--     exige un mensaje en ese origen) y a nulo en las de WhatsApp y de pedido;
--   · `nota_interna` se borra (puede traer datos de la persona) y se cortan los vínculos `cliente_id` y `contacto_id` (con ellos la
--     persona seguiría identificable).
--   Se CONSERVAN: id, organización, tienda, origen, producto, estado, responsable (personal del equipo), fechas y los ítems del
--   pedido (`dominio.consulta_items`: producto y cantidad, sin datos de la persona), así los reportes y los agregados no cambian.
--
-- `private.anonimizar_consultas_antiguas(p_meses int default 24)`:
--   · `security definer`, `search_path = ''`; sin privilegios para public, anon ni authenticated; `execute` solo para los roles de
--     servicio (`service_role` y `kestra_orquestacion`, el rol del flow mensual `anonimizar-consultas`).
--   · `p_meses` debe ser un entero >= 12 (22023): un valor mal puesto (0, 1, negativo o nulo) no puede anonimizar de más.
--   · Anonimiza las consultas con `updated_at` ESTRICTAMENTE anterior a `now() - p_meses meses` que todavía no están anonimizadas.
--   · Idempotente: una segunda corrida no toca nada (ya anonimizadas) y devuelve 0.
--   · Devuelve la cantidad de filas anonimizadas y deja, por organización, un evento de Actividad `sistema.consultas_anonimizadas`
--     («Anonimizó N consultas sin actividad en los últimos 24 meses») sin ningún dato personal: ese es el log de la ejecución.
--
-- Efecto lateral conocido: el trigger de normalización mueve `updated_at` de la fila al anonimizarla; no cambia `created_at`, que es
-- la fecha que usan los reportes.
--
-- Esquema (Principio VII): sin tablas nuevas; función en `private`; una fila de catálogo en `public.tipos_evento_actividad`.
-- Migración aditiva. Reversión (migración posterior; lo ya anonimizado no se recupera):
--   drop function private.anonimizar_consultas_antiguas(integer);
--   delete from public.tipos_evento_actividad where tipo = 'sistema.consultas_anonimizadas';
-- y borrar el flow `anonimizar-consultas` (infra/kestra/flows-retirados.txt).

insert into public.tipos_evento_actividad (tipo, sensible, descripcion) values
  ('sistema.consultas_anonimizadas', false, 'Anonimización de consultas por retención')
on conflict (tipo) do nothing;

create or replace function private.anonimizar_consultas_antiguas(p_meses integer default 24)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_corte timestamptz;
  v_total integer := 0;
  r record;
begin
  if p_meses is null or p_meses < 12 then
    raise exception 'El plazo de retención de consultas no puede ser menor a 12 meses' using errcode = '22023', hint = 'p_meses';
  end if;
  v_corte := pg_catalog.now() - pg_catalog.make_interval(months => p_meses);

  for r in
    with anonimizadas as (
      update dominio.consultas c
         set nombre = '[anonimizado]',
             contacto = '[anonimizado]',
             mensaje = case when c.origen = 'formulario' then '[anonimizado]' else null end,
             nota_interna = null,
             cliente_id = null,
             contacto_id = null
       where c.updated_at < v_corte
         and not (c.nombre = '[anonimizado]' and c.contacto = '[anonimizado]'
                  and c.mensaje is not distinct from case when c.origen = 'formulario' then '[anonimizado]' else null end
                  and c.nota_interna is null and c.cliente_id is null and c.contacto_id is null)
      returning c.organizacion_id
    )
    select a.organizacion_id, count(*)::integer as cantidad
      from anonimizadas a
     group by a.organizacion_id
  loop
    v_total := v_total + r.cantidad;
    perform private.insertar_actividad(
      r.organizacion_id,
      null,
      'sistema.consultas_anonimizadas',
      format('Anonimizó %s %s sin actividad en los últimos %s meses', r.cantidad,
             case when r.cantidad = 1 then 'consulta' else 'consultas' end, p_meses)
    );
  end loop;
  return v_total;
end;
$$;

revoke all on function private.anonimizar_consultas_antiguas(integer) from public, anon, authenticated;
grant execute on function private.anonimizar_consultas_antiguas(integer) to service_role;

do $$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'kestra_orquestacion') then
    grant usage on schema private to kestra_orquestacion;
    grant execute on function private.anonimizar_consultas_antiguas(integer) to kestra_orquestacion;
  end if;
end;
$$;

comment on function private.anonimizar_consultas_antiguas(integer) is
  'Retención de consultas: anonimiza nombre, contacto y mensaje (y corta vínculos y nota interna) de las consultas sin actividad hace más de p_meses (>= 12, por defecto 24). Idempotente; devuelve la cantidad y deja un evento sistema.consultas_anonimizadas por organización. Solo roles de servicio.';
