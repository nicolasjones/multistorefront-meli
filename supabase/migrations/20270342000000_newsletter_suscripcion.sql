-- MSF-468 (spec 20270328-100000-newsletter-de-la-tienda), Fase 1 · T001: base de la suscripción al newsletter de la tienda.
-- RF-NL-1, RF-NL-22, RF-NL-25, D1, D2, D7, D8. Sin pantallas, sin flows y SIN ningún envío: esta migración solo crea la
-- bandera (apagada), las dos tablas y el origen `newsletter` del límite por visitante.
--
-- Esquemas (Principio VII, verificado objeto por objeto):
--   * dominio.newsletter_configuracion (nueva)  -> `dominio`: hecho del negocio de la tienda (si activó su newsletter).
--   * dominio.newsletter_suscriptores (nueva)   -> `dominio`: dato del negocio de la tienda (a quién escribe).
--   * dominio.tienda_envios (alterada)          -> `dominio`: solo el check de `origen` suma `newsletter`.
--   * fila `newsletter` de public.banderas_plataforma -> `public`: dato de plataforma, APAGADA por defecto.
--
-- Seguridad: RLS por organización y tienda accesible; lectura con la sección `clientes` en lectura o edición; `authenticated`
-- solo `select` por columna (sin `confirmacion_hash`, ni el estado interno del reclamo); sin políticas ni grants de
-- escritura (escribirán las funciones `security definer` de las migraciones siguientes); `anon` sin ningún privilegio.
-- `service_role` queda con el mismo grant que las tablas operativas hermanas (prueba service_role_privilegios).
--
-- Migración aditiva e idempotente. Reversión (migración posterior; exportar antes los suscriptores si hace falta):
--   drop table if exists dominio.newsletter_suscriptores;
--   drop table if exists dominio.newsletter_configuracion;
--   delete from public.banderas_plataforma where clave = 'newsletter';
--   restaurar el check tienda_envios_origen_check de 20270321100000 (sin `newsletter`) solo si no quedan filas con ese origen.
-- Desactivar sin revertir: update public.banderas_plataforma set activa = false where clave = 'newsletter';

insert into public.banderas_plataforma (clave, activa, descripcion) values
  ('newsletter', false, 'Newsletter de la tienda (MSF-468): formulario de suscripción en el pie, confirmación por correo y, en fases posteriores, composición y envío. Nace apagada; se enciende por SQL dev → stg → prd.')
on conflict (clave) do nothing;

-- El límite por visitante (5 por hora, compartido con contacto y WhatsApp) admite el origen `newsletter` (D4).
alter table dominio.tienda_envios drop constraint if exists tienda_envios_origen_check;
alter table dominio.tienda_envios
  add constraint tienda_envios_origen_check check (origen in ('formulario', 'whatsapp', 'pedido', 'presupuesto', 'newsletter'));

-- Una fila por tienda: el interruptor «Mostrar suscripción en el pie de la tienda» (apagado por defecto, D8).
create table if not exists dominio.newsletter_configuracion (
  empresa_id uuid primary key,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  activo boolean not null default false,
  actualizado_en timestamptz not null default now(),
  constraint newsletter_configuracion_empresa_fk foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade
);

comment on table dominio.newsletter_configuracion is
  'MSF-468 (D8): interruptor por tienda del newsletter (apagado por defecto). Se escribe solo por RPC security definer.';

