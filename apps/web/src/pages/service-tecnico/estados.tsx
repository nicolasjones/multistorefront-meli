import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, IconButton, Snackbar, Stack, Switch, Typography } from '@mui/material'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import {
  cambiarActivoEstado,
  cambiarAvisaCliente,
  listarEstados,
  mensajeDeErrorService,
  moverEstado,
  type EstadoReparacion,
} from '../../lib/serviceTecnico'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { PestanasService } from '../../components/service/PestanasService'
import { EstadoFormDialog } from '../../components/service/EstadoFormDialog'

// Service técnico · Estados de reparación (F-SVC-01, FR-008). «Avisa al cliente» y «Cierra la reparación» solo se
// guardan y se muestran: esta épica no envía ningún aviso (FR-006). La autoridad de acceso es RLS.
export function ServicioEstados() {
  const { nivel } = useNivelSeccion('service_tecnico')
  const puedeEditar = nivel === 'edicion'
  const [estados, setEstados] = useState<EstadoReparacion[] | null>(null)
  const [hayError, setHayError] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [dialogoAbierto, setDialogoAbierto] = useState(false)
  const [editando, setEditando] = useState<EstadoReparacion | null>(null)
  // Una sola operación a la vez: el reorden y el switch dependen del orden / updated_at recién leído.
  const [ocupado, setOcupado] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setHayError(false)
    try {
      const datos = await listarEstados()
      if (peticion === ultimaPeticion.current) setEstados(datos)
    } catch (error) {
      console.error('No pudimos cargar los estados.', error)
      if (peticion === ultimaPeticion.current) setHayError(true)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const ejecutar = async (operacion: () => Promise<void>, porDefecto: string) => {
    if (ocupado) return
    setOcupado(true)
    setAviso(null)
    try {
      await operacion()
    } catch (error) {
      setAviso(mensajeDeErrorService(error, porDefecto))
    } finally {
      await cargar()
      setOcupado(false)
    }
  }

  const columnas: ColumnaAdaptable<EstadoReparacion>[] = [
    {
      clave: 'orden',
      encabezado: 'Orden',
      render: (estado) => {
        const posicion = (estados ?? []).findIndex((e) => e.id === estado.id)
        const ultimo = (estados?.length ?? 0) - 1
        return (
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Typography component="span" variant="body2" sx={{ minWidth: 20 }}>{posicion + 1}</Typography>
            {puedeEditar ? (
              <>
                <IconButton
                  size="small"
                  aria-label={`Subir ${estado.nombre}`}
                  disabled={ocupado || posicion <= 0}
                  onClick={() => void ejecutar(() => moverEstado(estado.id, 'subir'), 'No pudimos subir el estado. Intentá de nuevo.')}
                >
                  <ArrowUpwardIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  aria-label={`Bajar ${estado.nombre}`}
                  disabled={ocupado || posicion === ultimo}
                  onClick={() => void ejecutar(() => moverEstado(estado.id, 'bajar'), 'No pudimos bajar el estado. Intentá de nuevo.')}
                >
                  <ArrowDownwardIcon fontSize="small" />
                </IconButton>
              </>
            ) : null}
          </Stack>
        )
      },
    },
    { clave: 'nombre', encabezado: 'Estado', render: (estado) => <EtiquetaEstado texto={estado.nombre} variante={estado.tono} /> },
    { clave: 'descripcion', encabezado: 'Qué significa', render: (estado) => estado.descripcion },
    {
      clave: 'avisa_cliente',
      encabezado: 'Avisa al cliente',
      render: (estado) => (
        <Switch
          checked={estado.avisa_cliente}
          disabled={!puedeEditar || ocupado}
          onChange={() => void ejecutar(() => cambiarAvisaCliente(estado, !estado.avisa_cliente), 'No pudimos guardar el cambio. Intentá de nuevo.')}
          slotProps={{ input: { 'aria-label': `Avisa al cliente: ${estado.nombre}` } }}
        />
      ),
    },
    { clave: 'cierra', encabezado: 'Cierra la reparación', render: (estado) => (estado.cierra ? 'Sí' : '—') },
    {
      clave: 'activo',
      encabezado: 'Activo',
      render: (estado) => (
        <Switch
          checked={estado.activo}
          disabled={!puedeEditar || ocupado}
          onChange={() =>
            void ejecutar(
              () => cambiarActivoEstado(estado.id, !estado.activo),
              `No pudimos ${estado.activo ? 'desactivar' : 'activar'} el estado. Intentá de nuevo.`,
            )
          }
          slotProps={{ input: { 'aria-label': `Activo: ${estado.nombre}` } }}
        />
      ),
    },
    ...(puedeEditar
      ? [
          {
            clave: 'acciones',
            encabezado: 'Acciones',
            render: (estado: EstadoReparacion) => (
              <Button size="small" onClick={() => { setEditando(estado); setDialogoAbierto(true) }} aria-label={`Editar ${estado.nombre}`}>
                Editar
              </Button>
            ),
          },
        ]
      : []),
  ]

  return (
    <Box>
      <EncabezadoPagina
        titulo="Estados de reparación"
        descripcion="Las etapas por las que pasa un equipo. El orden define el flujo."
        accion={puedeEditar ? <Button variant="contained" onClick={() => { setEditando(null); setDialogoAbierto(true) }}>Nuevo estado</Button> : undefined}
        contexto={<ContextoOrganizacionActiva />}
        pestanas={<PestanasService activa="estados" />}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          <Alert severity="info">
            Los estados valen para toda la organización: el flujo es el mismo en todas las tiendas. Cada reparación sigue
            perteneciendo a la tienda que la recibió.
          </Alert>
          {aviso ? <Alert severity="error">{aviso}</Alert> : null}
          {hayError ? (
            <EstadoError descripcion="No pudimos cargar los estados." reintentar={() => void cargar()} />
          ) : estados === null ? (
            <EstadoCargaPagina />
          ) : estados.length === 0 ? (
            <EstadoVacio
              titulo="Todavía no hay estados."
              descripcion={puedeEditar ? 'Creá el primero con «Nuevo estado».' : 'Cuando se carguen, los vas a ver acá.'}
            />
          ) : (
            <ContenidoAdaptable
              items={estados}
              columnas={columnas}
              obtenerClave={(estado) => estado.id}
              etiquetaTabla="Estados de reparación"
            />
          )}
        </Stack>
      </ContenedorSeccion>
      <EstadoFormDialog
        abierto={dialogoAbierto}
        estado={editando}
        onCerrar={() => { setDialogoAbierto(false); void cargar() }}
        onGuardado={() => {
          setDialogoAbierto(false)
          setExito(editando ? 'Estado guardado' : 'Estado creado')
          void cargar()
        }}
      />
      <Snackbar open={exito !== null} autoHideDuration={4000} onClose={() => setExito(null)}>
        <Alert severity="success" onClose={() => setExito(null)}>{exito}</Alert>
      </Snackbar>
    </Box>
  )
}
