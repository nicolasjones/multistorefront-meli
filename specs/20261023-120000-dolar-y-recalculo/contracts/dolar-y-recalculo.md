# Contratos: Dólar y recálculo (MSF-116)

Todas viven en `public`, con `revoke execute … from public, anon` y `grant execute … to authenticated`. Permiso: `private.nivel_seccion('cotizacion_dolar')`.

## F-PRE-02

```ts
cargar_cotizacion(p_valor: number): { valor: number; anterior: number | null; variacion_pct: number | null; expira_en: string }
```
Requiere `edicion`. Valor `> 0`. Reemplaza la pendiente de la organización. Errores: `42501` sin permiso, `22003`/`23514` valor inválido.

```ts
estado_cotizacion(): {
  vigente: { valor: number; cargada_en: string; cargada_por: string } | null;
  productos_usd: number;
  pendiente: { valor: number; expira_en: string } | null;
}
```
Requiere `lectura`. La pendiente vencida no se devuelve.

## F-PRE-03

```ts
previsualizar_cotizacion(): {
  variacion_pct: number; recalcula: boolean;
  empresas: { empresa_id: string; nombre: string; precios: number }[];
  muestra: { producto: string; sku: string; usd: number; por_empresa: { empresa_id: string; hoy: number | null; nuevo: number | null }[] }[];
}
```
Requiere `edicion`. Solo lee.

```ts
confirmar_cotizacion(): { id: string; recalculo_aplicado: boolean; precios_recalculados: number }
```
Requiere `edicion`. `security definer` (único camino de escritura al historial). Una transacción. Errores: `sin_cotizacion_pendiente` (no hay o venció), `42501`.

```ts
descartar_cotizacion(): void
```
Requiere `edicion`. Borra la pendiente.

## F-PRE-04

```ts
listar_cotizaciones(p_limite: number, p_cursor: string | null): {
  filas: { id: string; cargada_en: string; valor: number; variacion_pct: number | null; cargada_por_nombre: string; recalculo_aplicado: boolean; precios_recalculados: number }[];
  siguiente_cursor: string | null;
}
```
Requiere `lectura`. Más nueva primero.

## F-PRE-05

```ts
cotizacion_del_dia(): { cargada_hoy: boolean; cargada_en: string | null; cargada_por: string | null; valor: number | null }
```
Requiere `lectura`. «Hoy» en `America/Argentina/Buenos_Aires`; la pendiente no cuenta.

## Sin cambio de firma

`private.a_pesos(numeric, text, uuid)` conserva su firma; solo cambia su fuente (`cotizacion_aplicada`, con respaldo en `cotizacion_inicial`).
