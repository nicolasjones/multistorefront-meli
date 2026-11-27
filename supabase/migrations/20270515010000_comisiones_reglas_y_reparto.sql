-- MSF-187 / MSF-953 (S-2 de MSF-118, D-13): reglas de comisión de técnicos y reparto de la comisión de una reparación.
--
-- Decisiones por delegación (Nicolás delegó la decisión de requisitos en Claude, 2026-11-26):
--  * Hoy NO existía ninguna comisión en `dokploy` (ni tabla, ni función, ni pantalla): esta migración es la base mínima.
--  * La comisión de una reparación = base × porcentaje de la regla del técnico × porcentaje de reparto de ese técnico.
--    La base es la mano de obra al cliente (suma de `subtotal` de los ítems `mano_obra`, sin IVA); nunca costos internos.
--  * Reglas: porcentaje (0 a 100) por técnico o general (`tecnico_id` nulo), con vigencia por fecha de ENTREGA; solo se
--    agregan (sin update ni delete): cambiar una regla no altera lo calculado para una entrega anterior. Precedencia:
--    regla del técnico > regla general; entre reglas del mismo alcance, la de mayor `vigente_desde` <= entrega.
--  * Reparto: la comisión se reparte entre N técnicos con porcentajes que suman 100. Por defecto, 100 % al técnico asignado
--    (sin filas = reparto por defecto). Al ENTREGAR la reparación el reparto se congela: un disparador materializa el reparto
--    por defecto, de modo que cambiar después el técnico asignado no mueve comisiones. Cambiarlo después de la entrega
--    exige `ver_comisiones` + motivo y queda registrado (ver 20270515020000).
--  * Una reparación anulada o sin entrega no genera comisión.
--
-- Esquemas (Principio VII): `dominio.comision_reglas` y `dominio.reparacion_comision_reparto` son entidades de negocio del
-- taller → `dominio`. Las funciones de cálculo, en `private`.
--
-- Seguridad: RLS por organización en las dos tablas; SIN políticas ni grants de insert/update/delete (escriben solo las RPC
-- `security definer`); `anon` sin privilegios. La suma 100 % se valida en SQL con un disparador de restricción diferido.
--
-- Migración aditiva e idempotente. Reversión (migración posterior; exportar antes los datos):
--   drop trigger if exists reparaciones_congelar_reparto on dominio.reparaciones;
--   drop function private.congelar_reparto_comision();
--   drop table dominio.reparacion_comision_reparto;  -- arrastra su disparador y su función
--   drop function private.validar_reparto_comision();
--   drop table dominio.comision_reglas;

create table if not exists dominio.comision_reglas (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  -- Nulo = regla general (todos los técnicos). Si el usuario se borra, se van sus reglas (no pasan a ser generales).
  tecnico_id uuid references auth.users (id) on delete cascade,
  porcentaje numeric(5, 2) not null check (porcentaje between 0 and 100),
  vigente_desde date not null,
  creado_por uuid references auth.users (id) on delete set null,
  creado_en timestamptz not null default now()
);

comment on table dominio.comision_reglas is
  'Reglas de comisión de técnicos (MSF-187): porcentaje sobre la mano de obra, por técnico o general, con vigencia por fecha de entrega. Solo se agregan; escritura solo por RPC.';

create unique index if not exists comision_reglas_alcance_vigencia_key
  on dominio.comision_reglas (organizacion_id, coalesce(tecnico_id, '00000000-0000-0000-0000-000000000000'::uuid), vigente_desde);
create index if not exists comision_reglas_tecnico_idx on dominio.comision_reglas (tecnico_id) where tecnico_id is not null;

create table if not exists dominio.reparacion_comision_reparto (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null default private.organizacion_id()
    references public.organizaciones (id) on delete cascade,
  reparacion_id uuid not null,
  -- Si el usuario se borra queda la fila sin técnico: el 100 % del reparto se conserva.
  tecnico_id uuid references auth.users (id) on delete set null,
  porcentaje numeric(5, 2) not null check (porcentaje > 0 and porcentaje <= 100),
  creado_en timestamptz not null default now(),
  creado_por uuid references auth.users (id) on delete set null,
  constraint reparacion_comision_reparto_reparacion_fk foreign key (reparacion_id, organizacion_id)
    references dominio.reparaciones (id, organizacion_id) on delete cascade,
  constraint reparacion_comision_reparto_tecnico_key unique (reparacion_id, tecnico_id)
);

