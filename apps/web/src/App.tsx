import { Authenticated, ErrorComponent, Refine, useGetIdentity } from '@refinedev/core'
import { RefineSnackbarProvider, ThemedLayout, useNotificationProvider } from '@refinedev/mui'
import { dataProvider as supabaseDataProvider } from '@refinedev/supabase'
import routerProvider, {
  CatchAllNavigate,
  DocumentTitleHandler,
  UnsavedChangesNotifier,
} from '@refinedev/react-router'
import { Avatar, CssBaseline, ThemeProvider } from '@mui/material'
import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes } from 'react-router'
import { authProvider } from './providers/authProvider'
import { accessControlProvider } from './providers/accessControlProvider'
import { i18nProvider } from './providers/i18nProvider'
import { supabaseClient } from './lib/supabase'
import { RequiereOrganizacionActiva } from './components/RequiereOrganizacionActiva'
import { RequiereAccesoSeccion } from './components/RequiereAccesoSeccion'
import { RequiereServiceTecnico } from './components/service/RequiereServiceTecnico'
import { ContextoPanelProvider } from './context/ContextoPanel'
import { PermisosPanelProvider } from './context/PermisosPanel'
import { AvisoCotizacion } from './components/cotizacion/AvisoCotizacion'
import { SiderPanel } from './components/navegacion/SiderPanel'
import { EncabezadoPanel } from './components/navegacion/EncabezadoPanel'
import { LoginPage } from './pages/login'
import { OrganizacionCreate } from './pages/organizaciones/create'
import { OrganizacionList } from './pages/organizaciones/list'
import { OrganizacionEdit } from './pages/organizacion/edit'
import { ServidorCreate } from './pages/servidores/create'
import { ServidorList } from './pages/servidores/list'
import { ConexionCreate } from './pages/conexiones/create'
import { ConexionEdit } from './pages/conexiones/edit'
import { ConexionList } from './pages/conexiones/list'
import { ConexionOAuthList } from './pages/conexiones-oauth/list'
import { IntegracionOAuthAdministrar } from './pages/integraciones-oauth/administrar'
import { EjecucionList } from './pages/ejecuciones/list'
import { EjecucionShow } from './pages/ejecuciones/show'
import { ClienteCreate } from './pages/clientes/create'
import { ClienteEdit } from './pages/clientes/edit'
import { ClienteList } from './pages/clientes/list'
import { ClienteShow } from './pages/clientes/show'
import { ProveedorList } from './pages/proveedores/list'
import { ProveedorShow } from './pages/proveedores/show'
import { TransporteList } from './pages/ventas/transportes/list'
import { ConfiguracionVentas } from './pages/ventas/configuracion'
import { CuentasCobroList } from './pages/ventas/cuentas-cobro/list'
import { DespachoList } from './pages/ventas/despacho'
import { FaltantesList } from './pages/ventas/faltantes'
import { EstadoCargaPagina } from './components/estados/EstadosPagina'
import { EmpresaEdit } from './pages/empresas/edit'
import { EmpresaList } from './pages/empresas/list'
import { EmpresaPrecios } from './pages/empresas/precios'
import { AnaliticaAdministrar } from './pages/analitica/administrar'
import { AnaliticaList } from './pages/analitica/list'
import { AnaliticaPermisos } from './pages/analitica/permisos'
import { FeaturesAdministrar } from './pages/features/administrar'
import { UsuarioCreate } from './pages/usuarios/create'
import { UsuarioList } from './pages/usuarios/list'
import { RolesPermisos } from './pages/roles/list'
import { DefinirContrasenaPage } from './pages/acceso/definir-contrasena'
import { SolicitarRecuperacionPage } from './pages/acceso/solicitar-recuperacion'
import { CambiarContrasenaPage } from './pages/cuenta/cambiar-contrasena'
import { CambiarCorreoPage } from './pages/cuenta/cambiar-correo'
import { PerfilPage } from './pages/cuenta/perfil'
import { IaList } from './pages/ia/list'
import { IaModelos } from './pages/ia/modelos'
import { IaProveedores } from './pages/ia/proveedores'
import { IaContratos } from './pages/ia/contratos'
import { IaPoliticas } from './pages/ia/politicas'
import { IaInteracciones } from './pages/ia/interacciones'
import { IaCapacidadesMcp } from './pages/ia/capacidades-mcp'
import { IaChat } from './pages/ia/chat'
import { IaCapacidadesChat } from './pages/ia/capacidades-chat'
import { ChatFlotante } from './components/ia/ChatFlotante'
import { IaDocumentos } from './pages/ia/documentos'
import { temaPanel } from './tema/temaPanel'
import './App.css'

