import { useCallback, useEffect, useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router'
import { Box, Button, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import {
  etiquetaEntidadMigracion,
  listarCargasMigracion,
  mensajeDeErrorMigracion,
  type CargaMigracion,
} from '../../lib/migracion'
import { supabaseClient } from '../../lib/supabase'
import { InformeConciliacion } from './InformeConciliacion'

const ESTADOS: Readonly<Record<CargaMigracion['estado'], { etiqueta: string; color: 'default' | 'success' | 'warning' }>> = {
  en_curso: { etiqueta: 'En curso', color: 'default' },
  aplicada: { etiqueta: 'Aplicada', color: 'success' },
  fallida: { etiqueta: 'Incompleta', color: 'warning' },
}

const formatearFecha = (iso: string) => {
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toLocaleString('es-AR')
}

function SinPermiso() {
  return (
    <Box sx={{ m: 2 }}>
      <EstadoError
        titulo="Sin permiso"
        descripcion="Solo un administrador de la organización puede consultar las cargas de migración."
      />
    </Box>
  )
}

// F-MIG-04 (FR-040, FR-044): cargas de migración de la organización y su informe de conciliación,
// consultable de nuevo en cualquier momento. Solo Administrador; la base lo vuelve a imponer.
export function MigracionInformes() {
  const { puedeEscribir, isLoading } = usePuedeEscribir()
  const [cargas, setCargas] = useState<CargaMigracion[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargas(null)
    setError(null)
    try {
      setCargas(await listarCargasMigracion(supabaseClient))
    } catch (excepcion) {
      setError(mensajeDeErrorMigracion(excepcion, 'No pudimos cargar las cargas de migración.'))
    }
  }, [])

  useEffect(() => {
    if (puedeEscribir) void cargar()
  }, [puedeEscribir, cargar])

  if (isLoading) return <EstadoCargaPagina />
  if (!puedeEscribir) return <SinPermiso />

  return (
    <Box>
      <EncabezadoPagina
        titulo="Informes de conciliación"
        descripcion="Cada carga de migración con su informe: filas del archivo contra lo cargado."
        contexto={<ContextoOrganizacionActiva />}
        accion={<Button component={RouterLink} to="/migracion/importar/clientes" variant="outlined">Importar datos</Button>}
      />
      <ContenedorSeccion>
        {error ? (
          <EstadoError descripcion={error} reintentar={() => void cargar()} />
        ) : cargas === null ? (
          <EstadoCargaPagina />
        ) : cargas.length === 0 ? (
          <EstadoVacio
            titulo="Todavía no hay cargas de migración."
            descripcion="Cuando importes un archivo, su informe de conciliación aparece acá."
          />
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label="Cargas de migración">
              <TableHead>
                <TableRow>
                  <TableCell>Fecha</TableCell>
                  <TableCell>Datos</TableCell>
                  <TableCell>Archivo</TableCell>
                  <TableCell align="right">Filas</TableCell>
                  <TableCell>Estado</TableCell>
                  <TableCell>Informe</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {cargas.map((carga) => (
                  <TableRow key={carga.id}>
                    <TableCell>{formatearFecha(carga.creadaEn)}</TableCell>
                    <TableCell>{etiquetaEntidadMigracion(carga.entidad)}</TableCell>
                    <TableCell>{carga.archivo}</TableCell>
                    <TableCell align="right">{carga.filasTotal}</TableCell>
                    <TableCell>
                      <Chip size="small" color={ESTADOS[carga.estado].color} label={ESTADOS[carga.estado].etiqueta} />
                    </TableCell>
                    <TableCell>
                      <Button
                        component={RouterLink}
                        to={`/migracion/informes/${carga.id}`}
                        size="small"
                        aria-label={`Ver informe de ${carga.archivo}`}
                      >
                        Ver informe
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </ContenedorSeccion>
    </Box>
  )
}

// Informe de una carga concreta (ruta canónica `/migracion/informes/:carga`).
export function MigracionInformeDetalle() {
  const { carga } = useParams<{ carga: string }>()
  const { puedeEscribir, isLoading } = usePuedeEscribir()

  if (isLoading) return <EstadoCargaPagina />
  if (!puedeEscribir) return <SinPermiso />

  return (
    <Box>
      <EncabezadoPagina
        titulo="Informe de conciliación"
        contexto={<ContextoOrganizacionActiva />}
        accion={<Button component={RouterLink} to="/migracion/informes" variant="outlined">Volver a las cargas</Button>}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          {carga ? <InformeConciliacion carga={carga} /> : <EstadoError titulo="Carga desconocida" descripcion="Elegí una carga de la lista." />}
        </Stack>
      </ContenedorSeccion>
    </Box>
  )
}
