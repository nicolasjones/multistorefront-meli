-- MSF-161 · F-VTA-27 (MSF-270, spec 20261110-100000-ventas-avisos-de-faltantes, FR-101, FR-102, FR-105):
-- al registrarse una línea de ingreso de mercadería, los faltantes abiertos de ese producto quedan «Para avisar».
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   dominio.ingresos_mercaderia_lineas  dominio (existente)  se le agrega un disparador `AFTER INSERT`.
--   dominio.faltantes_venta             dominio (existente)  se marcan sus filas (`para_avisar_*`, 20270226110100).
--   dominio.faltantes_avisos            dominio (existente)  solo se lee (no se escribe: no se envía nada).
--   dominio.comprobantes_venta_lineas   dominio (existente)  solo se lee (enlace de la línea del faltante).
--   dominio.productos                   dominio (existente)  solo se lee el nombre para la actividad.
--   private.marcar_faltantes_para_avisar  private (NUEVA función de disparador).
-- Ninguna tabla se crea. `public.registrar_ingreso_mercaderia` NO se modifica.
--
-- Regla de cobertura (spec, decisión 5): saldo = cantidad de la línea del ingreso; se recorren los faltantes
-- abiertos del producto en la organización, sin marca ni aviso en curso (`pendiente`/`enviado`), por
-- antigüedad (`creado_en`, `id`), bloqueados con `for update`; se marca cada faltante COMPLETO mientras entre
-- en el saldo y el que no entra se salta (se sigue con el siguiente más antiguo).
--
-- Seguridad: `security definer` con `search_path = ''` (marca faltantes de tiendas que quien registra el
-- ingreso quizá no ve; no expone datos: solo escribe la marca). Sin ejecución para `authenticated`/`anon`.
-- La organización sale de la línea del ingreso, nunca de un argumento.
--
-- FR-105 · no romper el ingreso: todo el cuerpo va en un bloque con `exception when others` que deja un
-- WARNING del servidor (sin datos personales) y continúa; las marcas parciales se deshacen con el bloque. La
-- actividad `ventas.faltantes_para_avisar` va en su propio bloque: si falla (p. ej. ingreso sin sesión) las
-- marcas se conservan. Se registra solo si se marcó algo.
--
-- Migración idempotente (`create or replace`, `drop trigger if exists`). Reversión (migración posterior):
--   drop trigger if exists ingresos_mercaderia_lineas_marcar_faltantes on dominio.ingresos_mercaderia_lineas;
--   drop function if exists private.marcar_faltantes_para_avisar();

create or replace function private.marcar_faltantes_para_avisar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_saldo integer := new.cantidad;
  v_marcados integer := 0;
  v_producto text;
  f record;
begin
  begin
    for f in
      select fv.id, fv.cantidad_faltante
        from dominio.faltantes_venta fv
       where fv.organizacion_id = new.organizacion_id
         and fv.producto_id = new.producto_id
         and fv.estado = 'abierto'
         and fv.para_avisar_en is null
         and not exists (
           select 1
             from dominio.comprobantes_venta_lineas l
             join dominio.faltantes_avisos a on a.linea_id = l.id
            where l.comprobante_id = fv.comprobante_id
              and l.orden = fv.linea_orden
              and l.organizacion_id = fv.organizacion_id
              and a.estado in ('pendiente', 'enviado')
         )
       order by fv.creado_en, fv.id
         for update of fv
    loop
      -- Un faltante cuenta completo o no cuenta: el que no entra en el saldo se salta y se sigue con el siguiente más
      -- antiguo (así un faltante grande no bloquea a los demás del producto).
      exit when v_saldo <= 0;
      continue when f.cantidad_faltante > v_saldo;
      update dominio.faltantes_venta
         set para_avisar_en = now(), para_avisar_ingreso_id = new.ingreso_id
       where id = f.id;
      v_saldo := v_saldo - f.cantidad_faltante;
      v_marcados := v_marcados + 1;
    end loop;
  exception when others then
    -- El ingreso de mercadería nunca se rompe por esto (FR-105); el detalle queda en el log del servidor.
    raise warning 'marcar_faltantes_para_avisar: no se pudo marcar (%): %', sqlstate, left(sqlerrm, 200);
    return new;
  end;

  if v_marcados > 0 then
    begin
      select p.nombre into v_producto
        from dominio.productos p
       where p.id = new.producto_id and p.organizacion_id = new.organizacion_id;
      perform private.registrar_actividad(
        'ventas.faltantes_para_avisar',
        left(format('Ingreso de mercadería: %s faltantes de %s quedaron Para avisar',
                    v_marcados, coalesce(v_producto, 'un producto')), 500)
      );
    exception when others then
      raise warning 'marcar_faltantes_para_avisar: no se registró la actividad (%): %', sqlstate, left(sqlerrm, 200);
    end;
  end if;

  return new;
end;
$$;

revoke execute on function private.marcar_faltantes_para_avisar() from public, anon, authenticated;

comment on function private.marcar_faltantes_para_avisar() is
  'F-VTA-27: disparador AFTER INSERT de dominio.ingresos_mercaderia_lineas. Marca «Para avisar» los faltantes abiertos del producto, por antigüedad, hasta agotar la cantidad ingresada. No envía nada y no rompe el ingreso si falla.';

drop trigger if exists ingresos_mercaderia_lineas_marcar_faltantes on dominio.ingresos_mercaderia_lineas;
create trigger ingresos_mercaderia_lineas_marcar_faltantes
  after insert on dominio.ingresos_mercaderia_lineas
  for each row execute function private.marcar_faltantes_para_avisar();
