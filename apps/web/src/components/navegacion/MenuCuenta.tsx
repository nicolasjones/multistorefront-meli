import { useEffect, useState } from 'react'
import { useGetIdentity, useLogout } from '@refinedev/core'
import { Link as RouterLink } from 'react-router'
import { Avatar, Divider, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Stack, Typography } from '@mui/material'
import AccountCircleIcon from '@mui/icons-material/AccountCircle'
import LockResetIcon from '@mui/icons-material/LockReset'
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail'
import LogoutIcon from '@mui/icons-material/Logout'
import { supabaseClient } from '../../lib/supabase'

type Identity = { id: string; email?: string }
type PerfilIdentidad = { nombre: string | null; apellido: string | null }

// Menú compacto de cuenta (contracts/navegacion-panel.md, sección Cuenta):
// une Perfil, Cambiar contraseña y Salir en un solo control, en vez del
// logout suelto del Sider por defecto y el link aislado que vivía en Home.
// Vive en EncabezadoPanel (esquina superior derecha), no en el sider — sin
// noción de "collapsed" propia del rail colapsable.
export function MenuCuenta() {
  const { data: identity } = useGetIdentity<Identity>()
  const { mutate: cerrarSesion } = useLogout()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [nombreCompleto, setNombreCompleto] = useState<string | null>(null)

  useEffect(() => {
    let activa = true
    if (!identity?.id) {
      setFotoUrl(null)
      setNombreCompleto(null)
      return () => { activa = false }
    }
    // Misma organización solo puede leer su propia fila; RLS impide perfiles ajenos.
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
    supabaseClient.storage.from('fotos-perfil').createSignedUrl(`${identity.id}/avatar`, 60)
      .then(({ data }) => { if (activa) setFotoUrl(data?.signedUrl ?? null) })
      .catch(() => { if (activa) setFotoUrl(null) })
    return () => { activa = false }
  }, [identity?.id])

  if (!identity?.email) {
    return null
  }

  const nombreMostrado = nombreCompleto ?? identity.email
  const abierto = Boolean(anchorEl)
  const cerrar = () => setAnchorEl(null)

  return (
    <>
      <IconButton
        onClick={(event) => setAnchorEl(event.currentTarget)}
        aria-label={`Cuenta de ${nombreMostrado}`}
        aria-controls={abierto ? 'menu-cuenta' : undefined}
        aria-haspopup="true"
        sx={{
          borderRadius: 5,
          pl: 1.5,
          pr: 0.5,
          py: 0.5,
          // Fondo propio: sin esto el botón se pierde contra el color del
          // header (reportado en vivo) — mismo patrón que usan los botones
          // de acción sobre un AppBar de color sólido. 0.12 fue insuficiente
          // (reportado en vivo de nuevo); blanco sólido + borde da el
          // contraste más notorio que un overlay semitransparente.
          bgcolor: 'common.white',
          border: '1px solid',
          borderColor: 'rgba(255, 255, 255, 0.6)',
          '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.85)' },
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <Typography noWrap variant="body2" color="text.primary">{nombreMostrado}</Typography>
          <Avatar src={fotoUrl ?? undefined} alt="" sx={{ width: 32, height: 32, bgcolor: 'primary.main' }}>{nombreMostrado.charAt(0).toUpperCase()}</Avatar>
        </Stack>
      </IconButton>
      <Menu id="menu-cuenta" anchorEl={anchorEl} open={abierto} onClose={cerrar}>
        <MenuItem component={RouterLink} to="/cuenta/perfil" onClick={cerrar}>
          <ListItemIcon><AccountCircleIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Perfil</ListItemText>
        </MenuItem>
        <MenuItem component={RouterLink} to="/cuenta/cambiar-contrasena" onClick={cerrar}>
          <ListItemIcon><LockResetIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Cambiar contraseña</ListItemText>
        </MenuItem>
        <MenuItem component={RouterLink} to="/cuenta/cambiar-correo" onClick={cerrar}>
          <ListItemIcon><AlternateEmailIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Cambiar correo electrónico</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => { cerrar(); cerrarSesion() }}>
          <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Salir</ListItemText>
        </MenuItem>
      </Menu>
    </>
  )
}
