# Fix: msf-642 — restaurar descuento por cliente (épica MSF-232)

Aplicado sobre la rama de la épica (`epic/MSF-232-...`, PR #519), donde viven las migraciones que pisaban MSF-340.

- `20270121120200_lineas_sin_stock.sql` (`guardar_lineas_comprobante`): lee `coalesce(cl.descuento,0)` como `v_descuento`,
  `v_unitario = coalesce(v_manual, round(neto * (1 - v_descuento/100), 2))` e inserta `descuento_pct`
  (`case when v_manual is null then v_descuento else 0 end`). Lógica sin_stock intacta.
- `20270121120500_obtener_comprobante_origen.sql` (`obtener_comprobante`): cada línea suma `'descuento_pct'`.
- Cabeceras/reversión: apuntan a `20270115090100` en vez del cuerpo previo a MSF-340.
- Sin migración nueva (aún no están en `dokploy`); sin cambios de políticas ni permisos.

Nota de alcance: el código de la corrección vive en `origin/epic/MSF-232-service-tecnico-service-cobro-y-avisos` (commits 4b76854d y 66cfcf07),
porque las migraciones de MSF-232 no existen en esta rama. Esta rama solo aporta la documentación del bug; la plan.md de la épica
(`specs/20261028-100000-service-cobro-y-avisos/plan.md`) tampoco existe aquí y su nota quedó en el commit 66cfcf07 de la épica.
