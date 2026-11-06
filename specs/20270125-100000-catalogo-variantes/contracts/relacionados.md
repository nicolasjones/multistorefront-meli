# Contrato: productos relacionados (F-CAT-18)

Tabla en `dominio`; RPC y vista en `public` (Principio VII).

## `guardar_relacionados(p_producto, p_relacionados)`

```ts
guardar_relacionados(
  p_producto: uuid,
  p_relacionados: uuid[]   // ids de productos relacionados; el orden del arreglo es el orden que ve el cliente
): jsonb                   // { relacionados: [{ id, orden }] }
```

- `security invoker` (rige RLS); exige `edicion` en `productos`; `grant execute … to authenticated`, `revoke … from public, anon`.
- Reemplazo completo e idempotente de la lista del producto. Errores: `P0002` (producto o relacionado inexistente/otra organización), `22023` (el propio producto o un id repetido), `42501`.
- Evento: `producto.relacionados_editados` en `registro_actividad`, solo con cambio real.

## `v_producto_relacionados` (lectura)

```ts
v_producto_relacionados: { producto_id, relacionado_id, orden, nombre, sku, categoria, precio, moneda, activo }
```

`security_invoker = true`; ordenada por `orden`; `revoke … from public, anon`; `grant select … to authenticated`. Es el punto de enlace para la ficha pública y los comprobantes (specs propias; ver `spec.md`, Decisión 1).
