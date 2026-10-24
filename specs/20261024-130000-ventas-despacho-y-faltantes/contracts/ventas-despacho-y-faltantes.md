# Contratos · Ventas despacho y faltantes (MSF-135)

Todas las RPC: esquema `public`, `security definer`, `set search_path = ''`, `revoke execute ... from public, anon` y `grant execute ... to authenticated` explícito en su migración. La organización y el actor salen de la sesión (`private.organizacion_id()`, `auth.uid()`), nunca de un argumento. Las de escritura exigen `private.puede_accion('ventas','despachar')` (o, en `guardar_envio_comprobante`, `edicion` de Ventas en la empresa) y que el comprobante sea una `factura` `confirmada`; las de lectura, `ventas` en `lectura`/`edicion` y empresa accesible. Errores: `42501` (permiso), `22023` (dato inválido), `P0002` (no existe), `55000` (transición no permitida), `40001` (conflicto de `p_actualizado_en`), con mensaje en castellano. Nombres y firmas de objetos de MSF-159 (`confirmar_comprobante`, `comprobantes_venta_lineas`) se re-verifican contra `main` al implementar.

## F-VTA-15 · Armado, control y entrega

```ts
cambiar_estado_despacho(
  p_id uuid,
  p_estado text,               // 'armando' | 'listo_para_despachar' | 'entregado'
  p_responsable_id uuid,       // Armó / Controló / Entregó según p_estado
  p_actualizado_en timestamptz // bloqueo optimista
) returns dominio.comprobantes_venta
```

Transiciones: `sin_armar`→`armando`, `incompleto`→`armando` (resuelve faltantes, FR-042), `armando`→`listo_para_despachar`, `listo_para_despachar`→`entregado` (descuenta reservas «A pedido»). `incompleto` lo fija `registrar_faltantes_despacho`. Idempotente ante el estado ya alcanzado.

```ts
listar_responsables_despacho(p_empresa_id uuid, p_funcion text) // 'armar' | 'controlar' | 'entregar'
  returns table (user_id uuid, nombre text, rol_id text)
```

- `private.asignar_estado_despacho_inicial()` — disparador al pasar la factura a `confirmada` (no ejecutable por `authenticated`).
- Acción `despachar` en `ventas`: `permisos_rol_accion_accion_check`, `private.matriz_acciones_iniciales()` y `private.puede_accion(text, text)` la reconocen (misma firma; comportamiento ampliado, no BREAKING).

## F-VTA-16 · Transporte y guía

```ts
guardar_envio_comprobante(
  p_id uuid, p_transporte_id uuid, p_guia text, p_fecha_envio date,
  p_actualizado_en timestamptz
) returns dominio.comprobantes_venta
```

El transporte debe estar activo y asignado a la empresa del comprobante. Disparador `BEFORE UPDATE OF estado_despacho` rechaza `entregado` si la forma de envío (`formas_envio.exige_transporte_guia`) exige transporte y guía y faltan.

## F-VTA-17 · Tablero de despacho

```ts
listar_despacho(
  p_busqueda text default null, p_estado text default null, p_empresa_id uuid default null,
  p_pagina integer default 1, p_tamano integer default 10
) returns table (
  id uuid, numero text, empresa_id uuid, empresa text, fecha date, cliente text,
  estado_despacho text, armo text, controlo text, entrego text,
  transporte text, guia text, fecha_envio date, puede_despachar boolean,
  filas bigint, conteos jsonb   // conteos por estado_despacho, dentro de la empresa y la búsqueda
)
```

## F-VTA-18 · Faltantes

```ts
registrar_faltantes_despacho(
  p_id uuid,
  p_faltantes jsonb,           // [{ linea_orden: integer, cantidad: integer }], 1+ ítems
  p_actualizado_en timestamptz
) returns dominio.comprobantes_venta   // la factura queda en 'incompleto'

listar_faltantes(p_empresa_id uuid default null, p_pagina integer default 1, p_tamano integer default 10)
  returns table (
    id uuid, empresa_id uuid, empresa text, cliente text,
    producto_id uuid, producto text, sku text, cantidad integer,
    comprobante_id uuid, numero text, desde timestamptz,
    stock_estado text, disponible integer, filas bigint
  )
```

Datos: `dominio.faltantes_venta(id, organizacion_id, empresa_id, comprobante_id, linea_orden, producto_id, deposito_id, cantidad_faltante, estado, registrado_por, creado_en, resuelto_en)`; único `(comprobante_id, linea_orden) where estado = 'abierto'`.
