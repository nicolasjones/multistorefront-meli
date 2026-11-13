// Módulo 08 · Dólar de hoy. Se carga al FINAL, después de las ventas y los cobros: así los comprobantes ya hechos quedan
// con el dólar de su momento (como en la vida real) y solo cambian la cotización vigente y los precios en pesos de los
// productos en USD. `99-fechas.sql` reparte las fechas de todas las cotizaciones y deja esta como la de hoy.
export const nombre = 'Cotización del dólar de hoy'

export const DOLAR_ACTUAL = 1570

export async function sembrar(ctx) {
  const adm = await ctx.sesion('admin')
  await adm.rpc('cargar_cotizacion', { p_valor: DOLAR_ACTUAL })
  const r = await adm.rpc('confirmar_cotizacion')
  ctx.log(`dólar vigente: ${DOLAR_ACTUAL} (${Number(r?.precios_recalculados ?? 0)} precios recalculados)`)
}
