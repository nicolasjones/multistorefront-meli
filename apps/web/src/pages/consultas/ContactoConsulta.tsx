import { useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { Box, Button, Link, Tooltip, Typography } from '@mui/material'
import { useFichaContacto } from '../../hooks/useContactos'
import { TEXTO_SIN_PERMISO_EDICION, repartirContacto } from '../../lib/contactos'
import type { Consulta } from '../../lib/consultas'
import { CrearContactoDialog } from './CrearContactoDialog'

type Props = {
  consulta: Consulta
  puedeEditar: boolean
  /** La consulta cambió (quedó vinculada): hay que releerla para tener su sello `updated_at` vigente. */
  onVinculada: () => void
}

// Contacto de la libreta en el detalle de la consulta (F-CON-05, FR-002, FR-007): si ya está vinculado,
// un enlace a su ficha; si no, `Crear contacto` con el nombre y el contacto de la consulta precargados.
export function ContactoConsulta({ consulta, puedeEditar, onVinculada }: Props) {
  const [abierto, setAbierto] = useState(false)
  const { ficha } = useFichaContacto(consulta.contacto_id ?? null)

  if (consulta.contacto_id) {
    return (
      <Box>
        <Typography variant="xs">Contacto en la libreta</Typography>
        <Typography sx={{ fontWeight: 600 }}>
          <Link component={RouterLink} to={`/contactos/${consulta.contacto_id}`}>
            {ficha?.nombre ?? 'Ver la ficha del contacto'}
          </Link>
        </Typography>
      </Box>
    )
  }

  return (
    <Box>
      <Tooltip title={puedeEditar ? '' : TEXTO_SIN_PERMISO_EDICION}>
        <span>
          <Button type="button" size="small" variant="outlined" onClick={() => setAbierto(true)} disabled={!puedeEditar}>
            Crear contacto
          </Button>
        </span>
      </Tooltip>
      {abierto ? (
        <CrearContactoDialog
          empresaId={consulta.empresa_id}
          empresaNombre={consulta.empresa_nombre}
          inicial={{ nombre: consulta.nombre, ...repartirContacto(consulta.contacto) }}
          consultaId={consulta.id}
          onCerrar={() => setAbierto(false)}
          onCreado={() => {
            setAbierto(false)
            onVinculada()
          }}
          onVinculado={() => {
            setAbierto(false)
            onVinculada()
          }}
        />
      ) : null}
    </Box>
  )
}
