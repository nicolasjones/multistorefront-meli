import { Box, Button, FormHelperText, Link, Stack, TextField, Typography } from '@mui/material'
import type { ChangeEvent, FormEvent } from 'react'
import { MAX_CONTACTO_PEDIDO, MAX_NOMBRE_PEDIDO, MAX_NOTA_PEDIDO, type CampoPedido, type DatosPedido, type ErroresPedido } from '../../../lib/tiendaPedido'
import { useLegalTienda } from '../../../lib/tiendaLegal'

// Formulario del pedido (MSF-176, B1, FR-025/FR-026, P-4). Visitante: «Nombre» (obligatorio, 1 a 100), «Correo o teléfono» (obligatorio) y «Nota (opcional)» (hasta 500, con contador),
// más el aviso «Usaremos estos datos solo para responderte.» con el enlace «Política de privacidad» si la tienda lo tiene (el mismo enlace legal del pie). Con cuenta activa no se pide nada:
// «Vamos a usar los datos de tu cuenta.» y queda la nota. El error de cada campo va debajo, asociado con `aria-describedby`; el foco va al primero con error (lo hace quien lo monta con `refs`).
export function FormularioPedido({ host, conCuenta, datos, errores, enviando, enviarDeshabilitado, alCambiar, alSalir, alEnviar, refs }: {
  host: string
  conCuenta: boolean
  datos: DatosPedido
  errores: ErroresPedido
  enviando: boolean
  // El envío espera la revalidación, el tiempo de espera de `limite` o que la lista tenga productos.
  enviarDeshabilitado: boolean
  alCambiar: (campo: CampoPedido, valor: string) => void
  // Al salir de un campo se valida ese campo (P-4: «se validan al enviar y al salir de cada campo»).
  alSalir: (campo: CampoPedido) => void
  alEnviar: () => void
  refs: (campo: CampoPedido, el: HTMLInputElement | HTMLTextAreaElement | null) => void
}) {
  const legal = useLegalTienda(host)
  const privacidad = legal?.enlaces.find((enlace) => /privacidad/i.test(enlace.titulo)) ?? null
  const cambiar = (campo: CampoPedido) => (evento: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => alCambiar(campo, evento.target.value)
  const enviar = (evento: FormEvent) => {
    evento.preventDefault()
    alEnviar()
  }
  const cantidadNota = datos.nota.length
  return (
    <Box component="form" noValidate onSubmit={enviar} aria-label="Enviar pedido" data-testid="formulario-pedido">
      <Stack spacing={2}>
        {conCuenta ? (
          <Typography>Vamos a usar los datos de tu cuenta.</Typography>
        ) : (
          <>
            <TextField
              label="Nombre"
              required
              fullWidth
              value={datos.nombre}
              onChange={cambiar('nombre')}
              onBlur={() => alSalir('nombre')}
              error={Boolean(errores.nombre)}
              helperText={errores.nombre}
              inputRef={(el: HTMLInputElement | null) => refs('nombre', el)}
              slotProps={{ htmlInput: { autoComplete: 'name', maxLength: MAX_NOMBRE_PEDIDO } }}
              sx={{ '& .MuiInputBase-root': { minHeight: (tema) => tema.spacing(5.5) } }}
            />
            <TextField
              label="Correo o teléfono"
              required
              fullWidth
              value={datos.contacto}
              onChange={cambiar('contacto')}
              onBlur={() => alSalir('contacto')}
              error={Boolean(errores.contacto)}
              helperText={errores.contacto}
              inputRef={(el: HTMLInputElement | null) => refs('contacto', el)}
              slotProps={{ htmlInput: { maxLength: MAX_CONTACTO_PEDIDO } }}
              sx={{ '& .MuiInputBase-root': { minHeight: (tema) => tema.spacing(5.5) } }}
            />
          </>
        )}
        <Box>
          <TextField
            label="Nota (opcional)"
            fullWidth
            multiline
            minRows={3}
            value={datos.nota}
            onChange={cambiar('nota')}
            onBlur={() => alSalir('nota')}
            error={Boolean(errores.nota)}
            helperText={errores.nota}
            inputRef={(el: HTMLTextAreaElement | null) => refs('nota', el)}
          />
          <FormHelperText component="p" sx={{ textAlign: 'right', mx: 0 }} error={cantidadNota > MAX_NOTA_PEDIDO}>{cantidadNota}/{MAX_NOTA_PEDIDO}</FormHelperText>
        </Box>
        {conCuenta ? null : (
          <Typography color="text.secondary" sx={{ fontSize: 13 /* estilos-sueltos: ok */ }}>
            Usaremos estos datos solo para responderte.{' '}
            {privacidad ? <Link href={privacidad.url} target="_blank" rel="noopener noreferrer" color="inherit">Política de privacidad</Link> : null}
          </Typography>
        )}
        <Button type="submit" variant="contained" size="large" fullWidth disabled={enviarDeshabilitado || enviando} aria-busy={enviando || undefined} sx={{ minHeight: (tema) => tema.spacing(6) }}>
          {enviando ? 'Enviando…' : 'Enviar pedido'}
        </Button>
      </Stack>
    </Box>
  )
}

