# Contratos: Opiniones de productos (MSF-467)

Todas las RPC devuelven `jsonb` con `estado` salvo las del panel, que usan los mismos errores de Postgres que las de listas de precios (`42501`, `40001`, `55000`). `security definer`, `set search_path = ''`; el `exception when others` registra solo `sqlstate`. **Ninguna RPC de la tienda recibe `cliente_id`, `cuenta_id`, `empresa_id` ni `organizacion_id`**: todo sale de la sesión y del host (`private.cuenta_de_tienda(host)`).

Orden de verificaciones en la tienda: **bandera `tienda_opiniones` → cuenta → límite por visitante → validar entradas → trabajar**.

## Tienda (`publico`)

| RPC | Roles | Entrada | Salida |
|---|---|---|---|
| `publico.capacidades_opiniones_por_dominio(host)` | `anon`, `authenticated` | host | `{estado:"ok", opiniones:true\|false}` · `{estado:"error"}` (host desconocido, empresa desactivada y tienda pausada, sin distinguir) |
| `publico.opiniones_producto_por_dominio(host, producto_id, desde_creada, desde_id, limite)` | `anon`, `authenticated` | cursor `(creada_en, id)` que **solo ordena**; `limite` 1–50 (10 por defecto); un cursor a medias se ignora | `{estado:"ok", resumen:{promedio, cantidad}, filas:[{id, nombre_pila, puntuacion, comentario, fecha, es_mia}], siguiente:{creada,id}\|null}` · `no_encontrado` · `limite` · `error`. Con bandera apagada: `{estado:"ok", resumen:{promedio:null, cantidad:0}, filas:[], siguiente:null}` |
| `publico.guardar_opinion_por_dominio(host, producto_id, puntuacion, comentario)` | `authenticated` | puntuación 1–5, comentario 10–1.000 | `{estado:"ok", opinion:{id, estado, puntuacion, comentario}}` · `invalido` (`campos:["puntuacion"\|"comentario"]`) · `limite_opiniones` · `limite_pendientes` · `no_encontrado` · `limite` (`espera_segundos`) · `sin_acceso` · `error` |
| `publico.borrar_opinion_por_dominio(host, producto_id)` | `authenticated` | uno | `{estado:"ok"}` (idempotente: borrar una inexistente es `ok`) · `limite` · `sin_acceso` · `error` |
| `publico.mis_opiniones_por_dominio(host, desde_creada, desde_id, limite)` | `authenticated` | cursor y `limite` 1–50 (20) | `{estado:"ok", total, filas:[{id, producto_id, producto_nombre, puntuacion, comentario, estado, motivo_rechazo, creada_en, actualizada_en}], siguiente}` · `sin_acceso` · `error` |

- `sin_acceso` es **idéntico** para: sin sesión, sin cuenta, cuenta suspendida, cliente no habilitado, usuario del panel, otra tienda, host desconocido, empresa desactivada o pausada, y bandera apagada (en las RPC que escriben).
- `guardar` es **upsert por `(cuenta, producto)`**: mismo contenido = `ok` sin cambiar estado, fecha ni cupo; contenido distinto = `pendiente` (limpia motivo y moderación). Un cliente **nunca** envía `estado`.
- **Lista blanca** de `opiniones_producto_por_dominio` (probada por claves): `nombre_pila` (primera palabra de `clientes.nombre`, ≤ 30; «Cliente» si queda vacío), `puntuacion`, `comentario`, `fecha` (día, zona de Buenos Aires), `id` de la opinión, `es_mia` (solo con sesión). Nunca estado, motivo, ids de cliente/cuenta/organización/empresa, correo, apellido ni teléfono.
- `promedio`: promedio de las **aceptadas** de ese producto en esa tienda, redondeado a un decimal; `null` si no hay.
- Límites (clave propia por visitante, `private.registrar_pedido_publico`): `opinion|escritura|<visitante>` 10 por minuto; `opinion|lectura|<visitante>` 30 por minuto. Cuentan también las llamadas inválidas.
- `revoke execute … from public, anon` + `grant execute … to authenticated` en las tres de cuenta; las dos de lectura además a `anon`.

## Panel (`public`)

| RPC | Roles | Entrada | Salida |
|---|---|---|---|
| `public.listar_opiniones(estado, empresa_id, desde_creada, desde_id, limite)` | `authenticated` (solo Administrador; otro → `42501`) | `estado` ∈ `pendiente\|aceptada\|rechazada\|todas`; `empresa_id` null = todas las tiendas; cursor `(creada_en, id)` y `limite` 1–50 (20) | `{contadores:{pendientes, aceptadas, rechazadas}, filas:[{id, empresa_id, empresa_nombre, cliente_id, cliente_nombre, producto_id, producto_nombre, puntuacion, comentario, estado, motivo_rechazo, creada_en, actualizada_en}], siguiente}`; los contadores son del ámbito de `empresa_id`, no del filtro de estado |
| `public.moderar_opinion(id, decision, motivo, actualizada_en_esperada)` | `authenticated` (solo Administrador) | `decision` ∈ `aceptar\|rechazar`; `motivo` ≤ 200 (solo al rechazar) | `{estado:"ok", opinion:{id, estado}}` · `conflicto` (la fila cambió: `40001`) · `no_encontrada` · `55000` si la bandera está apagada y la decisión es `aceptar` |

- Repetir la misma decisión sobre una opinión ya en ese estado responde `ok` **sin** volver a registrar el evento.
- Eventos de **Actividad** (`private.registrar_actividad`): `opinion.aceptada` y `opinion.rechazada`; detalle «Opinión de N estrellas sobre «producto» aceptada/rechazada» (≤ 500, **sin el comentario ni el motivo**).
