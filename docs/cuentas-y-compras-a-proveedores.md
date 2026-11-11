# Clientes y proveedores · Cuentas y compras a proveedores (MSF-450)

Ideas condicionadas a validar demanda: cuenta corriente de clientes y compras a proveedores. La épica declara que
**los requisitos se redactan cuando cada historia pase a un hito**; todas son P3 y quedan fuera de diciembre. Ninguna
tiene requisitos de comportamiento del cliente; solo F-CLI-19 se construyó, como definición provisoria (abajo). Spec: `specs/20261029-100000-cuentas-y-compras-a-proveedores/` (FR-001…FR-005, SC-001…SC-003).

## Las cuatro ideas

| ID | Nombre | Prioridad | Talla | Estado | Dependencia citada por la épica |
|---|---|---|---|---|---|
| F-CLI-19 | Cuenta corriente y saldo del cliente | P3 | L | Backlog para el cliente; construida como definición provisoria y **Finalizada** en el tracker (ver abajo) | Cómo Ventas maneja cobros y el estado Deuda. |
| F-CLI-20 | Historial y favoritos en la cuenta web | P3 | L | Backlog | Cuenta web del cliente (`cuenta-web-del-cliente`); equivale a F-CON-07 y F-TDA-27, acotados a esto. |
| F-CLI-21 | Listas de precios por cliente | P3 | L | Backlog | Relacionada con F-PRE-14 (Precios), F-CLI-03 y F-CLI-07. |
| F-PRV-09 | Órdenes de compra a proveedores | P3 | L | Backlog | Ingreso de mercadería por proveedor y listado de reposición de Stock. |

Ninguna tiene requisitos del cliente (RF), escenarios (CA) ni horas. **F-CLI-19 sí tiene código y pantalla** (la
construyó el SDLC: migración, RPC, hook, la tarjeta «Saldo deudor» y la tabla «Cuenta corriente» de la ficha del
cliente). F-CLI-20, F-CLI-21 y F-PRV-09 **no tienen código ni pantalla**: siguen en Backlog sin requisitos de comportamiento.

## F-CLI-19: definición provisoria ya construida

El SDLC construyó F-CLI-19 (MSF-451) **sin requisitos del cliente**: la spec y las reglas las redactó el desarrollo.
Está descrita en [Clientes](./clientes.md), sección «Cuenta corriente y saldo del cliente».
Quedó así, a confirmar con el cliente cuando la idea pase a un hito:

- El saldo de un comprobante es `total con IVA − cobros` (nunca negativo), tomado de `private.saldo_comprobante`.
- Cuentan las facturas que no están en `borrador`, `anulada` ni `cobrado`; los presupuestos no son deuda.
- Las notas de crédito **no restan**, y no hay saldo a favor (un cobro de más se muestra como $ 0).
- La persona ve la deuda solo de las tiendas a las que accede, y no suma la de una tienda desactivada (ni para el administrador).
- Cuentan los siete estados vivos de la factura que no son borrador, anulada ni cobrado: `confirmada`, `pendiente`,
  `aceptado`, `en_proceso`, `deuda`, `armando` e `incompleto`. Que una factura «Pendiente» (o «Confirmada») ya sea deuda es
  una decisión provisoria: un pgTAP la fija estado por estado para que un cambio sea deliberado.
- Los importes se ven **con centavos** cuando los hay (`$ 1.210,50`, `$ 0,40`) y sin decimales cuando son enteros
  (`$ 220.000`); el ranking de clientes sigue en pesos enteros.
- Con `clientes` en lectura y sin acceso a Ventas, la ficha igual muestra total, cobrado y saldo de las facturas del
  cliente: es el mismo dato de «Compras» (que ya exige solo `clientes`). A confirmar con el cliente.
- Costo: el saldo de cada factura sale de `private.saldo_comprobante` (dos lecturas por factura abierta) y la RPC
  devuelve todas las abiertas sin paginar. Es proporcional a las facturas abiertas de **un** cliente, que son pocas; si
  un cliente real acumulara cientos, habría que paginar con carga infinita (excepción a esa regla, justificada acá).

