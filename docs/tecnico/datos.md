---
owner: tecnico
sources:
  - supabase/migrations
---

# Datos y DER

## Esquemas

| Esquema | Qué guarda |
|---|---|
| `public` | Plataforma: organizaciones, usuarios, roles, permisos, actividad, ejecuciones, imports |
| `dominio` | Negocio: empresas, clientes, productos, categorías, stock, comprobantes, reparaciones, historial |

Toda tabla expuesta tiene **RLS** por organización. Las secciones por empresa resuelven el nivel con `private.nivel_seccion()` y la empresa activa.

## Modelo del catálogo (MSF-160)

```mermaid
erDiagram
  EMPRESAS ||--o{ PRODUCTO_EMPRESA : "vende"
  PRODUCTOS ||--o{ PRODUCTO_EMPRESA : "se vende en"
  CATEGORIAS ||--o{ PRODUCTOS : "clasifica"
  CATEGORIAS ||--o{ CATEGORIAS : "padre de"
  EMPRESAS ||--o{ CATEGORIAS_EMPRESA : "ve"
  CATEGORIAS ||--o{ CATEGORIAS_EMPRESA : "visible en"

  EMPRESAS { uuid id PK
             uuid organizacion_id FK
             text nombre }
  PRODUCTOS { uuid id PK
              uuid organizacion_id FK
              uuid categoria_id FK "alterada: nueva FK a CATEGORIAS"
              text nombre
              text sku }
  PRODUCTO_EMPRESA { uuid producto_id PK
                     uuid empresa_id PK
                     uuid organizacion_id FK
                     timestamptz creado_en }
  CATEGORIAS { uuid id PK
               uuid organizacion_id FK
               uuid padre_id FK
               text nombre
               int posicion }
  CATEGORIAS_EMPRESA { uuid categoria_id PK
                       uuid empresa_id PK
                       uuid organizacion_id FK }
```

- **[ERD interactivo (Archify)](../diagrams/msf-160-erd.html)** — todas las columnas, PK/FK y cardinalidad.
- **[Arquitectura del catálogo](../diagrams/msf-160-architecture.html)** — cómo se lee y quién consume.

## Acceso y membresía (MSF-119)

- `public.usuarios_organizacion.estado` (`activo` | `suspendido`, default `activo`): migración aditiva `20261012140100`. Las funciones `private.organizacion_id()` y `private.puede_escribir()` excluyen a los suspendidos (más `20261012140300` para las de administración). El trigger `cortar_sesiones_suspendido` (`20261012150000`) borra `auth.sessions` al suspender.
- `public.intentos_acceso` (`correo_hash` PK, `fallos`, `ultimo_fallo`, `bloqueado_hasta`; `20261012140200`): contador de fallos por correo en hash HMAC (clave `acceso_hmac` en Vault). RLS activado y sin privilegios para `anon`/`authenticated`; solo se accede por RPC y por el hook `verificar_intento_acceso` (`20261014100000`). Es plataforma/auth, por eso vive en `public`. Cada migración lleva su reversión en el encabezado.
- Una persona pertenece a una sola organización (`user_id` PK de `usuarios_organizacion`, spec 003).

```mermaid
erDiagram
  organizaciones ||--o{ usuarios_organizacion : "tiene"
  auth_users ||--o| usuarios_organizacion : "pertenece a (user_id PK)"
  usuarios_organizacion { uuid user_id PK
    uuid organizacion_id FK
    text estado "activo|suspendido" }
  intentos_acceso { text correo_hash PK
    int fallos
    timestamptz bloqueado_hasta }
```

Detalle y operación: [Acceso](../acceso-ingreso.md) · regla para tablas nuevas: [Aislamiento](../aislamiento-por-organizacion.md).

## Service técnico (MSF-182)

Todas las tablas van en `dominio` (Principio VII), con RLS por `organizacion_id` y nivel de `service_tecnico` (`private.nivel_seccion`); lectura además restringida a tiendas accesibles (`20261020140000`). Sin `delete`. Migraciones: `supabase/migrations/20261020100100`–`20261020150000` (aditivas; reversión en el encabezado de cada una).

```mermaid
erDiagram
  modelos_equipo ||--o{ reparaciones : "modelo_id"
  estados_reparacion ||--o{ reparaciones : "estado_id"
  clientes ||--o{ reparaciones : "cliente_id"
  empresas ||--o{ reparaciones : "empresa_id (numeración)"
  reparaciones ||--o{ reparacion_historial : "reparacion_id"
  modelos_equipo { uuid id PK
    text equipo
    text modelo
    numeric mano_obra_base
    bool activo }
  estados_reparacion { uuid id PK
    text nombre
    int orden
    bool avisa_cliente
    bool cierra
    bool activo }
  reparaciones { uuid id PK
    uuid empresa_id FK
    int numero "unique (empresa_id, numero)"
    text numero_serie
    numeric costo_mano_obra "sin select directo"
    numeric costo_repuestos "sin select directo"
    timestamptz entrega_real
    timestamptz anulada_en }
  reparacion_historial { uuid id PK
    text tipo "alta|estado|entrega|anulacion"
    uuid estado_anterior_id
    uuid estado_nuevo_id
    uuid usuario_id }
```

