import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControlLabel, Paper, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import { useEsAdministrador } from '../../../hooks/useEsAdministrador'
import { useFiltroPorEmpresaActiva } from '../../../hooks/useFiltroPorEmpresaActiva'
import { useListadoAcumulado } from '../../../hooks/useListadoAcumulado'
import { useNivelSeccion } from '../../../hooks/useNivelSeccion'
import { llamarRpcNewsletter, useRpcNewsletter } from '../../../hooks/useRpcNewsletter'
import {
  ETIQUETA_ESTADO_ENVIO, ETIQUETA_ESTADO_SUSCRIPTOR, ETIQUETA_ORIGEN, textoErrorNewsletter, textoFecha,
  type DetalleNewsletter, type EstadoSuscriptor, type FilaEnvio, type FilaSuscriptor, type ResumenNewsletter,
} from '../../../lib/newsletter'
import { BarraHerramientas } from '../../../components/pagina/BarraHerramientas'
import { CargaInfinita } from '../../../components/pagina/CargaInfinita'
import { ContenedorSeccion } from '../../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../../components/pagina/ContextoOrganizacionActiva'
import { EncabezadoPagina } from '../../../components/pagina/EncabezadoPagina'
import { FiltroEmpresa } from '../../../components/pagina/FiltroEmpresa'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../../components/estados/EstadosPagina'
import { DialogoNuevaCampana } from './DialogoNuevaCampana'

const TAMANO_TANDA = 25
type FiltroEstado = EstadoSuscriptor | 'todos'
type Accion = { tipo: 'baja' | 'borrar' | 'cancelar' | 'descartar'; id: string; texto: string }
type Dialogo = { borrador: DetalleNewsletter | null } | null

const COLOR_ESTADO_ENVIO = { borrador: 'default', enviando: 'warning', enviada: 'success', cancelada: 'default' } as const
const COLOR_ESTADO_SUSCRIPTOR = { pendiente: 'warning', confirmado: 'success', baja: 'default' } as const

function Kpi({ etiqueta, valor }: { etiqueta: string; valor: number | string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 0 }}>
      <Typography variant="xs" color="text.secondary">{etiqueta}</Typography>
      <Typography variant="t1" component="p" sx={{ m: 0 }}>{valor}</Typography>
    </Paper>
  )
}