## Preguntas abiertas

1. **Pregunta abierta 1 · Tipo de cliente vs. cantidad (F-CLI-21 / F-PRE-14):** ¿el tipo de cliente fija la escala de
   precios o la escala depende de la cantidad? Chocan F-PRE-14 (listas mayoristas, P3) y que el tipo de cliente defina
   la escala en P0. Sin resolver.
2. **F-CLI-20 = F-CON-07 = F-TDA-27:** Tiendas online deja las cuentas en P3; manda el roadmap hasta que se defina.
3. **Cuenta corriente (F-CLI-19), decidida de forma provisoria por el desarrollo y a confirmar:** qué estados cuentan
   como deuda (en particular «Pendiente» y «Confirmada»), si las notas de crédito restan (hoy no), si el saldo a favor
   se muestra (hoy no: un cobro de más es $ 0), si el saldo se ve por tienda accesible (hoy sí) o por organización, y
   si la persona con `clientes` en lectura debe ver el saldo aunque no acceda a Ventas (hoy sí).
4. **Sin pantallas ni horas:** el documento exige pantalla antes de cargar a Jira; se cargaron igual por pedido.

## Cómo sigue una idea

Cuando el cliente valide la demanda y la asigne a un hito: se redactan sus requisitos y escenarios, se dibuja su
pantalla y se escribe su spec propia (con su alcance de entrega y su matriz de pantalla).

## Revisión de seguridad de la épica

Lo único que la épica entrega con código es la RPC `public.cuenta_corriente_cliente` (F-CLI-19, MSF-451). Quedó
revisada por agentes independientes de QA y de Code Review + seguridad: dos rondas sobre la historia antes de mergear y una
revisión final (2026-11-11) sobre lo ya mergeado, sin hallazgos bloqueantes. Qué se comprobó:

- **Sin tablas nuevas:** no hay RLS que agregar; la función solo lee `dominio.comprobantes_venta`, `public.clientes` y
  `private.saldo_comprobante`.
- **`security definer` con `search_path = ''`:** todo está calificado (`public.`, `dominio.`, `private.`).
- **Aislamiento:** la organización sale de `private.organizacion_id()`, nunca de un argumento; el alcance por tienda
  sale de `private.empresas_accesibles()`. Un cliente ajeno o inexistente devuelve saldo 0 sin revelar si existe.
- **Permisos:** exige la sección `clientes` en `lectura`/`edicion` (`42501` si no). `revoke … from public, anon` y
  `grant execute … to authenticated`; `private.saldo_comprobante` no está expuesta.
- **Sin SQL dinámico:** el único parámetro es un `uuid`.
- **Secretos, compose y dependencias:** sin cambios.
- **Cobertura de pruebas, dicha con precisión:**
  - **pgTAP** (`cuenta_corriente_cliente.test.sql`, 34 aserciones): lo corre el job `database` del CI y se corrió en un
    Supabase local aparte. Cubre centavos, cada estado vivo, tienda desactivada, persona sin tiendas y superadmin.
  - **Vitest** (`ComprasCliente.test.tsx`, `useCuentaCorrienteCliente.test.tsx`, `formatoRanking.test.ts`): corre en el CI.
  - **E2E** (`apps/web/e2e/cuenta-corriente-cliente.e2e.ts`): **el CI no lo corre**. El job `application` ejecuta solo
    `acceso-publico.e2e.ts` y este archivo se omite sin `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. Se corre a mano con
    el stack local (`docs/e2e-app.md`). Nunca había corrido: el 2026-11-11 se corrió contra un Supabase local con el
    seed del repo, falló porque leía `public.clientes` con la clave de servicio (sin permiso) y, corregido (ahora usa la
    sesión de la persona de ejemplo), pasó: `$ 220.000` y 5 filas.
