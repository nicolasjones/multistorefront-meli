-- MSF-825 (MSF-828): el disparador `private.normalizar_producto()` (20270228300500) llama a
-- `private.quitar_prefijo_importacion()`, que se creó sin privilegio de ejecución para el rol que escribe.
-- El disparador NO es `security definer`: corre como el rol que inserta, y `public.crear_producto` es
-- `security invoker`, así que el alta y la edición de productos desde la app (rol `authenticated`) fallaban con
-- «permission denied for function quitar_prefijo_importacion» (pgTAP: catalogo_productos,
-- catalogo_codigo_barras, catalogo_sku_unico y proveedores_productos).
--
-- La helper es pura (solo texto): no lee datos ni cambia permisos, así que dársela a `authenticated` no abre
-- información. El importador no la necesita: su RPC (`private.aplicar_fila_importacion_productos`) es
-- `security definer` y el disparador corre como el dueño.
--
-- Esquemas (Principio VII): no se crea ni altera ninguna tabla.
-- Reversión: `revoke execute on function private.quitar_prefijo_importacion(text) from authenticated;`
-- (vuelve al estado previo al arreglo: el alta y la edición de productos fallan por permiso).

grant execute on function private.quitar_prefijo_importacion(text) to authenticated;
