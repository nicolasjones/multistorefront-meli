# Bug Assessment: Ingreso de mercadería trunca a 500 productos y proveedores sin aviso

- **Slug**: msf-693
- **Created**: 2026-11-01
- **Source**: pasted text (Jira MSF-693; sin URL)
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

"[Bug] Ingreso de mercadería: solo se pueden elegir los primeros 500 productos y proveedores por nombre, sin aviso de truncado."

## Symptom

En «Nuevo ingreso» los selectores de Proveedor y Producto solo ofrecen los primeros 500 registros activos ordenados por nombre/razón social. Con catálogos mayores, el resto no se puede elegir ni buscar y la pantalla no avisa del corte. Esperado: poder elegir cualquier registro activo, o al menos un aviso visible de truncado.

## Reproduction

1. Tener más de 500 productos activos (o proveedores activos) en `dominio`.
2. Abrir Stock → Ingresos → «Nuevo ingreso».
3. Buscar en el Autocomplete un producto/proveedor posterior al 500.º por nombre: no aparece («No hay productos activos» / sin opciones), sin ningún aviso.

[NEEDS CLARIFICATION: tamaño real de catálogos en producción; no se reprodujo contra datos reales.]

## Suspected Code Paths

- `apps/web/src/components/stock/IngresoMercaderiaForm.tsx:21` — `MAXIMO_OPCIONES = 500`.
- `IngresoMercaderiaForm.tsx:56-73` — consultas `proveedores` y `productos` con `.order(...).limit(500)`; no se pide una fila extra ni se detecta el corte.
- `IngresoMercaderiaForm.tsx:197-215` (Proveedor) y `:251-268` (Producto) — Autocomplete filtra solo en cliente sobre lo cargado; `helperText` sin aviso.
- Precedente en el repo: `apps/web/src/pages/stock/NuevoMovimientoDialog.tsx:35,84,100,270` — `limit(MAX+1)`, `catalogoTruncado` y helper «Se muestran los primeros 500 productos por nombre.». El mismo patrón de aprendizaje ya se registró para `movimientos.tsx` (filtro, límite 200) y fue aceptado como deuda de baja prioridad.

## Root Cause Hypothesis

Los catálogos se precargan completos en el cliente con tope fijo de 500 y el Autocomplete filtra solo localmente; no hay búsqueda en servidor ni detección/aviso de truncado. Confianza: alta (código leído directamente).

## Proposed Remediation

**Preferred**: búsqueda en servidor en ambos Autocomplete (`inputValue` con debounce → `.ilike('razon_social'|'nombre'|'sku', %q%)` con `.limit(N)`), manteniendo siempre en las opciones el elemento ya seleccionado (para que `value` resuelva etiqueta y `proveedor_id` de la línea). Resolver el producto seleccionado por id aunque no esté en la página actual. Con `filterOptions` desactivado para no refiltrar en cliente.

**Alternatives**:
- Mínimo: replicar el patrón de `NuevoMovimientoDialog` (`limit(500+1)`, estado `proveedoresTruncados`/`productosTruncados`, helper text «Se muestran los primeros 500 …»). Cumple «sin aviso» pero no permite elegir el resto; es deuda explícita. Ojo: el helper del producto hoy prioriza error/«coincide», y el del proveedor solo muestra error; el aviso debe seguir visible tras elegir (problema ya observado en NuevoMovimientoDialog:214).
- Extraer un hook/componente compartido de selector con búsqueda en servidor y reutilizarlo en NuevoMovimientoDialog, movimientos y faltantes (más alcance).

**Files likely to change**:
- `apps/web/src/components/stock/IngresoMercaderiaForm.tsx`
- `apps/web/src/components/stock/IngresoMercaderiaForm.test.tsx`
- (opcional) hook compartido en `apps/web/src/hooks/`
- doc/spec correspondiente en `specs/` o `docs/` (regla de documentación obligatoria)

**Tests to add or update**:
- Con 501 filas devueltas, se muestra el aviso de truncado (alternativa mínima) / con búsqueda, escribir un texto dispara la consulta con `ilike` y permite elegir un registro fuera de los primeros 500.
- El producto/proveedor seleccionado se conserva al cambiar el texto de búsqueda.
- Error de consulta sigue mostrando la alerta de catálogos.

## Risks & Considerations

- Sin migración: no se toca base de datos; RLS existente aplica a las lecturas (`dominio.productos`/`proveedores`). Si se busca por `sku`, verificar índices para rendimiento.
- Debounce y carreras de respuestas (descartar respuestas obsoletas, como ya hace `vigente`).
- Escapar `%`/`_`/comas del texto en `ilike`/`or()` de PostgREST.
- El prototipo manda la UI: el aviso es texto auxiliar; confirmar con `design/pantallas` que no altera lo visible (o declarar en la matriz pantalla↔criterios).

## Open Questions

- [NEEDS CLARIFICATION: ¿se acepta solo el aviso (deuda, como en movimientos) o se exige búsqueda en servidor?]
- [NEEDS CLARIFICATION: ¿el mismo arreglo debe cubrir NuevoMovimientoDialog y el filtro de movimientos?]
