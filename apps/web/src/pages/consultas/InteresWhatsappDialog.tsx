import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Dialog, DialogActions, DialogContent, Snackbar, Stack, Typography } from '@mui/material'
import { TituloDialogo } from '../../components/base/TituloDialogo'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { useEmpresasAccesibles } from '../../hooks/useEmpresasAccesibles'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { formatearUltimoInteres, listarInteresWhatsapp, mensajeDeErrorInteres, type InteresPorProducto } from '../../lib/interesWhatsapp'

const AVISO_CAMBIO_EMPRESA = 'Cambiaste de empresa: cerramos el interés por WhatsApp. Volvé a abrirlo para ver la nueva.'

type Props = {
  abierto: boolean
  onCerrar: () => void
  // Se cierra solo si cambia la empresa activa mientras está abierto; la pantalla muestra el aviso.
  onEmpresaCambiada: () => void
}

type Carga =
  | { estado: 'cargando' }
  | { estado: 'error'; mensaje: string }
  | { estado: 'listo'; filas: InteresPorProducto[] }

// F-CON-02 (FR-005, FR-006): interés por WhatsApp por producto de la empresa activa (Principio VIII).
// La empresa activa del selector es la única fuente de verdad: si cambia con el diálogo abierto se
// cierra con aviso y nunca queda una fila de la empresa anterior.
export function InteresWhatsappDialog({ abierto, onCerrar, onEmpresaCambiada }: Props) {
  const { empresas, empresaActivaId, isLoading: cargandoEmpresas } = useEmpresasAccesibles()
  const [carga, setCarga] = useState<Carga>({ estado: 'cargando' })
  const ultimaPeticion = useRef(0)
  // Empresa con la que se abrió (`undefined` = todavía no se resolvió el selector).
  const empresaAlAbrir = useRef<string | null | undefined>(undefined)
  const listaParaCargar = abierto && !cargandoEmpresas && empresas.length > 0
  const hayTodas = empresaActivaId === null

  const cargar = useCallback(async (empresaId: string | null) => {
    const peticion = ++ultimaPeticion.current
    setCarga({ estado: 'cargando' })
    try {
      const filas = await listarInteresWhatsapp(empresaId)
      if (peticion === ultimaPeticion.current) setCarga({ estado: 'listo', filas })
    } catch (error) {
      if (peticion === ultimaPeticion.current) setCarga({ estado: 'error', mensaje: mensajeDeErrorInteres(error) })
    }
  }, [])

  useEffect(() => {
    if (!abierto) {
      empresaAlAbrir.current = undefined
      ultimaPeticion.current++
      // Al cerrar se descarta lo cargado: al reabrir nunca asoman filas de la empresa anterior.
      setCarga({ estado: 'cargando' })
      return
    }
    if (!listaParaCargar) {
      // Sin empresas accesibles no hay nada que cargar: vacío, no esqueleto eterno.
      if (!cargandoEmpresas) setCarga({ estado: 'listo', filas: [] })
      return
    }
    if (empresaAlAbrir.current === undefined) empresaAlAbrir.current = empresaActivaId
    else if (empresaAlAbrir.current !== empresaActivaId) {
      // Cambió la empresa con el diálogo abierto: se descarta lo cargado y se cierra con aviso.
      ultimaPeticion.current++
      empresaAlAbrir.current = undefined
      onEmpresaCambiada()
      return
    }
    void cargar(empresaActivaId)
  }, [abierto, listaParaCargar, cargandoEmpresas, empresaActivaId, cargar, onEmpresaCambiada])

  const columnas: ColumnaAdaptable<InteresPorProducto>[] = [
    {
      clave: 'producto',
      encabezado: 'Producto',
      render: (fila) => (
        <Stack component="span" alignItems={{ xs: 'flex-end', sm: 'flex-start' }}>
          <Typography component="span" variant="body2" fontWeight={600}>{fila.producto_nombre}</Typography>
          {fila.sku ? <Typography component="span" variant="caption" color="text.secondary">{fila.sku}</Typography> : null}
        </Stack>
      ),
    },
    ...(hayTodas ? [{ clave: 'tienda', encabezado: 'Tienda', render: (fila: InteresPorProducto) => fila.empresa_nombre }] : []),
    { clave: 'veces', encabezado: 'Veces', align: 'right', render: (fila) => fila.total },
    { clave: 'ultimo', encabezado: 'Último interés', render: (fila) => formatearUltimoInteres(fila.ultimo_interes_at) },
  ]

  return (
    <Dialog open={abierto} onClose={onCerrar} fullWidth maxWidth="md" aria-labelledby="titulo-interes-whatsapp">
      <TituloDialogo id="titulo-interes-whatsapp" onCerrar={onCerrar}>Interés por WhatsApp</TituloDialogo>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Veces que se tocó «Consultar por WhatsApp» en cada producto de la tienda. No guarda datos de quien tocó.
          </Typography>
          {cargandoEmpresas || carga.estado === 'cargando' ? <EstadoCargaPagina lineas={4} /> : null}
          {!cargandoEmpresas && carga.estado === 'error' ? (
            <EstadoError descripcion={carga.mensaje} reintentar={() => void cargar(empresaActivaId)} />
          ) : null}
          {!cargandoEmpresas && carga.estado === 'listo' && carga.filas.length === 0 ? (
            <EstadoVacio
              titulo="Todavía no hay interés registrado."
              descripcion="Cuando alguien toque «Consultar por WhatsApp» en un producto de la tienda, lo vas a ver acá."
            />
          ) : null}
          {!cargandoEmpresas && carga.estado === 'listo' && carga.filas.length > 0 ? (
            <ContenidoAdaptable
              items={carga.filas}
              columnas={columnas}
              obtenerClave={(fila) => `${fila.empresa_id}:${fila.producto_id}`}
              etiquetaTabla="Interés por WhatsApp por producto"
            />
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar}>Cerrar</Button>
      </DialogActions>
    </Dialog>
  )
}

// Botón del encabezado de Consultas: visible con `consultas` ≥ lectura (la base lo impone con RLS).
export function BotonInteresWhatsapp() {
  const { nivel } = useNivelSeccion('consultas')
  const [abierto, setAbierto] = useState(false)
  const [aviso, setAviso] = useState(false)
  const alCambiarEmpresa = useCallback(() => {
    setAbierto(false)
    setAviso(true)
  }, [])

  if (nivel !== 'lectura' && nivel !== 'edicion') return null
  return (
    <>
      <Button variant="outlined" onClick={() => setAbierto(true)}>Interés por WhatsApp</Button>
      <InteresWhatsappDialog abierto={abierto} onCerrar={() => setAbierto(false)} onEmpresaCambiada={alCambiarEmpresa} />
      <Snackbar open={aviso} autoHideDuration={6000} onClose={() => setAviso(false)} message={AVISO_CAMBIO_EMPRESA} />
    </>
  )
}
