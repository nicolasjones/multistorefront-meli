import { useState } from 'react'
import { useLocation, useMatch, useNavigate } from 'react-router'
import { Button, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material'
import BusinessIcon from '@mui/icons-material/Business'
import CheckIcon from '@mui/icons-material/Check'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { useContextoPanel } from '../../hooks/useContextoPanel'
import { useEmpresas } from '../../hooks/useEmpresas'
import { tokens } from '../../tema/tokens'

type Empresa = { id: string; nombre: string }

// Sección de empresa en la que se conserva el lugar al cambiar (FR-009). Hoy
// solo existe «General»; otras secciones se suman acá con su ruta.
const RUTA_EMPRESA = '/empresas/edit/:id'

// Selector de empresa del encabezado (DS-03 / F-EMP-05). En una pantalla de
// empresa lista todas las de la organización (RLS filtra), marca la de la
// ruta y al elegir otra navega a la misma sección con su id; el aviso de
// cambios sin guardar lo resuelve el UnsavedChangesNotifier al navegar.
// Fuera de esas pantallas no hay empresa «actual» y queda la etiqueta de la
// organización, sin opción de cambio. `empresas` permite inyectar el listado.
export function SelectorEmpresa({ empresas }: { empresas?: Empresa[] }) {
  const { contexto } = useContextoPanel()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const coincidencia = useMatch(RUTA_EMPRESA)
  const empresaIdRuta = coincidencia?.params.id ?? null
  const { empresas: deLaOrganizacion } = useEmpresas({ habilitado: empresaIdRuta !== null && empresas === undefined })

  const organizacion: Empresa | null = contexto?.organizacion_id && contexto.organizacion_nombre
    ? { id: contexto.organizacion_id, nombre: contexto.organizacion_nombre }
    : null
  const listado = empresas ?? (empresaIdRuta ? deLaOrganizacion : [])
  const deRuta = empresaIdRuta ? listado.find((empresa) => empresa.id === empresaIdRuta) ?? null : null
  const activa = deRuta ?? organizacion
  if (!activa) {
    return null
  }

  const sinCambio = !deRuta || listado.length <= 1
  const elegir = (destino: Empresa) => {
    setAnchorEl(null)
    if (destino.id === activa.id || !empresaIdRuta) return
    navigate({ pathname: pathname.replace(`/${encodeURIComponent(empresaIdRuta)}`, `/${encodeURIComponent(destino.id)}`), search })
  }
  const etiqueta = (
    <>
      <BusinessIcon aria-hidden="true" fontSize="small" />
      <Typography noWrap component="span" variant="body2" sx={{ fontWeight: 600, maxWidth: 220 }}>{activa.nombre}</Typography>
    </>
  )
  const estilo = { color: 'text.primary', borderColor: tokens.color.borde, gap: 1, textTransform: 'none' } as const

  if (sinCambio) {
    return (
      <Button variant="outlined" disableRipple aria-label={`Empresa activa: ${activa.nombre}`} sx={{ ...estilo, cursor: 'default', '&:hover': { borderColor: tokens.color.borde, bgcolor: 'transparent' } }}>
        {etiqueta}
      </Button>
    )
  }

  return (
    <>
      <Button
        variant="outlined"
        onClick={(event) => setAnchorEl(event.currentTarget)}
        aria-label={`Empresa activa: ${activa.nombre}`}
        aria-haspopup="true"
        aria-controls={anchorEl ? 'selector-empresa' : undefined}
        sx={estilo}
      >
        {etiqueta}
        <ExpandMoreIcon aria-hidden="true" fontSize="small" />
      </Button>
      <Menu id="selector-empresa" anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        {listado.map((empresa) => (
          <MenuItem key={empresa.id} selected={empresa.id === activa.id} onClick={() => elegir(empresa)}>
            <ListItemText>{empresa.nombre}</ListItemText>
            {empresa.id === activa.id && <ListItemIcon sx={{ minWidth: 0, ml: 2 }}><CheckIcon fontSize="small" color="primary" /></ListItemIcon>}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
