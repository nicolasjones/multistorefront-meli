import { useEffect, useState } from 'react'
import { Box, Stack, Tab, Tabs } from '@mui/material'
import { EstadoCargaPagina } from '../../components/estados/EstadosPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ComisionesEquipo } from '../../components/service/ComisionesEquipo'
import { MisComisiones } from '../../components/service/MisComisiones'
import { PestanasService } from '../../components/service/PestanasService'
import { ReglasComision } from '../../components/service/ReglasComision'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { usePuedeAccion } from '../../hooks/usePuedeAccion'
import { listarTecnicos, type Tecnico } from '../../lib/reparaciones'
import { AccesoRestringido } from '../acceso-restringido/AccesoRestringido'

const SECCION = 'service_tecnico'
type Vista = 'mias' | 'equipo' | 'reglas'

// Service técnico · Comisiones (MSF-187, MSF-953, MSF-954, MSF-957). Todo el que tiene acceso a Servicio técnico ve «Mis
// comisiones» (lo propio, sin costos). «Equipo» y «Reglas» solo aparecen con la acción «Ver comisiones», que es independiente de
// «Ver costos»; la autoridad real es la base, acá solo se decide qué se ofrece. Empresa activa: no aplica (las comisiones son de
// la persona y del equipo de toda la organización; el equipo respeta las tiendas accesibles de quien mira).
export function ServicioComisiones() {
  const { nivel, isLoading: cargandoNivel } = useNivelSeccion(SECCION)
  const { puede: puedeVerEquipo } = usePuedeAccion(SECCION, 'ver_comisiones')
  const [vista, setVista] = useState<Vista>('mias')
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([])
  const sinAcceso = nivel !== null && nivel !== 'lectura' && nivel !== 'edicion'
  const equipo = puedeVerEquipo === true

  useEffect(() => {
    if (!equipo) return
    let vigente = true
    listarTecnicos().then((lista) => { if (vigente) setTecnicos(lista) }, () => { if (vigente) setTecnicos([]) })
    return () => { vigente = false }
  }, [equipo])

  // Si se pierde el permiso con una pestaña de equipo abierta, vuelve a «Mis comisiones».
  const vistaVigente: Vista = !equipo && vista !== 'mias' ? 'mias' : vista

  if (sinAcceso) return <AccesoRestringido rol="actual" seccion="Servicio técnico" seccionClave={SECCION} />

  return (
    <Box>
      <EncabezadoPagina
        titulo="Comisiones"
        descripcion="Lo que corresponde a cada técnico por la mano de obra de las reparaciones entregadas."
        contexto={<ContextoOrganizacionActiva />}
        pestanas={<PestanasService activa="comisiones" />}
      />
      <ContenedorSeccion>
        {cargandoNivel ? (
          <EstadoCargaPagina />
        ) : (
          <Stack spacing={2}>
            {equipo ? (
              <Tabs value={vistaVigente} onChange={(_, valor: Vista) => setVista(valor)} aria-label="Vistas de comisiones" variant="scrollable" scrollButtons="auto">
                <Tab value="mias" label="Mis comisiones" />
                <Tab value="equipo" label="Equipo" />
                <Tab value="reglas" label="Reglas" />
              </Tabs>
            ) : null}
            {vistaVigente === 'mias' ? <MisComisiones /> : null}
            {vistaVigente === 'equipo' && equipo ? <ComisionesEquipo /> : null}
            {vistaVigente === 'reglas' && equipo ? <ReglasComision tecnicos={tecnicos} puedeCargar={nivel === 'edicion'} /> : null}
          </Stack>
        )}
      </ContenedorSeccion>
    </Box>
  )
}
