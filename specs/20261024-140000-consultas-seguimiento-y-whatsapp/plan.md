# Plan de implementación: Consultas y ventas · Consultas seguimiento y whatsapp

**Épica**: MSF-130 · **Spec**: [spec.md](./spec.md) · **Contrato**: [contracts/consultas-seguimiento.md](./contracts/consultas-seguimiento.md)
**Alcance de entrega**: `refine`, `supabase`.
**Prerrequisito externo**: MSF-122 mergeada (tabla `dominio.consultas`, `public.actualizar_consulta`, pantalla `apps/web/src/pages/consultas/` y `apps/web/src/lib/consultas.ts`). Las rutas de archivos de la UI se ajustan a lo que MSF-122 deje en `main`.

## Esquemas (Principio VII — re-verificar en tareas, implementación y PR)

| Objeto | Esquema | Motivo |
|---|---|---|
| `intereses_whatsapp` | `dominio` | Registro de negocio (interés de visitantes por un producto de una tienda; hoy solo el sembrado demo la alimenta; ver MSF-657). |
| `publico.registrar_interes_whatsapp` | `publico` | Superficie `anon` original, sin datos propios (precedente `crear_consulta_publica`); desde MSF-657 solo `service_role`. |
| `interes_whatsapp_por_producto` | `public` (vista) | Superficie de lectura, `security_invoker`. |

## Migraciones (aditivas, con reversión en el encabezado)

1. `20261024300000_intereses_whatsapp.sql` — tabla + RLS (sin escritura) + índices. Reversión: `drop table dominio.intereses_whatsapp;` (exportar antes si hay datos).
2. `20261024300100_registrar_interes_whatsapp.sql` — RPC (pública al crearse; desde MSF-657 solo `service_role`). Reversión: `drop function publico.registrar_interes_whatsapp(text, uuid);`.
3. `20261024300200_interes_whatsapp_por_producto.sql` — vista `security_invoker`. Reversión: `drop view public.interes_whatsapp_por_producto;`.

F-CON-04 **no** tiene migración (reusa `actualizar_consulta`).

## Frontend

- F-CON-02: `apps/web/src/lib/interesWhatsapp.ts` (lectura de la vista), `apps/web/src/pages/consultas/InteresWhatsappDialog.tsx` y el botón en el encabezado de la pantalla; usa la empresa activa (Principio VIII) y los estados compartidos.
- F-CON-04: `apps/web/src/lib/responderConsulta.ts` (`enlaceRespuesta`, `registrarRespuesta`), `apps/web/src/lib/textoInicialConsulta.ts` (`armarTextoInicial`) y el cambio del `onClick` de `Responder por` en el detalle de MSF-122.
- Las dos historias tocan archivos distintos (la edición compartida de la pantalla es una línea); van en paralelo.

## Pruebas

pgTAP (`interes_whatsapp`, `consultas_responder`), Vitest (diálogo, enlaces y texto), Playwright (responder con dos canales y rol de solo lectura). `rls_en_toda_tabla` y la lista de RPC permitidas a `anon` se actualizan en F-CON-02 (MSF-657 sacó después esta RPC de `anon`: hoy solo `service_role`).

## Riesgos

Spam de intereses (se esperaba el anti-spam de la tienda, MSF-212; MSF-657 cerró la RPC a `anon`); teléfonos sin código de país; texto inicial que reemplazará F-CON-06; MSF-122 sin mergear.
