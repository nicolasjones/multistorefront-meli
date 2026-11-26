-- Lote 91 (MSF-731): registro mínimo y persistente de cada correo que `enviar-correo-proveedor` manda a un proveedor.
--
-- La función Edge es un relay autenticado hacia el SMTP de la empresa: el asunto y el mensaje son libres y cualquier usuario con
-- `edicion` en Proveedores puede editar el correo del proveedor. Hasta ahora el único rastro era una línea de log del isolate (se pierde)
-- y el tope era un contador en memoria. Esta migración agrega SOLO el registro; el tope por usuario y hora reutiliza
-- `public.consumir_cupo_ia` (lote 90, migración 20270507900000) con la funcionalidad `correo-proveedor`, sin tabla ni función nuevas.
--
--   1. `private.correo_proveedor_envios (id, usuario_id, proveedor_id, resultado, creado_en)`: una fila por intento de envío. Guarda
--      quién (usuario), a qué proveedor, cuándo y el resultado (`enviado` o `fallido`). NO guarda asunto, cuerpo ni dirección. Sin claves
--      foráneas a propósito: el rastro debe sobrevivir al borrado del usuario o del proveedor (es evidencia). Vive en `private` (PostgREST
--      no la expone), con RLS activado y UNA política que deniega todo a `anon` y `authenticated`; `select` solo para `service_role`.
--   2. `public.registrar_envio_correo_proveedor(p_usuario, p_proveedor, p_resultado)`: inserta la fila (`security definer`,
--      `search_path = ''`, solo `service_role`). Usuario o proveedor nulos y un resultado distinto de `enviado`/`fallido` se rechazan con `22023`.
--
-- Sin purga ni retención automática: la fila es chica y el uso está acotado por el cupo (20 por hora y usuario). Definir la retención queda
-- como seguimiento (docs/funciones-edge-endurecimiento.md).
--
-- Orden de despliegue: esta migración ANTES que la Edge Function `enviar-correo-proveedor` de este lote. La función nueva llama a
-- `public.consumir_cupo_ia` (ya desplegada desde el lote 90) y, si falla, responde 503 sin enviar (falla cerrado); el registro del envío
-- es de mejor esfuerzo: si la RPC falta o falla, el correo igual sale y el fallo queda en el log.
--
-- Reaplicable: `create ... if not exists`, `create or replace`, `drop policy if exists` antes de crear la política.
--
-- Reversión (migración posterior; los pasos son reales y ordenados). Antes de borrar nada, volver a desplegar la versión ANTERIOR de
-- `enviar-correo-proveedor` (la de este lote llama a `registrar_envio_correo_proveedor`; sin ella solo registra el fallo en el log, pero
-- el rastro se pierde). Se pierde el historial acumulado:
--   drop function if exists public.registrar_envio_correo_proveedor(uuid, uuid, text);
--   drop table if exists private.correo_proveedor_envios;
--   Los usos del cupo `correo-proveedor` en `private.ia_cupo_uso` son de la hora en curso y los purga `private.purgar_cupo_ia`.

create table if not exists private.correo_proveedor_envios (
  id bigint generated always as identity primary key,
  usuario_id uuid not null,
  proveedor_id uuid not null,
  resultado text not null,
  creado_en timestamptz not null default now(),
  constraint correo_proveedor_envios_resultado_valido check (resultado in ('enviado', 'fallido'))
);

comment on table private.correo_proveedor_envios is
  'Rastro de cada correo enviado a un proveedor por enviar-correo-proveedor (lote 91, MSF-731): usuario, proveedor, fecha y resultado. Sin asunto, cuerpo ni dirección. Sin claves foráneas: sobrevive al borrado.';

-- Consultas de soporte: quién envió o a quién, ordenado por fecha.
create index if not exists correo_proveedor_envios_usuario_idx on private.correo_proveedor_envios (usuario_id, creado_en desc);
create index if not exists correo_proveedor_envios_proveedor_idx on private.correo_proveedor_envios (proveedor_id, creado_en desc);

alter table private.correo_proveedor_envios enable row level security;
revoke all on table private.correo_proveedor_envios from public, anon, authenticated;
grant select on table private.correo_proveedor_envios to service_role;

drop policy if exists correo_proveedor_envios_denegar_todo on private.correo_proveedor_envios;
create policy correo_proveedor_envios_denegar_todo on private.correo_proveedor_envios
  as permissive for all to anon, authenticated
  using (false) with check (false);

create or replace function public.registrar_envio_correo_proveedor(p_usuario uuid, p_proveedor uuid, p_resultado text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_usuario is null then
    raise exception 'registrar_envio_correo_proveedor: falta el usuario' using errcode = '22023';
  end if;
  if p_proveedor is null then
    raise exception 'registrar_envio_correo_proveedor: falta el proveedor' using errcode = '22023';
  end if;
  if p_resultado is null or p_resultado not in ('enviado', 'fallido') then
    raise exception 'registrar_envio_correo_proveedor: el resultado debe ser enviado o fallido' using errcode = '22023';
  end if;
  insert into private.correo_proveedor_envios (usuario_id, proveedor_id, resultado) values (p_usuario, p_proveedor, p_resultado);
end;
$$;

comment on function public.registrar_envio_correo_proveedor(uuid, uuid, text) is
  'Registra un envío de correo a un proveedor (usuario, proveedor y resultado; sin contenido). Solo service_role (la Edge Function enviar-correo-proveedor).';

revoke all on function public.registrar_envio_correo_proveedor(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.registrar_envio_correo_proveedor(uuid, uuid, text) to service_role;
