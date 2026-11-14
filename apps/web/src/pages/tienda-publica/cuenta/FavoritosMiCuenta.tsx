import { Box, Button, Link, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { Link as EnlaceRuta } from 'react-router'
import { MiniaturaProducto } from '../../../components/base/MiniaturaProducto'
import { CargaInfinita } from '../../../components/pagina/CargaInfinita'
import { EstadoCargaPagina } from '../../../components/estados/EstadosPagina'
import { useListadoPorCursor } from '../../../hooks/useListadoPorCursor'
import { urlsImagenesProducto } from '../../../lib/imagenProducto'
import { cambiarFavorito, esSinAcceso, leerMisFavoritos, type CursorFavoritos, type FavoritoCuenta } from '../../../lib/tiendaCuentaDatos'
import { formatearPrecioArs } from '../../../lib/tiendaListado'
import { ErrorConReintento } from '../ErrorConReintento'
import EtiquetaDisponibilidad from '../disponibilidad/EtiquetaDisponibilidad'
import { LINEA_SUAVE } from '../layout/medidas'
import { AvisoTienda } from './AvisoTienda'
import { crearAviso, type AvisoCuenta } from './aviso'
import { VacioMiCuenta } from './VacioMiCuenta'

type FavoritoVista = FavoritoCuenta & { imagenUrl: string | null }

const textoContador = (n: number) => `${n} ${n === 1 ? 'favorito' : 'favoritos'}`

// «Favoritos» de «Mi cuenta» (F-CLI-20, FR-008/FR-009, P-3): los productos que la cuenta guardó en ESTA tienda, el último guardado
// primero, por tandas de 20 con carga infinita. Cada tarjeta: miniatura (con zoom), nombre (enlace a la ficha), disponibilidad,
// precio según la cuenta («Precio a confirmar» sin precio) y «Quitar» con «Deshacer». Un favorito cuyo producto dejó de ser visible
// no se lista (el servidor lo omite: no se borra y vuelve si se republica). «Agregar a la lista» no se dibuja todavía: lo suma la
// historia de la lista de pedido (B1, T039), que es la que crea la lista.
export function FavoritosMiCuenta({ host, alSinAcceso }: { host: string; alSinAcceso: () => void }) {
  const [aviso, setAviso] = useState<AvisoCuenta | null>(null)
  const [quitando, setQuitando] = useState<string | null>(null)
  const listado = useListadoPorCursor<FavoritoVista, CursorFavoritos>({
    clave: host,
    leer: async (cursor) => {
      const pagina = await leerMisFavoritos(host, cursor)
      const urls = await urlsImagenesProducto(pagina.filas.flatMap((fila) => (fila.imagen ? [fila.imagen] : [])))
      return { ...pagina, filas: pagina.filas.map((fila) => ({ ...fila, imagenUrl: fila.imagen ? urls[fila.imagen] ?? null : null })) }
    },
    idDe: (fila) => fila.productoId,
    alSinAcceso,
  })

  // Si se quitaron todos los cargados pero el servidor tiene más, se pide la tanda siguiente (no se muestra un vacío falso).
  const { fase, filas, hayMas, cargandoMas, errorMas, cargarMas } = listado
  useEffect(() => {
    if (fase === 'lista' && filas.length === 0 && hayMas && !cargandoMas && !errorMas) cargarMas()
  }, [fase, filas.length, hayMas, cargandoMas, errorMas, cargarMas])

  const publicar = (mensaje: string, error = false, accion?: AvisoCuenta['accion']) => setAviso(crearAviso(mensaje, error, accion))

  const quitar = async (favorito: FavoritoVista) => {
    if (quitando) return
    setQuitando(favorito.productoId)
    try {
      const resultado = await cambiarFavorito(host, favorito.productoId, false)
      if (resultado.estado !== 'ok') {
        publicar('No pudimos quitar el favorito. Probá de nuevo.', true)
        return
      }
      const quitado = listado.quitar(favorito.productoId)
      publicar(`Quitamos «${favorito.nombre}» de tus favoritos`, false, {
        etiqueta: 'Deshacer',
        alElegir: () => {
          cambiarFavorito(host, favorito.productoId, true)
            .then((vuelta) => {
              if (vuelta.estado === 'ok' && quitado) listado.reponer(quitado.fila, quitado.indice)
              else publicar(vuelta.estado === 'limite_favoritos' ? 'Llegaste al máximo de favoritos' : 'No pudimos guardar el favorito. Probá de nuevo.', true)
            })
            .catch((error: unknown) => publicar(esSinAcceso(error) ? 'Tu cuenta no está activa en esta tienda' : 'No pudimos guardar el favorito. Probá de nuevo.', true))
        },
      })
    } catch (error) {
      if (esSinAcceso(error)) alSinAcceso()
      else publicar('No pudimos quitar el favorito. Probá de nuevo.', true)
    } finally {
      setQuitando(null)
    }
  }

  if (fase === 'sin_acceso') return null
  if (fase === 'cargando') return <EstadoCargaPagina etiqueta="Cargando tus favoritos" />
  if (fase === 'error') return <ErrorConReintento titulo="No pudimos cargar tus favoritos." alReintentar={listado.reintentar} />
  if (filas.length === 0 && !hayMas) {
    return (
      <>
        <VacioMiCuenta titulo="Todavía no guardaste favoritos" descripcion="Tocá «Guardar en favoritos» en la ficha de un producto para tenerlo a mano." />
        <AvisoTienda aviso={aviso} alCerrar={() => setAviso(null)} />
      </>
    )
  }

  return (
    <Box>
      <Typography component="p" aria-live="polite" color="text.secondary" sx={{ mb: 1 }}>{textoContador(listado.total)}</Typography>
      <Box component="ul" aria-label="Favoritos" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' } }}>
        {filas.map((favorito) => {
          const precio = formatearPrecioArs(favorito.precioFinal)
          return (
            <Box component="li" key={favorito.productoId} sx={{ display: 'flex', gap: 2, border: LINEA_SUAVE, borderRadius: '8px', p: 2, minWidth: 0 /* estilos-sueltos: ok */ }}>
              <MiniaturaProducto alt={favorito.nombre} src={favorito.imagenUrl} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Link component={EnlaceRuta} to={`/producto/${favorito.productoId}`} color="inherit" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{favorito.nombre}</Link>
                <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5 }}>
                  <EtiquetaDisponibilidad disponible={favorito.disponible} />
                  <Typography component="span" sx={{ fontWeight: 600 }}>{precio ?? 'Precio a confirmar'}</Typography>
                  {precio && favorito.escala !== 'x1' ? <Typography component="span" color="text.secondary" sx={{ fontSize: 13 /* estilos-sueltos: ok */ }}>Escala {favorito.escala}</Typography> : null}
                </Box>
                <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    aria-label={`Quitar ${favorito.nombre} de favoritos`}
                    disabled={quitando !== null}
                    onClick={() => { void quitar(favorito) }}
                    sx={{ minHeight: (tema) => tema.spacing(5.5), width: { xs: '100%', sm: 'auto' } }}
                  >
                    Quitar
                  </Button>
                </Box>
              </Box>
            </Box>
          )
        })}
      </Box>
      <CargaInfinita hayMas={hayMas} cargando={cargandoMas} hayError={errorMas} onCargarMas={cargarMas} mostrarFin={false} />
      {!hayMas && !errorMas ? <Typography component="p" color="text.secondary" align="center" sx={{ pb: 2 }}>Llegaste al final de tus favoritos</Typography> : null}
      <AvisoTienda aviso={aviso} alCerrar={() => setAviso(null)} />
    </Box>
  )
}
