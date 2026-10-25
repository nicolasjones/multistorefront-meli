import { useState } from 'react'
import { Link as RouterLink, useLocation, useParams } from 'react-router'
import { useOne, useUpdate } from '@refinedev/core'
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, Stack, Typography,
} from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { type Cliente, mensajeDeError } from '../../lib/clientes'
import { EstadoCargaPagina, EstadoError, EstadoExito } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { TituloDialogo } from '../../components/base/TituloDialogo'
import { ComprasCliente } from '../../components/clientes/ComprasCliente'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'

const DATOS: ReadonlyArray<{ campo: keyof Cliente; etiqueta: string }> = [
  { campo: 'documento', etiqueta: 'DNI/CUIT' },
  { campo: 'correo', etiqueta: 'Correo' },
  { campo: 'telefono', etiqueta: 'Teléfono' },
  { campo: 'celular', etiqueta: 'Celular' },
  { campo: 'direccion', etiqueta: 'Dirección' },
  { campo: 'codigo_postal', etiqueta: 'Código postal' },
  { campo: 'localidad', etiqueta: 'Localidad' },
  { campo: 'provincia', etiqueta: 'Provincia' },
  { campo: 'expreso_preferido', etiqueta: 'Expreso preferido' },
]

// Ficha de cliente (F-CLI-01, FR-003): datos, estado y, para quien edita,
// Editar y Archivar/Restaurar con confirmación. No existe «Eliminar».
export function ClienteShow() {
  const { id } = useParams()
  const location = useLocation()
  const { nivel, isLoading: verificandoPermiso } = useNivelSeccion('clientes')
  const { query } = useOne<Cliente>({ resource: 'clientes', id })
  const { mutateAsync } = useUpdate()
  const [confirmando, setConfirmando] = useState(false)
  const [procesando, setProcesando] = useState(false)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)
  const [confirmacion, setConfirmacion] = useState<string | null>((location.state as { mensaje?: string } | null)?.mensaje ?? null)

  const cliente = query.data?.data
  // El Consumidor final es del mostrador: la base lo hace inmutable (FR-009) y acá no se ofrecen acciones.
  const puedeEditar = nivel === 'edicion' && !cliente?.es_consumidor_final
  const archivado = Boolean(cliente?.archivado_en)

  const cambiarArchivado = async () => {
    if (!cliente || procesando) {
      return
    }
    setProcesando(true)
    setErrorAccion(null)
    try {
      await mutateAsync({
        resource: 'clientes',
        id: cliente.id,
        values: { archivado_en: archivado ? null : new Date().toISOString() },
        successNotification: false,
      })
      setConfirmacion(archivado ? 'Cliente restaurado' : 'Cliente archivado')
      setConfirmando(false)
    } catch (error) {
      setErrorAccion(mensajeDeError(error, 'No pudimos completar la acción.'))
    } finally {
      setProcesando(false)
    }
    // Fuera del try: si el refetch falla, el cambio ya se guardó y no es un error de la acción.
    await query.refetch().catch(() => undefined)
  }

  const accion = (
    <Stack direction="row" spacing={1}>
      <Button component={RouterLink} to="/clientes">Volver al listado</Button>
      {puedeEditar && cliente ? (
        <>
          <Button component={RouterLink} to={`/clientes/edit/${cliente.id}`} variant="contained">Editar</Button>
          <Button variant="outlined" color={archivado ? 'primary' : 'warning'} onClick={() => setConfirmando(true)}>
            {archivado ? 'Restaurar' : 'Archivar'}
          </Button>
        </>
      ) : null}
    </Stack>
  )

  return (
    <Box>
      <EncabezadoPagina
        titulo={cliente?.nombre ?? 'Cliente'}
        descripcion={cliente ? `Cliente Nº ${cliente.numero}` : undefined}
        accion={accion}
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        {query.isLoading || verificandoPermiso ? (
          <EstadoCargaPagina />
        ) : query.isError ? (
          <EstadoError descripcion="No pudimos cargar el cliente." reintentar={() => void query.refetch()} />
        ) : !cliente ? (
          <EstadoError titulo="Cliente no encontrado" descripcion="No existe o no pertenece a tu organización." />
        ) : (
          <Stack spacing={2}>
            {confirmacion ? <EstadoExito titulo={confirmacion} /> : null}
            {errorAccion ? <EstadoError titulo="No se completó la acción." descripcion={errorAccion} /> : null}
            <Stack direction="row" spacing={1} role="status">
              <EtiquetaEstado texto={archivado ? 'Archivado' : 'Activo'} variante={archivado ? 'aviso' : 'exito'} />
              <EtiquetaEstado texto={cliente.tipo === 'mayorista' ? 'Mayorista' : 'Minorista'} variante="neutral" />
              {cliente.es_consumidor_final ? <EtiquetaEstado texto="Cliente de mostrador" variante="neutral" /> : null}
            </Stack>
            {cliente.es_consumidor_final ? (
              <Typography color="text.secondary">
                El Consumidor final se usa para vender en el mostrador sin cargar un cliente cada vez. No se edita ni se archiva.
              </Typography>
            ) : null}
            <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '12rem 1fr' }, gap: 1 }}>
              {DATOS.map(({ campo, etiqueta }) => (
                <Box key={campo} sx={{ display: 'contents' }}>
                  <Typography component="dt" color="text.secondary">{etiqueta}</Typography>
                  <Typography component="dd" sx={{ m: 0 }}>{(cliente[campo] as string | null) || '—'}</Typography>
                </Box>
              ))}
            </Box>
            {nivel === 'lectura' || nivel === 'edicion' ? <ComprasCliente key={cliente.id} clienteId={cliente.id} /> : null}
          </Stack>
        )}
      </ContenedorSeccion>
      <Dialog open={confirmando} onClose={() => !procesando && setConfirmando(false)} aria-labelledby="titulo-confirmar-archivado">
        <TituloDialogo id="titulo-confirmar-archivado" onCerrar={() => !procesando && setConfirmando(false)}>{archivado ? 'Restaurar cliente' : 'Archivar cliente'}</TituloDialogo>
        <DialogContent>
          <DialogContentText>
            {archivado
              ? 'El cliente vuelve al listado activo con sus datos y su número.'
              : 'El cliente deja de verse en el listado por defecto. No se pierde ningún dato y podés restaurarlo cuando quieras.'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmando(false)} disabled={procesando}>Cancelar</Button>
          <Button onClick={() => void cambiarArchivado()} variant="contained" disabled={procesando} autoFocus>
            {procesando ? 'Procesando…' : archivado ? 'Restaurar' : 'Archivar'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
