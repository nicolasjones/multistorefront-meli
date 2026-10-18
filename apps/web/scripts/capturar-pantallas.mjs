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
  const contexto = await navegador.newContext({ viewport: VIEWPORT, storageState: ESTADO || undefined });
  const pagina = await contexto.newPage();

  for (const archivo of prototipos()) {
    const nombre = path.basename(archivo).replace(/\.dc\.html$/i, "");
    await pagina.goto(pathToFileURL(archivo).href, { waitUntil: "load" });
    await pagina.waitForTimeout(400);
    const destino = path.join(salidaDir, `prototipo-${nombre}.png`);
    await pagina.screenshot({ path: destino, fullPage: true });
    console.log(`prototipo -> ${path.relative(repoDir, destino)}`);
  }

  if (APP_URL) {
    for (const ruta of RUTAS) {
      await pagina.goto(`${APP_URL}/${ruta}`, { waitUntil: "load" });
      await pagina.waitForTimeout(2500);
      const destino = path.join(salidaDir, `app-${ruta.replace(/\//g, "-")}.png`);
      await pagina.screenshot({ path: destino });
      console.log(`app ${ruta} -> ${path.relative(repoDir, destino)}`);
    }
  }

  await navegador.close();
  console.log(`\nCapturas en ${path.relative(repoDir, salidaDir)}` + (APP_URL ? "" : "\n(app: pasá PANTALLAS_APP_URL para capturar también las rutas)"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
