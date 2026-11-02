# Contrato: rentabilidad real y reportes de ventas

Épica MSF-192 · spec `rentabilidad-real-y-reportes-de-ventas`. Lo nuevo es aditivo; el único cambio sobre algo existente es la semántica de `margen`.

BREAKING: `analitica.margen_producto_canal.margen` y `margen_pct` ahora descuentan `costos_adicionales` (F-REN-08); sin costos activos los valores son idénticos a los de MSF-120. La firma de columnas solo suma `costos_adicionales` al final.

## RPC (esquema `public`, F-REN-08)

```ts
listar_costos_adicionales(p_empresa_id uuid | null): table(id, empresa_id, empresa_nombre, nombre, tipo, valor, creado_en) // solo activos
guardar_costo_adicional(p_id uuid | null, p_empresa_id uuid, p_nombre text, p_tipo 'porcentaje' | 'monto', p_valor numeric): dominio.costos_adicionales_canal
dar_baja_costo_adicional(p_id uuid): void // idempotente
```

Errores: `42501` sin permiso o empresa no accesible, `23514` dato inválido (nombre vacío o > 80, tipo, valor negativo, porcentaje > 100, > 4 decimales), `23505` nombre repetido entre costos activos de la empresa, `P0002` el costo no existe (o ya fue dado de baja al editar). Un costo no cambia de empresa al editarse. La baja es `activo = false`.

Exigen `edicion` en `rentabilidad` (la lista, `lectura`) y empresa accesible; `revoke … from public, anon`, `grant execute … to authenticated`. `public.confirmar_comprobante(p_id uuid)` conserva su firma (F-REN-09).

## Tabla y columnas

```ts
dominio.costos_adicionales_canal(id: uuid, organizacion_id: uuid, empresa_id: uuid, nombre: text, tipo: 'porcentaje' | 'monto', valor: numeric, activo: boolean, creado_en: timestamptz)
dominio.comprobantes_venta_lineas(+ costo_unitario: numeric | null, + cotizacion: numeric | null)
```

## Vistas (esquema `analitica`, solo lectura para el rol de Superset)

```ts
analitica.margen_producto_canal(... , costos_adicionales: numeric) // por unidad: % × neto + montos
analitica.costos_adicionales_de(p_empresa_id uuid, p_neto numeric): numeric // security definer, solo activos
analitica.rentabilidad_ventas_real(organizacion_id, empresa_id, empresa_nombre, producto_id, producto_nombre, sku, fecha, unidades, vendido, costo, costos_adicionales, margen, margen_pct, estado)
analitica.consultas_producto_mas_consultado(organizacion_id, empresa_id, empresa_nombre, producto_id, producto_nombre, sku, fecha, consultas)
analitica.ventas_periodo_canal(organizacion_id, empresa_id, empresa_nombre, fecha, comprobantes, unidades, facturado)
```

Reglas: «venta» = `analitica.comprobante_cuenta_como_facturado`, con `analitica.signo_comprobante`; `facturado` es con IVA (igual a `total_con_iva`); `rentabilidad_ventas_real` usa el costo y la cotización guardados en la línea y excluye líneas sin costo; ninguna vista de reportes expone costo ni margen. Cada vista expone `organizacion_id` (y `empresa_id`) para la cláusula `rls` del guest token.
