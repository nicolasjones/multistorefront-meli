# Fix: msf-642 — restaurar descuento por cliente (épica MSF-232)

Aplicado sobre la rama de la épica (`epic/MSF-232-...`, PR #519), donde viven las migraciones que pisaban MSF-340.

- `20270121120200_lineas_sin_stock.sql` (`guardar_lineas_comprobante`): lee `coalesce(cl.descuento,0)` como `v_descuento`,
  `v_unitario = coalesce(v_manual, round(neto * (1 - v_descuento/100), 2))` e inserta `descuento_pct`
  (`case when v_manual is null then v_descuento else 0 end`). Lógica sin_stock intacta.
- `20270121120500_obtener_comprobante_origen.sql` (`obtener_comprobante`): cada línea suma `'descuento_pct'`.
- Cabeceras/reversión: apuntan a `20270115090100` en vez del cuerpo previo a MSF-340.
- Sin migración nueva (aún no están en `dokploy`); sin cambios de políticas ni permisos.
