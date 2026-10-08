import { useState } from 'react'
import {
  Paper,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { supabaseClient } from '../lib/supabase'

export type Organizacion = { id: string; nombre: string }
export type Feature = { id: string; nombre: string }
export type Habilitacion = { feature_id: string; organizacion_id: string }

type GrillaFeaturesPorOrganizacionProps = {
  organizaciones: Organizacion[]
  features: Feature[]
  habilitaciones: Habilitacion[]
  onCambio: () => Promise<void> | void
  onError: (mensaje: string) => void
}

const claveCelda = (featureId: string, organizacionId: string) => `${featureId}:${organizacionId}`

// Grilla organización × feature (US1): filas = organizaciones, columnas =
// features del catálogo, un Switch de MUI por celda. A diferencia de
// GrillaPermisosPorRol (puramente controlada, con un botón "Guardar" en el
// padre), acá cada toggle dispara habilitar_feature/deshabilitar_feature de
// inmediato — no hay guardado en lote (T008). Mensaje explícito si el
// catálogo todavía no tiene ninguna fila, en vez de una tabla sin columnas
// (FR-013).
export function GrillaFeaturesPorOrganizacion({
  organizaciones,
  features,
  habilitaciones,
  onCambio,
  onError,
}: GrillaFeaturesPorOrganizacionProps) {
  const [pendientes, setPendientes] = useState<Set<string>>(new Set())

  if (features.length === 0) {
    return (
      <Typography color="text.secondary">
        Todavía no hay funcionalidades registradas en el catálogo.
      </Typography>
    )
  }

  const estaHabilitada = (featureId: string, organizacionId: string) =>
    habilitaciones.some((h) => h.feature_id === featureId && h.organizacion_id === organizacionId)

  const toggle = async (featureId: string, organizacionId: string, habilitadaActual: boolean) => {
    const clave = claveCelda(featureId, organizacionId)
    setPendientes((anterior) => new Set(anterior).add(clave))

    const { error } = habilitadaActual
      ? await supabaseClient.rpc('deshabilitar_feature', {
          p_feature_id: featureId,
          p_organizacion_id: organizacionId,
        })
      : await supabaseClient.rpc('habilitar_feature', {
          p_feature_id: featureId,
          p_organizacion_id: organizacionId,
        })

    setPendientes((anterior) => {
      const siguiente = new Set(anterior)
      siguiente.delete(clave)
      return siguiente
    })

    if (error) {
      onError(error.message)
      return
    }

    await onCambio()
  }

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Organización</TableCell>
            {features.map((feature) => (
              <TableCell key={feature.id} align="center">
                {feature.nombre}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {organizaciones.map((organizacion) => (
            <TableRow key={organizacion.id}>
              <TableCell>{organizacion.nombre}</TableCell>
              {features.map((feature) => {
                const habilitada = estaHabilitada(feature.id, organizacion.id)
                const clave = claveCelda(feature.id, organizacion.id)
                return (
                  <TableCell key={feature.id} align="center">
                    <Switch
                      checked={habilitada}
                      disabled={pendientes.has(clave)}
                      onChange={() => toggle(feature.id, organizacion.id, habilitada)}
                      inputProps={{ 'aria-label': `${feature.nombre} — ${organizacion.nombre}` }}
                    />
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
