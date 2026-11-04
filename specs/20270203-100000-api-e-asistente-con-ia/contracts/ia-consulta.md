# Contrato · Fuentes de consulta del asistente (F-IA-01)

Vistas de solo lectura registradas en `fuentes_chat_ia` y `fuentes_mcp`. Todas llevan `organizacion_id`; el filtro lo arma `private.mcp_leer_fila` dentro del SQL. Columnas definitivas se fijan en T013 a partir de las tablas reales (no se inventan acá).

```ts
ia_consulta_catalogo(organizacion_id, producto_id, nombre, sku, categoria, estado)
ia_consulta_stock(organizacion_id, producto_id, deposito, disponible)
ia_consulta_precios(organizacion_id, producto_id, precio_venta, moneda, vigente_desde)
ia_consulta_ventas(organizacion_id, comprobante_id, fecha, total, estado)
```

Excluidos por defecto (D-7): costos, márgenes y datos de contacto de clientes. Capacidades: `lectura = true`, `ejecucion = false`.

BREAKING: ninguno (objetos nuevos).
