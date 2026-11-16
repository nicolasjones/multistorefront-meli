import { useId, useState } from 'react'
import { Box, Button, Drawer, IconButton, Link, Stack, Typography } from '@mui/material'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { useLocation } from 'react-router'
import { urlManual } from '../../ayuda/manual'
import { MANUAL_POR_DESTINO } from '../../ayuda/manualPorDestino'
import { resolverAyuda, TEXTO_SIN_AYUDA } from '../../ayuda/resolverAyuda'
import { SOLO_LECTORES } from '../base/solo-lectores'

// F-CFG-02 (MSF-385): botón «Ayuda» de la barra superior y panel lateral con la explicación breve de la pantalla actual.
// La ayuda es contenido estático del repo: abrirla no consulta datos ni depende de la empresa activa (FR-027).
export function PanelAyuda() {
  const [abierta, setAbierta] = useState(false)
  const idTitulo = useId()
  const { pathname } = useLocation()
  const { contenido, destinoId } = resolverAyuda(pathname)
  // La dirección del manual se define en un solo lugar (`ayuda/manual.ts`); acá solo se elige la página de esta pantalla.
  const paginaManual = destinoId ? MANUAL_POR_DESTINO[destinoId] : undefined
  const hrefManual = urlManual(paginaManual)

  return (
    <>
      <IconButton aria-label="Ayuda" aria-haspopup="dialog" aria-expanded={abierta} onClick={() => setAbierta(true)} size="large">
        <HelpOutlineIcon />
      </IconButton>
      <Drawer
        anchor="right"
        open={abierta}
        onClose={() => setAbierta(false)}
        slotProps={{ paper: { role: 'dialog', 'aria-modal': true, 'aria-labelledby': idTitulo, sx: { width: 'min(420px, 100vw)' } } }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1 }}>
          <Typography component="h2" variant="h6" id={idTitulo}>
            {contenido ? contenido.titulo : 'Ayuda'}
          </Typography>
          <Button size="small" onClick={() => setAbierta(false)}>Cerrar</Button>
        </Stack>
        <Box sx={{ px: 2, pb: 2, overflowY: 'auto' }}>
          {contenido ? (
            <>
              <Typography variant="body1" sx={{ mb: 2 }}>{contenido.resumen}</Typography>
              {contenido.pasos && contenido.pasos.length > 0 ? (
                <Box component="ol" sx={{ m: 0, pl: 3 }}>
                  {contenido.pasos.map((paso) => (
                    <Typography component="li" variant="body2" key={paso} sx={{ mb: 1 }}>{paso}</Typography>
                  ))}
                </Box>
              ) : null}
            </>
          ) : (
            <Typography variant="body1">{TEXTO_SIN_AYUDA}</Typography>
          )}
          <Link
            href={hrefManual}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mt: 2 }}
          >
            {paginaManual ? 'Ver el manual completo de esta pantalla' : 'Abrir el manual'}
            <OpenInNewIcon fontSize="inherit" aria-hidden />
            <Box component="span" sx={SOLO_LECTORES}>
              (se abre en una pestaña nueva)
            </Box>
          </Link>
        </Box>
      </Drawer>
    </>
  )
}
