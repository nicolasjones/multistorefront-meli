import { type FormEvent, useEffect, useRef, useState } from 'react'
import {
  Box, Button, Checkbox, Dialog, DialogActions, DialogContent, FormControlLabel, Stack, TextField, Typography,
} from '@mui/material'
import {
  type ContactoProveedor,
  type DatosContacto,
  agregarContactoProveedor,
  marcarContactoPrincipal,
  useContactosProveedor,
} from '../../hooks/useContactosProveedor'
import { CORREO_VALIDO, mensajeDeError } from '../../lib/proveedores'
import { EtiquetaEstado } from '../base/EtiquetaEstado'
import { TituloDialogo } from '../base/TituloDialogo'
import { EstadoCargaPagina, EstadoError, EstadoExito, EstadoVacio } from '../estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../pagina/ContenidoAdaptable'

type Props = {
  proveedorId: string
  // Agregar y marcar principal solo con edición en Proveedores; la autoridad es la base.
  puedeEditar: boolean
  // Avisa si hay contacto principal tras cada carga (la ficha lo usa para el diálogo «Editar proveedor»).
  onPrincipal?: (hayPrincipal: boolean) => void
  // Tras un cambio de principal la ficha del proveedor cambió: quien la muestra debe releerla.
  onFichaCambiada?: () => void
}

const VACIO: DatosContacto = { nombre: '', rol: '', correo: '', telefono: '', principal: false }

// Sección «Contactos» de la ficha del proveedor (F-PRV-08, FR-025). Se consulta aparte del resto de
// la ficha: un error acá no la afecta.
export function ListaContactos({ proveedorId, puedeEditar, onPrincipal, onFichaCambiada }: Props) {
  const { contactos, cargando, hayError, recargar } = useContactosProveedor(proveedorId)
  const [agregando, setAgregando] = useState(false)
  const [marcando, setMarcando] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const enVuelo = useRef(false)

  const refrescar = async () => {
    await recargar()
    onFichaCambiada?.()
  }

  const hayPrincipal = contactos.some((c) => c.principal)
  useEffect(() => {
    if (!cargando && !hayError) onPrincipal?.(hayPrincipal)
  }, [cargando, hayError, hayPrincipal, onPrincipal])

  const marcar = async (contacto: ContactoProveedor) => {
    if (enVuelo.current) return
    enVuelo.current = true
    setMarcando(contacto.id)
    setError(null)
    setAviso(null)
    try {
      await marcarContactoPrincipal(contacto.id)
      await refrescar()
      setAviso(`${contacto.nombre} es ahora el contacto principal`)
    } catch (e) {
      setError(mensajeDeError(e, 'No pudimos cambiar el contacto principal. Intentá de nuevo.'))
    } finally {
      enVuelo.current = false
      setMarcando(null)
    }
  }

  const columnas: ColumnaAdaptable<ContactoProveedor>[] = [
    {
      clave: 'nombre',
      encabezado: 'Nombre',
      render: (c) => (
        <>
          {c.nombre}
          {c.principal ? <> <EtiquetaEstado texto="Principal" variante="exito" /></> : null}
        </>
      ),
    },
    { clave: 'rol', encabezado: 'Rol', render: (c) => c.rol ?? '—' },
    { clave: 'correo', encabezado: 'Correo', render: (c) => c.correo ?? '—' },
    { clave: 'telefono', encabezado: 'Teléfono', render: (c) => c.telefono ?? '—' },
    ...(puedeEditar
      ? [{
          clave: 'acciones',
          encabezado: 'Acciones',
          render: (c: ContactoProveedor) => (c.principal ? null : (
            <Button
              size="small"
              disabled={marcando !== null}
              onClick={() => void marcar(c)}
              aria-label={`Marcar a ${c.nombre} como principal`}
            >
              Marcar como principal
            </Button>
          )),
        }]
      : []),
  ]

  return (
    <Box component="section" aria-labelledby="titulo-contactos-proveedor" aria-busy={cargando}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography id="titulo-contactos-proveedor" component="h2" variant="h6">Contactos</Typography>
        {puedeEditar ? (
          <Button variant="outlined" size="small" onClick={() => { setAviso(null); setError(null); setAgregando(true) }}>
            Agregar contacto
          </Button>
        ) : null}
      </Stack>
      {aviso ? <EstadoExito titulo={aviso} /> : null}
      {error ? <EstadoError titulo="No se completó la acción." descripcion={error} /> : null}
      {cargando && contactos.length === 0 ? (
        <EstadoCargaPagina />
      ) : hayError ? (
        <EstadoError descripcion="No pudimos cargar los contactos del proveedor." reintentar={() => void recargar()} />
      ) : contactos.length === 0 ? (
        <EstadoVacio titulo="Este proveedor todavía no tiene contactos." />
      ) : (
        <ContenidoAdaptable
          items={contactos}
          columnas={columnas}
          obtenerClave={(c) => c.id}
          etiquetaTabla="Contactos del proveedor"
        />
      )}
      {agregando ? (
        <DialogoNuevoContacto
          proveedorId={proveedorId}
          onCerrar={() => setAgregando(false)}
          onAgregado={async (nombre) => {
            setAgregando(false)
            await refrescar()
            setAviso(`Contacto ${nombre} agregado`)
          }}
        />
      ) : null}
    </Box>
  )
}

