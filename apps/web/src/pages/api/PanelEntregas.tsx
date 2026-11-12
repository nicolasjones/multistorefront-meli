import { Alert, Box, Button, FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../../lib/supabase'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { useApiTabla, type Entrega, type Suscripcion } from './datos'

const COLUMNAS = 'id, evento_id, suscripcion_id, estado, intentos, ultimo_estado_http, ultimo_error_sanitizado, creada_en, actualizada_en'

const varianteDe = (estado: Entrega['estado']) => {
  if (estado === 'completada') return 'exito' as const
  if (estado === 'agotada') return 'error' as const
  if (estado === 'reclamada') return 'aviso' as const
  return 'neutral' as const
}

/** Entregas recientes de los avisos (FR-012, FR-014). */
export function PanelEntregas() {
  const [soloAgotadas, setSoloAgotadas] = useState(false)
  const { filas, hayError, recargar } = useApiTabla<Entrega>('api_entregas', COLUMNAS, 'creada_en', soloAgotadas ? 'agotada' : undefined)
  // El destino se muestra con la URL de la suscripción (no con el identificador interno).
  const { filas: suscripciones } = useApiTabla<Suscripcion>('api_suscripciones', 'id, url', 'creada_en')
  const urlDe = (id: string) => suscripciones?.find((s) => s.id === id)?.url ?? id
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reintentando, setReintentando] = useState<string | null>(null)
  // Tras reintentar, la fila cambia de estado y el botón desaparece: el foco pasa al aviso para que no se pierda.
  const avisoRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (aviso) avisoRef.current?.focus()
  }, [aviso])

  // Una entrega agotada vuelve a la cola con sus 5 intentos de nuevo (MSF-838). Solo la ve y la reintenta el Administrador.
  const reintentar = async (entrega: Entrega) => {
    if (reintentando) return
    setAviso(null)
    setError(null)
    setReintentando(entrega.id)
    const { error: errorRpc } = await supabaseClient.rpc('reintentar_entrega_api', { p_entrega_id: entrega.id })
    setReintentando(null)
    if (errorRpc) {
      setError('No pudimos reintentar la entrega. Puede que ya no esté agotada: actualizamos la lista.')
      recargar()
      return
    }
    setAviso(`Volvimos a poner en la cola el aviso para ${urlDe(entrega.suscripcion_id)}. Si la suscripción está pausada, se envía cuando la reanudes.`)
    recargar()
  }

  const columnas: ColumnaAdaptable<Entrega>[] = [
    { clave: 'evento', encabezado: 'Evento', render: (entrega) => entrega.evento_id },
    { clave: 'destino', encabezado: 'Destino', render: (entrega) => urlDe(entrega.suscripcion_id) },
    {
      clave: 'estado',
      encabezado: 'Estado',
      render: (entrega) => <EtiquetaEstado texto={entrega.estado} variante={varianteDe(entrega.estado)} />,
    },
    { clave: 'intentos', encabezado: 'Intentos', render: (entrega) => String(entrega.intentos) },
    {
      clave: 'error',
      encabezado: 'Último error',
      render: (entrega) => (
        <Typography variant="body2" color="text.secondary">
          {entrega.ultimo_error_sanitizado ?? '—'}
          {entrega.ultimo_estado_http ? ` (${entrega.ultimo_estado_http})` : ''}
        </Typography>
      ),
    },
  ]

  if (hayError) return <EstadoError descripcion="No pudimos cargar las entregas." reintentar={recargar} />
  if (filas === null) return <EstadoCargaPagina />
  if (filas.length === 0 && !soloAgotadas) return <EstadoVacio titulo="Todavía no hay entregas." />

  return (
    <Box>
      <Stack spacing={2}>
        <FormControlLabel
          control={<Switch checked={soloAgotadas} onChange={(evento) => setSoloAgotadas(evento.target.checked)} />}
          label="Solo agotadas"
        />
        {aviso ? <Alert severity="success" ref={avisoRef} tabIndex={-1}>{aviso}</Alert> : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
        {filas.length === 0 ? <EstadoVacio titulo="No hay entregas agotadas." /> : null}
        <ContenidoAdaptable
          items={filas}
          columnas={columnas}
          obtenerClave={(entrega) => entrega.id}
          etiquetaTabla="Entregas de avisos"
          acciones={(entrega) =>
            entrega.estado === 'agotada' ? (
              <Button
                size="small"
                aria-label={`Reintentar el aviso a ${urlDe(entrega.suscripcion_id)}`}
                disabled={reintentando !== null}
                onClick={() => void reintentar(entrega)}
              >
                Reintentar
              </Button>
            ) : null
          }
        />
      </Stack>
    </Box>
  )
}
