import { Chip } from '@mui/material'
import { ETIQUETA_ESTADO, type EstadoPublico } from '../../../lib/tiendaCuentaDatos'

type Variante = { color: 'warning' | 'success' | 'default' | 'error' | 'info'; contorno: boolean }

// Color y relleno del estado público (spec P-3): «Pendiente» warning, «Aceptado» y «Confirmada» success, «Vencido» neutro con
// contorno, «Anulado»/«Anulada» error con contorno y «Nota de crédito» info. El estado se dice SIEMPRE con texto: el color
// solo acompaña.
const VARIANTES: Record<EstadoPublico, Variante> = {
  pendiente: { color: 'warning', contorno: false },
  aceptado: { color: 'success', contorno: false },
  vencido: { color: 'default', contorno: true },
  anulado: { color: 'error', contorno: true },
  confirmada: { color: 'success', contorno: false },
  anulada: { color: 'error', contorno: true },
  nota_credito: { color: 'info', contorno: false },
}

export function EstadoComprobante({ estado }: { estado: EstadoPublico }) {
  const variante = VARIANTES[estado]
  return <Chip size="small" label={ETIQUETA_ESTADO[estado]} color={variante.color} variant={variante.contorno ? 'outlined' : 'filled'} />
}
