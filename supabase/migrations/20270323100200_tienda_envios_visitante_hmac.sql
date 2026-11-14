-- MSF-945 (épica contenedora MSF-515, Lote 1; hallazgo H-1 de la revisión de seguridad T070 de MSF-176):
-- `dominio.tienda_envios.visitante` guardaba sha256(ip || '|' || empresa_id) SIN sal ni secreto. El espacio IPv4 (2^32)
-- se enumera en minutos: quien leyera la tabla (copia de seguridad, exportación, persona con acceso por RLS) recuperaba la IP
-- de cada visitante, y con `clave_envio` podía ligarla al presupuesto o al pedido de una cuenta de cliente. Además
-- `tienda_envios_select` solo pedía pertenecer a la organización (cualquier rol, sin sección).
--
-- Qué hace esta migración:
--   1. El visitante pasa a HMAC-SHA256 con un secreto del SERVIDOR guardado en Supabase Vault (`visitante_hmac`), generado
--      acá con gen_random_bytes(32), aleatorio por entorno y nunca en Git. Mismo patrón que `acceso_hmac` (MSF-470,
--      20261014100000). Sin la clave (o sin Vault) la función falla y el envío se rechaza: falla cerrada, nunca vuelve al
--      hash sin clave.
--   2. Los hashes viejos NO se pueden recalcular (la IP no se guarda) ni se pueden dejar: son sha256 enumerable. Se
--      REEMPLAZAN por el marcador fijo `legado`, que no coincide con ningún visitante nuevo (HMAC hex de 64 caracteres).
--      Efecto conocido y aceptado: quien ya había usado cupo en la última hora (límite de 5 por hora y empresa) empieza de
--      cero tras el despliegue; las claves de idempotencia (`clave_envio`) se conservan, así que un reintento en vuelo
--      sigue resolviéndose como `repetido`. Las filas se podan solas a las 24 h (private.registrar_envio_tienda).
--      Corre UNA sola vez por entorno: solo cuando esta migración crea el secreto (si ya existe, no toca nada: los
--      hashes que haya ya son HMAC).
--   3. `tienda_envios_select` exige además edición en la sección Empresas (donde vive el panel de la tienda) y que la
--      empresa sea accesible para la persona (`private.empresas_accesibles()`, como `consultas_select`): ya no la lee
--      cualquier rol de la organización. Ningún lugar del panel ni de los workers lee esta tabla; queda para auditar abuso.
--
-- Vínculo IP ↔ cuenta de cliente (verificado): `dominio.presupuestos_tienda` guarda (cuenta_cliente_id, clave_envio); la
-- clave es la misma de `tienda_envios` (empresa_id, clave_envio) -> visitante. Tras este cambio el visitante es un HMAC
-- que no se puede invertir ni enumerar sin el secreto: nadie con acceso a las tablas (ni a una copia) obtiene la IP. Queda
-- un vínculo opaco cuenta ↔ visitante dentro de las 24 h de retención, que solo ve quien tiene edición en Empresas y
-- además Ventas (tienda_envios_select + presupuestos_tienda_select); no se desacopla la clave porque el reintento
-- idempotente de `enviar_lista_pedido` (20270322100700) consulta `tienda_envios` por la clave cruda.
--
-- Esquemas (Principio VII, re-verificado): `dominio.tienda_envios` (alterada: solo su política y el contenido de
-- `visitante`; sin columnas nuevas) -> `dominio`; Vault es infraestructura de plataforma; las funciones `private.*` son
-- lógica interna, sin acceso para roles de API.
--
-- Rol de migración: debe ver `vault.secrets` (como en 20261014100000: se migra con el rol postgres).
-- Reversión (migración posterior; los hashes `legado` no se pueden restaurar):
--   drop policy if exists tienda_envios_select on dominio.tienda_envios;
--   create policy tienda_envios_select on dominio.tienda_envios for select to authenticated
--     using (organizacion_id = private.organizacion_id());
--   (reponer private.visitante_hash con la definición de 20261212120700);
--   drop function if exists private.inicializar_visitante_hmac(); drop function if exists private.hmac_visitante(text);
--   delete from vault.secrets where name = 'visitante_hmac';
-- Aditiva e idempotente.

create extension if not exists pgcrypto with schema extensions;

