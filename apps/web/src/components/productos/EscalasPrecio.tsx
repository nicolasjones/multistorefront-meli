import { Box, Stack, Typography } from '@mui/material'
import { useEscalasPrecio } from '../../hooks/useEscalasPrecio'
import { ESCALAS_PRECIO, type EscalaPrecio } from '../../lib/escalasPrecio'
import { formatearCosto } from '../../lib/productosListado'

const SUBTITULO = 'Minorista usa x1 · Mayorista usa la escala según la cantidad'

// «Precios por escala · sin IVA» (F-CAT-16, FR-004): solo lectura, alimentado por Precios (F-PRE-15).
// Sin datos de Precios muestra «No disponible»; no se calcula ni se edita nada acá.
export function EscalasPrecio({ productoId }: { productoId: string }) {
  const { escalas, cargando } = useEscalasPrecio(productoId)
  const porClave = new Map<string, EscalaPrecio>((escalas ?? []).map((escala) => [escala.clave, escala]))
  const hayDatos = escalas !== null && escalas.length > 0

  return (
    <Box component="section" aria-labelledby="escalas-precio-titulo">
      <Typography id="escalas-precio-titulo" variant="t3" component="h2">Precios por escala · sin IVA</Typography>
      <Typography variant="caption" color="text.secondary">{SUBTITULO}</Typography>
      {cargando ? (
        <Typography variant="b" color="text.secondary" sx={{ display: 'block', mt: 1 }} role="status">Cargando…</Typography>
      ) : !hayDatos ? (
        <Typography variant="b" color="text.secondary" sx={{ display: 'block', mt: 1 }}>No disponible</Typography>
      ) : (
        <Stack component="dl" direction="row" spacing={3} useFlexGap flexWrap="wrap" sx={{ m: 0, mt: 1 }}>
          {ESCALAS_PRECIO.map(({ clave, rango }) => (
            <Box key={clave}>
              <Typography component="dt" variant="xs">{`${clave} · ${rango}`}</Typography>
              <Typography component="dd" variant="b" sx={{ m: 0 }}>{formatearCosto(porClave.get(clave)?.precio)}</Typography>
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  )
}
