# Contratos · Tienda SEO, legal y estados (MSF-149)

Todo es **nuevo y aditivo**: no cambia la firma ni el resultado de nada existente. No hay `BREAKING`. `publico.tienda_por_dominio`, `publico.identidad_por_dominio`, `publico.producto_por_dominio` y `publico.catalogo_pagina_por_dominio` se conservan tal cual.

Reglas comunes de las funciones de `publico`: `SECURITY DEFINER`, `stable`, `set search_path = ''`, normalizan `host` con `private.normalizar_host`, devuelven una **lista blanca** de campos, `revoke execute … from public, anon` y `grant execute … to anon, authenticated`. Host desconocido y empresa desactivada devuelven **lo mismo** (`null`), salvo `estado_tienda_por_dominio` (D1). Nunca devuelven `organizacion_id`, costos, existencias, proveedor ni códigos internos.

## Funciones públicas (`publico`, solo funciones, sin tablas)

| Historia | Función |
|---|---|
| F-TDA-19 | `publico.estado_tienda_por_dominio(host text) returns jsonb` |
| F-TDA-20 | `publico.relacionados_por_dominio(host text, producto uuid) returns jsonb` |
| F-TDA-21 | `publico.seo_tienda_por_dominio(host text) returns jsonb` |
| F-TDA-21 | `publico.sitemap_por_dominio(host text) returns jsonb` |
| F-TDA-22 | `publico.legal_por_dominio(host text) returns jsonb` |

### `publico.estado_tienda_por_dominio(host)` (F-TDA-19)

```ts
publico.estado_tienda_por_dominio(host: string): {
  estado: 'pausada'
  nombre: string
  color_primario: string; color_primario_oscuro: string; color_acento: string; color_fondo: string
  tipografia_titulos: string; tipografia_texto: string
  logo_ruta: string | null          // ruta del bucket público `tienda-identidad`
} | null                            // null: host desconocido/inválido o empresa activa
```

### `publico.relacionados_por_dominio(host, producto)` (F-TDA-20)

```ts
publico.relacionados_por_dominio(host: string, producto: string): {
  productos: Array<{ id: string; nombre: string; precio: number | null; disponible: boolean; imagen: string | null; categoria_id: string | null }>
} | null
```

Hasta 4, misma categoría, sin el producto, destacados primero y luego `lower(nombre), id`. `null` idéntico si el dominio/empresa/producto no es válido o visible.

### `publico.seo_tienda_por_dominio(host)` (F-TDA-21)

```ts
publico.seo_tienda_por_dominio(host: string): {
  dominio: string                   // canónico (dominio.tiendas.dominio)
  nombre: string
  descripcion: string               // subtítulo del contenido o «<nombre> · tienda online»
  logo_ruta: string | null
  indexable: true                   // punto de extensión de MSF-133 (borrador / vista previa)
} | null
```

### `publico.sitemap_por_dominio(host)` (F-TDA-21)

```ts
publico.sitemap_por_dominio(host: string): {
  dominio: string
  urls: Array<{ ruta: string; modificado: string | null }>   // /, /catalogo, /contacto, /categoria/:id, /producto/:id (solo visibles), hasta 50000
} | null
```

### `publico.legal_por_dominio(host)` (F-TDA-22)

```ts
publico.legal_por_dominio(host: string): {
  razon_social: string | null
  cuit: string | null               // 11 dígitos; el front lo formatea XX-XXXXXXXX-X
  direccion: string | null
  enlaces: Array<{ titulo: string; url: string }>   // https, por orden
} | null
```

## Tabla (F-TDA-22)

`dominio.tienda_legal_enlaces(id uuid pk, organizacion_id uuid, empresa_id uuid, titulo text ≤ 80, url text ~ '^https://' ≤ 500, orden integer, created_at timestamptz)` — esquema `dominio`, RLS por organización (solo `select` a `authenticated`), sin privilegios para `anon`.

## Edge Function `tienda-seo` (F-TDA-21)

Declarada en `openapi/tienda-seo.json` (OpenAPI 3.1) en el mismo PR que el handler.

```ts
GET /tienda-seo/robots.txt   // cabecera X-Tienda-Host: <host original>  → 200 text/plain
GET /tienda-seo/sitemap.xml  // cabecera X-Tienda-Host: <host original>  → 200 application/xml
```

- Tienda activa: `robots.txt` = `User-agent: *` / `Allow: /` / `Sitemap: https://<dominio canónico>/sitemap.xml`; sitemap con las URLs de `sitemap_por_dominio`.
- Host desconocido, inválido o tienda desactivada: **misma** respuesta, `robots.txt` con `Disallow: /` y `sitemap.xml` válido sin URLs. Nunca 404 distinto ni mensajes que revelen existencia.
- Errores: `500` genérico sin detalles. Sin autenticación (`verify_jwt = false`); lee solo funciones de `publico`.

## Contrato de consentimiento de cookies (F-TDA-22, consumido por F-TDA-24)

```ts
type ConsentimientoCookies = 'aceptadas' | 'rechazadas'
leerConsentimiento(): ConsentimientoCookies | null          // null = sin decisión (equivale a rechazadas)
guardarConsentimiento(valor: ConsentimientoCookies): void   // persiste en localStorage y emite el evento
useConsentimientoCookies(): ConsentimientoCookies | null
// evento de ventana: 'tienda:consentimiento-cookies' (detail: ConsentimientoCookies)
```

## Rutas del front (existentes, sin rutas nuevas con pantalla)

`*` → 404 con buscador (F-TDA-19) · `/producto/:productoId` suma «Productos relacionados» (F-TDA-20) · todas las páginas de la tienda suman `CabeceraSeo` (F-TDA-21) y el pie legal y el aviso de cookies (F-TDA-22).