-- Crea el secreto (si falta) y, en ese mismo acto, reemplaza los hashes sha256 viejos por el marcador `legado`.
-- Devuelve true si creó el secreto (primera vez en el entorno). Es una función aparte para poder probar el reemplazo.
create or replace function private.inicializar_visitante_hmac()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if to_regclass('vault.secrets') is null then
    raise exception 'Vault no está habilitado o el rol que migra no lo ve: habilitá la extensión supabase_vault y migrá con el rol postgres';
  end if;
  if exists (select 1 from vault.secrets where name = 'visitante_hmac') then
    return false;
  end if;
  perform vault.create_secret(
    encode(extensions.gen_random_bytes(32), 'hex'),
    'visitante_hmac',
    'Clave HMAC del hash de visitante en dominio.tienda_envios (MSF-945)'
  );
  update dominio.tienda_envios set visitante = 'legado' where visitante ~ '^[0-9a-f]{64}$';
  return true;
end;
$$;

comment on function private.inicializar_visitante_hmac() is
  'MSF-945: crea el secreto visitante_hmac en Vault si falta y, solo entonces, reemplaza los hashes sha256 sin clave de tienda_envios por «legado». Idempotente. Sin acceso para roles de API.';

revoke execute on function private.inicializar_visitante_hmac() from public, anon, authenticated;

select private.inicializar_visitante_hmac();

-- HMAC-SHA256 (hex) del texto con la clave de Vault. Cada llamada descifra la clave (lectura puntual; no se cachea en un
-- setting de sesión para no dejarla expuesta). security definer: lee Vault con los privilegios del dueño.
create or replace function private.hmac_visitante(p_texto text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_clave text;
begin
  select decrypted_secret into v_clave from vault.decrypted_secrets where name = 'visitante_hmac';
  if v_clave is null then
    raise exception 'falta el secreto visitante_hmac en Vault';
  end if;
  return encode(extensions.hmac(p_texto, v_clave, 'sha256'), 'hex');
end;
$$;

comment on function private.hmac_visitante(text) is
  'MSF-945: HMAC-SHA256 hex del texto con el secreto visitante_hmac de Vault; falla si el secreto falta. Sin acceso para roles de API.';

revoke execute on function private.hmac_visitante(text) from public, anon, authenticated;

-- D6 · visitante = HMAC de la IP del cliente (según private.saltos_proxy_confiables, F-TDA-15) y la empresa. Sin cabecera
-- `x-forwarded-for` todos caen en un único cupo «sin-ip»: falla cerrada, no abierta. Misma firma y misma entrada que antes;
-- solo cambia el algoritmo (sha256 sin clave -> HMAC con secreto del servidor).
create or replace function private.visitante_hash(p_empresa uuid)
returns text
language sql
stable
set search_path = ''
as $$
  with cadena as (
    select regexp_split_to_array(
             trim(coalesce(
               (coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-forwarded-for'),
               '')),
             '[[:space:]]*,[[:space:]]*') as ips
  )
  select private.hmac_visitante(
           coalesce(
             nullif(ips[greatest(1, coalesce(array_length(ips, 1), 0) - private.saltos_proxy_confiables())], ''),
             'sin-ip')
           || '|' || coalesce(p_empresa::text, ''))
  from cadena;
$$;

comment on function private.visitante_hash(uuid) is
  'F-TDA-16 (D6) / MSF-945: HMAC-SHA256 (secreto de Vault) de la IP del cliente + empresa; sin cabecera, cupo único «sin-ip». Nunca devuelve ni guarda la IP.';

revoke execute on function private.visitante_hash(uuid) from public, anon, authenticated;

-- Lectura de la tabla: solo quien edita Empresas y accede a la empresa del envío.
drop policy if exists tienda_envios_select on dominio.tienda_envios;

create policy tienda_envios_select on dominio.tienda_envios
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (select private.nivel_seccion('empresas')) = 'edicion'
  );

comment on table dominio.tienda_envios is
  'F-TDA-16: envíos de visitantes de la tienda pública (formulario, WhatsApp, pedido y presupuesto) para el límite por hora y la idempotencia. El visitante es un HMAC con secreto del servidor (MSF-945), nunca la IP ni un hash enumerable. Lectura: edición en Empresas y empresa accesible. Sin privilegios para anon; escribe solo private.registrar_envio_tienda.';
