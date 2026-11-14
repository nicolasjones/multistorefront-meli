import { useState } from 'react'
import { Box, Button, Card, CardActions, CardContent, Stack, Typography } from '@mui/material'
import { ReporteEmbebido, type MotivoFalloReporte } from '../../components/ReporteEmbebido'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { useReportesAsignados } from '../../hooks/useReportesAsignados'
import { tablerosDisponibles, type TableroDisponible } from '../../lib/tablerosAnaliticos'
import {
  ATAJO_RANGO_INICIAL,
  TEXTO_AYUDA_EMPRESAS,
  rangoPorAtajo,
  urlParamsReportes,
  type RangoFechas,
} from '../../lib/ventas-reportes'
import { AccesoRestringido } from '../acceso-restringido/AccesoRestringido'
import { FiltrosPeriodo } from '../ventas-reportes/FiltrosPeriodo'

const TITULO = 'Tableros analíticos'
const DESCRIPCION = 'Elegí un tablero ya armado para cruzar tus ventas, tus tiendas y tu margen.'

type Fallo = { motivo: MotivoFalloReporte; clave: string }

type TarjetaProps = {
  tablero: TableroDisponible
  alElegir: (tablero: TableroDisponible) => void
}

// Una tarjeta de la galería: qué es, qué cruces permite y con qué filtros, sin abrir el tablero.
function TarjetaTablero({ tablero, alElegir }: TarjetaProps) {
  const idTitulo = `tablero-${tablero.clave}-titulo`
  return (
    <Card component="li" variant="outlined" aria-labelledby={idTitulo} sx={{ display: 'flex', flexDirection: 'column', listStyle: 'none' }}>
      <CardContent sx={{ flexGrow: 1 }}>
        <Typography id={idTitulo} component="h2" variant="h6">{tablero.titulo}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{tablero.descripcion}</Typography>
        <Typography component="h3" variant="subtitle2" sx={{ mt: 1.5 }}>Cruces</Typography>
        <Typography variant="body2">{tablero.cruces.join(' · ')}</Typography>
        <Typography component="h3" variant="subtitle2" sx={{ mt: 1 }}>Filtros</Typography>
        <Typography variant="body2">{tablero.filtros.join(' · ')}</Typography>
        {tablero.muestraCostos ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Incluye costo y margen: lo ven solo quienes tienen acceso a Rentabilidad.
          </Typography>
        ) : null}
      </CardContent>
      <CardActions>
        <Button variant="contained" onClick={() => alElegir(tablero)} aria-label={`Abrir el tablero ${tablero.titulo}`}>
          Abrir tablero
        </Button>
      </CardActions>
    </Card>
  )
}

