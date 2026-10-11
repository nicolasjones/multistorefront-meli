import { afterEach, describe, expect, it } from 'vitest'
import { healthPayload } from './vite-plugin-health.ts'

const VARS = ['VERCEL_GIT_COMMIT_SHA', 'GITHUB_SHA'] as const
const original = Object.fromEntries(VARS.map((k) => [k, process.env[k]]))

function setEnv(values: Partial<Record<(typeof VARS)[number], string>>) {
  for (const k of VARS) delete process.env[k]
  Object.assign(process.env, values)
}

afterEach(() => {
  for (const k of VARS) {
    if (original[k] === undefined) delete process.env[k]
    else process.env[k] = original[k]
  }
})

describe('healthPayload', () => {
  it('prioriza VERCEL_GIT_COMMIT_SHA', () => {
    setEnv({ VERCEL_GIT_COMMIT_SHA: 'vercel123', GITHUB_SHA: 'gh456' })
    expect(healthPayload()).toEqual({ status: 'ok', commit: 'vercel123' })
  })

  it('cae a GITHUB_SHA si no hay SHA de Vercel', () => {
    setEnv({ GITHUB_SHA: 'gh456' })
    expect(healthPayload().commit).toBe('gh456')
  })

  it('usa "dev" sin ninguna variable de SHA', () => {
    setEnv({})
    expect(healthPayload().commit).toBe('dev')
  })

  it('expone solo status y commit', () => {
    setEnv({ GITHUB_SHA: 'abc' })
    expect(Object.keys(healthPayload()).sort()).toEqual(['commit', 'status'])
  })
})
