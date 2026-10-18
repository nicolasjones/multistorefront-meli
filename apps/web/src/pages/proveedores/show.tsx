import { useCallback, useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router'
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, Stack, Typography,
} from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { formatearCuit } from '../../lib/cuit'
import {
  type Proveedor,
  COLUMNAS_PROVEEDOR,
  cambiarEstadoProveedor,
  mensajeDeError,
} from '../../lib/proveedores'
import { supabaseClient } from '../../lib/supabase'
import { EstadoCargaPagina, EstadoError, EstadoExito } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { TituloDialogo } from '../../components/base/TituloDialogo'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { ProveedorFormDialog } from '../../components/proveedores/ProveedorFormDialog'

const DATOS: ReadonlyArray<{ campo: keyof Proveedor; etiqueta: string; formato?: (valor: string) => string }> = [
  { campo: 'razon_social', etiqueta: 'Razón social' },
  { campo: 'cuit', etiqueta: 'CUIT', formato: formatearCuit },
  { campo: 'persona_contacto', etiqueta: 'Persona de contacto' },
  { campo: 'telefono', etiqueta: 'Teléfono' },
  { campo: 'correo', etiqueta: 'Correo' },
  { campo: 'direccion', etiqueta: 'Dirección' },
  { campo: 'observaciones', etiqueta: 'Observaciones' },
]

// Ficha de proveedor (F-PRV-01, FR-008): datos, estado y, para quien edita, Editar y
// Desactivar/Reactivar con confirmación. No existe «Eliminar» (el documento manda sobre
// el prototipo: spec, Decisiones abiertas 1). La autoridad es RLS dentro de las RPC.
export function ProveedorShow() {
  const { id } = useParams()
  const { nivel, isLoading: verificandoPermiso } = useNivelSeccion('proveedores')
  const [proveedor, setProveedor] = useState<Proveedor | null>(null)
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const [editando, setEditando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [procesando, setProcesando] = useState(false)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)
  const [confirmacion, setConfirmacion] = useState<string | null>(null)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    setHayError(false)
    try {
      const { data, error } = await supabaseClient
        .schema('dominio')
        .from('proveedores')
        .select(COLUMNAS_PROVEEDOR)
        .eq('id', id ?? '')
        .maybeSingle<Proveedor>()
      if (error) throw error
      if (peticion === ultimaPeticion.current) setProveedor(data)
    } catch (error) {
      console.error('No pudimos cargar el proveedor.', error)
      if (peticion === ultimaPeticion.current) setHayError(true)
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [id])

  useEffect(() => {
    if (!verificandoPermiso && nivel !== null) {
      void cargar()
    }
  }, [cargar, nivel, verificandoPermiso])

  const puedeEditar = nivel === 'edicion'
  const activo = proveedor?.activo ?? true

  const cambiarEstado = async () => {
    if (!proveedor || procesando) {
      return
    }
    setProcesando(true)
    setErrorAccion(null)
    try {
      const nuevo = await cambiarEstadoProveedor(proveedor.id, !activo)
      setProveedor(nuevo)
      setConfirmacion(activo ? 'Proveedor desactivado' : 'Proveedor reactivado')
      setConfirmando(false)
    } catch (error) {
      setErrorAccion(mensajeDeError(error, 'No pudimos completar la acción. Intentá de nuevo.'))
      setConfirmando(false)
    } finally {
      setProcesando(false)
    }
  }

  const accion = (
    <Stack direction="row" spacing={1}>
      <Button component={RouterLink} to="/proveedores">Proveedores</Button>
      {puedeEditar && proveedor ? (
        <>
          <Button variant="contained" onClick={() => { setConfirmacion(null); setEditando(true) }}>Editar</Button>
          <Button variant="outlined" color={activo ? 'warning' : 'primary'} onClick={() => setConfirmando(true)}>
            {activo ? 'Desactivar' : 'Reactivar'}
          </Button>
        </>
      ) : null}
    </Stack>
  )

  return (
    <Box>
      <EncabezadoPagina
        titulo={proveedor?.razon_social ?? 'Proveedor'}
        accion={accion}
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        {cargando || verificandoPermiso ? (
          <EstadoCargaPagina />
        ) : hayError ? (
          <EstadoError descripcion="No pudimos cargar el proveedor." reintentar={() => void cargar()} />
        ) : !proveedor ? (
          <EstadoError titulo="Proveedor no encontrado" descripcion="No existe o no pertenece a tu organización." />
        ) : (
          <Stack spacing={2}>
            {confirmacion ? <EstadoExito titulo={confirmacion} /> : null}
            {errorAccion ? <EstadoError titulo="No se completó la acción." descripcion={errorAccion} /> : null}
            <Stack direction="row" spacing={1} role="status">
              <EtiquetaEstado texto={activo ? 'Activo' : 'Inactivo'} variante={activo ? 'exito' : 'aviso'} />
            </Stack>
            <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '12rem 1fr' }, gap: 1 }}>
              {DATOS.map(({ campo, etiqueta, formato }) => {
                const valor = proveedor[campo] as string | null
                return (
                  <Box key={campo} sx={{ display: 'contents' }}>
                    <Typography component="dt" color="text.secondary">{etiqueta}</Typography>
                    <Typography component="dd" sx={{ m: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {valor ? (formato ? formato(valor) : valor) : '—'}
                    </Typography>
                  </Box>
                )
              })}
            </Box>
          </Stack>
        )}
      </ContenedorSeccion>
      {/* Se monta solo al editar: cada apertura parte de los datos vigentes de la ficha. */}
      {editando && proveedor ? (
        <ProveedorFormDialog
          open
          proveedor={proveedor}
          onCerrar={() => setEditando(false)}
          onGuardado={(guardado) => {
            setProveedor(guardado)
            setEditando(false)
            setErrorAccion(null)
            setConfirmacion('Proveedor guardado')
          }}
          onRecargar={() => {
            setEditando(false)
            void cargar()
          }}
        />
      ) : null}
      <Dialog open={confirmando} onClose={() => !procesando && setConfirmando(false)} aria-labelledby="titulo-confirmar-estado-proveedor">
        <TituloDialogo id="titulo-confirmar-estado-proveedor" onCerrar={() => !procesando && setConfirmando(false)}>
          {activo ? 'Desactivar proveedor' : 'Reactivar proveedor'}
        </TituloDialogo>
        <DialogContent>
          <DialogContentText>
            {activo
              ? 'Queda archivado: no se elige en nuevos ingresos ni productos, pero conserva sus datos y se puede reactivar.'
              : 'El proveedor vuelve a estar activo con todos sus datos y se puede elegir de nuevo en ingresos y productos.'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmando(false)} disabled={procesando}>Cancelar</Button>
          <Button onClick={() => void cambiarEstado()} variant="contained" disabled={procesando} autoFocus>
            {procesando ? 'Procesando…' : activo ? 'Desactivar proveedor' : 'Reactivar proveedor'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
