import { describe, expect, it } from 'vitest'
import { validarDestinoSql } from './fixtures'

describe('validarDestinoSql', () => {
  it('rechaza un host remoto o un túnel que no es local', () => {
    expect(() => validarDestinoSql({ E2E_PGHOST: 'db.ejemplo.com', E2E_PGPORT: '54322' })).toThrow(/no es local/)
  })
  it('rechaza si falta el puerto, sin default silencioso', () => {
    expect(() => validarDestinoSql({})).toThrow(/puerto/)
    expect(() => validarDestinoSql({ E2E_PGPORT: 'abc' })).toThrow(/puerto/)
  })
  it('rechaza una base o un usuario distintos de postgres', () => {
    expect(() => validarDestinoSql({ E2E_PGPORT: '1', E2E_PGDATABASE: 'produccion' })).toThrow(/E2E_PGDATABASE/)
    expect(() => validarDestinoSql({ E2E_PGPORT: '1', E2E_PGUSER: 'admin' })).toThrow(/E2E_PGUSER/)
  })
  it('acepta un destino local con puerto explícito', () => {
    expect(validarDestinoSql({ E2E_PGPORT: '7634' })).toMatchObject({ host: '127.0.0.1', port: 7634, database: 'postgres', user: 'postgres' })
    expect(validarDestinoSql({ SUPABASE_DB_PORT: '7634', E2E_PGHOST: 'host.docker.internal' }).port).toBe(7634)
  })
})
