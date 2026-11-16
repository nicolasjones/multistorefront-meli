// Estándar de evidencia E2E: todo test que pruebe una historia graba SIEMPRE su
// video a 1920x1080 (el nativo de Playwright se reduce a 800x450) y lo adjunta
// al reporte, de donde `pnpm cobertura:e2e` lo mapea a la historia ([EPICA:TASK]
// en el título). Los tests importan `test`/`expect` de acá, nunca de
// `@playwright/test`. El test sigue usando `page` normal.
//
// Los tests que abren sus propias sesiones (`browser.newContext()`) usan
// `abrirContextoGrabado` / `cerrarContextoGrabado` para que también queden en video.
import fs from 'node:fs'
import { test as base, expect, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test'

const baseURL = () => process.env.E2E_BASE_URL || `http://localhost:${Number(process.env.WEB_PORT) || 4300}`

export async function abrirContextoGrabado(
  browser: Browser,
  testInfo: TestInfo,
  sufijo = '',
): Promise<{ contexto: BrowserContext; page: Page }> {
  const contexto = await browser.newContext({
    baseURL: baseURL(),
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: sufijo ? testInfo.outputPath(sufijo) : testInfo.outputDir, size: { width: 1920, height: 1080 } },
    ignoreHTTPSErrors: true,
    locale: 'es-AR',
    reducedMotion: 'reduce',
  })
  return { contexto, page: await contexto.newPage() }
}

export async function cerrarContextoGrabado(contexto: BrowserContext, page: Page, testInfo: TestInfo): Promise<void> {
  const video = page.video()
  await contexto.close()
  if (video) {
    try {
      await testInfo.attach('video', { path: await video.path(), contentType: 'video/webm' })
    } catch {
      /* el video puede no existir si el contexto no llegó a crearse */
    }
  }
  try {
    fs.writeFileSync(
      testInfo.outputPath('meta.json'),
      JSON.stringify(
        { title: testInfo.title, file: testInfo.file, project: testInfo.project.name, status: testInfo.status },
        null,
        2,
      ),
    )
  } catch {
    /* best-effort: el reporte JSON ya trae el título/estado */
  }
}

export const test = base.extend({
  page: async ({ browser }, use, testInfo) => {
    const { contexto, page } = await abrirContextoGrabado(browser, testInfo)
    // `use` es el callback de fixtures de Playwright, no un hook de React.
    // oxlint-disable-next-line react-hooks/rules-of-hooks
    await use(page)
    await cerrarContextoGrabado(contexto, page, testInfo)
  },
})

export { expect }
