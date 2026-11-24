import { useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { Box, Button, Stack, Typography } from '@mui/material'
import { useEmpresas, type Empresa } from '../../hooks/useEmpresas'
import { useResumenEmpresas, type ResumenEmpresa } from '../../hooks/useResumenEmpresas'
import { usePuedeEditarEmpresas } from '../../hooks/usePuedeEditarEmpresas'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { EstadoCargaPagina, EstadoError, EstadoExito, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { DialogoNuevaEmpresa } from '../../components/empresas/DialogoNuevaEmpresa'
import { AccesoRestringido } from '../acceso-restringido/AccesoRestringido'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { tokens } from '../../tema/tokens'

const { color, tipografia, forma } = tokens
const SIN_CONFIGURAR = 'Sin configurar'

// Iniciales de la empresa para el logo del listado (Empresas.dc.html / Stores.dc.html).
const iniciales = (nombre: string) =>
  nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((parte) => parte.charAt(0).toUpperCase()).join('')

const NO_DISPONIBLE = 'No disponible'
const CARGANDO = '…'

type FilaEmpresa = Empresa & { resumen?: ResumenEmpresa }

const textoPrecio = (resumen?: ResumenEmpresa) => {
  if (!resumen) return CARGANDO
  if (!resumen.regla) return NO_DISPONIBLE
  const { base, ajustePct } = resumen.regla
  if (base === 'central' || ajustePct === 0) return 'Igual al central'
  return `Central ${ajustePct > 0 ? '+' : '−'}${Math.abs(ajustePct)} %`
}

// Tienda web, precio y productos visibles salen de los datos reales de cada empresa. Mercado Libre todavía no tiene
// integración que consultar (llega con sus épicas): ahí «Sin configurar» es el estado real. La moneda es constante
// del producto (ARS), no una columna.
const columnas: ColumnaAdaptable<FilaEmpresa>[] = [
  {
    clave: 'nombre',
    encabezado: 'Empresa',
    render: (empresa) => (
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Box
          aria-hidden="true"
          sx={{
            width: forma.ladoMiniatura,
            height: forma.ladoMiniatura,
            borderRadius: `${forma.radioMiniatura}px`,
            bgcolor: color.sider.fondo,
            color: color.control.estrella,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: tipografia.titulos,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {iniciales(empresa.nombre)}
        </Box>
        <Stack spacing={0.5} alignItems="flex-start">
          <Typography variant="b" sx={{ fontWeight: tipografia.pesoEnfasis }}>{empresa.nombre}</Typography>
          <EtiquetaEstado texto={empresa.activa ? 'Activa' : 'Pausada'} variante={empresa.activa ? 'exito' : 'aviso'} />
        </Stack>
      </Stack>
    ),
  },
  {
    clave: 'tienda-web',
    encabezado: 'Tienda web',
    render: ({ resumen }) => (!resumen ? CARGANDO : resumen.dominioTienda === undefined ? NO_DISPONIBLE : resumen.dominioTienda ?? SIN_CONFIGURAR),
  },
  { clave: 'mercado-libre', encabezado: 'Mercado Libre', render: () => SIN_CONFIGURAR },
  { clave: 'precio', encabezado: 'Precio', render: ({ resumen }) => textoPrecio(resumen) },
  { clave: 'moneda', encabezado: 'Moneda', render: () => 'ARS' },
  {
    clave: 'productos-visibles',
    encabezado: 'Productos visibles',
    render: ({ resumen }) => (!resumen ? CARGANDO : resumen.productosVisibles === null ? NO_DISPONIBLE : String(resumen.productosVisibles)),
  },
]

// Solo con la sección Empresas en edición (FR-004): el destino del sider ya se oculta al miembro;
// acá, para quien llega por URL directa, no se consulta nada y se muestra
// acceso restringido. Es una restricción de UI: `empresas_select` deja leer a
// todo miembro de la organización por diseño (el selector de empresa lo
// necesitará); RLS garantiza el aislamiento por organización y la escritura
// de quien tiene la sección Empresas en edición. «Editar» lleva a General (F-EMP-02).
export function EmpresaList() {
  // La pantalla se gatea por la sección Empresas en edición (el criterio de la RLS de `dominio.empresas`); el alta, en cambio,
  // es de quien `puede_escribir` (la RPC `crear_empresa` lo exige), así que el botón sigue ese permiso.
  const { puedeEditar, isLoading: verificandoPermiso } = usePuedeEditarEmpresas()
  const { puedeEscribir } = usePuedeEscribir()
  const { empresas, isLoading, isError, refetch } = useEmpresas({ habilitado: puedeEditar === true })

  const resumenes = useResumenEmpresas(empresas.map((empresa) => empresa.id))
  const filas: FilaEmpresa[] = empresas.map((empresa) => ({ ...empresa, resumen: resumenes[empresa.id] }))

  const [dialogoAbierto, setDialogoAbierto] = useState(false)
  const [creada, setCreada] = useState(false)

  const alCrear = () => {
    setDialogoAbierto(false)
    setCreada(true)
    void refetch()
  }

  // El alta (F-EMP-03) solo se ofrece a quien además `puede_escribir` (administrador activo): la RPC `crear_empresa` exige
  // ese permiso y no el nivel de la sección, así que un rol con Empresas en edición ve la lista pero no este botón.
  const botonNueva = puedeEditar === true && puedeEscribir === true ? (
    <Button variant="contained" disabled={isLoading || isError} onClick={() => { setCreada(false); setDialogoAbierto(true) }}>Nueva empresa</Button>
  ) : undefined
  const encabezado = <EncabezadoPagina
    titulo="Empresas"
    descripcion="Cada empresa vende el catálogo compartido con su propio precio, tienda web y cuentas de Mercado Libre."
    accion={botonNueva}
    contexto={<ContextoOrganizacionActiva />}
  />


  if (verificandoPermiso || puedeEditar === null) {
    return (
      <Box>
        {encabezado}
        <ContenedorSeccion><EstadoCargaPagina /></ContenedorSeccion>
      </Box>
    )
  }

  if (!puedeEditar) {
    return <AccesoRestringido rol="actual" seccion="Empresas" />
  }

  return (
    <Box>
      {encabezado}
      <ContenedorSeccion>
        {creada ? <Box sx={{ mb: 2 }}><EstadoExito titulo="Empresa creada como borrador" /></Box> : null}
        {isLoading ? (
          <EstadoCargaPagina />
        ) : isError ? (
          <EstadoError descripcion="No pudimos cargar las empresas." reintentar={() => void refetch()} />
        ) : empresas.length === 0 ? (
          <EstadoVacio titulo="Todavía no hay empresas cargadas." />
        ) : (
          <>
          <BarraHerramientas
            contador={`${empresas.length} ${empresas.length === 1 ? 'empresa' : 'empresas'}`}
            ayuda="El catálogo es compartido: cada empresa tiene su precio, su tienda web y sus cuentas de Mercado Libre."
          />
          <ContenidoAdaptable
            items={filas}
            columnas={columnas}
            obtenerClave={(empresa) => empresa.id}
            etiquetaTabla="Empresas"
            acciones={(empresa) => (
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Button component={RouterLink} to={`/empresas/edit/${empresa.id}`} size="small" aria-label={`Editar ${empresa.nombre}`}>
                  Editar
                </Button>
                <Button component={RouterLink} to={`/empresas/${empresa.id}/tienda/identidad`} size="small" aria-label={`Abrir la tienda de ${empresa.nombre}`}>
                  Tienda
                </Button>
              </Stack>
            )}
          />
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2} sx={{ mt: 2 }}>
            <Typography color="text.secondary">Nueva empresa</Typography>
            <Button size="small" onClick={() => { setCreada(false); setDialogoAbierto(true) }} aria-label="Crear nueva empresa">Crear</Button>
          </Stack>
          </>
        )}
      </ContenedorSeccion>
      <DialogoNuevaEmpresa abierto={dialogoAbierto} empresas={empresas} onCerrar={() => setDialogoAbierto(false)} onCreada={alCrear} />
    </Box>
  )
}
