---
owner: tecnico
sources:
  - specs
  - supabase
---

# Catálogo: alta y edición (MSF-456), construcción interna

**Épica:** MSF-456 · **Spec:** `specs/20261017-120000-catalogo-alta-y-edicion/` · **Producto:**
[Catálogo: alta y edición](../producto/catalogo-alta-y-edicion.md). Detalle por historia, límites y reversiones:
[Catálogo de productos](../catalogo.md).

Dependencias: `registro_actividad` (MSF-455), empresas y `producto_empresa` (MSF-138). La lee MSF-160 y la extiende
MSF-205 (proveedor) y MSF-179 ([costo y disponibilidad](catalogo-costo-y-disponibilidad.md)).

## Datos (esquema `dominio`, Principio VII)

| Tabla | Migración | Notas |
|---|---|---|
| `dominio.productos` | `20261017120100` | nombre, SKU, descripción, `compatible_con text[]`, moneda `USD`/`ARS`, precio de lista, `activo`. Aislada por `organizacion_id = private.organizacion_id()`. Sin DELETE. |
| `dominio.producto_costos` | `20261017120100` | costo aparte para restringirlo por fila (`rentabilidad`). FK compuesta `(producto_id, organizacion_id)`. |
| `dominio.producto_imagenes` | `20261017120500` | `posicion` 1..4, `ruta`; único `(producto_id, posicion)`; sin UPDATE. |

```mermaid
erDiagram
  PRODUCTOS ||--o| PRODUCTO_COSTOS : "costo (rentabilidad)"
  PRODUCTOS ||--o{ PRODUCTO_IMAGENES : "hasta 4"
  PRODUCTOS { uuid id PK
    uuid organizacion_id
    text nombre
    text sku
    text[] compatible_con
    text moneda
    numeric precio
    bool activo
    timestamptz updated_at }
  PRODUCTO_COSTOS { uuid producto_id PK
    uuid organizacion_id
    numeric costo }
  PRODUCTO_IMAGENES { uuid producto_id
    int posicion
    text ruta }
```

DER general en [Datos](datos.md). Se ubican en `dominio` por ser negocio del producto.

## Contratos (RPC en `public`, `security invoker`; `grant ... authenticated`, `revoke ... public, anon`)

| RPC | Migración | Reglas |
|---|---|---|
| `crear_producto` | `20261017120200` | `edicion` en `productos`; costo exige `edicion` en `rentabilidad` (si no, `42501`); precio > 0, 2 decimales; no recibe stock. |
| `actualizar_producto` | `20261017120400` | Bloqueo optimista con `p_actualizado_en` (`40001` si cambió, `P0002` si no existe); `p_costo` nulo no toca el costo. |
| `cambiar_estado_producto` | `20261017120600` | Solo escribe `activo`; idempotente. |

SKU único (`20261017120300`): índice `dominio.productos_org_sku_uidx` sobre `(organizacion_id, lower(btrim(sku)))`
(`23505` ante duplicado) y disparador `productos_sku` que genera `PRD-` + 8 hexadecimales si viene vacío.

## Imágenes

Bucket privado `productos-imagenes` (2 MB; `image/jpeg|png|webp`), ruta `<organizacion_id>/<producto_id>/…`.
Políticas en `storage.objects` por `edicion`/`lectura` en `productos`. El tope de 4 lo impone el disparador
`producto_imagenes_tope` (`23514`). El cliente sube al guardar y usa URLs firmadas de 5 minutos
(`apps/web/src/lib/productoImagenes.ts`, `components/productos/ImagenesProducto.tsx`).

## Actividad

Disparadores en la misma transacción, solo con sesión: `producto.creado`, `producto.editado` (solo con cambio real,
`productos_updated_at_real`), `producto.activado`/`producto.desactivado`, `producto.imagen_agregada`/`imagen_eliminada`.
Los detalles nunca llevan costo, precio ni ruta.

## Frontend

Rutas en `apps/web/src/App.tsx`: `/productos` (`pages/productos/list.tsx`), `/productos/create` (`create.tsx`) y
`/productos/:id/edit` (`edit.tsx`), con guard de sección `productos`; formulario común
`components/productos/FormularioProducto.tsx`; mensajes de error en `lib/productos.ts` (`mensajeDeError`).

## Pruebas

pgTAP en `supabase/tests/database/`: `catalogo_productos`, `catalogo_sku_unico`, `catalogo_actualizar_producto`,
`catalogo_producto_imagenes`, `catalogo_estado_producto`. Vitest: `pages/productos/*.test.tsx`, `lib/productos.test.ts`,
`lib/productoImagenes.test.ts`, `components/productos/ImagenesProducto.test.tsx`. E2E `[MSF-456:T025]`: pendiente (ver
[E2E de la app](../e2e-app.md)).

## Operación y reversión

Migraciones aditivas; la reversión (posterior, no en el mismo PR) está en [Catálogo de productos](../catalogo.md).
Límite conocido: el tipo de imagen se valida por `file.type`; un archivo huérfano en el bucket no se barre
automáticamente.
