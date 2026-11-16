# Bug Assessment: Alta de cliente duplica el cliente si falla la consulta de cuentas web

- **Slug**: msf-694
- **Created**: 2026-11-01
- **Source**: pasted text (ticket MSF-694, It's a Plan; sin URL)
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

"[Bug] Alta de cliente: si falla la consulta de cuentas web después de crear el cliente, el formulario muestra error y al reintentar crea un cliente duplicado."

## Symptom

En «Nuevo cliente», el cliente se crea y luego falla la lectura de cuentas web; el formulario muestra «No pudimos guardar el cliente.» aunque el cliente ya existe. Al reintentar, `useCreate` inserta otro cliente (duplicado). Esperado: el alta ya hecha no se reporta como fallo ni se reintenta; se llega a la ficha con aviso de cuenta web parcial.

## Reproduction

1. Abrir `/clientes/create` con rol de edición y al menos una tienda tildada.
2. Dejar «Cuenta web» en un estado distinto de `sin_cuenta` (p. ej. activa).
3. Forzar que la RPC `cuentas_web_de_cliente` falle (error de red, 42501, etc.) tras el insert del cliente.
4. Resultado: aparece el error del servidor y el formulario queda editable; al pulsar «Crear cliente» de nuevo se crea otro cliente.

[NEEDS CLARIFICATION: si el documento es único por organización, el reintento podría chocar con «documento repetido» en vez de duplicar; depende de si el cliente tiene documento.]

## Suspected Code Paths

- `apps/web/src/lib/cuentasCliente.ts:186` — `aplicarCuentaWebEnTiendas` llama `await listarCuentasWebDeCliente(clienteId)` FUERA del `try/catch` por tienda (el try empieza en la línea 191). `listarCuentasWebDeCliente` (l. 101-105) lanza ante cualquier error de la RPC. La función promete "los fallos de una tienda no impiden el resto" pero esta lectura previa propaga la excepción.
- `apps/web/src/pages/clientes/create.tsx:67` — llama a `aplicarCuentaWebEnTiendas` sin try/catch, después de `mutateAsync` (l. 53) que ya creó el cliente. El `try/catch` de l. 58-63 solo cubre `guardar` de tiendas.
- `apps/web/src/components/clientes/FormularioCliente.tsx:107-113` — cualquier excepción de `onGuardar` va a `setErrorServidor` y re-habilita el botón; no distingue "cliente ya creado".
- `apps/web/src/pages/clientes/edit.tsx:80` — mismo llamado sin protección; en edición no duplica (no inserta), pero deja el mismo error engañoso tras haber guardado datos y tiendas.

## Root Cause Hypothesis

`aplicarCuentaWebEnTiendas` hace una lectura (`listarCuentasWebDeCliente`) sin capturar su error. En el alta, esa llamada ocurre después de que el cliente ya fue insertado; la excepción sube por `onGuardar` hasta `FormularioCliente`, que la muestra como fallo de guardado y deja reintentar, y como el formulario no conserva el id creado, el reintento ejecuta otro `create`. Confianza: alta.

## Proposed Remediation

**Preferred**: en `aplicarCuentaWebEnTiendas`, envolver la lectura de `existentes` en try/catch: si falla, registrar con `console.error` y devolver `{ creadas: 0, errores: tiendas.length }` (mismo contrato que ya usa `create.tsx` cuando fallan las tiendas). Así el alta sigue a la ficha con el mensaje «Cliente creado · no se pudo crear la cuenta web en N tiendas». Reforzar además en `create.tsx` un try/catch alrededor de la llamada (defensa en profundidad: nada posterior al insert puede lanzar hacia el formulario).

**Alternatives**:
- Guardar el id creado en el estado del formulario y hacer que el reintento use update en vez de create: más invasivo, cambia `FormularioCliente`.
- Solo try/catch en `create.tsx`: no corrige el contrato de la función para `edit.tsx`.

**Files likely to change**:
- `apps/web/src/lib/cuentasCliente.ts`
- `apps/web/src/pages/clientes/create.tsx`
- `apps/web/src/lib/cuentasCliente.test.ts`
- `apps/web/src/pages/clientes/formulario-cuenta-web.test.tsx` (o test de create)
- `docs/clientes.md` (regla de documentación obligatoria)

**Tests to add or update**:
- Unit: `aplicarCuentaWebEnTiendas` resuelve `{creadas:0, errores:n}` si `cuentas_web_de_cliente` falla.
- Página: con el RPC de lectura fallando tras el create, se navega a `/clientes/show/:id` con el mensaje de error parcial, `create` se llamó una sola vez y no se muestra el error del formulario.
- Edición: mismo caso navega con aviso en lugar de error.

## Risks & Considerations

- Cuando la lectura falla se cuentan todas las tiendas como error aunque quizá no hubiera nada que aplicar; mensaje aceptable, la ficha permite reintentar la cuenta web.
- Sin migraciones ni cambios de RLS/RPC; solo frontend.
- Edge case relacionado: otros fallos posteriores al insert (p. ej. `guardar` ya está cubierto).

## Open Questions

- [NEEDS CLARIFICATION: ¿en edición se prefiere el mismo mensaje parcial? Se asume que sí.]
