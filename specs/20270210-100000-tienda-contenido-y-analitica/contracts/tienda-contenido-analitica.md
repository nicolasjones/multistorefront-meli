# Contratos · Tienda contenido y analítica (MSF-164)

Todo es **nuevo y aditivo**: no cambia la firma ni el resultado de nada existente. No hay `BREAKING`. No hay Edge Function ni `openapi/`.

Reglas comunes de las funciones de `publico`: `SECURITY DEFINER`, `stable`, `set search_path = ''`, normalizan `host` con `private.normalizar_host`, devuelven una **lista blanca**, `revoke execute … from public, anon` y `grant execute … to anon, authenticated`. Host desconocido y empresa desactivada devuelven **lo mismo** (`null`). Nunca devuelven `organizacion_id` ni ids internos.

Reglas comunes de las RPC de `public`: `SECURITY DEFINER`, `set search_path = ''`, exigen `private.nivel_seccion('empresas') = 'edicion'` y que la empresa sea de la organización (`private.organizacion_id()`), `revoke execute … from public, anon` y `grant execute … to authenticated`. El `hint` del error nombra el campo inválido.

## Funciones públicas (`publico`)

| Historia | Función |
|---|---|
| F-TDA-23 | `publico.paginas_por_dominio(host text) returns jsonb` |
| F-TDA-23 | `publico.pagina_por_dominio(host text, slug text) returns jsonb` |
| F-TDA-24 | `publico.analitica_por_dominio(host text) returns jsonb` |

### `publico.paginas_por_dominio(host)` (F-TDA-23)

```ts
publico.paginas_por_dominio(host: string): {
  paginas: Array<{ titulo: string; slug: string }>   // solo visibles, orden por lower(titulo), slug
} | null                                              // null: host desconocido/inválido o empresa desactivada
```

### `publico.pagina_por_dominio(host, slug)` (F-TDA-23)

```ts
publico.pagina_por_dominio(host: string, slug: string): {
  titulo: string; slug: string; contenido: string     // texto plano
} | null                                              // null idéntico: desconocido, desactivada, slug inexistente/oculto/ajeno
```

### `publico.analitica_por_dominio(host)` (F-TDA-24)

```ts
publico.analitica_por_dominio(host: string): {
  ga4_id: string | null; meta_pixel_id: string | null
} | null                                              // null: host desconocido/inválido o empresa desactivada
```

## RPC del panel (`public`)

| Historia | RPC |
|---|---|
| F-TDA-23 | `public.guardar_pagina_tienda(p_empresa_id uuid, p_pagina_id uuid, p_titulo text, p_contenido text, p_visible boolean) returns dominio.tienda_paginas` |
| F-TDA-23 | `public.eliminar_pagina_tienda(p_empresa_id uuid, p_pagina_id uuid) returns void` |
| F-TDA-24 | `public.guardar_analitica_tienda(p_empresa_id uuid, p_ga4_id text, p_meta_pixel_id text) returns dominio.tienda_analitica` |

`guardar_pagina_tienda`: `p_pagina_id = null` crea (visible por defecto `false` si `p_visible` es `null`); si no, edita. El `slug` se genera solo al crear y no cambia después.

## Cliente (front, sin red propia)

```ts
// apps/web/src/lib/analiticaTienda.ts (F-TDA-24)
registrarEventoTienda(nombre: 'clic_whatsapp' | 'envio_contacto'): void   // no-op si no hay medición cargada

// apps/web/src/lib/enlaceProducto.ts (F-TDA-25)
enlaceProducto(productoId: string): string   // `${origen del Host}/producto/${productoId}`
```

## Dependencia de contrato (MSF-149)

F-TDA-24 consume `leerConsentimiento(): 'aceptadas' | 'rechazadas' | null`, `useConsentimientoCookies()` y el evento de cambio de `lib/consentimientoCookies.ts` (MSF-149 FR-034). No se redefinen aquí.
