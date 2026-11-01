# Contratos · Service cobro y avisos (MSF-232)

Todas las RPC: esquema `public`, `security definer`, `set search_path = ''`, `revoke execute ... from public, anon` y `grant execute ... to authenticated` en su migración. La organización y el actor salen de la sesión, nunca de un argumento. Errores: `42501` permiso, `22023` dato inválido, `P0002` no existe o no accesible, `55000` situación no válida; mensaje en castellano. Todo es **nuevo y aditivo**: no cambia la firma de nada existente (`BREAKING`: ninguno).

## F-SVC-13 · Cobro

```ts
generar_comprobante_reparacion(p_reparacion uuid): { comprobante_id: uuid, creado: boolean }
```
Exige `service_tecnico` y `ventas` en `edicion` en la tienda; idempotente (devuelve el vigente con `creado = false`).

```ts
comprobante_de_reparacion(p_reparacion uuid): { id: uuid, numero: text, tipo: text, estado: text, total: number, empresa_id: uuid } | null
```
Exige `service_tecnico` en `lectura`+.

Existente, ampliado de forma aditiva (campos nuevos en la salida, firma igual): `obtener_comprobante(uuid)` suma `origen_tipo`, `origen_id` y `origen_numero`.

Tablas (ver spec): `dominio.comprobantes_venta` suma `origen_tipo`, `origen_id`; `dominio.comprobantes_venta_lineas` suma `sin_stock`.

## F-SVC-14 · Avisos

```ts
avisar_cliente_reparacion(p_reparacion uuid, p_estado_id uuid default null): { resultado: 'encolado' | 'sin_correo', aviso_id: uuid | null }
```
Exige `service_tecnico` en `edicion`; `p_estado_id` nulo = estado actual; idempotente por reparación y estado.

```ts
avisos_de_reparacion(p_reparacion uuid): { id: uuid, estado_id: uuid, estado_nombre: text, destinatario: text, estado_envio: 'pendiente' | 'enviado' | 'fallido', error: text | null, solicitado_en: timestamptz, enviado_en: timestamptz | null, solicitado_por_nombre: text | null }[]
```
Exige `service_tecnico` en `lectura`+.

Funciones del flow (esquema `private`, solo `kestra_orquestacion`, no expuestas):

```ts
private.datos_aviso_reparacion(p_aviso uuid): jsonb   // destinatario, cliente, tienda, numero, equipo, estado, descripcion, estado_envio
private.cerrar_aviso_reparacion(p_aviso uuid, p_motivo text): void   // null = enviado; texto = fallido; idempotente
```

## F-SVC-15 · Ficha del cliente

```ts
reparaciones_de_cliente(p_cliente uuid, p_empresa uuid default null, p_pagina int default 1, p_tamano int default 25): { total_filas: number, filas: { id: uuid, numero: text, empresa: text, equipo: text, modelo: text, estado: text, estado_tono: text, ingreso_en: date, entrega_prevista: date | null, total: number }[] }
```
Exige `service_tecnico` en `lectura`+ y tienda accesible; sin costos internos.
