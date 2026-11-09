import { lazy, Suspense, useState } from 'react'
import { Alert, Button, Snackbar, Stack, Typography } from '@mui/material'
import { AvisoCotizacion } from '../../components/cotizacion/AvisoCotizacion'
import { TarjetaConfiguracion, type ValoresConfiguracion } from '../../components/cotizacion/TarjetaConfiguracion'
import { TablaHistorial } from '../../components/cotizacion/TablaHistorial'
import { TarjetaVigente } from '../../components/cotizacion/TarjetaVigente'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { useConfiguracionCotizacion, useGuardarConfiguracionCotizacion } from '../../hooks/useConfiguracionCotizacion'
import { useEstadoCotizacion } from '../../hooks/useCotizacion'
import { useCotizacionDelDia } from '../../hooks/useCotizacionDelDia'
import { useHistorialCargasCotizacion } from '../../hooks/useHistorialCargasCotizacion'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import {
  AVISO_COTIZACION_REGISTRADA,
  type AlcanceCotizacion,
  type CotizacionConfirmada,
  MENSAJE_CONFIGURACION_GUARDADA,
  avisoCotizacionAplicada,
} from '../../lib/cotizacion'

// El diálogo (MUI Dialog + formulario) queda fuera de la carga inicial de la pantalla (Principio VI).
const DialogoCargarDolar = lazy(() =>
  import('../../components/cotizacion/DialogoCargarDolar').then((modulo) => ({ default: modulo.DialogoCargarDolar })),
)
const DialogoAlcance = lazy(() =>
  import('../../components/cotizacion/DialogoAlcance').then((modulo) => ({ default: modulo.DialogoAlcance })),
)

