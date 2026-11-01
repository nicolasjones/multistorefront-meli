# Bug Assessment: `preguntar-documentos` arma siempre un contexto vacío

- **Slug**: msf-725
- **Created**: 2026-11-01
- **Source**: pasted text (Jira MSF-725, sin URL)
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

"[Bug] `preguntar-documentos` arma siempre un contexto vacío: el RAG responde sin documentos pero igual se paga el embedding y la generación."

## Symptom

La Edge Function encuentra fragmentos con `buscar_fragmentos`, pero el prompt que se envía al modelo lleva `Contexto:` vacío (solo separadores). El modelo responde "no encontré la información" aunque haya documentos relevantes, y se pagan embedding + generación. Esperado: el contexto contiene el texto de los fragmentos recuperados.

## Reproduction

1. Indexar un documento (`indexar-documento`) y tener política `rag-busqueda-documental` aprobada con perfil OpenAI.
2. Invocar `preguntar-documentos` con una pregunta cuya similitud supere 0.5.
3. `fragmentos` llega no vacío, pero el mensaje `user` enviado al proveedor contiene `Contexto:\n\n\n---\n\n...` sin texto.

[NEEDS CLARIFICATION: no se reprodujo contra un proveedor real; la causa se confirma por lectura de código.]

## Suspected Code Paths

- `supabase/functions/preguntar-documentos/index.ts:127` — `sanitizarDato({ texto: f.texto }, CONTRATO.datosPermitidos).texto`.
- `supabase/functions/preguntar-documentos/index.ts:31` — `datosPermitidos: ['pregunta', 'organizacion_id']`: no incluye `texto`.
- `supabase/functions/_shared/ia/sanitizar.ts:3-10` — `sanitizarDato` filtra las claves de objeto que no están en `permitidos`, así que devuelve `{}`.
- `supabase/functions/indexar-documento/index.ts:32,173` — mismo patrón, pero su contrato sí declara `'texto'`; por eso allí funciona (contraste).

## Root Cause Hypothesis

`sanitizarDato` es una allowlist por nombre de clave. En `preguntar-documentos` el contrato solo permite `pregunta` y `organizacion_id`, por lo que `{ texto }` se reduce a `{}`, `.texto` es `undefined` y `Array.join` lo convierte en cadena vacía: `contexto` queda como solo separadores `\n\n---\n\n`. El corte "sin fragmentos" (línea 115) solo cubre el caso de 0 resultados, por lo que no protege. Además `sanitizarDato` retorna `unknown`, así que `.texto` no tipa (el error lo oculta la falta de typecheck). Confianza: alta.

## Proposed Remediation

**Preferred**: agregar `'texto'` a `datosPermitidos` del `CONTRATO` en `preguntar-documentos` (igual que `indexar-documento`) y tipar el resultado de `sanitizarDato` con un cast explícito. Añadir una guarda: si tras sanear el contexto queda vacío (todos los textos vacíos), responder "no encontré información" sin llamar a `invocarProveedorIa`, para que un fallo similar no vuelva a gastar generación. Considerar envolver cada fragmento con `marcarContenidoNoConfiable` (texto de documentos es contenido no confiable) — evaluar aparte para no ampliar el alcance.

**Alternatives**:
- Quitar `sanitizarDato` de los fragmentos y usar `f.texto` directo: más simple, pero pierde el filtrado de claves prohibidas por contrato; menos coherente con el resto.

**Files likely to change**:
- `supabase/functions/preguntar-documentos/index.ts`
- test de la Edge Function (nuevo o existente bajo `supabase/functions` / `tests`)
- `specs/20261005-document-rag-mechanism/` o `docs/` (nota de documentación obligatoria)

**Tests to add or update**:
- Con fragmentos mockeados, el mensaje enviado a `invocarProveedorIa` contiene el texto de cada fragmento.
- Con textos vacíos tras sanear, no se invoca al proveedor de generación.

## Risks & Considerations

- Agregar `texto` a `datosPermitidos` solo afecta a esta función; no cambia el contrato compartido.
- Texto de documentos es contenido no confiable (inyección de prompt); mantener la instrucción de sistema actual.
- Sin migraciones ni cambios de RLS.

## Open Questions

- [NEEDS CLARIFICATION: ¿se quiere envolver los fragmentos con `marcarContenidoNoConfiable` en este mismo fix?]
