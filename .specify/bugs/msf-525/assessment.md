# Bug Assessment: Falta «Enviar correo a proveedor» (ficha y listado de proveedores)

- **Slug**: msf-525 (provisto por el usuario)
- **Created**: 2026-10-19
- **Source**: pasted text — «[Seguimiento MSF-205] «Enviar correo a proveedor» (Jira MSF-525)». Sin URL.
- **Verdict**: valid (brecha de funcionalidad conocida y trazada, no una regresión de código)
- **Severity**: low

## Report (verbatim or summarized)

"[Seguimiento MSF-205] «Enviar correo a proveedor» (Jira MSF-525)". Es la Tarea `seguimiento` abierta por T029/FR-020 de la spec `20261018-190000-proveedores-y-productos` (épica MSF-205), que decidió dejar fuera de alcance lo que el prototipo muestra y el documento no pide.

## Symptom

El prototipo (`design/pantallas/ProveedorFicha.dc.html`, `Proveedores.dc.html`) muestra un botón «Enviar correo» y un diálogo «Enviar correo a proveedor» (campos Para, Asunto, Mensaje; botón «Enviar correo»; snackbar «Correo enviado al proveedor»). La app no tiene ni botón ni diálogo. Esperado: poder enviar un correo al proveedor desde la ficha.

## Reproduction

1. Abrir `/proveedores/:id` con rol de edición.
2. Observar la cabecera: solo «Proveedores», «Editar», «Desactivar/Reactivar». No hay «Enviar correo».
3. El correo del proveedor se muestra como texto plano, sin acción.

## Suspected Code Paths

- `apps/web/src/pages/proveedores/show.tsx:84` — barra de acciones (`accion`) sin el botón; `DATOS` (l.29) muestra `correo` solo como texto.
- `apps/web/src/pages/proveedores/list.tsx:33` — columna Correo sin acción; el prototipo también pone «Enviar correo» en el listado.
- `apps/web/src/components/proveedores/` — no existe un diálogo de correo (modelo a seguir: `ProveedorFormDialog.tsx`).
- `supabase/functions/_shared/correo.ts` — `enviarPorSmtp` ya existe (SMTP de Supabase, credenciales solo en la función), usado por `invitar-miembro` / `solicitar-acceso`. No hay función `enviar-correo-proveedor`.
- `specs/20261018-190000-proveedores-y-productos/spec.md:181,210,227` — Decisión 3: «Enviar correo» fuera de alcance; `docs/proveedores.md:57`; `tasks.md` T029.
- `design/pantallas/*.inventory.json` — el inventario ya lista el botón y el diálogo.

## Root Cause Hypothesis

No es un defecto introducido: la spec F-PRV excluyó deliberadamente la funcionalidad (ningún requisito de negocio la pedía) y la dejó como seguimiento. Falta spec propia, UI y un endpoint de envío. Confianza: alta.

## Proposed Remediation

**Preferred**: tratarlo como funcionalidad nueva vía Spec Kit (no hotfix): spec con alcance de entrega `refine` + `supabase`, y matriz pantalla↔criterios que cubra el botón en ficha y listado, el diálogo (Para prellenado con `proveedores.correo`, Asunto, Mensaje) y el snackbar. Implementación: Edge Function `enviar-correo-proveedor` que reutilice `enviarPorSmtp` de `_shared/correo.ts`, valide JWT + pertenencia a la organización + nivel de edición en `proveedores` (RLS/RPC), valide destinatario y longitudes y use `lineaSegura` en cabeceras; en la web, `EnviarCorreoProveedorDialog` + botón habilitado solo si el proveedor tiene correo.

**Alternatives**:
- `mailto:` desde el correo del proveedor: trivial, pero no replica el diálogo del prototipo ni deja trazabilidad.
- Worker/Kestra: sobredimensionado para un envío síncrono.

**Files likely to change**:
- `apps/web/src/pages/proveedores/show.tsx`, `apps/web/src/pages/proveedores/list.tsx`
- `apps/web/src/components/proveedores/EnviarCorreoProveedorDialog.tsx` (nuevo)
- `apps/web/src/lib/proveedores.ts`
- `supabase/functions/enviar-correo-proveedor/{index,handler}.ts` (nuevo)
- `docs/proveedores.md`, `specs/<nueva>/spec.md`, `tasks.md`

**Tests to add or update**:
- Vitest del diálogo (validación, estados, snackbar) y de ficha/listado (botón por nivel y por correo presente).
- `handler.test.ts` de la función (sin sesión, sin permiso, proveedor de otra organización, destinatario inválido, inyección de saltos de línea, fallo SMTP).

## Risks & Considerations

- Open relay: el destinatario debe fijarse o validarse contra `proveedores.correo`; no aceptar `Para` arbitrario.
- Autorización multi-organización (RLS) y límite de frecuencia contra abuso.
- Dependencia de `SMTP_*` configurado en el servidor; sin ellos el envío falla (manejar el error en UI).
- Reglas del repo: spec propia con alcance de entrega, PR contra `main` al crear la rama, `pnpm docs:check` y `pnpm matriz:check`. Si se implementa en el listado, respetar «una pantalla de gestión por producto».

## Open Questions

- [NEEDS CLARIFICATION: ¿se envía desde el listado, la ficha o ambos? El prototipo lo muestra en ambos.]
- [NEEDS CLARIFICATION: ¿`Para` es editable o fijo al correo del proveedor? Afecta el riesgo de relay.]
- [NEEDS CLARIFICATION: ¿debe quedar registro del envío (historial/auditoría)?]
- [NEEDS CLARIFICATION: ¿remitente `SMTP_FROM` genérico o de la organización?]
