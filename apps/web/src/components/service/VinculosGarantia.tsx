import { useCallback, useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { Alert, Button, Card, CardContent, CardHeader, Link, Stack, Typography } from '@mui/material'
import { obtenerVinculosGarantia, type VinculosGarantia as Vinculos } from '../../lib/reparacionGarantia'

type Props = { reparacionId: string }

const rutaReparacion = (id: string) => `/service-tecnico/reparaciones/${id}`

const formatoFecha = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeZone: 'UTC' })

// Vínculos de garantía (FR-023): en el reingreso, «Reingreso por garantía de R-xxxx» con enlace a la original; en la
// original, la lista de sus reingresos. Sin vínculos no ocupa lugar. Se monta con `key` por reparación.
export function VinculosGarantia({ reparacionId }: Props) {
  const [vinculos, setVinculos] = useState<Vinculos | null>(null)
  const [error, setError] = useState(false)

  const cargar = useCallback(async () => {
    setError(false)
    try {
      setVinculos(await obtenerVinculosGarantia(reparacionId))
    } catch (causa) {
      console.error('No pudimos cargar los vínculos de garantía.', causa)
      setError(true)
    }
  }, [reparacionId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  if (error) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void cargar()}>Reintentar</Button>}>
        No pudimos cargar los vínculos de garantía.
      </Alert>
    )
  }
  if (!vinculos || (!vinculos.origen && vinculos.reingresos.length === 0)) return null

  return (
    <Card>
      <CardHeader title={<Typography component="h2" variant="t3">Garantía</Typography>} />
      <CardContent>
        <Stack spacing={1.5}>
          {vinculos.origen ? (
            <Typography variant="body2">
              Reingreso por garantía de{' '}
              <Link component={RouterLink} to={rutaReparacion(vinculos.origen.id)} underline="hover">
                {vinculos.origen.codigo}
              </Link>
            </Typography>
          ) : null}
          {vinculos.reingresos.length > 0 ? (
            <Stack spacing={0.5}>
              <Typography variant="body2" color="text.secondary">Reingresos por garantía</Typography>
              <Stack component="ul" spacing={0.5} sx={{ listStyle: 'none', m: 0, p: 0 }} aria-label="Reingresos por garantía">
                {vinculos.reingresos.map((reingreso) => (
                  <Typography component="li" variant="body2" key={reingreso.id}>
                    <Link component={RouterLink} to={rutaReparacion(reingreso.id)} underline="hover">{reingreso.codigo}</Link>
                    {` · ${reingreso.estado} · Ingreso ${formatoFecha.format(new Date(`${reingreso.ingreso}T00:00:00Z`))}`}
                  </Typography>
                ))}
              </Stack>
            </Stack>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  )
}
