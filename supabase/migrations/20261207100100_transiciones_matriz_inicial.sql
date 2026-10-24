-- F-VTA-10 (MSF-365, FR-021): siembra de la matriz inicial de transiciones (Flujo 1 de la spec) por organización.
--
-- Esquema (Principio VII): escribe `dominio.transiciones_estado_comprobante` (T001, `dominio`); sin tablas nuevas.
-- La función es la ÚNICA vía de escritura; no es ejecutable por `authenticated` ni `anon`.
--
-- Matriz (propuesta a confirmar con el cliente, spec Decisiones abiertas 2; corregirla es una migración de datos):
--   · Mostrador: confirmada («Pendiente») → aceptado / en_proceso; aceptado → en_proceso.
--   · Depósito: aceptado → armando; en_proceso → armando; armando → incompleto; incompleto → armando.
--   · Administrador y Administración: todas las manuales anteriores.
--   · Cobrado/Deuda: solo el actor `sistema` (cobros, MSF-195), nunca una persona.
-- Se siembra para las organizaciones existentes y, por trigger, para cada organización nueva (mismo punto de
-- siembra que usan el depósito principal y los roles). Idempotente (`on conflict do nothing`).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop trigger organizaciones_sembrar_transiciones_comprobante on public.organizaciones;
--   drop function private.sembrar_transiciones_comprobante_trigger();
--   drop function private.sembrar_transiciones_comprobante(uuid);

create or replace function private.sembrar_transiciones_comprobante(p_organizacion_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  with manual (desde, hasta, roles) as (
    values
      ('confirmada', 'aceptado',   array['mostrador', 'administracion', 'administrador']),
      ('confirmada', 'en_proceso', array['mostrador', 'administracion', 'administrador']),
      ('aceptado',   'en_proceso', array['mostrador', 'administracion', 'administrador']),
      ('aceptado',   'armando',    array['deposito', 'administracion', 'administrador']),
      ('en_proceso', 'armando',    array['deposito', 'administracion', 'administrador']),
      ('armando',    'incompleto', array['deposito', 'administracion', 'administrador']),
      ('incompleto', 'armando',    array['deposito', 'administracion', 'administrador'])
  ),
  sistema (desde, hasta) as (
    values
      ('confirmada', 'cobrado'), ('aceptado', 'cobrado'), ('en_proceso', 'cobrado'), ('armando', 'cobrado'),
      ('cobrado', 'deuda'), ('deuda', 'cobrado')
  )
  insert into dominio.transiciones_estado_comprobante (organizacion_id, tipo, estado_desde, estado_hasta, rol_id)
  select p_organizacion_id, 'factura', m.desde, m.hasta, r
    from manual m, unnest(m.roles) as r
  union all
  select p_organizacion_id, 'factura', s.desde, s.hasta, 'sistema'
    from sistema s
  on conflict do nothing;
$$;

revoke execute on function private.sembrar_transiciones_comprobante(uuid) from public, anon, authenticated;

create or replace function private.sembrar_transiciones_comprobante_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sembrar_transiciones_comprobante(new.id);
  return new;
end;
$$;

revoke execute on function private.sembrar_transiciones_comprobante_trigger() from public, anon, authenticated;

create trigger organizaciones_sembrar_transiciones_comprobante
  after insert on public.organizaciones
  for each row execute function private.sembrar_transiciones_comprobante_trigger();

select private.sembrar_transiciones_comprobante(o.id) from public.organizaciones o;
