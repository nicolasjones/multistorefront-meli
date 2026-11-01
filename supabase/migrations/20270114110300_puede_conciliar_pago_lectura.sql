-- F-VTA-13 (MSF-401, épica MSF-195, spec 20261024-150000-ventas-cobros-y-conciliacion, FR-026):
-- `public.puede_conciliar_pago`: la lectura que necesita la pantalla Pagos para habilitar (o no)
-- el interruptor «Cobrado» de cada fila.
--
-- Esquema (Principio VII), verificado objeto por objeto:
--   public.puede_conciliar_pago          public (nueva RPC)   permiso de la acción `conciliar_pago`
--                                                      de Ventas en una empresa.
--   private.puede_conciliar_pago_en_empresa private (existente) la cuenta interna que resuelve ese
--                                                      permiso por empresa (20270114110000).
--   public.permisos_rol_accion            public (plataforma)  la matriz que ya sembró la acción.
-- Sin tablas nuevas: esta migración no crea ni altera columnas de ninguna tabla.
--
-- Permiso (FR-020 y FR-026):
-- · Devuelve `true` si la persona puede conciliar pagos en esa empresa: acción `conciliar_pago`
--   de Ventas y `ventas` en edición, resueltos con el ROL DEL USUARIO EN ESA EMPRESA (la misma
--   regla que aplica `public.conciliar_pago`): quien no puede conciliar en la tienda A no lo
--   hereda por ser Administración en la B.
-- · Una empresa de otra organización, una tienda sin acceso o un rol sin la acción devuelven
--   `false`: no se filtra información de otras organizaciones, solo el permiso de quien pregunta.
-- · `security definer` porque llama a la función interna `private`, que `authenticated` no
--   ejecuta. La autorización real sigue en `public.conciliar_pago`: esta RPC solo evita que la
--   pantalla ofrezca una acción que la base va a rechazar.
--
-- Migración aditiva. Reversión (en una migración posterior; no se ejecuta en este PR):
--   drop function public.puede_conciliar_pago(uuid);

create or replace function public.puede_conciliar_pago(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.puede_conciliar_pago_en_empresa(p_empresa_id));
$$;

revoke execute on function public.puede_conciliar_pago(uuid) from public, anon;
grant execute on function public.puede_conciliar_pago(uuid) to authenticated;

comment on function public.puede_conciliar_pago(uuid) is
  'true si la persona actual puede conciliar pagos en esa empresa (acción conciliar_pago de Ventas y ventas en edición). Solo lectura del permiso propio: la autorización real la hace public.conciliar_pago.';
