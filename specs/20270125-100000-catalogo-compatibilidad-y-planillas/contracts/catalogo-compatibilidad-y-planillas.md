# Contratos: Catálogo · Catálogo compatibilidad y planillas

Todas las RPC viven en `public`, son `security definer` con `search_path = ''`, toman organización y actor de la sesión (nunca de un argumento) y declaran `revoke execute … from public, anon` + `grant execute … to authenticated`. Todo es nuevo salvo la vista, que solo agrega una columna al final (no cambia ninguna firma existente).

## F-CAT-09

```ts
listar_compatibles() returns text[]   // valores distintos de compatible_con de la organización, ordenados
```

Vista `public.v_productos_listado`: se agrega `compatible_con text[]` como **última** columna.

## F-CAT-10

```ts
validar_importacion_productos(
  p_filas jsonb   // [{ fila, sku, nombre, categoria, costo, precio_x1, precio_x5, precio_x10, precio_x50, proveedor, codigo_barras, tiendas, imagenes }], hasta 2000
) returns { fila: integer, sku: text, accion: 'nuevo'|'actualiza', estado: 'ok'|'aviso'|'error', mensaje: text }[]
```

```ts
solicitar_importacion_productos(
  p_filas jsonb,
  p_clave uuid default gen_random_uuid()   // idempotencia: misma clave => misma importación, sin encolar de nuevo
) returns { importacion_id: uuid, estado: 'en_cola', importables: integer, omitidas: integer }
```

```ts
obtener_importacion_productos(p_importacion_id uuid)
  returns { estado: 'en_cola'|'aplicando'|'terminada'|'fallida', procesadas: integer, omitidas: integer,
            errores: { fila: integer, sku: text, mensaje: text }[] }
```

Errores: `42501` sin sesión o sin ser Administrador; `22023` más de 2000 filas o `p_filas` mal formado. Un reintento con la misma `p_clave` devuelve la importación ya creada. El costo se ignora (con aviso) si el actor no tiene `rentabilidad` en `edicion`.

Del lado del worker (rol `worker_*`, no ejecutable por `authenticated`): las RPC de aplicación por fila y de cierre de la importación se declaran en la migración de F-CAT-10 con su firma y se agregan acá en la misma tarea.

## F-CAT-11

```ts
exportar_productos(
  p_filtros jsonb,        // { busqueda, categoria_id, estado, empresa_id, compatible: text[], todos: boolean }
  p_columnas text[],      // sku, nombre, categoria, precio, costo, stock, visible_en, estado, codigo_barras, proveedor
  p_desde uuid default null,  // cursor por id (paginación estable)
  p_limite integer default 500
) returns { filas: jsonb[], siguiente: uuid|null, total: integer }
```

Errores: `42501` sin Administrador o con `costo`/`proveedor` sin Rentabilidad; `22023` columna desconocida o `p_limite` fuera de 1…1000.

## OpenAPI

No se crean ni cambian Edge Functions.
