import { Autocomplete, Box, InputAdornment, TextField } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { supabaseClient } from '../../lib/supabase'
import { EstadoError } from '../estados/EstadosPagina'

// F-INI-03 (MSF-374): búsqueda global de productos en la barra superior.
// Solo productos (D-4); la visibilidad por rol la impone la RLS de la RPC, no la pantalla.
export interface ResultadoBusqueda {
  producto_id: string
  nombre: string
  sku: string
}

const MINIMO_CARACTERES = 2
const ESPERA_MS = 300
const ETIQUETA = 'Buscar producto por nombre o SKU'

const SOLO_LECTORES = {
  position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
} as const

export function BusquedaGlobal() {
  const navigate = useNavigate()
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState<ResultadoBusqueda[]>([])
  const [cargando, setCargando] = useState(false)
  const [fallo, setFallo] = useState(false)
  const [reintento, setReintento] = useState(0)

  const consulta = texto.trim()
  const buscable = consulta.length >= MINIMO_CARACTERES

  useEffect(() => {
    if (!buscable) {
      setResultados([])
      setFallo(false)
      setCargando(false)
      return undefined
    }
    let vigente = true
    setCargando(true)
    const temporizador = setTimeout(() => {
      void (async () => {
        const { data, error } = await supabaseClient.rpc('buscar_productos_global', { p_q: consulta })
        if (!vigente) return
        setCargando(false)
        if (error) {
          setFallo(true)
          setResultados([])
          return
        }
        setFallo(false)
        setResultados((data ?? []) as ResultadoBusqueda[])
      })()
    }, ESPERA_MS)
    return () => {
      vigente = false
      clearTimeout(temporizador)
    }
  }, [consulta, buscable, reintento])

  const anuncio = !buscable || cargando || fallo
    ? ''
    : resultados.length === 0
      ? 'No encontramos productos'
      : `${resultados.length} ${resultados.length === 1 ? 'resultado' : 'resultados'}`

  const sinOpciones = fallo
    ? <EstadoError titulo="No pudimos buscar productos." reintentar={() => setReintento((n) => n + 1)} />
    : cargando
      ? 'Buscando…'
      : buscable
        ? 'No encontramos productos'
        : `Escribí al menos ${MINIMO_CARACTERES} caracteres`

  return (
    <Box sx={{ flex: '1 1 220px', maxWidth: 360, minWidth: 180 }}>
      <Autocomplete<ResultadoBusqueda, false, true, false>
        size="small"
        options={resultados}
        loading={cargando}
        loadingText="Buscando…"
        value={null}
        inputValue={texto}
        onInputChange={(_evento, valor, motivo) => { if (motivo !== 'reset') setTexto(valor) }}
        onChange={(_evento, elegido) => {
          if (!elegido) return
          setTexto('')
          navigate(`/productos/${elegido.producto_id}/edit`)
        }}
        filterOptions={(opciones) => opciones}
        getOptionKey={(opcion) => opcion.producto_id}
        getOptionLabel={(opcion) => opcion.nombre}
        isOptionEqualToValue={(a, b) => a.producto_id === b.producto_id}
        noOptionsText={sinOpciones}
        forcePopupIcon={false}
        blurOnSelect
        renderOption={(props, opcion) => {
          const { key, ...resto } = props
          return (
            <li key={key} {...resto}>
              <Box component="span" sx={{ display: 'flex', flexDirection: 'column' }}>
                <span>{opcion.nombre}</span>
                <Box component="span" sx={{ typography: 'caption', color: 'text.secondary' }}>{opcion.sku}</Box>
              </Box>
            </li>
          )
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder="Buscar producto…"
            slotProps={{
              htmlInput: { ...params.inputProps, 'aria-label': ETIQUETA },
              input: {
                ...params.InputProps,
                startAdornment: (
                  <InputAdornment position="start"><SearchIcon fontSize="small" aria-hidden /></InputAdornment>
                ),
              },
            }}
          />
        )}
      />
      <Box role="status" aria-live="polite" sx={SOLO_LECTORES}>{anuncio}</Box>
    </Box>
  )
}
