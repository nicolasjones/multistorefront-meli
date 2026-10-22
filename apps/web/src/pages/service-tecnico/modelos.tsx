import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Snackbar, Stack, Switch, Typography } from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import {
  cambiarActivoModelo,
  formatearARS,
  listarModelos,
  mensajeDeErrorService,
  type ModeloEquipo,
} from '../../lib/serviceTecnico'
import { usoDeModelos } from '../../lib/reparaciones'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { PestanasService } from '../../components/service/PestanasService'
import { ModeloFormDialog } from '../../components/service/ModeloFormDialog'
import { ConfirmarDesactivarDialog } from '../../components/service/ConfirmarDesactivarDialog'

// Service técnico · Modelos (F-SVC-01, FR-007). La autoridad de acceso es RLS (`service_tecnico`); acá el nivel
// solo decide si se ofrecen los controles de escritura.
export function ServicioModelos() {
  const { nivel } = useNivelSeccion('service_tecnico')
  const puedeEditar = nivel === 'edicion'
  const [modelos, setModelos] = useState<ModeloEquipo[] | null>(null)
  // Reparaciones que usan cada modelo (FR-019): se muestran en la tabla y se avisan al desactivar.
  const [uso, setUso] = useState<Map<string, number>>(new Map())
  const [hayError, setHayError] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [dialogoAbierto, setDialogoAbierto] = useState(false)
  const [editando, setEditando] = useState<ModeloEquipo | null>(null)
  const [porDesactivar, setPorDesactivar] = useState<ModeloEquipo | null>(null)
  // Una sola operación a la vez: evita RPC superpuestas con clics rápidos.
  const [ocupado, setOcupado] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setHayError(false)
    try {
      const [datos, usos] = await Promise.all([listarModelos(), usoDeModelos()])
      if (peticion === ultimaPeticion.current) {
        setModelos(datos)
        setUso(usos)
      }
    } catch (error) {
      console.error('No pudimos cargar los modelos.', error)
      if (peticion === ultimaPeticion.current) setHayError(true)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const cambiarActivo = async (modelo: ModeloEquipo) => {
    if (ocupado) return
    setOcupado(true)
    setAviso(null)
    try {
      await cambiarActivoModelo(modelo.id, !modelo.activo)
    } catch (error) {
      setAviso(mensajeDeErrorService(error, `No pudimos ${modelo.activo ? 'desactivar' : 'activar'} el modelo. Intentá de nuevo.`))
    } finally {
      await cargar()
      setOcupado(false)
    }
  }

  // Desactivar un modelo en uso pide confirmación con la cantidad (FR-019); activarlo no.
  const pedirCambioActivo = (modelo: ModeloEquipo) => {
    if (modelo.activo && (uso.get(modelo.id) ?? 0) > 0) {
      setPorDesactivar(modelo)
      return
    }
    void cambiarActivo(modelo)
  }

  const columnas: ColumnaAdaptable<ModeloEquipo>[] = [
    { clave: 'equipo', encabezado: 'Equipo', render: (modelo) => <Typography variant="b">{modelo.equipo}</Typography> },
    { clave: 'modelo', encabezado: 'Modelo', render: (modelo) => modelo.modelo },
    { clave: 'mano_obra', encabezado: 'Mano de obra base', align: 'right', render: (modelo) => formatearARS(modelo.mano_obra_base) },
    { clave: 'reparaciones', encabezado: 'Reparaciones', align: 'right', render: (modelo) => uso.get(modelo.id) ?? 0 },
    {
      clave: 'activo',
      encabezado: 'Activo',
      render: (modelo) => (
        <Switch
          checked={modelo.activo}
          disabled={!puedeEditar || ocupado}
          onChange={() => pedirCambioActivo(modelo)}
          slotProps={{ input: { 'aria-label': `Activo: ${modelo.equipo} ${modelo.modelo}` } }}
        />
      ),
    },
    ...(puedeEditar
      ? [
          {
            clave: 'acciones',
            encabezado: 'Acciones',
            render: (modelo: ModeloEquipo) => (
              <Button size="small" onClick={() => { setEditando(modelo); setDialogoAbierto(true) }} aria-label={`Editar ${modelo.equipo} ${modelo.modelo}`}>
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
        titulo="Modelos"
        descripcion="Consolas y equipos que se reparan, con su mano de obra base."
        accion={puedeEditar ? <Button variant="contained" onClick={() => { setEditando(null); setDialogoAbierto(true) }}>Nuevo modelo</Button> : undefined}
        contexto={<ContextoOrganizacionActiva />}
        pestanas={<PestanasService activa="modelos" />}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          {aviso ? <Alert severity="error">{aviso}</Alert> : null}
          {hayError ? (
            <EstadoError descripcion="No pudimos cargar los modelos." reintentar={() => void cargar()} />
          ) : modelos === null ? (
            <EstadoCargaPagina />
          ) : modelos.length === 0 ? (
            <EstadoVacio
              titulo="Todavía no hay modelos."
              descripcion={puedeEditar ? 'Creá el primero con «Nuevo modelo».' : 'Cuando se carguen, los vas a ver acá.'}
            />
          ) : (
            <ContenidoAdaptable
              items={modelos}
              columnas={columnas}
              obtenerClave={(modelo) => modelo.id}
              etiquetaTabla="Modelos de equipo"
            />
          )}
        </Stack>
      </ContenedorSeccion>
      <ConfirmarDesactivarDialog
        abierto={porDesactivar !== null}
        objeto="modelo"
        nombre={porDesactivar ? `${porDesactivar.equipo} ${porDesactivar.modelo}` : ''}
        cantidad={porDesactivar ? uso.get(porDesactivar.id) ?? 0 : 0}
        onConfirmar={() => {
          const modelo = porDesactivar
          setPorDesactivar(null)
          if (modelo) void cambiarActivo(modelo)
        }}
        onCancelar={() => setPorDesactivar(null)}
      />
      <ModeloFormDialog
        abierto={dialogoAbierto}
        modelo={editando}
        onCerrar={() => { setDialogoAbierto(false); void cargar() }}
        onGuardado={() => {
          setDialogoAbierto(false)
          setExito(editando ? 'Modelo guardado' : 'Modelo creado')
          void cargar()
        }}
      />
      <Snackbar open={exito !== null} autoHideDuration={4000} onClose={() => setExito(null)}>
        <Alert severity="success" onClose={() => setExito(null)}>{exito}</Alert>
      </Snackbar>
    </Box>
  )
}
