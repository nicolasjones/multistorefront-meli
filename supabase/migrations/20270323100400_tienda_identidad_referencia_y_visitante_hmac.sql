-- MSF-560 (devolución de la revisión de seguridad del PR #1003): corrige dos hallazgos del Lote 1 de seguridad de
-- la tienda pública (MSF-796 y MSF-945). Las migraciones que los originaron (20270323100000 y 20270323100200) YA
-- ESTÁN APLICADAS en dev/stg/prd y NO se tocan: una versión aplicada es inmutable (si su contenido cambia, el guard de
-- migraciones la marca MODIFICADA, deja de aplicarse y repo y base divergen en silencio). Todo el arreglo va en esta
-- migración aditiva.
--
-- Hallazgo 1 · oráculo cross-tenant: `private.ruta_identidad_referenciada` es `security definer` y cualquier
-- `authenticated` podía ejecutarla con una ruta ajena y obtener un booleano sobre si esa ruta la referencia la
-- identidad publicada, el borrador o una versión de OTRA organización. Ahora, para quien llega por la API, la función
-- solo responde por la organización de quien pregunta: si la empresa de la ruta no es de su organización, devuelve
-- «no referenciada» (el mismo resultado que una ruta sin referencia: no se filtra si la otra organización la usa). El
-- borrado sigue igual de protegido: la política de `storage.objects` ya exigía que la carpeta fuera de la organización de
-- quien borra, y ahora la función tampoco dice nada de las empresas ajenas.
--
-- Interpretación (el Revisor proponía dos caminos): «restringir el `grant` a `authenticated` con rol de edición» no se
-- puede hacer con un `grant` (Postgres no tiene «ejecuta si tenés edición»), y «dejar la función sin `execute` para API
-- y resolver la política con una función equivalente» rompería el borrado: la política se evalúa con los privilegios de
-- quien borra y necesita `execute` sobre la función que consulta. Se elige el equivalente que quita el oráculo sin
-- cambiar el contrato: acotar la respuesta a la organización de quien pregunta. `service_role` y las tareas de
-- mantenimiento (sin JWT) siguen viendo la respuesta completa.
--
-- Hallazgo 2 · el marcador `legado` también alcanzaba a los HMAC nuevos: `private.inicializar_visitante_hmac` reemplaza
-- los hashes sin clave por `legado` con `visitante ~ '^[0-9a-f]{64}$'`, un patrón que también matchea los HMAC
-- nuevos. Si el secreto de Vault se borrara y se re-creara, el reemplazo volvería a correr y todos los HMAC vivos caerían
-- a `legado` (y el límite por visitante se reiniciaría). Ahora el HMAC se guarda con un prefijo distinguible
-- (`hmac:` + hex): el patrón del hash viejo ya no lo alcanza, y las filas que ya existían (HMAC, no `legado`) se pasan al
-- formato nuevo conservando el valor, así que el cupo de cada visitante sigue igual.
--
-- Esquemas (Principio VII, re-verificado): sin tablas nuevas ni alteradas. `dominio.tienda_envios` solo cambia el
-- contenido de la columna `visitante` (misma tabla, misma política de lectura); `private.*` es lógica interna sin
-- acceso para los roles de API (los `revoke` de 20270323100200 se conservan: `create or replace` mantiene los
-- privilegios).
--
-- Rol de migración: debe ver `vault.secrets` (como en 20270323100200: se migra con el rol postgres).
--
-- Aditiva e idempotente. Reversión (migración posterior):
--   update dominio.tienda_envios set visitante = right(visitante, 64) where visitante like 'hmac:%';
--   create or replace function private.hmac_visitante(text) ... (sin el prefijo `hmac:`; ver 20270323100200);
--   create or replace function private.ruta_identidad_referenciada(text) ... (sin la guarda de organización; ver 20270323100000);

-- ----------------------------------------------------------------------------
-- Hallazgo 1: la respuesta es de una sola organización
-- ----------------------------------------------------------------------------
create or replace function private.ruta_identidad_referenciada(p_ruta text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
  v_organizacion uuid;
begin
  if p_ruta is null then
    return false;
  end if;
  begin
    v_empresa := split_part(p_ruta, '/', 2)::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  -- Quien llega por la API solo puede preguntar por su propia organización: si la empresa de la ruta es de otra (o no
  -- existe), la respuesta es «no referenciada», igual que una ruta sin referencia. El `service_role` y las tareas de
  -- mantenimiento (sin JWT) siguen viendo la respuesta real.
  if coalesce(auth.role(), 'service_role') <> 'service_role' then
    select e.organizacion_id into v_organizacion from dominio.empresas e where e.id = v_empresa;
    if v_organizacion is null or v_organizacion is distinct from private.organizacion_id() then
      return false;
    end if;
  end if;

  return exists (
           select 1 from dominio.tienda_identidad i
            where i.empresa_id = v_empresa
              and p_ruta in (i.logo_ruta, i.banner_ruta, i.banner_movil_ruta))
      or exists (
           select 1 from dominio.tienda_borrador b
            where b.empresa_id = v_empresa
              and p_ruta in (b.identidad ->> 'logo_ruta', b.identidad ->> 'banner_ruta', b.identidad ->> 'banner_movil_ruta'))
      or exists (
           select 1 from dominio.tienda_versiones v
            where v.empresa_id = v_empresa
              and p_ruta in (v.instantanea -> 'identidad' ->> 'logo_ruta',
                             v.instantanea -> 'identidad' ->> 'banner_ruta',
                             v.instantanea -> 'identidad' ->> 'banner_movil_ruta'));
end;
$$;

comment on function private.ruta_identidad_referenciada(text) is
  'MSF-796 (revisión PR #1003): true si la ruta del bucket tienda-identidad la usa la identidad publicada, el borrador o alguna versión (logo, banner o banner móvil). Para quien llega por la API responde solo por su propia organización (una ruta de otra organización es «no referenciada»): sin oráculo cross-tenant. La usa la política de borrado de storage.objects; sin acceso para anon.';

-- ----------------------------------------------------------------------------
-- Hallazgo 2: el HMAC del visitante tiene una forma distinguible
-- ----------------------------------------------------------------------------
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
  return 'hmac:' || encode(extensions.hmac(p_texto, v_clave, 'sha256'), 'hex');
end;
$$;

comment on function private.hmac_visitante(text) is
  'MSF-945 (revisión PR #1003): HMAC-SHA256 hex del texto con el secreto de visitante_hmac de Vault, con el prefijo «hmac:» que lo distingue del hash sin clave; falla si el secreto falta. Sin acceso para roles de API.';

comment on function private.visitante_hash(uuid) is
  'F-TDA-16 (D6) / MSF-945: HMAC-SHA256 (secreto de Vault) de la IP del cliente + empresa, con el prefijo «hmac:»; sin cabecera, cupo único «sin-ip». Nunca devuelve ni guarda la IP.';

-- Las filas anteriores al secreto guardan el sha256 enumerable: no se pueden recalcular y pasan a «legado» (mismo
-- criterio que la migración 20270323100200). Las posteriores son HMAC: se les pone el prefijo nuevo SIN cambiar el
-- valor, así que el cupo de cada visitante se conserva y el reemplazo a «legado» ya no las alcanza.
update dominio.tienda_envios
   set visitante = 'legado'
 where visitante ~ '^[0-9a-f]{64}$'
   and creado_en < coalesce((select created_at from vault.secrets where name = 'visitante_hmac'), now());

update dominio.tienda_envios
   set visitante = 'hmac:' || visitante
 where visitante ~ '^[0-9a-f]{64}$';
