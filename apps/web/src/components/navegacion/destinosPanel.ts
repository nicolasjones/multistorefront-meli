import type { ComponentType } from 'react'
import type { SvgIconProps } from '@mui/material'
import HomeIcon from '@mui/icons-material/Home'
import BusinessCenterIcon from '@mui/icons-material/BusinessCenter'
import TimelineIcon from '@mui/icons-material/Timeline'
import HubIcon from '@mui/icons-material/Hub'
import GroupIcon from '@mui/icons-material/Group'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import SettingsIcon from '@mui/icons-material/Settings'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import ExtensionIcon from '@mui/icons-material/Extension'
import StorefrontIcon from '@mui/icons-material/Storefront'
import HistoryIcon from '@mui/icons-material/History'
import DomainIcon from '@mui/icons-material/Domain'
import LocalShippingIcon from '@mui/icons-material/LocalShipping'
import Inventory2Icon from '@mui/icons-material/Inventory2'
import CategoryIcon from '@mui/icons-material/Category'
import WarehouseIcon from '@mui/icons-material/Warehouse'
import DeliveryDiningIcon from '@mui/icons-material/DeliveryDining'
import PointOfSaleIcon from '@mui/icons-material/PointOfSale'
import AccountBalanceIcon from '@mui/icons-material/AccountBalance'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import RequestQuoteIcon from '@mui/icons-material/RequestQuote'
import AssignmentReturnIcon from '@mui/icons-material/AssignmentReturn'
import ProductionQuantityLimitsIcon from '@mui/icons-material/ProductionQuantityLimits'
import BuildIcon from '@mui/icons-material/Build'
import DevicesIcon from '@mui/icons-material/Devices'
import TuneIcon from '@mui/icons-material/Tune'
import CommentIcon from '@mui/icons-material/Comment'
import FileUploadIcon from '@mui/icons-material/FileUpload'
import AttachMoneyIcon from '@mui/icons-material/AttachMoney'
import InsightsIcon from '@mui/icons-material/Insights'
import type { ContextoPanel } from '../../context/ContextoPanel'
import { nivelDe, type PermisoSeccion } from '../../lib/permisos'

// Única fuente de secciones/destinos/audiencia del sider (spec
// 018-kit-panel-operable, Principio VI). Cada producto derivado reemplaza
// este archivo por sus propios destinos — el mecanismo (tipos,
// destinoVisible, SiderPanel) es lo que se porta, no esta lista.
export type AudienciaDestino = 'autenticada' | 'organizacion' | 'administrador' | 'superadmin'

export type DestinoPanel = {
  id: string
  etiqueta: string
  ruta: string
  icono: ComponentType<SvgIconProps>
  audiencia: AudienciaDestino
  rutasAnteriores?: string[]
  // Sección de la matriz de permisos por rol (F-ROL-01, FR-005): si el
  // usuario no tiene acceso a esa sección, el destino no aparece en el menú.
  seccionPermiso?: string
  // Funcionalidad del panel (spec 009) que la organización debe tener habilitada para que el destino
  // aparezca. Falla cerrada: sin la lista de funcionalidades habilitadas, un destino con `feature` no se ofrece.
  feature?: string
  // Contador que acompaña al ítem en el menú (F-CON-01): `consultas_nuevas` = consultas en estado «nueva».
  insignia?: 'consultas_nuevas'
}

export type SeccionPanel = {
  id: string
  etiqueta: string | null
  destinos: DestinoPanel[]
}

