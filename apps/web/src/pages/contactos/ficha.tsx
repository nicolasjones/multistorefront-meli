import { type FormEvent, useRef, useState } from 'react'
import { Link as RouterLink, Navigate, useParams } from 'react-router'
import {
  Alert, Box, Button, Chip, List, ListItem, ListItemText, Snackbar, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { AVISO_CAMBIO_EMPRESA, useEmpresaActivaCambio, useFichaContacto, useHistorialContacto } from '../../hooks/useContactos'
import {
  TEXTO_SIN_PERMISO_EDICION,
  actualizarContacto,
  contactoExistenteDe,
  esConflicto,
  mensajeDeError,
  vincularComprobante,
  type EntradaHistorial,
  type FichaContacto,
} from '../../lib/contactos'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { AnonimizarContactoDialog } from './AnonimizarContactoDialog'
import { VincularComprobanteDialog } from './VincularComprobanteDialog'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const formatearFecha = (iso: string) => {
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? '—' : fecha.toLocaleDateString('es-AR')
}

// Ficha del contacto (F-CON-05, FR-006, FR-008, FR-010): edita nombre, correo y teléfono con bloqueo
// optimista, muestra el historial de consultas y compras y permite vincular comprobantes y anonimizar.
// Si cambia la empresa activa vuelve a la libreta con aviso (Principio VIII): no queda nada de la anterior.
export function ContactoFicha() {
  const { id: parametro } = useParams()
  const id = parametro !== undefined && UUID.test(parametro) ? parametro : null
  const cambioEmpresa = useEmpresaActivaCambio()
  const { ficha, isLoading, isError, noEncontrado, refetch } = useFichaContacto(id)

  if (cambioEmpresa) return <Navigate to="/contactos" replace state={{ aviso: AVISO_CAMBIO_EMPRESA }} />

  return (
    <Box>
      <EncabezadoPagina
        titulo={ficha && !ficha.anonimizado_en ? ficha.nombre : 'Contacto'}
        descripcion="Datos, consentimiento e historial de consultas y compras."
        contexto={<ContextoOrganizacionActiva />}
        accion={<Button component={RouterLink} to="/contactos" variant="outlined">Volver a Contactos</Button>}
      />
      <ContenedorSeccion>
        {id === null || noEncontrado ? (
          <EstadoVacio titulo="No encontramos ese contacto." descripcion="No existe o no tenés acceso a su empresa." />
        ) : isLoading ? (
          <EstadoCargaPagina />
        ) : isError || !ficha ? (
          <EstadoError descripcion="No pudimos cargar el contacto." reintentar={() => void refetch()} />
        ) : (
          <Contenido key={`${ficha.id}|${ficha.updated_at}`} ficha={ficha} recargar={() => void refetch()} />
        )}
      </ContenedorSeccion>
    </Box>
  )
}

function Contenido({ ficha, recargar }: { ficha: FichaContacto; recargar: () => void }) {
  const { nivel } = useNivelSeccion('consultas')
  const puedeEditar = nivel === 'edicion'
  const anonimizado = ficha.anonimizado_en !== null
  const soloLectura = !puedeEditar || anonimizado
  const historial = useHistorialContacto(ficha.id)

  const [nombre, setNombre] = useState(ficha.nombre)
  const [correo, setCorreo] = useState(ficha.correo ?? '')
  const [telefono, setTelefono] = useState(ficha.telefono ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<{ texto: string; conflicto: boolean } | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [anonimizando, setAnonimizando] = useState(false)
  const [vinculando, setVinculando] = useState(false)
  const enVuelo = useRef(false)

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (soloLectura || enVuelo.current) return
    enVuelo.current = true
    setGuardando(true)
    setError(null)
    try {
      await actualizarContacto({ id: ficha.id, nombre, correo, telefono, actualizadoEn: ficha.updated_at })
      setAviso('Contacto guardado')
      recargar()
    } catch (e) {
      const existente = contactoExistenteDe(e)
      setError({
        texto: existente
          ? 'Ya existe otro contacto con ese correo o teléfono en esta empresa.'
          : mensajeDeError(e, 'No pudimos guardar el contacto. Intentá de nuevo.'),
        conflicto: esConflicto(e),
      })
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  const desvincular = async (entrada: EntradaHistorial) => {
    if (!puedeEditar || enVuelo.current) return
    enVuelo.current = true
    setError(null)
    try {
      await vincularComprobante(entrada.referencia_id, null)
      void historial.refetch()
    } catch (e) {
      setError({ texto: mensajeDeError(e, 'No pudimos desvincular el comprobante.'), conflicto: false })
    } finally {
      enVuelo.current = false
    }
  }

  const tooltip = !puedeEditar ? TEXTO_SIN_PERMISO_EDICION : ''

  return (
    <Stack spacing={3}>
      {error ? (
        <Alert
          severity="error"
          action={error.conflicto ? <Button color="inherit" size="small" onClick={recargar}>Recargar</Button> : undefined}
        >
          {error.texto}
        </Alert>
      ) : null}
      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
        <Chip size="small" color={anonimizado ? 'default' : 'success'} variant={anonimizado ? 'outlined' : 'filled'} label={anonimizado ? 'Anonimizado' : 'Activo'} />
        <Typography variant="xs">
          Consentimiento registrado el {formatearFecha(ficha.consentimiento_en)}
        </Typography>
      </Stack>
      {anonimizado ? (
        <Alert severity="info">Este contacto fue anonimizado: sus datos personales ya no existen y la ficha es de solo lectura.</Alert>
      ) : null}

      <Box component="form" onSubmit={(evento: FormEvent) => void guardar(evento)} noValidate>
        <Stack spacing={2} sx={{ maxWidth: 480 }}>
          <TextField label="Nombre" size="small" value={nombre} onChange={(e) => setNombre(e.target.value)} disabled={soloLectura || guardando} slotProps={{ htmlInput: { maxLength: 120 } }} />
          <TextField label="Correo" type="email" size="small" value={correo} onChange={(e) => setCorreo(e.target.value)} disabled={soloLectura || guardando} slotProps={{ htmlInput: { maxLength: 200 } }} />
          <TextField label="Teléfono" type="tel" size="small" value={telefono} onChange={(e) => setTelefono(e.target.value)} disabled={soloLectura || guardando} slotProps={{ htmlInput: { maxLength: 40 } }} />
          {!anonimizado ? (
            <Stack direction="row" spacing={1}>
              <Tooltip title={tooltip}>
                <span>
                  <Button type="submit" variant="contained" disabled={soloLectura || guardando}>{guardando ? 'Guardando…' : 'Guardar'}</Button>
                </span>
              </Tooltip>
              <Tooltip title={tooltip}>
                <span>
                  <Button type="button" color="error" variant="outlined" onClick={() => setAnonimizando(true)} disabled={!puedeEditar || guardando}>Anonimizar</Button>
                </span>
              </Tooltip>
            </Stack>
          ) : null}
        </Stack>
      </Box>

      <Box component="section" aria-labelledby="titulo-historial">
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography id="titulo-historial" component="h2" variant="t2">Historial</Typography>
          {!anonimizado ? (
            <Tooltip title={tooltip}>
              <span>
                <Button size="small" variant="outlined" onClick={() => setVinculando(true)} disabled={!puedeEditar}>Vincular comprobante</Button>
              </span>
            </Tooltip>
          ) : null}
        </Stack>
        {historial.isLoading ? (
          <EstadoCargaPagina lineas={2} />
        ) : historial.isError ? (
          <EstadoError descripcion="No pudimos cargar el historial." reintentar={() => void historial.refetch()} />
        ) : historial.historial.length === 0 ? (
          <EstadoVacio titulo="Sin historial todavía." descripcion="Acá aparecen las consultas y las compras vinculadas a este contacto." />
        ) : (
          <List aria-label="Historial del contacto" disablePadding>
            {historial.historial.map((entrada) => (
              <ListItem
                key={`${entrada.tipo}-${entrada.referencia_id}`}
                divider
                secondaryAction={entrada.tipo === 'compra' && puedeEditar ? (
                  <Button size="small" onClick={() => void desvincular(entrada)}>Desvincular</Button>
                ) : undefined}
              >
                <ListItemText
                  primary={`${entrada.tipo === 'consulta' ? 'Consulta' : 'Compra'} · ${entrada.resumen}`}
                  secondary={[
                    formatearFecha(entrada.fecha),
                    entrada.empresa_nombre,
                    entrada.estado,
                    entrada.total === null ? null : `$ ${entrada.total.toLocaleString('es-AR')}`,
                  ].filter(Boolean).join(' · ')}
                  slotProps={{ primary: { sx: { overflowWrap: 'anywhere' } } }}
                />
              </ListItem>
            ))}
          </List>
        )}
      </Box>

      {anonimizando ? (
        <AnonimizarContactoDialog
          contactoId={ficha.id}
          actualizadoEn={ficha.updated_at}
          onCerrar={() => setAnonimizando(false)}
          onAnonimizado={() => {
            setAnonimizando(false)
            setAviso('Contacto anonimizado')
            recargar()
          }}
          onRecargar={() => {
            setAnonimizando(false)
            recargar()
          }}
        />
      ) : null}
      {vinculando ? (
        <VincularComprobanteDialog
          contactoId={ficha.id}
          empresaId={ficha.empresa_id}
          onCerrar={() => setVinculando(false)}
          onVinculado={() => {
            setVinculando(false)
            void historial.refetch()
          }}
        />
      ) : null}
      <Snackbar open={aviso !== null} autoHideDuration={4000} onClose={() => setAviso(null)}>
        <Alert severity="success" onClose={() => setAviso(null)}>{aviso}</Alert>
      </Snackbar>
    </Stack>
  )
}
