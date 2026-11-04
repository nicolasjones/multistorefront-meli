# Bug Assessment: Enlaces `wa.me` rotos cuando el número no trae código de país

- **Slug**: msf-696
- **Created**: 2026-11-01
- **Source**: pasted text (MSF-696, «It's a Plan»; sin URL)
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

«[Bug] Enlaces `wa.me` rotos cuando el número no trae código de país: el botón de la ficha y «Responder por WhatsApp» abren el chat de otro país».

## Symptom

`wa.me/<dígitos>` exige el número en formato internacional (sin `+`, con código de país). Si el número guardado es local (p. ej. `11 5555-0001`, `011 15 5555-0001`), el enlace se arma con esos dígitos tal cual y WhatsApp interpreta los primeros como código de país: abre el chat de otro país/número o uno inexistente. Esperado: el enlace apunta al número correcto (o no se ofrece).

## Reproduction

1. Cargar en una empresa (`dominio.empresas.whatsapp`) el número `11 5555-0001` (sin +54).
2. Abrir la ficha pública de un producto → «Consultar por WhatsApp» → «Abrir WhatsApp»: URL `https://wa.me/1155550001?text=...`.
3. Crear una consulta con contacto `11 5555-1234` y pulsar «Responder por WhatsApp»: `https://wa.me/1155551234?...`.
4. [NEEDS CLARIFICATION: confirmar en dispositivo real a qué país resuelve; es el comportamiento documentado de wa.me.]

## Suspected Code Paths

- `apps/web/src/lib/whatsapp.ts:11` — `normalizarNumero` solo quita no-dígitos y exige ≥ 8; no agrega ni valida código de país. Lo consumen `urlWhatsapp` (l.26) y `useContactoWhatsapp.ts:52` (el botón de la ficha, vía `BotonWhatsApp.tsx:36`).
- `apps/web/src/lib/responderConsulta.ts:28-30` — duplica la normalización (`replace(/\D/g,'')`, 7–15 dígitos) y arma `wa.me` sin código de país; el contacto lo escribe el visitante, por lo que es el caso más expuesto.
- Fuente del dato: `dominio.empresas.whatsapp` (text libre, `supabase/migrations/20261013120000_empresas.sql:10`), expuesto por `publico.contacto_por_dominio`; sin validación de formato (solo cliente, ver aprendizaje previo).
- Los tests actuales (`whatsapp.test.ts:54`, `responder.test.tsx:83`, `BotonWhatsApp.test.tsx:104`) solo cubren números ya con `549...`; ninguno cubre números locales.

## Root Cause Hypothesis

Dos implementaciones independientes de «número → dígitos» que asumen que el dato ya viene en formato E.164 sin `+`. No existe lógica de código de país por defecto ni validación del formato al cargar el número. Confianza: alta.

## Proposed Remediation

**Preferred**: unificar en `lib/whatsapp.ts` una única función `normalizarNumero` (y que `responderConsulta.ts` la reuse) que convierta a formato internacional: respetar `+`/`00` iniciales como ya internacional; si es local, quitar `0` troncal y el `15` de móviles y anteponer el código de país por defecto (AR: `549`) configurable (constante o campo de la empresa). Si no se puede determinar con certeza, devolver `null` (sin botón/enlace) en vez de un chat equivocado. Complementar con validación/ayuda de formato al cargar el número en el formulario de empresa.

**Alternatives**:
- Solo validar al guardar (exigir `+`): no arregla datos ya cargados ni contactos de visitantes.
- Columna `codigo_pais` por empresa: más correcto en multi-país, requiere migración aditiva y UI; más alcance.

**Files likely to change**:
- `apps/web/src/lib/whatsapp.ts`
- `apps/web/src/lib/responderConsulta.ts`
- `apps/web/src/pages/tienda-publica/whatsapp/useContactoWhatsapp.ts` (solo si cambia el contrato)
- `apps/web/src/lib/whatsapp.test.ts`, `apps/web/src/pages/consultas/responder.test.tsx`

**Tests to add or update**:
- Unit: local con/sin `0`, con `15`, con `+54`, con `00`, con espacios/guiones → dígitos internacionales esperados; ambiguo → `null`.
- `enlaceRespuesta` con teléfono local usa el mismo resultado que la ficha.

## Risks & Considerations

- Heurística de país por defecto: asumir AR puede ser incorrecto para otras empresas; decidir con producto (default vs. campo por empresa).
- `responderConsulta` acepta 7–15 dígitos y `whatsapp.ts` ≥ 8: unificar cambia qué contactos ofrecen enlace.
- Sanear siempre a dígitos (ya se hace) para evitar inyección en la URL.
- Docs: según CLAUDE.md, actualizar spec/docs relacionados en el mismo cambio.

## Open Questions

- [NEEDS CLARIFICATION: ¿país por defecto único (Argentina, 54) o por empresa?]
- [NEEDS CLARIFICATION: ¿qué hacer con números ambiguos: ocultar el botón o mostrar aviso?]
