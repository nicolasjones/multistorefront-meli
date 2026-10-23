import type { ReactNode } from 'react'
import {
  Checkbox, FormControl, FormControlLabel, FormGroup, FormHelperText, FormLabel, LinearProgress, Typography,
} from '@mui/material'

export type EmpresaSeleccion = { id: string; nombre: string; activa?: boolean }

type Props = {
  empresas: ReadonlyArray<EmpresaSeleccion>
  seleccion: ReadonlyArray<string>
  onCambiar: (seleccion: string[]) => void
  etiqueta: string
  cargando?: boolean
  hayError?: boolean
  mensajeError?: string
  mensajeVacio?: string
  ayuda?: ReactNode
  error?: string
  deshabilitado?: boolean
}

// Selección múltiple de empresas/tiendas para formularios y diálogos. Usa casillas, como «Disponible
// en» de Cuentas de cobro: una empresa se marca o se desmarca, no se elige una sola. Las pantallas
// usan `FiltroEmpresa` para el filtro de una empresa a la vez.
export function SelectorEmpresas({
  empresas,
  seleccion,
  onCambiar,
  etiqueta,
  cargando = false,
  hayError = false,
  mensajeError = 'No pudimos cargar las empresas.',
  mensajeVacio = 'La organización todavía no tiene empresas cargadas.',
  ayuda,
  error,
  deshabilitado = false,
}: Props) {
  const alternar = (empresaId: string, marcada: boolean) => {
    const siguiente = new Set(seleccion)
    if (marcada) siguiente.add(empresaId)
    else siguiente.delete(empresaId)
    onCambiar(Array.from(siguiente))
  }

  return (
    <FormControl component="fieldset" error={hayError} disabled={deshabilitado} fullWidth>
      <FormLabel component="legend">{etiqueta}</FormLabel>
      {cargando ? (
        <LinearProgress aria-label="Cargando empresas" />
      ) : hayError ? (
        <FormHelperText>{mensajeError}</FormHelperText>
      ) : empresas.length === 0 ? (
        <Typography variant="body2" color="text.secondary">{mensajeVacio}</Typography>
      ) : (
        <FormGroup row>
          {empresas.map((empresa) => {
            const nombre = empresa.activa === false ? `${empresa.nombre} (inactiva)` : empresa.nombre
            return (
              <FormControlLabel
                key={empresa.id}
                label={nombre}
                control={
                  <Checkbox
                    checked={seleccion.includes(empresa.id)}
                    onChange={(evento) => alternar(empresa.id, evento.target.checked)}
                  />
                }
              />
            )
          })}
        </FormGroup>
      )}
      {ayuda ? <FormHelperText>{ayuda}</FormHelperText> : null}
      {error ? <FormHelperText error>{error}</FormHelperText> : null}
    </FormControl>
  )
}
