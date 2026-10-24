import { Box, Button, ClickAwayListener, TextField, Typography } from '@mui/material'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { urlsImagenesProducto } from '../../../lib/imagenProducto'
import {
  ESPERA_ENTRE_TECLAS_MS,
  MINIMO_CARACTERES_BUSQUEDA,
  leerSugerencias,
  normalizarConsulta,
  urlResultados,
  type Sugerencia,
} from '../../../lib/tiendaBusqueda'
import { formatearPrecioArs } from '../../../lib/tiendaListado'
import EtiquetaDisponibilidad from '../disponibilidad/EtiquetaDisponibilidad'

type Estado =
  | { fase: 'reposo' }
  | { fase: 'cargando' }
  | { fase: 'lista'; sugerencias: Sugerencia[]; imagenes: Record<string, string> }
  | { fase: 'espera'; segundos: number }
  | { fase: 'error' }

// Buscador del encabezado (F-TDA-15, FR-024…FR-028). Un *combobox* con desplegable de hasta 6
// sugerencias que se piden con una espera corta entre teclas; una respuesta vieja nunca pisa a la
// nueva. Teclado completo (flechas, Enter, Esc) y cierre al hacer clic afuera. El texto del visitante
// va siempre como nodo de React (se escapa solo). Se carga de forma diferida desde `LayoutTienda`.
export default function BuscadorTienda({ host }: { host: string }) {
  const navegar = useNavigate()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const idBase = useId()
  const idLista = `${idBase}-sugerencias`
  const idOpcion = (indice: number) => `${idBase}-opcion-${indice}`

  // En los resultados el campo muestra lo buscado, para poder ajustarlo.
  const qUrl = pathname === '/catalogo' ? normalizarConsulta(params.get('q')) : ''
  const [texto, setTexto] = useState(qUrl)
  const [abierto, setAbierto] = useState(false)
  const [estado, setEstado] = useState<Estado>({ fase: 'reposo' })
  const [activo, setActivo] = useState(-1)
  const [intento, setIntento] = useState(0)
  const pedido = useRef(0)

  useEffect(() => {
    setTexto(qUrl)
    setAbierto(false)
  }, [qUrl, pathname])

  const consulta = normalizarConsulta(texto)
  const buscable = consulta.length >= MINIMO_CARACTERES_BUSQUEDA

  useEffect(() => {
    // Cada ejecución invalida a las anteriores: una respuesta tardía se descarta (FR-024).
    const numero = ++pedido.current
    if (!abierto || !buscable) {
      setEstado({ fase: 'reposo' })
      return undefined
    }
    setEstado({ fase: 'cargando' })
    setActivo(-1)
    let temporizadorEspera: ReturnType<typeof setTimeout> | undefined
    const temporizador = setTimeout(() => {
      leerSugerencias(host, consulta)
        .then(async (respuesta) => {
          if (numero !== pedido.current) return
          if (respuesta.esperaSegundos !== null) {
            setEstado({ fase: 'espera', segundos: respuesta.esperaSegundos })
            // El límite se libera solo (FR-027): se repite la búsqueda al terminar la espera.
            temporizadorEspera = setTimeout(() => {
              if (numero === pedido.current) setIntento((actual) => actual + 1)
            }, respuesta.esperaSegundos * 1000)
            return
          }
          const imagenes = await urlsImagenesProducto(respuesta.sugerencias.flatMap((s) => (s.imagen ? [s.imagen] : [])))
          if (numero === pedido.current) setEstado({ fase: 'lista', sugerencias: respuesta.sugerencias, imagenes })
        })
        .catch((error) => {
          console.error('No se pudo buscar en la tienda', error instanceof Error ? error.message : error)
          if (numero === pedido.current) setEstado({ fase: 'error' })
        })
    }, ESPERA_ENTRE_TECLAS_MS)
    return () => {
      clearTimeout(temporizador)
      clearTimeout(temporizadorEspera)
    }
  }, [abierto, buscable, consulta, host, intento])

  const sugerencias = estado.fase === 'lista' ? estado.sugerencias : []
  // La última opción es «Ver todos los resultados →».
  const totalOpciones = sugerencias.length > 0 ? sugerencias.length + 1 : 0
  const mostrarPanel = abierto && buscable

  const irAResultados = () => {
    if (!buscable) return
    setAbierto(false)
    navegar(urlResultados(consulta))
  }
  const irAFicha = (id: string) => {
    setAbierto(false)
    navegar(`/producto/${id}`)
  }

  const alTeclear = (evento: KeyboardEvent<HTMLInputElement>) => {
    if (evento.key === 'Escape') {
      setAbierto(false)
    } else if (evento.key === 'ArrowDown') {
      evento.preventDefault()
      setAbierto(true)
      if (totalOpciones > 0) setActivo((actual) => (actual + 1) % totalOpciones)
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault()
      if (totalOpciones > 0) setActivo((actual) => (actual <= 0 ? totalOpciones - 1 : actual - 1))
    } else if (evento.key === 'Enter') {
      evento.preventDefault()
      if (activo >= 0 && activo < sugerencias.length) irAFicha(sugerencias[activo].id)
      else irAResultados()
    }
  }

  return (
    <ClickAwayListener onClickAway={() => setAbierto(false)}>
      <Box sx={{ position: 'relative', width: { xs: '100%', sm: 360 }, maxWidth: '100%' }}>
        <Box component="form" role="search" onSubmit={(evento) => { evento.preventDefault(); irAResultados() }}>
          <TextField
            fullWidth
            size="small"
            placeholder="Buscar productos"
            value={texto}
            onChange={(evento) => { setTexto(evento.target.value); setAbierto(true) }}
            onFocus={() => setAbierto(true)}
            onKeyDown={alTeclear}
            slotProps={{
              htmlInput: {
                role: 'combobox',
                'aria-label': 'Buscar productos',
                'aria-autocomplete': 'list',
                'aria-expanded': mostrarPanel && estado.fase !== 'reposo',
                'aria-controls': estado.fase === 'lista' && sugerencias.length > 0 ? idLista : undefined,
                'aria-activedescendant': activo >= 0 && totalOpciones > 0 ? idOpcion(activo) : undefined,
                autoComplete: 'off',
                maxLength: 200,
              },
            }}
          />
        </Box>
        {mostrarPanel && estado.fase !== 'reposo' ? (
          <Box
            sx={{
              position: 'absolute', zIndex: 10, left: 0, right: 0, mt: 0.5, bgcolor: 'background.paper',
              border: 1, borderColor: 'divider', borderRadius: (tema) => `${tema.shape.borderRadius}px`, boxShadow: 3,
              maxHeight: '70vh', overflowY: 'auto',
            }}
          >
            {estado.fase === 'cargando' ? (
              <Typography role="status" variant="body2" color="text.secondary" sx={{ p: 2 }}>Buscando…</Typography>
            ) : null}
            {estado.fase === 'error' ? (
              <Box role="alert" sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="body2">No pudimos buscar. Revisá tu conexión.</Typography>
                <Button size="small" onClick={() => setIntento((actual) => actual + 1)}>Reintentar</Button>
              </Box>
            ) : null}
            {estado.fase === 'espera' ? (
              <Typography data-testid="buscador-espera" role="status" variant="body2" sx={{ p: 2 }}>
                Hiciste muchas búsquedas seguidas. Esperá {estado.segundos === 1 ? '1 segundo' : `${estado.segundos} segundos`}; la búsqueda sigue sola.
              </Typography>
            ) : null}
            {estado.fase === 'lista' && sugerencias.length === 0 ? (
              <Typography role="status" variant="body2" sx={{ p: 2 }}>No encontramos productos con ese nombre.</Typography>
            ) : null}
            {estado.fase === 'lista' && sugerencias.length > 0 ? (
              <Box component="ul" id={idLista} role="listbox" aria-label="Sugerencias de búsqueda" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {sugerencias.map((sugerencia, indice) => (
                  <OpcionSugerencia
                    key={sugerencia.id}
                    id={idOpcion(indice)}
                    sugerencia={sugerencia}
                    urlImagen={sugerencia.imagen ? estado.imagenes[sugerencia.imagen] : undefined}
                    activa={activo === indice}
                    alElegir={() => irAFicha(sugerencia.id)}
                  />
                ))}
                <Box
                  component="li"
                  id={idOpcion(sugerencias.length)}
                  role="option"
                  aria-selected={activo === sugerencias.length}
                  onMouseDown={(evento) => evento.preventDefault()}
                  onClick={irAResultados}
                  sx={{ ...estiloOpcion(activo === sugerencias.length), fontWeight: 600, borderTop: 1, borderColor: 'divider' }}
                >
                  Ver todos los resultados →
                </Box>
              </Box>
            ) : null}
          </Box>
        ) : null}
      </Box>
    </ClickAwayListener>
  )
}

