// Tests de scripts/prototipo-inventario.mjs (se corre con node --test).
import test from "node:test";
import assert from "node:assert/strict";
import { inventariar } from "./prototipo-inventario.mjs";

const MINI = `<!doctype html><html><head><title>Pantalla X</title></head><body>
<div class="tabs"><button class="tab on">Uno</button><button class="tab">Dos</button></div>
<table class="tbl"><thead><tr><th>Nombre</th><th>Tipo</th></tr></thead></table>
<label class="fld"><span class="l">Correo</span><span class="in"><input placeholder="a@b.c"></span></label>
<button class="btn p">Guardar</button>
<div role="dialog"><h2>Borrar</h2><p>texto</p></div>
</body></html>`;

test("inventariar: extrae tablas, campos, botones, tabs y diálogos", () => {
  const inv = inventariar(MINI, "x.dc.html");
  assert.equal(inv.pantalla, "Pantalla X");
  assert.deepEqual(inv.tablas, [{ columnas: ["Nombre", "Tipo"] }]);
  assert.deepEqual(inv.tabs, ["Uno", "Dos"]);
  assert.ok(inv.campos.includes("Correo"), JSON.stringify(inv.campos));
  assert.ok(inv.botones.includes("Guardar"), JSON.stringify(inv.botones));
  assert.equal(inv.dialogos.length, 1);
  assert.equal(inv.dialogos[0].titulo, "Borrar");
});

test("inventariar: ignora placeholders dinámicos", () => {
  const inv = inventariar(`<button class="btn">{{etiqueta}}</button>`, "y.dc.html");
  assert.deepEqual(inv.botones, []);
});