// «Tableros analíticos» (F-REP-07, MSF-265): galería de los tableros ya armados y versionados que la organización tiene
// asignados. El administrador elige uno y lo ve embebido en el panel con los filtros de período y de empresa
// preseleccionados; NO arma ni edita tableros y nunca entra a Superset. El aislamiento por organización y por empresa lo
// resuelve el servidor en el guest token (`emitir-acceso-reporte`): los filtros de esta pantalla solo preseleccionan la
// vista. Sin prototipo dibujado: usa el sistema de diseño del panel.
// Empresa activa (Principio VIII): el filtro de tienda sigue a la empresa activa de la barra superior; al cambiarla el
// tablero se vuelve a montar con la tienda nueva y el token se pide de nuevo, así que nunca quedan filas de la anterior.
export function TablerosAnaliticos() {
  const { puedeEscribir, isLoading: cargandoPermiso } = usePuedeEscribir()
  const { reportes, isLoading: cargandoReportes } = useReportesAsignados()
  const {
    empresas,
    valor: empresaId,
    cambiar: elegirEmpresa,
    cargando: cargandoTiendas,
    hayError: errorTiendas,
  } = useFiltroPorEmpresaActiva()
  const [claveElegida, setClaveElegida] = useState<string | null>(null)
  const [rango, setRango] = useState<RangoFechas>(() => rangoPorAtajo(ATAJO_RANGO_INICIAL))
  // Cada intento remonta el tablero: repite la solicitud del token y el montaje.
  const [intento, setIntento] = useState(0)
  const [fallo, setFallo] = useState<Fallo | null>(null)

  const encabezado = (accion?: React.ReactNode) => (
    <EncabezadoPagina titulo={TITULO} descripcion={DESCRIPCION} contexto={<ContextoOrganizacionActiva />} accion={accion} />
  )

  if (cargandoPermiso || puedeEscribir === null) {
    return <Box>{encabezado()}<ContenedorSeccion><EstadoCargaPagina /></ContenedorSeccion></Box>
  }
  // Solo administradores (la matriz de permisos no tiene una sección propia): quien llega por URL directa ve el acceso
  // restringido sin pedir ningún token. El servidor lo vuelve a exigir: el token de cada tablero pide su sección.
  if (!puedeEscribir) {
    return <AccesoRestringido rol="actual" seccion={TITULO} />
  }
  if (cargandoReportes) {
    return <Box>{encabezado()}<ContenedorSeccion><EstadoCargaPagina /></ContenedorSeccion></Box>
  }

  const tableros = tablerosDisponibles(reportes)
  if (tableros.length === 0) {
    return (
      <Box>
        {encabezado()}
        <ContenedorSeccion>
          <EstadoVacio
            titulo="Todavía no hay tableros disponibles para tu organización."
            descripcion="Cuando el equipo asigne tableros a tu organización, los vas a ver acá."
          />
        </ContenedorSeccion>
      </Box>
    )
  }

  const elegido = tableros.find((tablero) => tablero.clave === claveElegida) ?? null
  if (!elegido) {
    return (
      <Box>
        {encabezado()}
        <ContenedorSeccion>
          <Box component="ul" sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, listStyle: 'none', m: 0, p: 0 }} aria-label="Tableros disponibles">
            {tableros.map((tablero) => (
              <TarjetaTablero key={tablero.clave} tablero={tablero} alElegir={(t) => { setFallo(null); setIntento(0); setClaveElegida(t.clave) }} />
            ))}
          </Box>
        </ContenedorSeccion>
      </Box>
    )
  }

  // El filtro nativo de empresa del tablero trabaja con el nombre de la tienda.
  const empresaNombre = empresas.find((empresa) => empresa.id === empresaId)?.nombre ?? null
  const urlParams = urlParamsReportes({ rango, empresa: empresaNombre })
  const clave = `${rango.desde}|${rango.hasta}|${empresaId ?? 'todas'}`
  // El fallo de carga solo vale para los filtros con los que ocurrió; el acceso restringido no depende de ellos.
  const falloActual = fallo && (fallo.motivo === 'prohibido' || fallo.clave === clave) ? fallo.motivo : null

  if (falloActual === 'prohibido') {
    return <AccesoRestringido rol="actual" seccion={elegido.titulo} />
  }

  let tablero
  if (cargandoTiendas) {
    // No se monta hasta saber la tienda: si no, se pediría el token dos veces (una sin filtro y otra con la tienda activa).
    tablero = <EstadoCargaPagina />
  } else if (falloActual === 'no_disponible') {
    tablero = (
      <EstadoError
        descripcion={`No pudimos cargar el tablero «${elegido.titulo}».`}
        reintentar={() => { setFallo(null); setIntento((anterior) => anterior + 1) }}
      />
    )
  } else {
    tablero = (
      <ReporteEmbebido
        // La clave incluye los filtros: al cambiar período o tienda el tablero se remonta con los nuevos.
        key={`${elegido.reporteId}-${JSON.stringify(urlParams)}-${intento}`}
        reporteId={elegido.reporteId}
        alFallar={(motivo) => setFallo({ motivo, clave })}
        urlParams={urlParams}
      />
    )
  }

  return (
    <Stack spacing={2}>
      {encabezado(
        <Button variant="outlined" onClick={() => setClaveElegida(null)}>Volver a los tableros</Button>,
      )}
      <Typography component="h2" variant="h6">{elegido.titulo}</Typography>
      <FiltroEmpresa
        empresas={empresas}
        valor={empresaId}
        onCambiar={elegirEmpresa}
        cargando={cargandoTiendas}
        hayError={errorTiendas}
        textoAyuda={TEXTO_AYUDA_EMPRESAS}
      />
      <FiltrosPeriodo rango={rango} onCambiar={setRango} />
      <ContenedorSeccion>{tablero}</ContenedorSeccion>
    </Stack>
  )
}
