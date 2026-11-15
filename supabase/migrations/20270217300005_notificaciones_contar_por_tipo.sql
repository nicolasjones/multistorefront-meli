-- MSF-378 (revisión retroactiva): `contar_notificaciones_sin_leer` evaluaba `private.nivel_seccion_de_usuario` POR FILA
-- (join con `tipos_aviso`), mientras `listar_notificaciones` la evalúa una vez por TIPO de aviso: la misma regla
-- implementada dos veces y de forma distinta, con una carga que crece con los avisos acumulados y se repite cada 60 s
-- por pestaña abierta. Ahora el conteo usa el mismo criterio que la lista (una evaluación por tipo).
-- Mismo contrato: mismos filtros, mismo tipo de retorno y mismos privilegios (`create or replace` los conserva).
--
-- Migración aditiva. Reversión (migración posterior): volver a la definición de
-- `20270217300002_notificaciones_funciones.sql` (`create or replace` con el join por fila).

create or replace function public.contar_notificaciones_sin_leer()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  -- Mismo criterio que `listar_notificaciones`: el acceso se evalúa una vez por TIPO de aviso (una decena de filas), no
  -- por cada aviso acumulado. Este conteo corre cada 60 s por pestaña abierta.
  with visibles as (
    select t.clave
    from public.tipos_aviso t
    where auth.uid() is not null
      and private.nivel_seccion_de_usuario(auth.uid(), t.seccion) <> 'ninguno'
  )
  select count(*)::int
  from public.avisos_pendientes a
  where auth.uid() is not null
    and a.user_id = auth.uid()
    and a.organizacion_id = private.organizacion_id()
    and a.estado <> 'descartado'
    and a.leido_en is null
    and a.tipo_aviso in (select clave from visibles);
$$;

comment on function public.contar_notificaciones_sin_leer() is
  'Cantidad de avisos propios sin leer (mismos filtros que listar_notificaciones; el acceso por sección se evalúa una vez por tipo).';
