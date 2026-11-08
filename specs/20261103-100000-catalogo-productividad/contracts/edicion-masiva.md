# Contratos: edición masiva (F-CAT-12)

Tres RPC nuevas en `public` (`security invoker`, `set search_path = ''`, `revoke … from public, anon`, `grant execute … to authenticated`). Todas exigen `edicion` en `productos`, aceptan de 1 a 100 ids, son atómicas e idempotentes y devuelven la cantidad de productos que **cambiaron de verdad**. Errores: `42501` sin permiso; `22023` lista vacía o nula, más de 100 ids **recibidos** (el tope se mide antes de quitar repetidos), ids nulos, empresa inexistente o de otra organización (igual que la RPC individual; se valida antes de bloquear los productos, así que gana sobre un producto inexistente) o argumentos inválidos; `P0002` producto o categoría inexistente o de otra organización.

```ts
mover_productos_categoria(p_producto_ids: uuid[], p_categoria_id: uuid): integer
cambiar_estado_productos(p_producto_ids: uuid[], p_activo: boolean): integer
definir_empresas_productos(p_producto_ids: uuid[], p_agregar: uuid[], p_quitar: uuid[]): integer
```

- `mover_productos_categoria` llama por producto a `asignar_categoria_producto` (evento `producto.categoria_asignada` solo ante cambio real). `p_categoria_id` es obligatorio.
- `cambiar_estado_productos` llama por producto a `cambiar_estado_producto` (eventos `producto.activado` / `producto.desactivado`).
- `definir_empresas_productos`: el resultado por producto es `(actuales ∪ p_agregar) − p_quitar`, aplicado con `definir_empresas_producto` (evento `producto.empresas_actualizadas`). Una empresa en ambas listas, o ambas vacías, es `22023`.

Sin cambios de firma en RPC existentes (no hay `BREAKING`). «Duplicar» no crea contrato: usa `crear_producto` sin cambios.