- **Modelos y estados son por organización; la numeración es por empresa** (`private.siguiente_numero_reparacion`, bloqueo asesor por transacción). Sembrado idempotente: `private.sembrar_service` (`20261020100300`, siete modelos y siete estados).
- FK compuestas `(…_id, organizacion_id)` impiden cruzar organizaciones.
- Costos: grant por columna sin `costo_*`; solo los entrega `obtener_reparacion`, enmascarados sin `ver_costos`.
- `reparacion_historial` es solo lectura para la app; lo escriben las RPC en la misma transacción.
- Rol `tecnico`: solo datos en `roles_organizacion`/`permisos_rol` (matriz fija); detalle en la rama de la épica (`docs/permisos-por-rol.md`).

## Stock: lotes e inventario (MSF-131)

La carga en lote agrega `dominio.lotes_stock`; la toma de inventario no crea tablas, solo ajustes.

| Tabla | Estado | Cambio |
|-------|--------|--------|
| `dominio.lotes_stock` | nueva | Cabecera del lote: número correlativo por organización, proveedor en texto libre, fecha, motivo, clave de idempotencia y actor |
| `dominio.movimientos_stock` | alterada | Columna nullable `lote_id` con FK compuesta `(lote_id, organizacion_id)` e índice parcial |
| `dominio.motivos_movimiento` | existente | Fila de sistema nueva «Toma de inventario» (aplica a `ajuste`), sembrada y rellenada por organización |
| `dominio.existencias_deposito` | existente | Solo lectura: la toma compara el contado contra el stock del depósito por defecto |
| `dominio.depositos` | existente | Solo lectura: resuelve el depósito por defecto de la toma |
| `dominio.productos` | existente | Solo lectura: nombre y SKU de las líneas y del detalle |

```mermaid
erDiagram
  LOTES_STOCK ||--o{ MOVIMIENTOS_STOCK : "agrupa"
  MOTIVOS_MOVIMIENTO ||--o{ LOTES_STOCK : "motiva"
  MOTIVOS_MOVIMIENTO ||--o{ MOVIMIENTOS_STOCK : "motiva"
  PRODUCTOS ||--o{ MOVIMIENTOS_STOCK : "movimiento"
  DEPOSITOS ||--o{ MOVIMIENTOS_STOCK : "deposito"
  PRODUCTOS ||--o{ EXISTENCIAS_DEPOSITO : "stock"
  DEPOSITOS ||--o{ EXISTENCIAS_DEPOSITO : "stock"

  LOTES_STOCK {
    uuid id PK
    uuid organizacion_id FK
    int numero "unique por organizacion"
    text proveedor "texto libre <= 120"
    date fecha
    uuid motivo_id FK
    uuid clave_idempotencia "unique por organizacion"
    uuid actor_id
    text actor_nombre
    timestamptz creado_en
  }
  MOVIMIENTOS_STOCK {
    uuid id PK
    uuid organizacion_id FK
    uuid producto_id FK
    uuid deposito_id FK
    uuid motivo_id FK
    uuid lote_id FK "nueva: nullable, FK compuesta"
    text tipo "entrada|salida|ajuste"
    int cantidad
    int diferencia
    int saldo
    text nota
    date fecha
    timestamptz creado_en
  }
  MOTIVOS_MOVIMIENTO {
    uuid id PK
    uuid organizacion_id FK
    text nombre "Toma de inventario: motivo de sistema nuevo"
    text aplica_a "arreglo: entrada|salida|ajuste"
    bool activo
  }
  EXISTENCIAS_DEPOSITO {
    uuid producto_id PK
    uuid deposito_id PK
    uuid organizacion_id FK
    int cantidad
    int reservado
  }
  DEPOSITOS {
    uuid id PK
    uuid organizacion_id FK
    text nombre
    bool por_defecto
  }
  PRODUCTOS {
    uuid id PK
    uuid organizacion_id FK
    text nombre
    text sku
    bool activo
  }
```

- Migraciones: `20261202100000_stock_lotes_tabla.sql` (tabla, columna y RLS), `20261202130000_stock_motivo_toma_inventario.sql`
  (motivo de sistema) y `20261202130100_stock_confirmar_toma.sql` (RPC de la toma).
- `lotes_stock` es de solo agregado y solo la escribe `registrar_lote_stock`; la toma no persiste una entidad, produce
  movimientos `ajuste` por la vía de `registrar_movimiento_stock`.
- Detalle técnico y reversión: [Stock · lotes e inventario](stock-lotes-e-inventario.md).

## Datos vivos vs. archivo

- **Vivos:** comprobantes, cobros, stock, reparaciones. Afectan estados, saldos y reportes.
- **Archivo (`historial_*`):** datos del panel anterior, importados una sola vez, **solo lectura**. No tocan stock, saldos ni estados.
  - **[Flujo de importación](../diagrams/msf-275-dataflow.html)**
  - **[Estados de la ejecución](../diagrams/msf-275-lifecycle.html)**

## Migraciones y RLS

- Cada historia trae **su propia migración aditiva** con reversión en el encabezado.
- Las RPC nuevas son `security invoker` (o `definer` justificado), con `revoke`/`grant` explícitos.
- `rls_en_toda_tabla` y `aislamiento_organizaciones` recorren `public` + `dominio` en pgTAP.

## Inventario

El listado de tablas/rutas/variables generado desde el código está en **[Inventario](../_generated/inventory.md)**.

> **service_role (server-only):** tiene grants explícitos en `public`, `dominio` y `private`; `BYPASSRLS` no alcanza para usar un esquema/tabla. Lo usa el sandbox y las herramientas server-side, nunca el navegador.
