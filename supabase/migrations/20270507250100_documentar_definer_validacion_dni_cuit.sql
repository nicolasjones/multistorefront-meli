-- Lote 44 (menor de MSF-666/lote 38): deja escrito en el catálogo por qué los disparadores `validar_documento_cliente` y
-- `validar_cuit_empresa` (20270507210300) son `security definer` y no `security invoker`.
--
-- Llaman a `private.documento_cliente_valido` y `private.cuit_valido`, que tienen el EXECUTE revocado a `public`, `anon` y
-- `authenticated` a propósito (no deben quedar en la API). Un disparador invoker corre con el rol de quien escribe (`authenticated`)
-- y fallaría con «permission denied for function» al insertar o editar un cliente o una empresa. Por eso corren como el dueño de la
-- función; no leen ni escriben ninguna tabla, solo validan `new`, y el EXECUTE de los propios disparadores también está revocado.
-- El pgTAP `lote38_documento_dni_cuit` fija esa combinación.
--
-- Se hace en una migración nueva (y no editando 20270507210300) porque una migración aplicada es inmutable. Solo cambian comentarios
-- del catálogo. Aditiva y sin efecto sobre datos ni permisos.
-- Reversión: comment on function private.validar_documento_cliente() is null;
--            comment on function private.validar_cuit_empresa() is null;

comment on function private.validar_documento_cliente() is
  'Disparador: valida el documento (DNI o CUIT) del cliente al insertar o cambiarlo. SECURITY DEFINER a propósito: llama a private.documento_cliente_valido y private.cuit_valido, con EXECUTE revocado a authenticated; como invoker fallaría con permission denied. Solo valida new, no toca tablas.';

comment on function private.validar_cuit_empresa() is
  'Disparador: valida el dígito verificador del CUIT de la empresa al insertar o cambiarlo. SECURITY DEFINER a propósito: llama a private.cuit_valido, con EXECUTE revocado a authenticated; como invoker fallaría con permission denied. Solo valida new, no toca tablas.';
