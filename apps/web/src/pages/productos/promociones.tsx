import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, Stack, Tooltip, Typography } from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { useEmpresasAccesibles } from '../../hooks/useEmpresasAccesibles'
import { useOrganizacionActiva } from '../../hooks/useOrganizacionActiva'
import { useCapacidadesPrecios } from '../../hooks/useCapacidadesPrecios'
import { MOTIVO_PROMOCIONES_APAGADAS } from '../../lib/capacidadesPrecios'
import { supabaseClient } from '../../lib/supabase'
import {
  AVISO_ELEGIR_EMPRESA,
  ETIQUETA_ESTADO,
  anularPromocion,
  formatearFechaHoraPromocion,
  formatearPesosPromocion,
  guardarPromocion,
  leerPromociones,
  type DatosPromocion,
  type EstadoPromocion,
  type Promocion,
} from '../../lib/promociones'
import { EtiquetaEstado, type VarianteEtiqueta } from '../../components/base/EtiquetaEstado'
import { AnularPromocionDialogo, FormularioPromocion } from '../../components/promociones/FormularioPromocion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

const VARIANTE_ESTADO: Record<EstadoPromocion, VarianteEtiqueta> = {
  vigente: 'exito',
  programada: 'info',
  vencida: 'neutral',
  anulada: 'contorno',
}

const MOTIVO_SIN_EDICION_EN_TIENDA = 'Solo podés ver las promociones de esta tienda: no tenés permiso de edición de productos en ella.'
const AVISO_CAMBIO_EMPRESA = 'Cambiaste de empresa: cerramos el formulario para no mezclar datos de la anterior.'

