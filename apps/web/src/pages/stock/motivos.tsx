import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, FormControl, FormControlLabel, FormGroup,
  FormHelperText, FormLabel, Stack, TextField, Typography,
} from '@mui/material'
import { useOrganizacionDeTrabajo } from '../../hooks/useOrganizacionDeTrabajo'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { supabaseClient } from '../../lib/supabase'
import { LARGO_MAXIMO_MOTIVO, TIPOS_MOVIMIENTO, mensajeDeErrorStock, type MotivoMovimiento, type TipoMovimiento } from '../../lib/stock'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { TituloDialogo } from '../../components/base/TituloDialogo'
import { AccesoRestringido } from '../acceso-restringido/AccesoRestringido'

type Edicion = { id: string | null; nombre: string; aplica_a: TipoMovimiento[] }

const EDICION_NUEVA: Edicion = { id: null, nombre: '', aplica_a: ['entrada', 'salida', 'ajuste'] }

// Editor de motivos de movimiento (F-STK-02, FR-019; reutilizado en «Listas configurables»,
// F-CFG-01 FR-013): alta, renombre, tipos a los que aplica y activar/desactivar, sin borrado.
// No decide el acceso: quien lo monta (`MotivosMovimiento`, `ListasConfigurables`) ya exigió
// Administrador; la autoridad real es RLS de dominio.motivos_movimiento (private.puede_escribir()).
export function PanelMotivos() {
  const { organizacionId } = useOrganizacionDeTrabajo()
  const [motivos, setMotivos] = useState<MotivoMovimiento[] | null>(null)
  const [hayError, setHayError] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [edicion, setEdicion] = useState<Edicion | null>(null)
  const [intento, setIntento] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setHayError(false)
    try {
      const { data, error } = await supabaseClient
        .schema('dominio')
        .from('motivos_movimiento')
        .select('id, nombre, aplica_a, activo')
        .order('nombre', { ascending: true })
        .returns<MotivoMovimiento[]>()
      if (error) throw error
      if (peticion === ultimaPeticion.current) setMotivos(data ?? [])
    } catch (error) {
      console.error('No pudimos cargar los motivos.', error)
      if (peticion === ultimaPeticion.current) setHayError(true)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const nombreRecortado = edicion?.nombre.trim() ?? ''
  const errorNombre = intento && edicion
    ? nombreRecortado === '' ? 'Ingresá el nombre del motivo.'
      : nombreRecortado.length > LARGO_MAXIMO_MOTIVO ? `Máximo ${LARGO_MAXIMO_MOTIVO} caracteres.` : null
    : null
  const errorTipos = intento && edicion && edicion.aplica_a.length === 0 ? 'Elegí al menos un tipo de movimiento.' : null

  const cerrar = () => {
    if (guardando) return
    setEdicion(null); setIntento(false); setErrorGuardado(null)
  }

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (!edicion || guardando) return
    setIntento(true)
    if (nombreRecortado === '' || nombreRecortado.length > LARGO_MAXIMO_MOTIVO || edicion.aplica_a.length === 0) return
    setGuardando(true); setErrorGuardado(null)
    try {
      if (edicion.id === null) {
        if (!organizacionId) throw new Error('Sin organización de trabajo')
        const { error } = await supabaseClient
          .schema('dominio')
          .from('motivos_movimiento')
          .insert({ organizacion_id: organizacionId, nombre: nombreRecortado, aplica_a: edicion.aplica_a })
        if (error) throw error
      } else {
        const { error } = await supabaseClient
          .schema('dominio')
          .from('motivos_movimiento')
          .update({ nombre: nombreRecortado, aplica_a: edicion.aplica_a })
          .eq('id', edicion.id)
        if (error) throw error
      }
      setEdicion(null); setIntento(false)
      await cargar()
    } catch (error) {
      setErrorGuardado(mensajeDeErrorStock(error, 'No pudimos guardar el motivo. Intentá de nuevo.'))
    } finally {
      setGuardando(false)
    }
  }

  const cambiarActivo = async (motivo: MotivoMovimiento) => {
    setAviso(null)
    try {
      const { error } = await supabaseClient
        .schema('dominio')
        .from('motivos_movimiento')
        .update({ activo: !motivo.activo })
        .eq('id', motivo.id)
      if (error) throw error
      await cargar()
    } catch (error) {
      setAviso(mensajeDeErrorStock(error, `No pudimos ${motivo.activo ? 'desactivar' : 'activar'} el motivo. Intentá de nuevo.`))
    }
  }

  const alternarTipo = (tipo: TipoMovimiento) => setEdicion((previa) => previa && ({
    ...previa,
    aplica_a: previa.aplica_a.includes(tipo) ? previa.aplica_a.filter((t) => t !== tipo) : [...previa.aplica_a, tipo],
  }))

  const columnas: ColumnaAdaptable<MotivoMovimiento>[] = [
    { clave: 'nombre', encabezado: 'Motivo', render: (motivo) => <Typography variant="b">{motivo.nombre}</Typography> },
    {
      clave: 'aplica',
      encabezado: 'Aplica a',
      render: (motivo) => TIPOS_MOVIMIENTO.filter((t) => motivo.aplica_a.includes(t.valor)).map((t) => t.etiqueta).join(', '),
    },
    {
      clave: 'estado',
      encabezado: 'Estado',
      render: (motivo) => <EtiquetaEstado texto={motivo.activo ? 'Activo' : 'Inactivo'} variante={motivo.activo ? 'exito' : 'neutral'} />,
    },
  ]

  return (
    <Box>
      <Stack spacing={2}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="contained" onClick={() => setEdicion(EDICION_NUEVA)}>Nuevo motivo</Button>
        </Box>
        {aviso ? <Alert severity="error">{aviso}</Alert> : null}
        {hayError ? (
          <EstadoError descripcion="No pudimos cargar los motivos." reintentar={() => void cargar()} />
        ) : motivos === null ? (
          <EstadoCargaPagina />
        ) : motivos.length === 0 ? (
          <EstadoVacio titulo="Todavía no hay motivos." descripcion="Creá el primero con «Nuevo motivo»." />
        ) : (
          <ContenidoAdaptable
            items={motivos}
            columnas={columnas}
            obtenerClave={(motivo) => motivo.id}
            etiquetaTabla="Motivos de movimiento"
            acciones={(motivo) => (
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  aria-label={`Editar ${motivo.nombre}`}
                  onClick={() => setEdicion({ id: motivo.id, nombre: motivo.nombre, aplica_a: motivo.aplica_a })}
                >
                  Editar
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color={motivo.activo ? 'inherit' : 'primary'}
                  aria-label={`${motivo.activo ? 'Desactivar' : 'Activar'} ${motivo.nombre}`}
                  onClick={() => void cambiarActivo(motivo)}
                >
                  {motivo.activo ? 'Desactivar' : 'Activar'}
                </Button>
              </Stack>
            )}
          />
        )}
      </Stack>
      <Dialog open={edicion !== null} onClose={cerrar} fullWidth maxWidth="xs" aria-labelledby="titulo-motivo">
        <Box component="form" onSubmit={(evento) => void guardar(evento)} noValidate>
          <TituloDialogo id="titulo-motivo" onCerrar={cerrar}>{edicion?.id ? 'Editar motivo' : 'Nuevo motivo'}</TituloDialogo>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {errorGuardado ? <Alert severity="error">{errorGuardado}</Alert> : null}
              <TextField
                label="Nombre"
                value={edicion?.nombre ?? ''}
                onChange={(evento) => setEdicion((previa) => previa && { ...previa, nombre: evento.target.value })}
                required
                autoFocus
                error={Boolean(errorNombre)}
                helperText={errorNombre}
              />
              <FormControl component="fieldset" error={Boolean(errorTipos)}>
                <FormLabel component="legend">Aplica a</FormLabel>
                <FormGroup>
                  {TIPOS_MOVIMIENTO.map((tipo) => (
                    <FormControlLabel
                      key={tipo.valor}
                      label={tipo.etiqueta}
                      control={<Checkbox checked={edicion?.aplica_a.includes(tipo.valor) ?? false} onChange={() => alternarTipo(tipo.valor)} />}
                    />
                  ))}
                </FormGroup>
                {errorTipos ? <FormHelperText>{errorTipos}</FormHelperText> : null}
              </FormControl>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={cerrar} disabled={guardando}>Cancelar</Button>
            <Button type="submit" variant="contained" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Box>
  )
}

// Motivos de movimiento (F-STK-02, FR-019). Solo el Administrador.
export function MotivosMovimiento() {
  const { puedeEscribir, isLoading } = usePuedeEscribir()
  if (isLoading || puedeEscribir === null) return <EstadoCargaPagina />
  if (!puedeEscribir) {
    // Solo el Administrador gestiona motivos: no hay flujo de «pedir acceso» a esta pantalla.
    return <AccesoRestringido rol="actual" seccion="Motivos de movimiento" />
  }
  return (
    <Box>
      <EncabezadoPagina
        titulo="Motivos de movimiento"
        descripcion="Los motivos que se ofrecen al registrar un movimiento de stock."
        accion={<Button component={RouterLink} to="/stock" variant="outlined">Volver a Stock</Button>}
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        <PanelMotivos />
      </ContenedorSeccion>
    </Box>
  )
}
