import { useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { Box, Button, Link, Menu, MenuItem, Stack, Tab, Tabs, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { EtiquetaEstado } from '../../../components/base/EtiquetaEstado'
import { urlDeTienda } from '../../../lib/tienda'
import { PESTANAS_TIENDA, type ClavePestanaTienda } from './pestanas'

export type EmpresaTienda = { id: string; nombre: string; activa: boolean }

type PropsEncabezadoTienda = {
  empresa: EmpresaTienda
  dominio: string | null
  otras: ReadonlyArray<{ id: string; nombre: string }>
  pestana: ClavePestanaTienda
  cambiando: boolean
  onCambiar: (empresa: { id: string; nombre: string }) => void
}

// Encabezado de la gestión de la tienda (FR-008): migas «Empresas › <empresa>», dominio y
// estado, «Cambiar a <otra empresa> ↔», «Ver tienda» y las pestañas. El nombre de la empresa
// y el dominio son lo visible; nunca el UUID.
export function EncabezadoTienda({ empresa, dominio, otras, pestana, cambiando, onCambiar }: PropsEncabezadoTienda) {
  const [ancla, setAncla] = useState<HTMLElement | null>(null)
  const botonRef = useRef<HTMLButtonElement>(null)

  return (
    <Stack component="header" sx={{ mb: 2.5 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        <Link component={RouterLink} to="/empresas" underline="hover" color="inherit">Empresas</Link>
        {' › '}
        {empresa.nombre}
      </Typography>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ sm: 'flex-start' }}
        spacing={2}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h1" variant="t1">{empresa.nombre}</Typography>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }} useFlexGap flexWrap="wrap">
            <Typography variant="body2" color="text.secondary">{dominio ?? 'Sin dominio configurado'}</Typography>
            <EtiquetaEstado texto={empresa.activa ? 'Publicada' : 'Pausada'} variante={empresa.activa ? 'exito' : 'aviso'} />
          </Stack>
        </Box>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ flexShrink: 0, alignItems: 'center' }}>
          {otras.length === 1 ? (
            <Button
              variant="text"
              disabled={cambiando}
              onClick={() => onCambiar(otras[0])}
              aria-label={`Cambiar a ${otras[0].nombre}`}
            >
              Cambiar a {otras[0].nombre} ↔
            </Button>
          ) : otras.length > 1 ? (
            <>
              <Button
                ref={botonRef}
                variant="text"
                disabled={cambiando}
                onClick={(event) => setAncla(event.currentTarget)}
                aria-haspopup="true"
                aria-expanded={Boolean(ancla)}
                aria-controls={ancla ? 'menu-cambiar-empresa-tienda' : undefined}
              >
                Cambiar de empresa
                <ExpandMoreIcon aria-hidden="true" fontSize="small" />
              </Button>
              <Menu id="menu-cambiar-empresa-tienda" anchorEl={ancla} open={Boolean(ancla)} onClose={() => setAncla(null)}>
                {otras.map((otra) => (
                  <MenuItem
                    key={otra.id}
                    onClick={() => { setAncla(null); onCambiar(otra) }}
                  >
                    {otra.nombre}
                  </MenuItem>
                ))}
              </Menu>
            </>
          ) : null}
          <Button
            variant="outlined"
            component="a"
            href={dominio ? urlDeTienda(dominio) : undefined}
            target="_blank"
            rel="noreferrer"
            disabled={!dominio}
            aria-label={`Ver la tienda de ${empresa.nombre}`}
          >
            Ver tienda
          </Button>
        </Stack>
      </Stack>
      <Tabs
        value={pestana}
        aria-label="Secciones de la tienda"
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ mt: 2 }}
      >
        {PESTANAS_TIENDA.map(({ clave, etiqueta }) => (
          <Tab
            key={clave}
            value={clave}
            label={etiqueta}
            component={RouterLink}
            to={`/empresas/${empresa.id}/tienda/${clave}`}
          />
        ))}
      </Tabs>
    </Stack>
  )
}
