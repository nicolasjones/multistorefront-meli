import { Checkbox, FormControlLabel, FormGroup, Tooltip } from '@mui/material'

export type RolOrganizacion = { id: string; descripcion: string }

type GrillaPermisosPorRolProps = {
  roles: RolOrganizacion[]
  rolesSeleccionados: string[]
  onChange: (rolesSeleccionados: string[]) => void
  disabled?: boolean
}

// Fila de checkboxes reutilizada por administrar.tsx (default global, US1)
// y permisos.tsx (por organización, US3) — el "grillado" de reportes ×
// roles que describe la spec es la composición de una de estas por cada
// reporte, no una única tabla gigante.
//
// administrador nunca aparece como checkbox: tiene acceso incondicional
// (FR-006), garantizado también por un check de esquema — se muestra
// siempre tildado y deshabilitado para que quede visualmente claro que no
// es una opción, no para ocultarlo.
export function GrillaPermisosPorRol({
  roles,
  rolesSeleccionados,
  onChange,
  disabled,
}: GrillaPermisosPorRolProps) {
  const rolesConfigurables = roles.filter((rol) => rol.id !== 'administrador')

  const toggle = (rolId: string) => {
    if (rolesSeleccionados.includes(rolId)) {
      onChange(rolesSeleccionados.filter((id) => id !== rolId))
    } else {
      onChange([...rolesSeleccionados, rolId])
    }
  }

  return (
    <FormGroup row>
      <FormControlLabel control={<Checkbox checked disabled />} label="Administrador" />
      {rolesConfigurables.map((rol) => (
        <Tooltip key={rol.id} title={rol.descripcion}>
          <FormControlLabel
            control={
              <Checkbox
                checked={rolesSeleccionados.includes(rol.id)}
                disabled={disabled}
                onChange={() => toggle(rol.id)}
              />
            }
            label={rol.id.charAt(0).toUpperCase() + rol.id.slice(1)}
          />
        </Tooltip>
      ))}
    </FormGroup>
  )
}
