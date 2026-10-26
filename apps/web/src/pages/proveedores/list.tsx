import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { Box, Button, Chip, LinearProgress, Stack, TablePagination, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { useListarProveedores, type EstadoProveedores, type ProveedorListado } from '../../hooks/useListarProveedores'
import { formatearCuit } from '../../lib/cuit'
import { EnviarCorreoProveedorDialog } from '../../components/proveedores/EnviarCorreoProveedorDialog'
import { ProveedorFormDialog } from '../../components/proveedores/ProveedorFormDialog'
import { EstadoCargaPagina, EstadoError, EstadoExito, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

const ESPERA_BUSQUEDA_MS = 300
const TAMANO_PAGINA = 25
// Barra de progreso indeterminada: alto fino propio del componente, no un valor del sistema.
const ALTO_BARRA_CARGA = 2
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const // estilos-sueltos: ok: oculta visualmente sin quitar del lector

const columnas: ColumnaAdaptable<ProveedorListado>[] = [
  {
    clave: 'razon_social', encabezado: 'Razón social',
    render: (proveedor) => (
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography component="span" sx={{ fontWeight: 600 }}>{proveedor.razon_social}</Typography>
        {proveedor.activo ? null : <EtiquetaEstado texto="Inactivo" />}
      </Stack>
    ),
  },
  { clave: 'cuit', encabezado: 'CUIT', render: (proveedor) => formatearCuit(proveedor.cuit) },
  {
    clave: 'compra_para', encabezado: 'Compra para',
    render: (proveedor) => proveedor.empresas.length === 0 ? '—' : (
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
        {proveedor.empresas.map((empresa) => <Chip key={empresa.id} label={empresa.nombre} size="small" variant="outlined" />)}
      </Stack>
    ),
  },
  { clave: 'correo', encabezado: 'Correo', render: (proveedor) => proveedor.correo ?? '—' },
  { clave: 'telefono', encabezado: 'Teléfono', render: (proveedor) => proveedor.telefono ?? '—' },
]

// Listado de proveedores (F-PRV-02, FR-011). Quien tiene lectura lo ve; quien tiene
// edición suma «Nuevo proveedor». RLS aplica el mismo límite en la base. La búsqueda,
// el estado y la paginación se resuelven en el servidor (`listar_proveedores`); el
// buscador espera a que se deje de tipear.
export function ProveedorList() {
  const { nivel } = useNivelSeccion('proveedores')
  const puedeEditar = nivel === 'edicion'
  // «Importar» (F-MIG-02) es de migración de datos: solo Administrador; las RPC y RLS vuelven a exigirlo.
  const puedeMigrar = usePuedeEscribir().puedeEscribir === true
  const [texto, setTexto] = useState('')
  const [textoAplicado, setTextoAplicado] = useState('')
  const [estado, setEstado] = useState<EstadoProveedores>('activos')
  const [pagina, setPagina] = useState(1)
  // Filtro de tienda (F-CLI-11, US5): arranca en la empresa activa de la barra
  // superior y la sigue al cambiarla; el select puede fijar otra tienda —o
  // «Todas»— sin tocar la activa persistida.
  const { empresas: tiendas, valor: empresaId, cambiar: elegirEmpresa } = useFiltroPorEmpresaActiva()
  const [creando, setCreando] = useState(false)
  const [paraCorreo, setParaCorreo] = useState<ProveedorListado | null>(null)
  const [correoEnviado, setCorreoEnviado] = useState(false)

  useEffect(() => {
    const espera = setTimeout(() => {
      // Solo reinicia la página si el texto cambió: no pisa la página elegida.
      if (texto !== textoAplicado) {
        setTextoAplicado(texto)
        setPagina(1)
      }
    }, ESPERA_BUSQUEDA_MS)
    return () => clearTimeout(espera)
  }, [texto, textoAplicado])

  const { proveedores, total, isLoading, isFetching, isError, refetch } = useListarProveedores({
    texto: textoAplicado, estado, empresaId, pagina, tamano: TAMANO_PAGINA,
  })

  // Página fuera de rango (p. ej. se desactivó el último de la última página): vuelve a la primera.
  useEffect(() => {
    if (!isLoading && !isFetching && !isError && proveedores.length === 0 && pagina > 1) setPagina(1)
  }, [isLoading, isFetching, isError, proveedores.length, pagina])

  const hayFiltros = textoAplicado.trim() !== '' || estado !== 'activos' || empresaId !== null

  return (
    <Box>
      <EncabezadoPagina
        titulo="Proveedores"
        descripcion="A quién le comprás."
        accion={puedeMigrar || puedeEditar ? (
          <Stack direction="row" spacing={1}>
            {puedeMigrar ? <Button component={RouterLink} to="/migracion/importar/proveedores" variant="outlined">Importar</Button> : null}
            {puedeEditar ? <Button variant="contained" onClick={() => setCreando(true)}>Nuevo proveedor</Button> : null}
          </Stack>
        ) : undefined}
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          {correoEnviado ? <EstadoExito titulo="Correo enviado al proveedor" /> : null}
          <BarraHerramientas
            contador={isLoading || isError ? undefined : `${total} ${total === 1 ? 'proveedor' : 'proveedores'}`}
          >
            <TextField
              type="search"
              label="Buscar por razón social o CUIT"
              value={texto}
              onChange={(evento) => setTexto(evento.target.value)}
              size="small"
              sx={{ width: 320, maxWidth: '100%' }}
            />
            <ToggleButtonGroup
              exclusive
              size="small"
              aria-label="Filtrar por estado"
              value={estado}
              onChange={(_, valor: EstadoProveedores | null) => {
                if (valor === null) return
                setEstado(valor)
                setPagina(1)
              }}
            >
              <ToggleButton value="activos">Activos</ToggleButton>
              <ToggleButton value="inactivos">Inactivos</ToggleButton>
              <ToggleButton value="todos">Todos</ToggleButton>
            </ToggleButtonGroup>
            {tiendas.length > 0 ? (
              <FiltroEmpresa
                empresas={tiendas}
                valor={empresaId}
                onCambiar={(nuevo) => {
                  elegirEmpresa(nuevo)
                  setPagina(1)
                }}
              />
            ) : null}
          </BarraHerramientas>

          <Box role="status" aria-live="polite" sx={visuallyHidden}>
            {isLoading || isError ? '' : `${total} ${total === 1 ? 'resultado' : 'resultados'}`}
          </Box>
          {isFetching && !isLoading ? <LinearProgress aria-label="Actualizando proveedores" sx={{ height: ALTO_BARRA_CARGA }} /> : null}

          <Box aria-busy={isFetching}>
            {isLoading ? (
              <EstadoCargaPagina />
            ) : isError ? (
              <EstadoError descripcion="No pudimos cargar los proveedores." reintentar={() => void refetch()} />
            ) : proveedores.length === 0 && pagina === 1 ? (
              hayFiltros ? (
                <EstadoVacio titulo="Sin resultados" descripcion="Probá con otro texto, estado o tienda." />
              ) : (
                <EstadoVacio
                  titulo="Todavía no hay proveedores cargados."
                  descripcion={puedeEditar ? 'Creá el primero para empezar.' : undefined}
                  accion={puedeEditar ? <Button variant="contained" onClick={() => setCreando(true)}>Nuevo proveedor</Button> : undefined}
                />
              )
            ) : (
              <>
                <ContenidoAdaptable
                  items={proveedores}
                  columnas={columnas}
                  obtenerClave={(proveedor) => proveedor.id}
                  etiquetaTabla="Proveedores"
                  acciones={(proveedor) => (
                    <Stack direction="row" spacing={1}>
                      <Button component={RouterLink} to={`/proveedores/show/${proveedor.id}`} aria-label={`Ver ficha de ${proveedor.razon_social}`} size="small" variant="outlined">
                        Ver ficha
                      </Button>
                      {puedeEditar && proveedor.correo ? (
                        <Button
                          aria-label={`Enviar correo a ${proveedor.razon_social}`}
                          size="small"
                          variant="outlined"
                          onClick={() => { setCorreoEnviado(false); setParaCorreo(proveedor) }}
                        >
                          Enviar correo
                        </Button>
                      ) : null}
                    </Stack>
                  )}
                />
                {proveedores.length > 0 ? <TablePagination
                  component="div"
                  count={total}
                  page={pagina - 1}
                  rowsPerPage={TAMANO_PAGINA}
                  rowsPerPageOptions={[TAMANO_PAGINA]}
                  onPageChange={(_, nueva) => setPagina(nueva + 1)}
                  labelRowsPerPage="Proveedores por página"
                  labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
                /> : null}
              </>
            )}
          </Box>
        </Stack>
      </ContenedorSeccion>

      {puedeEditar && paraCorreo ? (
        <EnviarCorreoProveedorDialog
          open
          proveedor={paraCorreo}
          onCerrar={() => setParaCorreo(null)}
          onEnviado={() => { setParaCorreo(null); setCorreoEnviado(true) }}
        />
      ) : null}
      {puedeEditar ? (
        <ProveedorFormDialog
          open={creando}
          onCerrar={() => setCreando(false)}
          onGuardado={() => {
            setCreando(false)
            // El nuevo aparece en el listado: vuelve al inicio con la lista vigente.
            setPagina(1)
            void refetch()
          }}
        />
      ) : null}
    </Box>
  )
}