// «Contactos → Newsletter» (MSF-468, RF-NL-10…12, RF-NL-19, CA-NL-7, CA-NL-8): KPI, interruptor por tienda, suscriptores y envíos de la empresa
// activa, con carga infinita. Ver todo exige lectura en Clientes; componer, enviar, cancelar, dar de baja y borrar datos son del Administrador
// (la base lo vuelve a comprobar con 42501). Al cambiar la empresa se recarga todo y un diálogo abierto se cierra con aviso (Principio VIII).
export function NewsletterPage() {
  const { nivel, isLoading: verificandoPermiso } = useNivelSeccion('clientes')
  const { esAdministrador } = useEsAdministrador()
  const { empresas, valor: empresaId, cambiar: elegirEmpresa, empresaActivaId, cargando: cargandoTiendas, hayError: errorTiendas } = useFiltroPorEmpresaActiva()
  const puedeVer = nivel === 'lectura' || nivel === 'edicion'
  const puedeEscribir = esAdministrador && nivel === 'edicion'

  const [estado, setEstado] = useState<FiltroEstado>('todos')
  const [textoInput, setTextoInput] = useState('')
  const [texto, setTexto] = useState('')
  const [paginaSuscriptores, setPaginaSuscriptores] = useState(1)
  const [paginaEnvios, setPaginaEnvios] = useState(1)
  const [dialogo, setDialogo] = useState<Dialogo>(null)
  const [accion, setAccion] = useState<Accion | null>(null)
  const [mensaje, setMensaje] = useState<{ tipo: 'error' | 'success' | 'info'; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    const temporizador = setTimeout(() => { setTexto(textoInput.trim()); setPaginaSuscriptores(1) }, 300)
    return () => clearTimeout(temporizador)
  }, [textoInput])

  // Cambio de empresa (filtro o barra superior): vuelve a la primera tanda y cierra el diálogo con aviso, sin guardar nada (Principio VIII).
  const empresaPrevia = useRef(empresaId)
  useEffect(() => {
    if (empresaPrevia.current === empresaId) return
    empresaPrevia.current = empresaId
    setPaginaSuscriptores(1)
    setPaginaEnvios(1)
    setAccion(null)
    setDialogo((abierto) => {
      if (abierto) setMensaje({ tipo: 'info', texto: 'Cambiaste de empresa: se cerró la campaña sin guardar.' })
      return null
    })
  }, [empresaId])

  const resumen = useRpcNewsletter<ResumenNewsletter>('resumen_newsletter', { p_empresa: empresaId }, puedeVer)
  const suscriptores = useRpcNewsletter<{ total: number; filas: FilaSuscriptor[] }>(
    'listar_suscriptores_newsletter', { p_empresa: empresaId, p_estado: estado === 'todos' ? null : estado, p_texto: texto || null, p_pagina: paginaSuscriptores, p_tamano: TAMANO_TANDA }, puedeVer)
  const envios = useRpcNewsletter<{ total: number; filas: FilaEnvio[] }>(
    'listar_newsletters', { p_empresa: empresaId, p_estado: null, p_pagina: paginaEnvios, p_tamano: TAMANO_TANDA }, puedeVer)

  const listadoSuscriptores = useListadoAcumulado({
    items: suscriptores.datos?.filas ?? [], pagina: paginaSuscriptores, setPagina: setPaginaSuscriptores, total: suscriptores.datos?.total ?? 0,
    cargando: suscriptores.isFetching, reinicio: `${empresaId}|${estado}|${texto}`,
  })
  const listadoEnvios = useListadoAcumulado({
    items: envios.datos?.filas ?? [], pagina: paginaEnvios, setPagina: setPaginaEnvios, total: envios.datos?.total ?? 0,
    cargando: envios.isFetching, reinicio: empresaId,
  })

  const recargar = useCallback(() => {
    setPaginaSuscriptores(1)
    setPaginaEnvios(1)
    void resumen.refetch()
    void suscriptores.refetch()
    void envios.refetch()
  }, [resumen, suscriptores, envios])

  const ejecutar = async (nombre: string, parametros: Record<string, unknown>, exito: string) => {
    setOcupado(true)
    const { error } = await llamarRpcNewsletter(nombre, parametros)
    setOcupado(false)
    setAccion(null)
    if (error) setMensaje({ tipo: 'error', texto: textoErrorNewsletter(error) })
    else { setMensaje({ tipo: 'success', texto: exito }); recargar() }
  }

  const alternarTienda = (empresa: string, activo: boolean) =>
    void ejecutar('guardar_newsletter_configuracion', { p_empresa: empresa, p_activo: activo }, activo ? 'La suscripción se muestra en el pie de la tienda.' : 'La suscripción ya no se muestra en el pie de la tienda.')

  const abrirBorrador = async (id: string) => {
    const { data, error } = await llamarRpcNewsletter<DetalleNewsletter>('detalle_newsletter', { p_id: id })
    if (error || !data) setMensaje({ tipo: 'error', texto: textoErrorNewsletter(error) })
    else setDialogo({ borrador: data })
  }

  const confirmarAccion = () => {
    if (!accion) return
    if (accion.tipo === 'baja') void ejecutar('dar_de_baja_suscriptor_newsletter', { p_suscriptor: accion.id }, 'El suscriptor quedó dado de baja.')
    if (accion.tipo === 'borrar') void ejecutar('borrar_datos_suscriptor_newsletter', { p_suscriptor: accion.id }, 'Se borraron los datos del suscriptor.')
    if (accion.tipo === 'cancelar') void ejecutar('cancelar_envio_newsletter', { p_id: accion.id }, 'Se canceló lo que todavía no había salido.')
    if (accion.tipo === 'descartar') void ejecutar('descartar_newsletter', { p_id: accion.id }, 'Se descartó el borrador.')
  }

  const columnasSuscriptores: ColumnaAdaptable<FilaSuscriptor>[] = [
    { clave: 'correo', encabezado: 'Correo', render: (s) => s.correo },
    ...(empresaId === null ? [{ clave: 'tienda', encabezado: 'Tienda', render: (s: FilaSuscriptor) => s.tienda }] : []),
    { clave: 'origen', encabezado: 'Origen', render: (s) => ETIQUETA_ORIGEN[s.origen] ?? s.origen },
    { clave: 'alta', encabezado: 'Alta', render: (s) => textoFecha(s.creado_en) },
    { clave: 'estado', encabezado: 'Estado', render: (s) => <Chip size="small" color={COLOR_ESTADO_SUSCRIPTOR[s.estado]} label={ETIQUETA_ESTADO_SUSCRIPTOR[s.estado]} /> },
    ...(puedeEscribir ? [{
      clave: 'acciones', encabezado: 'Acciones',
      render: (s: FilaSuscriptor) => (
        <Stack direction="row" spacing={1}>
          {s.estado !== 'baja' ? <Button size="small" onClick={() => setAccion({ tipo: 'baja', id: s.id, texto: `¿Dar de baja a ${s.correo}? No recibirá más newsletters ni lo que está pendiente.` })} disabled={ocupado}>Dar de baja</Button> : null}
          <Button size="small" color="error" onClick={() => setAccion({ tipo: 'borrar', id: s.id, texto: `¿Borrar los datos de ${s.correo}? Se elimina la suscripción y su correo queda como [eliminado] en los envíos pasados. No se puede deshacer.` })} disabled={ocupado}>Borrar datos</Button>
        </Stack>
      ),
    }] : []),
  ]

  const columnasEnvios: ColumnaAdaptable<FilaEnvio>[] = [
    { clave: 'campana', encabezado: 'Campaña', render: (e) => e.nombre_interno },
    ...(empresaId === null ? [{ clave: 'tienda', encabezado: 'Tienda', render: (e: FilaEnvio) => e.tienda }] : []),
    { clave: 'asunto', encabezado: 'Asunto', render: (e) => e.asunto },
    { clave: 'fecha', encabezado: 'Fecha', render: (e) => textoFecha(e.fecha) },
    { clave: 'destinatarios', encabezado: 'Destinatarios', align: 'right', render: (e) => (e.estado === 'borrador' ? '-' : e.destinatarios) },
    { clave: 'resultado', encabezado: 'Enviados / fallidos / omitidos / bajas', render: (e) => (e.estado === 'borrador' ? '-' : `${e.enviados} / ${e.fallidos} / ${e.omitidos} / ${e.bajas}`) },
    { clave: 'estado', encabezado: 'Estado', render: (e) => <Chip size="small" color={COLOR_ESTADO_ENVIO[e.estado]} label={ETIQUETA_ESTADO_ENVIO[e.estado]} /> },
    {
      clave: 'acciones', encabezado: 'Acciones',
      render: (e) => (
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={() => void abrirBorrador(e.id)} aria-label={`${e.estado === 'borrador' && puedeEscribir ? 'Editar' : 'Ver'} la campaña ${e.nombre_interno}`}>{e.estado === 'borrador' && puedeEscribir ? 'Editar' : 'Ver'}</Button>
          {puedeEscribir && e.estado === 'enviando' ? <Button size="small" color="error" onClick={() => setAccion({ tipo: 'cancelar', id: e.id, texto: `¿Cancelar el envío de «${e.asunto}»? Lo que ya salió no se retira; lo pendiente no se envía.` })} disabled={ocupado}>Cancelar envío</Button> : null}
          {puedeEscribir && e.estado === 'borrador' ? <Button size="small" color="error" onClick={() => setAccion({ tipo: 'descartar', id: e.id, texto: `¿Descartar el borrador «${e.nombre_interno}»?` })} disabled={ocupado}>Descartar</Button> : null}
        </Stack>
      ),
    },
  ]

  const datosResumen = resumen.datos
  const tiendasAccesibles = datosResumen?.tiendas ?? []
  const falloSuscriptores = suscriptores.isError && listadoSuscriptores.filas.length > 0
  const falloEnvios = envios.isError && listadoEnvios.filas.length > 0

  return (
    <Box>
      <EncabezadoPagina
        titulo="Newsletter"
        descripcion="Suscriptores de cada tienda y los envíos que le mandás."
        contexto={<ContextoOrganizacionActiva />}
        accion={puedeEscribir && datosResumen?.bandera ? <Button variant="contained" onClick={() => setDialogo({ borrador: null })}>Nueva campaña</Button> : undefined}
      />
      <ContenedorSeccion>
        {verificandoPermiso || nivel === null ? (
          <EstadoCargaPagina />
        ) : !puedeVer ? (
          <EstadoError titulo="Sin permiso" descripcion="Tu rol no puede ver el newsletter." />
        ) : (
          <Stack spacing={3}>
            {mensaje ? <Alert severity={mensaje.tipo} role={mensaje.tipo === 'error' ? 'alert' : 'status'} onClose={() => setMensaje(null)}>{mensaje.texto}</Alert> : null}
            {datosResumen && !datosResumen.bandera ? (
              <Alert severity="info" role="note">El newsletter todavía no está habilitado en este entorno: las tiendas no muestran el formulario y no se pueden crear ni enviar campañas. Las bajas y el borrado de datos siguen funcionando.</Alert>
            ) : null}
            {!puedeEscribir ? <Alert severity="info" role="note">Estás en modo lectura: componer, enviar, cancelar, dar de baja y borrar datos son del Administrador.</Alert> : null}

            {cargandoTiendas || errorTiendas || empresas.length > 0 ? (
              <FiltroEmpresa empresas={empresas} valor={empresaId} onCambiar={(id) => elegirEmpresa(id)} cargando={cargandoTiendas} hayError={errorTiendas} />
            ) : null}

            {resumen.isError ? (
              <EstadoError descripcion="No pudimos cargar el resumen del newsletter." reintentar={() => void resumen.refetch()} />
            ) : resumen.isLoading ? (
              <EstadoCargaPagina />
            ) : datosResumen ? (
              <>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} aria-label="Resumen del newsletter" role="group">
                  <Kpi etiqueta="Suscriptores activos" valor={datosResumen.confirmados} />
                  <Kpi etiqueta="Pendientes de confirmar" valor={datosResumen.pendientes} />
                  <Kpi etiqueta="Bajas" valor={datosResumen.bajas} />
                  <Kpi etiqueta="Envíos" valor={datosResumen.envios} />
                </Stack>
                <Stack spacing={0.5}>
                  {datosResumen.tiendas.map((t) => (
                    <FormControlLabel
                      key={t.empresa_id}
                      control={<Switch checked={t.activo} onChange={(e) => alternarTienda(t.empresa_id, e.target.checked)} disabled={!puedeEscribir || !datosResumen.bandera || ocupado} />}
                      label={`Mostrar suscripción en el pie de la tienda${datosResumen.tiendas.length > 1 ? `: ${t.tienda}` : ''}`}
                    />
                  ))}
                </Stack>
              </>
            ) : null}

            <Stack spacing={1.5} component="section" aria-labelledby="titulo-suscriptores">
              <Typography id="titulo-suscriptores" component="h2" variant="t2">Suscriptores</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
                <ToggleButtonGroup exclusive size="small" aria-label="Filtrar suscriptores por estado" value={estado} onChange={(_, nuevo: FiltroEstado | null) => { if (nuevo) { setEstado(nuevo); setPaginaSuscriptores(1) } }}>
                  <ToggleButton value="todos">Todos</ToggleButton>
                  <ToggleButton value="confirmado">Confirmados</ToggleButton>
                  <ToggleButton value="pendiente">Pendientes</ToggleButton>
                  <ToggleButton value="baja">Bajas</ToggleButton>
                </ToggleButtonGroup>
                <TextField size="small" label="Buscar por correo" value={textoInput} onChange={(e) => setTextoInput(e.target.value)} slotProps={{ htmlInput: { maxLength: 254 } }} />
              </Stack>
              <BarraHerramientas contador={suscriptores.isLoading || suscriptores.isError ? undefined : `${suscriptores.datos?.total ?? 0} ${(suscriptores.datos?.total ?? 0) === 1 ? 'suscriptor' : 'suscriptores'}`} />
              <Box aria-busy={suscriptores.isFetching}>
                {suscriptores.isLoading ? (
                  <EstadoCargaPagina />
                ) : suscriptores.isError && !falloSuscriptores ? (
                  <EstadoError descripcion="No pudimos cargar los suscriptores." reintentar={() => void suscriptores.refetch()} />
                ) : listadoSuscriptores.filas.length === 0 ? (
                  <EstadoVacio titulo="Todavía no hay suscriptores" />
                ) : (
                  <>
                    <ContenidoAdaptable items={listadoSuscriptores.filas} columnas={columnasSuscriptores} obtenerClave={(s) => s.id} etiquetaTabla="Suscriptores del newsletter" />
                    <CargaInfinita hayMas={listadoSuscriptores.hayMas} cargando={listadoSuscriptores.cargandoMas} hayError={falloSuscriptores} onCargarMas={falloSuscriptores ? () => void suscriptores.refetch() : listadoSuscriptores.cargarMas} sustantivo="suscriptores" cargados={listadoSuscriptores.filas.length} />
                  </>
                )}
              </Box>
            </Stack>

            <Stack spacing={1.5} component="section" aria-labelledby="titulo-envios">
              <Typography id="titulo-envios" component="h2" variant="t2">Campañas</Typography>
              <Box aria-busy={envios.isFetching}>
                {envios.isLoading ? (
                  <EstadoCargaPagina />
                ) : envios.isError && !falloEnvios ? (
                  <EstadoError descripcion="No pudimos cargar las campañas." reintentar={() => void envios.refetch()} />
                ) : listadoEnvios.filas.length === 0 ? (
                  <EstadoVacio titulo="Todavía no hay campañas" />
                ) : (
                  <>
                    <ContenidoAdaptable items={listadoEnvios.filas} columnas={columnasEnvios} obtenerClave={(e) => e.id} etiquetaTabla="Campañas del newsletter" />
                    <CargaInfinita hayMas={listadoEnvios.hayMas} cargando={listadoEnvios.cargandoMas} hayError={falloEnvios} onCargarMas={falloEnvios ? () => void envios.refetch() : listadoEnvios.cargarMas} sustantivo="campañas" cargados={listadoEnvios.filas.length} />
                  </>
                )}
              </Box>
            </Stack>
          </Stack>
        )}
      </ContenedorSeccion>

      {dialogo ? (
        <DialogoNuevaCampana
          key={dialogo.borrador?.id ?? 'nueva'}
          tiendas={tiendasAccesibles}
          empresaInicial={empresaId ?? empresaActivaId}
          borrador={dialogo.borrador}
          onCerrar={() => setDialogo(null)}
          onCambio={recargar}
        />
      ) : null}

      <Dialog open={accion !== null} onClose={() => !ocupado && setAccion(null)} aria-labelledby="titulo-confirmar-accion">
        <DialogTitle id="titulo-confirmar-accion">Confirmá la acción</DialogTitle>
        <DialogContent><DialogContentText>{accion?.texto}</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setAccion(null)} disabled={ocupado}>Volver</Button>
          <Button color="error" variant="contained" onClick={confirmarAccion} disabled={ocupado}>Confirmar</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
