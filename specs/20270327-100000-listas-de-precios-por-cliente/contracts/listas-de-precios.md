# Contrato: listas de precios

Todas las RPC son de `public`, `security definer`, `set search_path = ''`, con `revoke execute … from public, anon` y `grant execute … to authenticated`. La organización y el rol salen de la sesión, nunca de un parámetro. Solo el rol **Administrador** escribe (`42501` si no).

## Tabla `dominio.listas_precios`

| Columna | Tipo | Regla |
|---|---|---|
| `id` | uuid PK | |
| `organizacion_id` | uuid | FK a `organizaciones`; todas las FK compuestas llevan la organización |
| `nombre` | text | 1 a 80 caracteres tras recortar; único por organización sin distinguir mayúsculas |
| `descripcion` | text null | hasta 300 |
| `ajuste_pct` | numeric(5,2) | −90,00 a +100,00 |
| `archivada_en` | timestamptz null | null = activa |
| `creada_por`, `created_at`, `updated_at` | | `updated_at` es el bloqueo optimista |

Lectura directa: `authenticated` con `clientes` o `ventas` en lectura/edición, acotada por organización. Sin escritura directa ni `DELETE`.

## RPC

| Función | Efecto | Errores |
|---|---|---|
| `guardar_lista_precios(p_id uuid, p_nombre text, p_descripcion text, p_ajuste_pct numeric, p_actualizado timestamptz) returns uuid` | Crea (`p_id` null) o edita; idempotente; deja `lista_precios.creada` o `lista_precios.editada` (anterior y nuevo porcentaje) | `42501`, `22023` (nombre vacío o largo), `23514`/`22003` (ajuste fuera de rango o con más de 2 decimales), `23505` (nombre repetido), `40001` (cambió mientras editabas), `P0002`, `55000` (bandera apagada) |
| `archivar_lista_precios(p_id uuid, p_actualizado timestamptz)` | Archiva; repetirla no falla | `42501`, `P0002`, `40001`, `23503` con `hint = 'clientes_asignados'` y la cantidad en el mensaje |
| `restaurar_lista_precios(p_id uuid, p_actualizado timestamptz)` | Restaura | `42501`, `P0002`, `40001` |
| `asignar_lista_precios_cliente(p_cliente uuid, p_lista uuid)` | Asigna o quita (`p_lista` null); idempotente; deja `cliente.lista_precio_asignada` (cliente, lista anterior y nueva) | `42501`, `P0002` (cliente o lista ajena o inexistente), `22023` (lista archivada, cliente archivado o Consumidor final), `55000` (bandera apagada, salvo quitar) |

## Vista

`public.listas_precios_resumen` (`security_invoker`): `id`, `nombre`, `descripcion`, `ajuste_pct`, `archivada_en`, `updated_at`, `clientes_asignados` (conteo de clientes activos y archivados con esa lista).

## Motor de precio (`private`)

- `private.lista_precios_cliente(p_cliente uuid)` devuelve `(lista_id, ajuste_pct)` si el cliente tiene una lista **activa**, su organización coincide y la bandera `listas_precios` está encendida; si no, vacío.
- Fórmula de la lista (D3): `round(private.a_pesos(precio_lista, moneda, organizacion, empresa) × (1 + ajuste_pct / 100) / redondeo_pesos) × redondeo_pesos`, con el `redondeo_pesos` de la tienda (10 por omisión). Sin IVA; el IVA se aplica después como siempre.
- `precio_para_calculo` y `precio_linea_venta(_calculo)` conservan firma y columnas; agregan al final `lista_precio_id uuid` y `lista_ajuste_pct numeric` (null cuando no rigió la lista). Precedencia y comparación con la promoción: D5, D6 y D7 de la spec.
- Sin `execute` para `anon` ni `authenticated` en las funciones nuevas.

## Bandera

`public.banderas_plataforma`, clave `listas_precios`, apagada por defecto. Encender: `update public.banderas_plataforma set activa = true where clave = 'listas_precios';` (apagar: `false`). Una clave inexistente cuenta como apagada.

## Eventos de Actividad

`lista_precios.creada`, `lista_precios.editada` (porcentaje anterior y nuevo), `lista_precios.archivada`, `lista_precios.restaurada`, `cliente.lista_precio_asignada`. Sin datos de contacto ni importes.

## Tienda

`publico.precios_cliente_por_dominio(host, productos uuid[])`: misma firma y misma lista blanca (`producto_id`, `escala`, `desde`, `hasta`, `final`). La lista del cliente de la cuenta web activa cambia el valor de `final`; **no** se devuelven el nombre ni el porcentaje de la lista. Visitante, cuenta suspendida o no habilitada: `null`, como hoy.
