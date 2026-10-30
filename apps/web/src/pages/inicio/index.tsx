import { useSyncExternalStore } from 'react'
import { Box } from '@mui/material'
import { EstadoCargaPagina, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { usePermisosPanel } from '../../context/PermisosPanel'
import { revisionEmpresaActiva, suscribirEmpresaActiva } from '../../lib/empresaActivaRevision'
import { fechaDeInicio, puedeEditar, puedeVer, saludoDeInicio } from '../../lib/inicio'
import { AccesosDirectos } from './AccesosDirectos'
import { TarjetaConsultas } from './TarjetaConsultas'
import { TarjetaDolar } from './TarjetaDolar'
import { TarjetaEmpresas } from './TarjetaEmpresas'
import { TarjetaStock } from './TarjetaStock'
import { useNombrePerfil } from './useNombrePerfil'

// Inicio (F-INI-01, MSF-344): reemplaza la portada de servicios del template en `/`. Consultas en vivo por
// tarjeta; cada elemento aparece solo si el rol tiene lectura de su sección de origen (FR-007) y las
// acciones piden edición. Los datos de Mercado Libre / precios en revisión no existen todavía: sus tarjetas
// se montan recién cuando `tiene_feature` esté activa (FR-009, épicas de Mercado Libre).
export function InicioPage() {
  const nombre = useNombrePerfil()
  const permisos = usePermisosPanel()
  const stock = useNivelSeccion('stock').nivel
  const consultas = useNivelSeccion('consultas').nivel
  const dolar = useNivelSeccion('cotizacion_dolar').nivel
  const ventas = useNivelSeccion('ventas').nivel
  const productos = useNivelSeccion('productos').nivel
  const empresas = useNivelSeccion('empresas').nivel
  // Cambió la empresa activa (barra superior): se remonta el contenido y se recarga todo (Principio VIII, FR-010).
  const revision = useSyncExternalStore(suscribirEmpresaActiva, revisionEmpresaActiva, revisionEmpresaActiva)

  const ahora = new Date()
  const encabezado = (
    <EncabezadoPagina
      titulo={saludoDeInicio(nombre)}
      descripcion={`${fechaDeInicio(ahora)} · stock, consultas y dólar de tus tiendas`}
      accion={<AccesosDirectos />}
    />
  )

  if (!permisos || permisos.isLoading) {
    return <Box component="main">{encabezado}<EstadoCargaPagina /></Box>
  }

  const verStock = puedeVer(stock)
  const verConsultas = puedeVer(consultas)
  const verDolar = puedeVer(dolar)
  const sinNada = !verStock && !verConsultas && !verDolar && !puedeVer(empresas) && !puedeEditar(ventas) && !puedeEditar(productos)

  return (
    <Box component="main">
      {encabezado}
      {sinNada ? (
        <EstadoVacio titulo="Tu rol todavía no tiene secciones habilitadas" descripcion="Pedile a la persona que administra tu cuenta que te asigne un rol con acceso." />
      ) : (
        <Box
          key={revision}
          sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' } }}
        >
          <TarjetaEmpresas />
          {verStock ? <TarjetaStock /> : null}
          {verConsultas ? <TarjetaConsultas /> : null}
          {verDolar ? <TarjetaDolar puedeEditar={puedeEditar(dolar)} /> : null}
        </Box>
      )}
    </Box>
  )
}

export default InicioPage