export const SECCIONES_PANEL: SeccionPanel[] = [
  {
    id: 'inicio',
    etiqueta: null,
    destinos: [
      { id: 'inicio', etiqueta: 'Inicio', ruta: '/', icono: HomeIcon, audiencia: 'autenticada', seccionPermiso: 'inicio' },
    ],
  },
  {
    id: 'catalogo',
    etiqueta: 'Catálogo',
    destinos: [
      // F-CAT-02: hasta que F-CAT-06 traiga la grilla, /productos redirige al alta (App.tsx).
      { id: 'productos', etiqueta: 'Productos', ruta: '/productos', icono: Inventory2Icon, audiencia: 'organizacion', seccionPermiso: 'productos' },
      // F-CAT-08: árbol de categorías de 2 niveles (carga diferida en App.tsx).
      { id: 'categorias', etiqueta: 'Categorías', ruta: '/categorias', icono: CategoryIcon, audiencia: 'organizacion', seccionPermiso: 'categorias' },
    ],
  },
  {
    id: 'stock',
    etiqueta: 'Stock',
    destinos: [
      { id: 'stock', etiqueta: 'Stock', ruta: '/stock', icono: WarehouseIcon, audiencia: 'organizacion', seccionPermiso: 'stock' },
      { id: 'stock-movimientos', etiqueta: 'Movimientos', ruta: '/stock/movimientos', icono: HistoryIcon, audiencia: 'organizacion', seccionPermiso: 'stock' },
      { id: 'stock-ingresos', etiqueta: 'Ingreso de mercadería', ruta: '/stock/ingresos', icono: LocalShippingIcon, audiencia: 'organizacion', seccionPermiso: 'stock' },
      { id: 'stock-depositos', etiqueta: 'Depósitos de mercadería', ruta: '/stock/depositos', icono: WarehouseIcon, audiencia: 'organizacion', seccionPermiso: 'stock' },
    ],
  },
  {
    // F-VTA-05 (FR-009): grupo propio. F-VTA-09 (MSF-346) trae el listado canónico en /ventas/comprobantes.
    id: 'ventas',
    etiqueta: 'Ventas',
    destinos: [
      { id: 'ventas-comprobantes', etiqueta: 'Comprobantes', ruta: '/ventas/comprobantes', icono: ReceiptLongIcon, audiencia: 'organizacion', seccionPermiso: 'ventas' },
      // F-VTA-08: listado de presupuestos (aceptar, copiar y modificar).
      { id: 'ventas-presupuestos', etiqueta: 'Presupuestos', ruta: '/ventas/presupuestos', icono: RequestQuoteIcon, audiencia: 'organizacion', seccionPermiso: 'ventas' },
      // F-VTA-28: devoluciones y reclamos (RMA) por ítem.
      { id: 'ventas-devoluciones', etiqueta: 'Devoluciones', ruta: '/ventas/devoluciones', icono: AssignmentReturnIcon, audiencia: 'organizacion', seccionPermiso: 'ventas' },
      // F-VTA-04: transportes y terminales de retiro (sección `ventas` de la matriz de permisos).
      { id: 'transportes', etiqueta: 'Transportes', ruta: '/ventas/transportes', icono: DeliveryDiningIcon, audiencia: 'organizacion', seccionPermiso: 'ventas' },
      // F-VTA-01: catálogos del comprobante por empresa; las demás pantallas de Ventas se suman a este grupo.
      { id: 'ventas-configuracion', etiqueta: 'Configuración de ventas', ruta: '/ventas/configuracion', icono: PointOfSaleIcon, audiencia: 'organizacion', seccionPermiso: 'ventas' },
      // F-VTA-03: cuentas de cobro de la organización (lectura con `ventas`, edición solo Administrador).
      { id: 'cuentas-cobro', etiqueta: 'Cuentas de cobro', ruta: '/ventas/cuentas-cobro', icono: AccountBalanceIcon, audiencia: 'organizacion', seccionPermiso: 'ventas' },
      // F-VTA-17 (MSF-183): tablero de despacho de las facturas (solo lectura con `ventas`).
      { id: 'ventas-despacho', etiqueta: 'Despacho', ruta: '/ventas/despacho', icono: LocalShippingIcon, audiencia: 'organizacion', seccionPermiso: 'ventas' },
      // F-VTA-18 (MSF-201): faltantes abiertos de las ventas (solo lectura con `ventas`).
      { id: 'ventas-faltantes', etiqueta: 'Faltantes', ruta: '/ventas/faltantes', icono: ProductionQuantityLimitsIcon, audiencia: 'organizacion', seccionPermiso: 'ventas' },
      // F-VTA-38: consulta de solo lectura de lo registrado antes de la plataforma.
      { id: 'historial', etiqueta: 'Historial', ruta: '/historial', icono: ReceiptLongIcon, audiencia: 'organizacion', seccionPermiso: 'ventas' },
    ],
  },
  {
    // Servicio técnico: las tres pantallas del prototipo (también accesibles como
    // pestañas dentro de cada página). Todas dependen de la funcionalidad
    // `service-tecnico` y de la sección `service_tecnico`.
    id: 'service',
    etiqueta: 'Servicio técnico',
    destinos: [
      {
        id: 'service-tecnico-reparaciones',
        etiqueta: 'Reparaciones',
        ruta: '/service-tecnico/reparaciones',
        icono: BuildIcon,
        audiencia: 'organizacion',
        seccionPermiso: 'service_tecnico',
        feature: 'service-tecnico',
      },
      {
        id: 'service-tecnico-modelos',
        etiqueta: 'Modelos',
        ruta: '/service-tecnico/modelos',
        icono: DevicesIcon,
        audiencia: 'organizacion',
        seccionPermiso: 'service_tecnico',
        feature: 'service-tecnico',
      },
      {
        id: 'service-tecnico-estados',
        etiqueta: 'Estados de reparación',
        ruta: '/service-tecnico/estados',
        icono: TuneIcon,
        audiencia: 'organizacion',
        seccionPermiso: 'service_tecnico',
        feature: 'service-tecnico',
      },
    ],
  },
  {
    // Decisión de producto (2026-10-21): Clientes y Proveedores se agrupan en Contactos.
    id: 'contactos',
    etiqueta: 'Contactos',
    destinos: [
      { id: 'clientes', etiqueta: 'Clientes', ruta: '/clientes', icono: BusinessCenterIcon, audiencia: 'organizacion', seccionPermiso: 'clientes' },
      { id: 'proveedores', etiqueta: 'Proveedores', ruta: '/proveedores', icono: LocalShippingIcon, audiencia: 'organizacion', seccionPermiso: 'proveedores' },
    ],
  },
  {
    // Decisión de producto (2026-10-21): Empresas vive en Canales.
    id: 'canales',
    etiqueta: 'Canales',
    destinos: [
      // F-CON-01: bandeja de consultas de las tiendas, primer destino de Canales, con el contador de nuevas.
      { id: 'consultas', etiqueta: 'Consultas', ruta: '/consultas', icono: CommentIcon, audiencia: 'organizacion', seccionPermiso: 'consultas', insignia: 'consultas_nuevas' },
      { id: 'empresas', etiqueta: 'Empresas', ruta: '/empresas', icono: StorefrontIcon, audiencia: 'administrador' },
    ],
  },
  {
    // F-REN-02: Rentabilidad vive en Análisis (sección `rentabilidad` de la matriz de permisos).
    id: 'analisis',
    etiqueta: 'Análisis',
    destinos: [
      { id: 'rentabilidad', etiqueta: 'Rentabilidad', ruta: '/rentabilidad', icono: InsightsIcon, audiencia: 'organizacion', seccionPermiso: 'rentabilidad' },
    ],
  },
  // Pantallas ocultas del menú por decisión de producto (2026-10-21):
  //   Ejecuciones (/ejecuciones), Analítica (/analitica y /analitica/administrar),
  //   Chat IA (/ia/chat), Documentos (/ia/documentos), Conexiones (/conexiones)
  //   y Conexiones OAuth (/conexiones-oauth).
  // Las rutas, páginas y permisos siguen existiendo en App.tsx; solo no se
  // ofrecen en el sider. Para volver a mostrarlas, restaurar sus destinos en
  // la sección que corresponda.
  {
    id: 'administracion',
    etiqueta: 'Administración',
    destinos: [
      { id: 'organizacion', etiqueta: 'Mi organización', ruta: '/organizacion', icono: DomainIcon, audiencia: 'administrador' },
      // F-PRE-02: carga diaria del dólar (sección `cotizacion_dolar` de la matriz de permisos).
      { id: 'cotizacion', etiqueta: 'Cotización del dólar', ruta: '/cotizacion', icono: AttachMoneyIcon, audiencia: 'organizacion', seccionPermiso: 'cotizacion_dolar' },
      // F-CFG-01: motivos de stock y estados de consulta; solo Administrador.
      { id: 'listas-configurables', etiqueta: 'Listas configurables', ruta: '/configuracion/listas', icono: SettingsIcon, audiencia: 'administrador' },
      { id: 'actividad', etiqueta: 'Actividad', ruta: '/actividad', icono: TimelineIcon, audiencia: 'organizacion', seccionPermiso: 'actividad' },
      { id: 'usuarios', etiqueta: 'Usuarios', ruta: '/usuarios', icono: GroupIcon, audiencia: 'administrador', seccionPermiso: 'usuarios_permisos' },
      { id: 'roles', etiqueta: 'Roles y permisos', ruta: '/roles', icono: AdminPanelSettingsIcon, audiencia: 'administrador', seccionPermiso: 'usuarios_permisos' },
      // Herramienta de uso único en el corte (F-MIG-01, FR-010): solo Administrador, sin sección de
      // la matriz porque no es una pantalla operativa del día a día.
      { id: 'migracion-datos', etiqueta: 'Migración de datos', ruta: '/migracion/importar/clientes', icono: FileUploadIcon, audiencia: 'administrador' },
    ],
  },
  {
    id: 'plataforma',
    etiqueta: 'Plataforma',
    destinos: [
      { id: 'organizaciones', etiqueta: 'Organizaciones', ruta: '/organizaciones', icono: BusinessCenterIcon, audiencia: 'superadmin' },
      { id: 'servidores', etiqueta: 'Servidores', ruta: '/servidores', icono: HubIcon, audiencia: 'superadmin' },
      { id: 'funcionalidades', etiqueta: 'Funcionalidades', ruta: '/features/administrar', icono: SettingsIcon, audiencia: 'superadmin' },
      { id: 'ia', etiqueta: 'IA gobernada', ruta: '/ia', icono: SmartToyIcon, audiencia: 'superadmin' },
      { id: 'integraciones-oauth', etiqueta: 'Integraciones OAuth', ruta: '/integraciones-oauth/administrar', icono: ExtensionIcon, audiencia: 'superadmin' },
    ],
  },
]

