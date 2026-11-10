import { Box, Button } from '@mui/material'
import { useState } from 'react'
import { Link as EnlaceRuta, useNavigate } from 'react-router'
import { useSesionCliente } from '../../../hooks/useSesionCliente'
import { salirCliente } from '../../../lib/tiendaCuenta'

// «Ingresar» / «Salir» del encabezado de la tienda (F-CLI-06, FR-020). Mientras no se sabe si hay sesión
// (carga inicial o falla de red) no se muestra ninguno de los dos: no afirma un estado que no verificó.
export function AccesoCliente({ host }: { host: string }) {
  const estado = useSesionCliente(host)
  const navigate = useNavigate()
  const [saliendo, setSaliendo] = useState(false)

  if (estado === 'desconocida') return null
  if (estado === 'sin_sesion') {
    return <Button component={EnlaceRuta} to="/ingresar" size="small" variant="outlined">Ingresar</Button>
  }
  return (
    <Box>
      <Button
        size="small"
        variant="outlined"
        disabled={saliendo}
        onClick={() => {
          setSaliendo(true)
          void salirCliente().finally(() => {
            setSaliendo(false)
            navigate('/')
          })
        }}
      >
        Salir
      </Button>
    </Box>
  )
}