// Catálogo → Promociones (F-PRE-11, FR-016): precio promocional fijo (sin IVA) de un producto en una
// empresa, con fecha de inicio y fin. Respeta la empresa activa de la barra superior (Principio VIII):
// con una empresa concreta lista y crea para ella; con «Todas mis empresas» lista todas (columna Empresa)
// y el alta queda deshabilitada. Al cambiar de empresa recarga TODO, cierra los diálogos con aviso y no
// arrastra filas de la anterior. Los estados salen de la base (por fecha, sin tarea programada); la
// autoridad es RLS + las RPC (`productos` = edición EN LA TIENDA de la promoción para escribir). MSF-363: con la bandera
// `promociones_precio` apagada (por defecto) la pantalla no lista ni ofrece nada y explica el motivo; el permiso de
// edición se calcula por tienda (`capacidades_precios`), no con el nivel global.
export function PromocionesList() {
  const { nivel, isLoading: verificandoPermiso } = useNivelSeccion('productos')
  const { capacidades, cargando: cargandoCapacidades, hayError: errorCapacidades } = useCapacidadesPrecios()
  // Nivel global: decide si se ofrece algo; el de cada tienda decide si el botón funciona.
  const puedeEditar = !verificandoPermiso && nivel === 'edicion'
  const puedeEditarEn = (empresaId: string | null) =>
    puedeEditar && empresaId !== null && capacidades.nivelesProductos[empresaId] === 'edicion'
  const { empresas, empresaActivaId, isLoading: cargandoEmpresas } = useEmpresasAccesibles()
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const [promociones, setPromociones] = useState<Promocion[] | null>(null)
  const [hayError, setHayError] = useState(false)
  const [aviso, setAviso] = useState<{ severidad: 'error' | 'warning' | 'success'; texto: string } | null>(null)
  const [edicion, setEdicion] = useState<{ promocion: Promocion | null } | null>(null)
  const [anulando, setAnulando] = useState<Promocion | null>(null)
  const ultimaPeticion = useRef(0)
  const dialogoAbierto = useRef(false)
  useEffect(() => {
    dialogoAbierto.current = edicion !== null || anulando !== null
  }, [edicion, anulando])

  const empresaActiva = empresas.find((empresa) => empresa.id === empresaActivaId) ?? null
  const todasMisEmpresas = empresaActivaId === null

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setHayError(false)
    try {
      const resultado = await leerPromociones(supabaseClient, empresaActivaId)
      if (peticion === ultimaPeticion.current) setPromociones(resultado)
    } catch (error) {
      console.error('No pudimos cargar las promociones.', error)
      if (peticion === ultimaPeticion.current) setHayError(true)
    }
  }, [empresaActivaId])

  // Principio VIII: cambió la empresa (o la organización) de la barra superior. Se descartan las filas
  // de la anterior, se cierran los diálogos (con aviso si había uno abierto) y se vuelve a cargar.
  useEffect(() => {
    ultimaPeticion.current++
    setPromociones(null)
    setHayError(false)
    if (dialogoAbierto.current) setAviso({ severidad: 'warning', texto: AVISO_CAMBIO_EMPRESA })
    else setAviso(null)
    setEdicion(null)
    setAnulando(null)
  }, [empresaActivaId, organizacionId])

  useEffect(() => {
    void cargar()
  }, [cargar, organizacionId])

  const guardar = async (datos: DatosPromocion) => {
    await guardarPromocion(supabaseClient, datos)
    setEdicion(null)
    setAviso({ severidad: 'success', texto: datos.id ? 'Promoción actualizada.' : 'Promoción programada.' })
    await cargar()
  }

  const confirmarAnular = async () => {
    if (!anulando) return
    await anularPromocion(supabaseClient, anulando)
    setAnulando(null)
    setAviso({ severidad: 'success', texto: 'Promoción anulada.' })
    await cargar()
  }

  const columnas = useMemo<ColumnaAdaptable<Promocion>[]>(() => {
    const base: ColumnaAdaptable<Promocion>[] = [
      {
        clave: 'producto',
        encabezado: 'Producto',
        render: (p) => (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{p.productoNombre}</Typography>
            {p.productoSku ? <Typography variant="caption" color="text.secondary">{p.productoSku}</Typography> : null}
          </Box>
        ),
      },
    ]
    if (todasMisEmpresas) base.push({ clave: 'empresa', encabezado: 'Empresa', render: (p) => p.empresaNombre })
    base.push(
      { clave: 'normal', encabezado: 'Precio normal', align: 'right', render: (p) => formatearPesosPromocion(p.precioNormal) },
      { clave: 'promocional', encabezado: 'Precio promocional', align: 'right', render: (p) => formatearPesosPromocion(p.precioPromocional) },
      { clave: 'desde', encabezado: 'Desde', render: (p) => formatearFechaHoraPromocion(p.desde) },
      { clave: 'hasta', encabezado: 'Hasta', render: (p) => formatearFechaHoraPromocion(p.hasta) },
      {
        clave: 'estado',
        encabezado: 'Estado',
        render: (p) => <EtiquetaEstado texto={ETIQUETA_ESTADO[p.estado]} variante={VARIANTE_ESTADO[p.estado]} />,
      },
    )
    return base
  }, [todasMisEmpresas])

  const accionesFila = (p: Promocion) => {
    const abierta = p.estado === 'programada' || p.estado === 'vigente'
    if (!puedeEditarEn(p.empresaId) || !abierta) return null
    return (
      <Stack direction="row" spacing={1} justifyContent="flex-end">
        {capacidades.promociones ? (
          <Button size="small" onClick={() => setEdicion({ promocion: p })} aria-label={`Editar la promoción de ${p.productoNombre}`}>Editar</Button>
        ) : null}
        <Button size="small" color="error" onClick={() => setAnulando(p)} aria-label={`Anular la promoción de ${p.productoNombre}`}>Anular</Button>
      </Stack>
    )
  }

  const altaDeshabilitada = todasMisEmpresas || cargandoEmpresas || !empresaActiva
  const sinEdicionEnTienda = !todasMisEmpresas && !cargandoEmpresas && !puedeEditarEn(empresaActivaId)
  const altaBloqueada = altaDeshabilitada || sinEdicionEnTienda
  const botonNueva = puedeEditar && capacidades.promociones ? (
    <Tooltip title={todasMisEmpresas ? AVISO_ELEGIR_EMPRESA : sinEdicionEnTienda ? MOTIVO_SIN_EDICION_EN_TIENDA : ''}>
      {/* El span deja que el tooltip responda aunque el botón esté deshabilitado. */}
      <span>
        <Button variant="contained" disabled={altaBloqueada} onClick={() => setEdicion({ promocion: null })}>Nueva promoción</Button>
      </span>
    </Tooltip>
  ) : undefined

  const contador = promociones === null ? '' : `${promociones.length} ${promociones.length === 1 ? 'promoción' : 'promociones'}${empresaActiva ? ` · ${empresaActiva.nombre}` : ''}`
  const empresaDelDialogo = edicion?.promocion
    ? { id: edicion.promocion.empresaId, nombre: edicion.promocion.empresaNombre }
    : empresaActiva
  const hayVigente = promociones?.some((p) => p.estado === 'vigente') ?? false

  if (cargandoCapacidades) {
    return (
      <Box>
        <EncabezadoPagina titulo="Promociones" contexto={<ContextoOrganizacionActiva />} />
        <ContenedorSeccion><EstadoCargaPagina /></ContenedorSeccion>
      </Box>
    )
  }

  return (
    <Box>
      <EncabezadoPagina titulo="Promociones" accion={botonNueva} contexto={<ContextoOrganizacionActiva />} />
      <ContenedorSeccion>
        <Stack spacing={2}>
          {!capacidades.promociones ? (
            <Alert severity={errorCapacidades ? 'warning' : 'info'}>
              {errorCapacidades
                ? 'No pudimos verificar si las promociones están activas. Por ahora solo podés anular.'
                : `${MOTIVO_PROMOCIONES_APAGADAS} Mientras tanto solo podés anular las que ya tengas.`}
            </Alert>
          ) : null}
          {aviso ? <Alert severity={aviso.severidad} onClose={() => setAviso(null)}>{aviso.texto}</Alert> : null}
          {capacidades.promociones && sinEdicionEnTienda && puedeEditar ? <Alert severity="info">{MOTIVO_SIN_EDICION_EN_TIENDA}</Alert> : null}
          {capacidades.promociones && todasMisEmpresas && puedeEditar ? <Alert severity="info">{AVISO_ELEGIR_EMPRESA} para crear una promoción.</Alert> : null}
          {hayError ? (
            <EstadoError descripcion="No pudimos cargar las promociones." reintentar={() => void cargar()} />
          ) : promociones === null ? (
            <EstadoCargaPagina />
          ) : promociones.length === 0 ? (
            <EstadoVacio
              titulo="Todavía no hay promociones."
              descripcion={capacidades.promociones && puedeEditar && !altaBloqueada ? 'Programá la primera con «Nueva promoción».' : undefined}
            />
          ) : (
            <>
              <BarraHerramientas
                contador={contador}
                ayuda="El precio promocional rige desde la fecha de inicio hasta la de fin, sin incluirla, y es fijo en pesos sin IVA: la tienda le suma el IVA si la empresa lo muestra. Vence solo, sin hacer nada."
              />
              {hayVigente ? <Typography variant="body2" color="text.secondary">Las promociones vigentes se ven ahora en la tienda con el precio anterior tachado.</Typography> : null}
              <ContenidoAdaptable
                items={promociones}
                columnas={columnas}
                obtenerClave={(p) => p.id}
                acciones={accionesFila}
                etiquetaTabla="Promociones de precio"
              />
            </>
          )}
        </Stack>
      </ContenedorSeccion>
      {edicion && empresaDelDialogo ? (
        <FormularioPromocion
          // Una clave por apertura y por empresa: el diálogo nace con los datos de la promoción elegida.
          key={`${edicion.promocion?.id ?? 'nueva'}:${empresaDelDialogo.id}`}
          promocion={edicion.promocion}
          empresaId={empresaDelDialogo.id}
          empresaNombre={empresaDelDialogo.nombre}
          onCancelar={() => setEdicion(null)}
          onGuardar={guardar}
        />
      ) : null}
      {anulando ? <AnularPromocionDialogo promocion={anulando} onCancelar={() => setAnulando(null)} onConfirmar={confirmarAnular} /> : null}
    </Box>
  )
}
