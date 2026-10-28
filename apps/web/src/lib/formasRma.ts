import type { VarianteEtiqueta } from '../components/base/EtiquetaEstado'

// Formas de RMA (F-VTA-28, MSF-288, FR-003). Único catálogo del frontend: el diálogo «Nueva devolución», el listado y el
// filtro lo reutilizan. Son valores fijos (no una tabla editable): en la base viven como `check` de `dominio.rma.forma_rma`.
// Etiquetas, descripciones y tonos salen del prototipo `VentasDevoluciones.dc.html` (constante FORMAS).

export type FormaRma = 'cambio_directo' | 'enviado_a_proveedor' | 'faltante_envio' | 'reclamo_faltante' | 'devolucion_importe'

type DefinicionForma = { valor: FormaRma; etiqueta: string; descripcion: string; tono: VarianteEtiqueta }

export const FORMAS_RMA: ReadonlyArray<DefinicionForma> = [
  { valor: 'cambio_directo', etiqueta: 'Cambio directo', descripcion: 'Se entrega otro producto en el momento', tono: 'info' },
  { valor: 'enviado_a_proveedor', etiqueta: 'Enviado a proveedor', descripcion: 'El ítem vuelve al proveedor para reparación o cambio', tono: 'primario' },
  { valor: 'faltante_envio', etiqueta: 'Faltante en envío', descripcion: 'El paquete llegó incompleto', tono: 'aviso' },
  { valor: 'reclamo_faltante', etiqueta: 'Reclamo faltante', descripcion: 'Reclamo abierto al transporte o al proveedor', tono: 'error' },
  { valor: 'devolucion_importe', etiqueta: 'Devolución de importe', descripcion: 'Se reintegra el pago al cliente', tono: 'neutral' },
]

export const definicionForma = (forma: string): DefinicionForma =>
  FORMAS_RMA.find((definicion) => definicion.valor === forma) ?? { valor: 'cambio_directo', etiqueta: forma, descripcion: '', tono: 'neutral' }
