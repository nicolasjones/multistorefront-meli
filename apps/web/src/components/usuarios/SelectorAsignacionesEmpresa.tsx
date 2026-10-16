import { Box, Checkbox, FormControlLabel, FormGroup, FormLabel, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { ETIQUETA_ROL } from '../../lib/permisos'
import {
  ROL_POR_DEFECTO_EMPRESA, ROLES_POR_EMPRESA, type EmpresaAsignable, type SeleccionEmpresas,
} from '../../lib/asignacionesEmpresas'

type Props = {
  empresas: EmpresaAsignable[]
  seleccion: SeleccionEmpresas
  onChange: (seleccion: SeleccionEmpresas) => void
  disabled?: boolean
  cargando?: boolean
}

// Empresas en las que trabaja la persona y su rol en cada una (F-ROL-07, FR-016).
export function SelectorAsignacionesEmpresa({ empresas, seleccion, onChange, disabled, cargando }: Props) {
  if (cargando) {
    return <Typography variant="body2" color="text.secondary" role="status">Cargando empresas…</Typography>
  }
  // Una empresa asignada que no vino en la lista (p. ej. inactiva) sigue visible para poder desmarcarla.
  const visibles = [
    ...empresas,
    ...Object.keys(seleccion).filter((id) => !empresas.some((e) => e.id === id)).map((id) => ({ id, nombre: 'Empresa no disponible' })),
  ]
  if (visibles.length === 0) {
    return <Typography variant="body2" color="text.secondary">Todavía no hay empresas para asignar.</Typography>
  }

  const alternar = (empresaId: string, marcada: boolean) => {
    const resto = { ...seleccion }
    delete resto[empresaId]
    onChange(marcada ? { ...resto, [empresaId]: ROL_POR_DEFECTO_EMPRESA } : resto)
  }

  return (
    <Box component="fieldset" sx={{ border: 0, p: 0, m: 0 }} disabled={disabled}>
      <FormLabel component="legend" sx={{ mb: 1 }}>Empresas y rol en cada una</FormLabel>
      <FormGroup>
        <Stack spacing={1}>
          {visibles.map((empresa) => {
            const rol = seleccion[empresa.id]
            return (
              <Stack key={empresa.id} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
                <FormControlLabel
                  sx={{ flex: 1, minWidth: 0 }}
                  control={<Checkbox checked={rol !== undefined} onChange={(event) => alternar(empresa.id, event.target.checked)} />}
                  label={empresa.nombre}
                />
                {rol !== undefined && (
                  <TextField
                    select
                    size="small"
                    label={`Rol en ${empresa.nombre}`}
                    value={rol}
                    onChange={(event) => onChange({ ...seleccion, [empresa.id]: event.target.value })}
                    sx={{ minWidth: 180 }}
                  >
                    {ROLES_POR_EMPRESA.map((id) => <MenuItem key={id} value={id}>{ETIQUETA_ROL[id] ?? id}</MenuItem>)}
                  </TextField>
                )}
              </Stack>
            )
          })}
        </Stack>
      </FormGroup>
    </Box>
  )
}
