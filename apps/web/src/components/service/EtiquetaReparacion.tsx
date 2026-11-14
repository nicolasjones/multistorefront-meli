import { Box } from '@mui/material'
import { distribucionDeEtiqueta, type TextosEtiqueta } from '../../lib/etiquetaReparacion'
import type { QrSvg } from '../../lib/qr/svg'

// Hoja de la etiqueta con QR (F-SVC-32, P-4, FR-044/046/048). Negro sobre blanco, como `DocumentoA4`. El QR es un único
// `<path>` de SVG armado por el generador propio (sin `dangerouslySetInnerHTML`) y solo lleva los cuatro textos previstos:
// código, tienda, equipo e ingreso. Las medidas van en `cqw` (unidades del contenedor) y, al imprimir, el contenedor mide
// exactamente ancho × alto en mm: lo que se ve en pantalla es lo que sale en papel.
type Props = {
  textos: TextosEtiqueta
  qr: QrSvg
  ancho: number
  alto: number
  // Copia que solo existe para imprimir (la vista previa muestra una).
  soloImpresion?: boolean
}

export function EtiquetaReparacion({ textos, qr, ancho, alto, soloImpresion = false }: Props) {
  const d = distribucionDeEtiqueta(ancho, alto, textos.codigo.length)
  const cqw = (mm: number) => `${(mm / ancho) * 100}cqw`
  const horizontal = d.disposicion === 'horizontal'
  const linea = { m: 0, lineHeight: 1.15, overflowWrap: 'anywhere' as const }
  return (
    <Box
      className="etiqueta-copia"
      data-solo-impresion={soloImpresion ? 'true' : undefined}
      sx={{
        // En pantalla la vista previa se agranda hasta 3 veces (sin pasar del ancho disponible); al imprimir mide ancho × alto.
        width: `min(100%, ${ancho * 3}mm)`,
        containerType: 'inline-size',
        display: soloImpresion ? 'none' : 'block',
        '@media print': { display: 'block', width: `${ancho}mm`, height: `${alto}mm`, breakAfter: 'page', '&:last-of-type': { breakAfter: 'auto' } },
      }}
    >
      <Box
        sx={{
          boxSizing: 'border-box',
          width: '100%',
          aspectRatio: `${ancho} / ${alto}`,
          bgcolor: '#fff',
          color: '#000',
          border: '1px dashed',
          borderColor: 'divider',
          overflow: 'hidden',
          p: cqw(d.margen),
          display: 'flex',
          flexDirection: horizontal ? 'row' : 'column',
          alignItems: horizontal ? 'center' : 'stretch',
          gap: cqw(d.separacion),
          '@media print': { border: 'none' },
        }}
      >
        <Box sx={{ flex: 'none', width: cqw(d.lado), height: cqw(d.lado), alignSelf: horizontal ? 'center' : 'flex-start', lineHeight: 0 }}>
          <svg
            role="img"
            aria-label={`Código QR de la reparación ${textos.codigo}`}
            shapeRendering="crispEdges"
            viewBox={qr.viewBox}
            width="100%"
            height="100%"
            style={{ display: 'block' }}
          >
            <rect width={qr.lado} height={qr.lado} fill="#fff" />
            <path d={qr.path} fill="#000" />
          </svg>
        </Box>
        <Box sx={{ minWidth: 0, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: cqw(d.fuenteTexto * 0.25) }}>
          <Box component="p" sx={{ ...linea, fontWeight: 700, fontSize: cqw(d.fuenteCodigo) }}>{textos.codigo}</Box>
          <Box component="p" sx={{ ...linea, fontSize: cqw(d.fuenteTexto), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{textos.tienda}</Box>
          <Box
            component="p"
            sx={{ ...linea, fontSize: cqw(d.fuenteTexto), display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          >
            {textos.equipo}
          </Box>
          <Box component="p" sx={{ ...linea, fontSize: cqw(d.fuenteTexto) }}>{textos.ingreso}</Box>
        </Box>
      </Box>
    </Box>
  )
}
