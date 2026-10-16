import { useRef, useState } from 'react'
import { useWarnAboutChange } from '@refinedev/core'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  ListItemIcon, ListItemText, Menu, MenuItem, Typography,
} from '@mui/material'
import StorefrontIcon from '@mui/icons-material/Storefront'
import CheckIcon from '@mui/icons-material/Check'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { useEmpresaActiva } from '../../hooks/useEmpresaActiva'
import { ETIQUETA_ROL } from '../../lib/permisos'
import { tokens } from '../../tema/tokens'

// Selector de la empresa activa persistida (F-ROL-06). Distinto del
// SelectorEmpresa de F-EMP-05, que navega entre pantallas de empresa por ruta
// y no cambia la activa (FR-013). Con una sola empresa es una etiqueta fija.
// Si hay cambios sin guardar en la pantalla, pide confirmación (FR-011).
export function SelectorEmpresaActiva() {
  const { empresas, isLoading, isError, cambiando, errorCambio, cambiar, limpiarError, refetch } = useEmpresaActiva()
  const { warnWhen } = useWarnAboutChange()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const botonRef = useRef<HTMLButtonElement>(null)
  const [pendiente, setPendiente] = useState<{ id: string; nombre: string } | null>(null)

  const activa = empresas.find((empresa) => empresa.esActiva) ?? null
  const estilo = { color: 'text.primary', borderColor: tokens.color.borde, gap: 1, textTransform: 'none', maxWidth: { xs: 180, sm: 280 } } as const

  if (isLoading && empresas.length === 0) {
    return (
      <Button variant="outlined" disabled aria-label="Cargando empresas" sx={estilo}>
        <CircularProgress size={16} aria-hidden="true" />
      </Button>
    )
  }
  if (isError) {
    return (
      <Button variant="outlined" color="error" onClick={() => void refetch()} aria-label="No pudimos cargar tus empresas. Reintentar" sx={estilo}>
        <Typography noWrap component="span" variant="body2">Reintentar empresas</Typography>
      </Button>
    )
  }
  if (empresas.length === 0) {
    return null
  }

  const etiqueta = (
    <>
      <StorefrontIcon aria-hidden="true" fontSize="small" />
      <Typography noWrap component="span" variant="body2" sx={{ fontWeight: 600 }}>{activa?.nombre ?? 'Elegir empresa'}</Typography>
    </>
  )

  if (empresas.length === 1 && activa) {
    return (
      <Box
        component="span"
        role="group"
        aria-label={`Empresa activa: ${activa.nombre}`}
        sx={{ ...estilo, display: 'inline-flex', alignItems: 'center', border: 1, borderRadius: 1, px: 1.5, py: 0.75 }}
      >
        {etiqueta}
      </Box>
    )
  }

  const ejecutar = async (id: string) => {
    setPendiente(null)
    await cambiar(id)
  }
  const elegir = (destino: { id: string; nombre: string; esActiva: boolean }) => {
    setAnchorEl(null)
    if (destino.esActiva) return
    if (warnWhen) {
      setPendiente({ id: destino.id, nombre: destino.nombre })
      return
    }
    void ejecutar(destino.id)
  }

  return (
    <>
      <Button
        ref={botonRef}
        variant="outlined"
        disabled={cambiando}
        onClick={(event) => {
          limpiarError()
          setAnchorEl(event.currentTarget)
        }}
        aria-label={activa ? `Empresa activa: ${activa.nombre}` : 'Elegir empresa activa'}
        aria-haspopup="true"
        aria-controls={anchorEl ? 'selector-empresa-activa' : undefined}
        aria-expanded={Boolean(anchorEl)}
        sx={estilo}
      >
        {etiqueta}
        {cambiando ? <CircularProgress size={16} aria-hidden="true" /> : <ExpandMoreIcon aria-hidden="true" fontSize="small" />}
      </Button>
      <Menu id="selector-empresa-activa" anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)} MenuListProps={{ 'aria-label': 'Empresas' }}>
        {empresas.map((empresa) => (
          <MenuItem key={empresa.id} selected={empresa.esActiva} aria-current={empresa.esActiva ? 'true' : undefined} onClick={() => elegir(empresa)}>
            <ListItemText secondary={empresa.rolId ? ETIQUETA_ROL[empresa.rolId] ?? empresa.rolId : undefined}>{empresa.nombre}</ListItemText>
            {empresa.esActiva && <ListItemIcon sx={{ minWidth: 0, ml: 2 }}><CheckIcon fontSize="small" color="primary" aria-hidden="true" /></ListItemIcon>}
          </MenuItem>
        ))}
      </Menu>
      <span role="status" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{cambiando ? 'Cambiando de empresa…' : ''}</span>
      {errorCambio && <Alert severity="error" role="alert" onClose={limpiarError} sx={{ py: 0 }}>{errorCambio}</Alert>}
      <Dialog open={pendiente !== null} onClose={() => setPendiente(null)} aria-labelledby="cambiar-empresa-titulo" TransitionProps={{ onExited: () => botonRef.current?.focus() }}>
        <DialogTitle id="cambiar-empresa-titulo">¿Cambiar de empresa?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Tenés cambios sin guardar en esta pantalla. Si pasás a {pendiente?.nombre}, podés perderlos.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendiente(null)} autoFocus>Seguir acá</Button>
          <Button color="warning" disabled={cambiando} onClick={() => pendiente && void ejecutar(pendiente.id)}>Cambiar igual</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
