import { afterEach, beforeEach, describe, expect, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { escribirInventario, verificarInventario } from "./verificar-inventario-prototipo.mjs";

const CARPETA = "design/pantallas";
let raiz;

const DC = `<!doctype html><html><head><title>Pantalla</title></head><body>
<table class="tbl"><thead><tr><th>Cliente</th><th>Tipo</th></tr></thead><tbody></tbody></table>
<span class="l">Nombre</span>
<button>Guardar</button>
<a class="tab on" href="#">Listado</a>
<div role="dialog"><h2>Alta</h2><span class="l">Correo</span></div>
</body></html>`;

beforeEach(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "inventario-"));
  const dir = path.join(raiz, CARPETA);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "Pantalla.dc.html"), DC);
});

afterEach(() => fs.rmSync(raiz, { recursive: true, force: true }));

describe("verificar-inventario-prototipo", () => {
  it("marca como faltante el prototipo sin .inventory.json", () => {
    const { total, faltan } = verificarInventario(raiz);
    assert.equal(total, 1);
    assert.deepEqual(faltan, [`${CARPETA}/Pantalla.inventory.json`]);
  });

  it("pasa cuando el inventario está al día", () => {
    escribirInventario(raiz);
    const { faltan, desfasados } = verificarInventario(raiz);
    expect(faltan).toEqual([]);
    expect(desfasados).toEqual([]);
  });

  it("marca desfasado el inventario si el prototipo cambia", () => {
    escribirInventario(raiz);
    const dc = path.join(raiz, CARPETA, "Pantalla.dc.html");
    fs.appendFileSync(dc, "<button>Cancelar</button>");
    const { desfasados } = verificarInventario(raiz);
    expect(desfasados).toEqual([`${CARPETA}/Pantalla.inventory.json`]);
  });
});
