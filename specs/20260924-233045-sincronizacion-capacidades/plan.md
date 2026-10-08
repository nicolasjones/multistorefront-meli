# Plan: Sincronización de capacidades derivadas

## Decisión

El template define un catálogo declarativo de capacidades. Cada producto guarda
un manifiesto de adopción. Un verificador Node compara ambos por versión y el
workflow de producto sólo informa/abre seguimiento; nunca intenta `git merge`.

## Alcance técnico

- Template: catálogo, validador con fixtures, guía de creación/adopción y
  archivos iniciales para productos nuevos.
- Producto: manifiesto propio, workflow que lee el catálogo usando un secreto
  de Actions y pruebas de comparación.
- No se agregan tablas, migraciones ni lógica de dominio.

## Seguridad

La URL remota no contiene token. El workflow usa únicamente
`TEMPLATE_READ_TOKEN`; su ausencia genera un error sanitizado y documentado.

## Validación

Pruebas Node para catálogo igual, pendiente, exclusión, formato inválido y
credencial ausente; más `pnpm lint`, `pnpm build`, `pnpm infra:config`,
`pnpm test` y `pnpm docs:check`.
