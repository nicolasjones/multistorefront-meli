import { useState } from 'react'
import { Box, Collapse, Divider, List, ListItemButton, ListItemIcon, ListItemText, Tooltip, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { ThemedSider } from '@refinedev/mui'
import { Link, useLocation } from 'react-router'
import { usePermisosPanel } from '../../context/PermisosPanel'
import { useContextoPanel } from '../../hooks/useContextoPanel'
import { tokens } from '../../tema/tokens'
import { destinoVisible, SECCIONES_PANEL, type DestinoPanel, type SeccionPanel } from './destinosPanel'

// Sección abierta por defecto (acordeón, pedido en vivo): Operación es la
// más usada, así que arranca desplegada; Configuración y Plataforma
// arrancan colapsadas hasta que el usuario las abra.
const SECCION_ABIERTA_POR_DEFECTO = 'operacion'

const { sider } = tokens.color

// Sider declarativo (T014, contracts/navegacion-panel.md): a diferencia del
// filtrado plano anterior (SiderConSeccionesSuperadmin), este no arranca de
// los ítems que arma Refine desde `resources` — construye la lista entera
// desde SECCIONES_PANEL y el contexto efectivo, así cada audiencia ve solo
// sus secciones sin depender de qué recursos declaró Refine.
// ThemedSider sigue aportando el shell colapsable/responsive (drawer en
// mobile, botón de colapso); acá solo se reemplaza su contenido. El fondo
// oscuro (.sider) sale del tema (MuiDrawer, anclas izquierdas).
function ItemDestino({ destino, collapsed, activo }: { destino: DestinoPanel; collapsed: boolean; activo: boolean }) {
  const Icono = destino.icono
  const contenido = (
    <ListItemButton
      component={Link}
      to={destino.ruta}
      selected={activo}
      aria-label={destino.etiqueta}
      sx={{
        borderRadius: `${tokens.forma.radioBotonChico}px`,
        mx: 1,
        justifyContent: collapsed ? 'center' : 'flex-start',
        color: sider.itemTexto,
        '& .MuiListItemIcon-root': { color: sider.itemTexto },
        '&:hover': { bgcolor: sider.itemHover },
        '&.Mui-selected, &.Mui-selected:hover': { bgcolor: sider.itemFondoActivo, color: sider.itemTextoActivo },
        '&.Mui-selected .MuiListItemIcon-root': { color: sider.itemTextoActivo },
      }}
    >
      <ListItemIcon sx={{ minWidth: collapsed ? 0 : 40, justifyContent: 'center' }}>
        <Icono aria-hidden="true" fontSize="small" />
      </ListItemIcon>
      {!collapsed && <ListItemText primary={destino.etiqueta} />}
    </ListItemButton>
  )
  return collapsed ? <Tooltip title={destino.etiqueta} placement="right">{contenido}</Tooltip> : contenido
}

function SeccionDeMenu({
  seccion,
  collapsed,
  rutaActual,
  abierta,
  alternar,
}: {
  seccion: SeccionPanel
  collapsed: boolean
  rutaActual: string
  abierta: boolean
  alternar: () => void
}) {
  // Acordeón (pedido en vivo): solo aplica con el sider expandido y una
  // etiqueta de sección real — Inicio (sin etiqueta) y el modo icono-solo
  // del sider (collapsed) siempre muestran sus ítems, sin encabezado
  // clickeable que no tendría dónde mostrar texto.
  const contenidoVisible = !seccion.etiqueta || collapsed || abierta

  return (
    <Box component="nav" aria-label={seccion.etiqueta ?? 'Inicio'} sx={{ pt: seccion.etiqueta ? 1.5 : 0.5 }}>
      {seccion.etiqueta && (
        <>
          {!collapsed && (
            <ListItemButton
              onClick={alternar}
              aria-expanded={abierta}
              sx={{ borderRadius: `${tokens.forma.radioBotonChico}px`, mx: 1, minHeight: 0, py: 0.5 }}
            >
              <Typography
                variant="overline"
                sx={{ flexGrow: 1, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', lineHeight: 1.5, color: sider.label }}
              >
                {seccion.etiqueta}
              </Typography>
              <ExpandMoreIcon
                aria-hidden="true"
                fontSize="small"
                sx={{ color: sider.label, transform: abierta ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}
              />
            </ListItemButton>
          )}
          <Divider sx={{ mx: 1, mb: 0.5, borderColor: sider.pieBorde }} />
        </>
      )}
      <Collapse in={contenidoVisible} unmountOnExit>
        <List disablePadding>
          {seccion.destinos.map((destino) => (
            <ItemDestino key={destino.id} destino={destino} collapsed={collapsed} activo={rutaActual === destino.ruta} />
          ))}
        </List>
      </Collapse>
    </Box>
  )
}

export function SiderPanel() {
  const { contexto, isLoading: cargandoContexto } = useContextoPanel()
  const permisosPanel = usePermisosPanel()
  const isLoading = cargandoContexto || Boolean(permisosPanel?.isLoading)
  const location = useLocation()
  // Acordeón: una sola sección con etiqueta abierta a la vez (id o null);
  // Inicio no participa porque no tiene etiqueta ni encabezado clickeable.
  const [seccionAbierta, setSeccionAbierta] = useState<string | null>(SECCION_ABIERTA_POR_DEFECTO)

  return (
    <ThemedSider
      render={({ collapsed }) => {
        if (isLoading || !contexto) {
          return null
        }

        return (
          <Box sx={{ bgcolor: sider.fondo, minHeight: '100%', py: 0.5 }}>
            {SECCIONES_PANEL.map((seccion) => {
              const destinosVisibles = seccion.destinos.filter((destino) => destinoVisible(destino, contexto, permisosPanel?.permisos))
              if (destinosVisibles.length === 0) {
                return null
              }
              return (
                <SeccionDeMenu
                  key={seccion.id}
                  seccion={{ ...seccion, destinos: destinosVisibles }}
                  collapsed={collapsed}
                  rutaActual={location.pathname}
                  abierta={seccionAbierta === seccion.id}
                  alternar={() => setSeccionAbierta((actual) => (actual === seccion.id ? null : seccion.id))}
                />
              )
            })}
          </Box>
        )
      }}
    />
  )
}
