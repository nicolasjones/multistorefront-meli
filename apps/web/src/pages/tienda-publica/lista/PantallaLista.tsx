import { Alert, Box, Button, Typography } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link as EnlaceRuta } from 'react-router'
import { EstadoCargaPagina, EstadoVacio } from '../../../components/estados/EstadosPagina'
import { useCapacidadesTienda } from '../../../hooks/useCapacidadesTienda'
import { useListaPedido } from '../../../hooks/useListaPedido'
import { useSesionClienteDetallada } from '../../../hooks/useSesionCliente'
import { urlsImagenesProducto } from '../../../lib/imagenProducto'
import { leerLista } from '../../../lib/listaPedido'
import { minutosDeEspera } from '../../../lib/tiendaContacto'
import { formatearPrecioArs } from '../../../lib/tiendaListado'
import {
  enviarListaPedido,
  ErrorListaPedido,
  MENSAJES_PEDIDO,
  nuevaClavePedido,
  ORDEN_CAMPOS_PEDIDO,
  revalidarLista,
  validarPedido,
  type CampoPedido,
  type DatosPedido,
  type ErroresPedido,
  type ListaRevalidada,
} from '../../../lib/tiendaPedido'
import { ErrorConReintento } from '../ErrorConReintento'
import { LINEA_SUAVE } from '../layout/medidas'
import { MigasTienda } from '../layout/MigasTienda'
import { PaginaNoEncontrada } from '../PaginaNoEncontrada'
import { CabeceraSeo } from '../seo/CabeceraSeo'
import { ConfirmacionPedido } from './ConfirmacionPedido'
import { FormularioPedido } from './FormularioPedido'
import { LineaLista, LineaNoDisponible } from './LineaLista'

export const LEYENDA_PRECIOS_REFERENCIA = 'Precios de referencia: se confirman al responder. Este pedido no reserva stock ni es una compra.'
export const TEXTO_ERROR_ENVIO = 'No pudimos enviar tu pedido. Tu lista sigue acá: probá de nuevo.'
export const TEXTO_REVISAR_LISTA = 'Revisá tu lista: hay productos que no se pueden enviar'
export const TEXTO_CUENTA_INACTIVA_LISTA = 'Tu cuenta no está activa en esta tienda.'
export const TEXTO_ALMACENAMIENTO_BLOQUEADO = 'Tu navegador no nos deja guardar la lista: se conserva mientras no cierres esta página.'

const VACIO: DatosPedido = { nombre: '', contacto: '', nota: '' }
const textoProductos = (n: number) => `${n} ${n === 1 ? 'producto' : 'productos'}`

type AvisoEnvio =
  | { tipo: 'espera'; segundos: number; hasta: number }
  | { tipo: 'falla' }
  | { tipo: 'revision' }
  | { tipo: 'items' }
  | { tipo: 'cuenta_inactiva' }

type Revision =
  | { fase: 'cargando' }
  | { fase: 'error' }
  | { fase: 'lista'; datos: ListaRevalidada }

