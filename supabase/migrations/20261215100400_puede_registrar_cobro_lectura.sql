-- F-VTA-12 (MSF-389, épica MSF-195, spec 20261024-150000-ventas-cobros-y-conciliacion, FR-007):
-- `public.puede_registrar_cobro`: la lectura que necesita el detalle del comprobante para
-- mostrar u ocultar el botón «Registrar cobro».
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   public.puede_registrar_cobro           public (nueva RPC)    permiso de la acción
--                                                     `registrar_cobro` de Ventas en una empresa.
--   private.puede_registrar_cobro_en_empresa private (existente)  la cuenta interna que resuelve
--                                                     ese permiso por empresa (20261215100300).
--   public.permisos_rol_accion             public (plataforma)  la matriz que ya sembró la acción.
-- Sin tablas nuevas: esta migración no crea ni altera columnas de ninguna tabla.
--
-- Permiso (FR-002 y FR-007):
-- · Devuelve `true` si la persona puede registrar cobros en esa empresa: acción `registrar_cobro`
--   de Ventas y `ventas` en edición, resueltos con el ROL DEL USUARIO EN ESA EMPRESA (la misma
--   regla que aplica `public.registrar_cobro`): quien no puede cobrar en la tienda A no lo
--   hereda por ser Operador en la B.
-- · Una empresa de otra organización, una tienda sin acceso o un rol sin la acción devuelven
--   `false`: no se filtra información de otras organizaciones, solo el permiso de quien pregunta.
-- · `security definer` porque llama a la función interna `private`, que `authenticated` no
--   ejecuta. La autorización real sigue en `public.registrar_cobro`: esta RPC solo evita que la
--   pantalla ofrezca una acción que la base va a rechazar.
--
-- Migración aditiva. Reversión (en una migración posterior; no se ejecuta en este PR):
--   drop function public.puede_registrar_cobro(uuid);

create or replace function public.puede_registrar_cobro(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.puede_registrar_cobro_en_empresa(p_empresa_id));
$$;

revoke execute on function public.puede_registrar_cobro(uuid) from public, anon;
grant execute on function public.puede_registrar_cobro(uuid) to authenticated;

comment on function public.puede_registrar_cobro(uuid) is
  'true si la persona actual puede registrar cobros en esa empresa (acción registrar_cobro de Ventas y ventas en edición). Solo lectura del permiso propio: la autorización real la hace public.registrar_cobro.';
