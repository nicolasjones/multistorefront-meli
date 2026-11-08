-- MSF-378 · F-NOT-02 (FR-001): estado «leído» de los avisos para la campanita del panel.
-- Esquema `public` (Principio VII): `avisos_pendientes` es la cola de avisos de plataforma (F-NOT-01);
-- el estado leído es del mismo aviso, una tabla nueva duplicaría datos. Aditiva: no toca RLS
-- (activada sin políticas) ni privilegios.
--
-- Reversión (migración posterior; solo después de revertir 20270217000002):
--   drop index if exists public.avisos_pendientes_usuario_creado_idx;
--   alter table public.avisos_pendientes drop column if exists leido_en;

alter table public.avisos_pendientes
  add column if not exists leido_en timestamptz;

comment on column public.avisos_pendientes.leido_en is
  'Cuándo la persona destinataria vio el aviso en la campanita del panel (null = sin leer). Independiente del envío por correo.';

create index if not exists avisos_pendientes_usuario_creado_idx
  on public.avisos_pendientes (user_id, creado_en desc);
