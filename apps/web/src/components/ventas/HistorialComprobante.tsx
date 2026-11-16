import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardHeader, Typography } from '@mui/material'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../pagina/ContenidoAdaptable'
import { EtiquetaEstado } from '../base/EtiquetaEstado'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'
import { historialComprobante, type EventoHistorial } from '../../lib/estadosComprobante'

// Tarjeta «Historial de estados y acciones» del detalle del comprobante (F-VTA-10, FR-027). Lee
// `historial_comprobante`, que ya devuelve los eventos de ESTE comprobante, más recientes primero. `claveRecarga`
// cambia cuando hay que volver a leer (cambio de estado, cambio de empresa activa): se descarta lo anterior para no
// mostrar nunca filas de otra tienda (Principio VIII).

const formatoCuando = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  timeZone: 'America/Argentina/Buenos_Aires',
})

// «07/10 09:12» (hora de Buenos Aires); fecha inválida → «—».
function formatearCuando(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return '—'
  const partes = formatoCuando.formatToParts(fecha)
  const buscar = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? ''
  return `${buscar('day')}/${buscar('month')} ${buscar('hour')}:${buscar('minute')}`
}

const columnas: ColumnaAdaptable<EventoHistorial>[] = [
  { clave: 'cuando', encabezado: 'Cuándo', render: (e) => <span style={{ whiteSpace: 'nowrap' }}>{formatearCuando(e.cuando)}</span> },
  { clave: 'accion', encabezado: 'Acción', render: (e) => e.accion },
  { clave: 'quien', encabezado: 'Quién', render: (e) => e.quien },
  { clave: 'tienda', encabezado: 'Tienda', render: (e) => (e.empresa ? <EtiquetaEstado texto={e.empresa} variante="contorno" /> : '—') },
]

type Estado = { fase: 'cargando' } | { fase: 'error' } | { fase: 'listo'; eventos: EventoHistorial[] }

export function HistorialComprobante({ comprobanteId, claveRecarga }: { comprobanteId: string; claveRecarga: string }) {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' })
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setEstado({ fase: 'cargando' })
    try {
      const eventos = await historialComprobante(comprobanteId)
      if (peticion === ultimaPeticion.current) setEstado({ fase: 'listo', eventos })
    } catch (error) {
      console.error('No pudimos cargar el historial del comprobante.', error)
      if (peticion === ultimaPeticion.current) setEstado({ fase: 'error' })
    }
  }, [comprobanteId])

  // `claveRecarga` no se usa dentro del efecto a propósito: es el disparador de la relectura.
  useEffect(() => {
    void cargar()
  }, [cargar, claveRecarga])

  return (
    <Card variant="outlined" component="section" aria-labelledby="titulo-historial-comprobante">
      <CardHeader
        title={<Typography id="titulo-historial-comprobante" component="h2" variant="t3">Historial de estados y acciones</Typography>}
        subheader="Quién hizo cada cambio, cuándo y desde qué tienda."
      />
      {estado.fase === 'cargando' ? <EstadoCargaPagina lineas={2} /> : null}
      {estado.fase === 'error' ? (
        <EstadoError descripcion="No pudimos cargar el historial del comprobante." reintentar={() => void cargar()} />
      ) : null}
      {estado.fase === 'listo' && estado.eventos.length === 0 ? (
        <EstadoVacio titulo="Todavía no hay movimientos" descripcion="Cuando alguien cambie el estado o edite el comprobante, queda registrado acá." />
      ) : null}
      {estado.fase === 'listo' && estado.eventos.length > 0 ? (
        <ContenidoAdaptable
          items={estado.eventos}
          columnas={columnas}
          obtenerClave={(e, indice) => `${indice}|${e.cuando}|${e.accion}|${e.quien}`}
          etiquetaTabla="Historial de estados y acciones"
        />
      ) : null}
      <Typography variant="caption" color="text.secondary" component="p" sx={{ px: 2, py: 1.5 }}>
        El comprobante pertenece a una sola tienda. Un administrador con acceso a ambas puede actuar desde otra tienda y queda registrado.
      </Typography>
    </Card>
  )
}
