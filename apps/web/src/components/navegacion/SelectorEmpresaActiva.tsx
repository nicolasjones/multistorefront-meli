import { useRef, useState } from 'react'
import { useWarnAboutChange } from '@refinedev/core'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText,
  ListItemIcon, ListItemText, Menu, MenuItem, Typography,
} from '@mui/material'
import StorefrontIcon from '@mui/icons-material/Storefront'
import CheckIcon from '@mui/icons-material/Check'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { useEmpresaActiva } from '../../hooks/useEmpresaActiva'
import { TituloDialogo } from '../base/TituloDialogo'
import { ETIQUETA_ROL } from '../../lib/permisos'
import { tokens } from '../../tema/tokens'

// Selector de la empresa activa persistida (F-ROL-06). Distinto del
// SelectorEmpresa de F-EMP-05, que navega entre pantallas de empresa por ruta
// y no cambia la activa (FR-013). Ofrece «Todas mis empresas» (vista combinada,
// sin activa) además de las empresas accesibles, con una sola empresa es una
// etiqueta fija. Si hay cambios sin guardar en la pantalla, pide confirmación (FR-011).
const TODAS = 'Todas mis empresas'

export function SelectorEmpresaActiva() {
  const { empresas, esTodas, isLoading, isError, cambiando, errorCambio, cambiar, cambiarATodas, limpiarError, refetch } = useEmpresaActiva()
  const { warnWhen } = useWarnAboutChange()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const botonRef = useRef<HTMLButtonElement>(null)
  // `id` null = «Todas mis empresas»; un uuid = esa empresa.
  const [pendiente, setPendiente] = useState<{ id: string | null; nombre: string } | null>(null)

  const activa = empresas.find((empresa) => empresa.esActiva) ?? null
  const nombreActiva = esTodas ? TODAS : activa?.nombre ?? 'Elegir empresa'
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
      <Typography noWrap component="span" variant="body2" sx={{ fontWeight: 600 }}>{nombreActiva}</Typography>
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

  const ejecutar = async (id: string | null) => {
    setPendiente(null)
    await (id === null ? cambiarATodas() : cambiar(id))
  }
  const elegir = (destino: { id: string | null; nombre: string; esActiva: boolean }) => {
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
        // aria-disabled (no disabled) para que el botón conserve el foco que le devuelve el Dialog al cerrar.
        aria-disabled={cambiando || undefined}
        onClick={(event) => {
          if (cambiando) return
          limpiarError()
          setAnchorEl(event.currentTarget)
        }}
        aria-label={`Empresa activa: ${nombreActiva}`}
        aria-haspopup="true"
        aria-controls={anchorEl ? 'selector-empresa-activa' : undefined}
        aria-expanded={Boolean(anchorEl)}
        sx={estilo}
      >
        {etiqueta}
        {cambiando ? <CircularProgress size={16} aria-hidden="true" /> : <ExpandMoreIcon aria-hidden="true" fontSize="small" />}
      </Button>
      <Menu id="selector-empresa-activa" anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)} MenuListProps={{ 'aria-label': 'Empresas' }}>
        <MenuItem
          selected={esTodas}
          aria-current={esTodas ? 'true' : undefined}
          onClick={() => elegir({ id: null, nombre: TODAS, esActiva: esTodas })}
        >
          <ListItemText secondary="Varios · vista combinada según cada empresa">{TODAS}</ListItemText>
          {esTodas && <ListItemIcon sx={{ minWidth: 0, ml: 2 }}><CheckIcon fontSize="small" color="primary" aria-hidden="true" /></ListItemIcon>}
        </MenuItem>
        {empresas.map((empresa) => (
          <MenuItem key={empresa.id} selected={empresa.esActiva} aria-current={empresa.esActiva ? 'true' : undefined} onClick={() => elegir(empresa)}>
            <ListItemText secondary={empresa.rolId ? ETIQUETA_ROL[empresa.rolId] ?? empresa.rolId : undefined}>{empresa.nombre}</ListItemText>
            {empresa.esActiva && <ListItemIcon sx={{ minWidth: 0, ml: 2 }}><CheckIcon fontSize="small" color="primary" aria-hidden="true" /></ListItemIcon>}
          </MenuItem>
        ))}
      </Menu>
      <span role="status" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{cambiando ? 'Cambiando de empresa…' : ''}</span>
      {errorCambio && <Alert severity="error" role="alert" onClose={limpiarError} sx={{ py: 0 }}>{errorCambio}</Alert>}
      <Dialog open={pendiente !== null} onClose={() => setPendiente(null)} aria-labelledby="cambiar-empresa-titulo" slotProps={{ transition: { onExited: () => botonRef.current?.focus() } }}>
        <TituloDialogo id="cambiar-empresa-titulo" onCerrar={() => setPendiente(null)}>¿Cambiar de empresa?</TituloDialogo>
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
