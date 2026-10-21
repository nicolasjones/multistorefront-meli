// Recorrido visible (spec 022, evidencia mir-able): cursor gigante con ripple
// en cada clic y rótulo narrando cada paso. Solo actúa con `E2E_VISIBLE=1`;
// sin la variable, `paso` ejecuta la acción sin tocar nada (la suite corre igual).
import type { Page } from '@playwright/test'

export const VISIBLE = process.env.E2E_VISIBLE === '1'

// Cursor rojo grande + onda expansiva en cada clic + rótulo. Se instala con
// `addInitScript` para que sobreviva a cada navegación. Funciona en headless
// (donde no hay puntero nativo) y en headed (oculta el nativo para no duplicar).
export async function prepararPaginaVisible(page: Page): Promise<void> {
  if (!VISIBLE) return
  await asegurarOverlay(page)
}

// Inyección directa (evaluada en cada paso): no depende de addInitScript,
// por si el documento inicial o una navegación temprana la saltean.
async function asegurarOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.getElementById('__e2e_css')) return
    const css = document.createElement('style')
    css.id = '__e2e_css'
    css.textContent = `
      body.__e2e_visible, body.__e2e_visible * { cursor: none !important; }
      #__e2e_cursor { position: fixed; left: 0; top: 0; width: 34px; height: 34px; margin: -17px 0 0 -17px;
        z-index: 2147483647; pointer-events: none; }
      .__e2e_ripple { position: fixed; z-index: 2147483647; pointer-events: none;
        border: 5px solid #ff2d2d; border-radius: 50%; animation: __e2e_onda 0.6s ease-out forwards; }
      @keyframes __e2e_onda { from { width: 20px; height: 20px; margin: -10px 0 0 -10px; opacity: 1; }
        to { width: 90px; height: 90px; margin: -45px 0 0 -45px; opacity: 0; } }
      #__e2e_rotulo { position: fixed; left: 24px; bottom: 24px; z-index: 2147483647;
        background: #111; color: #fff; font: 600 22px/1.5 system-ui, sans-serif;
        padding: 12px 20px; border-radius: 12px; opacity: 0.94; pointer-events: none;
        border-left: 8px solid #ff2d2d; max-width: 70vw; }`
    document.head.appendChild(css)
    document.body.classList.add('__e2e_visible')
    const cursor = document.createElement('div')
    cursor.id = '__e2e_cursor'
    cursor.innerHTML = `<svg width="34" height="34" viewBox="0 0 34 34"><circle cx="17" cy="17" r="12" fill="#ff2d2d" fill-opacity="0.85" stroke="#fff" stroke-width="3"/><circle cx="17" cy="17" r="4" fill="#fff"/></svg>`
    document.body.appendChild(cursor)
    // Estacionado al centro hasta el primer movimiento: siempre visible.
    cursor.style.transform = `translate(${window.innerWidth / 2}px, ${window.innerHeight / 2}px)`
    document.addEventListener('mousemove', (e) => {
      cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
    })
    document.addEventListener('mousedown', (e) => {
      const onda = document.createElement('div')
      onda.className = '__e2e_ripple'
      onda.style.left = `${e.clientX}px`
      onda.style.top = `${e.clientY}px`
      document.body.appendChild(onda)
      setTimeout(() => onda.remove(), 650)
    })
  }).catch(() => {})
}

// Un paso narrado del recorrido: asegura el overlay, muestra el rótulo y ejecuta la acción.
export async function paso<T>(page: Page, texto: string, accion: () => Promise<T> | T): Promise<T> {
  if (VISIBLE) {
    await asegurarOverlay(page)
    await page.evaluate((t) => {
      let el = document.getElementById('__e2e_rotulo')
      if (!el) {
        el = document.createElement('div')
        el.id = '__e2e_rotulo'
        document.body.appendChild(el)
      }
      el.textContent = t
    }, texto).catch(() => {})
  }
  return accion()
}
