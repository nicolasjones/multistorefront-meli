---
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
