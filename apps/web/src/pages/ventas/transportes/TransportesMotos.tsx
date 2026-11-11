import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Checkbox, LinearProgress, Link, Stack, Switch, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router'
import { useListadoAcumulado } from '../../../hooks/useListadoAcumulado'
import { EtiquetaEstado } from '../../../components/base/EtiquetaEstado'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../../components/estados/EstadosPagina'
import { CargaInfinita } from '../../../components/pagina/CargaInfinita'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../../components/pagina/ContenidoAdaptable'
import { EnvioMotoDialog } from '../../../components/ventas/EnvioMotoDialog'
import { RendicionMotosDialog } from '../../../components/ventas/RendicionMotosDialog'
import { Tarjeta } from '../../../components/ventas/ContrarreembolsosTabla'
import { formatearFecha, formatearImporteHistorial } from '../../../lib/formatoHistorial'
import { codigoDeError, listarEnviosMoto, type EnvioMoto } from '../../../lib/ventas/enviosMoto'
import {
  esRendible,
  mensajeDeErrorRendicion,
  rendirEnviosMoto,
  resumenMotosSinRendir,
  type ResultadoRendicion,
  type ResumenMotos,
} from '../../../lib/ventas/enviosMotoRendicion'
import { tokens } from '../../../tema/tokens'

// Los envíos se piden por tandas de 25 (carga infinita, Principio VI).
const TAMANO_TANDA = 25
// Barra de progreso indeterminada: alto fino propio del componente, no un valor del sistema.
const ALTO_BARRA_CARGA = 2
const AVISO_CAMBIO_EMPRESA = 'Cambió la empresa activa: cerramos el diálogo y descartamos la selección para no mezclar datos de dos tiendas.'

type Aviso = { titulo: string; descripcion?: string; severidad: 'success' | 'info' | 'error' | 'warning' }

type Props = {
  // Filtro Tienda de la pestaña (`null` = todas las accesibles). Sigue a la empresa activa.
  empresaId: string | null
  empresaActivaId: string | null
  // Organización activa: parte del contexto de las consultas.
  organizacionId: string | null
  // Las empresas accesibles ya se resolvieron: antes no se pide nada ni se detecta un cambio.
  listo: boolean
  // `ventas` en edición: muestra «Registrar envío». La base exige además rol Operador/Administrador.
  puedeRegistrar: boolean
}

// Fecha dd/mm del prototipo (la base entrega AAAA-MM-DD).
const fechaCorta = (iso: string) => formatearFecha(iso.slice(0, 10)).slice(0, 5)

