import { useState } from 'react'
import { Alert, Box, Button, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useEsAdministrador } from '../../hooks/useEsAdministrador'
import { useBanderaListasPrecios } from '../../hooks/useBanderaListasPrecios'
import { useListadoAcumulado } from '../../hooks/useListadoAcumulado'
import { useListarListasPrecios } from '../../hooks/useListarListasPrecios'
import { supabaseClient } from '../../lib/supabase'
import {
  ETIQUETA_ESTADO_LISTAS,
  MOTIVO_LISTAS_APAGADAS,
  archivarLista,
  formatearAjuste,
  guardarLista,
  mensajeErrorLista,
  restaurarLista,
  type DatosLista,
  type EstadoListas,
  type ListaPrecios,
} from '../../lib/listasPrecios'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { FormularioListaPrecios } from '../../components/listasPrecios/FormularioListaPrecios'
import { ListasPorTipoCliente } from '../../components/listasPrecios/ListasPorTipoCliente'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { CargaInfinita } from '../../components/pagina/CargaInfinita'
import { EstadoCargaPagina, EstadoError, EstadoExito, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

const TAMANO_TANDA = 25
const ESTADOS: EstadoListas[] = ['activas', 'archivadas', 'todas']

// Productos → Listas de precios (F-PRE-14, RF-PRE-14-5). Una lista es un porcentaje de ajuste sobre el precio central; se
// asigna a clientes desde su ficha. Esta pantalla NO cambia ningún precio: el motor las aplicará en la Fase 3, detrás de la
// bandera `listas_precios`. Empresa activa: no aplica (las listas son de toda la organización y la pantalla no lee datos por
// empresa). Solo el Administrador ve «Nueva lista», «Editar», «Archivar» y «Restaurar»; la base lo exige igual (42501). Con la
// bandera apagada la pantalla queda en modo solo-archivar/restaurar con un aviso (CA-PRE-14-7).
export function ListasPreciosList() {
  const { esAdministrador, isLoading: verificandoRol } = useEsAdministrador()
  const bandera = useBanderaListasPrecios()
  const [estado, setEstado] = useState<EstadoListas>('activas')
  const [pagina, setPagina] = useState(1)
  const [edicion, setEdicion] = useState<{ lista: ListaPrecios | null } | null>(null)
  const [aviso, setAviso] = useState<{ severidad: 'error' | 'success'; texto: string } | null>(null)
  const [trabajando, setTrabajando] = useState<string | null>(null)

  const { listas, total, isLoading, isFetching, isError, refetch } = useListarListasPrecios({ estado, pagina, tamano: TAMANO_TANDA })
  const listado = useListadoAcumulado({ items: listas, pagina, setPagina, total, cargando: isFetching, reinicio: { estado } })
  const falloTanda = isError && pagina > 1
  // Las acciones que cambian filas recargan desde la primera tanda.
  const recargarDesdeInicio = async () => {
    if (pagina === 1) await refetch()
    else setPagina(1)
  }

  const puedeEditar = esAdministrador && !verificandoRol
  const puedeGuardar = puedeEditar && bandera.activa

  const guardar = async (datos: DatosLista) => {
    await guardarLista(supabaseClient, datos)
    setEdicion(null)
    setAviso({ severidad: 'success', texto: datos.id ? 'Lista actualizada.' : 'Lista creada.' })
    await recargarDesdeInicio()
  }

  const cambiarArchivo = async (lista: ListaPrecios) => {
    if (trabajando) return
    setAviso(null)
    setTrabajando(lista.id)
    try {
      if (lista.archivadaEn) await restaurarLista(supabaseClient, lista)
      else await archivarLista(supabaseClient, lista)
      setAviso({ severidad: 'success', texto: lista.archivadaEn ? 'Lista restaurada.' : 'Lista archivada.' })
      await recargarDesdeInicio()
    } catch (error) {
      console.error('No pudimos cambiar el estado de la lista.', error)
      setAviso({ severidad: 'error', texto: mensajeErrorLista(error, 'No pudimos cambiar el estado de la lista. Probá de nuevo.') })
    } finally {
      setTrabajando(null)
    }
  }

  const columnas: ColumnaAdaptable<ListaPrecios>[] = [
    {
      clave: 'nombre',
      encabezado: 'Lista',
      render: (lista) => (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{lista.nombre}</Typography>
          {lista.descripcion ? <Typography variant="caption" color="text.secondary">{lista.descripcion}</Typography> : null}
        </Box>
      ),
    },
    { clave: 'ajuste', encabezado: 'Ajuste', align: 'right', render: (lista) => formatearAjuste(lista.ajustePct) },
    { clave: 'clientes', encabezado: 'Clientes', align: 'right', render: (lista) => lista.clientesAsignados },
    {
      clave: 'estado',
      encabezado: 'Estado',
      render: (lista) => <EtiquetaEstado texto={lista.archivadaEn ? 'Archivada' : 'Activa'} variante={lista.archivadaEn ? 'neutral' : 'exito'} />,
    },
  ]

  const acciones = (lista: ListaPrecios) => {
    if (!puedeEditar) return null
    return (
      <Stack direction="row" spacing={1} justifyContent="flex-end">
        {puedeGuardar ? (
          <Button size="small" onClick={() => { setAviso(null); setEdicion({ lista }) }} aria-label={`Editar la lista ${lista.nombre}`}>Editar</Button>
        ) : null}
        <Button
          size="small"
          color={lista.archivadaEn ? 'primary' : 'error'}
          disabled={trabajando !== null}
          onClick={() => void cambiarArchivo(lista)}
          aria-label={`${lista.archivadaEn ? 'Restaurar' : 'Archivar'} la lista ${lista.nombre}`}
        >
          {lista.archivadaEn ? 'Restaurar' : 'Archivar'}
        </Button>
      </Stack>
    )
  }

  const botonNueva = puedeGuardar ? (
    <Button variant="contained" onClick={() => { setAviso(null); setEdicion({ lista: null }) }}>Nueva lista</Button>
  ) : undefined

  if (bandera.cargando || verificandoRol) {
    return (
      <Box>
        <EncabezadoPagina titulo="Listas de precios" contexto={<ContextoOrganizacionActiva />} />
        <ContenedorSeccion><EstadoCargaPagina /></ContenedorSeccion>
      </Box>
    )
  }

  return (
    <Box>
      <EncabezadoPagina
        titulo="Listas de precios"
        descripcion="Cada lista es un porcentaje de ajuste sobre el precio central. Se asigna a un cliente desde su ficha, a varios desde Clientes o a todo un tipo de cliente."
        accion={botonNueva}
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          {!bandera.activa ? (
            <Alert severity={bandera.hayError ? 'warning' : 'info'}>
              {bandera.hayError
                ? 'No pudimos verificar si las listas de precios están activas. Por ahora solo podés archivar o restaurar.'
                : `${MOTIVO_LISTAS_APAGADAS} Mientras tanto solo podés archivar o restaurar las que ya tengas.`}
            </Alert>
          ) : null}
          {aviso?.severidad === 'success' ? <EstadoExito titulo={aviso.texto} /> : null}
          {aviso?.severidad === 'error' ? <Alert severity="error" onClose={() => setAviso(null)}>{aviso.texto}</Alert> : null}

          <ListasPorTipoCliente puedeEditar={puedeEditar} puedeAsignar={puedeGuardar} onCambiada={() => void recargarDesdeInicio()} />

          <BarraHerramientas contador={isLoading || isError ? undefined : `${total} ${total === 1 ? 'lista' : 'listas'}`}>
            <ToggleButtonGroup
              exclusive
              size="small"
              aria-label="Filtrar por estado"
              value={estado}
              onChange={(_, valor: EstadoListas | null) => {
                if (valor === null) return
                setEstado(valor)
                setPagina(1)
              }}
            >
              {ESTADOS.map((valor) => <ToggleButton key={valor} value={valor}>{ETIQUETA_ESTADO_LISTAS[valor]}</ToggleButton>)}
            </ToggleButtonGroup>
          </BarraHerramientas>

          {isLoading ? (
            <EstadoCargaPagina />
          ) : isError && pagina === 1 ? (
            <EstadoError descripcion="No pudimos cargar las listas de precios." reintentar={() => void refetch()} />
          ) : listado.filas.length === 0 && !isFetching ? (
            <EstadoVacio
              titulo={estado === 'archivadas' ? 'No hay listas archivadas.' : 'Todavía no hay listas de precios.'}
              descripcion={estado !== 'archivadas' && puedeGuardar ? 'Creá la primera con «Nueva lista».' : undefined}
            />
          ) : (
            <>
              <ContenidoAdaptable
                items={listado.filas}
                columnas={columnas}
                obtenerClave={(lista) => lista.id}
                acciones={acciones}
                etiquetaTabla="Listas de precios"
              />
              <CargaInfinita
                hayMas={listado.hayMas}
                cargando={listado.cargandoMas}
                hayError={falloTanda}
                onCargarMas={listado.cargarMas}
                cargados={listado.filas.length}
                sustantivo="listas"
                textoFin="Llegaste al final de las listas."
              />
            </>
          )}
        </Stack>
      </ContenedorSeccion>
      {edicion ? (
        <FormularioListaPrecios
          key={edicion.lista?.id ?? 'nueva'}
          lista={edicion.lista}
          onCancelar={() => setEdicion(null)}
          onGuardar={guardar}
        />
      ) : null}
    </Box>
  )
}
