---
owner: tecnico
sources:
  - specs
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

Cada tienda tiene vitrina propia sobre el mismo catálogo y stock. Cloudflare
cachea el contenido público; el panel, dinámico, no se cachea.

```mermaid
flowchart LR
  C[Cliente web] --> CF[Cloudflare cache]
  CF -->|miss| API[(Catálogo + stock)]
  API --> CF
  CF --> C
```

El stock visible en la vitrina es el **disponible** con una caché corta; la
reserva definitiva ocurre al confirmar el pedido.

## Canales externos (Etapa 2)

Mercado Libre se agrega como canal: publicaciones sincronizadas por workers
con outbox, credenciales OAuth gestionadas en Nango, y el mismo stock único
para evitar sobreventa.
