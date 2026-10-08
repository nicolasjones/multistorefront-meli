import { useEffect, useState } from 'react'
import { useTable } from '@refinedev/core'
import { CreateButton } from '@refinedev/mui'
import { Alert, Box } from '@mui/material'
import { useIsSuperadmin } from '../../hooks/useIsSuperadmin'
import { useContextoPanel } from '../../hooks/useContextoPanel'
import { supabaseClient } from '../../lib/supabase'
import { IdentidadVisible } from '../../components/identidad/IdentidadVisible'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'

type ServidorOrganizacion = {
  id: string
  organizacion_id: string
  host: string
  puerto_ssh: number
  usuario_ssh: string
  created_at: string
}

// Pantalla superadmin-only (US5, FR-014): listado de servidores de
// organización ya aprovisionados (host, organización, fecha de alta) +
// botón "Crear servidor" (lo agrega <List> solo si canCreate, ver App.tsx).
// Nunca muestra credencial_ssh_vault_id/credencial_db_vault_id — ni
// siquiera llegan acá: el GRANT de columna de la migración ya las excluye
// (R4, data-model.md).
export function ServidorList() {
  const { isSuperadmin, isLoading: checkingSuperadmin } = useIsSuperadmin()
  const { contexto } = useContextoPanel()
  // meta.select explícito: el GRANT de columna de la migración (R4) no
  // incluye credencial_ssh_vault_id/credencial_db_vault_id, y Postgres
  // rechaza toda la consulta (permission denied, 42501) si un `select *`
  // toca una sola columna sin privilegio — sin esto la pantalla nunca
  // carga, ni para superadmin.
  const { tableQuery } = useTable<ServidorOrganizacion>({
    resource: 'servidores_organizacion',
    meta: { select: 'id, organizacion_id, host, puerto_ssh, usuario_ssh, created_at' },
    syncWithLocation: false,
  })
  const [nombresOrganizacion, setNombresOrganizacion] = useState<Record<string, string>>({})

  useEffect(() => {
    // El superadmin ya ve todas las organizaciones (RLS de spec 003) — esta
    // consulta aparte solo arma el mapa id → nombre para la columna
    // "Organización" de la tabla de abajo.
    let activa = true
    supabaseClient
      .from('organizaciones')
      .select('id, nombre')
      .then(({ data }) => {
        if (!activa || !data) return
        setNombresOrganizacion(Object.fromEntries(data.map((o) => [o.id, o.nombre])))
      })
    return () => {
      activa = false
    }
  }, [])

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

  const servidores = tableQuery.data?.data ?? []

  const columnas: ColumnaAdaptable<ServidorOrganizacion>[] = [
    {
      clave: 'organizacion',
      encabezado: 'Organización',
      render: (servidor) => (
        <IdentidadVisible
          nombre={nombresOrganizacion[servidor.organizacion_id] ?? null}
          tipoOrigen="organizacion"
          idTecnico={servidor.organizacion_id}
          puedeCopiarIdTecnico={contexto?.puede_copiar_identificador_tecnico ?? false}
        />
      ),
    },
    { clave: 'host', encabezado: 'Host', render: (servidor) => servidor.host },
    { clave: 'puerto', encabezado: 'Puerto SSH', render: (servidor) => servidor.puerto_ssh },
    { clave: 'usuario', encabezado: 'Usuario SSH', render: (servidor) => servidor.usuario_ssh },
    { clave: 'alta', encabezado: 'Alta', render: (servidor) => new Date(servidor.created_at).toLocaleString() },
  ]

  return (
    <Box>
      <EncabezadoPagina titulo="Servidores de organización" descripcion="Servidores de organización aprovisionados en la plataforma." accion={<CreateButton />} />
      <ContenedorSeccion>
        {tableQuery.isLoading ? (
          <EstadoCargaPagina />
        ) : tableQuery.isError ? (
          <EstadoError descripcion="No pudimos cargar los servidores." reintentar={() => tableQuery.refetch()} />
        ) : servidores.length === 0 ? (
          <EstadoVacio titulo="Todavía no hay servidores de organización creados." />
        ) : (
          <ContenidoAdaptable
            items={servidores}
            columnas={columnas}
            obtenerClave={(servidor) => servidor.id}
            etiquetaTabla="Servidores de organización"
          />
        )}
      </ContenedorSeccion>
    </Box>
  )
}