export const DESTINOS_PANEL: DestinoPanel[] = SECCIONES_PANEL.flatMap((seccion) => seccion.destinos)

// Para miembro/administrador siempre visible; para superadmin, solo con
// organización activa. 'administrador' reutiliza puede_escribir (contexto ya
// resuelve "administrador de su organización, o superadmin con organización
// activa"). Si el destino declara `seccionPermiso` y se pasan los permisos
// del usuario, además exige acceso a esa sección (secciones sin acceso no
// aparecen en el menú). Un superadmin sin organización activa no opera
// dentro de ninguna organización, así que la matriz no le aplica.
export function destinoVisible(
  destino: DestinoPanel,
  contexto: ContextoPanel,
  permisos?: readonly PermisoSeccion[] | null,
  funcionalidades?: ReadonlySet<string>,
): boolean {
  if (!audienciaVisible(destino.audiencia, contexto)) {
    return false
  }
  if (destino.feature && !funcionalidades?.has(destino.feature)) {
    return false
  }
  if (!destino.seccionPermiso || !permisos || (contexto.es_superadmin && !contexto.organizacion_id)) {
    return true
  }
  return nivelDe(permisos, destino.seccionPermiso) !== 'ninguno'
}

function audienciaVisible(audiencia: AudienciaDestino, contexto: ContextoPanel): boolean {
  switch (audiencia) {
    case 'autenticada':
      return true
    case 'organizacion':
      return contexto.es_superadmin ? Boolean(contexto.organizacion_id) : true
    case 'administrador':
      return contexto.puede_escribir
    case 'superadmin':
      return contexto.es_superadmin
  }
}
