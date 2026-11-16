---
owner: tecnico
sources:
  - specs
---

# Arquitectura

## Componentes

```mermaid
flowchart TB
  subgraph Clientes
    P[Panel Refine + React]
    V[Vitrinas online]
  end
  subgraph Edge
    CF[Cloudflare: DNS, TLS, cache]
  end
  subgraph Backend
    AU[Supabase Auth]
    PG[(Postgres + RLS)]
    ST[Storage: imágenes, adjuntos]
    RPC[Funciones RPC transaccionales]
  end
  subgraph Asincrono
    OB[Outbox]
    W[Workers Node]
    K[Kestra, cuando haga falta]
  end
  SS[Superset embebido]
  P --> CF --> AU
  V --> CF
  CF --> PG
  P --> RPC --> PG
  PG --> OB --> W
  K --> W
  PG --> SS --> P
  P --> ST
```

## Capas y responsabilidades

| Capa | Responsabilidad | No hace |
|---|---|---|
| Panel (Refine) | UI, formularios, tablas, selector de tienda activa | Reglas de negocio críticas |
| RPC / funciones SQL | Operaciones atómicas: confirmar venta, reservar, mover stock | Presentación |
| Postgres + RLS | Verdad de los datos y aislamiento | Lógica de UI |
| Workers + outbox | Efectos asíncronos: sincronizar canales, notificaciones | Decidir permisos |
| Superset | Reportes y tableros sobre vistas de lectura | Escribir datos |

## Flujo de una operación crítica (confirmar venta)

```mermaid
sequenceDiagram
  participant U as Mostrador
  participant P as Panel
  participant R as RPC confirmar_venta
  participant D as Postgres
  participant O as Outbox
  U->>P: Confirmar comprobante
  P->>R: venta_id
  R->>D: validar rol en la tienda (RLS)
  R->>D: reservar stock por línea
  alt sin disponible y no es a pedido
    R-->>P: error de stock
  else ok
    R->>D: estado = Pendiente, movimientos de reserva
    R->>O: evento venta_confirmada
    R-->>P: ok
  end
```

## Principios

- **Transacción en la base**: toda operación que toca stock o dinero corre en una RPC atómica.
- **Idempotencia**: los eventos del outbox llevan clave única; reintentar no duplica.
- **Un solo origen de verdad**: nada de copias del stock por tienda o canal.
- **Lectura analítica separada**: Superset consulta vistas, no tablas operativas.
- **Entornos separados**: staging y producción con proyectos y secretos distintos.

## Stack

Refine + React, Supabase (Postgres, Auth, Storage, RLS, pruebas pgTAP), workers
Node con outbox, Kestra para orquestación larga, Superset embebido por
organización, conexiones OAuth vía Nango (Etapa 2). Detalle de monorepo y
servicios locales en [../architecture.md](../architecture.md).
