import { useEffect, useRef, useState } from 'react'
import { Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useActividad, useOpcionesActividad } from '../../hooks/useActividad'
import { useEmpresas } from '../../hooks/useEmpresas'
import {
  ETIQUETA_PERIODO,
  etiquetaTipoActividad,
  FILTROS_ACTIVIDAD_INICIALES,
  formatearCuando,
  TAMANO_PAGINA_ACTIVIDAD,
  type EventoActividadListado,
  type FiltrosActividad,
  type PeriodoActividad,
} from '../../lib/actividad'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

const TODOS = ''
const DEMORA_BUSQUEDA_MS = 300

const columnas: ColumnaAdaptable<EventoActividadListado>[] = [
  { clave: 'cuando', encabezado: 'Cuándo', render: (evento) => formatearCuando(evento.creadoEn) },
  { clave: 'tipo', encabezado: 'Tipo', render: (evento) => etiquetaTipoActividad(evento.tipo) },
  { clave: 'tienda', encabezado: 'Tienda', render: (evento) => evento.empresaNombre ?? (evento.empresaId ? 'Empresa no disponible' : 'Compartido') },
  { clave: 'detalle', encabezado: 'Detalle', render: (evento) => evento.detalle },
  { clave: 'quien', encabezado: 'Quién', render: (evento) => evento.actorNombre ?? 'Sistema' },
]

// «1–10 de N» (rango de la página actual sobre el total del filtro).
function rangoVisible(pagina: number, cantidad: number, total: number): string {
  if (total === 0) return '0 de 0'
  const desde = (pagina - 1) * TAMANO_PAGINA_ACTIVIDAD + 1
  return `${desde}–${desde + cantidad - 1} de ${total}`
}

// Historial de actividad (F-AUD-01, FR-003…FR-006): filtros, búsqueda y
// paginación en servidor. El acceso lo decide la matriz (`actividad`): la ruta
// va envuelta en RequiereAccesoSeccion y la RLS devuelve cero filas a quien no
// tenga acceso. Sin «Exportar» (fuera de alcance).
export function ActividadList() {
  const [filtros, setFiltros] = useState<FiltrosActividad>(FILTROS_ACTIVIDAD_INICIALES)
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(1)
  const textoAplicado = useRef(FILTROS_ACTIVIDAD_INICIALES.texto)
  const { eventos, total, isLoading, isError, refetch } = useActividad(filtros, pagina)
  const { empresas } = useEmpresas()
  const opciones = useOpcionesActividad()

  // Si una recarga deja la página fuera de rango (p. ej. «Reintentar» tras un
  // error con menos resultados), vuelve a la 1 en vez de dejar el vacío sin salida.
  useEffect(() => {
    if (!isLoading && !isError && eventos.length === 0 && pagina > 1) setPagina(1)
  }, [isLoading, isError, eventos.length, pagina])

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

  const totalPaginas = Math.max(1, Math.ceil(total / TAMANO_PAGINA_ACTIVIDAD))
  const hayFiltros =
    filtros.empresa !== null || filtros.actor !== null || filtros.tipo !== null || filtros.texto !== '' || filtros.periodo !== FILTROS_ACTIVIDAD_INICIALES.periodo

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
          <TextField
            select
            label="Tienda"
            size="small"
            value={filtros.empresa ?? TODOS}
            onChange={(evento) => cambiar({ empresa: evento.target.value || null })}
            sx={{ minWidth: { md: 180 } }}
          >
            <MenuItem value={TODOS}>Todas</MenuItem>
            {empresas.map((empresa) => (
              <MenuItem key={empresa.id} value={empresa.id}>{empresa.nombre}</MenuItem>
            ))}
          </TextField>
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

        {isLoading ? (
          <EstadoCargaPagina />
        ) : isError ? (
          <EstadoError descripcion="No pudimos cargar la actividad." reintentar={() => void refetch()} />
        ) : eventos.length === 0 ? (
          <EstadoVacio
            titulo={hayFiltros ? 'No hay actividad con esos filtros.' : 'Todavía no hay actividad registrada.'}
            descripcion={hayFiltros ? 'Probá con otro período o quitá algún filtro.' : undefined}
          />
        ) : (
          <>
            <ContenidoAdaptable items={eventos} columnas={columnas} obtenerClave={(evento) => evento.id} etiquetaTabla="Actividad" />
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2} sx={{ mt: 2 }}>
              <Typography color="text.secondary" aria-live="polite">{rangoVisible(pagina, eventos.length, total)}</Typography>
              <Stack direction="row" spacing={1}>
                <Button size="small" disabled={pagina <= 1} onClick={() => setPagina((actual) => actual - 1)} aria-label="Página anterior">
                  Anterior
                </Button>
                <Button size="small" disabled={pagina >= totalPaginas} onClick={() => setPagina((actual) => actual + 1)} aria-label="Página siguiente">
                  Siguiente
                </Button>
              </Stack>
            </Stack>
          </>
        )}
      </ContenedorSeccion>
    </Box>
  )
}
