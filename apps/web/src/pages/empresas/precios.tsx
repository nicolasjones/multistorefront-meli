import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router'
import { useWarnAboutChange } from '@refinedev/core'
import { Box, Button, Stack } from '@mui/material'
import { useEmpresa } from '../../hooks/useEmpresa'
import { useEmpresasAccesibles } from '../../hooks/useEmpresasAccesibles'
import { useCotizacionInicial } from '../../hooks/useCotizacionInicial'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { usePreciosEmpresa, usePrevisualizacionPrecios } from '../../hooks/usePreciosEmpresa'
import {
  AVISO_REGLA_GUARDADA,
  type BaseRegla,
  type FilaPrevia,
  ajusteATexto,
  mensajeErrorRegla,
  parsearAjuste,
  validarAjuste,
} from '../../lib/precios'
import { EstadoCargaPagina, EstadoError, EstadoExito, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { ReglaPrecioEmpresa, type EjemploIva } from '../../components/precios/ReglaPrecioEmpresa'
import { TablaAsiQuedan } from '../../components/precios/TablaAsiQuedan'
import { PestanasEmpresa } from './PestanasEmpresa'

const ID_FORMULARIO = 'regla-precio-form'

// Primer producto de la muestra con neto y final distintos: el ejemplo del interruptor (FR-022).
// Todo viene del servidor; si ninguno tiene IVA calculable no se escribe un ejemplo inventado.
function ejemploIva(filas: FilaPrevia[] | null): EjemploIva | null {
  const fila = filas?.find((candidata) => candidata.netoArs !== null && candidata.finalArs !== null && candidata.finalArs !== candidata.netoArs)
  return fila ? { nombre: fila.nombre, netoArs: fila.netoArs as number, finalArs: fila.finalArs as number } : null
}

type Formulario = { clave: string; base: BaseRegla; ajuste: string; mostrarConIva: boolean }
type Accion = { empresaId: string | null; guardando: boolean; exito: boolean; error: string | null; conflicto: boolean; intento: boolean }
const ACCION_INICIAL: Accion = { empresaId: null, guardando: false, exito: false, error: null, conflicto: false, intento: false }

// Pestaña «Precios y moneda» de UNA empresa (F-PRE-07, FR-012…FR-014; StorePrecios.dc.html).
// La empresa es la de la ruta: al abrir otra, la regla, el formulario, la vista previa y los
// avisos se reinician (Constitución VIII). La autoridad es la base: acá no se recalcula nada.
export function EmpresaPrecios() {
  const { id } = useParams()
  const { nivel, isLoading: cargandoNivel } = useNivelSeccion('empresas')
  const { empresa, isLoading: cargandoEmpresa, isError: errorEmpresa, noEncontrada, refetch: recargarEmpresa } = useEmpresa(id)
  const { regla, cargando: cargandoRegla, hayError: errorRegla, recargar, guardar, esVigente } = usePreciosEmpresa(id)
  const { cotizacion, cargando: cargandoCotizacion, hayError: errorCotizacion } = useCotizacionInicial()
  const { empresas: accesibles } = useEmpresasAccesibles()
  const { setWarnWhen } = useWarnAboutChange()

  const [formulario, setFormulario] = useState<Formulario | null>(null)
  const [estadoAccion, setEstadoAccion] = useState<Accion>(ACCION_INICIAL)
  const accion = estadoAccion.empresaId === (id ?? null) ? estadoAccion : ACCION_INICIAL

  // El formulario se (re)carga con cada regla leída o guardada de ESTA empresa.
  const clave = regla && id ? `${id}|${regla.actualizadoEn ?? 'sin-regla'}` : null
  if (regla && clave && formulario?.clave !== clave) {
    setFormulario({ clave, base: regla.base, ajuste: ajusteATexto(regla.ajustePct), mostrarConIva: regla.mostrarConIva })
  }
  const actual = formulario && formulario.clave === clave ? formulario : null

  const soloLectura = nivel !== 'edicion'
  const sinGuardar =
    regla !== null &&
    actual !== null &&
    (actual.base !== regla.base ||
      (actual.base === 'central_ajuste' && parsearAjuste(actual.ajuste) !== regla.ajustePct) ||
      actual.mostrarConIva !== regla.mostrarConIva)
  useEffect(() => {
    setWarnWhen(sinGuardar)
    return () => setWarnWhen(false)
  }, [sinGuardar, setWarnWhen])

  const previa = usePrevisualizacionPrecios(id, actual?.base ?? 'central', actual?.ajuste ?? '0', actual !== null)

  const envolver = (contenido: ReactNode, acciones?: ReactNode) => (
    <Box>
      <EncabezadoPagina
        titulo={empresa?.nombre ?? 'Empresa'}
        contexto={<ContextoOrganizacionActiva />}
        accion={acciones}
        pestanas={id ? <PestanasEmpresa empresaId={id} activa="precios" /> : undefined}
      />
      <ContenedorSeccion>{contenido}</ContenedorSeccion>
    </Box>
  )

  if (cargandoNivel || cargandoEmpresa) return envolver(<EstadoCargaPagina />)
  if (errorEmpresa) return envolver(<EstadoError descripcion="No pudimos cargar la empresa." reintentar={() => void recargarEmpresa()} />)
  if (noEncontrada || !empresa) {
    return envolver(<EstadoError titulo="Empresa no encontrada" descripcion="No existe o no pertenece a tu organización." />)
  }
  if (errorRegla) return envolver(<EstadoError descripcion="No pudimos cargar los precios de la empresa." reintentar={() => void recargar()} />)
  if (cargandoRegla || !regla || !actual) return envolver(<EstadoCargaPagina />)

  const empresaId = empresa.id
  const errorAjuste = accion.intento ? validarAjuste(actual.base, actual.ajuste) : undefined
  const otras = accesibles.filter((otra) => otra.id !== empresaId)

  const cambiarBase = (base: BaseRegla) => {
    setFormulario({ ...actual, base })
    setEstadoAccion({ ...accion, empresaId, exito: false })
  }
  const cambiarMostrarConIva = (mostrarConIva: boolean) => {
    setFormulario({ ...actual, mostrarConIva })
    setEstadoAccion({ ...accion, empresaId, exito: false })
  }
  const cambiarAjuste = (event: ChangeEvent<HTMLInputElement>) => {
    // Solo dígitos, signo y coma/punto, como el campo del prototipo.
    setFormulario({ ...actual, ajuste: event.target.value.replace(/[^0-9,.\-−+]/g, '') })
    setEstadoAccion({ ...accion, empresaId, exito: false })
  }

  const guardarRegla = async (event: FormEvent) => {
    event.preventDefault()
    if (soloLectura || accion.guardando) return
    const mensaje = validarAjuste(actual.base, actual.ajuste)
    if (mensaje) {
      setEstadoAccion({ ...accion, empresaId, intento: true, exito: false })
      return
    }
    const ajuste = actual.base === 'central' ? 0 : (parsearAjuste(actual.ajuste) as number)
    setEstadoAccion({ empresaId, guardando: true, exito: false, error: null, conflicto: false, intento: true })
    try {
      await guardar(actual.base, ajuste, actual.mostrarConIva)
      if (esVigente(empresaId)) setEstadoAccion({ empresaId, guardando: false, exito: true, error: null, conflicto: false, intento: false })
    } catch (excepcion) {
      if (!esVigente(empresaId)) {
        console.warn('No se pudieron guardar los precios de la empresa anterior', excepcion)
        return
      }
      const conflicto = (excepcion as { code?: string } | null)?.code === '40001'
      setEstadoAccion({ empresaId, guardando: false, exito: false, error: mensajeErrorRegla(excepcion), conflicto, intento: true })
    }
  }

  const botonGuardar = soloLectura ? null : (
    <Button type="submit" form={ID_FORMULARIO} variant="contained" disabled={accion.guardando}>
      {accion.guardando ? 'Guardando…' : 'Guardar'}
    </Button>
  )
  const acciones = (
    <>
      {otras.map((otra) => (
        <Button key={otra.id} component={RouterLink} to={`/empresas/edit/${otra.id}/precios`}>
          Cambiar a {otra.nombre} ↔
        </Button>
      ))}
      <Button component={RouterLink} to="/empresas">Volver al listado</Button>
      {botonGuardar}
    </>
  )

  return envolver(
    <Stack spacing={2}>
      {soloLectura ? <EstadoVacio titulo="Solo lectura" descripcion="Solo los administradores pueden editar los precios de la empresa." /> : null}
      {accion.exito ? <EstadoExito titulo={AVISO_REGLA_GUARDADA} /> : null}
      {accion.error ? (
        <EstadoError
          titulo="No se guardaron los precios."
          descripcion={accion.error}
          reintentar={accion.conflicto ? () => void recargar() : undefined}
          etiquetaReintentar="Recargar"
        />
      ) : null}
      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems={{ lg: 'flex-start' }}>
        <Box component="form" id={ID_FORMULARIO} onSubmit={guardarRegla} noValidate sx={{ flex: 1, minWidth: 0 }}>
          <ReglaPrecioEmpresa
            nombreEmpresa={empresa.nombre}
            base={actual.base}
            ajuste={actual.ajuste}
            errorAjuste={errorAjuste}
            onBase={cambiarBase}
            onAjuste={cambiarAjuste}
            mostrarConIva={actual.mostrarConIva}
            onMostrarConIva={cambiarMostrarConIva}
            ejemplo={ejemploIva(previa.filas)}
            soloLectura={soloLectura}
            cotizacion={cotizacion}
            cargandoCotizacion={cargandoCotizacion}
            errorCotizacion={errorCotizacion}
          />
        </Box>
        <Box sx={{ width: { xs: '100%', lg: 520 }, flexShrink: 0 }}>
          <TablaAsiQuedan
            nombreEmpresa={empresa.nombre}
            mostrarConIva={actual.mostrarConIva}
            filas={previa.filas}
            cargando={previa.cargando}
            hayError={previa.hayError}
            ajusteInvalido={validarAjuste(actual.base, actual.ajuste) !== undefined}
            reintentar={previa.reintentar}
          />
        </Box>
      </Stack>
    </Stack>,
    acciones,
  )
}
