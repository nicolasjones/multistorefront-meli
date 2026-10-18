import { lazy, Suspense, useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { CreateButton } from '@refinedev/mui'
import { Box, Button, Checkbox, Chip, LinearProgress, Stack, Tab, TablePagination, Tabs, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { usePuedeAccion } from '../../hooks/usePuedeAccion'
import { ExportarClientes } from '../../components/clientes/ExportarClientes'
import { useBuscarClientes, type ClienteListado } from '../../hooks/useBuscarClientes'
import { useEmpresasAccesibles } from '../../hooks/useEmpresasAccesibles'
import { FiltroTienda } from '../../components/clientes/FiltroTienda'
import type { TipoCliente } from '../../lib/clientes'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

// El ranking se descarga solo al abrir su solapa: el peso inicial del listado no crece (FR-015).
const RankingClientes = lazy(() => import('../../components/clientes/RankingClientes').then((modulo) => ({ default: modulo.RankingClientes })))

type Solapa = 'listado' | 'ranking'

const ESPERA_BUSQUEDA_MS = 300
const TAMANO_PAGINA = 25
// Barra de progreso indeterminada: alto fino propio del componente, no un valor del sistema.
const ALTO_BARRA_CARGA = 2
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const // estilos-sueltos: ok: oculta visualmente sin quitar del lector

const etiquetaTipo: Record<TipoCliente, string> = { minorista: 'Minorista', mayorista: 'Mayorista' }

const columnas: ColumnaAdaptable<ClienteListado>[] = [
  {
    clave: 'cliente', encabezado: 'Cliente',
    render: (cliente) => (
      <Stack spacing={0}>
        <Typography component="span" sx={{ fontWeight: 600 }}>{cliente.nombre}</Typography>
        <Typography component="span" variant="xs">N.º {cliente.numero} · {cliente.documento ?? '—'}</Typography>
      </Stack>
    ),
  },
  { clave: 'tipo', encabezado: 'Tipo', render: (cliente) => <Chip size="small" label={etiquetaTipo[cliente.tipo]} /> },
  {
    clave: 'tiendas', encabezado: 'Tiendas',
    render: (cliente) => cliente.empresas.length === 0 ? (
      <Typography component="span" color="text.disabled">—</Typography>
    ) : (
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
        {cliente.empresas.map((empresa) => <Chip key={empresa.id} size="small" label={empresa.nombre} />)}
      </Stack>
    ),
  },
  {
    clave: 'contacto', encabezado: 'Contacto',
    render: (cliente) => (
      <Stack spacing={0}>
        <span>{cliente.correo ?? '—'}</span>
        <Typography component="span" variant="xs">
          {[cliente.telefono, cliente.celular].filter(Boolean).join(' · ') || '—'}
        </Typography>
      </Stack>
    ),
  },
  { clave: 'localidad', encabezado: 'Localidad', render: (cliente) => cliente.localidad ?? '—' },
  { clave: 'expreso', encabezado: 'Expreso preferido', render: (cliente) => cliente.expreso_preferido ?? '—' },
  { clave: 'cuenta', encabezado: 'Cuenta web', render: () => <Chip size="small" label="—" variant="outlined" /> },
]

// Quien tiene lectura ve el listado; quien tiene edición en Clientes
// (nivel_seccion) suma «Nuevo cliente». RLS aplica el mismo límite en la base
// aunque alguien llegue a /clientes/edit/:id directamente (FR-004). La
// búsqueda, los filtros y la paginación se resuelven en el servidor
// (`buscar_clientes`, FR-006); el buscador espera a que se deje de tipear.
export function ClienteList() {
  const { nivel } = useNivelSeccion('clientes')
  const puedeEditar = nivel === 'edicion'
  // Misma regla que la función `ranking_clientes`: sección Clientes en lectura o edición (FR-009).
  const puedeVerRanking = nivel === 'lectura' || nivel === 'edicion'
  const [solapa, setSolapa] = useState<Solapa>('listado')
  const puedeExportar = usePuedeAccion('clientes', 'exportar').puede === true
  const [texto, setTexto] = useState('')
  const [textoAplicado, setTextoAplicado] = useState('')
  const [tipo, setTipo] = useState<TipoCliente | null>(null)
  const [archivados, setArchivados] = useState(false)
  // Filtro de tienda (F-CLI-11, `{{tFilt}}`): mientras no se elija un chip, la
  // pantalla sigue la empresa activa de la barra superior (como el prototipo:
  // `gc_co` inicializa `tFilt`). `undefined` = sin elección; el chip manda.
  const [empresaElegida, setEmpresaElegida] = useState<string | null | undefined>(undefined)
  const [pagina, setPagina] = useState(1)
  const [seleccion, setSeleccion] = useState<ReadonlySet<string>>(new Set())
  const { empresas, empresaActivaId, isLoading: cargandoTiendas, isError: errorTiendas } = useEmpresasAccesibles()
  const empresaId = empresaElegida === undefined ? empresaActivaId : empresaElegida

  useEffect(() => {
    const espera = setTimeout(() => {
      // Solo reinicia la página si el texto cambió: al montar o al tipear y
      // volver al mismo valor no se pisa la página que eligió la persona.
      if (texto !== textoAplicado) {
        setTextoAplicado(texto)
        setPagina(1)
      }
    }, ESPERA_BUSQUEDA_MS)
    return () => clearTimeout(espera)
  }, [texto, textoAplicado])

  const { clientes, total, isLoading, isFetching, isError, refetch } = useBuscarClientes({
    texto: textoAplicado, tipo, archivados, empresaId, pagina, tamano: TAMANO_PAGINA,
  })

  // Si la página quedó fuera de rango (p. ej. se archivó el último de la
  // última página), el servidor no devuelve filas: se vuelve a la primera.
  useEffect(() => {
    if (!isLoading && !isFetching && !isError && clientes.length === 0 && pagina > 1) setPagina(1)
  }, [isLoading, isFetching, isError, clientes.length, pagina])

  const hayFiltros = textoAplicado.trim() !== '' || tipo !== null || archivados || empresaId !== null

  const cambiarTienda = (id: string | null) => {
    setEmpresaElegida(id)
    setPagina(1)
  }

  const alternar = (id: string) => {
    setSeleccion((actual) => {
      const copia = new Set(actual)
      if (copia.has(id)) copia.delete(id)
      else copia.add(id)
      return copia
    })
  }

  return (
    <Box>
      <EncabezadoPagina titulo="Clientes" descripcion="Cada tipo define el precio que se aplica." accion={puedeEditar || puedeExportar ? (
        <Stack direction="row" spacing={1}>
          {puedeExportar ? <ExportarClientes filtros={{ texto: textoAplicado, tipo, archivados, empresaId }} total={total} /> : null}
          {puedeEditar ? <CreateButton /> : null}
        </Stack>
      ) : undefined} contexto={<ContextoOrganizacionActiva />} />
      <ContenedorSeccion>
        {cargandoTiendas || errorTiendas || empresas.length > 0 ? (
          <Box sx={{ mb: 2 }}>
            <FiltroTienda
              empresas={empresas}
              valor={empresaId}
              onCambiar={cambiarTienda}
              cargando={cargandoTiendas}
              hayError={errorTiendas}
            />
          </Box>
        ) : null}
        {puedeVerRanking ? (
          <Tabs value={solapa} onChange={(_, valor: Solapa) => setSolapa(valor)} aria-label="Vistas de clientes" sx={{ mb: 2 }}>
            <Tab value="listado" label="Listado" id="solapa-clientes-listado" aria-controls="panel-clientes" />
            <Tab value="ranking" label="Ranking por facturación" id="solapa-clientes-ranking" aria-controls="panel-clientes" />
          </Tabs>
        ) : null}
        {puedeVerRanking && solapa === 'ranking' ? (
          <Box role="tabpanel" id="panel-clientes" aria-labelledby="solapa-clientes-ranking">
            <Suspense fallback={<EstadoCargaPagina />}>
              <RankingClientes empresaId={empresaId} />
            </Suspense>
          </Box>
        ) : (
        <Stack spacing={2} role={puedeVerRanking ? 'tabpanel' : undefined} id="panel-clientes" aria-labelledby={puedeVerRanking ? 'solapa-clientes-listado' : undefined}>
          <BarraHerramientas
            contador={isLoading || isError ? undefined : `${total} ${total === 1 ? 'cliente' : 'clientes'}`}
          >
            <TextField
              type="search"
              label="Buscar clientes"
              placeholder="Nombre, DNI/CUIT, correo, teléfono, localidad o número"
              value={texto}
              onChange={(evento) => setTexto(evento.target.value)}
              size="small"
              sx={{ width: 320, maxWidth: '100%' }}
            />
            <ToggleButtonGroup
              exclusive
              size="small"
              aria-label="Filtrar por tipo de cliente"
              value={tipo ?? 'todos'}
              onChange={(_, valor: string | null) => {
                if (valor === null) return
                setTipo(valor === 'todos' ? null : (valor as TipoCliente))
                setPagina(1)
              }}
            >
              <ToggleButton value="todos">Todos</ToggleButton>
              <ToggleButton value="minorista">Minorista</ToggleButton>
              <ToggleButton value="mayorista">Mayorista</ToggleButton>
            </ToggleButtonGroup>
            <ToggleButtonGroup
              exclusive
              size="small"
              aria-label="Filtrar por estado"
              value={archivados ? 'archivados' : 'activos'}
              onChange={(_, valor: string | null) => {
                if (valor === null) return
                setArchivados(valor === 'archivados')
                setPagina(1)
              }}
            >
              <ToggleButton value="activos">Activos</ToggleButton>
              <ToggleButton value="archivados">Archivados</ToggleButton>
            </ToggleButtonGroup>
          </BarraHerramientas>

          <Box role="status" aria-live="polite" sx={visuallyHidden}>
            {isLoading || isError ? '' : `${total} ${total === 1 ? 'resultado' : 'resultados'}`}
          </Box>
          {isFetching && !isLoading ? <LinearProgress aria-label="Actualizando clientes" sx={{ height: ALTO_BARRA_CARGA }} /> : null}

          <Box aria-busy={isFetching}>
            {isLoading ? (
              <EstadoCargaPagina />
            ) : isError ? (
              <EstadoError descripcion="No pudimos cargar los clientes." reintentar={() => void refetch()} />
            ) : clientes.length === 0 && pagina === 1 ? (
              hayFiltros ? (
                <EstadoVacio titulo="No encontramos clientes con esos criterios." descripcion="Probá con otro texto o quitá algún filtro." />
              ) : (
                <EstadoVacio titulo="Todavía no hay clientes cargados." />
              )
            ) : (
              <>
                <ContenidoAdaptable
                  items={clientes}
                  columnas={columnas}
                  obtenerClave={(cliente) => cliente.id}
                  etiquetaTabla="Clientes"
                  acciones={(cliente) => (
                    <Stack direction="row" spacing={1} alignItems="center">
                      {puedeEditar ? (
                        <Checkbox
                          checked={seleccion.has(cliente.id)}
                          onChange={() => alternar(cliente.id)}
                          slotProps={{ input: { 'aria-label': `Seleccionar ${cliente.nombre}` } }}
                          size="small"
                        />
                      ) : null}
                      {cliente.archivado_en ? <Chip size="small" label="Archivado" /> : null}
                      <Button component={RouterLink} to={`/clientes/show/${cliente.id}`} aria-label={`Ver ${cliente.nombre}`} size="small" variant="outlined">Ver ficha</Button>
                      {puedeEditar ? <Button component={RouterLink} to={`/clientes/edit/${cliente.id}`} size="small">Editar</Button> : null}
                    </Stack>
                  )}
                />
                {clientes.length > 0 ? <TablePagination
                  component="div"
                  count={total}
                  page={pagina - 1}
                  rowsPerPage={TAMANO_PAGINA}
                  rowsPerPageOptions={[TAMANO_PAGINA]}
                  onPageChange={(_, nueva) => setPagina(nueva + 1)}
                  labelRowsPerPage="Clientes por página"
                  labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
                /> : null}
              </>
            )}
          </Box>
        </Stack>
        )}
      </ContenedorSeccion>
    </Box>
  )
}
