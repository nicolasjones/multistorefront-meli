import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { COLUMNAS_RANKING_VENTAS } from '../../lib/exportarRankingVentas'

// El Excel y la pantalla del ranking de clientes tienen que mostrar LO MISMO (SC-004, FR-009): la
// pantalla la dibuja Superset con los YAML versionados y el Excel lo arma la RPC
// `public.leer_ranking_ventas` (migración). La tabla del tablero no se puede renderizar en Vitest,
// así que este contrato compara los artefactos de los dos lados: si una fórmula o una columna cambia
// de un lado y no del otro, el test lo dice.
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')
const leer = (...partes: string[]) => readFileSync(path.join(raiz, ...partes), 'utf8')

const grafico = leer('infra/superset/dashboards/ventas-reportes/charts/Ranking_clientes_1.yaml')
const dataset = leer('infra/superset/dashboards/ventas-reportes/datasets/Ventas_analitica/ranking_clientes.yaml')
const rpc = leer('supabase/migrations/20270104090200_lectura_ranking_excel.sql')

// Los fragmentos del SQL se comparan sin saltos de línea: el archivo se puede formatear sin que el
// contrato se rompa.
const plano = (texto: string) => texto.replace(/\s+/g, ' ').trim()
const rpcPlano = plano(rpc)

// Etiqueta visible de una columna o métrica del dataset (el tablero la muestra con ese nombre).
// El YAML entrecomilla los valores que empiezan con `#` (allí sería un comentario).
const etiqueta = (nombre: string): string => {
  const encontrado = dataset.match(new RegExp(`- (?:metric_name|column_name): ${nombre}\\n  verbose_name: (.+)`))
  expect(encontrado, `el dataset declara «${nombre}»`).not.toBeNull()
  return encontrado![1].trim().replace(/^'(.*)'$/, '$1')
}

type ParamsGrafico = {
  groupby: string[]
  metrics: string[]
  timeseries_limit_metric: string
  order_desc: boolean
}

const params = JSON.parse(grafico.match(/^params: (.+)$/m)![1]) as ParamsGrafico

describe('ranking de clientes: el Excel y la pantalla (F-VTA-23, FR-009, SC-004)', () => {
  it('muestran las mismas columnas, en el mismo orden', () => {
    // El tablero muestra primero las columnas del grupo (Cliente, Nº, Tipo) y después las métricas
    // (#, Comprobantes, Facturado, Participación, Último comprador).
    const columnasPantalla = [...params.groupby, ...params.metrics].map(etiqueta)
    expect(columnasPantalla).toEqual([
      'Cliente',
      'Nº',
      'Tipo',
      '#',
      'Comprobantes',
      'Facturado',
      'Participación',
      'Último comprador',
    ])
    // El Excel arma las mismas columnas, en el mismo orden.
    expect(COLUMNAS_RANKING_VENTAS.map((columna) => columna.encabezado)).toEqual(columnasPantalla)
  })

  it('ordenan el ranking por la misma facturación y con el mismo desempate', () => {
    // La tabla del tablero ordena por facturación neta descendente…
    expect(params.timeseries_limit_metric).toBe('facturado_total')
    expect(params.order_desc).toBe(true)
    // …y las dos partes calculan la posición con el mismo criterio (facturado desc, nombre, número).
    expect(dataset).toContain('expression: ROW_NUMBER() OVER (ORDER BY SUM(facturado) DESC, lower(nombre), numero)')
    expect(rpcPlano).toContain('row_number() over (order by a.facturado desc, lower(a.nombre), a.numero) as posicion')
  })

  it('suman el facturado, los comprobantes y la última compra igual', () => {
    expect(dataset).toContain('expression: SUM(facturado)')
    expect(dataset).toContain('expression: SUM(comprobantes)')
    expect(dataset).toContain('expression: MAX(ultimo_comprador)')
    expect(rpcPlano).toContain('sum(v.facturado)::numeric as facturado')
    expect(rpcPlano).toContain('sum(v.comprobantes)::bigint as comprobantes')
    expect(rpcPlano).toContain('max(v.ultimo_comprador) as ultimo_comprador')
  })

  it('calculan la participación sobre el total del alcance ya filtrado', () => {
    // El tablero: la facturación del cliente sobre la suma de todo el resultado filtrado.
    expect(dataset).toContain('SUM(facturado) / SUM(SUM(facturado)) OVER ()')
    // La RPC: lo mismo, en porcentaje (el Excel lo escribe como fracción y lo formatea como %).
    expect(rpcPlano).toContain('a.facturado * 100 / t.facturado_total')
  })

  it('leen la misma vista y filtran por el mismo período, tienda y «Consumidor final»', () => {
    // Una sola fuente: la vista del contrato, la que lee el tablero.
    expect(dataset).toContain('schema: analitica')
    expect(dataset).toContain('table_name: ventas_ranking_clientes')
    expect(rpcPlano).toContain('from analitica.ventas_ranking_clientes v')

    // Período: el filtro nativo del tablero y el `between` de la RPC.
    expect(rpcPlano).toContain('v.fecha between p_desde and p_hasta')
    // Tienda: el tablero filtra por nombre (único por organización) y la RPC por id.
    expect(rpcPlano).toContain('v.empresa_id = any (select private.empresas_accesibles())')
    expect(rpcPlano).toContain('(p_empresa_id is null or v.empresa_id = p_empresa_id)')
    // «Consumidor final»: el tablero filtra por la columna calculada y la RPC por la marca.
    expect(rpcPlano).toContain('(p_incluir_consumidor_final or not v.consumidor_final)')
  })

  it('el Excel no puede ampliar el alcance y el servidor rechaza sin permiso', () => {
    expect(rpcPlano).toContain('v.organizacion_id = v_organizacion')
    expect(rpcPlano).toContain(
      "raise exception 'Tu rol no puede ver los reportes de ventas' using errcode = '42501'",
    )
  })
})
