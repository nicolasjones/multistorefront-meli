// Recorrido visible (spec 022, evidencia mir-able): cursor gigante con ripple
// en cada clic y rótulo narrando cada paso. Solo actúa con `E2E_VISIBLE=1`;
// sin la variable, `paso` ejecuta la acción sin tocar nada (la suite corre igual).
import type { Locator, Page } from '@playwright/test'

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
      #__e2e_cursor { position: fixed; left: 0; top: 0; width: 64px; height: 64px; margin: -32px 0 0 -32px;
        z-index: 2147483647; pointer-events: none;
        filter: drop-shadow(0 0 6px rgba(0,0,0,.9)) drop-shadow(0 0 2px rgba(0,0,0,1)); }
      .__e2e_ripple { position: fixed; z-index: 2147483647; pointer-events: none;
        border: 6px solid #ff2d2d; border-radius: 50%; animation: __e2e_onda 1s ease-out forwards; }
      @keyframes __e2e_onda { from { width: 30px; height: 30px; margin: -15px 0 0 -15px; opacity: 1; }
        to { width: 140px; height: 140px; margin: -70px 0 0 -70px; opacity: 0; } }
      .__e2e_clic { position: fixed; z-index: 2147483646; pointer-events: none;
        border: 5px solid #ff2d2d; border-radius: 8px; background: rgba(255,45,45,.12);
        box-shadow: 0 0 0 3px #fff, 0 0 18px rgba(255,45,45,.9); }
      #__e2e_rotulo { position: fixed; left: 24px; bottom: 24px; z-index: 2147483647;
        background: #111; color: #fff; font: 700 44px/1.35 system-ui, sans-serif;
        padding: 18px 28px; border-radius: 16px; opacity: 0.96; pointer-events: none;
        border-left: 12px solid #ff2d2d; max-width: 82vw; }`
    document.head.appendChild(css)
    document.body.classList.add('__e2e_visible')
    const cursor = document.createElement('div')
    cursor.id = '__e2e_cursor'
    cursor.innerHTML = `<svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="23" fill="#ff2d2d" fill-opacity="0.92" stroke="#fff" stroke-width="6"/><circle cx="32" cy="32" r="8" fill="#fff"/></svg>`
    document.body.appendChild(cursor)
    // Estacionado al centro hasta el primer movimiento: siempre visible.
    cursor.style.transform = `translate(${window.innerWidth / 2}px, ${window.innerHeight / 2}px)`
    document.addEventListener('mousemove', (e) => {
      cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
    })
    document.addEventListener('mousedown', (e) => {
      // Onda en el punto del clic.
      const onda = document.createElement('div')
      onda.className = '__e2e_ripple'
      onda.style.left = `${e.clientX}px`
      onda.style.top = `${e.clientY}px`
      document.body.appendChild(onda)
      setTimeout(() => onda.remove(), 1050)
      // Recuadro del elemento clicado (lo que realmente se aprieta).
      const t = e.target as Element | null
      const r = t && typeof (t as Element).getBoundingClientRect === 'function'
        ? (t as Element).getBoundingClientRect()
        : null
      if (r && r.width > 0 && r.height > 0) {
        const marco = document.createElement('div')
        marco.className = '__e2e_clic'
        marco.style.left = `${r.left - 6}px`
        marco.style.top = `${r.top - 6}px`
        marco.style.width = `${r.width + 12}px`
        marco.style.height = `${r.height + 12}px`
        document.body.appendChild(marco)
        setTimeout(() => marco.remove(), 1200)
      }
    })
  }).catch(() => {})
}

// Pausa para leer el rótulo antes de actuar (solo modo visible): el video
// queda a ritmo de persona mirando, no de máquina.
const PAUSA_LECTURA_MS = 2200
const PAUSA_RESULTADO_MS = 900

async function mostrarRotulo(page: Page, texto: string): Promise<void> {
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

// Un paso narrado del recorrido: anuncia lo que viene, espera a que se lea,
// ejecuta la acción y deja ver el resultado antes de seguir.
export async function paso<T>(page: Page, texto: string, accion: () => Promise<T> | T): Promise<T> {
  if (VISIBLE) {
    await mostrarRotulo(page, texto)
    await new Promise((r) => setTimeout(r, PAUSA_LECTURA_MS))
  }
  const resultado = await accion()
  // Reafirmar el rótulo después de la acción: una navegación reemplaza el
  // documento y con él el overlay; así el caption sobrevive al goto.
  if (VISIBLE) {
    await mostrarRotulo(page, texto)
    await new Promise((r) => setTimeout(r, PAUSA_RESULTADO_MS))
  }
  return resultado
}

// Clic con mouse visible: en modo visible el cursor viaja hasta el elemento
// (se ve el movimiento en el video); sin la variable es un clic normal.
export async function clic(page: Page, destino: Locator): Promise<void> {
  if (VISIBLE) {
    const caja = await destino.boundingBox()
    if (caja) {
      await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2, { steps: 30 })
      await page.waitForTimeout(350)
    }
  }
  await destino.click()
}

// Escribir con mouse visible: va al campo y tipea a ritmo de persona.
export async function escribir(page: Page, destino: Locator, texto: string): Promise<void> {
  if (!VISIBLE) return void (await destino.fill(texto))
  await clic(page, destino)
  await destino.fill('')
  await page.keyboard.type(texto, { delay: 90 })
}