// La pantalla Actividad queda fuera del recorrido principal: se descarga al entrar (Principio VI).
const RentabilidadResumen = lazy(() => import('./pages/rentabilidad').then((modulo) => ({ default: modulo.RentabilidadResumen })))
const RentabilidadPorProducto = lazy(() => import('./pages/rentabilidad/PorProducto').then((modulo) => ({ default: modulo.RentabilidadPorProducto })))
const RentabilidadComparativo = lazy(() => import('./pages/rentabilidad/Comparativo').then((modulo) => ({ default: modulo.RentabilidadComparativo })))
const RentabilidadHistoria = lazy(() => import('./pages/rentabilidad/Historia').then((modulo) => ({ default: modulo.RentabilidadHistoria })))
const CotizacionPage = lazy(() => import('./pages/cotizacion').then((modulo) => ({ default: modulo.CotizacionPage })))
const AvisosPage = lazy(() => import('./pages/cuenta/avisos').then((modulo) => ({ default: modulo.AvisosPage })))
const ActividadList = lazy(() => import('./pages/actividad/list').then((modulo) => ({ default: modulo.ActividadList })))
// Catálogo: también fuera del recorrido principal (Principio VI, FR-018).
const ProductoList = lazy(() => import('./pages/productos/list').then((modulo) => ({ default: modulo.ProductoList })))
const ProductoEdit = lazy(() => import('./pages/productos/edit').then((modulo) => ({ default: modulo.ProductoEdit })))
const ProductoCreate = lazy(() => import('./pages/productos/create').then((modulo) => ({ default: modulo.ProductoCreate })))
const CategoriaList = lazy(() => import('./pages/categorias/list').then((modulo) => ({ default: modulo.CategoriaList })))
// Stock: también fuera del recorrido principal (Principio VI).
const StockList = lazy(() => import('./pages/stock/list').then((modulo) => ({ default: modulo.StockList })))
const MovimientosStock = lazy(() => import('./pages/stock/movimientos').then((modulo) => ({ default: modulo.MovimientosStock })))
const IngresosMercaderia = lazy(() => import('./pages/stock/ingresos').then((modulo) => ({ default: modulo.IngresosMercaderia })))
const ListasConfigurables = lazy(() => import('./pages/configuracion/listas').then((modulo) => ({ default: modulo.ListasConfigurables })))
const LoteStock = lazy(() => import('./pages/stock/lote').then((modulo) => ({ default: modulo.LoteStock })))
const MotivosMovimiento = lazy(() => import('./pages/stock/motivos').then((modulo) => ({ default: modulo.MotivosMovimiento })))
const DepositosStock = lazy(() => import('./pages/stock/depositos').then((modulo) => ({ default: modulo.DepositosStock })))
const ActualizarStockExcel = lazy(() => import('./pages/stock/excel').then((modulo) => ({ default: modulo.ActualizarStockExcel })))
const FaltantesStock = lazy(() => import('./pages/stock/faltantes').then((modulo) => ({ default: modulo.FaltantesStock })))
const TomaInventario = lazy(() => import('./pages/stock/toma-inventario').then((modulo) => ({ default: modulo.TomaInventario })))
const MasVendidosStock = lazy(() => import('./pages/stock/mas-vendidos').then((modulo) => ({ default: modulo.MasVendidosStock })))
// Importación del historial: pantalla puntual de migración (MSF-293, FR-010).
const ConsultaList = lazy(() => import('./pages/consultas/list').then((modulo) => ({ default: modulo.ConsultaList })))
const HistorialList = lazy(() => import('./pages/historial/list').then((modulo) => ({ default: modulo.HistorialList })))
const HistorialImportar = lazy(() => import('./pages/historial/importar').then((modulo) => ({ default: modulo.HistorialImportar })))
// Migración de datos desde el panel actual (F-MIG-01, FR-010): pantalla puntual
// del corte, fuera del recorrido principal, por eso se carga al entrar.
const MigracionImportar = lazy(() => import('./pages/migracion/importar').then((modulo) => ({ default: modulo.MigracionImportar })))
const MigracionInformes = lazy(() => import('./pages/migracion/informes').then((modulo) => ({ default: modulo.MigracionInformes })))
const MigracionInformeDetalle = lazy(() => import('./pages/migracion/informes').then((modulo) => ({ default: modulo.MigracionInformeDetalle })))
const ServicioReparaciones = lazy(() => import('./pages/service-tecnico/reparaciones').then((modulo) => ({ default: modulo.ServicioReparaciones })))
const ServicioReparacion = lazy(() => import('./pages/service-tecnico/reparacion').then((modulo) => ({ default: modulo.ServicioReparacion })))
const ServicioOrdenIngreso = lazy(() => import('./pages/service-tecnico/orden-ingreso').then((modulo) => ({ default: modulo.ServicioOrdenIngreso })))
const ServicioRemitoEntrega = lazy(() => import('./pages/service-tecnico/remito-entrega').then((modulo) => ({ default: modulo.ServicioRemitoEntrega })))
const ServicioModelos = lazy(() => import('./pages/service-tecnico/modelos').then((modulo) => ({ default: modulo.ServicioModelos })))
const ServicioEstados = lazy(() => import('./pages/service-tecnico/estados').then((modulo) => ({ default: modulo.ServicioEstados })))
// Ventas: también fuera del recorrido principal (Principio VI).
const ComprobantesList = lazy(() => import('./pages/ventas/comprobantes').then((modulo) => ({ default: modulo.ComprobantesList })))
const PresupuestosList = lazy(() => import('./pages/ventas/presupuestos').then((modulo) => ({ default: modulo.PresupuestosList })))
const ComprobanteVenta = lazy(() => import('./pages/ventas/comprobante').then((modulo) => ({ default: modulo.ComprobanteVenta })))
// Gestión de la tienda online: dentro de Empresas, fuera del recorrido principal (Principio VI).
const GestionTienda = lazy(() => import('./pages/empresas/tienda/GestionTienda').then((modulo) => ({ default: modulo.GestionTienda })))

