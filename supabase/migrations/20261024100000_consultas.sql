-- MSF-186 · F-CON-01 (épica MSF-122, spec 20261023-120000-consultas-bandeja-y-aviso, FR-001):
-- bandeja de consultas de las tiendas.
--
-- Esquema (Principio VII), verificado tabla por tabla:
--   dominio.consultas  dominio (nueva)  registro de negocio: lo que un visitante le preguntó a una
--                                       empresa. No es un dato de plataforma → nunca `public`.
--   dominio.empresas / dominio.productos  dominio (existentes), solo se referencian.
--
-- Seguridad:
--   * RLS por organización, empresa accesible y sección `consultas` (lectura o edición).
--   * SIN insert, update ni delete desde la app: el alta es solo `publico.crear_consulta_publica`
--     y la edición solo `public.actualizar_consulta` (ambas SECURITY DEFINER, con validación,
--     bloqueo optimista y actividad). Así nadie fija el responsable ni el estado sin validar.
--   * `anon` sin privilegios sobre la tabla.
--
-- Migración aditiva. Reversión (migración posterior; solo después de revertir F-CON-03 y
-- exportando antes los datos, que son personales):
--   drop trigger consultas_normalizar on dominio.consultas;
--   drop function private.normalizar_consulta();
--   drop table dominio.consultas;

create table dominio.consultas (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id uuid not null,
  origen text not null check (origen in ('formulario', 'whatsapp')),
  nombre text not null check (btrim(nombre) <> '' and length(nombre) <= 120),
  contacto text not null check (btrim(contacto) <> '' and length(contacto) <= 200),
  mensaje text check (mensaje is null or length(mensaje) <= 2000),
  producto_id uuid,
  estado text not null default 'nueva' check (estado in ('nueva', 'en_curso', 'resuelta')),
  responsable_id uuid references auth.users (id) on delete set null,
  nota_interna text check (nota_interna is null or length(nota_interna) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint consultas_empresa_fk foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade,
  constraint consultas_producto_fk foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id),
  -- Solo el origen WhatsApp puede venir sin mensaje (el prototipo muestra «No dejó mensaje»).
  constraint consultas_mensaje_requerido check (origen = 'whatsapp' or btrim(coalesce(mensaje, '')) <> '')
);

comment on table dominio.consultas is
  'F-CON-01: consultas que los visitantes envían desde las tiendas. Alta solo por publico.crear_consulta_publica; edición solo por public.actualizar_consulta; sin delete (la retención está pendiente).';
comment on column dominio.consultas.contacto is
  'Correo o teléfono del visitante (dato personal). Validado en la RPC pública.';
comment on column dominio.consultas.updated_at is
  'Bloqueo optimista de public.actualizar_consulta: avanza solo ante un cambio real de estado, responsable o nota.';

create index consultas_empresa_estado_idx on dominio.consultas (empresa_id, estado, created_at desc);
create index consultas_organizacion_id_idx on dominio.consultas (organizacion_id);
create index consultas_producto_id_idx on dominio.consultas (producto_id) where producto_id is not null;
create index consultas_responsable_id_idx on dominio.consultas (responsable_id) where responsable_id is not null;

-- Normaliza al escribir (la base es la autoridad) y hace avanzar `updated_at` solo ante un cambio
-- real, así una escritura idempotente no rompe el bloqueo optimista.
create or replace function private.normalizar_consulta()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.nombre := btrim(new.nombre);
  new.contacto := btrim(new.contacto);
  new.mensaje := nullif(btrim(coalesce(new.mensaje, '')), '');
  new.nota_interna := nullif(btrim(coalesce(new.nota_interna, '')), '');

  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'updated_at') is not distinct from (to_jsonb(old) - 'updated_at') then
      new.updated_at := old.updated_at;
    else
      -- now() es constante en la transacción: sin esto dos cambios en la misma transacción
      -- repetirían updated_at y el bloqueo no avanzaría.
      new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.normalizar_consulta() from public, anon, authenticated;

create trigger consultas_normalizar
  before insert or update on dominio.consultas
  for each row execute function private.normalizar_consulta();

alter table dominio.consultas enable row level security;

-- Lectura: organización de la sesión, empresa accesible y sección `consultas`.
-- Sin políticas de escritura: nadie inserta, edita ni borra directo (ver encabezado).
create policy consultas_select on dominio.consultas
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and empresa_id in (select private.empresas_accesibles())
    and (select private.nivel_seccion('consultas')) in ('lectura', 'edicion')
  );

grant usage on schema dominio to authenticated;

revoke all on dominio.consultas from public, anon, authenticated;
grant select on dominio.consultas to authenticated;
