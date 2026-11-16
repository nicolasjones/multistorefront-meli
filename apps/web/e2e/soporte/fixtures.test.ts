import { describe, expect, it } from 'vitest'
import { validarDestinoSql, validarUrlSupabase } from './fixtures'

// Config de desarrollo sintética (los puertos reales del repo no importan: se cotejan contra esta).
const desarrollo = { projectId: 'demo-supabase-dev', puertos: { 'api.port': 9300, 'db.port': 7634, 'db.pooler.port': 57329 } }
// Stack del CI derivado de `desarrollo` para la ranura 0: base 20000 + puerto % 10000.
const ci = { GITHUB_REPOSITORY: 'org/demo', SUPABASE_CI_PROJECT_ID: 'ci-demo', SUPABASE_DB_PORT: '27634' }

describe('validarDestinoSql', () => {
  it('rechaza un host remoto explícito', () => {
    expect(() => validarDestinoSql({ ...ci, E2E_PGHOST: 'db.ejemplo.com' }, desarrollo)).toThrow(/no es local/)
  })
  it('rechaza si falta el puerto, sin default silencioso', () => {
    expect(() => validarDestinoSql({ SUPABASE_CI_PROJECT_ID: 'ci-demo' }, desarrollo)).toThrow(/puerto/)
    expect(() => validarDestinoSql({ ...ci, SUPABASE_DB_PORT: undefined, E2E_PGPORT: 'abc' }, desarrollo)).toThrow(/puerto/)
  })
  it('rechaza puertos fuera de rango', () => {
    expect(() => validarDestinoSql({ ...ci, E2E_PGPORT: '0' }, desarrollo)).toThrow(/rango/)
    expect(() => validarDestinoSql({ ...ci, E2E_PGPORT: '70000' }, desarrollo)).toThrow(/rango/)
  })
  it('rechaza el puerto de un stack de desarrollo, también reenviado', () => {
    expect(() => validarDestinoSql({ ...ci, E2E_PGPORT: '7634', SUPABASE_DB_PORT: '7634' }, desarrollo)).toThrow(/desarrollo/)
    expect(() => validarDestinoSql({ ...ci, SUPABASE_DB_PORT: '9300', E2E_PGPORT: undefined }, desarrollo)).toThrow(/desarrollo/)
  })
  it('rechaza E2E_PGPORT y SUPABASE_DB_PORT discordantes', () => {
    expect(() => validarDestinoSql({ ...ci, E2E_PGPORT: '27635' }, desarrollo)).toThrow(/no coinciden/)
  })
  it('rechaza un puerto que no es el de la base derivada del CI y un stack no preparado', () => {
    expect(() => validarDestinoSql({ ...ci, SUPABASE_DB_PORT: '45000' }, desarrollo)).toThrow(/stack del CI/)
    expect(() => validarDestinoSql({ ...ci, SUPABASE_CI_PROJECT_ID: 'otro' }, desarrollo)).toThrow(/stack del CI/)
    expect(() => validarDestinoSql({ SUPABASE_DB_PORT: '27634' }, desarrollo)).toThrow(/SUPABASE_CI_PROJECT_ID/)
  })
  it('rechaza una base o un usuario distintos de postgres', () => {
    expect(() => validarDestinoSql({ ...ci, E2E_PGDATABASE: 'produccion' }, desarrollo)).toThrow(/E2E_PGDATABASE/)
    expect(() => validarDestinoSql({ ...ci, E2E_PGUSER: 'admin' }, desarrollo)).toThrow(/E2E_PGUSER/)
  })
  it('acepta el destino local del stack efímero', () => {
    expect(validarDestinoSql(ci, desarrollo)).toMatchObject({ host: '127.0.0.1', port: 27634, database: 'postgres', user: 'postgres' })
    expect(validarDestinoSql({ ...ci, E2E_PGPORT: '27634', E2E_PGHOST: 'host.docker.internal' }, desarrollo).port).toBe(27634)
  })
})

describe('validarUrlSupabase', () => {
  it('rechaza un host remoto', () => {
    expect(() => validarUrlSupabase('https://x.supabase.co', {}, desarrollo)).toThrow(/no es un Supabase local/)
  })
  it('rechaza el puerto de un stack de desarrollo', () => {
    expect(() => validarUrlSupabase('http://127.0.0.1:9300', {}, desarrollo)).toThrow(/desarrollo/)
  })
  it('con stack del CI declarado exige el puerto de su API', () => {
    expect(() => validarUrlSupabase('http://host.docker.internal:25000', ci, desarrollo)).toThrow(/stack del CI/)
    expect(() => validarUrlSupabase('http://host.docker.internal:29300', ci, desarrollo)).not.toThrow()
  })
  it('sin stack del CI acepta un puerto local que no es de desarrollo', () => {
    expect(() => validarUrlSupabase('http://127.0.0.1:25000', {}, desarrollo)).not.toThrow()
  })
})