const services = [
  ['Refine', 'Interfaz operativa', 'local :4300 · Dokploy'],
  ['Supabase', 'Datos y autenticación', 'local :9300 · Cloud'],
  ['Kestra', 'Automatizaciones', 'local :8085 · VPS'],
  ['Superset', 'Reportes y métricas', 'local :8089 · VPS'],
]

// Home de quien ya inició sesión, hasta que exista una pantalla de negocio
// propia (organizaciones/clientes se agregan como recursos en las
// siguientes historias de la spec 003).
type Identity = { id: string; email?: string }

type PerfilIdentidad = { nombre: string | null; apellido: string | null }

export function IndicadorSesionActiva() {
  const { data: identity, isLoading } = useGetIdentity<Identity>()
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [nombreCompleto, setNombreCompleto] = useState<string | null>(null)

  useEffect(() => {
    let activa = true
    if (!identity?.id) {
      setFotoUrl(null)
      setNombreCompleto(null)
      return () => { activa = false }
    }
    // La identidad solo solicita su propia fila; RLS impide leer perfiles ajenos.
    const cargarNombreCompleto = async () => {
      try {
        const { data } = await supabaseClient
          .from('perfiles_usuario')
          .select('nombre, apellido')
          .eq('user_id', identity.id)
          .maybeSingle<PerfilIdentidad>()
        if (activa) setNombreCompleto(data?.nombre && data?.apellido ? `${data.nombre} ${data.apellido}` : null)
      } catch {
        if (activa) setNombreCompleto(null)
      }
    }
    void cargarNombreCompleto()
    // La identidad solo solicita su propia ruta estable; Storage aplica RLS.
    void supabaseClient.storage.from('fotos-perfil').createSignedUrl(`${identity.id}/avatar`, 60)
      .then(({ data }) => { if (activa) setFotoUrl(data?.signedUrl ?? null) })
      .catch(() => { if (activa) setFotoUrl(null) })
    return () => { activa = false }
  }, [identity?.id])

  // Al cerrar la sesion Refine invalida la identidad y este componente deja de
  // renderizarla; asi no queda el correo anterior visible durante la salida.
  if (isLoading || !identity?.email) {
    return null
  }

  return (
    <p>
      <Avatar src={fotoUrl ?? undefined} alt="Tu foto de perfil" sx={{ width: 28, height: 28, display: 'inline-flex', verticalAlign: 'middle', mr: 1 }}>?</Avatar>
      Logueado como <strong>{nombreCompleto ?? identity.email}</strong>. <Link to="/cuenta/perfil">Ver mi perfil</Link>
    </p>
  )
}

