# Contrato: gastos y margen después de costos fijos

Todas las RPC son de `public`, `security definer`, `set search_path = ''`, con `revoke execute … from public, anon` y `grant execute … to authenticated`. La organización y el rol salen de la sesión, nunca de un parámetro. Escribir exige `edicion` en `rentabilidad` sobre la empresa; leer exige `lectura` o `edicion`.

## Tabla `dominio.gastos`

| Columna | Tipo | Regla |
|---|---|---|
| `id` | uuid PK | |
| `organizacion_id` | uuid | FK a `organizaciones`; las FK compuestas llevan la organización |
| `empresa_id` | uuid | FK compuesta `(empresa_id, organizacion_id)` a `dominio.empresas`; una sola empresa por gasto |
| `fecha` | date | Define el mes de imputación (hora de Buenos Aires) |
| `categoria` | text | `Alquiler`, `Servicios`, `Sueldos`, `Fletes`, `Insumos`, `Impuestos` u `Otros` |
| `tipo_costo` | text | `fijo` o `variable`; solo `fijo` se prorratea |
| `detalle` | text null | hasta 200 |
| `importe` | numeric(14,2) | mayor que 0, en la moneda original |
| `moneda` | text | `ARS` o `USD` |
| `cotizacion_usada` | numeric(14,4) null | null si ARS; > 0 si USD; congelada al guardar |
| `importe_pesos` | numeric(14,2) | `importe` si ARS; `importe × cotizacion_usada` si USD; congelado |
| `recurrente` | boolean | marca informativa |
| `anulado_en`, `anulado_por`, `motivo_anulacion` | | el motivo es obligatorio si `anulado_en` no es null (≤ 200) |
| `creado_por`, `created_at`, `updated_at` | | `updated_at` es el bloqueo optimista |

Lectura directa: `authenticated` con la sección `rentabilidad` en lectura/edición, acotada por organización y `private.empresas_accesibles()`. Sin escritura directa, sin `DELETE`, sin privilegios para `anon`.

## RPC

| Función | Efecto | Errores |
|---|---|---|
| `guardar_gasto(p_id uuid, p_empresa uuid, p_fecha date, p_categoria text, p_tipo_costo text, p_detalle text, p_importe numeric, p_moneda text, p_recurrente boolean, p_actualizado timestamptz) returns uuid` | Crea (`p_id` null) o edita; congela cotización e importe en pesos; deja `gasto.creado` o `gasto.editado` (anterior y nuevo) | `42501`, `P0002` (empresa ajena o inexistente), `22023` (validación, empresa inactiva, sin cotización), `40001` (cambio concurrente) |
| `anular_gasto(p_id uuid, p_motivo text, p_actualizado timestamptz)` | Anula con motivo; repetirla no falla; deja `gasto.anulado` | `42501`, `P0002`, `22023` (sin motivo), `40001` |
| `listar_gastos(p_desde date, p_hasta date, p_empresa uuid, p_categoria text, p_tipo_costo text, p_incluir_anulados boolean, p_cursor_fecha date, p_cursor_id uuid, p_limite integer)` | Devuelve la tanda de gastos con `importe`, `moneda`, `importe_pesos`, `empresa_nombre`; orden `fecha desc, id` | `42501` sin `lectura` |
| `resumen_gastos(p_desde date, p_hasta date, p_empresa uuid, p_categoria text, p_tipo_costo text)` | Total en pesos, conteo y desglose por categoría y tipo; excluye anulados | `42501` sin `lectura` |

`p_empresa` null significa «todas las empresas accesibles». Los períodos del panel (Hoy, Semana, Mes, Mes anterior) los calcula el cliente en hora de Buenos Aires.

## Eventos de Actividad

`gasto.creado`, `gasto.editado` (importe, moneda, categoría, tipo, fecha y empresa, anterior y nuevo), `gasto.anulado` (con motivo) y `gasto.exportado`. Importes y categoría sí; sin datos personales.

## Bandera

`public.banderas_plataforma`: `margen_costos_fijos`, `activa = false` por omisión. `analitica.bandera_activa(clave text) returns boolean`, `execute` solo para `superset_analitica`.

## Vistas de `analitica` (solo lectura, `superset_analitica`)

Todas exponen `organizacion_id`, `empresa_id` y `empresa_nombre` para la cláusula `rls` del guest token.

| Vista | Grano | Columnas |
|---|---|---|
| `analitica.costos_fijos_empresa_mes` | organización × empresa × mes | `mes`, `costos_fijos` (Σ `importe_pesos` de gastos fijos vigentes). **Sin** categoría, detalle ni gasto individual |
| `analitica.ventas_netas_empresa_mes` | organización × empresa × mes | `mes`, `ventas_netas` (Σ `signo_comprobante` × `subtotal_sin_iva`, con `comprobante_cuenta_como_facturado`, incluidas las líneas sin costo) |
| `analitica.margen_despues_costos_fijos` | empresa × producto × fecha | todas las columnas de `analitica.margen_real_categoria` + `tasa_fija`, `cargo_costos_fijos`, `margen_despues_fijos`, `margen_despues_fijos_pct`. Sin filas con la bandera apagada |

Fórmula: `tasa_fija = costos_fijos ÷ ventas_netas` (null si `ventas_netas ≤ 0`); `cargo_costos_fijos = vendido × coalesce(tasa_fija, 0)`; `margen_despues_fijos = margen − cargo_costos_fijos`; `margen_despues_fijos_pct = margen_despues_fijos ÷ vendido` (null si `vendido ≤ 0`).

**Garantía**: `analitica.rentabilidad_ventas_real`, `analitica.margen_real_categoria`, `analitica.margen_producto_canal` y las demás vistas existentes **no se redefinen** ni cambian de resultado.
