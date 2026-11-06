import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useActividad, useOpcionesActividad } from '../../hooks/useActividad'
import { useListadoAcumulado } from '../../hooks/useListadoAcumulado'
import { CargaInfinita } from '../../components/pagina/CargaInfinita'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import {
  ETIQUETA_PERIODO,
  etiquetaTipoActividad,
  FILTROS_ACTIVIDAD_INICIALES,
  formatearCuando,
  type EventoActividadListado,
  type FiltrosActividad,
  type PeriodoActividad,
} from '../../lib/actividad'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'
import { DetalleActividadDialog } from '../../components/actividad/DetalleActividadDialog'

const TODOS = ''
const DEMORA_BUSQUEDA_MS = 300

const columnas: ColumnaAdaptable<EventoActividadListado>[] = [
  { clave: 'cuando', encabezado: 'Cuándo', render: (evento) => formatearCuando(evento.creadoEn) },
  { clave: 'tipo', encabezado: 'Tipo', render: (evento) => etiquetaTipoActividad(evento.tipo) },
  { clave: 'tienda', encabezado: 'Tienda', render: (evento) => evento.empresaNombre ?? (evento.empresaId ? 'Empresa no disponible' : 'Compartido') },
  { clave: 'detalle', encabezado: 'Detalle', render: (evento) => evento.detalle },
  { clave: 'quien', encabezado: 'Quién', render: (evento) => evento.actorNombre ?? 'Sistema' },
]

