-- F-SVC-01 (MSF-254, épica MSF-182): datos iniciales de Service técnico por organización.
-- Esquema: sin tablas nuevas (siembra `dominio.modelos_equipo` y `dominio.estados_reparacion`).
--
-- Los siete modelos y los siete estados son los del prototipo (ServicioModelos / ServicioEstados).
-- «Entregado» y «Sin reparación» cierran la reparación; «Recibido», «Esperando repuesto»,
-- «Listo para entregar» y «Sin reparación» avisan al cliente (el aviso real NO se envía en esta
-- épica: solo se guarda el indicador). El octavo estado que menciona la épica se agrega desde la
-- pantalla, sin migración. El sembrado es idempotente: no duplica ni pisa lo que la organización
-- ya editó (conflicto sobre la clave única de modelos; `not exists` por nombre en estados).
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los datos):
--   drop trigger organizaciones_sembrar_service on public.organizaciones;
--   drop function private.sembrar_service_trigger();
--   drop function private.sembrar_service(uuid);
--   y quitar las filas sembradas de dominio.modelos_equipo / dominio.estados_reparacion
--   (solo si ninguna reparación las referencia).

create or replace function private.sembrar_service(p_organizacion_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base integer;
begin
  insert into dominio.modelos_equipo (organizacion_id, equipo, modelo, mano_obra_base, activo)
  values
    (p_organizacion_id, 'Nintendo Switch', 'Estándar', 22000, true),
    (p_organizacion_id, 'Nintendo Switch', 'Lite', 20000, true),
    (p_organizacion_id, 'Nintendo Switch', 'OLED', 24000, true),
    (p_organizacion_id, 'Joystick', 'Pro Controller', 12000, true),
    (p_organizacion_id, 'Joystick', 'Joy-Con (par)', 10000, true),
    (p_organizacion_id, 'PlayStation 4', 'Slim', 26000, false),
    (p_organizacion_id, 'PlayStation 5', 'Estándar', 32000, true)
  on conflict (organizacion_id, private.clave_texto(equipo), private.clave_texto(modelo)) do nothing;

  -- `orden` parte de lo que ya exista, así un estado propio creado antes del sembrado no choca.
  select coalesce(max(x.orden), 0) into v_base
    from dominio.estados_reparacion x where x.organizacion_id = p_organizacion_id;

  insert into dominio.estados_reparacion (organizacion_id, nombre, descripcion, orden, avisa_cliente, cierra, tono)
  select p_organizacion_id, e.nombre, e.descripcion, v_base + e.orden, e.avisa_cliente, e.cierra, e.tono
    from (values
      (1, 'Recibido', 'El equipo ingresó y se entregó el comprobante de recepción.', true, false, 'neutral'),
      (2, 'En diagnóstico', 'El técnico revisa la falla y arma el presupuesto.', false, false, 'info'),
      (3, 'Esperando repuesto', 'Se pidió el repuesto al proveedor.', true, false, 'aviso'),
      (4, 'En reparación', 'El técnico está trabajando en el equipo.', false, false, 'primario'),
      (5, 'Listo para entregar', 'Se avisa al cliente para que retire.', true, false, 'exito'),
      (6, 'Entregado', 'Se registra la fecha de entrega.', false, true, 'exito'),
      (7, 'Sin reparación', 'No se pudo reparar o el cliente no aceptó el presupuesto.', true, true, 'error')
    ) as e (orden, nombre, descripcion, avisa_cliente, cierra, tono)
   where not exists (
     select 1 from dominio.estados_reparacion y
      where y.organizacion_id = p_organizacion_id
        and private.clave_texto(y.nombre) = private.clave_texto(e.nombre)
   );
end;
$$;

revoke execute on function private.sembrar_service(uuid) from public, anon, authenticated;

create or replace function private.sembrar_service_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sembrar_service(new.id);
  return new;
end;
$$;

revoke execute on function private.sembrar_service_trigger() from public, anon, authenticated;

create trigger organizaciones_sembrar_service
  after insert on public.organizaciones
  for each row execute function private.sembrar_service_trigger();

-- Relleno de las organizaciones existentes.
select private.sembrar_service(o.id) from public.organizaciones o;
