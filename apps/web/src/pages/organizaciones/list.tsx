import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useTable } from '@refinedev/core'
import { CreateButton } from '@refinedev/mui'
import { Alert, Box, Button } from '@mui/material'
import { useIsSuperadmin } from '../../hooks/useIsSuperadmin'
import { useContextoPanel } from '../../hooks/useContextoPanel'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { supabaseClient } from '../../lib/supabase'

type Organizacion = {
  id: string
  nombre: string
  created_at: string
}

// Pantalla superadmin-only (FR-008): listado de organizaciones + botón
// "Crear organización" (lo agrega <List> solo si canCreate, ver App.tsx) +
// "Ingresar" por fila (US4, contrato: contracts/entrar-a-organizacion.md).
export function OrganizacionList() {
  const navigate = useNavigate()
  const { invalidar } = useContextoPanel()
  const { isSuperadmin, isLoading: checkingSuperadmin } = useIsSuperadmin()
  const { tableQuery } = useTable<Organizacion>({ resource: 'organizaciones', syncWithLocation: false })
  const [entrandoA, setEntrandoA] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (checkingSuperadmin) {
    return <EstadoCargaPagina />
  }

  if (!isSuperadmin) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        Esta pantalla es solo para el superadmin de la plataforma.
      </Alert>
    )
  }

  const organizaciones = tableQuery.data?.data ?? []

  const handleIngresar = async (organizacionId: string) => {
    setEntrandoA(organizacionId)
    setError(null)

    const { error: rpcError } = await supabaseClient.rpc('entrar_a_organizacion', {
      org_id: organizacionId,
    })

    if (rpcError) {
      setError(rpcError.message)
      setEntrandoA(null)
      return
    }

    // Navegación SPA, no recarga completa. El Sider ya no depende de
    // accessControlProvider.can vía react-query sino del contexto propio —
    // invalidar() le pide una versión nueva y así se entera de la
    // organización recién activada.
    invalidar()
    navigate('/clientes')
  }

  const encabezado = <EncabezadoPagina titulo="Organizaciones" descripcion="Organizaciones registradas en la plataforma." accion={<CreateButton />} />

  if (tableQuery.isLoading) {
    return (
      <Box>
        {encabezado}
        <ContenedorSeccion>
          <EstadoCargaPagina />
        </ContenedorSeccion>
      </Box>
    )
  }

  if (tableQuery.isError) {
    return (
      <Box>
        {encabezado}
        <ContenedorSeccion>
          <EstadoError descripcion="No pudimos cargar las organizaciones." reintentar={() => tableQuery.refetch()} />
        </ContenedorSeccion>
      </Box>
    )
  }

  const columnas: ColumnaAdaptable<Organizacion>[] = [
    { clave: 'nombre', encabezado: 'Nombre', render: (organizacion) => organizacion.nombre },
    { clave: 'creada', encabezado: 'Creada', render: (organizacion) => new Date(organizacion.created_at).toLocaleString() },
  ]

  return (
    <Box>
      {encabezado}
      <ContenedorSeccion>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {organizaciones.length === 0 ? (
          <EstadoVacio titulo="Todavía no hay organizaciones creadas." />
        ) : (
          <ContenidoAdaptable
            items={organizaciones}
            columnas={columnas}
            obtenerClave={(organizacion) => organizacion.id}
            etiquetaTabla="Organizaciones"
            acciones={(organizacion) => (
              <Button
                size="small"
                variant="outlined"
                disabled={entrandoA === organizacion.id}
                onClick={() => handleIngresar(organizacion.id)}
              >
                {entrandoA === organizacion.id ? 'Ingresando…' : 'Ingresar'}
              </Button>
            )}
          />
        )}
      </ContenedorSeccion>
    </Box>
  )
}
