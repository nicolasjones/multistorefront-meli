// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface Rewrite {
  source: string
  destination: string
}
interface HeaderRule {
  source: string
  headers: { key: string; value: string }[]
}
const config = JSON.parse(
  readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'),
) as { rewrites: Rewrite[]; headers: HeaderRule[] }

describe('vercel.json /health', () => {
  it('reescribe /health a /health.json antes del catch-all', () => {
    const health = config.rewrites.findIndex((r) => r.source === '/health')
    const catchAll = config.rewrites.findIndex((r) => r.source === '/(.*)')
    expect(health).toBeGreaterThanOrEqual(0)
    expect(config.rewrites[health].destination).toBe('/health.json')
    expect(catchAll).toBeGreaterThan(health)
  })

  it.each(['/health', '/health.json'])(
    'fija no-store y application/json en %s',
    (source) => {
      const rule = config.headers.find((h) => h.source === source)
      const get = (key: string) =>
        rule?.headers.find((h) => h.key === key)?.value
      expect(get('Cache-Control')).toBe('no-store')
      expect(get('Content-Type')).toBe('application/json')
    },
  )
})
