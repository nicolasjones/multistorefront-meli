import { type FormEvent, useRef, useState } from 'react'
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material'
import { useResponsablesConsultas } from '../../hooks/useConsultas'
import {
  ESTADOS_CONSULTA,
  COLOR_ESTADO_CONSULTA,
  ETIQUETA_ESTADO_CONSULTA,
  ETIQUETA_ORIGEN_CONSULTA,
  NOTA_MAXIMA,
  actualizarConsulta,
  esConflicto,
  formatearCuando,
  mensajeDeError,
  nombreProducto,
  type Consulta,
  type EstadoConsulta,
} from '../../lib/consultas'
import { avisoRespuestaRegistrada, enlaceRespuesta, registrarRespuesta } from '../../lib/responderConsulta'
import { TituloDialogo } from '../base/TituloDialogo'
import { EstadoError } from '../estados/EstadosPagina'

type Props = {
  consulta: Consulta
  /** `consultas` = edición. Con lectura el diálogo muestra todo y no deja cambiar nada. */
  puedeEditar: boolean
  onCerrar: () => void
  onGuardado: (mensaje: string) => void
  /** Ante un conflicto de edición: volver a leer la consulta con los datos de la otra persona. */
  onRecargar: () => void
}

// Diálogo «Consulta de <nombre>» (FR-007, `Consultas.dc.html`): chips de empresa, origen y estado,
// fecha, Contacto, Producto de interés y Mensaje, más —por la épica— Estado, Responsable y Nota
// interna. «Responder por…» (F-CON-04) abre el cliente externo (correo o WhatsApp) con un texto inicial y deja la
// consulta En curso con responsable: el panel no envía nada.
export function DetalleConsulta(props: Props) {
  return (
    <Dialog open onClose={props.onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-consulta">
      {/* El formulario se monta con el sello vigente: tras «Recargar» parte de los datos nuevos. */}
      <Formulario key={`${props.consulta.id}|${props.consulta.updated_at}`} {...props} />
    </Dialog>
  )
}

function Formulario({ consulta, puedeEditar, onCerrar, onGuardado, onRecargar }: Props) {
  const [estado, setEstado] = useState<EstadoConsulta>(consulta.estado)
  const [responsableId, setResponsableId] = useState(consulta.responsable_id ?? '')
  const [nota, setNota] = useState(consulta.nota_interna ?? '')
  const [errorServidor, setErrorServidor] = useState<{ texto: string; conflicto: boolean; alResponder?: boolean } | null>(null)
  const [guardando, setGuardando] = useState(false)
  // El estado asíncrono llega tarde a un segundo clic inmediato: el ref lo frena.
  const enVuelo = useRef(false)
  const { responsables, isLoading: cargandoResponsables, isError: errorResponsables } = useResponsablesConsultas(
    puedeEditar ? consulta.empresa_id : null,
  )

  const respuesta = enlaceRespuesta(consulta)
  // La persona asignada puede haber dejado de ser elegible: se la sigue mostrando para no perderla de vista.
  const opcionesResponsable = responsables.some((r) => r.user_id === consulta.responsable_id) || !consulta.responsable_id
    ? responsables
    : [{ user_id: consulta.responsable_id, nombre: consulta.responsable_nombre ?? 'Responsable actual' }, ...responsables]

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (!puedeEditar || enVuelo.current) return
    enVuelo.current = true
    setGuardando(true)
    setErrorServidor(null)
    try {
      await actualizarConsulta({
        id: consulta.id,
        estado,
        responsableId: responsableId === '' ? null : responsableId,
        nota,
        actualizadoEn: consulta.updated_at,
      })
      onGuardado(`Consulta guardada · ${consulta.nombre}`)
    } catch (error) {
      setErrorServidor({
        texto: mensajeDeError(error, 'No pudimos guardar la consulta. Intentá de nuevo.'),
        conflicto: esConflicto(error),
      })
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  // Registra la respuesta (FR-010). Se llama tras abrir la app externa y también al reintentar, sin reabrirla.
  // Registra lo que la persona tiene en el formulario (estado, responsable y nota), no la foto leída al
  // abrir: si no, lo recién editado se pierde sin aviso (MSF-698).
  const registrar = async () => {
    if (!puedeEditar || enVuelo.current) return
    enVuelo.current = true
    setGuardando(true)
    setErrorServidor(null)
    try {
      const { usuarioId, cambios } = await registrarRespuesta(consulta, {
        estado,
        responsableId: responsableId === '' ? null : responsableId,
        nota,
      })
      onGuardado(avisoRespuestaRegistrada(cambios, {
        nombreConsulta: consulta.nombre,
        nombreResponsable:
          opcionesResponsable.find((persona) => persona.user_id === cambios.responsableId)?.nombre
          ?? consulta.responsable_nombre,
      }, usuarioId))
    } catch (error) {
      setErrorServidor({
        texto: mensajeDeError(error, 'Abrimos la aplicación, pero no pudimos registrar la respuesta. Intentá de nuevo.'),
        conflicto: esConflicto(error),
        alResponder: true,
      })
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  // El enlace se abre en el mismo gesto del clic (para que no lo bloquee el navegador) y recién después
  // se registra. El panel no envía nada: la persona manda el mensaje desde WhatsApp o su correo.
  const responder = () => {
    if (!respuesta || !puedeEditar || enVuelo.current) return
    window.open(respuesta.href, '_blank', 'noopener,noreferrer')
    void registrar()
  }

  return (
    <Box component="form" onSubmit={enviar} noValidate>
      <TituloDialogo id="titulo-consulta" onCerrar={guardando ? undefined : onCerrar}>
        Consulta de {consulta.nombre}
      </TituloDialogo>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {errorServidor ? (
            <EstadoError
              titulo={errorServidor.conflicto
                ? 'La consulta cambió.'
                : errorServidor.alResponder ? 'No se registró la respuesta.' : 'No se guardó la consulta.'}
              descripcion={errorServidor.texto}
              reintentar={errorServidor.conflicto ? onRecargar : errorServidor.alResponder ? () => void registrar() : undefined}
              etiquetaReintentar={errorServidor.conflicto ? 'Recargar' : 'Reintentar'}
            />
          ) : null}

          <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
            <Chip size="small" color="primary" variant="outlined" label={consulta.empresa_nombre} />
            <Chip size="small" variant="outlined" label={ETIQUETA_ORIGEN_CONSULTA[consulta.origen]} />
            <Chip size="small" color={COLOR_ESTADO_CONSULTA[consulta.estado]} label={ETIQUETA_ESTADO_CONSULTA[consulta.estado]} />
            <Typography variant="xs" sx={{ ml: 'auto' }}>{formatearCuando(consulta.created_at)}</Typography>
          </Stack>

          <Box>
            <Typography variant="xs">Contacto</Typography>
            <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{consulta.contacto}</Typography>
          </Box>
          <Box>
            <Typography variant="xs">Producto de interés</Typography>
            <Typography sx={{ fontWeight: 600 }}>{nombreProducto(consulta)}</Typography>
          </Box>
          <Box>
            <Typography variant="xs">Mensaje</Typography>
            {/* Texto del visitante: se muestra como texto plano (React lo escapa) y respeta los saltos de línea. */}
            <Typography variant="bl" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', bgcolor: 'action.hover', borderRadius: 1, p: 1.5 }}>
              {consulta.mensaje ?? (consulta.origen === 'whatsapp'
                ? 'Interés desde la ficha del producto: abrió el chat de WhatsApp. No dejó mensaje.'
                : 'No dejó mensaje.')}
            </Typography>
          </Box>

          {puedeEditar ? null : (
            <Typography variant="xs" role="note">Solo lectura: tu rol puede ver las consultas pero no cambiarlas.</Typography>
          )}

          <TextField
            select
            label="Estado"
            size="small"
            value={estado}
            onChange={(evento) => setEstado(evento.target.value as EstadoConsulta)}
            disabled={!puedeEditar || guardando}
          >
            {ESTADOS_CONSULTA.map((valor) => (
              <MenuItem key={valor} value={valor}>{ETIQUETA_ESTADO_CONSULTA[valor]}</MenuItem>
            ))}
          </TextField>
          {puedeEditar ? (
            <TextField
              select
              label="Responsable"
              size="small"
              value={responsableId}
              onChange={(evento) => setResponsableId(evento.target.value)}
              disabled={guardando || cargandoResponsables}
              error={errorResponsables}
              helperText={errorResponsables ? 'No pudimos cargar a las personas que se pueden asignar.' : undefined}
            >
              <MenuItem value="">Sin responsable</MenuItem>
              {opcionesResponsable.map((persona) => (
                <MenuItem key={persona.user_id} value={persona.user_id}>{persona.nombre}</MenuItem>
              ))}
            </TextField>
          ) : (
            <TextField label="Responsable" size="small" value={consulta.responsable_nombre ?? 'Sin responsable'} disabled />
          )}
          <TextField
            label="Nota interna"
            size="small"
            multiline
            minRows={3}
            value={nota}
            onChange={(evento) => setNota(evento.target.value)}
            disabled={!puedeEditar || guardando}
            slotProps={{ htmlInput: { maxLength: NOTA_MAXIMA } }}
            helperText={puedeEditar ? `Solo la ve el equipo. ${nota.length}/${NOTA_MAXIMA}` : undefined}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar} disabled={guardando}>Cerrar</Button>
        {respuesta ? (
          <Tooltip title={puedeEditar ? '' : 'Necesitás permiso de edición'}>
            <span>
              <Button type="button" variant="outlined" onClick={responder} disabled={!puedeEditar || guardando}>
                Responder por {respuesta.via}
              </Button>
            </span>
          </Tooltip>
        ) : null}
        {puedeEditar ? (
          <Button type="submit" variant="contained" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</Button>
        ) : null}
      </DialogActions>
    </Box>
  )
}
