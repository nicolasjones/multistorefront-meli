---
owner: tecnico
sources:
  - supabase/migrations
  - workers
---

# Catálogo: compatibilidad y planillas (MSF-202)

Spec prevista: `catalogo-compatibilidad-y-planillas` (épica MSF-202, historias F-CAT-09, F-CAT-10 y F-CAT-11).
Alcance de entrega previsto: `refine`, `supabase` y `workers`.

## Estado

**No construida.** Al documentar esta épica no existe `specs/*catalogo-compatibilidad-y-planillas*`, ni
migración, ni worker, ni pantalla de carga: `workers/` solo contiene `CONTRATO.md`, `Dockerfile`, `README.md` y
`egress-allowlists.json`. Nada de lo que sigue se entrega todavía; la página de producto no promete nada y las
referencias de otras páginas dicen «todavía no se puede».

## Qué ya existe (verificado)

| Pieza | Evidencia |
|---|---|
| `dominio.productos.compatible_con text[]` (máx. 50 valores, 100 caracteres c/u, normalizados por trigger) | `supabase/migrations/20261017120100_catalogo_productos_y_costos.sql` (líneas 24–61) |
| `compatible_con` editable desde el alta/edición | mismo archivo (grants de columnas) y [Alta y edición](catalogo-alta-y-edicion.md) |
| Vista `v_productos_listado`, con contrato «solo agregar columnas al final» para consumidores como la exportación | [Listado y categorías](catalogo-listado-y-categorias.md) |
| Outbox, ciclo de ejecuciones y contrato de workers para despachar una importación | `workers/CONTRATO.md`, [Adoptar ciclo de ejecuciones](../adoptar-ciclo-ejecuciones.md) |

## Alcance previsto por historia (de la descripción de la épica, sin construir)

- **F-CAT-09 Compatible con y etiquetas:** filtro por consola o modelo compatible sobre `compatible_con`.
- **F-CAT-10 Importar desde CSV:** carga, vista previa, reporte de errores y aplicación por worker + outbox; exclusiva del
  Administrador; usa `producto_costos` solo si quien importa tiene acceso a Rentabilidad. Una ejecución en curso por
  capacidad: dos importaciones de la misma organización se serializan.
- **F-CAT-11 Exportar listados:** exportación CSV desde «Productos · listado» leyendo `v_productos_listado`.

## Guía de prueba técnica

No hay nada que probar de esta épica todavía. Cuando se construya, el rótulo será `[MSF-202:T0yy]`.

- Lo único verificable hoy: `compatible_con` se guarda y normaliza (pgTAP de Catálogo · alta y edición).
- Automatización E2E (importar, previsualizar, exportar): pendiente de automatizar, sin tests ni rótulos aún.

## Pendientes y decisiones abiertas

| Tema | Dueño |
|---|---|
| Crear la spec con `## Matriz pantalla↔criterios` y «Empresa activa» (Principio VIII) para Carga masiva, listado y alta | TODO: producto/Catálogo |
| Alcance real frente al roadmap a diciembre (importación en Ola 2; F-CAT-09 en Etapa 2) | TODO: producto |
| ¿El rol Consulta puede exportar el listado? | TODO: producto |
| Solapamiento con el centro de importaciones y exportaciones (MSF-206): qué pantalla manda | TODO: producto/Plataforma |
| Capturas del manual (`pnpm docs:capturas`) cuando exista la pantalla | TODO: Catálogo |
