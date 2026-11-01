# Contratos: Configuración dólar y precio propio (MSF-352)

Todas viven en `public`, con `revoke execute … from public, anon` y `grant execute … to authenticated`. Permisos: `private.nivel_seccion('cotizacion_dolar')` (F-PRE-06) y `private.nivel_seccion('productos')` (F-PRE-08).

## F-PRE-06

```ts
obtener_configuracion_cotizacion(): {
  alcance: 'sistema' | 'empresa'; redondeo_pesos: number; umbral_pct: number;
  confirmacion_pct: number; aviso_activo: boolean;
}
```
Requiere `lectura`. Sin fila devuelve los valores del lanzamiento (`sistema`, 10, 1, 15, true).

```ts
guardar_configuracion_cotizacion(p_redondeo: number, p_umbral: number, p_confirmacion: number, p_aviso: boolean): { actualizado: boolean }
```
Requiere `edicion`. No cambia el alcance. Errores: `42501` sin permiso, `22023` valor fuera de rango (umbral 0–100, confirmación > umbral y ≤ 100, redondeo no admitido). Idempotente.

```ts
previsualizar_cambio_alcance(p_alcance: 'sistema' | 'empresa'): {
  empresas: { empresa_id: string; nombre: string; precios_que_cambian: number }[];
  muestra: { producto: string; sku: string; por_empresa: { empresa_id: string; hoy: number | null; nuevo: number | null }[] }[];
}
```
Requiere `edicion`. Solo lee.

```ts
cambiar_alcance_cotizacion(p_alcance: 'sistema' | 'empresa', p_confirmado: boolean): { alcance: string; precios_afectados: number }
```
Requiere `edicion`. Una transacción; `p_confirmado = false` rechaza (`22023`). Registra la actividad.

BREAKING: `previsualizar_cotizacion`, `confirmar_cotizacion`, `descartar_cotizacion` y `cotizacion_del_dia` reciben `p_empresa uuid default null`; con el valor por omisión mantienen el contrato actual (compatibles hacia atrás; el parámetro es obligatorio solo si el alcance es `empresa`, error `22023`).

## F-PRE-08

```ts
fijar_precio_propio(p_producto: string, p_empresa: string, p_moneda: 'ARS' | 'USD', p_importe: number): { moneda: string; importe: number }
```
Requiere `productos` = `edicion`. Crea o actualiza. Errores: `42501`, `22023` (moneda), `22003`/`23514` (importe), `P0002` (producto o empresa inexistente o de otra organización).

```ts
quitar_precio_propio(p_producto: string, p_empresa: string): void
```
Requiere `edicion`. Idempotente.

```ts
leer_precios_propios(p_producto: string): { empresa_id: string; moneda: string; importe: number }[]
```
Requiere `productos` ≥ `lectura`.

`public.precios_empresa_neto` suma la columna `precio_propio boolean` (aditiva).

## F-PRE-09

```ts
previsualizar_precios_empresa(p_empresa: string, p_base: string, p_ajuste: number, p_limite: number): {
  producto_id: string; nombre: string; sku: string; moneda: string;
  central_ars: number | null; neto_ars: number | null; precio_propio: boolean;  // precio_propio es nueva
}[]
```
Firma de entrada sin cambios; se agrega la columna de salida `precio_propio` (aditivo, no BREAKING). Solo lee.
