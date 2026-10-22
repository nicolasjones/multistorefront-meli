import { Box, Button, Divider, Stack, Switch, Typography } from '@mui/material'
import type { Empresa } from '../../hooks/useEmpresas'
import { TEXTO_EMPRESAS_COMPARTIDO, notaVisibilidad } from '../../lib/productoEmpresas'

type Props = {
  empresas: readonly Empresa[]
  // Ids de las empresas que venden el producto.
  seleccion: readonly string[]
  onCambiar: (seleccion: string[]) => void
  cargando?: boolean
  hayError?: boolean
  onReintentar?: () => void
  // Solo lectura (FR-011): se ven las empresas sin poder cambiarlas.
  soloLectura?: boolean
  deshabilitado?: boolean
}

// Sección «Empresas que lo venden» del alta y la edición de productos (F-CAT-07, FR-011): una fila por
// empresa de la organización con nombre, «Precio: —» (llega con Precios, MSF-114) e interruptor
// accesible. No asume cuántas empresas hay. El prototipo muestra además el dominio web de cada tienda:
// la empresa todavía no lo guarda, así que no se inventa.
export function EmpresasProducto({ empresas, seleccion, onCambiar, cargando = false, hayError = false, onReintentar, soloLectura = false, deshabilitado = false }: Props) {
  const elegidas = new Set(seleccion)
  const nombresVisibles = empresas.filter((empresa) => elegidas.has(empresa.id)).map((empresa) => empresa.nombre)

  const alternar = (id: string, vende: boolean) => {
    const siguiente = new Set(elegidas)
    if (vende) siguiente.add(id)
    else siguiente.delete(id)
    onCambiar(Array.from(siguiente))
  }

  return (
    <Box component="section" aria-labelledby="empresas-producto-titulo">
      <Typography id="empresas-producto-titulo" variant="t3" component="h2">Empresas que lo venden</Typography>
      <Typography variant="xs" component="p" sx={{ mt: 0.5 }}>{TEXTO_EMPRESAS_COMPARTIDO}</Typography>
      {cargando ? (
        <Typography variant="s" role="status" sx={{ mt: 1 }}>Cargando empresas…</Typography>
      ) : hayError ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
          <Typography variant="s" role="alert">No pudimos cargar las empresas.</Typography>
          {onReintentar ? <Button size="small" onClick={onReintentar}>Reintentar empresas</Button> : null}
        </Stack>
      ) : empresas.length === 0 ? (
        <Typography variant="s" sx={{ mt: 1 }}>Todavía no hay empresas cargadas.</Typography>
      ) : (
        <>
          <Stack component="ul" divider={<Divider component="li" />} sx={{ listStyle: 'none', m: 0, p: 0, mt: 0.5 }}>
            {empresas.map((empresa) => (
              <Stack component="li" key={empresa.id} direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 1 }}>
                <Box>
                  <Typography variant="b" sx={{ fontWeight: 600 }} component="p">{empresa.activa ? empresa.nombre : `${empresa.nombre} (inactiva)`}</Typography>
                  <Typography variant="xs" component="p">Precio: —</Typography>
                </Box>
                <Switch
                  checked={elegidas.has(empresa.id)}
                  onChange={(evento) => alternar(empresa.id, evento.target.checked)}
                  disabled={soloLectura || deshabilitado}
                  slotProps={{ input: { role: 'switch', 'aria-label': empresa.nombre } }}
                />
              </Stack>
            ))}
          </Stack>
          <Typography variant="xs" component="p" role="status" sx={{ mt: 1 }}>{notaVisibilidad(nombresVisibles)}</Typography>
        </>
      )}
    </Box>
  )
}