const estiloOpcion = (activa: boolean) => ({
  display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1, cursor: 'pointer',
  bgcolor: activa ? 'action.selected' : 'transparent',
  '&:hover': { bgcolor: 'action.hover' },
})

function OpcionSugerencia({
  id, sugerencia, urlImagen, activa, alElegir,
}: { id: string; sugerencia: Sugerencia; urlImagen?: string; activa: boolean; alElegir: () => void }) {
  const [fallo, setFallo] = useState<string | null>(null)
  const precio = formatearPrecioArs(sugerencia.precio)
  const mostrarImagen = Boolean(urlImagen) && fallo !== urlImagen
  return (
    <Box
      component="li"
      id={id}
      role="option"
      aria-selected={activa}
      onMouseDown={(evento) => evento.preventDefault()}
      onClick={alElegir}
      sx={estiloOpcion(activa)}
    >
      <Box
        sx={(tema) => ({
          width: tema.spacing(6), height: tema.spacing(6), flexShrink: 0, bgcolor: 'action.hover',
          borderRadius: `${tema.shape.borderRadius}px`, overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        })}
      >
        {mostrarImagen ? (
          <Box component="img" src={urlImagen} alt="" loading="lazy" onError={() => setFallo(urlImagen ?? null)} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <Typography variant="caption" color="text.secondary" align="center">Sin imagen</Typography>
        )}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{sugerencia.nombre}</Typography>
        <Typography variant="body2" component="span">
          {precio ? `${precio} · ` : ''}
          <EtiquetaDisponibilidad disponible={sugerencia.disponible} />
        </Typography>
      </Box>
    </Box>
  )
}
