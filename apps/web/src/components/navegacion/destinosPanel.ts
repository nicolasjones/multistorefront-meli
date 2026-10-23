import type { ComponentType } from 'react'
import type { SvgIconProps } from '@mui/material'
import HomeIcon from '@mui/icons-material/Home'
import BusinessCenterIcon from '@mui/icons-material/BusinessCenter'
import BarChartIcon from '@mui/icons-material/BarChart'
import HistoryIcon from '@mui/icons-material/History'
import TimelineIcon from '@mui/icons-material/Timeline'
import HubIcon from '@mui/icons-material/Hub'
import GroupIcon from '@mui/icons-material/Group'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import SettingsIcon from '@mui/icons-material/Settings'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import VpnKeyIcon from '@mui/icons-material/VpnKey'
import ExtensionIcon from '@mui/icons-material/Extension'
import DescriptionIcon from '@mui/icons-material/Description'
import StorefrontIcon from '@mui/icons-material/Storefront'
import DomainIcon from '@mui/icons-material/Domain'
import LocalShippingIcon from '@mui/icons-material/LocalShipping'
import Inventory2Icon from '@mui/icons-material/Inventory2'
import WarehouseIcon from '@mui/icons-material/Warehouse'
import BuildIcon from '@mui/icons-material/Build'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
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
    ],
  },
  {
    id: 'stock',
    etiqueta: 'Stock',
    destinos: [
      { id: 'stock', etiqueta: 'Stock', ruta: '/stock', icono: WarehouseIcon, audiencia: 'organizacion', seccionPermiso: 'stock' },
    ],
  },
  {
    // F-VTA-05 (FR-009): grupo propio. Hasta que MSF-177 traiga el listado, /ventas/comprobantes redirige al alta (App.tsx).
    id: 'ventas',
    etiqueta: 'Ventas',
    destinos: [
      { id: 'ventas', etiqueta: 'Ventas', ruta: '/ventas/comprobantes', icono: ReceiptLongIcon, audiencia: 'organizacion', seccionPermiso: 'ventas' },
    ],
  },
  {
    // F-SVC-01 (FR-009): grupo propio; entra a Reparaciones (F-SVC-02), la primera pestaña del prototipo.
    id: 'service',
    etiqueta: 'Service',
    destinos: [
      {
        id: 'service-tecnico',
        etiqueta: 'Service técnico',
        ruta: '/service-tecnico/reparaciones',
        icono: BuildIcon,
        audiencia: 'organizacion',
        seccionPermiso: 'service_tecnico',
        feature: 'service-tecnico',
      },
    ],
  },
  {
    id: 'operacion',
    etiqueta: 'Operación',
    destinos: [
      { id: 'clientes', etiqueta: 'Clientes', ruta: '/clientes', icono: BusinessCenterIcon, audiencia: 'organizacion', seccionPermiso: 'clientes' },
      { id: 'proveedores', etiqueta: 'Proveedores', ruta: '/proveedores', icono: LocalShippingIcon, audiencia: 'organizacion', seccionPermiso: 'proveedores' },
      { id: 'empresas', etiqueta: 'Empresas', ruta: '/empresas', icono: StorefrontIcon, audiencia: 'administrador' },
      { id: 'ejecuciones', etiqueta: 'Ejecuciones', ruta: '/ejecuciones', icono: HistoryIcon, audiencia: 'organizacion' },
      { id: 'actividad', etiqueta: 'Actividad', ruta: '/actividad', icono: TimelineIcon, audiencia: 'organizacion', seccionPermiso: 'actividad' },
      { id: 'analitica', etiqueta: 'Analítica', ruta: '/analitica', icono: BarChartIcon, audiencia: 'organizacion' },
      { id: 'chat-ia', etiqueta: 'Chat', ruta: '/ia/chat', icono: SmartToyIcon, audiencia: 'organizacion' },
      { id: 'documentos', etiqueta: 'Documentos', ruta: '/ia/documentos', icono: DescriptionIcon, audiencia: 'organizacion' },
    ],
  },
  {
    id: 'configuracion',
    etiqueta: 'Configuración',
    destinos: [
      { id: 'organizacion', etiqueta: 'Mi organización', ruta: '/organizacion', icono: DomainIcon, audiencia: 'administrador' },
      { id: 'conexiones', etiqueta: 'Conexiones', ruta: '/conexiones', icono: HubIcon, audiencia: 'administrador' },
      { id: 'conexiones-oauth', etiqueta: 'Conexiones OAuth', ruta: '/conexiones-oauth', icono: VpnKeyIcon, audiencia: 'administrador' },
      { id: 'usuarios', etiqueta: 'Usuarios', ruta: '/usuarios', icono: GroupIcon, audiencia: 'administrador', seccionPermiso: 'usuarios_permisos' },
      { id: 'roles', etiqueta: 'Roles y permisos', ruta: '/roles', icono: AdminPanelSettingsIcon, audiencia: 'administrador', seccionPermiso: 'usuarios_permisos' },
    ],
  },
  {
    id: 'plataforma',
    etiqueta: 'Plataforma',
    destinos: [
      { id: 'organizaciones', etiqueta: 'Organizaciones', ruta: '/organizaciones', icono: BusinessCenterIcon, audiencia: 'superadmin' },
      { id: 'servidores', etiqueta: 'Servidores', ruta: '/servidores', icono: HubIcon, audiencia: 'superadmin' },
      { id: 'funcionalidades', etiqueta: 'Funcionalidades', ruta: '/features/administrar', icono: SettingsIcon, audiencia: 'superadmin' },
      { id: 'analitica-administrar', etiqueta: 'Analítica (administrar)', ruta: '/analitica/administrar', icono: BarChartIcon, audiencia: 'superadmin' },
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
