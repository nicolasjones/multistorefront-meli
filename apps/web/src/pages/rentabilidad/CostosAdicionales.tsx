import { lazy, Suspense, useState } from 'react'
import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'
import { PestanasPagina } from '../../components/pagina/PestanasPagina'
import { EstadoCargaPagina, EstadoError, EstadoExito, EstadoVacio } from '../../components/estados/EstadosPagina'
import { useCostosAdicionales } from '../../hooks/useCostosAdicionales'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import {
  type CostoAdicional,
  darDeBajaCostoAdicional,
  formatearValorCosto,
  mensajeDeErrorCosto,
} from '../../lib/costosAdicionales'
import { PESTANAS_RENTABILIDAD, SECCION_RENTABILIDAD } from '../../lib/rentabilidad'
import { supabaseClient } from '../../lib/supabase'

// El diálogo (MUI Dialog + formulario) queda fuera de la carga inicial de la pantalla (Principio VI).
const DialogoCostoAdicional = lazy(() =>
  import('./DialogoCostoAdicional').then((modulo) => ({ default: modulo.DialogoCostoAdicional })),
)

// Diálogo abierto, con la empresa activa de la barra superior con la que se abrió (`base`): si la
// activa cambia, el diálogo deja de ser válido y se cierra con aviso (Principio VIII).
type DialogoAbierto = { costo: CostoAdicional | 'nuevo'; base: string | null }

const columnas: ColumnaAdaptable<CostoAdicional>[] = [
  { clave: 'nombre', encabezado: 'Costo', render: (costo) => <Typography component="span" sx={{ fontWeight: 600 }}>{costo.nombre}</Typography> },
  { clave: 'empresa', encabezado: 'Empresa', render: (costo) => costo.empresaNombre },
  { clave: 'tipo', encabezado: 'Tipo', render: (costo) => (costo.tipo === 'porcentaje' ? 'Porcentaje sobre el neto' : 'Monto por unidad') },
  { clave: 'valor', encabezado: 'Valor', align: 'right', render: (costo) => formatearValorCosto(costo) },
]

