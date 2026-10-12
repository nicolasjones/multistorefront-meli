import { useState } from 'react'
import { Button, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material'
import BusinessIcon from '@mui/icons-material/Business'
import CheckIcon from '@mui/icons-material/Check'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { useContextoPanel } from '../../hooks/useContextoPanel'
import { tokens } from '../../tema/tokens'

type Empresa = { id: string; nombre: string }

// Selector de empresa del encabezado (DS-03). El modelo actual solo expone
// la empresa efectiva del contexto (miembro: la suya; superadmin: la que
// entró), así que el listado tiene un único elemento: con una sola empresa
// se muestra como etiqueta fija, sin opción de cambio. El cambio de empresa
// sigue siendo el de superadmin (OrganizacionActivaBanner), sin tocarlo.
export function SelectorEmpresa({ empresas }: { empresas?: Empresa[] }) {
  const { contexto } = useContextoPanel()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)

  const activa: Empresa | null = contexto?.organizacion_id && contexto.organizacion_nombre
    ? { id: contexto.organizacion_id, nombre: contexto.organizacion_nombre }
    : null
  if (!activa) {
    return null
  }

  const listado = empresas ?? [activa]
  const sinCambio = listado.length <= 1
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
          <MenuItem key={empresa.id} selected={empresa.id === activa.id} onClick={() => setAnchorEl(null)}>
            <ListItemText>{empresa.nombre}</ListItemText>
            {empresa.id === activa.id && <ListItemIcon sx={{ minWidth: 0, ml: 2 }}><CheckIcon fontSize="small" color="primary" /></ListItemIcon>}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