create table if not exists dominio.newsletter_suscriptores (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null,
  -- Recortado y en minúsculas; una sola dirección con forma estricta (local `atom(.atom)*` sin `%`, `!`, `|`, `/`, punto inicial, final ni doble; dominio con
  -- etiquetas alfanuméricas y TLD de letras; local ≤ 64). Lista blanca de caracteres (sin `<`, `>`, `"`, `(`, `)`, `\`, `:`, `,` ni `;`:
  -- evita direcciones distintas que el SMTP interprete como la misma persona), ≤ 254.
  correo text not null,
  estado text not null default 'pendiente',
  origen text not null default 'formulario',
  -- Versión del texto de consentimiento que aceptó la persona (D2). No se guarda IP, navegador ni nombre.
  version_consentimiento text not null,
  consentimiento_en timestamptz not null default now(),
  -- SHA-256 (hex) del token del correo de confirmación; el token en claro nunca se guarda (D1).
  confirmacion_hash text,
  confirmacion_vence timestamptz,
  -- Pedido de confirmación pendiente de enviar: `solicitada_en` posterior a `enviada_en` (o `enviada_en` nulo).
  confirmacion_solicitada_en timestamptz,
  confirmacion_enviada_en timestamptz,
  -- Reclamo con vencimiento del flow (como el correo masivo) y reintentos del ciclo actual (máximo 4).
  confirmacion_reclamada_hasta timestamptz,
  confirmacion_intentos integer not null default 0,
  -- Tope por dirección: 3 confirmaciones por ventana de 24 h (`confirmaciones_desde` es el inicio de la ventana).
  confirmaciones_24h integer not null default 0,
  confirmaciones_desde timestamptz,
  confirmado_en timestamptz,
  baja_en timestamptz,
  creado_en timestamptz not null default now(),
  constraint newsletter_suscriptores_correo_ck check (
    char_length(correo) <= 254 and correo = lower(btrim(correo)) and correo ~ '^[a-z0-9''+_=&*#$?^{}~-]+(\.[a-z0-9''+_=&*#$?^{}~-]+)*@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$'
    and char_length(split_part(correo, '@', 1)) <= 64),
  constraint newsletter_suscriptores_estado_ck check (estado in ('pendiente', 'confirmado', 'baja')),
  constraint newsletter_suscriptores_origen_ck check (origen in ('formulario')),
  constraint newsletter_suscriptores_version_ck check (btrim(version_consentimiento) <> '' and char_length(version_consentimiento) <= 50),
  constraint newsletter_suscriptores_intentos_ck check (confirmacion_intentos between 0 and 10 and confirmaciones_24h between 0 and 10),
  constraint newsletter_suscriptores_id_org_uq unique (id, organizacion_id),
  constraint newsletter_suscriptores_empresa_fk foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade
);

comment on table dominio.newsletter_suscriptores is
  'MSF-468 (D1, D2, D7): suscriptor del newsletter de UNA tienda, con consentimiento propio y doble confirmación. Sin IP ni nombre. Se escribe solo por funciones security definer; el hash de confirmación no se expone.';

create unique index if not exists newsletter_suscriptores_correo_uq
  on dominio.newsletter_suscriptores (empresa_id, lower(correo));
create unique index if not exists newsletter_suscriptores_hash_uq
  on dominio.newsletter_suscriptores (empresa_id, confirmacion_hash) where confirmacion_hash is not null;
create index if not exists newsletter_suscriptores_organizacion_idx
  on dominio.newsletter_suscriptores (organizacion_id, empresa_id, estado);
create index if not exists newsletter_suscriptores_solicitadas_idx
  on dominio.newsletter_suscriptores (empresa_id, confirmacion_solicitada_en);
create index if not exists newsletter_suscriptores_por_confirmar_idx
  on dominio.newsletter_suscriptores (confirmacion_solicitada_en) where estado = 'pendiente';

alter table dominio.newsletter_configuracion enable row level security;
alter table dominio.newsletter_suscriptores enable row level security;

drop policy if exists newsletter_configuracion_select on dominio.newsletter_configuracion;
create policy newsletter_configuracion_select on dominio.newsletter_configuracion
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('clientes')) in ('lectura', 'edicion')
    and empresa_id in (select private.empresas_accesibles())
  );

drop policy if exists newsletter_suscriptores_select on dominio.newsletter_suscriptores;
create policy newsletter_suscriptores_select on dominio.newsletter_suscriptores
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('clientes')) in ('lectura', 'edicion')
    and empresa_id in (select private.empresas_accesibles())
  );

revoke all on dominio.newsletter_configuracion from public, anon, authenticated;
revoke all on dominio.newsletter_suscriptores from public, anon, authenticated;

grant select on dominio.newsletter_configuracion to authenticated;
-- Sin `confirmacion_hash` ni el estado interno del reclamo (detalle del flow).
grant select (id, organizacion_id, empresa_id, correo, estado, origen, version_consentimiento, consentimiento_en,
              confirmacion_solicitada_en, confirmacion_enviada_en, confirmado_en, baja_en, creado_en)
  on dominio.newsletter_suscriptores to authenticated;

-- Tablas operativas: mismo grant que sus hermanas de `dominio` (prueba service_role_privilegios).
grant select, insert, update, delete on dominio.newsletter_configuracion to service_role;
grant select, insert, update, delete on dominio.newsletter_suscriptores to service_role;
