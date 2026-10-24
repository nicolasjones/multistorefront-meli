-- F-CLI-05 (MSF-422, épica MSF-237, spec 20261024-051500-cuenta-web-del-cliente): cuenta web del cliente
-- por tienda. FR-001.
--
-- Esquemas (Principio VII), verificados tabla por tabla:
--   public.cuentas_cliente  public  (nueva)  cuenta de AUTENTICACIÓN atada a public.clientes (que vive en
--                                           `public` por excepción documentada) y a Supabase Auth:
--                                           plataforma/transversal, no regla de negocio del producto.
--   public.clientes         public  (existente) solo se referencia.
--   dominio.empresas        dominio (existente) solo se referencia.
--
-- Una fila por (cliente, tienda). «Sin cuenta» = no hay fila; «No habilitado» = el cliente no está en
-- clientes_empresas para esa empresa (se deriva, no se guarda). Hay un solo usuario de Auth por cliente (D1).
-- La cuenta NO es miembro del panel: no se escribe usuarios_organizacion, así que private.organizacion_id()
-- es nulo para ella y ninguna política RLS le devuelve filas.
--
-- RLS: lectura por organización y sección Clientes; sin políticas de escritura (solo las RPC security
-- definer escriben). `anon` no recibe privilegios.
--
-- Migración aditiva. Reversión (migración posterior; no se ejecuta en el mismo PR):
--   drop trigger cuentas_cliente_validar on public.cuentas_cliente;
--   drop table public.cuentas_cliente;   -- pierde las cuentas web (los usuarios de Auth quedan sin uso)

create table public.cuentas_cliente (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  cliente_id uuid not null references public.clientes (id) on delete cascade,
  empresa_id uuid not null references dominio.empresas (id) on delete cascade,
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  estado text not null default 'activa' check (estado in ('activa', 'suspendida')),
  created_at timestamptz not null default now(),
  constraint cuentas_cliente_cliente_empresa_uk unique (cliente_id, empresa_id)
);

comment on table public.cuentas_cliente is
  'F-CLI-05 (MSF-237): cuenta web de un cliente en una tienda (empresa). Una fila por (cliente, tienda); un solo usuario de Auth por cliente. No es miembro del panel: nunca tiene fila en usuarios_organizacion. Escritura solo por las RPC de cuenta web; lectura por Clientes (RLS por organización y sección).';
comment on column public.cuentas_cliente.estado is
  'activa | suspendida. «Sin cuenta» (sin fila) y «No habilitado» (cliente fuera de clientes_empresas) se derivan, no se guardan.';

-- Los FK en cascada y las consultas por usuario/tienda buscan por estas columnas.
create index cuentas_cliente_organizacion_id_idx on public.cuentas_cliente (organizacion_id);
create index cuentas_cliente_empresa_id_idx on public.cuentas_cliente (empresa_id);
create index cuentas_cliente_auth_user_id_idx on public.cuentas_cliente (auth_user_id);

-- El cliente y la empresa deben ser de la organización de la fila: se reutiliza el disparador de
-- clientes_empresas (mismas columnas cliente_id / empresa_id / organizacion_id).
create trigger cuentas_cliente_validar
  before insert or update on public.cuentas_cliente
  for each row execute function private.validar_cliente_empresa();

alter table public.cuentas_cliente enable row level security;

create policy cuentas_cliente_select on public.cuentas_cliente
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('clientes')) in ('lectura', 'edicion')
  );

-- auto_expose_new_tables = false: grants explícitos. Solo lectura para `authenticated`; la escritura llega
-- por las RPC (security definer). `anon` y PUBLIC sin acceso.
revoke all on public.cuentas_cliente from anon, public, authenticated;
grant select on public.cuentas_cliente to authenticated;
