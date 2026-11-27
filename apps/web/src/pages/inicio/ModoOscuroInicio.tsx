import { useState, type ReactNode } from 'react'
import { Box, FormControlLabel, Switch, ThemeProvider } from '@mui/material'
import { temaPanelOscuro } from '../../tema/temaPanel'
import { tokens } from '../../tema/tokens'

// Modo oscuro del tablero de Inicio (RF-INI-04-7, MSF-849). El tema oscuro (`temaPanelOscuro`) se aplica solo al contenido de
// Inicio: el resto del panel todavía lee tokens claros directo. La elección se recuerda en este navegador; sin
// almacenamiento (ventana privada, bloqueado) arranca en claro y funciona igual.
export const CLAVE_MODO_INICIO = 'msf-inicio-modo-oscuro'

function leerModo(): boolean {
  try {
    return window.localStorage.getItem(CLAVE_MODO_INICIO) === '1'
  } catch {
    return false
  }
}

function guardarModo(oscuro: boolean): void {
  try {
    window.localStorage.setItem(CLAVE_MODO_INICIO, oscuro ? '1' : '0')
  } catch {
    // Sin almacenamiento: el modo vale solo para esta sesión de la pantalla.
  }
}

export function ModoOscuroInicio({ children }: { children: ReactNode }) {
  const [oscuro, setOscuro] = useState(leerModo)
  const cambiar = (valor: boolean) => {
    setOscuro(valor)
    guardarModo(valor)
  }

  return (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
        <FormControlLabel
          control={<Switch checked={oscuro} onChange={(evento) => cambiar(evento.target.checked)} />}
          label="Modo oscuro"
          sx={{ m: 0 }}
        />
      </Box>
      {oscuro ? (
        <ThemeProvider theme={temaPanelOscuro}>
          <Box
            data-modo="oscuro"
            sx={{ bgcolor: 'background.default', color: 'text.primary', p: { xs: 1.5, md: 2 }, borderRadius: `${tokens.forma.radioTarjeta}px` }}
          >
            {children}
          </Box>
        </ThemeProvider>
      ) : (
        children
      )}
    </>
  )
}
