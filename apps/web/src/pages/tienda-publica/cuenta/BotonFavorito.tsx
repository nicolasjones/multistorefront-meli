import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder'
import FavoriteIcon from '@mui/icons-material/Favorite'
import { Box, Button, Typography } from '@mui/material'
import { useState } from 'react'
import { Link as EnlaceRuta, useLocation } from 'react-router'
import { useCelular } from '../useAnchoCelular'
import { useCapacidadesTienda } from '../../../hooks/useCapacidadesTienda'
import { useFavoritosEntre } from '../../../hooks/useFavoritosEntre'
import { useSesionClienteDetallada } from '../../../hooks/useSesionCliente'
import { cambiarFavorito, esSinAcceso } from '../../../lib/tiendaCuentaDatos'
import { enlaceIngresarConVolver } from '../../../lib/tiendaVolver'
import { AvisoTienda } from './AvisoTienda'
import { crearAviso, type AvisoCuenta } from './aviso'

export const TEXTO_FAVORITO_MAXIMO = 'Llegaste al máximo de favoritos'
export const TEXTO_FAVORITO_ERROR = 'No pudimos guardar el favorito. Probá de nuevo.'
export const TEXTO_CUENTA_INACTIVA = 'Tu cuenta no está activa en esta tienda'

// «Guardar en favoritos» / «Quitar de favoritos» de la ficha (F-CLI-20, FR-007, P-2). Solo existe con la función encendida
// (`publico.capacidades_tienda_por_dominio`): mientras se resuelve la función o la sesión no se dibuja nada ni ocupa lugar.
// Con sesión de cuenta activa alterna el favorito (idempotente) y su estado sale de UNA llamada (`favoritos_entre_por_dominio`);
// sin sesión es un enlace a «Ingresar» que vuelve a esta misma ficha.
export function BotonFavorito({ host, productoId, nombre }: { host: string; productoId: string; nombre: string }) {
  const capacidades = useCapacidadesTienda(host)
  const encendida = capacidades.fase === 'lista' && capacidades.pedidos
  // Con la función apagada ni siquiera se consulta la sesión: la ficha no hace llamadas de más.
  const { estado: sesion, version: versionSesion } = useSesionClienteDetallada(host, encendida)
  const ubicacion = useLocation()
  // P-2: a ancho completo hasta `md` (celular y tableta); desde escritorio, a la izquierda y del tamaño del texto.
  const anchoCompleto = useCelular()
  const favoritos = useFavoritosEntre(host, [productoId], encendida && sesion === 'activa', versionSesion)
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<AvisoCuenta | null>(null)
  const [cuentaInactiva, setCuentaInactiva] = useState(false)

  if (!encendida || sesion === 'desconocida') return null
  const publicar = (mensaje: string, error = false) => setAviso(crearAviso(mensaje, error))

  if (sesion === 'sin_sesion') {
    return (
      <Box sx={{ mt: '12px', display: 'flex', flexDirection: 'column', alignItems: anchoCompleto ? 'stretch' : 'flex-start' }}>
        <Button
          component={EnlaceRuta}
          to={enlaceIngresarConVolver(`${ubicacion.pathname}${ubicacion.search}`)}
          variant="text"
          fullWidth={anchoCompleto}
          startIcon={<FavoriteBorderIcon />}
          sx={{ minHeight: (tema) => tema.spacing(5.5) }}
        >
          Guardar en favoritos
        </Button>
        <Typography color="text.secondary" sx={{ fontSize: 13 /* estilos-sueltos: ok */ }}>Ingresá para guardar tus favoritos</Typography>
      </Box>
    )
  }

  const esFavorito = favoritos.esFavorito(productoId)
  const inactiva = cuentaInactiva || favoritos.fase === 'sin_acceso'
  const alternar = async () => {
    if (guardando) return
    setGuardando(true)
    const quedara = !esFavorito
    try {
      const resultado = await cambiarFavorito(host, productoId, quedara)
      if (resultado.estado === 'ok') {
        favoritos.marcar(productoId, resultado.favorito)
        publicar(resultado.favorito ? `Guardamos «${nombre}» en tus favoritos` : `Quitamos «${nombre}» de tus favoritos`)
      } else if (resultado.estado === 'limite_favoritos') {
        publicar(TEXTO_FAVORITO_MAXIMO, true)
      } else {
        publicar(TEXTO_FAVORITO_ERROR, true)
      }
    } catch (error) {
      if (esSinAcceso(error)) {
        setCuentaInactiva(true)
        publicar(TEXTO_CUENTA_INACTIVA, true)
      } else {
        publicar(TEXTO_FAVORITO_ERROR, true)
      }
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Box sx={{ mt: '12px', display: 'flex', flexDirection: 'column', alignItems: anchoCompleto ? 'stretch' : 'flex-start' }}>
      <Button
        variant="text"
        fullWidth={anchoCompleto}
        aria-pressed={esFavorito}
        disabled={inactiva || favoritos.fase === 'cargando'}
        aria-busy={guardando || undefined}
        onClick={() => { void alternar() }}
        startIcon={esFavorito ? <FavoriteIcon /> : <FavoriteBorderIcon />}
        sx={{ minHeight: (tema) => tema.spacing(5.5) }}
      >
        {esFavorito ? 'Quitar de favoritos' : 'Guardar en favoritos'}
      </Button>
      {inactiva ? <Typography color="text.secondary" sx={{ fontSize: 13 /* estilos-sueltos: ok */ }}>{TEXTO_CUENTA_INACTIVA}</Typography> : null}
      <AvisoTienda aviso={aviso} alCerrar={() => setAviso(null)} />
    </Box>
  )
}