// Pestaña «Motos» de Transportes (F-VTA-24 y F-VTA-25, FR-006, FR-007 y FR-020…FR-025): tarjeta
// «Motos sin rendir», tabla de envíos en moto, registro/edición, rendición por fila y en lote.
export function TransportesMotos({ empresaId, empresaActivaId, organizacionId, listo, puedeRegistrar }: Props) {
  const clave = `${organizacionId ?? ''}:${empresaActivaId ?? ''}:${empresaId ?? ''}`
  const [pagina, setPagina] = useState(1)
  const [datos, setDatos] = useState<{ envios: EnvioMoto[]; total: number }>({ envios: [], total: 0 })
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(false)
  const [respondidaPara, setRespondidaPara] = useState<string | undefined>(undefined)
  const [resumen, setResumen] = useState<ResumenMotos | null>(null)
  const [cargandoResumen, setCargandoResumen] = useState(true)
  // Se incrementa para recargar desde la primera tanda tras registrar, editar o rendir.
  const [revision, setRevision] = useState(0)
  const ultimaPeticion = useRef(0)
  const ultimaPeticionResumen = useRef(0)

  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [registrando, setRegistrando] = useState(false)
  const [editando, setEditando] = useState<EnvioMoto | null>(null)
  const [seleccion, setSeleccion] = useState<ReadonlySet<string>>(new Set())
  const [rindiendoLote, setRindiendoLote] = useState(false)
  const [rindiendoFila, setRindiendoFila] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    // `revision` no se consulta en el cuerpo: está en las dependencias para recargar tras un cambio.
    void revision
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    try {
      const resultado = await listarEnviosMoto({ empresaId, pagina, tamano: TAMANO_TANDA })
      if (peticion !== ultimaPeticion.current) return
      setDatos(resultado)
      setError(false)
    } catch (falla) {
      if (peticion !== ultimaPeticion.current) return
      console.error('No pudimos listar los envíos en moto.', codigoDeError(falla))
      setDatos({ envios: [], total: 0 })
      setError(true)
    }
    setCargando(false)
    setRespondidaPara(clave)
    // La organización la resuelve RLS: `clave` solo identifica el contexto de la respuesta.
  }, [empresaId, pagina, clave, revision])

  useEffect(() => {
    if (!listo) return
    void cargar()
  }, [cargar, listo])

  // La tarjeta se recalcula con el contexto (tienda) y tras cada cambio; no depende de la tanda.
  useEffect(() => {
    if (!listo) return
    const peticion = ++ultimaPeticionResumen.current
    setCargandoResumen(true)
    resumenMotosSinRendir(empresaId)
      .then((r) => { if (peticion === ultimaPeticionResumen.current) setResumen(r) })
      .catch((falla) => {
        if (peticion !== ultimaPeticionResumen.current) return
        console.error('No pudimos calcular las motos sin rendir.', codigoDeError(falla))
        setResumen(null)
      })
      .finally(() => { if (peticion === ultimaPeticionResumen.current) setCargandoResumen(false) })
  }, [empresaId, clave, revision, listo])

  const recargarDesdeInicio = () => {
    setSeleccion(new Set())
    setPagina(1)
    setRevision((r) => r + 1)
  }

  // Empresa activa (Principio VIII, FR-007 y FR-025): al cambiarla se vuelve a la primera tanda, se
  // descarta la selección y se cierra con aviso cualquier diálogo abierto. La primera empresa
  // resuelta no cuenta como cambio.
  const empresaActivaPrevia = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (!listo) return
    if (empresaActivaPrevia.current === undefined) {
      empresaActivaPrevia.current = empresaActivaId
      return
    }
    if (empresaActivaId === empresaActivaPrevia.current) return
    empresaActivaPrevia.current = empresaActivaId
    setPagina(1)
    setSeleccion(new Set())
    if (registrando || editando || rindiendoLote) {
      setRegistrando(false)
      setEditando(null)
      setRindiendoLote(false)
      setAviso({ titulo: AVISO_CAMBIO_EMPRESA, severidad: 'info' })
    }
  }, [listo, empresaActivaId, registrando, editando, rindiendoLote])

  // Cambiar la tienda del filtro también reinicia la selección (no se rinde algo que ya no se ve).
  const [clavePrevia, setClavePrevia] = useState(clave)
  if (clavePrevia !== clave) {
    setClavePrevia(clave)
    setSeleccion(new Set())
  }

  const isLoading = !listo || respondidaPara === undefined || respondidaPara !== clave
  const { envios, total } = datos
  const listado = useListadoAcumulado({ items: envios, pagina, setPagina, total, cargando, reinicio: clave })
  const falloTanda = error && pagina > 1
  const filas = listado.filas
  const hayFiltro = empresaId !== null && empresaId !== empresaActivaId

  // Página fuera de rango (p. ej. se rindió lo último de la última tanda): vuelve a la primera.
  useEffect(() => {
    if (!isLoading && !cargando && !error && envios.length === 0 && pagina > 1) setPagina(1)
  }, [isLoading, cargando, error, envios.length, pagina])

  const rendibles = filas.filter(esRendible)
  const puedeRendirAlguno = filas.some((e) => e.puede_rendir)
  const elegidos = filas.filter((e) => seleccion.has(e.id))
  const todosElegidos = rendibles.length > 0 && rendibles.every((e) => seleccion.has(e.id))

  const alternar = (id: string) => setSeleccion((actual) => {
    const nueva = new Set(actual)
    if (nueva.has(id)) nueva.delete(id)
    else nueva.add(id)
    return nueva
  })
  const alternarTodos = () => setSeleccion(todosElegidos ? new Set() : new Set(rendibles.map((e) => e.id)))

  const avisarRendicion = (resultado: ResultadoRendicion) => {
    if (resultado.cantidad === 0) {
      setAviso({ titulo: 'Esas entregas ya estaban rendidas.', severidad: 'info' })
    } else {
      setAviso({
        titulo: 'Entrega rendida',
        descripcion: `${resultado.cantidad} ${resultado.cantidad === 1 ? 'entrega' : 'entregas'}${resultado.mensajero ? ` de ${resultado.mensajero}` : ''} · total ${formatearImporteHistorial(resultado.total_abono)}`,
        severidad: 'success',
      })
    }
    recargarDesdeInicio()
  }

  const rendirFila = async (envio: EnvioMoto) => {
    // La llave ya viene deshabilitada; esto lo garantiza también ante un clic que se cuele.
    if (rindiendoFila !== null || !esRendible(envio)) return
    setRindiendoFila(envio.id)
    try {
      avisarRendicion(await rendirEnviosMoto([envio.id]))
    } catch (falla) {
      setAviso({ titulo: mensajeDeErrorRendicion(falla, 'No pudimos rendir la entrega. Intentá de nuevo.'), severidad: 'error' })
    } finally {
      setRindiendoFila(null)
    }
  }

  const columnas: ColumnaAdaptable<EnvioMoto>[] = [
    ...(puedeRendirAlguno ? [{
      clave: 'seleccion',
      // Sin texto visible: el «seleccionar todo» va en el encabezado de la columna (ver `seleccionEnCabecera`).
      encabezado: '',
      render: (e: EnvioMoto) => (
        <Checkbox
          checked={seleccion.has(e.id)}
          onChange={() => alternar(e.id)}
          disabled={!esRendible(e)}
          slotProps={{ input: { 'aria-label': `Seleccionar ${e.comprobante_numero} de ${e.mensajero.trim()}` } }}
        />
      ),
    }] : []),
    { clave: 'fecha', encabezado: 'Fecha', render: (e) => fechaCorta(e.fecha) },
    { clave: 'empresa', encabezado: 'Tienda', render: (e) => <EtiquetaEstado texto={e.empresa} variante="contorno" /> },
    {
      clave: 'comprobante',
      encabezado: 'Comprobante',
      render: (e) => (
        <Link component={RouterLink} to={`/ventas/comprobantes/${e.comprobante_id}`} underline="hover" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
          {e.comprobante_numero}
        </Link>
      ),
    },
    { clave: 'cliente', encabezado: 'Cliente', render: (e) => <Typography component="span" sx={{ fontWeight: 600 }}>{e.cliente ?? '—'}</Typography> },
    { clave: 'mensajero', encabezado: 'Mensajero', render: (e) => e.mensajero },
    { clave: 'guia', encabezado: 'Guía', render: (e) => e.guia ?? '—' },
    { clave: 'costo', encabezado: 'Costo de envío', align: 'right', render: (e) => formatearImporteHistorial(e.costo_envio) },
    { clave: 'abono', encabezado: 'Abona al recibir', align: 'right', render: (e) => (e.abono > 0 ? <b>{formatearImporteHistorial(e.abono)}</b> : '—') },
    {
      clave: 'enviado',
      encabezado: 'Enviado',
      render: (e) => <EtiquetaEstado texto={e.enviado ? 'Enviado' : 'Por enviar'} variante={e.enviado ? 'exito' : 'neutral'} />,
    },
    {
      clave: 'rendido',
      encabezado: 'Rendido',
      render: (e) => (
        // La llave se enciende una vez y no se apaga (la reversión queda fuera de alcance). Solo el
        // Administrador de la tienda la usa, y solo sobre lo enviado y sin rendir.
        <Switch
          checked={e.rendido}
          disabled={!esRendible(e) || rindiendoFila !== null}
          onChange={() => void rendirFila(e)}
          slotProps={{ input: { role: 'switch', 'aria-label': `Rendido · ${e.comprobante_numero}` } }}
        />
      ),
    },
  ]

  const acciones = (e: EnvioMoto) => (e.puede_editar ? (
    <Button
      size="small"
      variant="outlined"
      disabled={e.rendido}
      aria-label={`Editar ${e.comprobante_numero}`}
      onClick={() => { setAviso(null); setEditando(e) }}
    >
      Editar
    </Button>
  ) : null)
  const hayAcciones = filas.some((e) => e.puede_editar)

  const botonRegistrar = puedeRegistrar
    ? <Button variant="contained" onClick={() => { setAviso(null); setRegistrando(true) }}>Registrar envío</Button>
    : undefined

  const entregas = resumen?.entregas ?? 0
  const sinDatos = !cargandoResumen && !resumen

  return (
    <Stack spacing={2}>
      <Tarjeta
        id="tarjeta-motos-sin-rendir"
        titulo="Motos sin rendir"
        valor={cargandoResumen || !resumen ? '—' : formatearImporteHistorial(resumen.monto)}
        detalle={cargandoResumen ? 'Cargando…' : sinDatos ? 'Sin datos' : `${entregas} ${entregas === 1 ? 'entrega' : 'entregas'}`}
        color={tokens.color.alerta.aviso.icono}
      />

      {aviso ? (
        <Alert severity={aviso.severidad} role={aviso.severidad === 'error' ? 'alert' : 'status'} onClose={() => setAviso(null)}>
          <Typography component="p" fontWeight={600}>{aviso.titulo}</Typography>
          {aviso.descripcion ? <Box component="span">{aviso.descripcion}</Box> : null}
        </Alert>
      ) : null}

      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
        {botonRegistrar}
        {puedeRendirAlguno ? (
          <Button
            variant="outlined"
            disabled={elegidos.length === 0}
            onClick={() => { setAviso(null); setRindiendoLote(true) }}
          >
            {elegidos.length > 0 ? `Rendir seleccionados (${elegidos.length})` : 'Rendir seleccionados'}
          </Button>
        ) : null}
        <Box sx={{ flexGrow: 1 }} />
        <Typography component="span" variant="s">
          {isLoading || error ? '' : `${total} ${total === 1 ? 'envío' : 'envíos'} en moto`}
        </Typography>
      </Stack>

      {cargando && !isLoading && pagina === 1 ? <LinearProgress aria-label="Actualizando envíos en moto" sx={{ height: ALTO_BARRA_CARGA }} /> : null}

      <Box aria-busy={cargando}>
        {isLoading ? (
          <EstadoCargaPagina />
        ) : error && !falloTanda ? (
          <EstadoError descripcion="No pudimos cargar los envíos en moto." reintentar={() => void cargar()} />
        ) : filas.length === 0 && pagina === 1 ? (
          hayFiltro ? (
            <EstadoVacio titulo="Sin resultados" descripcion="Esa tienda no tiene envíos en moto." />
          ) : (
            <EstadoVacio
              titulo="Todavía no hay envíos en moto."
              descripcion={puedeRegistrar ? 'Registrá el primero para llevar su costo y su rendición.' : undefined}
              accion={botonRegistrar}
            />
          )
        ) : (
          <>
            <ContenidoAdaptable
              items={filas}
              columnas={columnas}
              obtenerClave={(e) => e.id}
              etiquetaTabla="Envíos en moto"
              acciones={hayAcciones ? acciones : undefined}
              seleccionEnCabecera={puedeRendirAlguno ? (
                <Checkbox
                  checked={todosElegidos}
                  indeterminate={!todosElegidos && elegidos.length > 0}
                  disabled={rendibles.length === 0}
                  onChange={alternarTodos}
                  slotProps={{ input: { 'aria-label': 'Seleccionar todos' } }}
                />
              ) : undefined}
            />
            <CargaInfinita
              hayMas={listado.hayMas}
              cargando={listado.cargandoMas}
              hayError={falloTanda}
              onCargarMas={falloTanda ? () => void cargar() : listado.cargarMas}
            />
          </>
        )}
      </Box>

      {puedeRegistrar && registrando ? (
        <EnvioMotoDialog
          open
          empresaId={empresaId}
          onCerrar={() => setRegistrando(false)}
          onGuardado={() => {
            setRegistrando(false)
            setAviso({ titulo: 'Envío registrado', severidad: 'success' })
            recargarDesdeInicio()
          }}
        />
      ) : null}
      {editando ? (
        <EnvioMotoDialog
          open
          envio={editando}
          empresaId={empresaId}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null)
            setAviso({ titulo: 'Envío actualizado', severidad: 'success' })
            recargarDesdeInicio()
          }}
          onRecargar={() => { setEditando(null); recargarDesdeInicio() }}
        />
      ) : null}
      {rindiendoLote ? (
        <RendicionMotosDialog
          open
          envios={elegidos}
          onCerrar={() => setRindiendoLote(false)}
          onRendido={(resultado) => {
            setRindiendoLote(false)
            avisarRendicion(resultado)
          }}
        />
      ) : null}
    </Stack>
  )
}
