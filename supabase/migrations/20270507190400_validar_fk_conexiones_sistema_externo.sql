-- MSF-923 (lote 33): `conexiones_sistema_externo_fkey` (20260930170144) quedó `NOT VALID` a propósito: el catálogo
-- `sistemas_externos` empezaba vacío y la migración no podía fallar por filas de negocio preexistentes. Una FK NOT VALID rige para
-- las escrituras nuevas pero el planner no puede asumirla y las filas viejas no están garantizadas.
--
-- Esta migración la valida SOLO si los datos lo permiten: cuenta los huérfanos (conexiones cuyo sistema_externo no está en el
-- catálogo). Si no hay, `validate constraint` (toma SHARE UPDATE EXCLUSIVE: no bloquea lecturas ni escrituras). Si hay, NO borra ni
-- modifica nada: deja un aviso con la cantidad y los valores (`raise warning`) y la FK sigue NOT VALID; reparar a mano (cargar el
-- sistema faltante en `sistemas_externos` o corregir la conexión, ver docs/higiene-base-datos.md) y re-ejecutar el bloque.
--
-- Migración aditiva. Reversión (migración posterior): no hay nada destructivo que revertir; para volver al estado anterior:
--   alter table public.conexiones drop constraint conexiones_sistema_externo_fkey;
--   alter table public.conexiones add constraint conexiones_sistema_externo_fkey
--     foreign key (sistema_externo) references public.sistemas_externos (id) not valid;

do $$
declare
  v_validada boolean;
  v_huerfanos integer;
  v_valores text;
begin
  select convalidated into v_validada
    from pg_constraint
   where conrelid = 'public.conexiones'::regclass and conname = 'conexiones_sistema_externo_fkey';

  if v_validada is null or v_validada then
    return; -- no existe (otro entorno) o ya validada: no-op idempotente
  end if;

  select count(*), string_agg(distinct c.sistema_externo::text, ', ')
    into v_huerfanos, v_valores
    from public.conexiones c
   where c.sistema_externo is not null
     and not exists (select 1 from public.sistemas_externos s where s.id = c.sistema_externo);

  if v_huerfanos = 0 then
    alter table public.conexiones validate constraint conexiones_sistema_externo_fkey;
  else
    raise warning 'MSF-923: conexiones_sistema_externo_fkey sigue NOT VALID: % conexiones con sistema_externo fuera del catálogo (%). No se modificó ningún dato.', v_huerfanos, v_valores;
  end if;
end
$$;
