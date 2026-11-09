import { useEffect, useRef, useState } from 'react'
import { Box, Button, Chip, IconButton, InputAdornment, Stack, TextField, Typography } from '@mui/material'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import CloseIcon from '@mui/icons-material/Close'
import SearchIcon from '@mui/icons-material/Search'
import {
  type Relacionado,
  buscarRelacionables,
  detalleRelacionado,
  etiquetaContador,
  moverRelacionado,
} from '../../lib/productos-relacionados'
import { supabaseClient } from '../../lib/supabase'

type Props = {
  // Producto que se edita (se excluye del buscador); null en el alta.
  productoId: string | null
  seleccion: readonly Relacionado[]
  onCambiar: (seleccion: Relacionado[]) => void
  cargando?: boolean
  hayError?: boolean
  onReintentar?: () => void
  // Sin edición en Productos (FR-017): se ve la lista sin poder cambiarla.
  soloLectura?: boolean
  deshabilitado?: boolean
}

const ESPERA_BUSQUEDA_MS = 250
const TITULO = 'Productos relacionados'
const SUBTITULO = 'Se muestran como «Productos relacionados» en la ficha pública de las tiendas y se sugieren al agregar una línea en un comprobante.'

// Bloque «Productos relacionados» del alta y la edición (F-CAT-18, FR-014…FR-016): buscador por nombre,
// SKU o categoría (hasta 4 resultados), lista ordenada con ↑ ↓ ✕ y avisos. El orden de la lista es el que
// ve el cliente y el que se guarda. La empresa activa no cambia el bloque (los productos son únicos y
// compartidos entre empresas), por eso no consulta ni filtra por ella.
export function BloqueRelacionados({ productoId, seleccion, onCambiar, cargando = false, hayError = false, onReintentar, soloLectura = false, deshabilitado = false }: Props) {
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState<Relacionado[]>([])
  const [buscado, setBuscado] = useState(false)
  const [errorBusqueda, setErrorBusqueda] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const ultimaBusqueda = useRef(0)
  const idsExcluidos = [...(productoId ? [productoId] : []), ...seleccion.map((item) => item.id)].join(',')

  useEffect(() => {
    const consulta = texto.trim()
    const peticion = ++ultimaBusqueda.current
    if (consulta === '' || soloLectura) {
      setResultados([])
      setBuscado(false)
      setErrorBusqueda(false)
      return undefined
    }
    const espera = setTimeout(() => {
      buscarRelacionables(supabaseClient, consulta, idsExcluidos === '' ? [] : idsExcluidos.split(','))
        .then((filas) => {
          if (peticion !== ultimaBusqueda.current) return
          setResultados(filas)
          setErrorBusqueda(false)
          setBuscado(true)
        })
        .catch((error) => {
          console.error('No pudimos buscar productos para relacionar.', error)
          if (peticion !== ultimaBusqueda.current) return
          setResultados([])
          setErrorBusqueda(true)
          setBuscado(true)
        })
    }, ESPERA_BUSQUEDA_MS)
    return () => clearTimeout(espera)
  }, [texto, idsExcluidos, soloLectura])

  const agregar = (item: Relacionado) => {
    onCambiar([...seleccion, item])
    setTexto('')
    setAviso(`Agregado a relacionados: ${item.nombre}`)
  }

  const quitar = (indice: number) => {
    onCambiar(seleccion.filter((_, i) => i !== indice))
    setAviso('Quitado de relacionados')
  }

  const mover = (indice: number, delta: -1 | 1) => {
    onCambiar(moverRelacionado(seleccion, indice, delta))
    setAviso(null)
  }

  const bloqueado = soloLectura || deshabilitado

  return (
    <Box component="section" aria-labelledby="relacionados-titulo">
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
        <Box>
          <Typography id="relacionados-titulo" variant="t3" component="h2">{TITULO}</Typography>
          <Typography variant="s" component="p" sx={{ mt: 0.5 }}>{SUBTITULO}</Typography>
        </Box>
        <Chip size="small" label={etiquetaContador(seleccion.length)} />
      </Stack>

      {cargando ? (
        <Typography variant="s" role="status" sx={{ mt: 1 }}>Cargando productos relacionados…</Typography>
      ) : hayError ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
          <Typography variant="s" role="alert">No pudimos cargar los productos relacionados.</Typography>
          {onReintentar ? <Button size="small" onClick={onReintentar}>Reintentar relacionados</Button> : null}
        </Stack>
      ) : (
        <>
          {soloLectura ? null : (
            <Box sx={{ mt: 1.5 }}>
              <TextField
                fullWidth
                size="small"
                value={texto}
                onChange={(evento) => setTexto(evento.target.value)}
                disabled={bloqueado}
                placeholder="Buscar por nombre, SKU o categoría"
                slotProps={{
                  htmlInput: { 'aria-label': 'Buscar por nombre, SKU o categoría' },
                  input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" aria-hidden /></InputAdornment> },
                }}
              />
              {errorBusqueda ? (
                <Typography variant="s" role="alert" sx={{ mt: 1 }}>No pudimos buscar productos. Probá de nuevo.</Typography>
              ) : buscado && texto.trim() !== '' ? (
                <Box component="ul" aria-label="Resultados de la búsqueda" sx={{ listStyle: 'none', m: 0, p: 0, mt: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                  {resultados.map((item) => (
                    <Stack component="li" key={item.id} direction="row" alignItems="center" spacing={1.5} sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="b" component="p" sx={{ fontWeight: 600 }}>{item.nombre}</Typography>
                        <Typography variant="xs" component="p">{detalleRelacionado(item)}</Typography>
                      </Box>
                      <Button size="small" variant="outlined" onClick={() => agregar(item)} disabled={deshabilitado} aria-label={`Agregar ${item.nombre}`}>Agregar</Button>
                    </Stack>
                  ))}
                  {resultados.length === 0 ? (
                    <Typography component="li" variant="s" sx={{ px: 1.5, py: 1.5 }}>Sin resultados. Probá con otro nombre, SKU o categoría.</Typography>
                  ) : null}
                </Box>
              ) : null}
            </Box>
          )}

          <Typography variant="xs" component="p" sx={{ mt: 2, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>
            En este producto (el orden es el que ve el cliente)
          </Typography>
          {seleccion.length === 0 ? (
            <Typography variant="s" component="p" sx={{ mt: 0.75 }}>Todavía no hay productos relacionados. Buscá arriba y agregá accesorios o alternativas.</Typography>
          ) : (
            <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, mt: 0.75, border: 1, borderColor: 'divider', borderRadius: 1 }}>
              {seleccion.map((item, indice) => {
                const esPrimero = indice === 0
                const esUltimo = indice === seleccion.length - 1
                return (
                  <Stack component="li" key={item.id} direction="row" alignItems="center" spacing={1.5} sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
                    <Chip size="small" label={indice + 1} aria-label={`Posición ${indice + 1}`} sx={{ minWidth: 24 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="b" component="p" sx={{ fontWeight: 600 }}>{item.nombre}</Typography>
                      <Typography variant="xs" component="p">{detalleRelacionado(item)}</Typography>
                    </Box>
                    {soloLectura ? null : (
                      <>
                        <IconButton size="small" aria-label={`Subir ${item.nombre}`} aria-disabled={esPrimero || bloqueado} onClick={() => { if (!esPrimero && !bloqueado) mover(indice, -1) }} sx={{ opacity: esPrimero ? 0.35 : 1 }}>
                          <ArrowUpwardIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" aria-label={`Bajar ${item.nombre}`} aria-disabled={esUltimo || bloqueado} onClick={() => { if (!esUltimo && !bloqueado) mover(indice, 1) }} sx={{ opacity: esUltimo ? 0.35 : 1 }}>
                          <ArrowDownwardIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" aria-label={`Quitar ${item.nombre}`} disabled={bloqueado} onClick={() => quitar(indice)}>
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </>
                    )}
                  </Stack>
                )
              })}
            </Box>
          )}
          <Typography variant="s" component="p" role="status" sx={{ mt: 1, minHeight: '1.5em' }}>{aviso}</Typography>
        </>
      )}
    </Box>
  )
}
