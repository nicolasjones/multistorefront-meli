import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Button, Chip, IconButton, Stack, Switch, Typography } from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import { EstadoCargaPagina, EstadoError, EstadoExito, EstadoVacio } from '../../../components/estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../../components/pagina/ContenidoAdaptable'
import { FormaEnvioDialog } from '../../../components/ventas/FormaEnvioDialog'
import {
  type FormaEnvio,
  cambiarEstadoFormaEnvio,
  formatearCosto,
  listarFormasEnvio,
  mensajeDeError,
} from '../../../lib/ventas/formasEnvio'
import type { PropsPestanaCatalogo } from './index'

const AYUDA = 'Cómo sale el pedido. Las que requieren transporte piden empresa, guía y fecha de envío.'

const SiNo = ({ valor }: { valor: boolean }) => (
  <Chip label={valor ? 'Sí' : 'No'} size="small" color={valor ? 'primary' : 'default'} variant={valor ? 'filled' : 'outlined'} />
)

// Pestaña «Formas de envío» de Configuración de ventas (F-VTA-02, FR-008). Quien tiene edición
// suma «Nueva forma de envío», editar y el interruptor `Activo`; quien solo lee ve la lista sin
// acciones. RLS aplica el mismo límite en la base.
export function FormasEnvioTab({ empresa, empresas, puedeEditar }: PropsPestanaCatalogo) {
  const [formas, setFormas] = useState<FormaEnvio[]>([])
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)
  const [editando, setEditando] = useState<FormaEnvio | null>(null)
  const [cambiandoId, setCambiandoId] = useState<string | null>(null)
  // «Última petición gana»: al cambiar de empresa una respuesta vieja no pisa la nueva.
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    try {
      const lista = await listarFormasEnvio(empresa.id)
      if (peticion !== ultimaPeticion.current) return
      setFormas(lista)
      setHayError(false)
    } catch (error) {
      if (peticion !== ultimaPeticion.current) return
      console.error('No pudimos listar las formas de envío.', error)
      setFormas([])
      setHayError(true)
    }
    setCargando(false)
  }, [empresa.id])

  useEffect(() => {
    setAviso(null)
    setErrorAccion(null)
    void cargar()
  }, [cargar])

  const alternarActivo = async (forma: FormaEnvio, activo: boolean) => {
    setCambiandoId(forma.id)
    setErrorAccion(null)
    try {
      const actualizada = await cambiarEstadoFormaEnvio(forma.id, activo)
      setFormas((actuales) => actuales.map((otra) => (otra.id === actualizada.id ? actualizada : otra)))
    } catch (error) {
      setErrorAccion(mensajeDeError(error, 'No pudimos cambiar el estado de la forma de envío.'))
    } finally {
      setCambiandoId(null)
    }
  }

  const columnas: ColumnaAdaptable<FormaEnvio>[] = [
    { clave: 'orden', encabezado: 'Orden', align: 'center', render: (forma) => forma.orden },
    {
      clave: 'nombre',
      encabezado: 'Forma de envío',
      // Atenuada cuando está inactiva: sigue visible para poder reactivarla.
      render: (forma) => (
        <Typography component="span" sx={{ fontWeight: 600 }} color={forma.activo ? 'text.primary' : 'text.disabled'}>
          {forma.nombre}
        </Typography>
      ),
    },
    { clave: 'transporte', encabezado: 'Requiere transporte y guía', render: (forma) => <SiNo valor={forma.exige_transporte_guia} /> },
    { clave: 'costo', encabezado: 'Costo por defecto', align: 'right', render: (forma) => formatearCosto(forma.costo_defecto) },
    {
      clave: 'activo',
      encabezado: 'Activo',
      align: 'center',
      render: (forma) => puedeEditar ? (
        <Switch
          checked={forma.activo}
          disabled={cambiandoId === forma.id}
          onChange={(evento) => void alternarActivo(forma, evento.target.checked)}
          slotProps={{ input: { 'aria-label': `Activo: ${forma.nombre}` } }}
        />
      ) : <SiNo valor={forma.activo} />,
    },
  ]

  const nueva = puedeEditar ? (
    <Button variant="contained" onClick={() => { setAviso(null); setCreando(true) }}>Nueva forma de envío</Button>
  ) : null

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2}>
        <Typography variant="body2" color="text.secondary">{AYUDA}</Typography>
        {nueva}
      </Stack>

      {aviso ? <EstadoExito titulo={aviso} /> : null}
      {errorAccion ? <EstadoError titulo="No se pudo completar la acción." descripcion={errorAccion} /> : null}

      <Box aria-busy={cargando}>
        {cargando ? (
          <EstadoCargaPagina />
        ) : hayError ? (
          <EstadoError descripcion="No pudimos cargar las formas de envío." reintentar={() => void cargar()} />
        ) : formas.length === 0 ? (
          <EstadoVacio
            titulo={`${empresa.nombre} todavía no tiene formas de envío.`}
            descripcion={puedeEditar ? 'Creá la primera para que el comprobante la ofrezca.' : undefined}
          />
        ) : (
          <ContenidoAdaptable
            items={formas}
            columnas={columnas}
            obtenerClave={(forma) => forma.id}
            etiquetaTabla="Formas de envío"
            acciones={puedeEditar ? (forma) => (
              <IconButton aria-label={`Editar ${forma.nombre}`} size="small" onClick={() => { setAviso(null); setEditando(forma) }}>
                <EditIcon fontSize="small" />
              </IconButton>
            ) : undefined}
          />
        )}
      </Box>

      {puedeEditar && (creando || editando) ? (
        <FormaEnvioDialog
          open
          empresa={empresa}
          empresas={empresas}
          forma={editando}
          ordenSugerido={formas.length + 1}
          onCerrar={() => { setCreando(false); setEditando(null) }}
          onGuardado={(mensaje) => {
            setCreando(false)
            setEditando(null)
            setAviso(mensaje)
            void cargar()
          }}
          onRecargar={() => { setCreando(false); setEditando(null); void cargar() }}
        />
      ) : null}
    </Stack>
  )
}