// Historial de actividad (F-AUD-01, FR-003…FR-006): filtros, búsqueda y
// carga infinita por tandas desde el servidor. El acceso lo decide la matriz (`actividad`): la ruta
// va envuelta en RequiereAccesoSeccion y la RLS devuelve cero filas a quien no
// tenga acceso. Cada fila abre su detalle con el antes y después (F-AUD-02, FR-007).
export function ActividadList() {
  const [filtros, setFiltros] = useState<FiltrosActividad>(FILTROS_ACTIVIDAD_INICIALES)
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(1)
  const textoAplicado = useRef(FILTROS_ACTIVIDAD_INICIALES.texto)
  // El filtro por tienda sigue a la empresa activa de la barra superior (F-ROL-06):
  // al cambiarla arriba, la Actividad se filtra por esa tienda. El select de la
  // pantalla la sobreescribe sin cambiar la activa persistida.
  const { empresas, valor: empresaFiltro, cambiar: elegirEmpresa, empresaActivaId } = useFiltroPorEmpresaActiva()
  // Detalle abierto: recuerda la empresa activa con que se abrió. Si la barra superior cambia de empresa, se cierra
  // con aviso en vez de seguir mostrando datos de la anterior (Principio VIII).
  const [detalleAbierto, setDetalleAbierto] = useState<{ eventoId: string; empresaActivaId: string | null } | null>(null)
  const [avisoEmpresa, setAvisoEmpresa] = useState(false)
  const filtrosEfectivos = { ...filtros, empresa: empresaFiltro }
  const { eventos, total, isLoading, isError, refetch } = useActividad(filtrosEfectivos, pagina)
  const opciones = useOpcionesActividad()
  const listado = useListadoAcumulado({ items: eventos, pagina, setPagina, total, cargando: isLoading, reinicio: filtrosEfectivos })
  const falloTanda = isError && pagina > 1

  // Si una recarga deja la página fuera de rango (p. ej. «Reintentar» tras un
  // error con menos resultados), vuelve a la 1 en vez de dejar el vacío sin salida.
  useEffect(() => {
    if (!isLoading && !isError && eventos.length === 0 && pagina > 1) setPagina(1)
  }, [isLoading, isError, eventos.length, pagina])

  useEffect(() => {
    if (detalleAbierto && detalleAbierto.empresaActivaId !== empresaActivaId) {
      setDetalleAbierto(null)
      setAvisoEmpresa(true)
    }
  }, [detalleAbierto, empresaActivaId])

  const cambiar = (cambio: Partial<FiltrosActividad>) => {
    setFiltros((anteriores) => ({ ...anteriores, ...cambio }))
    setPagina(1)
  }

  // La búsqueda espera un instante a que termine de escribir y vuelve a la
  // página 1, pero solo si el texto cambió respecto del ya aplicado.
  useEffect(() => {
    const espera = setTimeout(() => {
      if (textoAplicado.current === busqueda) return
      textoAplicado.current = busqueda
      cambiar({ texto: busqueda })
    }, DEMORA_BUSQUEDA_MS)
    return () => clearTimeout(espera)
    // `cambiar` solo usa setters estables: la búsqueda es lo único que dispara el efecto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda])

  const hayFiltros =
    empresaFiltro !== null || filtros.actor !== null || filtros.tipo !== null || filtros.texto !== '' || filtros.periodo !== FILTROS_ACTIVIDAD_INICIALES.periodo

  return (
    <Box>
      <EncabezadoPagina titulo="Actividad" descripcion="Historial básico: cambios de productos, movimientos de stock, importaciones y configuración de tiendas." contexto={<ContextoOrganizacionActiva />} />
      <ContenedorSeccion>
        <Stack
          component="form"
          role="search"
          aria-label="Filtros de actividad"
          onSubmit={(evento) => evento.preventDefault()}
          direction={{ xs: 'column', md: 'row' }}
          sx={{ mb: 3, flexWrap: 'wrap', gap: 2 }}
        >
          <TextField
            label="Buscar en la actividad"
            type="search"
            size="small"
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
            sx={{ minWidth: { md: 260 } }}
          />
          <TextField
            select
            label="Período"
            size="small"
            value={filtros.periodo}
            onChange={(evento) => cambiar({ periodo: evento.target.value as PeriodoActividad })}
            sx={{ minWidth: { md: 180 } }}
          >
            {(Object.keys(ETIQUETA_PERIODO) as PeriodoActividad[]).map((periodo) => (
              <MenuItem key={periodo} value={periodo}>{ETIQUETA_PERIODO[periodo]}</MenuItem>
            ))}
          </TextField>
          <FiltroEmpresa
            empresas={empresas}
            valor={empresaFiltro}
            onCambiar={(nuevo) => {
              elegirEmpresa(nuevo)
              setPagina(1)
            }}
          />
          <TextField
            select
            label="Usuario"
            size="small"
            value={filtros.actor ?? TODOS}
            onChange={(evento) => cambiar({ actor: evento.target.value || null })}
            sx={{ minWidth: { md: 200 } }}
          >
            <MenuItem value={TODOS}>Todos los usuarios</MenuItem>
            {opciones.actores.map((actor) => (
              <MenuItem key={actor.id} value={actor.id}>{actor.nombre}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Tipo"
            size="small"
            value={filtros.tipo ?? TODOS}
            onChange={(evento) => cambiar({ tipo: evento.target.value || null })}
            sx={{ minWidth: { md: 200 } }}
          >
            <MenuItem value={TODOS}>Todos los tipos</MenuItem>
            {opciones.tipos.map((tipo) => (
              <MenuItem key={tipo} value={tipo}>{etiquetaTipoActividad(tipo)}</MenuItem>
            ))}
          </TextField>
        </Stack>

        <Typography variant="xs" sx={{ mb: 2 }}>
          Las altas, ediciones y publicaciones llevan su tienda. Los cambios del catálogo y del stock compartido se ven siempre.
        </Typography>

        {avisoEmpresa ? (
          <Alert severity="info" onClose={() => setAvisoEmpresa(false)} sx={{ mb: 2 }}>
            Cambiaste de empresa: cerramos el detalle que estabas viendo.
          </Alert>
        ) : null}

        {isLoading && pagina === 1 ? (
          <EstadoCargaPagina />
        ) : isError && !falloTanda ? (
          <EstadoError descripcion="No pudimos cargar la actividad." reintentar={() => void refetch()} />
        ) : listado.filas.length === 0 && total === 0 ? (
          <EstadoVacio
            titulo={hayFiltros ? 'No hay actividad con esos filtros.' : 'Todavía no hay actividad registrada.'}
            descripcion={hayFiltros ? 'Probá con otro período o quitá algún filtro.' : undefined}
          />
        ) : (
          <>
            <Typography color="text.secondary" aria-live="polite" sx={{ mb: 1 }}>{total} {total === 1 ? 'evento' : 'eventos'}</Typography>
            <ContenidoAdaptable
              items={listado.filas}
              columnas={columnas}
              obtenerClave={(evento) => evento.id}
              etiquetaTabla="Actividad"
              acciones={(evento) => (
                <Button
                  size="small"
                  aria-label={`Ver detalle: ${evento.detalle}`}
                  onClick={() => {
                    setAvisoEmpresa(false)
                    setDetalleAbierto({ eventoId: evento.id, empresaActivaId })
                  }}
                >
                  Ver detalle
                </Button>
              )}
            />
            <CargaInfinita
              hayMas={listado.hayMas}
              cargando={listado.cargandoMas}
              hayError={falloTanda}
              onCargarMas={falloTanda ? () => void refetch() : listado.cargarMas}
            />
          </>
        )}
      </ContenedorSeccion>
      {detalleAbierto ? <DetalleActividadDialog eventoId={detalleAbierto.eventoId} onCerrar={() => setDetalleAbierto(null)} /> : null}
    </Box>
  )
}