// «Cotización del dólar» (F-PRE-02, FR-005/FR-008; Cotizacion.dc.html). Con alcance «sistema» la cotización es
// una sola para la organización y la empresa activa no la cambia. Con «una por empresa» (F-PRE-06, FR-009) la
// pantalla sigue a la empresa activa de la barra superior (Principio VIII): estado, historial, aviso y carga se
// acotan a ella, en «Todas mis empresas» se pide elegir una con `FiltroEmpresa`, y un diálogo abierto de otra
// empresa se cierra con aviso. La ruta va envuelta en RequiereAccesoSeccion (`cotizacion_dolar` ≥ lectura); los
// botones de carga y la tarjeta «Configuración» solo se editan con edición (la base lo exige igual).
export function CotizacionPage() {
  const { nivel } = useNivelSeccion('cotizacion_dolar')
  const puedeVerHistorial = nivel === 'lectura' || nivel === 'edicion'
  const puedeEditar = nivel === 'edicion'
  const config = useConfiguracionCotizacion(puedeVerHistorial)
  const guardarConfig = useGuardarConfiguracionCotizacion()
  const filtro = useFiltroPorEmpresaActiva()
  const porEmpresa = config.configuracion?.alcance === 'empresa'
  const empresaId = porEmpresa ? filtro.valor : null
  const nombreEmpresa = filtro.empresas.find((empresa) => empresa.id === empresaId)?.nombre ?? null
  // Hasta saber el alcance no se pide la cotización: evita mostrar la general y saltar a la de la empresa.
  const alcanceListo = !config.cargando
  const { estado, cargando, hayError, recargar } = useEstadoCotizacion(empresaId, alcanceListo)
  const { delDia } = useCotizacionDelDia(alcanceListo, empresaId)
  const historial = useHistorialCargasCotizacion(puedeVerHistorial && alcanceListo, empresaId)
  // El diálogo guarda la empresa con la que se abrió: si la activa cambia, se cierra con aviso.
  const [dialogoPara, setDialogoPara] = useState<{ empresaId: string | null } | null>(null)
  const [alcanceNuevo, setAlcanceNuevo] = useState<AlcanceCotizacion | null>(null)
  const [versionTarjeta, setVersionTarjeta] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null)
  if (dialogoPara && dialogoPara.empresaId !== empresaId) {
    setDialogoPara(null)
    setAviso('Cambiaste de empresa: el diálogo de carga se cerró sin guardar.')
  }
  const dialogoAbierto = dialogoPara !== null
  const sinEmpresaElegida = porEmpresa && empresaId === null

  // El aviso refleja lo que decidió la base: aplicó el recálculo o solo registró la cotización (F-PRE-03, FR-015).
  const alConfirmar = (confirmada: CotizacionConfirmada) => {
    setDialogoPara(null)
    setAviso(confirmada.recalculoAplicado ? avisoCotizacionAplicada(confirmada.preciosRecalculados) : AVISO_COTIZACION_REGISTRADA)
    void recargar()
    historial.recargar()
  }

  const guardar = async (valores: ValoresConfiguracion) => {
    setErrorGuardado(null)
    const { alcance, ...resto } = valores
    const resultado = await guardarConfig.guardar(resto)
    if (!resultado.ok) {
      setErrorGuardado(resultado.mensaje)
      return
    }
    await config.recargar()
    setVersionTarjeta((n) => n + 1)
    // Cambiar el alcance exige ver antes qué cambia: se abre la vista previa en vez de aplicarlo.
    if (alcance !== config.configuracion?.alcance) setAlcanceNuevo(alcance)
    else setAviso(MENSAJE_CONFIGURACION_GUARDADA)
  }

  const alCambiarAlcance = async () => {
    setAlcanceNuevo(null)
    setAviso('Alcance de la cotización cambiado')
    await config.recargar()
    setVersionTarjeta((n) => n + 1)
    void recargar()
    historial.recargar()
  }

  let contenido
  if (hayError) contenido = <EstadoError descripcion="No pudimos leer la cotización del dólar." reintentar={() => void recargar()} />
  else if (cargando || !estado) contenido = <EstadoCargaPagina />
  else if (!estado.vigente) {
    contenido = (
      <EstadoVacio
        titulo="Todavía no hay una cotización cargada"
        descripcion={puedeEditar ? 'Cargá el dólar del día para calcular los precios de los productos en USD.' : 'Cuando se cargue el dólar del día lo vas a ver acá.'}
      />
    )
  } else contenido = <TarjetaVigente vigente={estado.vigente} productosUsd={estado.productosUsd} delDia={delDia} />

  return (
    <Stack spacing={2}>
      <EncabezadoPagina
        titulo="Cotización del dólar"
        descripcion="Valor que se carga cada día para calcular los precios de los productos en USD."
        contexto={<ContextoOrganizacionActiva />}
        accion={puedeEditar ? <Button variant="contained" disabled={sinEmpresaElegida} onClick={() => setDialogoPara({ empresaId })}>Cargar cotización</Button> : undefined}
      />
      <AvisoCotizacion />
      {porEmpresa ? (
        <FiltroEmpresa
          empresas={filtro.empresas}
          valor={filtro.valor}
          onCambiar={filtro.cambiar}
          cargando={filtro.cargando}
          hayError={filtro.hayError}
          ariaLabel="Empresa de la cotización"
          textoAyuda={sinEmpresaElegida ? 'Elegí una empresa para ver y cargar su cotización; mientras tanto se muestra la general.' : undefined}
        />
      ) : null}
      {contenido}
      {config.hayError ? <EstadoError descripcion="No pudimos leer la configuración de la cotización." reintentar={() => void config.recargar()} /> : null}
      {config.configuracion ? (
        <Stack spacing={1}>
          {errorGuardado ? <Alert severity="error">{errorGuardado}</Alert> : null}
          <TarjetaConfiguracion
            key={`${versionTarjeta}-${JSON.stringify(config.configuracion)}`}
            configuracion={config.configuracion}
            nombresEmpresas={filtro.empresas.map((empresa) => empresa.nombre)}
            soloLectura={!puedeEditar}
            guardando={guardarConfig.guardando}
            onGuardar={(valores) => void guardar(valores)}
          />
          {!puedeEditar ? <Typography variant="xs">Tenés acceso de lectura: la configuración solo se edita con permiso de edición.</Typography> : null}
        </Stack>
      ) : null}
      {puedeVerHistorial ? (
        <TablaHistorial
          filas={historial.filas}
          numeroPagina={historial.numeroPagina}
          haySiguiente={historial.haySiguiente}
          hayAnterior={historial.hayAnterior}
          cargando={historial.cargando}
          hayError={historial.hayError}
          onSiguiente={historial.siguiente}
          onAnterior={historial.anterior}
          onReintentar={historial.recargar}
        />
      ) : null}
      {dialogoAbierto ? (
        <Suspense fallback={null}>
          <DialogoCargarDolar
            abierto
            vigente={estado?.vigente ?? null}
            aplicada={estado?.aplicada ?? null}
            onCerrar={() => setDialogoPara(null)}
            onConfirmada={alConfirmar}
            empresaId={empresaId}
            nombreEmpresa={nombreEmpresa}
            confirmacionPct={config.configuracion?.confirmacionPct}
          />
        </Suspense>
      ) : null}
      {alcanceNuevo ? (
        <Suspense fallback={null}>
          <DialogoAlcance
            alcance={alcanceNuevo}
            onCerrar={() => { setAlcanceNuevo(null); setVersionTarjeta((n) => n + 1) }}
            onCambiado={() => void alCambiarAlcance()}
          />
        </Suspense>
      ) : null}
      <Snackbar open={aviso !== null} autoHideDuration={4000} onClose={() => setAviso(null)}>
        <Alert severity="success" onClose={() => setAviso(null)}>{aviso}</Alert>
      </Snackbar>
    </Stack>
  )
}
