-- F-INI-07 (MSF-823, épica MSF-824, spec 20270305-100000-inicio-tablero-completo, FR-020):
-- `public.aplicar_cotizacion`: carga Y confirma el dólar en UNA transacción. El diálogo de Inicio mostraba el
-- impacto con `previsualizar_impacto_dolar` (sin escribir) y al confirmar llamaba `cargar_cotizacion` y luego
-- `confirmar_cotizacion`: si la segunda fallaba (o se cortaba la red entre las dos) quedaba una cotización
-- PENDIENTE huérfana. Con esta función o se aplica todo o no se escribe nada.
--
-- Esquema (Principio VII): función en `public`; SIN tablas nuevas. No duplica reglas: delega en las dos funciones
-- vigentes, que siguen validando permiso (edición de `cotizacion_dolar`), valor, variación inusual
-- (`p_variacion_vista`) y escriben el historial con fecha y usuario. Al ser una sola función, el error de la
-- confirmación revierte la carga (misma transacción).
-- Aislamiento: `SECURITY DEFINER` con `search_path` vacío; la autorización la hacen adentro las funciones
-- delegadas (42501 sin edición); `anon` no ejecuta.
--
-- Migración aditiva. Reversión: drop function public.aplicar_cotizacion(numeric,uuid,numeric);

create or replace function public.aplicar_cotizacion(
  p_valor numeric,
  p_empresa uuid default null,
  p_variacion_vista numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.cargar_cotizacion(p_valor, p_empresa);
  return public.confirmar_cotizacion(p_empresa, p_variacion_vista);
end;
$$;

comment on function public.aplicar_cotizacion(numeric, uuid, numeric) is
  'F-INI-07: carga y confirma el dólar en una sola transacción (sin pendiente huérfana si falla la confirmación). Mismas reglas y errores que cargar_cotizacion y confirmar_cotizacion.';

revoke execute on function public.aplicar_cotizacion(numeric, uuid, numeric) from public, anon;
grant execute on function public.aplicar_cotizacion(numeric, uuid, numeric) to authenticated;
