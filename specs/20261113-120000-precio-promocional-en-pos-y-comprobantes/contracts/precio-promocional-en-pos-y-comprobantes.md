# Contrato: precio promocional en ventas (interno + RPC existentes)

**Spec**: [../spec.md](../spec.md) · **Plan**: [../plan.md](../plan.md). Ninguna RPC nueva de `public`: se cambia el comportamiento de cuatro existentes (misma firma) y se agregan funciones `private`.

## `private.precio_linea_venta` (nueva)

`security invoker` (hereda la compuerta de `precio_para`); `revoke execute … from public, anon, authenticated`: solo la ejecutan las RPC `security definer` (`guardar_lineas_comprobante`, `copiar_presupuesto`, `private.lineas_con_promocion_desactualizada`). La promoción la lee `private.promocion_vigente_fila` (`security definer`, `search_path = ''`, filtra por `organizacion_id`, mismo `revoke`).

| Entrada | Tipo | Notas |
|---|---|---|
| `p_producto`, `p_empresa` | uuid | la empresa es la **del comprobante** |
| `p_tipo_cliente` | text | `clientes.tipo` (`minorista` / `mayorista`) |
| `p_cantidad` | integer | define la escala con `private.escala_para_linea` |
| `p_descuento` | numeric | `clientes.descuento` (%); se ignora si `p_aplicar_descuento` es false o si gana la promoción |
| `p_ahora` | timestamptz | las RPC pasan `clock_timestamp()` tomado después del `for update`; el valor por defecto `now()` y el parámetro sirven para pruebas |
| `p_aplicar_descuento` | boolean | `false` en `copiar_presupuesto` (conserva el comportamiento actual) |

| Salida | Significado |
|---|---|
| `escala_usada` | como `precio_para` |
| `neto_unitario` | importe cobrado por unidad, sin IVA, 2 decimales |
| `precio_referencia` | precio normal sin promoción; **null si no ganó la promoción** |
| `promocion_id` | promoción aplicada; null si no ganó |
| `descuento_aplicado` | % de descuento efectivamente aplicado (0 si ganó la promoción) |
| `alicuota_*` | como `precio_para` |

Regla: `neto_unitario = least(round(neto_escala × (1 − d/100), 2), promoción vigente de la tienda)`; la promoción solo cuenta con la bandera `promociones_precio` encendida y `desde <= p_ahora < hasta`, no anulada. Sin fila si `precio_para` no devuelve fila.

## RPC existentes que cambian

| RPC | Cambio | Errores nuevos |
|---|---|---|
| `guardar_lineas_comprobante(p_id, p_lineas, p_actualizado_en)` | precio por `precio_linea_venta`; la línea guarda `precio_referencia` y `promocion_id`; las claves `precio_referencia`/`promocion_id` dentro de `p_lineas` se ignoran | ninguno |
| `obtener_comprobante(p_id)` | cada línea suma `precio_referencia` (number\|null); **no** expone `promocion_id` (un rol de ventas sin `productos` no debe recibir un identificador de promoción que no puede leer) | ninguno |
| `confirmar_comprobante(p_id)` | guarda de precios desactualizados antes de mover stock; no actúa con la bandera apagada y omite las líneas sin precio calculable | `40001` con `hint = 'precios_cambiaron'`; sin efectos |
| `copiar_presupuesto(p_id)` | precio por `precio_linea_venta` sin descuento; guarda las dos columnas | ninguno |

Grants sin cambios (`authenticated`; `revoke … from public, anon`). El contrato de la API pública (`/v1/ventas`, `/v1/precios`) **no cambia**.
