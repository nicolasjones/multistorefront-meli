import type { ReactNode } from 'react'
import { Box, Button, GlobalStyles, Typography } from '@mui/material'
import { ROTULO_NO_FISCAL, ROTULO_SIN_IVA, contactoDeTienda, type DatosTienda } from '../../lib/documentosReparacion'

// Hoja A4 de los documentos de Service (F-SVC-07, FR-043). La impresión es desde el navegador: los estilos de
// impresión ocultan navegación, encabezado y botones (`.no-imprimir`) y fijan el tamaño de página.
const ESTILOS_IMPRESION = {
  '@page': { size: 'A4', margin: '12mm' },
  '@media print': {
    '.MuiAppBar-root, .MuiDrawer-root, nav, .no-imprimir': { display: 'none !important' },
    body: { background: '#fff !important' },
    '.hoja-a4': { boxShadow: 'none !important', border: 'none !important', margin: '0 !important', padding: '0 !important', width: 'auto !important' },
  },
}

export function DocumentoA4({
  titulo,
  numero,
  tienda,
  mostrarIva = false,
  volver,
  children,
}: {
  titulo: string
  numero: string
  tienda: DatosTienda
  mostrarIva?: boolean
  volver?: ReactNode
  children: ReactNode
}) {
  const contacto = contactoDeTienda(tienda)
  return (
    <Box>
      <GlobalStyles styles={ESTILOS_IMPRESION} />
      <Box className="no-imprimir" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, gap: 2, flexWrap: 'wrap' }}>
        <Box>{volver}</Box>
        <Button variant="contained" onClick={() => window.print()}>Imprimir</Button>
      </Box>
      <Box
        component="article"
        className="hoja-a4"
        aria-label={`${titulo} ${numero}`}
        sx={{ bgcolor: '#fff', color: '#000', maxWidth: '210mm', mx: 'auto', p: '12mm', border: '1px solid', borderColor: 'divider', boxShadow: 1 }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, borderBottom: '2px solid #000', pb: 1.5, mb: 2 }}>
          <Box>
            <Typography component="p" variant="h6" sx={{ fontWeight: 700 }}>{tienda.nombre}</Typography>
            {contacto.map((linea) => (
              <Typography key={linea} component="p" variant="body2">{linea}</Typography>
            ))}
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography component="h1" variant="h6" sx={{ fontWeight: 700 }}>{titulo}</Typography>
            <Typography component="p" variant="body1">{numero}</Typography>
          </Box>
        </Box>
        {children}
        <Typography component="p" variant="caption" sx={{ display: 'block', mt: 3, borderTop: '1px solid #000', pt: 1 }}>
          {ROTULO_NO_FISCAL}
          {mostrarIva ? ` · ${ROTULO_SIN_IVA}` : ''}
        </Typography>
      </Box>
    </Box>
  )
}
