# Contratos · Migración inicial de datos

Todas son RPC nuevas en `public`: `security definer`, `set search_path = ''`, `revoke ... from public, anon`, `grant execute ... to authenticated`; validan rol Administrador y organización de la sesión.

```ts
iniciar_carga_migracion(p_entidad text, p_archivo text, p_filas_total integer): uuid
aplicar_lote_clientes(p_carga uuid, p_lote integer, p_filas jsonb): jsonb // { nuevos, actualizados, errores: [{fila, motivo}] }
aplicar_lote_proveedores(p_carga uuid, p_lote integer, p_filas jsonb): jsonb
aplicar_lote_vinculos_proveedor_producto(p_carga uuid, p_lote integer, p_filas jsonb): jsonb
aplicar_lote_archivo_ingresos(p_carga uuid, p_lote integer, p_filas jsonb): jsonb
cerrar_carga_migracion(p_carga uuid): jsonb // informe de conciliación
informe_conciliacion_migracion(p_carga uuid): jsonb
```

Tablas nuevas: `public.migracion_cargas`, `public.migracion_filas`, `dominio.archivo_ingresos_mercaderia`; columna nueva `dominio.proveedores.id_externo`. Sin cambios de firma de RPC existentes (sin BREAKING).
