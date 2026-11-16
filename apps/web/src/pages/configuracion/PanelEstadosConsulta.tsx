import { type FormEvent, useState } from 'react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, Stack, TextField, Typography } from '@mui/material'
import { useEstadosConsulta } from '../../hooks/useEstadosConsulta'
import { validarNombreItem, type EstadoConsulta } from '../../lib/listas'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { TituloDialogo } from '../../components/base/TituloDialogo'

type Edicion = { id: string | null; nombre: string }

// Editor de estados de consulta (F-CFG-01, FR-014/FR-015): agregar, renombrar y
// activar/desactivar, sin borrar. No decide el acceso (lo exige `ListasConfigurables`); la
// autoridad es la RPC + RLS de dominio.estados_consulta (private.puede_escribir()).
export function PanelEstadosConsulta() {
  const { estados, hayError, recargar, crear, renombrar, cambiarActivo } = useEstadosConsulta()
  const [aviso, setAviso] = useState<string | null>(null)
  const [edicion, setEdicion] = useState<Edicion | null>(null)
  const [intento, setIntento] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null)

  const errorNombre = intento && edicion ? validarNombreItem(edicion.nombre) : null

  const cerrar = () => {
    if (guardando) return
    setEdicion(null); setIntento(false); setErrorGuardado(null)
  }

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (!edicion || guardando) return
    setIntento(true)
    if (validarNombreItem(edicion.nombre)) return
    setGuardando(true); setErrorGuardado(null)
    const error = edicion.id === null ? await crear(edicion.nombre) : await renombrar(edicion.id, edicion.nombre)
    setGuardando(false)
    if (error) { setErrorGuardado(error); return }
    setEdicion(null); setIntento(false)
  }

  const alternarActivo = async (estado: EstadoConsulta) => {
    setAviso(null)
    const error = await cambiarActivo(estado)
    if (error) setAviso(error)
  }

  const columnas: ColumnaAdaptable<EstadoConsulta>[] = [
    { clave: 'nombre', encabezado: 'Nombre', render: (estado) => <Typography variant="b">{estado.nombre}</Typography> },
    {
      clave: 'estado',
      encabezado: 'Situación',
      render: (estado) => (
        <Stack direction="row" spacing={1} alignItems="center">
          <EtiquetaEstado texto={estado.activo ? 'Activo' : 'Inactivo'} variante={estado.activo ? 'exito' : 'neutral'} />
          {estado.es_sistema ? <EtiquetaEstado texto="De sistema" variante="neutral" /> : null}
        </Stack>
      ),
    },
  ]

  return (
    <Box>
      <Stack spacing={2}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="contained" onClick={() => setEdicion({ id: null, nombre: '' })}>Nuevo estado</Button>
        </Box>
        {aviso ? <Alert severity="error">{aviso}</Alert> : null}
        {hayError ? (
          <EstadoError descripcion="No pudimos cargar los estados de consulta." reintentar={() => void recargar()} />
        ) : estados === null ? (
          <EstadoCargaPagina />
        ) : estados.length === 0 ? (
          <EstadoVacio titulo="Todavía no hay estados." descripcion="Creá el primero con «Nuevo estado»." />
        ) : (
          <ContenidoAdaptable
            items={estados}
            columnas={columnas}
            obtenerClave={(estado) => estado.id}
            etiquetaTabla="Estados de consulta"
            acciones={(estado) => {
              const sistema = estado.es_sistema === true
              const idAyuda = `ayuda-sistema-${estado.id}`
              return (
                <Stack direction="row" spacing={1} alignItems="center">
                  <Button
                    size="small"
                    aria-label={`Renombrar ${estado.nombre}`}
                    disabled={sistema}
                    aria-describedby={sistema ? idAyuda : undefined}
                    onClick={() => setEdicion({ id: estado.id, nombre: estado.nombre })}
                  >
                    Renombrar
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color={estado.activo ? 'inherit' : 'primary'}
                    aria-label={`${estado.activo ? 'Desactivar' : 'Activar'} ${estado.nombre}`}
                    disabled={sistema && estado.activo}
                    aria-describedby={sistema ? idAyuda : undefined}
                    onClick={() => void alternarActivo(estado)}
                  >
                    {estado.activo ? 'Desactivar' : 'Activar'}
                  </Button>
                  {sistema ? (
                    <Typography id={idAyuda} variant="caption" color="text.secondary">
                      Es un estado de sistema: lo necesita el cierre de las consultas y no se puede desactivar ni renombrar.
                    </Typography>
                  ) : null}
                </Stack>
              )
            }}
          />
        )}
      </Stack>
      <Dialog open={edicion !== null} onClose={cerrar} fullWidth maxWidth="xs" aria-labelledby="titulo-estado-consulta">
        <Box component="form" onSubmit={(evento) => void guardar(evento)} noValidate>
          <TituloDialogo id="titulo-estado-consulta" onCerrar={cerrar}>{edicion?.id ? 'Renombrar estado' : 'Nuevo estado'}</TituloDialogo>
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
