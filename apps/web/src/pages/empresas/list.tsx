import { useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { Box, Button, Stack, Typography } from '@mui/material'
import { useEmpresas, type Empresa } from '../../hooks/useEmpresas'
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

// Tienda web, Mercado Libre, precio y productos visibles los alimentan otras
// épicas; hasta entonces el listado dice «Sin configurar». La moneda es
// constante del producto (ARS), no una columna.
const columnas: ColumnaAdaptable<Empresa>[] = [
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
  { clave: 'tienda-web', encabezado: 'Tienda web', render: () => SIN_CONFIGURAR },
  { clave: 'mercado-libre', encabezado: 'Mercado Libre', render: () => SIN_CONFIGURAR },
  { clave: 'precio', encabezado: 'Precio', render: () => SIN_CONFIGURAR },
  { clave: 'moneda', encabezado: 'Moneda', render: () => 'ARS' },
  { clave: 'productos-visibles', encabezado: 'Productos visibles', render: () => SIN_CONFIGURAR },
]

// Solo administrador (FR-004): el destino del sider ya se oculta al miembro;
// acá, para quien llega por URL directa, no se consulta nada y se muestra
// acceso restringido. Es una restricción de UI: `empresas_select` deja leer a
// todo miembro de la organización por diseño (el selector de empresa lo
// necesitará); RLS garantiza el aislamiento por organización y la escritura
// solo de administradores. «Editar» lleva a General (F-EMP-02).
export function EmpresaList() {
  const { puedeEscribir, isLoading: verificandoPermiso } = usePuedeEscribir()
  const { empresas, isLoading, isError, refetch } = useEmpresas({ habilitado: puedeEscribir === true })

  const [dialogoAbierto, setDialogoAbierto] = useState(false)
  const [creada, setCreada] = useState(false)

  const alCrear = () => {
    setDialogoAbierto(false)
    setCreada(true)
    void refetch()
  }

  // El alta (F-EMP-03) solo se ofrece a quien puede escribir; esta pantalla ya
  // es solo de administradores, y la RPC rechaza igual a cualquier otro.
  const botonNueva = puedeEscribir === true ? (
    <Button variant="contained" disabled={isLoading || isError} onClick={() => { setCreada(false); setDialogoAbierto(true) }}>Nueva empresa</Button>
  ) : undefined
  const encabezado = <EncabezadoPagina
    titulo="Empresas"
    descripcion="Cada empresa vende el catálogo compartido con su propio precio, tienda web y cuentas de Mercado Libre."
    accion={botonNueva}
    contexto={<ContextoOrganizacionActiva />}
  />


  if (verificandoPermiso || puedeEscribir === null) {
    return (
      <Box>
        {encabezado}
        <ContenedorSeccion><EstadoCargaPagina /></ContenedorSeccion>
      </Box>
    )
  }

  if (!puedeEscribir) {
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
            items={empresas}
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
