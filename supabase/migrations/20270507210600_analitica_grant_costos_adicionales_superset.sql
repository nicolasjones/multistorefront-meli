-- Rentabilidad · Ventas reales no carga en Superset: «permission denied for function costos_adicionales_de».
--
-- `analitica.rentabilidad_ventas_real` (y las vistas de margen que heredan de `margen_costos_adicionales`) llaman a
-- `analitica.costos_adicionales_de(uuid, numeric)`. La migración 20270202201002 la creó con
-- `revoke execute ... from public, anon, authenticated` pero nunca le dio el permiso al rol de Superset, a diferencia de
-- las demás funciones de `analitica` que consumen las vistas. Con una conexión como `superset_analitica` la vista falla.
--
-- Migración aditiva. Reversión: revoke execute on function analitica.costos_adicionales_de(uuid, numeric) from superset_analitica;

grant execute on function analitica.costos_adicionales_de(uuid, numeric) to superset_analitica;
