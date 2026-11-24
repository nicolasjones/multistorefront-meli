import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NoIndexarPanel } from './NoIndexarPanel'

const robots = () => Array.from(document.head.querySelectorAll('meta[name="robots"]')).map((m) => m.getAttribute('content'))

describe('NoIndexarPanel', () => {
  it('pide no indexar mientras el panel está montado y lo quita al salir', () => {
    const { unmount } = render(<NoIndexarPanel />)
    expect(robots()).toEqual(['noindex,nofollow'])
    unmount()
    expect(robots()).toEqual([])
  })
})
