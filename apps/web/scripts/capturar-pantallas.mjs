#!/usr/bin/env node
// Captura de pantallas para comparar el prototipo con lo implementado.
//
// NO es un gate automático (los datos y las fuentes cambian entre entornos:
// un diff de píxeles daría falsos negativos). Es la herramienta para la
// revisión lado a lado: renderiza cada `design/pantallas/*.dc.html` a PNG y,
// si le pasás una app levantada, cada ruta de la lista.
//
// Uso:
//   pnpm --filter @platform/web pantallas:capturar
//   PANTALLAS_APP_URL=https://dev.212-90-120-53.sslip.io \
//   PANTALLAS_ESTADO=./estado.json \
//   pnpm --filter @platform/web pantallas:capturar
//
// `PANTALLAS_ESTADO` es el `storageState` de Playwright (para rutas con
// sesión). Sin él sólo se capturan las rutas públicas.
// `PANTALLAS_VIDEO=1` graba un video del recorrido (`app-recorrido.webm`), con
// un rótulo por pantalla; `PANTALLAS_PAUSA` ajusta la espera entre pantallas.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const aqui = fileURLToPath(new URL(".", import.meta.url));
const webDir = path.resolve(aqui, "..");
const repoDir = path.resolve(webDir, "../..");
const prototipoDir = path.join(repoDir, "design/pantallas");
const salidaDir = path.join(webDir, "pantallas-capturas");

const APP_URL = process.env.PANTALLAS_APP_URL?.replace(/\/$/, "");
const ESTADO = process.env.PANTALLAS_ESTADO;
const RUTAS = (process.env.PANTALLAS_RUTAS || "clientes,productos,empresas,usuarios,stock")
  .split(",")
  .map((r) => r.trim())
  .filter(Boolean);

const VIEWPORT = { width: 1440, height: 900 };
const VIDEO = process.env.PANTALLAS_VIDEO === "1";
const PAUSA = Number(process.env.PANTALLAS_PAUSA) || (VIDEO ? 3500 : 2500);
const CAPTION = process.env.PANTALLAS_CAPTION !== "0";

// Rótulo fijo abajo a la izquierda para que el video se entienda sin narración.
async function rotulo(pagina, texto) {
  if (!CAPTION) return;
  await pagina.evaluate((t) => {
    let el = document.getElementById("__recorrido_rotulo");
    if (!el) {
      el = document.createElement("div");
      el.id = "__recorrido_rotulo";
      el.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483647;background:#111;color:#fff;font:600 18px/1.4 system-ui;padding:10px 16px;border-radius:10px;opacity:.92;pointer-events:none";
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, texto).catch(() => {});
}

// Prototipos de primer nivel (evita las carpetas con copias anidadas).
function prototipos() {
  if (!fs.existsSync(prototipoDir)) return [];
  return fs
    .readdirSync(prototipoDir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.dc\.html$/i.test(e.name))
    .map((e) => path.join(prototipoDir, e.name));
}

async function main() {
  fs.mkdirSync(salidaDir, { recursive: true });

  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({
    viewport: VIEWPORT,
    storageState: ESTADO || undefined,
    recordVideo: VIDEO ? { dir: salidaDir, size: VIEWPORT } : undefined,
  });
  const pagina = await contexto.newPage();

  for (const archivo of prototipos()) {
    const nombre = path.basename(archivo).replace(/\.dc\.html$/i, "");
    await pagina.goto(pathToFileURL(archivo).href, { waitUntil: "load" });
    await rotulo(pagina, `Prototipo: ${nombre}`);
    await pagina.waitForTimeout(VIDEO ? PAUSA : 400);
    const destino = path.join(salidaDir, `prototipo-${nombre}.png`);
    await pagina.screenshot({ path: destino, fullPage: true });
    console.log(`prototipo -> ${path.relative(repoDir, destino)}`);
  }

  if (APP_URL) {
    for (const ruta of RUTAS) {
      await pagina.goto(`${APP_URL}/${ruta}`, { waitUntil: "load" });
      await rotulo(pagina, `Pantalla: /${ruta}`);
      await pagina.waitForTimeout(PAUSA);
      const destino = path.join(salidaDir, `app-${ruta.replace(/\//g, "-")}.png`);
      await pagina.screenshot({ path: destino });
      console.log(`app ${ruta} -> ${path.relative(repoDir, destino)}`);
    }
  }

  const video = pagina.video();
  await contexto.close();
  if (video) {
    const origen = await video.path().catch(() => null);
    if (origen) {
      const destino = path.join(salidaDir, APP_URL ? "app-recorrido.webm" : "prototipo-recorrido.webm");
      fs.renameSync(origen, destino);
      console.log(`video -> ${path.relative(repoDir, destino)}`);
    }
  }
  await navegador.close();
  console.log(`\nCapturas en ${path.relative(repoDir, salidaDir)}` + (APP_URL ? "" : "\n(app: pasá PANTALLAS_APP_URL para capturar también las rutas)"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
