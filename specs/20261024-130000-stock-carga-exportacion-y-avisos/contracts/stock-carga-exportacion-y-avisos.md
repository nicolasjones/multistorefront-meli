# Contratos: Stock · Stock carga, exportación y avisos

Todas las RPC viven en `public`, usan `security definer` con `search_path = ''`, toman la organización y el actor de la sesión (nunca de un argumento) y declaran `revoke execute … from public, anon` en su migración. Las de la app llevan además `grant execute … to authenticated`; las marcadas **service_role** no son ejecutables por `authenticated` ni `anon`. Todo es nuevo: no hay cambios de firma de funciones existentes.

## F-STK-07 · Carga inicial y masiva

```ts
validar_carga_stock(
  p_deposito uuid,      // depósito activo de la organización
  p_filas jsonb         // [{ fila: integer, sku: text, cantidad: text, motivo: text|null }], hasta 2000
) returns {
  fila: integer, sku: text, producto: text|null,
  stock_actual: integer|null, en_planilla: integer|null, quedara: integer|null, diferencia: integer|null,
  estado: 'ajuste' | 'sin_cambios' | 'error',
  mensaje: text         // 'Ajuste' | 'Sin cambios' | 'SKU no existe' | 'SKU repetido en la planilla' | 'Cantidad inválida' | 'Ya tuvo carga inicial' | 'SKU vacío'
}[]
```

```ts
aplicar_carga_inicial_stock(
  p_deposito uuid,
  p_filas jsonb,        // mismo formato; el servidor revalida todo
  p_clave uuid default gen_random_uuid()  // idempotencia: misma clave => mismo resultado, sin mover stock otra vez
) returns { aplicadas: integer, omitidas: integer, detalle: { fila: integer, sku: text, estado: text, mensaje: text }[] }
```

Errores: `42501` sin sesión/organización o sin `edicion` en Stock; `22023` depósito inexistente/inactivo, más de 2000 filas o `p_filas` mal formado. Solo aplica filas válidas con diferencia (un `ajuste` por fila vía `registrar_movimiento_stock`, motivo «Carga inicial de stock»); una falla inesperada revierte todo.

## F-STK-09 · Avisos de reposición (service_role)

```ts
generar_resumen_reposicion(p_organizacion uuid) returns {
  resumen_id: uuid,
  sin_stock: integer, stock_bajo: integer,
  productos: { producto_id: uuid, nombre: text, sku: text, cantidad: integer, disponible: integer, minimo: integer, estado: 'sin_stock'|'stock_bajo' }[]
} | null             // null = sin productos nuevos en alerta
```

```ts
cerrar_resumen_reposicion(p_resumen uuid, p_enviado boolean, p_error text default null) returns void
```

```ts
organizaciones_con_resumen_pendiente() returns uuid[]   // organizaciones a barrer
```

**A confirmar al implementar** (dependencia MSF-189): cómo se obtienen los destinatarios y se entrega el correo por el mecanismo de avisos de Plataforma. Hasta que exista en `main`, esta sección queda abierta y no se inventa un nombre de función.

## F-STK-17 · Faltantes

```ts
// Vista de lectura (security_invoker): una fila por línea faltante abierta
public.faltantes_listado {
  linea_id: uuid, empresa_id: uuid, empresa: text, cliente_id: uuid, cliente: text,
  producto_id: uuid, producto: text, sku: text, pedido: integer,
  comprobante_id: uuid, comprobante_numero: text, desde: date,
  estado_stock: 'sin_stock'|'stock_bajo'|'disponible', disponible: integer,
  aviso: 'sin_avisar' | 'avisado'
}
```

```ts
avisar_faltantes(p_lineas uuid[]) returns {
  encolados: integer,            // clientes con correo en cola
  lineas_avisadas: integer,
  omitidos_ya_avisados: integer,
  omitidos_sin_stock: integer,
  omitidos_sin_correo: integer,
  omitidos_sin_permiso: integer
}
```

Errores: `42501` sin sesión/organización; `22023` lista vacía o de más de 200 líneas. Idempotente por línea.

```ts
// service_role
faltantes_avisos_pendientes(p_tope integer, p_limite integer) returns uuid[]       // ids de clientes/avisos a enviar
tomar_aviso_faltante(p_cliente uuid, p_tope integer) returns { cliente: text, correo: text, lineas: { producto: text, sku: text, cantidad: integer, comprobante: text }[] }[]
cerrar_aviso_faltante(p_cliente uuid, p_enviado boolean, p_error text default null) returns void
```

## F-STK-18 · Más vendidos

```ts
productos_mas_vendidos(
  p_desde date,
  p_hasta date,                        // rango máximo 5 años (22023 si se excede o es inválido)
  p_empresa_id uuid default null,      // null = todas las tiendas visibles; una ajena devuelve 0 filas
  p_pagina integer default 1,
  p_tamano integer default 25          // tope 200
) returns { posicion: integer, producto_id: uuid, nombre: text, sku: text, unidades: integer, total_filas: integer }[]
```

Errores: `42501` sin sesión/organización o sin `stock` en `lectura`/`edicion`; `22023` rango inválido.

## F-STK-08 · Exportar CSV

Sin RPC ni endpoint nuevos: lee por lotes las mismas fuentes que las pantallas (`public.stock_estados` y el listado de movimientos) bajo la RLS vigente.
