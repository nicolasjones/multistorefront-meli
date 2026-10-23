# Contratos · Tienda catálogo y ficha (MSF-167)

Todo es **nuevo y aditivo**: no cambia la firma ni el resultado de nada existente. No hay `BREAKING`.
`publico.catalogo_visible_por_dominio(host)` (MSF-147) **se conserva tal cual**.

Reglas comunes de las funciones de `publico`: `SECURITY DEFINER`, `stable`, `set search_path = ''`,
normalizan `host` con `private.normalizar_host`, filtran por `dominio.empresas.activa`, devuelven una
**lista blanca** de campos, `revoke execute … from public` y `grant execute … to anon, authenticated`.
Host desconocido y empresa desactivada devuelven **lo mismo** (`null`). Nunca devuelven
`organizacion_id`, costos, existencias, proveedor ni códigos internos.

## Funciones públicas (`publico`, solo funciones, sin tablas)

| Historia | Función |
|---|---|
| F-TDA-11 | `publico.categorias_por_dominio(host text) returns jsonb` |
| F-TDA-12 | `publico.catalogo_pagina_por_dominio(host text, categoria uuid default null, solo_con_stock boolean default false, precio_max numeric default null, orden text default 'relevancia', pagina integer default 1) returns jsonb` |
| F-TDA-13 | `publico.producto_por_dominio(host text, producto uuid) returns jsonb` |

### `publico.categorias_por_dominio(host)`

```ts
publico.categorias_por_dominio(host: string): {
  categorias: Array<{ id: string; nombre: string; padre_id: string | null; productos: number }>
} | null
```

Categorías **visibles** (misma regla que MSF-147: la categoría y su padre), en el orden de Catálogo
(raíces primero, luego por posición). `productos` cuenta solo productos **efectivamente visibles**.

### `publico.catalogo_pagina_por_dominio(...)`

```ts
publico.catalogo_pagina_por_dominio(
  host: string, categoria?: string | null, solo_con_stock?: boolean,
  precio_max?: number | null, orden?: 'relevancia' | 'precio_asc' | 'precio_desc', pagina?: number
): {
  total: number; pagina: number; tamano: 24;
  categorias: Array<{ id: string; nombre: string; padre_id: string | null; productos: number }>;
  productos: Array<{
    id: string; nombre: string; precio: number | null; disponible: boolean;
    imagen: string | null; categoria_id: string | null; destacado: boolean
  }>
} | null
```

`precio` = precio final en pesos enteros de la empresa (IVA según su interruptor); `null` si no se puede
calcular. `orden` desconocido → `relevancia`; `pagina` < 1 → 1; página fuera de rango → lista vacía con
`total` real; `precio_max` ≤ 0 o nulo → sin límite.

### `publico.producto_por_dominio(host, producto)`

```ts
publico.producto_por_dominio(host: string, producto: string): {
  id: string; nombre: string; descripcion: string | null; sku: string | null;
  categoria: { id: string; nombre: string } | null;
  precio: number | null; disponible: boolean;
  compatibilidad: string | null;
  imagenes: Array<{ posicion: number; ruta: string }>
} | null
```

`null` cuando el producto no existe, está inactivo, oculto, con categoría oculta o es de otra empresa
(misma respuesta en los cinco casos).

## Funciones internas (`private`, sin acceso a `anon`/`authenticated`)

| Historia | Función |
|---|---|
| F-TDA-18 | `private.disponible_publico(p_producto uuid) returns boolean` |
| F-TDA-12 | `private.precio_final_publico(p_producto uuid, p_empresa uuid) returns numeric` |
| F-TDA-12 | `private.imagen_publica(p_ruta text) returns boolean` |

- `disponible_publico`: `true` si hay existencias disponibles (hoy `existencias.cantidad > 0`, mismo criterio
  que `private.productos_con_stock()`); devuelve solo el booleano.
- `precio_final_publico`: compone `a_pesos` → `aplicar_regla_precio` → `aplicar_iva` con la alícuota de
  `private.alicuota_producto` (las mismas fórmulas únicas de `private.precio_para`, sin la guardia de sesión).
- `imagen_publica`: `true` si la ruta es una imagen de un producto efectivamente visible de una tienda activa;
  respalda la política de lectura de `anon` (ver D1).

## Rutas del front público (`apps/web`)

`/` (existente, MSF-147) · `/catalogo` · `/categoria/:categoriaId` · `/producto/:productoId` · `*` (404 amable).
Query de `/catalogo` y `/categoria/:categoriaId`: `stock=1`, `max=<pesos>`, `orden=<relevancia|precio_asc|precio_desc>`, `pagina=<n>`
(y `categoria=<id>` en `/catalogo`).
