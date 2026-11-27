---
owner: tecnico
sources:
  - specs/20261022-084830-tienda-dominio-e-identidad
  - specs/20270125-100000-tienda-dominio-y-publicacion
  - supabase/migrations/20261023100000_tiendas_dominio.sql
  - apps/web/src/main.tsx
  - supabase/functions/tienda-seo/handler.ts
  - apps/web/nginx.conf
---

# Tiendas y vitrinas

## Multi-tienda

Una organización agrupa N tiendas. Casi todo es compartido (catálogo, stock,
clientes, proveedores) y lo que es propio de la tienda se asigna explícitamente.

```mermaid
flowchart TB
  ORG[Organización]
  ORG --> CAT[Catálogo único]
  ORG --> STK[Stock por depósito]
  ORG --> CLI[Clientes y proveedores]
  ORG --> T1[Tienda 1]
  ORG --> T2[Tienda 2]
  T1 --> V1[Comprobantes, service, config]
  T2 --> V2[Comprobantes, service, config]
  CAT -. publica .-> T1
  CAT -. publica .-> T2
```

| Tema | Regla |
|---|---|
| Asignación | Todo registro de tienda lleva su `empresa_id`; clientes y proveedores usan "Disponible en" |
| Tienda activa | Selector global; filtra listas y define permisos |
| Cambio de tienda | Refresca datos y rol sin reautenticar |
| Publicación | Un producto se publica por tienda con precio y visibilidad propios |

## Vitrinas online

Cada tienda tiene vitrina propia sobre el mismo catálogo y stock: la misma
aplicación decide por el `Host` si sirve el panel o la tienda de esa empresa
(`dominio.tiendas`). Cloudflare como caché del contenido público es un diseño
previsto (el repo no lo configura; ver [Infraestructura](infra.md)); hoy las
respuestas públicas de la tienda no se cachean y solo `robots.txt` y
`sitemap.xml` pasan por una caché de nginx de 5 minutos. El panel, dinámico, no
se cachea.

```mermaid
flowchart LR
  C[Cliente web] --> CF[Cloudflare cache]
  CF -->|miss| API[(Catálogo + stock)]
  API --> CF
  CF --> C
```

La vitrina muestra solo si el producto está **disponible** o sin stock (un
booleano, nunca la cantidad). La tienda no cobra online: el visitante
consulta, arma una lista de pedido o pide un presupuesto.

## Canales externos (Etapa 2)

Mercado Libre se agrega como canal: publicaciones sincronizadas por workers
con outbox, credenciales OAuth gestionadas en Nango, y el mismo stock único
para evitar sobreventa.

> **Arranque de la tienda pública (MSF-1002):** `main.tsx` llama a `precargarRutaActual` antes de renderizar: pide el chunk de la ruta actual en paralelo con `resolverTienda`, así el camino crítico deja de ser JS de entrada → tienda → chunk de la ruta → datos. Ver `docs/tienda-movil.md`, «LCP».