export function Home() {
  return (
    <main className="shell">
      <AvisoCotizacion />
      <header className="hero">
        <p className="eyebrow">Automation Platform Template</p>
        <h1>Automatizaciones multi-tenant, coordinadas en un solo producto.</h1>
        <p className="lead">
          Base técnica preparada para desarrollar con Claude Code o Codex usando
          el mismo flujo de especificaciones.
        </p>
        <IndicadorSesionActiva />
      </header>

      <section className="grid" aria-label="Servicios del producto">
        {services.map(([name, purpose, destination]) => (
          <article className="card" key={name}>
            <h2>{name}</h2>
            <p>{purpose}</p>
            <small>{destination}</small>
          </article>
        ))}
      </section>
    </main>
  )
}

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider theme={temaPanel}>
        <CssBaseline />
        <RefineSnackbarProvider>
          <Refine
            dataProvider={supabaseDataProvider(supabaseClient)}
            authProvider={authProvider}
            accessControlProvider={accessControlProvider}
            i18nProvider={i18nProvider}
            routerProvider={routerProvider}
            notificationProvider={useNotificationProvider}
            resources={[
              {
                name: 'organizaciones',
                list: '/organizaciones',
                create: '/organizaciones/create',
                meta: { label: 'Organizaciones' },
              },
              {
                name: 'servidores',
                list: '/servidores',
                create: '/servidores/create',
                meta: { label: 'Servidores' },
              },
              {
                name: 'clientes',
                list: '/clientes',
                create: '/clientes/create',
                edit: '/clientes/edit/:id',
                show: '/clientes/show/:id',
                meta: { label: 'Clientes' },
              },
              { name: 'proveedores', list: '/proveedores', show: '/proveedores/show/:id', meta: { label: 'Proveedores' } },
              { name: 'cuentas-cobro', list: '/ventas/cuentas-cobro', meta: { label: 'Cuentas de cobro' } },
              { name: 'productos', list: '/productos', create: '/productos/create', edit: '/productos/:id/edit', meta: { label: 'Productos' } },
              { name: 'categorias', list: '/categorias', meta: { label: 'Categorías' } },
              { name: 'stock', list: '/stock', meta: { label: 'Stock' } },
              { name: 'historial', list: '/historial', meta: { label: 'Historial' } },
              { name: 'consultas', list: '/consultas', meta: { label: 'Consultas' } },
              { name: 'service-tecnico-reparaciones', list: '/service-tecnico/reparaciones', create: '/service-tecnico/reparaciones/nueva', show: '/service-tecnico/reparaciones/:id', meta: { label: 'Reparaciones' } },
              { name: 'service-tecnico-modelos', list: '/service-tecnico/modelos', meta: { label: 'Modelos' } },
              { name: 'service-tecnico-estados', list: '/service-tecnico/estados', meta: { label: 'Estados de reparación' } },
              { name: 'ventas-presupuestos', list: '/ventas/presupuestos', meta: { label: 'Presupuestos' } },
              { name: 'ventas-comprobantes', list: '/ventas/comprobantes', create: '/ventas/comprobantes/nuevo', show: '/ventas/comprobantes/:id', meta: { label: 'Comprobantes' } },
              { name: 'ventas-despacho', list: '/ventas/despacho', meta: { label: 'Despacho' } },
              { name: 'ventas-faltantes', list: '/ventas/faltantes', meta: { label: 'Faltantes' } },
              { name: 'organizacion', list: '/organizacion', meta: { label: 'Mi organización' } },
              { name: 'empresas', list: '/empresas', edit: '/empresas/edit/:id', meta: { label: 'Empresas' } },
              { name: 'conexiones', list: '/conexiones', create: '/conexiones/create', edit: '/conexiones/edit/:id', meta: { label: 'Conexiones' } },
              { name: 'conexiones-oauth', list: '/conexiones-oauth', meta: { label: 'Conexiones OAuth' } },
              { name: 'integraciones-oauth-administrar', list: '/integraciones-oauth/administrar', meta: { label: 'Integraciones OAuth (administrar)' } },
              { name: 'ejecuciones', list: '/ejecuciones', show: '/ejecuciones/:id', meta: { label: 'Ejecuciones' } },
              {
                name: 'analitica-administrar',
                list: '/analitica/administrar',
                meta: { label: 'Analítica (administrar)' },
              },
              {
                name: 'analitica',
                list: '/analitica',
                meta: { label: 'Analítica' },
              },
              {
                name: 'features-administrar',
                list: '/features/administrar',
                meta: { label: 'Funcionalidades (administrar)' },
              },
              { name: 'usuarios', list: '/usuarios', create: '/usuarios/create', meta: { label: 'Usuarios' } },
              { name: 'roles', list: '/roles', meta: { label: 'Roles y permisos' } },
              { name: 'migracion', list: '/migracion/importar/clientes', meta: { label: 'Migración de datos' } },
              { name: 'actividad', list: '/actividad', meta: { label: 'Actividad' } },
              { name: 'cotizacion', list: '/cotizacion', meta: { label: 'Cotización del dólar' } },
              { name: 'rentabilidad', list: '/rentabilidad', meta: { label: 'Rentabilidad' } },
              { name: 'cuenta', list: '/cuenta/perfil', meta: { label: 'Mi cuenta' } },
              { name: 'ia', list: '/ia', meta: { label: 'IA gobernada' } },
            ]}
            options={{
              syncWithLocation: true,
              warnWhenUnsavedChanges: true,
              disableTelemetry: true,
              title: { text: 'Gestión comercial' },
            }}
          >
            <ContextoPanelProvider>
            <PermisosPanelProvider>
            <Routes>
              <Route path="/acceso/definir-contrasena" element={<DefinirContrasenaPage />} />
              <Route path="/acceso/solicitar-recuperacion" element={<SolicitarRecuperacionPage />} />
              <Route
                element={
                  <Authenticated key="protegido" fallback={<CatchAllNavigate to="/login" />}>
                    <ThemedLayout Sider={SiderPanel} Header={EncabezadoPanel}>
                      <Outlet />
                      <ChatFlotante />
                    </ThemedLayout>
                  </Authenticated>
                }
              >
                <Route index element={<Home />} />
                <Route path="/organizaciones" element={<OrganizacionList />} />
                <Route path="/organizaciones/create" element={<OrganizacionCreate />} />
                <Route path="/servidores" element={<ServidorList />} />
                <Route path="/servidores/create" element={<ServidorCreate />} />
                <Route path="/conexiones" element={<RequiereOrganizacionActiva><ConexionList /></RequiereOrganizacionActiva>} />
                <Route path="/conexiones/create" element={<RequiereOrganizacionActiva><ConexionCreate /></RequiereOrganizacionActiva>} />
                <Route path="/conexiones/edit/:id" element={<RequiereOrganizacionActiva><ConexionEdit /></RequiereOrganizacionActiva>} />
                <Route path="/conexiones-oauth" element={<RequiereOrganizacionActiva><ConexionOAuthList /></RequiereOrganizacionActiva>} />
                <Route path="/integraciones-oauth/administrar" element={<IntegracionOAuthAdministrar />} />
                <Route path="/ejecuciones" element={<RequiereOrganizacionActiva><EjecucionList /></RequiereOrganizacionActiva>} />
                <Route path="/ejecuciones/:id" element={<RequiereOrganizacionActiva><EjecucionShow /></RequiereOrganizacionActiva>} />
                <Route
                  path="/consultas"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="consultas">
                        <Suspense fallback={<EstadoCargaPagina />}><ConsultaList /></Suspense>
                      </RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/historial"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="ventas">
                        <Suspense fallback={<EstadoCargaPagina />}><HistorialList /></Suspense>
                      </RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/historial/importar"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="ventas">
                        <Suspense fallback={<EstadoCargaPagina />}><HistorialImportar /></Suspense>
                      </RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/clientes"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="clientes"><ClienteList /></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route path="/organizacion" element={<RequiereOrganizacionActiva><OrganizacionEdit /></RequiereOrganizacionActiva>} />
                <Route path="/empresas" element={<RequiereOrganizacionActiva><EmpresaList /></RequiereOrganizacionActiva>} />
                <Route path="/configuracion/listas" element={<RequiereOrganizacionActiva><Suspense fallback={<EstadoCargaPagina />}><ListasConfigurables /></Suspense></RequiereOrganizacionActiva>} />
                <Route path="/empresas/edit/:id" element={<RequiereOrganizacionActiva><EmpresaEdit /></RequiereOrganizacionActiva>} />
                <Route path="/empresas/:id/tienda" element={<Navigate to="identidad" replace />} />
                <Route
                  path="/empresas/:id/tienda/:pestana"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="empresas">
                        <Suspense fallback={<EstadoCargaPagina />}><GestionTienda /></Suspense>
                      </RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route path="/empresas/edit/:id/precios" element={<RequiereOrganizacionActiva><RequiereAccesoSeccion seccion="empresas"><EmpresaPrecios /></RequiereAccesoSeccion></RequiereOrganizacionActiva>} />
                <Route path="/usuarios" element={<RequiereOrganizacionActiva><RequiereAccesoSeccion seccion="usuarios_permisos"><UsuarioList /></RequiereAccesoSeccion></RequiereOrganizacionActiva>} />
                <Route path="/usuarios/create" element={<RequiereOrganizacionActiva><RequiereAccesoSeccion seccion="usuarios_permisos"><UsuarioCreate /></RequiereAccesoSeccion></RequiereOrganizacionActiva>} />
                <Route path="/miembros" element={<Navigate to="/usuarios" replace />} />
                <Route path="/miembros/create" element={<Navigate to="/usuarios/create" replace />} />
                <Route path="/roles" element={<RequiereOrganizacionActiva><RequiereAccesoSeccion seccion="usuarios_permisos"><RolesPermisos /></RequiereAccesoSeccion></RequiereOrganizacionActiva>} />
                <Route path="/actividad" element={<RequiereOrganizacionActiva><RequiereAccesoSeccion seccion="actividad"><Suspense fallback={<EstadoCargaPagina />}><ActividadList /></Suspense></RequiereAccesoSeccion></RequiereOrganizacionActiva>} />
                <Route path="/rentabilidad" element={<RequiereOrganizacionActiva><RequiereAccesoSeccion seccion="rentabilidad"><Suspense fallback={<EstadoCargaPagina />}><RentabilidadResumen /></Suspense></RequiereAccesoSeccion></RequiereOrganizacionActiva>} />
                <Route path="/rentabilidad/productos" element={<RequiereOrganizacionActiva><RequiereAccesoSeccion seccion="rentabilidad"><Suspense fallback={<EstadoCargaPagina />}><RentabilidadPorProducto /></Suspense></RequiereAccesoSeccion></RequiereOrganizacionActiva>} />
                <Route path="/rentabilidad/comparativo" element={<RequiereOrganizacionActiva><RequiereAccesoSeccion seccion="rentabilidad"><Suspense fallback={<EstadoCargaPagina />}><RentabilidadComparativo /></Suspense></RequiereAccesoSeccion></RequiereOrganizacionActiva>} />
                <Route path="/rentabilidad/historia" element={<RequiereOrganizacionActiva><RequiereAccesoSeccion seccion="rentabilidad"><Suspense fallback={<EstadoCargaPagina />}><RentabilidadHistoria /></Suspense></RequiereAccesoSeccion></RequiereOrganizacionActiva>} />
                <Route path="/cotizacion" element={<RequiereOrganizacionActiva><RequiereAccesoSeccion seccion="cotizacion_dolar"><Suspense fallback={<EstadoCargaPagina />}><CotizacionPage /></Suspense></RequiereAccesoSeccion></RequiereOrganizacionActiva>} />
                <Route
                  path="/productos"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="productos"><Suspense fallback={<EstadoCargaPagina />}><ProductoList /></Suspense></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/categorias"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="categorias"><Suspense fallback={<EstadoCargaPagina />}><CategoriaList /></Suspense></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/productos/create"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="productos"><Suspense fallback={<EstadoCargaPagina />}><ProductoCreate /></Suspense></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/productos/:id/edit"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="productos"><Suspense fallback={<EstadoCargaPagina />}><ProductoEdit /></Suspense></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/stock"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="stock"><Suspense fallback={<EstadoCargaPagina />}><StockList /></Suspense></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/stock/movimientos"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="stock"><Suspense fallback={<EstadoCargaPagina />}><MovimientosStock /></Suspense></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/stock/ingresos"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="stock"><Suspense fallback={<EstadoCargaPagina />}><IngresosMercaderia /></Suspense></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/stock/depositos"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="stock"><Suspense fallback={<EstadoCargaPagina />}><DepositosStock /></Suspense></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/stock/lote"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="stock"><Suspense fallback={<EstadoCargaPagina />}><LoteStock /></Suspense></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/stock/toma-inventario"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="stock"><Suspense fallback={<EstadoCargaPagina />}><TomaInventario /></Suspense></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/stock/faltantes"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="stock"><Suspense fallback={<EstadoCargaPagina />}><FaltantesStock /></Suspense></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/stock/excel"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="stock"><Suspense fallback={<EstadoCargaPagina />}><ActualizarStockExcel /></Suspense></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/stock/motivos"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="stock"><Suspense fallback={<EstadoCargaPagina />}><MotivosMovimiento /></Suspense></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/stock/mas-vendidos"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="stock"><Suspense fallback={<EstadoCargaPagina />}><MasVendidosStock /></Suspense></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route path="/ventas" element={<Navigate to="/ventas/comprobantes" replace />} />
                {/* F-VTA-09 (MSF-346): listado de facturas y notas; el alta sigue en /ventas/comprobantes/nuevo. */}
                <Route
                  path="/ventas/comprobantes"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="ventas"><Suspense fallback={<EstadoCargaPagina />}><ComprobantesList /></Suspense></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/ventas/presupuestos"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="ventas"><Suspense fallback={<EstadoCargaPagina />}><PresupuestosList /></Suspense></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/ventas/comprobantes/nuevo"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="ventas"><Suspense fallback={<EstadoCargaPagina />}><ComprobanteVenta /></Suspense></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/ventas/comprobantes/:id"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="ventas"><Suspense fallback={<EstadoCargaPagina />}><ComprobanteVenta /></Suspense></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route path="/service-tecnico" element={<Navigate to="/service-tecnico/reparaciones" replace />} />
                <Route
                  path="/service-tecnico/reparaciones"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="service_tecnico">
                        <RequiereServiceTecnico><Suspense fallback={<EstadoCargaPagina />}><ServicioReparaciones /></Suspense></RequiereServiceTecnico>
                      </RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/service-tecnico/reparaciones/nueva"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="service_tecnico">
                        <RequiereServiceTecnico><Suspense fallback={<EstadoCargaPagina />}><ServicioReparacion /></Suspense></RequiereServiceTecnico>
                      </RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/service-tecnico/reparaciones/:id"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="service_tecnico">
                        <RequiereServiceTecnico><Suspense fallback={<EstadoCargaPagina />}><ServicioReparacion /></Suspense></RequiereServiceTecnico>
                      </RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/service-tecnico/reparaciones/:id/orden"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="service_tecnico">
                        <RequiereServiceTecnico><Suspense fallback={<EstadoCargaPagina />}><ServicioOrdenIngreso /></Suspense></RequiereServiceTecnico>
                      </RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/service-tecnico/reparaciones/:id/remito"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="service_tecnico">
                        <RequiereServiceTecnico><Suspense fallback={<EstadoCargaPagina />}><ServicioRemitoEntrega /></Suspense></RequiereServiceTecnico>
                      </RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/service-tecnico/modelos"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="service_tecnico">
                        <RequiereServiceTecnico><Suspense fallback={<EstadoCargaPagina />}><ServicioModelos /></Suspense></RequiereServiceTecnico>
                      </RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/service-tecnico/estados"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="service_tecnico">
                        <RequiereServiceTecnico><Suspense fallback={<EstadoCargaPagina />}><ServicioEstados /></Suspense></RequiereServiceTecnico>
                      </RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route path="/service-tecnico/*" element={<Navigate to="/service-tecnico/reparaciones" replace />} />
                <Route path="/cuenta/cambiar-contrasena" element={<CambiarContrasenaPage />} />
                <Route path="/cuenta/cambiar-correo" element={<CambiarCorreoPage />} />
                <Route path="/cuenta/avisos" element={<Suspense fallback={<EstadoCargaPagina />}><AvisosPage /></Suspense>} />
                <Route path="/cuenta/perfil" element={<PerfilPage />} />
                <Route
                  path="/clientes/create"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="clientes"><ClienteCreate /></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/clientes/edit/:id"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="clientes"><ClienteEdit /></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/clientes/show/:id"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="clientes"><ClienteShow /></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/migracion/importar/:entidad"
                  element={
                    <RequiereOrganizacionActiva>
                      <Suspense fallback={<EstadoCargaPagina />}><MigracionImportar /></Suspense>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/migracion/informes"
                  element={
                    <RequiereOrganizacionActiva>
                      <Suspense fallback={<EstadoCargaPagina />}><MigracionInformes /></Suspense>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/migracion/informes/:carga"
                  element={
                    <RequiereOrganizacionActiva>
                      <Suspense fallback={<EstadoCargaPagina />}><MigracionInformeDetalle /></Suspense>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/proveedores"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="proveedores"><ProveedorList /></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/proveedores/show/:id"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="proveedores"><ProveedorShow /></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/ventas/transportes"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="ventas"><TransporteList /></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/ventas/configuracion"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="ventas"><ConfiguracionVentas /></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/ventas/cuentas-cobro"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="ventas"><CuentasCobroList /></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                {/* F-VTA-17 (MSF-183): tablero de despacho de las facturas (solo lectura). */}
                <Route
                  path="/ventas/despacho"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="ventas"><DespachoList /></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                {/* F-VTA-18 (MSF-201): faltantes abiertos de las ventas (solo lectura). */}
                <Route
                  path="/ventas/faltantes"
                  element={
                    <RequiereOrganizacionActiva>
                      <RequiereAccesoSeccion seccion="ventas"><FaltantesList /></RequiereAccesoSeccion>
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route path="/analitica/administrar" element={<AnaliticaAdministrar />} />
                <Route
                  path="/analitica"
                  element={
                    <RequiereOrganizacionActiva>
                      <AnaliticaList />
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route
                  path="/analitica/permisos"
                  element={
                    <RequiereOrganizacionActiva>
                      <AnaliticaPermisos />
                    </RequiereOrganizacionActiva>
                  }
                />
                <Route path="/features/administrar" element={<FeaturesAdministrar />} />
                <Route path="/ia" element={<IaList />} />
                <Route path="/ia/proveedores" element={<IaProveedores />} />
                <Route path="/ia/modelos" element={<IaModelos />} />
                <Route path="/ia/contratos" element={<IaContratos />} />
                <Route path="/ia/politicas" element={<IaPoliticas />} />
                <Route path="/ia/interacciones" element={<IaInteracciones />} />
                <Route path="/ia/capacidades-mcp" element={<IaCapacidadesMcp />} />
                <Route path="/ia/chat" element={<IaChat />} />
                <Route path="/ia/capacidades-chat" element={<IaCapacidadesChat />} />
                <Route path="/ia/documentos" element={<IaDocumentos />} />
              </Route>

              <Route
                element={
                  <Authenticated key="publico" fallback={<Outlet />}>
                    <Navigate to="/" replace />
                  </Authenticated>
                }
              >
                <Route path="/login" element={<LoginPage />} />
              </Route>

              <Route
                element={
                  <Authenticated key="catch-all">
                    <ThemedLayout Sider={SiderPanel} Header={EncabezadoPanel}>
                      <Outlet />
                    </ThemedLayout>
                  </Authenticated>
                }
              >
                <Route path="*" element={<ErrorComponent />} />
              </Route>
            </Routes>
            </PermisosPanelProvider>
            </ContextoPanelProvider>
            <UnsavedChangesNotifier />
            <DocumentTitleHandler />
          </Refine>
        </RefineSnackbarProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

export default App
