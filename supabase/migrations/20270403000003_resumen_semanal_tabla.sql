-- MSF-287 · F-REP-08 (épica MSF-265, spec 20261101-100000-analitica-avanzada-y-resumen-por-correo,
-- FR-010, FR-013): registro de los resúmenes semanales por correo y tipo de aviso `resumen_semanal`.
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.resumen_semanal_envios  dominio (nueva)  una fila por (organización, destinatario, semana):
--                                     estado, intentos, origen, timestamps y error útil. Es el dato
--                                     del producto (el resumen del negocio de cada organización) y
--                                     la clave de idempotencia del envío → `dominio`.
--   public.tipos_aviso              public (existente) catálogo de plataforma (MSF-189): se registra
--                                     el tipo `resumen_semanal` (sección `rentabilidad`). No es tabla
--                                     nueva: la fila se agrega al catálogo, como hizo MSF-189.
--
-- Seguridad:
--   * RLS por organización: la fila se lee solo dentro de su organización y con lectura de
--     `rentabilidad` (misma regla que `dominio.alertas_inicio`).
--   * SIN insert, update ni delete desde la app: escriben únicamente las funciones `private` de la
--     migración siguiente (las llama el rol de servicio de Kestra `kestra_orquestacion`).
--     `anon` sin privilegios.
--   * SIN lectura desde la app: no hay pantalla que consuma la cola (la consulta operativa es
--     «como superusuario»), así que `authenticated` no tiene privilegio de tabla —los correos de
--     los destinatarios y el último error no salen de la base— (mismo criterio que
--     `public.avisos_pendientes`).
--   * Una fila nunca mezcla organizaciones: el resumen se arma y se envía por organización.
--
-- Migración aditiva. Reversión (migración posterior; antes revertir 20270324101100):
--   delete from public.tipos_aviso where clave = 'resumen_semanal';
--   drop table dominio.resumen_semanal_envios;

create table if not exists dominio.resumen_semanal_envios (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  destinatario_id uuid not null references auth.users (id) on delete cascade,
  -- Semana ISO (AAAA-Wnn): la clave de idempotencia del envío (FR-013).
  semana text not null check (semana ~ '^\d{4}-W\d{2}$'),
  -- Correo del destinatario en el momento del reclamo (durante la semana no cambia).
  destinatario_correo text not null check (btrim(destinatario_correo) <> ''),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'enviando', 'enviado', 'fallido')),
  intentos integer not null default 0 check (intentos >= 0),
  -- El resumen que se envía, tal como se armó al encolar: el correo es el mismo que quedó
  -- encolado (y no hay que volver a calcularlo en cada tanda). Siempre trae al menos una
  -- sección: sin datos no se encola a nadie.
  resumen jsonb not null
    check (coalesce(jsonb_array_length(resumen -> 'secciones'), 0) >= 1),
  -- Origen de la corrida (auditoría, Principio III).
  origen text not null default 'kestra:resumen-semanal',
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  enviado_en timestamptz,
  -- Vencimiento del reclamo: si Kestra se cae a mitad del envío, la fila no se reenvía (queda
  -- `fallido` con motivo): el envío es idempotente por destinatario y semana (FR-013).
  reclamado_hasta timestamptz,
  ultimo_error text check (ultimo_error is null or length(ultimo_error) <= 500),
  -- Un envío por destinatario y semana (FR-013).
  constraint resumen_semanal_envios_unico
    unique (organizacion_id, destinatario_id, semana)
);

comment on table dominio.resumen_semanal_envios is
  'F-REP-08: un envío del resumen semanal por organización, destinatario y semana. Solo lo escriben las funciones private del resumen (las llama el rol de Kestra).';

create index if not exists resumen_semanal_envios_pendientes_idx
  on dominio.resumen_semanal_envios (semana, estado)
  where estado in ('pendiente', 'enviando');

alter table dominio.resumen_semanal_envios enable row level security;

create policy resumen_semanal_envios_select on dominio.resumen_semanal_envios
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('rentabilidad')) in ('lectura', 'edicion')
  );

-- La cola es de la base: la app no la lee (no hay pantalla que la consuma) y solo la escriben
-- las funciones `private` que llama el rol de Kestra.
revoke all on dominio.resumen_semanal_envios from public, anon, authenticated;

-- Tipo de aviso del resumen semanal: reusa el catálogo de MSF-189 (la persona lo apaga en
-- «Avisos por correo»). La sección `rentabilidad` es la que habilita al destinatario.
insert into public.tipos_aviso (clave, nombre, seccion) values
  ('resumen_semanal', 'Resumen semanal del negocio', 'rentabilidad')
on conflict (clave) do nothing;
