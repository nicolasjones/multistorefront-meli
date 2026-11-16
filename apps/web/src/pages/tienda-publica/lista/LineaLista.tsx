import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import { Box, Button, Chip, IconButton, Link, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import { Link as EnlaceRuta } from 'react-router'
import { MiniaturaProducto } from '../../../components/base/MiniaturaProducto'
import { MAX_UNIDADES_LINEA } from '../../../lib/listaPedido'
import { formatearPrecioArs } from '../../../lib/tiendaListado'
import type { LineaRevalidada } from '../../../lib/tiendaPedido'
import { PrecioTachado } from '../catalogo/PrecioTachado'
import EtiquetaDisponibilidad from '../disponibilidad/EtiquetaDisponibilidad'
import { LINEA_SUAVE } from '../layout/medidas'

export const TEXTO_SIN_STOCK_LINEA = 'Sin stock hoy: lo confirmamos al responder'
export const TEXTO_PRECIO_A_CONFIRMAR = 'Precio a confirmar'

// Una línea de la lista (MSF-176, B1, FR-021, P-4): miniatura (con zoom), nombre (enlace a la ficha), SKU y disponibilidad, precio de referencia con el anterior tachado (igual que la
// ficha) o «Precio a confirmar», cantidad editable (entero de 1 a 9.999) entre «−» y «+», subtotal de referencia y «Quitar». Con cuenta mayorista se rotula la escala («Escala x10»).
// El texto de nombre y SKU va como nodo de React: un nombre con HTML se ve literal.
export function LineaLista({ linea, cantidad, imagenUrl, alRenovarImagen, mostrarEscala, alCambiarCantidad, alQuitar }: {
  linea: LineaRevalidada
  // Cantidad vigente en la lista local (la del servidor puede estar un paso atrás mientras se revalida).
  cantidad: number
  imagenUrl: string | null
  alRenovarImagen?: () => void
  mostrarEscala: boolean
  alCambiarCantidad: (cantidad: number) => void
  alQuitar: () => void
}) {
  const [texto, setTexto] = useState<string | null>(null)
  const subtotal = linea.precioUnitario === null ? null : Math.round(linea.precioUnitario * cantidad * 100) / 100
  const formateado = subtotal === null ? null : formatearPrecioArs(subtotal)
  const confirmarTexto = () => {
    setTexto(null)
  }
  const cambiar = (valor: string) => {
    const digitos = valor.replace(/\D/g, '').slice(0, 4)
    setTexto(digitos)
    const numero = Number(digitos)
    if (digitos !== '' && numero >= 1 && numero <= MAX_UNIDADES_LINEA) alCambiarCantidad(numero)
  }
  return (
    <Box component="li" data-testid="linea-lista" sx={{ display: 'flex', gap: 2, py: 2, borderBottom: LINEA_SUAVE, minWidth: 0, flexWrap: { xs: 'wrap', sm: 'nowrap' } /* estilos-sueltos: ok */ }}>
      <Box sx={{ display: 'flex', gap: 2, minWidth: 0, flex: 1, flexBasis: { xs: '100%', sm: 0 } }}>
        <MiniaturaProducto alt="" src={imagenUrl} onFallo={alRenovarImagen} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Link component={EnlaceRuta} to={`/producto/${encodeURIComponent(linea.productoId)}`} color="inherit" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{linea.nombre}</Link>
          <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5 }}>
            {linea.sku ? <Typography component="span" color="text.secondary" sx={{ fontSize: 13, overflowWrap: 'anywhere' /* estilos-sueltos: ok */ }}>SKU {linea.sku}</Typography> : null}
            <EtiquetaDisponibilidad disponible={linea.disponible} />
          </Box>
          {!linea.disponible ? <Typography color="text.secondary" sx={{ fontSize: 13, mt: 0.5 /* estilos-sueltos: ok */ }}>{TEXTO_SIN_STOCK_LINEA}</Typography> : null}
          <Box sx={{ mt: 0.5 }}>
            {linea.precioUnitario === null
              ? <Typography sx={{ fontWeight: 600 }}>{TEXTO_PRECIO_A_CONFIRMAR}</Typography>
              : <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 1 }}>
                  <Typography component="span" color="text.secondary" sx={{ fontSize: 13 /* estilos-sueltos: ok */ }}>Precio de referencia</Typography>
                  <PrecioTachado precio={linea.precioUnitario} precioAnterior={linea.precioAnterior} variant="body1" tamano={16} />
                  {mostrarEscala ? <Typography component="span" color="text.secondary" sx={{ fontSize: 13 /* estilos-sueltos: ok */ }}>Escala {linea.escala}</Typography> : null}
                </Box>}
          </Box>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, justifyContent: { xs: 'space-between', sm: 'flex-end' }, width: { xs: '100%', sm: 'auto' }, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <IconButton aria-label={`Quitar una unidad de ${linea.nombre}`} disabled={cantidad <= 1} onClick={() => alCambiarCantidad(cantidad - 1)} sx={{ width: (tema) => tema.spacing(5.5), height: (tema) => tema.spacing(5.5) }}><RemoveIcon /></IconButton>
          <TextField
            value={texto ?? String(cantidad)}
            onChange={(evento) => cambiar(evento.target.value)}
            onBlur={confirmarTexto}
            size="small"
            slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-label': `Cantidad de ${linea.nombre}`, maxLength: 4, style: { textAlign: 'center', width: '5ch' } } }}
          />
          <IconButton aria-label={`Sumar una unidad de ${linea.nombre}`} disabled={cantidad >= MAX_UNIDADES_LINEA} onClick={() => alCambiarCantidad(cantidad + 1)} sx={{ width: (tema) => tema.spacing(5.5), height: (tema) => tema.spacing(5.5) }}><AddIcon /></IconButton>
        </Box>
        {formateado ? <Typography sx={{ fontWeight: 600 }}>Subtotal {formateado}</Typography> : null}
        <Button size="small" variant="text" aria-label={`Quitar ${linea.nombre} de la lista`} onClick={alQuitar} sx={{ minHeight: (tema) => tema.spacing(5.5) }}>Quitar</Button>
      </Box>
    </Box>
  )
}

// Línea de un producto que ya no está disponible (FR-023): en gris, con el chip «No disponible» y solo «Quitar». No cuenta en el total. El servidor no devuelve nada de un
// producto no disponible (inexistente, oculto o ajeno son indistinguibles): si la pantalla lo vio antes, muestra su nombre; si no, un texto genérico.
export function LineaNoDisponible({ nombre, alQuitar }: { nombre: string | null; alQuitar: () => void }) {
  const texto = nombre ?? 'Producto que ya no está disponible'
  return (
    <Box component="li" data-testid="linea-no-disponible" sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, py: 2, borderBottom: LINEA_SUAVE }}>
      <Typography sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', color: 'text.secondary' }}>{texto}</Typography>
      <Chip size="small" label="No disponible" />
      <Button size="small" variant="text" aria-label={`Quitar ${texto} de la lista`} onClick={alQuitar} sx={{ minHeight: (tema) => tema.spacing(5.5) }}>Quitar</Button>
    </Box>
  )
}