comment on table dominio.reparacion_comision_reparto is
  'Reparto de la comisión de una reparación entre técnicos (MSF-953); los porcentajes suman 100. Sin filas = 100 % al técnico asignado. Se congela al entregar. Escritura solo por RPC.';

create index if not exists reparacion_comision_reparto_reparacion_idx on dominio.reparacion_comision_reparto (reparacion_id);
create index if not exists reparacion_comision_reparto_tecnico_idx
  on dominio.reparacion_comision_reparto (tecnico_id) where tecnico_id is not null;

-- La suma del reparto de una reparación tiene que ser 100: se comprueba al final de la transacción (el reparto se reemplaza
-- borrando e insertando filas). Los 100 % se comparan con `numeric(5,2)`, exactos.
create or replace function private.validar_reparto_comision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_suma numeric;
begin
  select coalesce(sum(r.porcentaje), 0) into v_suma
    from dominio.reparacion_comision_reparto r
   where r.reparacion_id = new.reparacion_id;
  if v_suma <> 100 then
    raise exception 'Los porcentajes del reparto tienen que sumar 100 %%' using errcode = '22023', hint = 'reparto';
  end if;
  return null;
end;
$$;

revoke execute on function private.validar_reparto_comision() from public, anon, authenticated;

drop trigger if exists reparto_comision_suma_100 on dominio.reparacion_comision_reparto;
create constraint trigger reparto_comision_suma_100
  after insert or update on dominio.reparacion_comision_reparto
  deferrable initially deferred
  for each row execute function private.validar_reparto_comision();

-- Al entregar (entrega_real pasa de nulo a una fecha) se congela el reparto: si no había uno personalizado, se guarda el
-- 100 % al técnico asignado en ese momento. Sin técnico asignado no hay comisión que congelar.
create or replace function private.congelar_reparto_comision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.entrega_real is null and new.entrega_real is not null and new.tecnico_id is not null
     and not exists (select 1 from dominio.reparacion_comision_reparto r where r.reparacion_id = new.id) then
    insert into dominio.reparacion_comision_reparto (organizacion_id, reparacion_id, tecnico_id, porcentaje, creado_por)
    values (new.organizacion_id, new.id, new.tecnico_id, 100, (select auth.uid()));
  end if;
  return null;
end;
$$;

revoke execute on function private.congelar_reparto_comision() from public, anon, authenticated;

drop trigger if exists reparaciones_congelar_reparto on dominio.reparaciones;
create trigger reparaciones_congelar_reparto
  after update of entrega_real on dominio.reparaciones
  for each row execute function private.congelar_reparto_comision();

-- Reparaciones ya entregadas: se congela el reparto por defecto con su técnico actual (idempotente).
insert into dominio.reparacion_comision_reparto (organizacion_id, reparacion_id, tecnico_id, porcentaje)
select r.organizacion_id, r.id, r.tecnico_id, 100
  from dominio.reparaciones r
 where r.entrega_real is not null and r.tecnico_id is not null
on conflict (reparacion_id, tecnico_id) do nothing;

-- RLS por organización; sin insert/update/delete.
alter table dominio.comision_reglas enable row level security;
alter table dominio.reparacion_comision_reparto enable row level security;

drop policy if exists comision_reglas_select on dominio.comision_reglas;
create policy comision_reglas_select on dominio.comision_reglas
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('service_tecnico')) in ('lectura', 'edicion')
    and (select private.puede_accion('service_tecnico', 'ver_comisiones'))
  );

drop policy if exists reparacion_comision_reparto_select on dominio.reparacion_comision_reparto;
create policy reparacion_comision_reparto_select on dominio.reparacion_comision_reparto
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('service_tecnico')) in ('lectura', 'edicion')
    and exists (
      select 1 from dominio.reparaciones r
       where r.id = reparacion_comision_reparto.reparacion_id
         and r.empresa_id in (select private.empresas_accesibles())
    )
  );

revoke all on dominio.comision_reglas from public, anon, authenticated;
revoke all on dominio.reparacion_comision_reparto from public, anon, authenticated;
grant select on dominio.comision_reglas to authenticated;
grant select on dominio.reparacion_comision_reparto to authenticated;

-- service_role (workers y exportaciones; salta la RLS): mismos privilegios que el resto de `dominio`.
grant select, insert, update, delete on dominio.comision_reglas to service_role;
grant select, insert, update, delete on dominio.reparacion_comision_reparto to service_role;