type PropsDialogo = {
  proveedorId: string
  onCerrar: () => void
  onAgregado: (nombre: string) => Promise<void>
}

function DialogoNuevoContacto({ proveedorId, onCerrar, onAgregado }: PropsDialogo) {
  const [datos, setDatos] = useState<DatosContacto>(VACIO)
  const [errores, setErrores] = useState<{ nombre?: string; correo?: string }>({})
  const [errorServidor, setErrorServidor] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const enVuelo = useRef(false)

  const cambiar = (campo: 'nombre' | 'rol' | 'correo' | 'telefono') => (valor: string) =>
    setDatos((actual) => ({ ...actual, [campo]: valor }))

  const enviar = async (event: FormEvent) => {
    event.preventDefault()
    if (enVuelo.current) return
    setErrorServidor(null)
    const nuevos: { nombre?: string; correo?: string } = {}
    if (datos.nombre.trim() === '') nuevos.nombre = 'Ingresá el nombre del contacto.'
    const correo = datos.correo.trim()
    if (correo !== '' && !CORREO_VALIDO.test(correo)) {
      nuevos.correo = 'Ingresá un correo con formato válido, por ejemplo nombre@empresa.com.'
    }
    setErrores(nuevos)
    if (nuevos.nombre || nuevos.correo) return
    enVuelo.current = true
    setGuardando(true)
    try {
      await agregarContactoProveedor(proveedorId, { ...datos, nombre: datos.nombre.trim() })
      await onAgregado(datos.nombre.trim())
    } catch (e) {
      setErrorServidor(mensajeDeError(e, 'No pudimos agregar el contacto. Intentá de nuevo.'))
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  return (
    <Dialog open onClose={guardando ? undefined : onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-contacto-nuevo">
      <Box component="form" onSubmit={enviar} noValidate>
        <TituloDialogo id="titulo-contacto-nuevo" onCerrar={guardando ? undefined : onCerrar}>Agregar contacto</TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {errorServidor ? <EstadoError titulo="No se agregó el contacto." descripcion={errorServidor} /> : null}
            <TextField
              label="Nombre" required autoFocus fullWidth autoComplete="off"
              value={datos.nombre} onChange={(e) => cambiar('nombre')(e.target.value)}
              error={Boolean(errores.nombre)} helperText={errores.nombre}
            />
            <TextField label="Rol" fullWidth autoComplete="off" value={datos.rol} onChange={(e) => cambiar('rol')(e.target.value)} />
            <TextField
              label="Correo" type="email" fullWidth autoComplete="off"
              value={datos.correo} onChange={(e) => cambiar('correo')(e.target.value)}
              error={Boolean(errores.correo)} helperText={errores.correo}
            />
            <TextField label="Teléfono" type="tel" fullWidth autoComplete="off" value={datos.telefono} onChange={(e) => cambiar('telefono')(e.target.value)} />
            <FormControlLabel
              control={<Checkbox checked={datos.principal} onChange={(e) => setDatos((a) => ({ ...a, principal: e.target.checked }))} />}
              label="Contacto principal"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCerrar} disabled={guardando}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={guardando}>{guardando ? 'Guardando…' : 'Agregar contacto'}</Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
