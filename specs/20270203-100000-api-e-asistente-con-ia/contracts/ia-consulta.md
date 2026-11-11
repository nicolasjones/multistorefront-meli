# Contrato · Fuentes de consulta del asistente (F-IA-01)

Vistas `public.ia_consulta_*` de **solo lectura**, `security_invoker = true`, con `organizacion_id`. Las registran `fuentes_chat_ia` y `fuentes_mcp` (**una vista por feature**, porque `private.mcp_leer_fila` usa `limit 1`). El chat las lee con la sesión del usuario (RLS de las tablas base); MCP arma `where organizacion_id = <sesión>` dentro del SQL.

## Columnas exactas

```ts
ia_consulta_catalogo(
  organizacion_id uuid,
  producto_id uuid,
  nombre text,
  sku text,
  categoria_id uuid,
  categoria text,          -- ruta «Padre > Hija» o nombre de la raíz
  activo boolean,
  actualizado_en timestamptz
)

ia_consulta_stock(
  organizacion_id uuid,
  producto_id uuid,
  nombre text,
  sku text,
  deposito_id uuid,
  deposito text,
  cantidad integer,
  reservado integer,
  disponible integer,      -- cantidad − reservado
  actualizado_en timestamptz
)

ia_consulta_precios(
  organizacion_id uuid,
  producto_id uuid,
  nombre text,
  sku text,
  moneda text,             -- USD | ARS
  precio_lista numeric,
  precio_x5 numeric,       -- null = escala sin precio
  precio_x10 numeric,
  precio_x50 numeric,
  actualizado_en timestamptz
)

ia_consulta_ventas(
  organizacion_id uuid,
  comprobante_id uuid,
  numero text,
  fecha date,
  empresa_id uuid,
  total_sin_iva numeric,
  total_con_iva numeric,
  estado text,             -- solo 'confirmada'
  confirmado_en timestamptz
)
```

Fuentes reales: `dominio.productos` + `dominio.categorias`; `dominio.existencias_deposito` + `dominio.productos` + `dominio.depositos`; `dominio.productos` + `dominio.producto_precios_escala`; `dominio.comprobantes_venta` con `tipo = 'factura' and estado = 'confirmada'`.

## Permisos

| Fuente | Feature | Sección (`private.nivel_seccion`) |
|---|---|---|
| catálogo | `catalogo` | `productos` |
| stock | `stock` | `stock` |
| precios | `precios` | `productos` (no existe sección `precios`) |
| ventas | `ventas` | `ventas` |

Se consulta solo si la funcionalidad está activa (`private.tiene_feature`) **y** el rol tiene al menos `lectura` en la sección. Sin feature o sin sección no se devuelven filas.

## Registro idempotente

- Cuatro features: `catalogo`, `stock`, `precios`, `ventas` (`on conflict do nothing`).
- Una fila por feature en `fuentes_chat_ia` y en `fuentes_mcp`, apuntando a su `ia_consulta_*`.
- `capacidades_chat_ia` y `capacidades_mcp`: `lectura = true`, `ejecucion = false`; segunda corrida no duplica ni cambia la fecha de actualización existente.
- Los `eventos_features` (`feature_registrada`) se insertan solo cuando la feature es nueva.

## Límites y auditoría

- Máximo **50 filas por consulta** (se acota en la vista/lectura y en el chat; el asistente nunca recibe más).
- Rigen los límites de intentos/tiempo de la política IA aprobada (`ia_politicas`).
- Cada consulta deja registro en `ia_interacciones` y en la conexión/ejecución MCP existente; el detalle no guarda contactos de clientes, costos ni márgenes.

**Excluido por diseño (D-7)**: costos, márgenes, datos de contacto de clientes y precio final por empresa/IVA. `ejecucion = false` en chat y MCP: el asistente no escribe ni ejecuta acciones.

`BREAKING:` ninguno (vistas y registros nuevos).
