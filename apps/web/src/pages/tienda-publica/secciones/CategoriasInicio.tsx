import { Box, ButtonBase, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { Link as EnlaceRuta } from 'react-router'
import { EstadoCargaPagina } from '../../../components/estados/EstadosPagina'
import { urlsImagenesProducto } from '../../../lib/imagenProducto'
import { useCategoriasTienda } from '../../../hooks/useCategoriasTienda'
import { categoriasPrincipales } from '../../../lib/tiendaCategorias'
import { useInicioTienda } from '../../../lib/tiendaInicio'
import type { PropsSeccionTienda } from '../PaginaTienda'
import { useCelular } from '../useAnchoCelular'
import { BORDE_CAMPO } from '../layout/medidas'
import { elegirCategoriaInicio, useCategoriaInicio } from './categoriaInicio'
import { ErrorConReintento } from '../ErrorConReintento'

export const orden = 40

// URLs firmadas de las fotos de las tarjetas (una sola llamada por bloque, como las tarjetas de producto). Mientras
// llegan, o si una no se pudo firmar, la tarjeta muestra el recuadro neutro sin foto.
function useImagenesCategorias(rutas: string[]): Record<string, string> {
  // La clave es el arreglo serializado (no un `join` con separador: una ruta podría contenerlo); las rutas se
  // leen de vuelta de la clave, así el efecto depende solo de ella.
  const clave = JSON.stringify(rutas)
  const [resuelto, setResuelto] = useState<{ clave: string; urls: Record<string, string> }>({ clave: '', urls: {} })
  useEffect(() => {
    const lista = JSON.parse(clave) as string[]
    if (lista.length === 0) return
    let cancelada = false
    urlsImagenesProducto(lista)
      .then((urls) => { if (!cancelada) setResuelto({ clave, urls }) })
      .catch((error) => console.error('No se pudieron firmar las fotos de las categorías', error instanceof Error ? error.message : error))
    return () => { cancelada = true }
  }, [clave])
  return resuelto.clave === clave ? resuelto.urls : {}
}

const cantidad = (n: number) => (n === 1 ? '1 producto' : `${n} productos`)

// Bloque «Categorías» de la home (F-TDA-10, FR-003): una tarjeta por categoría principal de la tienda (las de
// mayor cantidad, hasta 6, sin nombres repetidos) con «N productos» (el conteo real de productos visibles,
// subcategorías incluidas: coincide con el listado al entrar), que enlaza a su listado. Nunca hay tarjetas
// con 0 productos: la base no devuelve las categorías vacías (MSF-825, MSF-827). «Más categorías» (barra del encabezado)
// lleva al catálogo con el resto; en celular las categorías son píldoras que filtran los destacados. Se oculta cuando la tienda no tiene productos visibles (ahí manda
// «Catálogo en preparación»). Un error queda en este bloque.
export default function CategoriasInicio({ host }: PropsSeccionTienda) {
  const categorias = useCategoriasTienda(host)
  const inicio = useInicioTienda(host)
  const movil = useCelular()
  const elegida = useCategoriaInicio()
  // Al salir de la portada la elección se descarta; al pasar a escritorio (sin píldoras para volver) también.
  useEffect(() => () => elegirCategoriaInicio(null), [])
  useEffect(() => { if (!movil) elegirCategoriaInicio(null) }, [movil])
  const imagenes = useImagenesCategorias(categoriasPrincipales(categorias.categorias).flatMap((c) => (c.imagen ? [c.imagen] : [])))

  if (categorias.fase === 'cargando' || inicio.fase === 'cargando') {
    return <Box component="section" aria-label="Categorías" sx={{ pt: 4 }}><EstadoCargaPagina lineas={2} /></Box>
  }
  if (categorias.fase === 'error') {
    return (
      <Box component="section" aria-label="Categorías" sx={{ pt: 4 }}>
        <ErrorConReintento titulo="No pudimos cargar las categorías." alReintentar={categorias.reintentar} />
      </Box>
    )
  }
  // Si el dato de preparación falló, no se oculta el bloque: las categorías ya cargaron por su cuenta.
  if ((inicio.fase === 'lista' && !inicio.hayProductos) || categorias.categorias.length === 0) return null

  const principales = categoriasPrincipales(categorias.categorias)
  // Celular (MJC_M_Home): las categorías son una fila de píldoras (14 px/600, borde de 1,5 px y radio total) que filtran los destacados
  // en su lugar; «Todo» arranca activa. Son botones con estado (`aria-pressed`); el camino a cada categoría sigue en el menú, en
  // «Más categorías» y en el enlace de «Destacados» cuando la categoría elegida no tiene destacados.
  if (movil) {
    const descendientes = (id: string) => {
      const ids = new Set<string>([id])
      let creciendo = true
      while (creciendo) {
        creciendo = false
        for (const c of categorias.categorias) if (c.padreId && ids.has(c.padreId) && !ids.has(c.id)) { ids.add(c.id); creciendo = true }
      }
      return ids
    }
    return (
      <Box component="section" aria-label="Categorías" sx={{ pt: '24px' /* estilos-sueltos: ok */ }}>
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, py: '12px', display: 'flex', gap: '8px', overflowX: 'auto', scrollbarWidth: 'none' /* estilos-sueltos: ok */ }}>
          {[{ id: 'todo', nombre: 'Todo' }, ...principales.map((c) => ({ id: c.id, nombre: c.nombre }))].map((c) => {
            const activa = c.id === 'todo' ? elegida === null : elegida?.id === c.id
            return (
              <li key={c.id}>
                <ButtonBase
                  aria-pressed={activa}
                  onClick={() => elegirCategoriaInicio(c.id === 'todo' ? null : { id: c.id, nombre: c.nombre, ids: descendientes(c.id) })}
                  sx={{
                    flexShrink: 0, whiteSpace: 'nowrap', px: '14px', py: '8px', borderRadius: '999px', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', // estilos-sueltos: ok
                    border: BORDE_CAMPO, borderColor: activa ? 'primary.main' : undefined, bgcolor: activa ? 'primary.main' : 'background.paper', color: activa ? 'primary.contrastText' : 'text.primary',
                    '&.Mui-focusVisible': { outlineStyle: 'solid', outlineWidth: '2px', outlineColor: 'primary.main', outlineOffset: '2px' }, // estilos-sueltos: ok
                  }}
                >
                  {c.nombre}
                </ButtonBase>
              </li>
            )
          })}
        </Box>
      </Box>
    )
  }
  return (
    <Box component="section" aria-labelledby="categorias-inicio-titulo" sx={{ pt: '48px', pb: '8px' /* estilos-sueltos: ok */ }}>
      <Typography id="categorias-inicio-titulo" component="h2" variant="h5" sx={{ mb: '20px', fontSize: 32 /* estilos-sueltos: ok */ }}>Categorías</Typography>
      <Box
        component="ul"
        sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 186px))' }}
      >
        {principales.map((c) => {
          const foto = c.imagen ? imagenes[c.imagen] : undefined
          return (
            <li key={c.id}>
              <Box
                component={EnlaceRuta}
                to={`/categoria/${c.id}`}
                sx={(tema) => ({
                  display: 'block', p: 2, height: '100%', boxSizing: 'border-box', textAlign: 'center',
                  color: 'inherit', textDecoration: 'none', bgcolor: tema.tienda?.superficie ?? 'action.hover', borderRadius: '8px', // estilos-sueltos: ok
                  '&:hover, &:focus-visible': { outline: '1px solid', outlineColor: 'text.primary', outlineOffset: '-1px' },
                })}
              >
                {/* Foto de la categoría (la de un producto suyo); sin foto, el recuadro neutro del prototipo. */}
                <Box data-testid="foto-categoria" sx={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' /* estilos-sueltos: ok */ }}>
                  {foto ? <Box component="img" src={foto} alt="" loading="lazy" sx={{ maxWidth: '100%', maxHeight: 110, objectFit: 'contain' }} /> : null}
                </Box>
                <Typography component="span" sx={(tema) => ({ display: 'block', mt: 1, fontWeight: 700, fontSize: 20, fontFamily: tema.tienda?.fuenteTitulos /* estilos-sueltos: ok */ })}>{c.nombre}</Typography>
                <Typography component="span" variant="body2" color="text.secondary" sx={{ display: 'block', fontSize: 13 /* estilos-sueltos: ok */ }}>{cantidad(c.productos)}</Typography>
              </Box>
            </li>
          )
        })}
      </Box>
    </Box>
  )
}
