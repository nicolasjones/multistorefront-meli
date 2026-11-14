import { Box, Button } from '@mui/material'
import { useState } from 'react'
import { Link as EnlaceRuta, useNavigate } from 'react-router'
import { useCapacidadesTienda } from '../../../hooks/useCapacidadesTienda'
import { useSesionCliente } from '../../../hooks/useSesionCliente'
import { salirCliente } from '../../../lib/tiendaCuenta'
import { useCelular } from '../useAnchoCelular'

// «Ingresar» / «Mi cuenta» / «Salir» del encabezado de la tienda (F-CLI-06, FR-020; F-CLI-20, FR-001, P-1). Mientras no
// se sabe si hay sesión (carga inicial o falla de red) no se muestra ninguno: no afirma un estado que no verificó.
// «Mi cuenta» solo con cuenta ACTIVA y la función encendida (`publico.capacidades_tienda_por_dominio`); mientras se
// resuelve la función no se dibuja ni ocupa lugar. En celular y tableta (bajo `md`) el «Salir» pasa al menú ☰ y a la
// página «Mi cuenta» cuando la función está encendida; con la función apagada queda como siempre.
export function AccesoCliente({ host }: { host: string }) {
  const estado = useSesionCliente(host)
  const capacidades = useCapacidadesTienda(host)
  const celular = useCelular()
  const navigate = useNavigate()
  const [saliendo, setSaliendo] = useState(false)

  if (estado === 'desconocida') return null
  if (estado === 'sin_sesion') {
    return <Button component={EnlaceRuta} to="/ingresar" size="small" variant="outlined">Ingresar</Button>
  }
  const conCuenta = capacidades.fase === 'lista' && capacidades.pedidos
  // En celular, mientras se resuelve la función, «Salir» espera: si no, aparecería y desaparecería al saberse.
  const mostrarSalir = !celular || (capacidades.fase !== 'cargando' && !conCuenta)
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {conCuenta ? <Button component={EnlaceRuta} to="/mi-cuenta" size="small" variant="outlined">Mi cuenta</Button> : null}
      {mostrarSalir ? (
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
      ) : null}
    </Box>
  )
}
