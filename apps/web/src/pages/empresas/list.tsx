import { EditButton } from '@refinedev/mui'
import { Box } from '@mui/material'
import { useEmpresas, type Empresa } from '../../hooks/useEmpresas'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

const SIN_CONFIGURAR = 'Sin configurar'

// Tienda web, Mercado Libre, precio y productos visibles los alimentan otras
// épicas; hasta entonces el listado dice «Sin configurar». La moneda es
// constante del producto (ARS), no una columna.
const columnas: ColumnaAdaptable<Empresa>[] = [
  { clave: 'nombre', encabezado: 'Empresa', render: (empresa) => empresa.nombre },
  { clave: 'tienda-web', encabezado: 'Tienda web', render: () => SIN_CONFIGURAR },
  { clave: 'mercado-libre', encabezado: 'Mercado Libre', render: () => SIN_CONFIGURAR },
  { clave: 'precio', encabezado: 'Precio', render: () => SIN_CONFIGURAR },
  { clave: 'moneda', encabezado: 'Moneda', render: () => 'ARS' },
  { clave: 'productos-visibles', encabezado: 'Productos visibles', render: () => SIN_CONFIGURAR },
]

// Solo administrador (FR-004): el destino del sider ya se oculta al miembro;
// acá, para quien llega por URL directa, no se consulta nada y se muestra
// acceso restringido. RLS sigue siendo el límite real del lado del servidor.
export function EmpresaList() {
  const { puedeEscribir, isLoading: verificandoPermiso } = usePuedeEscribir()
  const { empresas, isLoading, isError, refetch } = useEmpresas({ habilitado: puedeEscribir === true })

  const encabezado = <EncabezadoPagina titulo="Empresas" contexto={<ContextoOrganizacionActiva />} />

  if (verificandoPermiso || puedeEscribir === null) {
    return (
      <Box>
        {encabezado}
        <ContenedorSeccion><EstadoCargaPagina /></ContenedorSeccion>
      </Box>
    )
  }

  if (!puedeEscribir) {
    return (
      <Box>
        {encabezado}
        <ContenedorSeccion>
          <EstadoError titulo="Acceso restringido" descripcion="Solo los administradores pueden ver las empresas de la organización." />
        </ContenedorSeccion>
      </Box>
    )
  }

  return (
    <Box>
      {encabezado}
      <ContenedorSeccion>
        {isLoading ? (
          <EstadoCargaPagina />
        ) : isError ? (
          <EstadoError descripcion="No pudimos cargar las empresas." reintentar={() => void refetch()} />
        ) : empresas.length === 0 ? (
          <EstadoVacio titulo="Todavía no hay empresas cargadas." />
        ) : (
          <ContenidoAdaptable
            items={empresas}
            columnas={columnas}
            obtenerClave={(empresa) => empresa.id}
            etiquetaTabla="Empresas"
            acciones={(empresa) => <EditButton hideText recordItemId={empresa.id} />}
          />
        )}
      </ContenedorSeccion>
    </Box>
  )
}
