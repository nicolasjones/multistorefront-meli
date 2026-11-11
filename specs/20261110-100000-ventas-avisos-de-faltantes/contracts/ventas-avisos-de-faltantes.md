# Contratos: Ventas y despacho · Ventas avisos de faltantes

Todas las RPC de la app viven en `public`, usan `security definer` con `search_path = ''`, toman la organización y el actor de la sesión (nunca de un argumento) y declaran `revoke execute … from public, anon` + `grant execute … to authenticated`. Las RPC de `service_role` (cola de la Edge Function) ya existen en F-STK-17; aquí solo cambia el contenido de `tomar_aviso_faltante`. Spec: `specs/20261110-100000-ventas-avisos-de-faltantes/spec.md`.

## F-VTA-26 · Avisar a clientes con faltantes

```ts
public.avisar_faltantes_venta(
  p_ids uuid[],                    // ids de dominio.faltantes_venta (el `id` que devuelve listar_faltantes), 1 a 200
  p_mensaje text default null,     // texto editable del correo; se recorta, <= 1000; vacío = null (texto por defecto)
  p_reavisar boolean default false // true = confirma volver a avisar los ya avisados
) returns {
  encolados: integer,              // clientes distintos con un aviso nuevo
  lineas_avisadas: integer,
  omitidos_ya_avisados: integer,   // ya avisados y sin p_reavisar
  omitidos_en_cola: integer,       // con un envío en curso: nunca se reenvía
  omitidos_sin_correo: integer,    // el cliente no tiene correo: NO se marca
  omitidos_sin_permiso: integer,   // tienda donde no hay `ventas` en edición
  omitidos_no_abiertos: integer,   // inexistentes, de otra organización o ya resueltos (misma respuesta: no delata)
  detalle: { id: uuid, resultado: 'encolado' | 'ya_avisado' | 'en_cola' | 'sin_correo' | 'sin_permiso' | 'no_abierto' }[]
}
```

Errores: `42501` sin sesión/organización o sin `ventas` en `edicion` (el rol Consulta es rechazado acá); `22023` lista vacía, de más de 200, o `p_mensaje` de más de 1000 caracteres. Todo o nada solo en validación; las filas se procesan una por una y cada una devuelve su resultado.

Efectos: por cada `encolado`, `insert … on conflict (linea_id) do update` sobre `dominio.faltantes_avisos` (la línea es `comprobantes_venta_lineas` con `(comprobante_id, orden) = (faltantes_venta.comprobante_id, faltantes_venta.linea_orden)`): estado `pendiente`, `intentos = 0`, `ultimo_error` y `enviado_en` nulos, `created_at = updated_at = now()`, `mensaje = p_mensaje`. Un `pendiente` no se toca; un `enviado` solo se reinicia con `p_reavisar`; un `agotado` se reinicia siempre. Actividad `ventas.faltantes_avisados` (cantidad de faltantes y de clientes; sin correos).

```ts
public.listar_faltantes(
  p_empresa_id uuid default null,
  p_pagina integer default 1,
  p_tamano integer default 10,     // tope 200
  p_aviso text default null        // null | 'sin_avisar' | 'avisado' | 'para_avisar' (esta última desde F-VTA-27); otro valor -> 22023
) returns {
  id, empresa_id, empresa, cliente, producto, sku, cantidad_faltante, linea_orden,
  comprobante_id, comprobante, fecha, desde, stock_estado, stock_disponible,   // sin cambios (F-VTA-18)
  aviso: 'sin_avisar' | 'avisado' | 'para_avisar',
  aviso_en: timestamptz | null,    // avisado: coalesce(enviado_en, created_at) de la cola; para_avisar: para_avisar_en; si no, null
  filas: bigint                    // total del filtro
}[]
```

Reemplaza a `listar_faltantes(uuid, integer, integer)` (se hace `drop` de la firma vieja; las llamadas por nombre con tres parámetros siguen resolviendo). `aviso = 'avisado'` ⇔ fila de `faltantes_avisos` de la línea con estado `pendiente` o `enviado` (misma semántica que `public.faltantes_listado` de F-STK-17). Prioridad: `avisado` > `para_avisar` > `sin_avisar`. Orden: `desde` descendente, `id`; con `p_aviso = 'para_avisar'`, `desde` ascendente, `id`.

