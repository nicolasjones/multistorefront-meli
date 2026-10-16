# Marcas de F-CLI-02 (avance determinístico, FEAT-117)

Las tareas de **esta** historia quedaron hechas. Vive en un archivo **por-historia** para no chocar el `tasks.md` compartido entre historias.

- [x] T005
- [x] T008
- [x] T012
- [x] T016

## Trazabilidad de lo que queda fuera de esta historia (devolución del Revisor, PR #81)

- T008: las aserciones pgTAP de `exportar_clientes` son de **F-CLI-04 (MSF-318)**, que ya las exige en T006 («Pruebas pgTAP obligatorias, dueño F-CLI-04»). Esta historia cubre las 28 aserciones de búsqueda.
- T016: el botón «Exportar», los lotes y el `.xlsx` son de **F-CLI-04 (MSF-318)**, exigidos en T014 («Vitest obligatorios, dueño F-CLI-04»). Esta historia cubre búsqueda, filtros, paginación, estados y escape.
- T007 (concurrencia con dos conexiones) pertenece a F-CLI-01 (MSF-262), no a esta historia; su seguimiento lo traza esa historia.
- Volumen de `buscar_clientes` (`count(*) over ()`): lo mide T019 (esta historia), con evidencia en el cierre de la épica.
- Test agregado: página fuera de rango (página 2 sin filas → vuelve a la 1) en `list.test.tsx`.
