import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControlLabel, Stack, Switch, TextField, Typography,
} from '@mui/material'
import { SelectorEmpresas } from '../../../components/base/SelectorEmpresas'
import { llamarRpcNewsletter } from '../../../hooks/useRpcNewsletter'
import {
  ASUNTO_MAXIMO, MENSAJE_MAXIMO, NOMBRE_INTERNO_MAXIMO, campanaValida, textoDestinatarios, textoErrorNewsletter, validarCampana,
  type DetalleNewsletter, type TiendaNewsletter, type VistaPreviaNewsletterDatos,
} from '../../../lib/newsletter'
import { VistaPreviaNewsletter } from './VistaPreviaNewsletter'

type Props = {
  tiendas: ReadonlyArray<TiendaNewsletter>
  empresaInicial: string | null
  borrador: DetalleNewsletter | null
  onCerrar: () => void
  /** Se guardó o envió algo: la pantalla recarga sus listados. */
  onCambio: () => void
}

// «Nueva campaña» del newsletter (RF-NL-13…18, CA-NL-9, CA-NL-10, CA-NL-12). Campos del prototipo (nombre interno, asunto, tienda remitente,
// destinatarios de solo lectura, mensaje) más las dos secciones con interruptor. La pantalla lo monta solo mientras está abierto y lo cierra
// con aviso si cambia la empresa activa: nunca guarda ni envía con la empresa anterior (Principio VIII).
export function DialogoNuevaCampana({ tiendas, empresaInicial, borrador, onCerrar, onCambio }: Props) {
  const inicial = {
    empresa: borrador?.empresa_id ?? (empresaInicial && tiendas.some((t) => t.empresa_id === empresaInicial) ? empresaInicial : tiendas.length === 1 ? tiendas[0].empresa_id : null),
    nombre: borrador?.nombre_interno ?? '',
    asunto: borrador?.asunto ?? '',
    mensaje: borrador?.mensaje ?? '',
    destacados: borrador?.incluir_destacados ?? false,
    promociones: borrador?.incluir_promociones ?? false,
  }
  const [empresa, setEmpresa] = useState<string | null>(inicial.empresa)
  const [nombre, setNombre] = useState(inicial.nombre)
  const [asunto, setAsunto] = useState(inicial.asunto)
  const [mensaje, setMensaje] = useState(inicial.mensaje)
  const [destacados, setDestacados] = useState(inicial.destacados)
  const [promociones, setPromociones] = useState(inicial.promociones)
  const [intento, setIntento] = useState(false)
  const [id, setId] = useState<string | null>(borrador?.id ?? null)
  const [version, setVersion] = useState<number | null>(borrador?.version ?? null)
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'error' | 'success'; texto: string } | null>(null)
  const [vista, setVista] = useState<VistaPreviaNewsletterDatos | null>(null)
  const [cargandoVista, setCargandoVista] = useState(false)
  const [errorVista, setErrorVista] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [confirmandoCierre, setConfirmandoCierre] = useState(false)
  // Clave del envío: se genera al abrir la confirmación y se reutiliza si se repite el clic (idempotencia).
  const claveEnvio = useRef<string | null>(null)
  const peticionVista = useRef(0)

  const sucio = empresa !== inicial.empresa || nombre !== inicial.nombre || asunto !== inicial.asunto || mensaje !== inicial.mensaje
    || destacados !== inicial.destacados || promociones !== inicial.promociones
  const errores = validarCampana({ nombre, asunto, mensaje }, empresa)
  const valida = campanaValida(errores)
  const editable = borrador === null || borrador.estado === 'borrador'

  const cargarVista = useCallback(async (conMensaje: string) => {
    if (!empresa) return
    const peticion = ++peticionVista.current
    setCargandoVista(true)
    setErrorVista(false)
    const { data, error } = await llamarRpcNewsletter<{ confirmados: number; generado_en: string; html: string }>('vista_previa_newsletter', {
      p_empresa: empresa, p_mensaje: conMensaje, p_destacados: destacados, p_promociones: promociones,
    })
    if (peticion !== peticionVista.current) return
    setCargandoVista(false)
    if (error || !data || typeof data.html !== 'string' || typeof data.confirmados !== 'number') {
      setErrorVista(true)
      return
    }
    setVista({ confirmados: data.confirmados, generado_en: data.generado_en, html: data.html })
  }, [empresa, destacados, promociones])

  // La cantidad de destinatarios («Suscriptores activos (N)») se pide al elegir la tienda; la vista previa sigue el mismo pedido.
  useEffect(() => {
    setVista(null)
    if (empresa) void cargarVista(mensaje)
    // El mensaje solo se reenvía al tocar «Vista previa».
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresa, destacados, promociones])

  const guardar = async (): Promise<{ id: string; version: number } | null> => {
    setIntento(true)
    if (!valida || !empresa) return null
    setOcupado(true)
    const { data, error } = await llamarRpcNewsletter<{ id: string; version: number }>('guardar_newsletter', {
      p_id: id, p_version: version, p_empresa: empresa, p_nombre: nombre, p_asunto: asunto, p_mensaje: mensaje,
      p_destacados: destacados, p_promociones: promociones,
    })
    setOcupado(false)
    if (error || !data) {
      setAviso({ tipo: 'error', texto: textoErrorNewsletter(error) })
      return null
    }
    setId(data.id)
    setVersion(data.version)
    onCambio()
    return data
  }

  const guardarBorrador = async () => {
    const guardado = await guardar()
    if (guardado) setAviso({ tipo: 'success', texto: 'Borrador guardado.' })
  }

  const enviarPrueba = async () => {
    setIntento(true)
    if (!valida || !empresa) return
    setOcupado(true)
    const { error } = await llamarRpcNewsletter('solicitar_prueba_newsletter', {
      p_empresa: empresa, p_asunto: asunto, p_mensaje: mensaje, p_destacados: destacados, p_promociones: promociones,
    })
    setOcupado(false)
    setAviso(error ? { tipo: 'error', texto: textoErrorNewsletter(error) } : { tipo: 'success', texto: 'Te enviamos una prueba a tu correo. Puede tardar un minuto.' })
  }

  const pedirConfirmacion = () => {
    setIntento(true)
    if (!valida) return
    claveEnvio.current ??= crypto.randomUUID()
    setConfirmando(true)
  }

  const enviar = async () => {
    const guardado = await guardar()
    if (!guardado || !claveEnvio.current) {
      setConfirmando(false)
      return
    }
    setOcupado(true)
    const { error } = await llamarRpcNewsletter('enviar_newsletter', { p_id: guardado.id, p_version: guardado.version, p_clave: claveEnvio.current })
    setOcupado(false)
    setConfirmando(false)
    if (error) {
      setAviso({ tipo: 'error', texto: textoErrorNewsletter(error) })
      return
    }
    onCambio()
    onCerrar()
  }

  const cerrar = () => {
    if (sucio && editable) setConfirmandoCierre(true)
    else onCerrar()
  }

  const confirmados = vista?.confirmados ?? null
  const etiquetaEnviar = confirmados === null ? 'Enviar' : `Enviar a ${confirmados}`

  return (
    <>
      <Dialog open onClose={cerrar} fullWidth maxWidth="md" aria-labelledby="titulo-campana-newsletter">
        <DialogTitle id="titulo-campana-newsletter">{borrador ? 'Campaña de newsletter' : 'Nueva campaña'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {!editable ? <Alert severity="info" role="note">Esta campaña ya se envió: se ve en modo lectura.</Alert> : null}
            {aviso ? <Alert severity={aviso.tipo} role={aviso.tipo === 'error' ? 'alert' : 'status'}>{aviso.texto}</Alert> : null}
            <TextField
              label="Nombre interno" value={nombre} onChange={(e) => setNombre(e.target.value)} required fullWidth size="small" disabled={!editable || ocupado}
              error={intento && Boolean(errores.nombre)} helperText={(intento && errores.nombre) || `${nombre.length}/${NOMBRE_INTERNO_MAXIMO}. Solo lo ves vos.`}
            />
            <TextField
              label="Asunto del correo" value={asunto} onChange={(e) => setAsunto(e.target.value)} required fullWidth size="small" disabled={!editable || ocupado}
              error={intento && Boolean(errores.asunto)} helperText={(intento && errores.asunto) || `${asunto.length}/${ASUNTO_MAXIMO}`}
            />
            <SelectorEmpresas
              etiqueta="Tienda remitente"
              empresas={tiendas.map((t) => ({ id: t.empresa_id, nombre: t.tienda }))}
              seleccion={empresa ? [empresa] : []}
              onCambiar={(seleccion) => setEmpresa(seleccion[0] ?? null)}
              unica
              deshabilitado={!editable || ocupado || borrador !== null}
              error={(intento && errores.tienda) || undefined}
            />
            <TextField
              label="Destinatarios" value={confirmados === null ? 'Suscriptores activos' : `Suscriptores activos (${confirmados})`} size="small" fullWidth
              slotProps={{ input: { readOnly: true } }} helperText="Solo reciben quienes confirmaron su suscripción a esta tienda."
            />
            <TextField
              label="Mensaje" value={mensaje} onChange={(e) => setMensaje(e.target.value)} required fullWidth multiline minRows={5} disabled={!editable || ocupado}
              error={intento && Boolean(errores.mensaje)}
              helperText={(intento && errores.mensaje) || `${mensaje.length}/${MENSAJE_MAXIMO}. Texto plano: se muestra tal cual, sin HTML. Cada correo suma al final un enlace para darse de baja.`}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <FormControlLabel control={<Switch checked={destacados} onChange={(e) => setDestacados(e.target.checked)} disabled={!editable || ocupado} />} label="Productos destacados" />
              <FormControlLabel control={<Switch checked={promociones} onChange={(e) => setPromociones(e.target.checked)} disabled={!editable || ocupado} />} label="Promociones vigentes" />
            </Stack>
            <Typography variant="xs" color="text.secondary">Hasta 6 productos por sección, con el precio de la tienda al momento de enviar.</Typography>
            <VistaPreviaNewsletter datos={vista} cargando={cargandoVista} hayError={errorVista} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={cerrar} disabled={ocupado}>Cancelar</Button>
          <Button onClick={() => void cargarVista(mensaje)} disabled={!empresa || cargandoVista}>Vista previa</Button>
          {editable ? <Button onClick={() => void enviarPrueba()} disabled={ocupado}>Enviar prueba</Button> : null}
          {editable ? <Button onClick={() => void guardarBorrador()} disabled={ocupado}>Guardar borrador</Button> : null}
          {editable ? <Button variant="contained" onClick={pedirConfirmacion} disabled={ocupado || confirmados === 0}>{etiquetaEnviar}</Button> : null}
        </DialogActions>
      </Dialog>

      <Dialog open={confirmando} onClose={() => !ocupado && setConfirmando(false)} aria-labelledby="titulo-confirmar-envio">
        <DialogTitle id="titulo-confirmar-envio">¿Enviar el newsletter?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Se envía a {textoDestinatarios(confirmados ?? 0)} confirmados de la tienda. El envío sale por lotes dentro del cupo diario y no se puede editar después;
            podés cancelar lo que todavía no salió.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmando(false)} disabled={ocupado}>Volver</Button>
          <Button variant="contained" onClick={() => void enviar()} disabled={ocupado}>{ocupado ? 'Enviando…' : 'Confirmar envío'}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmandoCierre} onClose={() => setConfirmandoCierre(false)} aria-labelledby="titulo-descartar-cambios">
        <DialogTitle id="titulo-descartar-cambios">¿Descartar los cambios?</DialogTitle>
        <DialogContent><DialogContentText>Tenés cambios sin guardar en esta campaña.</DialogContentText></DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmandoCierre(false)}>Seguir editando</Button>
          <Button color="error" onClick={onCerrar}>Descartar</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