// «Rentabilidad · Costos adicionales» (F-REN-08; la pestaña no está en el prototipo, ver matriz de la
// spec). Lista los costos de la empresa activa de la barra superior (o de todas con «Todas las tiendas»)
// y, con `edicion` en `rentabilidad`, permite crear, editar y dar de baja; Administración (`lectura`)
// solo los ve. La ruta va envuelta en RequiereAccesoSeccion (`rentabilidad` ≥ lectura). La base valida
// igual cada escritura (RPC `security definer`).
export function RentabilidadCostosAdicionales() {
  const { nivel } = useNivelSeccion(SECCION_RENTABILIDAD)
  const puedeEditar = nivel === 'edicion'
  const { empresas, valor: empresaId, cambiar: elegirEmpresa, empresaActivaId, cargando: cargandoTiendas, hayError: errorTiendas } = useFiltroPorEmpresaActiva()
  const { costos, cargando, hayError, recargar } = useCostosAdicionales(empresaId)
  const [dialogo, setDialogo] = useState<DialogoAbierto | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [errorBaja, setErrorBaja] = useState<string | null>(null)
  const [dandoDeBaja, setDandoDeBaja] = useState<string | null>(null)

  // Derivado, sin efecto: el diálogo abierto con otra empresa activa ya no vale.
  const dialogoVigente = dialogo && dialogo.base === empresaActivaId ? dialogo : null
  const dialogoCerradoPorCambio = dialogo !== null && dialogoVigente === null

  const abrir = (costo: CostoAdicional | 'nuevo') => {
    setAviso(null)
    setErrorBaja(null)
    setDialogo({ costo, base: empresaActivaId })
  }

  const alGuardar = ({ alta, nombre, cantidad, parcial }: { alta: boolean; nombre: string; cantidad: number; parcial?: boolean }) => {
    // Con falla parcial el diálogo sigue abierto para mostrar el error de las empresas que faltan.
    if (parcial) {
      setAviso(`Costo «${nombre}» creado solo en ${cantidad} ${cantidad === 1 ? 'empresa' : 'empresas'}; revisá el error para las que faltan.`)
      void recargar()
      return
    }
    setDialogo(null)
    setAviso(alta
      ? cantidad > 1 ? `Costo «${nombre}» creado en ${cantidad} empresas.` : `Costo «${nombre}» creado.`
      : `Costo «${nombre}» actualizado.`)
    void recargar()
  }

  const darDeBaja = async (costo: CostoAdicional) => {
    if (dandoDeBaja) return
    setAviso(null)
    setErrorBaja(null)
    setDandoDeBaja(costo.id)
    try {
      await darDeBajaCostoAdicional(supabaseClient, costo.id)
      setAviso(`Costo «${costo.nombre}» dado de baja.`)
      await recargar()
    } catch (error) {
      setErrorBaja(mensajeDeErrorCosto(error as { code?: string }))
    } finally {
      setDandoDeBaja(null)
    }
  }

  const nuevo = puedeEditar ? <Button variant="contained" onClick={() => abrir('nuevo')}>Nuevo costo adicional</Button> : undefined

  let contenido
  if (cargando) contenido = <EstadoCargaPagina />
  else if (hayError) contenido = <EstadoError descripcion="No pudimos cargar los costos adicionales." reintentar={() => void recargar()} />
  else if (costos.length === 0) {
    contenido = (
      <EstadoVacio
        titulo="Todavía no hay costos adicionales"
        descripcion={puedeEditar ? 'Creá el primero para que el margen lo descuente.' : 'Una persona con permiso de edición puede cargarlos.'}
        accion={nuevo}
      />
    )
  } else {
    contenido = (
      <ContenidoAdaptable
        items={costos}
        columnas={columnas}
        obtenerClave={(costo) => costo.id}
        etiquetaTabla="Costos adicionales"
        acciones={puedeEditar ? (costo) => (
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="outlined" aria-label={`Editar ${costo.nombre}`} onClick={() => abrir(costo)}>Editar</Button>
            <Button
              size="small"
              variant="outlined"
              color="error"
              aria-label={`Dar de baja ${costo.nombre}`}
              disabled={dandoDeBaja !== null}
              onClick={() => void darDeBaja(costo)}
            >
              Dar de baja
            </Button>
          </Stack>
        ) : undefined}
      />
    )
  }

  return (
    <Stack spacing={2}>
      <EncabezadoPagina
        titulo="Rentabilidad"
        descripcion="Margen estimado por canal, producto y publicación."
        contexto={<ContextoOrganizacionActiva />}
        accion={nuevo}
        pestanas={<PestanasPagina pestanas={PESTANAS_RENTABILIDAD} etiqueta="Secciones de Rentabilidad" />}
      />
      <Alert severity="info" role="note">
        Los costos adicionales (envío, impuestos u otros) se descuentan del margen de cada producto en la empresa donde se cargan.
        Un porcentaje se calcula sobre el precio neto sin IVA; un monto, por cada unidad.
      </Alert>
      {aviso ? <EstadoExito titulo={aviso} /> : null}
      {errorBaja ? <Alert severity="error">{errorBaja}</Alert> : null}
      {dialogoCerradoPorCambio ? (
        <Alert severity="warning" role="status" onClose={() => setDialogo(null)}>
          Cambiaste de empresa: cerramos el formulario sin guardar. Volvé a abrirlo para cargar el costo en la nueva empresa.
        </Alert>
      ) : null}
      <FiltroEmpresa
        empresas={empresas}
        valor={empresaId}
        onCambiar={elegirEmpresa}
        cargando={cargandoTiendas}
        hayError={errorTiendas}
        textoAyuda="Si elegís una empresa en la barra superior, se ven los costos de esa tienda."
      />
      <BarraHerramientas contador={cargando || hayError ? undefined : `${costos.length} ${costos.length === 1 ? 'costo' : 'costos'}`} />
      <Box aria-busy={cargando}>{contenido}</Box>
      {dialogoVigente ? (
        <Suspense fallback={null}>
          <DialogoCostoAdicional
            costo={dialogoVigente.costo === 'nuevo' ? null : dialogoVigente.costo}
            empresas={empresas}
            empresaInicialId={empresaActivaId}
            onCerrar={() => setDialogo(null)}
            onGuardado={alGuardar}
          />
        </Suspense>
      ) : null}
    </Stack>
  )
}
