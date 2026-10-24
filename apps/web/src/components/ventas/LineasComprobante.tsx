import { useEffect, useState } from 'react'
import { Alert, Box, Card, CardContent, CardHeader, IconButton, Stack, TextField, Typography } from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { AgregarProductoDialog } from './AgregarProductoDialog'
import { DepositoSelect } from './DepositoSelect'
import { EtiquetaAPedido, FaltanteAviso, StockLinea } from './FaltanteAviso'
import type { DepositoOpcion } from '../../lib/depositos'
import type { ProductoRepuesto } from '../../lib/reparacionItems'
import { formatearPesosPrecio } from '../../lib/precios'
import {
  CANTIDAD_MAXIMA_LINEA,
  MENSAJE_CANTIDAD_LINEA,
  MENSAJE_PRECIO_LINEA,
  MENSAJE_SIN_LINEAS,
  MENSAJE_SIN_PERMISO_PRECIO,
  TEXTO_AYUDA_LINEAS,
  parsearCantidadLinea,
  parsearPrecioLinea,
  rotuloEscalaLinea,
  type EntradaLinea,
  type LineaComprobante,
} from '../../lib/ventasLineas'

type Totales = { subtotal: number; iva: number; total: number }

type Props = {
  lineas: readonly LineaComprobante[]
  totales: Totales
  depositos: readonly DepositoOpcion[]
  /** El documento admite cambios y la persona puede editarlo (la base lo vuelve a verificar al guardar). */
  editable: boolean
  /** Acción `editar_precio` de Ventas: sin ella el precio es de solo lectura (FR-016). */
  puedeEditarPrecio: boolean
  /** Hay un guardado de líneas en curso. */
  ocupado: boolean
  error?: string | null
  onCambiar: (indice: number, cambio: Partial<EntradaLinea>) => void
  onQuitar: (indice: number) => void
  onAgregar: (producto: ProductoRepuesto) => void
}

// Columnas del prototipo: Producto · Stock · Depósito de mercadería · Cantidad · Precio s/IVA · Subtotal.
const COLUMNAS = 'minmax(0, 1fr) 84px 130px 130px 110px 100px'
const ANCHO_MINIMO = 760

const cabecera = { textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 } as const

type FilaProps = {
  linea: LineaComprobante
  indice: number
  depositos: readonly DepositoOpcion[]
  editable: boolean
  puedeEditarPrecio: boolean
  ocupado: boolean
  onCambiar: Props['onCambiar']
  onQuitar: Props['onQuitar']
}

