# Prototipos de UI y fidelidad de implementación

Los diseños de referencia viven en `design/pantallas/*.dc.html` (formato DesignCompose) y **mandan
la UI**: lo implementado debe verse y comportarse como el prototipo. Para que la divergencia no pase
desapercibida, el flujo es mecánico (no gustos):

1. **Inventario**: `node scripts/prototipo-inventario.mjs design/pantallas/<Pantalla>.dc.html`
   extrae el checklist (tablas+columnas, campos, botones, tabs, filtros, diálogos). Sobre una carpeta
   escribe `<Pantalla>.inventory.json` junto al `.dc.html` (generado, no editar a mano).
2. **Spec**: cada ítem del inventario mapea a un criterio de aceptación, o se declara fuera de alcance
   explícito (sección `## Matriz pantalla↔criterios`). Elemento visible sin dueño = spec incompleta.
3. **QA**: verifica que lo inventariado exista en lo implementado. Faltante mapeado y ausente = CAMBIOS.
4. **Timing**: sin prototipo linkeado no se aprueba spec de épicas con UI; un diseño que llega después
   es alcance nuevo (historias nuevas), no divergencia a barrer bajo la alfombra.

Ver `scripts/prototipo-inventario.mjs --help` (uso) y `scripts/prototipo-inventario.test.mjs` (tests).
