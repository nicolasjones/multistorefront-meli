import { useState } from 'react'
import { Stack, Tab, Tabs } from '@mui/material'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import {
  ATAJO_RANGO_INICIAL,
  SUBTITULO_REPORTES,
  TEXTO_AYUDA_EMPRESAS,
  TITULO_REPORTES,
  rangoPorAtajo,
  type RangoFechas,
} from '../../lib/ventas-reportes'
import { FiltrosPeriodo } from './FiltrosPeriodo'
import { MasVendidos } from './MasVendidos'
import { RankingClientes } from './RankingClientes'

type PestanaReporte = 'mas-vendidos' | 'ranking-clientes'

// Pestañas de la pantalla (FR-005): «Más vendidos» (F-VTA-22) y «Ranking de clientes» (F-VTA-23).
const PESTANAS: ReadonlyArray<{ valor: PestanaReporte; etiqueta: string }> = [
  { valor: 'mas-vendidos', etiqueta: 'Más vendidos' },
  { valor: 'ranking-clientes', etiqueta: 'Ranking de clientes' },
]

// «Reportes de ventas» (F-VTA-22, FR-005; VentasReportes.dc.html): el marco de la pantalla —título,
// subtítulo, pestañas, filtro de empresa y filtros de período— con el tablero embebido de la
// pestaña «Más vendidos». El filtro de empresa sigue a la empresa activa de la barra superior
// (Principio VIII): al cambiarla se vuelve a consultar el conteo y el tablero se remonta con la
// nueva tienda, así que nunca quedan filas de la empresa anterior.
export function ReportesVentas() {
  const [pestana, setPestana] = useState<PestanaReporte>('mas-vendidos')
  const [rango, setRango] = useState<RangoFechas>(() => rangoPorAtajo(ATAJO_RANGO_INICIAL))
  const {
    empresas,
    valor: empresaId,
    cambiar: elegirEmpresa,
    cargando: cargandoTiendas,
    hayError: errorTiendas,
  } = useFiltroPorEmpresaActiva()

  // El filtro nativo de empresa del tablero trabaja con el nombre de la tienda.
  const empresaNombre = empresas.find((empresa) => empresa.id === empresaId)?.nombre ?? null

  return (
    <Stack spacing={2}>
      <EncabezadoPagina
        titulo={TITULO_REPORTES}
        descripcion={SUBTITULO_REPORTES}
        contexto={<ContextoOrganizacionActiva />}
        pestanas={(
          <Tabs
            value={pestana}
            onChange={(_, valor: PestanaReporte) => setPestana(valor)}
            aria-label="Reportes de ventas"
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
          >
            {PESTANAS.map((opcion) => (
              <Tab key={opcion.valor} value={opcion.valor} label={opcion.etiqueta} />
            ))}
          </Tabs>
        )}
      />
      <FiltroEmpresa
        empresas={empresas}
        valor={empresaId}
        onCambiar={elegirEmpresa}
        cargando={cargandoTiendas}
        hayError={errorTiendas}
        textoAyuda={TEXTO_AYUDA_EMPRESAS}
      />
      <FiltrosPeriodo rango={rango} onCambiar={setRango} />
      {pestana === 'mas-vendidos' ? (
        <MasVendidos
          rango={rango}
          empresaId={empresaId}
          empresaNombre={empresaNombre}
          cargandoEmpresa={cargandoTiendas}
        />
      ) : (
        <RankingClientes />
      )}
    </Stack>
  )
}
