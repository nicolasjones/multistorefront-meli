# Contratos · Tienda inicio búsqueda móvil (MSF-191)

Todo es **nuevo y aditivo**: no cambia la firma ni el resultado de nada existente. No hay `BREAKING`.
`publico.catalogo_pagina_por_dominio(...)` (MSF-167) y `publico.catalogo_visible_por_dominio(host)` (MSF-147) **se conservan tal cual**.

Reglas comunes de las funciones de `publico`: `SECURITY DEFINER`, `stable` (salvo las que cuentan el límite, que escriben en `public.limite_pedidos_publicos`: `volatile`), `set search_path = ''`, normalizan `host` con `private.normalizar_host`, filtran por `dominio.empresas.activa`, devuelven una **lista blanca** de campos, `revoke execute … from public, anon` y `grant execute … to anon, authenticated`. Host desconocido y empresa desactivada devuelven **lo mismo** (`null`). Nunca devuelven `organizacion_id`, costos, existencias, proveedor ni códigos internos.

## Funciones públicas (`publico`, solo funciones, sin tablas)

| Historia | Función |
|---|---|
| F-TDA-10 | `publico.destacados_por_dominio(host text) returns jsonb` |
| F-TDA-15 | `publico.sugerencias_busqueda_por_dominio(host text, q text) returns jsonb` |
| F-TDA-15 | `publico.busqueda_pagina_por_dominio(host text, q text, categoria uuid default null, solo_con_stock boolean default false, precio_max numeric default null, orden text default 'relevancia', pagina integer default 1) returns jsonb` |

### `publico.destacados_por_dominio(host)` (F-TDA-10)

```ts
publico.destacados_por_dominio(host: string): {
  hay_productos: boolean            // la tienda tiene al menos un producto efectivamente visible
  productos: Array<{ id: string; nombre: string; precio: number | null; disponible: boolean; imagen: string | null; categoria_id: string | null }>
} | null
```

Hasta 8 productos destacados y efectivamente visibles (`private.catalogo_tienda_efectivo`), en el orden de MSF-147. `precio` = `private.precio_final_publico` (pesos enteros, `null` si no es calculable). `disponible` = `private.disponible_publico` (solo booleano).

### `publico.sugerencias_busqueda_por_dominio(host, q)` (F-TDA-15)

```ts
publico.sugerencias_busqueda_por_dominio(host: string, q: string): {
  limitado: boolean                 // true si el visitante superó el límite del minuto
  espera_segundos: number | null    // segundos hasta poder volver a buscar (solo si limitado)
  productos: Array<{ id: string; nombre: string; precio: number | null; disponible: boolean; imagen: string | null; categoria_id: string | null }>
} | null
```

Hasta 6 productos efectivamente visibles de la tienda cuyo nombre coincide con `q` ignorando mayúsculas y tildes (`private.normalizar_busqueda`) y con tolerancia a errores de tipeo (similitud `pg_trgm` sobre un umbral único). `q` se recorta a 100 caracteres; vacía o de menos de 2 caracteres → `productos: []` sin contar para el límite. Consulta parametrizada (los comodines `%`/`_` y las comillas son texto literal). Si `limitado`, `productos: []`.

### `publico.busqueda_pagina_por_dominio(...)` (F-TDA-15)

```ts
publico.busqueda_pagina_por_dominio(
  host: string, q: string, categoria?: string | null, solo_con_stock?: boolean,
  precio_max?: number | null, orden?: 'relevancia' | 'precio_asc' | 'precio_desc', pagina?: number
): {
  limitado: boolean; espera_segundos: number | null;
  total: number; pagina: number; tamano: 24;
  categorias: Array<{ id: string; nombre: string; padre_id: string | null; productos: number }>;
  productos: Array<{ id: string; nombre: string; precio: number | null; disponible: boolean; imagen: string | null; categoria_id: string | null; destacado: boolean }>
} | null
```

Misma forma, filtros, normalización de parámetros y lista blanca que `catalogo_pagina_por_dominio`, restringida a los productos que coinciden con `q`. `orden = 'relevancia'` ordena por similitud con `q` (desempate por nombre e id). Cuenta para el mismo límite por visitante y minuto. Si `limitado`, `productos: []` y `total: 0`.

## Funciones internas (`private`, sin acceso de roles de API)

| Historia | Función | Uso |
|---|---|---|
| F-TDA-15 | `private.normalizar_busqueda(texto text) returns text` (`immutable`; minúsculas, sin tildes, espacios colapsados) | Índice trigrama y comparación de la búsqueda. |
| F-TDA-15 | `private.registrar_pedido_publico(visitante text, limite integer) returns jsonb` → `{ limitado: boolean, espera_segundos: number }` | Cuenta el pedido en `public.limite_pedidos_publicos` (atómico) y purga ventanas de más de 10 minutos. |

`revoke execute … from public, anon, authenticated` en ambas.

## Tabla nueva (`public`)

```ts
public.limite_pedidos_publicos {
  visitante: string        // hash (sha256) de la IP del proxy + host; nunca la IP
  ventana: string          // timestamptz truncado al minuto
  pedidos: number
}  // PK (visitante, ventana) · RLS activada, sin políticas · sin privilegios para anon/authenticated
```

## Constantes únicas

`LIMITE_BUSQUEDAS_POR_MINUTO = 30` (D1), mínimo de caracteres = 2 (D4), tope de sugerencias = 6, tope de destacados = 8 (D7), tamaño de página = 24 (MSF-167). Cada una vive en un solo lugar de la base o del front.

## Front (`apps/web/src/pages/tienda-publica/`)

| Ruta / URL | Comportamiento |
|---|---|
| `/` | Banner + «Categorías» + «Destacados» (F-TDA-10). |
| `/catalogo?q=<texto>&categoria&stock&max&orden&pagina` | Con `q`: resultados de búsqueda con los filtros del catálogo; sin `q`: catálogo de MSF-167 (F-TDA-15). |
