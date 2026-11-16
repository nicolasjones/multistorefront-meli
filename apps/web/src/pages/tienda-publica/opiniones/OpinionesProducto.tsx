import { Alert, Box, Button, Typography } from '@mui/material'
import { useCallback, useState } from 'react'
import { Link as EnlaceRuta, useLocation } from 'react-router'
import { CargaInfinita } from '../../../components/pagina/CargaInfinita'
import { EstadoCargaPagina } from '../../../components/estados/EstadosPagina'
import { useCapacidadOpiniones } from '../../../hooks/useCapacidadOpiniones'
import { useListadoPorCursor } from '../../../hooks/useListadoPorCursor'
import { useSesionClienteDetallada } from '../../../hooks/useSesionCliente'
import { leerOpinionesProducto, type CursorOpiniones, type OpinionPublica, type ResumenOpiniones } from '../../../lib/tiendaOpiniones'
import { enlaceIngresarConVolver } from '../../../lib/tiendaVolver'
import { ErrorConReintento } from '../ErrorConReintento'
import { EstrellasLectura } from './EstrellasPuntuacion'
import { FormularioOpinion, TEXTO_GRACIAS } from './FormularioOpinion'
import { formatoFecha, textoResumen } from './textos'

// Bloque «Opiniones» de la ficha (MSF-467, RF-OPI-11, US3): promedio y cantidad, las opiniones aceptadas por tandas con «Cargar más»
// y, con sesión, el formulario «Tu opinión» (sin sesión, una invitación a ingresar). Solo se monta con la función encendida: con la
// bandera apagada no dibuja nada ni hace llamadas de lectura. Todo texto de una opinión se pinta como texto (nunca como HTML).
export default function OpinionesProducto({ host, productoId }: { host: string; productoId: string }) {
  const activa = useCapacidadOpiniones(host)
  if (!activa) return null
  return <BloqueOpiniones host={host} productoId={productoId} />
}

function BloqueOpiniones({ host, productoId }: { host: string; productoId: string }) {
  const sesion = useSesionClienteDetallada(host)
  const ubicacion = useLocation()
  const [resumen, setResumen] = useState<ResumenOpiniones | null>(null)
  const [enviada, setEnviada] = useState(false)
  const [sinAcceso, setSinAcceso] = useState(false)
  const alSinAcceso = useCallback(() => setSinAcceso(true), [])

  const listado = useListadoPorCursor<OpinionPublica, CursorOpiniones>({
    clave: `${host}|${productoId}`,
    leer: async (cursor) => {
      const pagina = await leerOpinionesProducto(host, productoId, cursor)
      setResumen(pagina.resumen)
      return { total: pagina.resumen.cantidad, filas: pagina.filas, siguiente: pagina.siguiente }
    },
    idDe: (fila) => fila.id,
  })

  return (
    <Box component="section" aria-labelledby="opiniones-titulo" sx={{ pb: 4 }}>
      <Typography id="opiniones-titulo" component="h2" variant="h5">Opiniones</Typography>
      {resumen ? (
        <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1 }}>
          {resumen.promedio !== null ? <EstrellasLectura valor={Math.round(resumen.promedio)} /> : null}
          <Typography component="p" aria-live="polite">{textoResumen(resumen)}</Typography>
        </Box>
      ) : null}

      <Box sx={{ mt: 2 }}>
        {sesion.estado === 'activa' && !sinAcceso ? (
          enviada ? (
            <Alert severity="success" role="status">{TEXTO_GRACIAS}</Alert>
          ) : (
            <>
              <FormularioOpinion host={host} productoId={productoId} alGuardar={() => setEnviada(true)} alSinAcceso={alSinAcceso} />
              <Typography color="text.secondary" sx={{ mt: 1, fontSize: 13 /* estilos-sueltos: ok */ }}>Si ya opinaste sobre este producto, esta opinión reemplaza la anterior y vuelve a revisarse.</Typography>
            </>
          )
        ) : sesion.estado === 'sin_sesion' ? (
          <Button component={EnlaceRuta} to={enlaceIngresarConVolver(`${ubicacion.pathname}${ubicacion.search}`)} variant="outlined" sx={{ minHeight: (tema) => tema.spacing(5.5) }}>
            Ingresá para dejar tu opinión
          </Button>
        ) : sinAcceso ? (
          <Typography color="text.secondary">Tu cuenta no está activa en esta tienda, por eso no podés opinar.</Typography>
        ) : null}
      </Box>

      <Box sx={{ mt: 2 }}>
        {listado.fase === 'cargando' ? <EstadoCargaPagina etiqueta="Cargando las opiniones" /> : null}
        {listado.fase === 'error' ? <ErrorConReintento titulo="No pudimos cargar las opiniones." alReintentar={listado.reintentar} /> : null}
        {listado.fase === 'lista' && listado.filas.length === 0 ? <Typography color="text.secondary">Todavía no hay opiniones</Typography> : null}
        {listado.fase === 'lista' && listado.filas.length > 0 ? (
          <>
            <Box component="ul" aria-label="Opiniones del producto" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 2 }}>
              {listado.filas.map((opinion) => (
                <Box component="li" key={opinion.id} sx={{ borderBottom: 1, borderColor: 'divider', pb: 2, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1 }}>
                    <EstrellasLectura valor={opinion.puntuacion} tamano="small" />
                    <Typography component="span" sx={{ fontWeight: 600 }}>{opinion.nombrePila}{opinion.esMia ? ' (vos)' : ''}</Typography>
                    <Typography component="span" color="text.secondary" sx={{ fontSize: 13 /* estilos-sueltos: ok */ }}>{formatoFecha(opinion.fecha)}</Typography>
                  </Box>
                  {/* Texto no confiable: se pinta como texto de React, con los saltos de línea respetados y sin HTML. */}
                  <Typography sx={{ mt: 0.5, overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>{opinion.comentario}</Typography>
                </Box>
              ))}
            </Box>
            <CargaInfinita hayMas={listado.hayMas} cargando={listado.cargandoMas} hayError={listado.errorMas} onCargarMas={listado.cargarMas} textoFin="Llegaste al final de las opiniones" sustantivo="opiniones" cargados={listado.filas.length} />
          </>
        ) : null}
      </Box>
    </Box>
  )
}
