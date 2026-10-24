-- MSF-562 · [Deuda MSF-189] T017 · FR-012: el aviso de consulta nueva pasa por private.emitir_aviso.
--
-- Esquema (Principio VII): no crea ni altera tablas. Solo reemplaza la función del disparador
-- `consultas_encolar_aviso` (dominio.consultas, existente) y no toca RLS ni privilegios.
--
-- Antes: el disparador encolaba una fila en dominio.consultas_avisos y la Edge Function
-- `enviar-aviso-consulta` (barrida por el flow `avisos-consultas`) mandaba el correo directo, sin
-- preferencias ni agrupación. Ahora: el disparador llama a
-- private.emitir_aviso('consulta_nueva', organizacion, datos); el flow `enviar-avisos` envía el
-- correo respetando preferencia y agrupación (15 min).
--
-- * Un fallo al emitir NO frena el alta de la consulta (como antes: un fallo de aviso nunca toca la
--   consulta): se registra con RAISE WARNING y la consulta queda guardada.
-- * dominio.consultas_avisos y la función quedan (aditivo): los avisos ya encolados se terminan de
--   enviar por el camino anterior; no se encolan nuevos.
--
-- Reversión (migración posterior): volver a crear private.encolar_aviso_consulta() con el cuerpo de
-- 20261205200100_consultas_avisos.sql (insert en dominio.consultas_avisos ... on conflict do nothing).

create or replace function private.encolar_aviso_consulta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa text;
  v_producto text;
begin
  select e.nombre into v_empresa
  from dominio.empresas e
  where e.id = new.empresa_id and e.organizacion_id = new.organizacion_id;

  if new.producto_id is not null then
    select p.nombre into v_producto
    from dominio.productos p
    where p.id = new.producto_id and p.organizacion_id = new.organizacion_id;
  end if;

  begin
    perform private.emitir_aviso(
      'consulta_nueva',
      new.organizacion_id,
      jsonb_strip_nulls(jsonb_build_object(
        'Empresa', v_empresa,
        'Origen', case new.origen when 'whatsapp' then 'WhatsApp' else 'Formulario de contacto' end,
        'Nombre', new.nombre,
        'Contacto', new.contacto,
        'Producto', v_producto,
        'Mensaje', left(nullif(btrim(coalesce(new.mensaje, '')), ''), 300)
      ))
    );
  exception when others then
    raise warning 'No se pudo emitir el aviso de la consulta %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

comment on function private.encolar_aviso_consulta() is
  'MSF-562 (FR-012): al crearse una consulta emite el aviso consulta_nueva con private.emitir_aviso (respeta preferencias y agrupación). Un fallo se registra y no frena el alta.';

revoke execute on function private.encolar_aviso_consulta() from public, anon, authenticated;
