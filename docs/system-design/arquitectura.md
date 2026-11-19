---
owner: tecnico
sources:
  - supabase/migrations/20261204140000_confirmar_comprobante.sql
  - supabase/migrations/20261023130100_stock_reservas.sql
  - supabase/migrations/20260923171400_crear_outbox_ejecuciones.sql
  - infra/kestra/compose.yaml
  - infra/superset/compose.yaml
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
| RPC / funciones SQL | Operaciones atómicas: confirmar comprobante, reservar, mover stock | Presentación |
| Postgres + RLS | Verdad de los datos y aislamiento | Lógica de UI |
| Workers + outbox | Efectos asíncronos: sincronizar canales, notificaciones | Decidir permisos |
| Superset | Reportes y tableros sobre vistas de lectura | Escribir datos |

## Flujo de una operación crítica (confirmar venta)

```mermaid
sequenceDiagram
  participant U as Mostrador
  participant P as Panel
  participant R as RPC confirmar_comprobante
  participant D as Postgres
  U->>P: Confirmar comprobante
  P->>R: comprobante_id
  R->>D: validar rol en la tienda (nivel de Ventas en la empresa)
  R->>D: descontar o reservar stock por línea
  alt sin disponible y no es a pedido
    R-->>P: error de stock
  else ok
    R->>D: estado = confirmada, movimientos o reservas, evento de Actividad
    R-->>P: ok
  end
```

## Principios

- **Transacción en la base**: toda operación que toca stock o dinero corre en una RPC atómica.
- **Idempotencia**: confirmar dos veces la misma factura no duplica movimientos (la segunda llamada devuelve la ya confirmada), y los eventos del outbox llevan clave única.
- **Un solo origen de verdad**: nada de copias del stock por tienda o canal.
- **Lectura analítica separada**: Superset consulta vistas, no tablas operativas.
- **Entornos separados**: staging y producción con proyectos y secretos distintos.

## Stack

Refine + React, Supabase (Postgres, Auth, Storage, RLS, pruebas pgTAP), workers
Node con outbox, Kestra para orquestación larga, Superset embebido por
organización, conexiones OAuth vía Nango (Etapa 2). Detalle de monorepo y
servicios locales en [../architecture.md](../architecture.md).
