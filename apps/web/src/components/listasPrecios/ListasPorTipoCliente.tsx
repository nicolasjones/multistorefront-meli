import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Box, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useListasPreciosActivas } from '../../hooks/useListasPreciosActivas'
import {
  type ListaDeTipo,
  type TipoClienteLista,
  TIPOS_CLIENTE_LISTA,
  asignarListaTipo,
  formatearAjuste,
  leerListasPorTipo,
  mensajeErrorLista,
} from '../../lib/listasPrecios'
import { supabaseClient } from '../../lib/supabase'
import { EstadoCargaPagina, EstadoError } from '../estados/EstadosPagina'

const SIN_LISTA = ''

type Props = {
  // Solo Administrador cambia la lista de un tipo (la base lo exige igual: 42501).
  puedeEditar: boolean
  // Con la bandera apagada solo se puede quitar la lista (la base responde 55000 al asignar).
  puedeAsignar: boolean
  // Avisa a la pantalla cuando cambia una asignación (los clientes por lista cambian).
  onCambiada: () => void
}

// «Lista por tipo de cliente» (MSF-976): la lista de cada tipo rige para los clientes de ese tipo que no tienen una lista propia. La
// lista propia del cliente gana. Por tienda no hay listas: es de toda la organización (ver docs/listas-de-precios.md).
export function ListasPorTipoCliente({ puedeEditar, puedeAsignar, onCambiada }: Props) {
  const [asignadas, setAsignadas] = useState<ListaDeTipo[]>([])
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const [trabajando, setTrabajando] = useState<TipoClienteLista | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { listas } = useListasPreciosActivas()
  const ultimaPeticion = useRef(0)
  const enVuelo = useRef(false)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setHayError(false)
    try {
      const leidas = await leerListasPorTipo(supabaseClient)
      if (peticion === ultimaPeticion.current) setAsignadas(leidas)
    } catch (e) {
      console.error('No pudimos cargar las listas por tipo de cliente.', e)
      if (peticion === ultimaPeticion.current) setHayError(true)
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const cambiar = async (tipo: TipoClienteLista, listaId: string) => {
    if (enVuelo.current) return
    enVuelo.current = true
    setTrabajando(tipo)
    setError(null)
    try {
      await asignarListaTipo(supabaseClient, tipo, listaId === SIN_LISTA ? null : listaId)
      await cargar()
      onCambiada()
    } catch (e) {
      setError(mensajeErrorLista(e, 'No pudimos cambiar la lista del tipo de cliente. Probá de nuevo.'))
    } finally {
      enVuelo.current = false
      setTrabajando(null)
    }
  }

  return (
    <Box component="section" aria-labelledby="titulo-listas-por-tipo">
      <Typography id="titulo-listas-por-tipo" component="h2" variant="h6">Lista por tipo de cliente</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Rige para los clientes de ese tipo que no tienen una lista propia: la lista asignada al cliente siempre gana.
      </Typography>
      {error ? <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>{error}</Alert> : null}
      {cargando ? (
        <EstadoCargaPagina />
      ) : hayError ? (
        <EstadoError descripcion="No pudimos cargar las listas por tipo de cliente." reintentar={() => void cargar()} />
      ) : (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          {TIPOS_CLIENTE_LISTA.map(({ valor, etiqueta }) => {
            const actual = asignadas.find((fila) => fila.tipo === valor) ?? null
            // La lista actual puede estar archivada (se la muestra igual para poder verla y quitarla).
            const opciones = [...listas]
            if (actual && !opciones.some((lista) => lista.id === actual.listaId)) {
              opciones.push({ id: actual.listaId, nombre: actual.listaNombre, descripcion: null, ajustePct: actual.ajustePct, archivadaEn: actual.archivadaEn, clientesAsignados: 0, actualizadoEn: '' })
            }
            return (
              <TextField
                key={valor}
                select
                fullWidth
                size="small"
                label={`Lista de los clientes ${etiqueta.toLowerCase()}`}
                value={actual?.listaId ?? SIN_LISTA}
                slotProps={{ select: { displayEmpty: true } }}
                disabled={!puedeEditar || trabajando !== null}
                onChange={(evento) => void cambiar(valor, evento.target.value)}
                helperText={actual?.archivadaEn ? 'Esta lista está archivada: no rige. Elegí otra o quitala.' : undefined}
              >
                <MenuItem value={SIN_LISTA}>Sin lista</MenuItem>
                {opciones.map((lista) => (
                  <MenuItem key={lista.id} value={lista.id} disabled={!puedeAsignar && lista.id !== actual?.listaId}>
                    {lista.nombre} ({formatearAjuste(lista.ajustePct)})
                  </MenuItem>
                ))}
              </TextField>
            )
          })}
        </Stack>
      )}
    </Box>
  )
}
