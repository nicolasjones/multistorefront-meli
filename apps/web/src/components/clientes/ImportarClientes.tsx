import { Button } from '@mui/material'
import { Link as RouterLink } from 'react-router'

// Entrada al asistente de importación desde el listado de Clientes (FR-009,
// FR-010). El padre solo lo monta para quien puede migrar (Administrador);
// las RPC y RLS vuelven a exigirlo del lado de la base.
export function ImportarClientes() {
  return (
    <Button component={RouterLink} to="/migracion/importar/clientes" variant="outlined">
      Importar
    </Button>
  )
}
