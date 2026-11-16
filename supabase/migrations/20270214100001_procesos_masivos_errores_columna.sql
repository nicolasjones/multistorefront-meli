-- MSF-354 (F-IMP-01, RF-IMP-01-3, CA-IMP-01-1): el reporte de errores lleva fila, COLUMNA y motivo, y
-- `registrar_error_proceso_masivo` pasa a ser idempotente también para errores sin fila y pasado el tope
-- de detalle (hallazgos de la revisión retroactiva).
--
-- Definición de los contadores (contrato con el worker):
--   * `procesados` cuenta TODAS las filas leídas, correctas o con error (500 filas con 20 inválidas
--     terminan con procesados = 500).
--   * `con_errores` cuenta las filas rechazadas (una vez cada una, aunque el lote se reintente).
--   * Correctas = procesados - con_errores (CA-IMP-01-1: 480 correctas y 20 con error).
--
-- Idempotencia: la tabla `procesos_masivos_errores_claves` guarda solo una clave determinista por error
-- (`f:<fila>` con fila; `m:<md5 de referencia y motivo>` sin fila). No lleva texto ni datos personales, no
-- tiene tope y por eso detecta el reintento incluso pasadas las 1000 filas de detalle.
--
-- Esquemas (Principio VII): `public`, junto a las tablas del proceso. RLS habilitada sin políticas ni
-- grants (solo las funciones `security definer` la tocan); `anon` sin privilegios.
-- Migración aditiva e idempotente. Reversión (migración posterior):
--   drop function public.registrar_error_proceso_masivo(uuid, integer, text, text, text);
--   drop table public.procesos_masivos_errores_claves;
--   alter table public.procesos_masivos_errores drop column columna;
--   (y volver a crear la función de cuatro argumentos de 20270211100003)

alter table public.procesos_masivos_errores add column if not exists columna text;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'procesos_masivos_errores_columna_largo' and conrelid = 'public.procesos_masivos_errores'::regclass
  ) then
    alter table public.procesos_masivos_errores
      add constraint procesos_masivos_errores_columna_largo check (columna is null or length(columna) <= 120);
  end if;
end $$;

comment on column public.procesos_masivos_errores.columna is
  'F-IMP-01 (RF-IMP-01-3): columna o campo del archivo donde falló la fila (sin valores del usuario). Nulo si el error no es de una columna.';

grant select (columna) on table public.procesos_masivos_errores to authenticated;

create table if not exists public.procesos_masivos_errores_claves (
  proceso_id uuid not null references public.procesos_masivos (id) on delete cascade,
  clave text not null check (length(clave) <= 64),
  primary key (proceso_id, clave)
);

comment on table public.procesos_masivos_errores_claves is
  'F-IMP-01: claves deterministas de los errores ya contados por proceso (idempotencia de registrar_error_proceso_masivo). Sin texto ni datos personales.';

alter table public.procesos_masivos_errores_claves enable row level security;
revoke all on table public.procesos_masivos_errores_claves from public, anon, authenticated;

-- Los errores con fila ya registrados cuentan como vistos.
insert into public.procesos_masivos_errores_claves (proceso_id, clave)
select e.proceso_id, 'f:' || e.fila
from public.procesos_masivos_errores e
where e.fila is not null
on conflict do nothing;

-- Firma nueva (con `p_columna`): se retira la de cuatro argumentos.
drop function if exists public.registrar_error_proceso_masivo(uuid, integer, text, text);

create or replace function public.registrar_error_proceso_masivo(
  p_proceso_id uuid,
  p_fila integer,
  p_referencia text,
  p_motivo text,
  p_columna text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_tope constant integer := 1000;
  v_p public.procesos_masivos;
  v_motivo text := private.sanitizar_motivo_proceso(p_motivo);
  v_referencia text := left(private.sanitizar_motivo_proceso(p_referencia, false), 200);
  v_columna text := nullif(left(private.sanitizar_motivo_proceso(p_columna, false), 120), '');
  v_clave text;
  v_nuevo integer;
begin
  v_p := private.autorizar_worker_proceso(p_proceso_id);
  if v_p.estado not in ('pendiente', 'en_curso') then
    raise exception 'PROCESO_TERMINADO: el proceso ya terminó' using errcode = 'P0001';
  end if;
  if v_motivo = '' then
    raise exception 'ARGUMENTO_INVALIDO: el motivo es obligatorio' using errcode = '22023';
  end if;
  if p_fila is not null and p_fila < 0 then
    raise exception 'ARGUMENTO_INVALIDO: la fila no puede ser negativa' using errcode = '22023';
  end if;

  -- Idempotente: con fila, por (proceso, fila); sin fila, por (referencia, motivo). Un reintento del lote
  -- no suma a con_errores ni duplica el detalle, aunque ya se haya pasado el tope de detalle.
  v_clave := case when p_fila is not null then 'f:' || p_fila
                  else 'm:' || md5(coalesce(v_referencia, '') || '|' || v_motivo) end;
  insert into public.procesos_masivos_errores_claves (proceso_id, clave)
  values (p_proceso_id, v_clave)
  on conflict do nothing;
  get diagnostics v_nuevo = row_count;
  if v_nuevo = 0 then
    return;
  end if;

  if (select count(*) from public.procesos_masivos_errores e where e.proceso_id = p_proceso_id) < c_tope then
    insert into public.procesos_masivos_errores (proceso_id, organizacion_id, fila, referencia, columna, motivo_sanitizado)
    values (p_proceso_id, v_p.organizacion_id, p_fila, v_referencia, v_columna, v_motivo)
    on conflict do nothing;
  end if;

  update public.procesos_masivos
  set con_errores = con_errores + 1,
      estado = 'en_curso',
      iniciado_en = coalesce(iniciado_en, clock_timestamp())
  where id = p_proceso_id;
end;
$$;

comment on function public.registrar_error_proceso_masivo(uuid, integer, text, text, text) is
  'F-IMP-01 (FR-006): error por fila (fila, referencia, columna, motivo) sanitizado en la base. Idempotente por fila o, sin fila, por referencia y motivo. Guarda hasta 1000 detalles por proceso; con_errores cuenta todos una sola vez. Solo el worker de la organización dueña.';

revoke execute on function public.registrar_error_proceso_masivo(uuid, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.registrar_error_proceso_masivo(uuid, integer, text, text, text) to workers_orquestacion;
