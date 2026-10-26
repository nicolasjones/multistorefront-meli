-- F-TDA-14 (MSF-433, épica MSF-212, spec 20261202-100000-tienda-whatsapp-y-contacto): registro de la
-- consulta por WhatsApp desde la ficha del producto. FR-025; SC-006 lo cubre el pgTAP
-- supabase/tests/database/tienda_whatsapp.test.sql.
--
-- Esquemas (Principio VII, re-verificado tabla por tabla):
--   * No se crea ni se altera ninguna tabla en este PR: `dominio.tienda_envios` (F-TDA-16) y
--     `dominio.consultas` (MSF-122, F-CON-01) ya existen. Esta migración solo agrega una función.
--   * publico.registrar_consulta_whatsapp -> `publico` (superficie para `anon`; `publico` sigue sin tablas).
--   * Reutiliza, sin modificarlas: `private.catalogo_tienda_efectivo` (visibilidad efectiva, MSF-147),
--     `private.registrar_envio_tienda` (límite e idempotencia, F-TDA-16) y `private.entregar_a_bandeja`
--     (único adaptador hacia MSF-122, F-TDA-16).
--
-- Contrato (contracts/tienda-contacto.md): publico.registrar_consulta_whatsapp(host, producto, clave_envio)
-- -> { estado: 'ok' | 'limite' | 'error' }. El límite y la idempotencia son los mismos del formulario
-- (misma tabla, mismo visitante, misma constante de 5 por hora): D3.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function publico.registrar_consulta_whatsapp(text, uuid, uuid);

create or replace function publico.registrar_consulta_whatsapp(
  host text,
  producto uuid,
  clave_envio uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
  v_registro jsonb;
  -- El visitante abre WhatsApp desde la ficha y no deja sus datos en la plataforma: la conversación
  -- ocurre en WhatsApp, no acá. La interfaz de entrada de MSF-122 (F-CON-01) exige nombre y contacto
  -- no vacíos, así que se registran marcas explícitas de que no hay datos: la bandeja muestra
  -- «visitante@sin-datos.invalid» (TLD reservado por RFC 2606: nunca resuelve a una casilla real) y
  -- que el visitante no dejó mensaje. No se inventa un nombre ni un teléfono.
  v_nombre constant text := 'Visitante de WhatsApp';
  v_contacto constant text := 'visitante@sin-datos.invalid';
begin
  -- La empresa sale SOLO del host; host desconocido y empresa desactivada dan la misma respuesta.
  select e.id into v_empresa
    from dominio.tiendas t
    join dominio.empresas e on e.id = t.empresa_id and e.organizacion_id = t.organizacion_id
   where t.dominio = private.normalizar_host(host) and e.activa;
  if v_empresa is null or producto is null or clave_envio is null then
    return jsonb_build_object('estado', 'error');
  end if;

  -- El producto tiene que ser efectivamente visible en la tienda del host (misma visibilidad que la
  -- ficha: producto activo, no oculto y con la categoría visible). Un producto de otra empresa,
  -- inactivo u oculto no se registra y responde igual que un host desconocido.
  if not exists (
    select 1
      from private.catalogo_tienda_efectivo(v_empresa) x
     where x.producto_id = producto and x.efectivo
  ) then
    return jsonb_build_object('estado', 'error');
  end if;

  -- Sub-transacción: si la entrega falla se revierte también el registro del envío (no se gasta cupo).
  begin
    v_registro := private.registrar_envio_tienda(v_empresa, 'whatsapp', clave_envio);
    if v_registro ->> 'estado' = 'limite' then
      -- Sin `espera_segundos`: el límite no se le muestra al visitante (FR-024) y el contrato público
      -- de esta función es `ok | limite | error`.
      return jsonb_build_object('estado', 'limite');
    end if;
    if v_registro ->> 'estado' = 'nuevo' then
      perform private.entregar_a_bandeja(v_empresa, 'whatsapp', v_nombre, v_contacto, null, producto);
    end if;
  exception when others then
    -- Rastro en el servidor (log de Postgres) solo con sqlstate: sqlerrm puede traer datos del visitante.
    raise warning 'registrar_consulta_whatsapp falló: %', sqlstate;
    return jsonb_build_object('estado', 'error');
  end;
  return jsonb_build_object('estado', 'ok');
end;
$$;

comment on function publico.registrar_consulta_whatsapp(text, uuid, uuid) is
  'F-TDA-14: registro público del interés por WhatsApp desde la ficha. Exige producto efectivamente visible en la tienda del host, comparte límite e idempotencia con el formulario y entrega a la bandeja con origen whatsapp y el producto. Responde ok|limite|error sin datos internos.';

revoke execute on function publico.registrar_consulta_whatsapp(text, uuid, uuid) from public, anon;
grant execute on function publico.registrar_consulta_whatsapp(text, uuid, uuid) to anon, authenticated;
