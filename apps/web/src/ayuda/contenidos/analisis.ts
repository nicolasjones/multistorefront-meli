import type { AyudaPorDestino } from '../tipos'

export const ayudaAnalisis: AyudaPorDestino = {
  rentabilidad: {
    titulo: 'Rentabilidad',
    resumen:
      'Muestra cuánto ganás sobre el precio sin IVA en cada producto y en cada empresa, comparando todas las de tu organización. Tiene pestañas: Resumen, Por producto, Comparativo, Historia, Ventas reales y Costos adicionales. Para calcular el margen necesitás tener cargado el costo de los productos.',
    pasos: [
      'Entrá a Resumen para ver el margen por empresa y el total consolidado.',
      'Si aparece el aviso de productos en riesgo, tocá «Ver detalle» para revisarlos.',
      'Usá «Por producto» para buscar y filtrar el margen de cada producto.',
      'En «Comparativo» mirá el margen del mismo producto en cada empresa.',
      'Con permiso de edición, ajustá el margen bajo desde «Umbral de margen bajo».',
    ],
  },
}
