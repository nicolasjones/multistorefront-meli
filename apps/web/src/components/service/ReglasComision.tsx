import { type FormEvent, useRef, useState } from 'react'
import { Alert, Box, Button, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'
import { EtiquetaEstado } from '../base/EtiquetaEstado'
import { useCargaComisiones } from '../../hooks/useCargaComisiones'
import { formatearPorcentaje, guardarReglaComision, listarReglasComision, mensajeDeErrorComisiones, type EstadoRegla } from '../../lib/comisiones'
import { formatearFechaDocumento } from '../../lib/documentosReparacion'
import { hoyEnArgentina, type Tecnico } from '../../lib/reparaciones'

const ETIQUETA: Record<EstadoRegla, { texto: string; variante: 'exito' | 'aviso' | 'neutral' }> = {
  vigente: { texto: 'Vigente', variante: 'exito' },
  futura: { texto: 'Futura', variante: 'aviso' },
  reemplazada: { texto: 'Reemplazada', variante: 'neutral' },
}

type Props = { tecnicos: Tecnico[]; puedeCargar: boolean }

// Reglas de comisión: porcentaje sobre la mano de obra, por técnico o general, con vigencia por fecha de entrega. Solo se
// agregan (no se editan ni se borran): para dejar de pagar comisión se carga una regla de 0 %. Cargar exige edición en Service
// y «Ver comisiones»; verlas, solo «Ver comisiones».
export function ReglasComision({ tecnicos, puedeCargar }: Props) {
  const { datos, cargando, error, recargar } = useCargaComisiones('reglas', listarReglasComision, 'No pudimos cargar las reglas de comisión.')
  const [tecnicoId, setTecnicoId] = useState('')
  const [porcentaje, setPorcentaje] = useState('')
  const [vigencia, setVigencia] = useState(() => hoyEnArgentina())
  const [errorForm, setErrorForm] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const enVuelo = useRef(false)

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (enVuelo.current) return
    const valor = porcentaje.trim().replace(',', '.')
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(valor) || Number(valor) > 100) {
      setErrorForm('El porcentaje tiene que estar entre 0 y 100, con hasta dos decimales')
      return
    }
    if (!vigencia) {
      setErrorForm('Indicá desde qué fecha rige')
      return
    }
    enVuelo.current = true
    setGuardando(true)
    setErrorForm(null)
    setAviso(null)
    try {
      await guardarReglaComision(tecnicoId === '' ? null : tecnicoId, Number(valor), vigencia)
      setAviso('Regla guardada.')
      setPorcentaje('')
      recargar()
    } catch (falla) {
      setErrorForm(mensajeDeErrorComisiones(falla, 'No pudimos guardar la regla. Probá de nuevo.'))
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  return (
    <Stack spacing={2}>
      {puedeCargar ? (
        <Box component="form" onSubmit={enviar} noValidate aria-label="Nueva regla de comisión">
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'flex-start' }}>
            <TextField select size="small" label="Técnico" value={tecnicoId} onChange={(e) => setTecnicoId(e.target.value)} sx={{ minWidth: 220 }}>
              <MenuItem value="">Todos los técnicos</MenuItem>
              {tecnicos.map((t) => <MenuItem key={t.user_id} value={t.user_id}>{t.nombre}</MenuItem>)}
            </TextField>
            <TextField
              size="small"
              label="Porcentaje"
              value={porcentaje}
              onChange={(e) => setPorcentaje(e.target.value)}
              helperText="Sobre la mano de obra, sin IVA"
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              sx={{ width: { md: 160 } }}
            />
            <TextField
              size="small"
              type="date"
              label="Rige desde"
              value={vigencia}
              onChange={(e) => setVigencia(e.target.value)}
              helperText="Según la fecha de entrega"
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <Button type="submit" variant="contained" disabled={guardando}>Agregar regla</Button>
          </Stack>
          {errorForm ? <Alert severity="error" sx={{ mt: 1.5 }}>{errorForm}</Alert> : null}
          {aviso ? <Alert severity="success" sx={{ mt: 1.5 }} role="status">{aviso}</Alert> : null}
        </Box>
      ) : (
        <Alert severity="info">Podés ver las reglas, pero cargarlas exige permiso de edición en Servicio técnico.</Alert>
      )}
      {cargando ? <EstadoCargaPagina lineas={2} etiqueta="Cargando las reglas" /> : null}
      {error ? <EstadoError titulo={error} reintentar={recargar} /> : null}
      {datos ? (
        datos.length === 0 ? (
          <EstadoVacio titulo="Todavía no hay reglas de comisión." descripcion="Sin una regla vigente a la fecha de entrega, una reparación no genera comisión." />
        ) : (
          <TableContainer tabIndex={0} role="region" aria-label="Reglas de comisión (se desplaza)">
            <Table size="small" aria-label="Reglas de comisión">
              <TableHead>
                <TableRow>
                  <TableCell>Técnico</TableCell>
                  <TableCell align="right">Porcentaje</TableCell>
                  <TableCell>Rige desde</TableCell>
                  <TableCell>Estado</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {datos.map((regla) => (
                  <TableRow key={regla.id}>
                    <TableCell component="th" scope="row">{regla.tecnico ?? 'Todos los técnicos'}</TableCell>
                    <TableCell align="right">{formatearPorcentaje(regla.porcentaje)}</TableCell>
                    <TableCell>{formatearFechaDocumento(regla.vigente_desde)}</TableCell>
                    <TableCell><EtiquetaEstado texto={ETIQUETA[regla.estado].texto} variante={ETIQUETA[regla.estado].variante} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )
      ) : null}
      <Typography variant="caption" color="text.secondary">
        La regla del técnico gana a la general; entre reglas del mismo alcance rige la de fecha más reciente que no supere la entrega. Las reglas solo se agregan.
      </Typography>
    </Stack>
  )
}