### Cola y correo (cambios sobre F-STK-17, mismas firmas)

```ts
private.faltante_abierta(p_linea_id uuid) returns boolean
// además del criterio de F-STK-17 (factura «A pedido» confirmada con reserva activa):
// true si la línea tiene una fila abierta en dominio.faltantes_venta.

public.tomar_aviso_faltante(p_cliente uuid, p_tope integer default 5)
  returns table (cliente text, correo text, lineas jsonb)   // solo service_role (sin cambios de permisos)
// lineas: [{ producto, sku, cantidad, comprobante, mensaje }]  ← `mensaje` es nuevo (null = texto por defecto);
// `cantidad` = cantidad faltante si hay faltante de venta abierto, si no la de la línea.
// La tanda de un cliente incluye solo las líneas pendientes con el mismo `mensaje` que la más antigua.
```

Edge Function `enviar-aviso-faltante` (sin cambios de endpoint, secreto ni flow): `LineaFaltante` suma `mensaje?: string | null`. Cuerpo en texto plano: `Hola <cliente>,` + (`mensaje` saneado, o «Volvió a haber stock de los productos que tenías pedidos:» sin mensaje) + `- <producto> (<sku>) · <n> u. · Comprobante <número>` por línea + (sin mensaje) «Escribinos para coordinar la entrega.». Asunto: «Ya tenemos stock de lo que pediste». Saneamiento del mensaje: sin caracteres de control salvo `\n`, a lo sumo dos saltos seguidos, máx. 1000.

## F-VTA-27 · «Para avisar» al ingresar mercadería

Sin RPC nueva para la app. Datos y disparador (esquema `dominio`):

```ts
dominio.faltantes_venta + {
  para_avisar_en: timestamptz | null,          // momento de la marca
  para_avisar_ingreso_id: uuid | null          // ingreso que la originó (FK dominio.ingresos_mercaderia, on delete set null)
}

// AFTER INSERT FOR EACH ROW ON dominio.ingresos_mercaderia_lineas  (lo inserta public.registrar_ingreso_mercaderia)
private.marcar_faltantes_para_avisar() returns trigger
// saldo := new.cantidad
// para cada faltante f de la organización con f.producto_id = new.producto_id, f.estado = 'abierto',
//   f.para_avisar_en is null y sin aviso 'pendiente'/'enviado' en la cola, ordenado por (f.creado_en, f.id):
//     si f.cantidad_faltante <= saldo -> marca (para_avisar_en = now(), para_avisar_ingreso_id = ingreso) y saldo -= f.cantidad_faltante
//     si no -> se salta y se sigue con el siguiente más antiguo (hasta saldo 0)
// No escribe en faltantes_avisos ni envía nada. Una excepción interna se registra como warning y el ingreso continúa.
// Actividad ventas.faltantes_para_avisar { producto, marcados } solo si marcó al menos uno.
```

Ejemplos (cobertura): ingreso de 10 → faltantes `[3, 3, 3]` marcados los 3; faltantes `[4, 4, 4]` marcados los dos más antiguos; faltantes `[9, 2, 1]` marcados el de 9 y el de 1 (saldo 1; el de 2 no entra y se salta); faltantes `[12, 1]` marcado solo el de 1 (el más antiguo no entra y se salta).

## Permisos y RLS (sin cambios)

- `dominio.faltantes_venta` y `dominio.faltantes_avisos`: lectura por organización y `ventas` en lectura/edición en la tienda; sin `insert`/`update`/`delete` para `authenticated`; `anon` sin privilegios. Las columnas nuevas heredan la política de su tabla.
- `avisar_faltantes_venta`: `ventas` en `edicion` (global y por tienda); Consulta solo lee.
- El disparador de ingresos es `security definer` (marca faltantes de tiendas que quien registra el ingreso quizá no ve); no expone datos: solo escribe la marca.