// `/lista` (MSF-176, B1, FR-021 a FR-033, P-4 y P-5): la lista de pedido del navegador, revalidada por el servidor al abrirla y antes de enviar, con el formulario de envío. Sin pagar ni
// reservar nada: el pedido llega a Consultas. Ante cualquier error la lista se CONSERVA. Una sola petición en vuelo; la `clave_envio` se genera al abrir el envío y se reutiliza en los
// reintentos del mismo contenido. Con la función apagada es la 404 de la tienda; mientras se resuelve la función solo carga.
export function PantallaLista({ host }: { host: string }) {
  const capacidades = useCapacidadesTienda(host, host !== '')
  const lista = useListaPedido(host)
  const sesion = useSesionClienteDetallada(host, capacidades.fase === 'lista' && capacidades.pedidos)
  const [revision, setRevision] = useState<Revision>({ fase: 'cargando' })
  const [intento, setIntento] = useState(0)
  const [datos, setDatos] = useState<DatosPedido>(VACIO)
  const [errores, setErrores] = useState<ErroresPedido>({})
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState<AvisoEnvio | null>(null)
  const [confirmado, setConfirmado] = useState<{ conCuenta: boolean } | null>(null)
  const [forzarVisitante, setForzarVisitante] = useState(false)
  const [esperando, setEsperando] = useState(false)
  const [imagenes, setImagenes] = useState<Record<string, string>>({})
  const [renovadas, setRenovadas] = useState<Record<string, string>>({})
  const titulo = useRef<HTMLHeadingElement | null>(null)
  const campos = useRef<Partial<Record<CampoPedido, HTMLInputElement | HTMLTextAreaElement | null>>>({})
  const enviandoAhora = useRef(false)
  const clave = useRef<{ valor: string; firma: string } | null>(null)
  const primeraRevision = useRef(true)
  const nombresVistos = useRef(new Map<string, string>())
  const renovando = useRef(new Set<string>())

  const encendida = capacidades.fase === 'lista' && capacidades.pedidos
  const firmaLista = JSON.stringify(lista.lineas)

  // Revalidación (FR-023): al abrir la lista y cuando cambia su contenido (las cantidades con una pequeña espera, para no pedir en cada tecla). Última petición gana.
  useEffect(() => {
    if (!encendida || confirmado || lista.lineas.length === 0) return
    let cancelada = false
    const lineas = lista.lineas
    const pedir = () => {
      revalidarLista(host, lineas)
        .then((datosServidor) => {
          if (cancelada) return
          for (const linea of datosServidor.lineas) nombresVistos.current.set(linea.productoId, linea.nombre)
          setRevision({ fase: 'lista', datos: datosServidor })
        })
        .catch((error: unknown) => {
          if (cancelada) return
          if (!(error instanceof ErrorListaPedido)) console.error('No se pudo revisar la lista', error instanceof Error ? error.message : error)
          setRevision((actual) => (actual.fase === 'lista' ? actual : { fase: 'error' }))
        })
    }
    const espera = primeraRevision.current ? 0 : 500
    primeraRevision.current = false
    const temporizador = setTimeout(pedir, espera)
    return () => { cancelada = true; clearTimeout(temporizador) }
    // `firmaLista` resume el contenido de la lista; `intento` fuerza una revalidación.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encendida, host, firmaLista, intento, confirmado])

  // Al entrar (y al pasar de «cargando» a la pantalla) el foco va al título.
  useEffect(() => {
    if (encendida && !confirmado) titulo.current?.focus()
  }, [encendida, confirmado])

  // Fotos: se firman las rutas de las líneas revalidadas; una URL vencida se renueva una sola vez por imagen.
  const rutas = revision.fase === 'lista' ? revision.datos.lineas.flatMap((linea) => (linea.imagen ? [linea.imagen] : [])) : []
  const firmaRutas = JSON.stringify(rutas)
  useEffect(() => {
    if (rutas.length === 0) return
    let cancelada = false
    void urlsImagenesProducto(rutas).then((urls) => { if (!cancelada) setImagenes((previas) => ({ ...previas, ...urls })) })
    return () => { cancelada = true }
    // `firmaRutas` resume las rutas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmaRutas])
  const renovarImagen = useCallback((ruta: string) => {
    if (renovando.current.has(ruta)) return
    renovando.current.add(ruta)
    void urlsImagenesProducto([ruta]).then((urls) => { if (urls[ruta]) setRenovadas((previas) => ({ ...previas, [ruta]: urls[ruta] })) })
  }, [])

  // Pasado el tiempo de espera de `limite`, el botón vuelve a habilitarse.
  useEffect(() => {
    if (aviso?.tipo !== 'espera') return
    setEsperando(true)
    const temporizador = setTimeout(() => setEsperando(false), Math.max(0, aviso.hasta - Date.now()))
    return () => clearTimeout(temporizador)
  }, [aviso])

  if (host === '' || capacidades.fase === 'cargando') {
    return <Box sx={{ py: 2 }}><CabeceraSeo noindex pagina="Mi lista" /><EstadoCargaPagina etiqueta="Cargando tu lista" /></Box>
  }
  if (capacidades.fase === 'error') {
    return <Box sx={{ py: 2 }}><CabeceraSeo noindex pagina="Mi lista" /><ErrorConReintento titulo="No pudimos cargar esta página." alReintentar={capacidades.reintentar} /></Box>
  }
  if (!capacidades.pedidos) return <PaginaNoEncontrada />
  if (confirmado) {
    return <Box><CabeceraSeo noindex pagina="Mi lista" /><ConfirmacionPedido conCuenta={confirmado.conCuenta} /></Box>
  }

  const datosServidor = revision.fase === 'lista' ? revision.datos : null
  const conCuenta = !forzarVisitante && (datosServidor ? datosServidor.conCuenta : sesion.estado === 'activa')
  const porId = new Map(datosServidor?.lineas.map((linea) => [linea.productoId, linea]) ?? [])
  const noDisponibles = new Set(datosServidor?.noDisponibles ?? [])
  const visibles = lista.lineas.filter((linea) => porId.has(linea.productoId))
  const agotadas = lista.lineas.filter((linea) => noDisponibles.has(linea.productoId) && !porId.has(linea.productoId))
  const conPrecio = visibles.filter((linea) => porId.get(linea.productoId)?.precioUnitario != null)
  const total = conPrecio.reduce((suma, linea) => suma + (porId.get(linea.productoId)?.precioUnitario ?? 0) * linea.cantidad, 0)
  const sinProductos = visibles.length === 0 && agotadas.length === 0
  const hayLista = lista.lineas.length > 0

  const cambiarDato = (campo: CampoPedido, valor: string) => {
    setDatos((actuales) => ({ ...actuales, [campo]: valor }))
    setErrores((actuales) => ({ ...actuales, [campo]: undefined }))
    // Otro texto es otro envío: no reutiliza la clave de un intento anterior.
    if (aviso?.tipo === 'falla' || aviso?.tipo === 'espera' || aviso?.tipo === 'revision') setAviso(null)
  }
  // Al salir de un campo se valida ese campo (el error aparece y se corrige sin esperar al envío).
  const salirDeCampo = (campo: CampoPedido) => {
    const error = validarPedido(datos, conCuenta)[campo]
    setErrores((actuales) => ({ ...actuales, [campo]: error }))
  }
  const enfocarPrimero = (e: ErroresPedido) => {
    const primero = ORDEN_CAMPOS_PEDIDO.find((campo) => e[campo])
    if (primero) campos.current[primero]?.focus()
  }

  const enviar = async () => {
    if (enviandoAhora.current) return
    const erroresNuevos = validarPedido(datos, conCuenta)
    setErrores(erroresNuevos)
    if (Object.keys(erroresNuevos).length > 0) { enfocarPrimero(erroresNuevos); return }
    enviandoAhora.current = true
    setEnviando(true)
    setAviso(null)
    try {
      // Antes de enviar se revalida otra vez (FR-023): lo que ya no está disponible se saca de la lista y no se manda.
      let fresca: ListaRevalidada
      try {
        fresca = await revalidarLista(host, lista.lineas)
      } catch (error) {
        // Si la que falla es la REVISIÓN de la lista (también por exceso de lecturas) el texto es el de la revisión, no el de «varios envíos seguidos».
        setAviso({ tipo: 'revision' })
        return
      }
      setRevision({ fase: 'lista', datos: fresca })
      if (fresca.noDisponibles.length > 0) lista.quitarVarios(fresca.noDisponibles)
      const aEnviar = leerLista(host)
      if (aEnviar.length === 0) return
      const firma = JSON.stringify([aEnviar, datos, conCuenta])
      if (!clave.current || clave.current.firma !== firma) clave.current = { valor: nuevaClavePedido(), firma }
      const resultado = await enviarListaPedido(host, datos, aEnviar, clave.current.valor)
      switch (resultado.estado) {
        case 'exito':
          lista.vaciar()
          setConfirmado({ conCuenta })
          return
        case 'espera':
          setAviso({ tipo: 'espera', segundos: resultado.esperaSegundos, hasta: Date.now() + resultado.esperaSegundos * 1000 })
          return
        case 'invalido': {
          if (resultado.campos.includes('items')) {
            if (resultado.noDisponibles.length > 0) lista.quitarVarios(resultado.noDisponibles)
            setIntento((n) => n + 1)
            setAviso({ tipo: 'items' })
            return
          }
          if (conCuenta && (resultado.campos.includes('nombre') || resultado.campos.includes('contacto'))) {
            // El servidor ya no ve una cuenta activa: la pantalla se comporta como visitante.
            setForzarVisitante(true)
            setAviso({ tipo: 'cuenta_inactiva' })
            return
          }
          const delServidor: ErroresPedido = {}
          for (const campo of resultado.campos) if (campo !== 'items') delServidor[campo] = MENSAJES_PEDIDO[campo]
          setErrores(delServidor)
          enfocarPrimero(delServidor)
          return
        }
        default:
          setAviso({ tipo: 'falla' })
      }
    } finally {
      enviandoAhora.current = false
      setEnviando(false)
    }
  }

  return (
    <Box sx={{ pb: 4 }}>
      <CabeceraSeo noindex pagina="Mi lista" />
      <MigasTienda items={[{ texto: 'Inicio', a: '/' }, { texto: 'Mi lista' }]} />
      <Typography ref={titulo} tabIndex={-1} component="h1" variant="h4" sx={{ outline: 'none', overflowWrap: 'anywhere' }}>Mi lista de pedido</Typography>
      <Typography color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>Armá tu pedido y mandalo sin pagar: te respondemos para confirmar disponibilidad y precio.</Typography>
      <Alert severity="info" sx={{ mb: 2 }}>{LEYENDA_PRECIOS_REFERENCIA}</Alert>
      {lista.bloqueado ? <Alert severity="info" sx={{ mb: 2 }}>{TEXTO_ALMACENAMIENTO_BLOQUEADO}</Alert> : null}
      {!hayLista ? (
        <EstadoVacio
          titulo="Tu lista está vacía"
          descripcion="Agregá productos desde el catálogo para armar tu pedido."
          accion={<Button component={EnlaceRuta} to="/catalogo" color="inherit">Ver catálogo</Button>}
        />
      ) : (
        <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 7fr) minmax(0, 5fr)' }, alignItems: 'start' }}>
          <Box sx={{ minWidth: 0 }}>
            {agotadas.length > 0 ? (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {agotadas.length === 1 ? '1 producto de tu lista ya no está disponible. No lo vamos a enviar.' : `${agotadas.length} productos de tu lista ya no están disponibles. No los vamos a enviar.`}
              </Alert>
            ) : null}
            {revision.fase === 'cargando' ? <EstadoCargaPagina etiqueta="Revisando tu lista" /> : null}
            {revision.fase === 'error' ? <ErrorConReintento titulo="No pudimos revisar tu lista." descripcion="Revisá tu conexión y probá de nuevo." alReintentar={() => { setRevision({ fase: 'cargando' }); setIntento((n) => n + 1) }} /> : null}
            {datosServidor ? (
              <>
                {visibles.length > 0 ? (
                  <Box component="ul" aria-label="Productos de tu lista" sx={{ listStyle: 'none', m: 0, p: 0, borderTop: LINEA_SUAVE }}>
                    {visibles.map((linea) => {
                      const revalidada = porId.get(linea.productoId)
                      if (!revalidada) return null
                      const imagen = revalidada.imagen
                      return (
                        <LineaLista
                          key={linea.productoId}
                          linea={revalidada}
                          cantidad={linea.cantidad}
                          imagenUrl={imagen ? renovadas[imagen] ?? imagenes[imagen] ?? null : null}
                          alRenovarImagen={imagen ? () => renovarImagen(imagen) : undefined}
                          mostrarEscala={datosServidor.conCuenta && datosServidor.tipo === 'mayorista'}
                          alCambiarCantidad={(cantidad) => lista.fijar(linea.productoId, cantidad)}
                          alQuitar={() => lista.quitar(linea.productoId)}
                        />
                      )
                    })}
                  </Box>
                ) : null}
                {agotadas.length > 0 ? (
                  <Box component="section" aria-labelledby="lista-no-disponibles" sx={{ mt: 3 }}>
                    <Typography id="lista-no-disponibles" component="h2" variant="h6">No disponibles</Typography>
                    <Box component="ul" aria-label="Productos no disponibles" sx={{ listStyle: 'none', m: 0, p: 0, borderTop: LINEA_SUAVE }}>
                      {agotadas.map((linea) => (
                        <LineaNoDisponible key={linea.productoId} nombre={nombresVistos.current.get(linea.productoId) ?? null} alQuitar={() => lista.quitar(linea.productoId)} />
                      ))}
                    </Box>
                  </Box>
                ) : null}
                {sinProductos ? <Typography color="text.secondary">Ninguno de los productos de tu lista está disponible.</Typography> : null}
              </>
            ) : null}
          </Box>
          <Box sx={{ minWidth: 0, position: { md: 'sticky' }, top: { md: (tema) => tema.spacing(2) }, border: LINEA_SUAVE, borderRadius: '8px', p: 2 /* estilos-sueltos: ok */ }}>
            <Typography component="h2" variant="h6" sx={{ mb: 1 }}>Resumen y envío</Typography>
            <Typography data-testid="resumen-cantidad">{textoProductos(visibles.length)}</Typography>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mt: 0.5, mb: 2 }}>
              <Typography color="text.secondary" component="span">
                {conPrecio.length < visibles.length ? 'Total de referencia (sin los productos con precio a confirmar)' : 'Total de referencia'}
              </Typography>
              <Typography component="span" sx={{ fontWeight: 700 }} data-testid="total-referencia">{conPrecio.length > 0 ? formatearPrecioArs(total) : '—'}</Typography>
            </Box>
            {aviso?.tipo === 'espera' ? (
              <Alert severity="warning" sx={{ mb: 2 }} data-testid="aviso-limite">
                Hiciste varios envíos seguidos. Probá de nuevo en {minutosDeEspera(aviso.segundos)} {minutosDeEspera(aviso.segundos) === 1 ? 'minuto' : 'minutos'}.
              </Alert>
            ) : null}
            {aviso?.tipo === 'falla' ? (
              <Alert severity="error" sx={{ mb: 2, alignItems: 'center' }} action={<Button color="inherit" onClick={() => { void enviar() }} sx={{ minHeight: (tema) => tema.spacing(5.5) }}>Reintentar</Button>}>
                {TEXTO_ERROR_ENVIO}
              </Alert>
            ) : null}
            {aviso?.tipo === 'revision' ? (
              <Alert severity="error" sx={{ mb: 2, alignItems: 'center' }} action={<Button color="inherit" onClick={() => { void enviar() }} sx={{ minHeight: (tema) => tema.spacing(5.5) }}>Reintentar</Button>}>
                No pudimos revisar tu lista. Revisá tu conexión y probá de nuevo.
              </Alert>
            ) : null}
            {aviso?.tipo === 'items' ? <Alert severity="warning" sx={{ mb: 2 }}>{TEXTO_REVISAR_LISTA}</Alert> : null}
            {aviso?.tipo === 'cuenta_inactiva' ? <Alert severity="warning" sx={{ mb: 2 }}>{TEXTO_CUENTA_INACTIVA_LISTA}</Alert> : null}
            <FormularioPedido
              host={host}
              conCuenta={conCuenta}
              datos={datos}
              errores={errores}
              enviando={enviando}
              enviarDeshabilitado={revision.fase !== 'lista' || visibles.length === 0 || esperando}
              alCambiar={cambiarDato}
              alSalir={salirDeCampo}
              alEnviar={() => { void enviar() }}
              refs={(campo, el) => { campos.current[campo] = el }}
            />
          </Box>
        </Box>
      )}
    </Box>
  )
}