function FilaLinea({ linea, indice, depositos, editable, puedeEditarPrecio, ocupado, onCambiar, onQuitar }: FilaProps) {
  const [cantidad, setCantidad] = useState(String(linea.cantidad))
  const [precio, setPrecio] = useState(String(linea.precio_unitario))
  const [errorCantidad, setErrorCantidad] = useState<string | null>(null)
  const [errorPrecio, setErrorPrecio] = useState<string | null>(null)
  // Lo que la base devolvió manda: si el comprobante se recarga, los campos vuelven a ese valor.
  useEffect(() => {
    setCantidad(String(linea.cantidad))
    setErrorCantidad(null)
  }, [linea.cantidad])
  useEffect(() => {
    setPrecio(String(linea.precio_unitario))
    setErrorPrecio(null)
  }, [linea.precio_unitario, linea.precio_manual])

  const bloqueado = !editable || ocupado
  const nombre = linea.descripcion

  const confirmarCantidad = (texto: string) => {
    const valor = parsearCantidadLinea(texto)
    if (valor === null) {
      setErrorCantidad(MENSAJE_CANTIDAD_LINEA)
      return
    }
    setErrorCantidad(null)
    if (valor !== linea.cantidad) onCambiar(indice, { cantidad: valor })
  }

  const confirmarPrecio = (texto: string) => {
    const valor = parsearPrecioLinea(texto)
    if (valor === undefined) {
      setErrorPrecio(MENSAJE_PRECIO_LINEA)
      return
    }
    setErrorPrecio(null)
    // Vacío = volver al precio de la escala; igual al actual y sin marca manual = sin cambio.
    if (valor === null) {
      if (linea.precio_manual) onCambiar(indice, { precio_manual: null })
      else setPrecio(String(linea.precio_unitario))
      return
    }
    if (valor !== linea.precio_unitario || !linea.precio_manual) {
      if (valor !== linea.precio_unitario) onCambiar(indice, { precio_manual: valor })
    }
  }

  const sumar = (delta: number) => {
    const siguiente = Math.min(Math.max(linea.cantidad + delta, 1), CANTIDAD_MAXIMA_LINEA)
    if (siguiente !== linea.cantidad) onCambiar(indice, { cantidad: siguiente })
  }

  return (
    <Box
      role="row"
      sx={{
        display: 'grid',
        gridTemplateColumns: COLUMNAS,
        gap: 1.25,
        alignItems: 'center',
        px: 2.5,
        py: 1.5,
        borderBottom: '1px solid',
        borderColor: 'divider',
        minWidth: ANCHO_MINIMO,
      }}
    >
      <Box role="cell" sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
          {nombre}
        </Typography>
        {linea.codigo ? (
          <Typography variant="caption" color="text.secondary" component="p">
            {linea.codigo}
          </Typography>
        ) : null}
        <Box sx={{ mt: 0.5 }}>
          <EtiquetaAPedido linea={linea} />
        </Box>
      </Box>
      <Box role="cell">
        <StockLinea linea={linea} />
      </Box>
      <Box role="cell">
        <DepositoSelect
          depositos={depositos}
          valor={linea.deposito_id}
          disabled={bloqueado}
          etiqueta={`Depósito de mercadería de ${nombre}`}
          onCambio={(depositoId) => onCambiar(indice, { deposito_id: depositoId })}
        />
      </Box>
      <Box role="cell">
        <Stack direction="row" spacing={0.5} alignItems="center">
          <IconButton
            size="small"
            aria-label={`Menos unidades de ${nombre}`}
            disabled={bloqueado || linea.cantidad <= 1}
            onClick={() => sumar(-1)}
            sx={{ border: '1px solid', borderColor: 'divider', width: 28, height: 28 }}
          >
            −
          </IconButton>
          <TextField
            size="small"
            value={cantidad}
            disabled={bloqueado}
            error={Boolean(errorCantidad)}
            onChange={(evento) => setCantidad(evento.target.value)}
            onBlur={(evento) => confirmarCantidad(evento.target.value)}
            onKeyDown={(evento) => {
              if (evento.key === 'Enter') {
                evento.preventDefault()
                confirmarCantidad(cantidad)
              }
            }}
            slotProps={{
              htmlInput: {
                'aria-label': `Cantidad de ${nombre}`,
                'aria-describedby': errorCantidad ? `error-cantidad-${linea.id}` : undefined,
                inputMode: 'numeric',
                style: { textAlign: 'center', padding: '4px 2px', width: 36 },
              },
            }}
          />
          <IconButton
            size="small"
            aria-label={`Más unidades de ${nombre}`}
            disabled={bloqueado || linea.cantidad >= CANTIDAD_MAXIMA_LINEA}
            onClick={() => sumar(1)}
            sx={{ border: '1px solid', borderColor: 'divider', width: 28, height: 28 }}
          >
            +
          </IconButton>
        </Stack>
        {errorCantidad ? (
          <Typography id={`error-cantidad-${linea.id}`} variant="caption" color="error" component="p" role="alert">
            {errorCantidad}
          </Typography>
        ) : null}
      </Box>
      <Box role="cell" sx={{ textAlign: 'right' }}>
        {puedeEditarPrecio && editable ? (
          <>
            <TextField
              size="small"
              value={precio}
              disabled={bloqueado}
              error={Boolean(errorPrecio)}
              onChange={(evento) => setPrecio(evento.target.value)}
              onBlur={(evento) => confirmarPrecio(evento.target.value)}
              onKeyDown={(evento) => {
                if (evento.key === 'Enter') {
                  evento.preventDefault()
                  confirmarPrecio(precio)
                }
              }}
              slotProps={{
                htmlInput: {
                  'aria-label': `Precio sin IVA de ${nombre}`,
                  'aria-describedby': errorPrecio ? `error-precio-${linea.id}` : undefined,
                  inputMode: 'decimal',
                  style: { textAlign: 'right', padding: '4px 6px' },
                },
              }}
            />
            {errorPrecio ? (
              <Typography id={`error-precio-${linea.id}`} variant="caption" color="error" component="p" role="alert">
                {errorPrecio}
              </Typography>
            ) : null}
          </>
        ) : (
          <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
            {formatearPesosPrecio(linea.precio_unitario)}
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          {rotuloEscalaLinea(linea)}
        </Typography>
      </Box>
      <Stack role="cell" direction="row" alignItems="center" justifyContent="flex-end" spacing={0.5}>
        <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
          {formatearPesosPrecio(linea.subtotal_sin_iva)}
        </Typography>
        {editable ? (
          <IconButton size="small" aria-label={`Quitar ${nombre}`} disabled={bloqueado} onClick={() => onQuitar(indice)}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        ) : null}
      </Stack>
      <Box sx={{ gridColumn: '1 / -1' }}>
        <FaltanteAviso linea={linea} />
      </Box>
    </Box>
  )
}

// Líneas del comprobante (F-VTA-06, FR-010…FR-019). Presentación y orquestación: el precio, la escala, el IVA y los
// totales los calcula la base al guardar (`guardar_lineas_comprobante`); acá solo se ofrecen los controles y se
// muestra lo que volvió. Texto de ayuda y columnas del prototipo `VentasComprobante`.
export function LineasComprobante({
  lineas,
  totales,
  depositos,
  editable,
  puedeEditarPrecio,
  ocupado,
  error,
  onCambiar,
  onQuitar,
  onAgregar,
}: Props) {
  const depositoPorDefecto = depositos.find((deposito) => deposito.por_defecto) ?? depositos[0] ?? null

  return (
    <Card variant="outlined" component="section" aria-labelledby="lineas-titulo">
      <CardHeader
        title={<Typography id="lineas-titulo" variant="h6" component="h2">Líneas</Typography>}
        subheader={TEXTO_AYUDA_LINEAS}
        action={<AgregarProductoDialog disabled={!editable || ocupado} depositoPorDefecto={depositoPorDefecto} onElegir={onAgregar} />}
        sx={{ alignItems: 'flex-start', '& .MuiCardHeader-action': { alignSelf: 'flex-start', mt: 0.5 } }}
      />
      {error ? (
        <Box sx={{ px: 2.5, pb: 1 }}>
          <Alert severity="error">{error}</Alert>
        </Box>
      ) : null}
      {editable && !puedeEditarPrecio && lineas.length > 0 ? (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ px: 2.5, pb: 1 }}>
          {MENSAJE_SIN_PERMISO_PRECIO}
        </Typography>
      ) : null}
      <Box sx={{ overflowX: 'auto' }}>
        <Box
          role="table"
          aria-label="Líneas del comprobante"
          aria-busy={ocupado}
          sx={{ minWidth: ANCHO_MINIMO }}
        >
          <Box
            role="row"
            sx={{
              display: 'grid',
              gridTemplateColumns: COLUMNAS,
              gap: 1.25,
              px: 2.5,
              py: 1,
              borderTop: '1px solid',
              borderBottom: '1px solid',
              borderColor: 'divider',
              minWidth: ANCHO_MINIMO,
            }}
          >
            <Typography role="columnheader" variant="caption" color="text.secondary" sx={cabecera}>Producto</Typography>
            <Typography role="columnheader" variant="caption" color="text.secondary" sx={cabecera}>Stock</Typography>
            <Typography role="columnheader" variant="caption" color="text.secondary" sx={cabecera}>Depósito de mercadería</Typography>
            <Typography role="columnheader" variant="caption" color="text.secondary" sx={cabecera}>Cantidad</Typography>
            <Typography role="columnheader" variant="caption" color="text.secondary" sx={{ ...cabecera, textAlign: 'right' }}>Precio s/IVA</Typography>
            <Typography role="columnheader" variant="caption" color="text.secondary" sx={{ ...cabecera, textAlign: 'right' }}>Subtotal</Typography>
          </Box>
          {lineas.map((linea, indice) => (
            <FilaLinea
              key={linea.id}
              linea={linea}
              indice={indice}
              depositos={depositos}
              editable={editable}
              puedeEditarPrecio={puedeEditarPrecio}
              ocupado={ocupado}
              onCambiar={onCambiar}
              onQuitar={onQuitar}
            />
          ))}
        </Box>
      </Box>
      {lineas.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 2.5, py: 3 }}>
          {MENSAJE_SIN_LINEAS}
        </Typography>
      ) : null}
      <CardContent>
        <Stack spacing={0.75} sx={{ ml: 'auto', width: { xs: '100%', sm: 300 } }} aria-label="Totales del comprobante">
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="body2" color="text.secondary">Subtotal sin IVA</Typography>
            <Typography variant="body2">{formatearPesosPrecio(totales.subtotal)}</Typography>
          </Stack>
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="body2" color="text.secondary">IVA</Typography>
            <Typography variant="body2">{formatearPesosPrecio(totales.iva)}</Typography>
          </Stack>
          <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1 }}>
            <Typography sx={{ fontWeight: 700 }}>Total</Typography>
            <Typography variant="h5" component="p" sx={{ fontWeight: 700 }}>{formatearPesosPrecio(totales.total)}</Typography>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  )
}
