# Bug Assessment: La tienda pública de la demo no carga categorías ni catálogo (timeout) — MSF-825

- **Slug**: tienda-demo-categorias-y-catalogo-timeout
- **Created**: 2026-11-12
- **Source**: relevamiento de la demo de Mundo JC del 2026-11-11 (épica MSF-825, bugs hijos MSF-826…MSF-832)
- **Verdict**: valid
- **Severity**: high

## Symptom

Home, menú y `/catalogo` sin categorías ni listado («No pudimos cargar las categorías / los productos»), con
~170 categorías (muchas vacías o repetidas) cuando cargaban, y nombres con el prefijo «&ua».

## Reproduction

Con `anon` y la demo de dev (2.204 productos publicados por tienda): `publico.categorias_por_dominio` →
HTTP 500 `canceling statement due to statement timeout` (tope de 3 s); `publico.catalogo_pagina_por_dominio` → 500.
Cuerpo de la prueba: navegador headless sobre `https://demo-mundojc.212-90-120-53.sslip.io/{,catalogo,contacto}`.

## Root Cause

1. `categorias_por_dominio`: el CTE `conteo` se reescribía en línea dentro de una subconsulta correlacionada y se
   evaluaba ~170 veces (una por categoría): 2,5–4 s.
2. `catalogo_pagina_por_dominio`: `private.precio_vigente_empresa` por producto antes de paginar: ≈ 20 ms × 2.204
   = 44 s (llamando directo a `precio_final_publico` + `promocion_vigente`: 75 ms).
3. El menú, la home y el pie listaban todas las categorías devueltas, y el conteo no sumaba subcategorías.
4. Los nombres venían de una exportación con prefijo «&ua…» (2.174 productos en dev) y la descripción repetía el
   nombre.
5. MSF-832 (categorías idénticas en las dos tiendas): no es un filtro roto; ambas tiendas publican los mismos
   2.204 productos.
