import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined'
import { Alert, Box, Button, TextField } from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { enlaceProducto } from '../../../lib/enlaceProducto'

type Resultado = { tipo: 'copiado' } | { tipo: 'manual'; enlace: string } | null

// Botón «Compartir» de la ficha (F-TDA-25, FR-020…FR-024). Con selector del sistema (`navigator.share`)
// lo abre con el nombre y el enlace; cerrarlo sin elegir (`AbortError`) no avisa nada. Sin selector, o si
// falla por otra causa, copia el enlace con el aviso «Enlace copiado» (región `aria-live`); si tampoco se
// puede copiar, muestra el enlace seleccionado para copiarlo a mano.
export function BotonCompartir({ productoId, nombre }: { productoId: string; nombre: string }) {
  const [resultado, setResultado] = useState<Resultado>(null)
  const campo = useRef<HTMLInputElement | null>(null)

  // El enlace manual queda seleccionado apenas aparece.
  useEffect(() => {
    if (resultado?.tipo === 'manual') campo.current?.select()
  }, [resultado])

  async function compartir() {
    setResultado(null)
    const enlace = enlaceProducto(productoId)
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: nombre, url: enlace })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        // Cualquier otro fallo del selector cae en la copia.
      }
    }
    try {
      await navigator.clipboard.writeText(enlace)
      setResultado({ tipo: 'copiado' })
    } catch {
      setResultado({ tipo: 'manual', enlace })
    }
  }

  return (
    <Box data-testid="boton-compartir" sx={{ width: { xs: '100%', sm: 'auto' }, minWidth: 0 }}>
      <Button
        variant="outlined"
        onClick={() => void compartir()}
        startIcon={<ShareOutlinedIcon />}
        sx={{ minHeight: (tema) => tema.spacing(5.5), fontWeight: 700, width: { xs: '100%', sm: 'auto' } }}
      >
        Compartir
      </Button>
      {/* La región existe siempre para que el lector de pantalla anuncie el aviso al aparecer. */}
      <Box role="status" aria-live="polite">
        {resultado?.tipo === 'copiado' ? <Alert severity="success" sx={{ mt: 1 }}>Enlace copiado</Alert> : null}
      </Box>
      {resultado?.tipo === 'manual' ? (
        <TextField
          inputRef={campo}
          label="Copiá este enlace"
          value={resultado.enlace}
          size="small"
          fullWidth
          sx={{ mt: 1 }}
          slotProps={{ input: { readOnly: true } }}
          onFocus={(e) => e.target.select()}
        />
      ) : null}
    </Box>
  )
}
