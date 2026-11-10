# Clientes y proveedores · Cuentas y compras a proveedores (MSF-450)

Ideas condicionadas a validar demanda: cuenta corriente de clientes y compras a proveedores. La épica declara que
**los requisitos se redactan cuando cada historia pase a un hito**; todas son P3, están en Backlog y quedan fuera
de diciembre. Spec: `specs/20261029-100000-cuentas-y-compras-a-proveedores/` (FR-001…FR-005, SC-001…SC-003).

## Las cuatro ideas

| ID | Nombre | Prioridad | Talla | Estado | Dependencia citada por la épica |
|---|---|---|---|---|---|
| F-CLI-19 | Cuenta corriente y saldo del cliente | P3 | L | Backlog (con una definición provisoria, ver abajo) | Cómo Ventas maneja cobros y el estado Deuda. |
| F-CLI-20 | Historial y favoritos en la cuenta web | P3 | L | Backlog | Cuenta web del cliente (`cuenta-web-del-cliente`); equivale a F-CON-07 y F-TDA-27, acotados a esto. |
| F-CLI-21 | Listas de precios por cliente | P3 | L | Backlog | Relacionada con F-PRE-14 (Precios), F-CLI-03 y F-CLI-07. |
| F-PRV-09 | Órdenes de compra a proveedores | P3 | L | Backlog | Ingreso de mercadería por proveedor y listado de reposición de Stock. |

Ninguna tiene requisitos (RF), escenarios (CA), pantallas ni horas. F-CLI-20, F-CLI-21 y F-PRV-09 **no tienen código**.

## F-CLI-19: definición provisoria ya construida

El SDLC construyó F-CLI-19 (MSF-451) **sin requisitos del cliente**: la spec y las reglas las redactó el desarrollo.
Está descrita en [Clientes](./clientes.md), sección «Cuenta corriente y saldo del cliente».
Quedó así, a confirmar con el cliente cuando la idea pase a un hito:

- El saldo de un comprobante es `total con IVA − cobros` (nunca negativo), tomado de `private.saldo_comprobante`.
- Cuentan las facturas que no están en `borrador`, `anulada` ni `cobrado`; los presupuestos no son deuda.
- Las notas de crédito **no restan**, y no hay saldo a favor (un cobro de más se muestra como $ 0).
- La persona ve la deuda solo de las tiendas a las que accede.

## Preguntas abiertas

1. **Tipo de cliente vs. cantidad (F-CLI-21 / F-PRE-14):** ¿el tipo de cliente fija la escala de precios o la escala
   depende de la cantidad? Chocan F-PRE-14 (listas mayoristas, P3) y que el tipo de cliente defina la escala en P0.
2. **F-CLI-20 = F-CON-07 = F-TDA-27:** Tiendas online deja las cuentas en P3; manda el roadmap hasta que se defina.
3. **Cuenta corriente (F-CLI-19):** qué estados cuentan como deuda, si las notas de crédito restan, si el saldo a
   favor se muestra, y si el saldo se ve por tienda o por organización.
4. **Sin pantallas ni horas:** el documento exige pantalla antes de cargar a Jira; se cargaron igual por pedido.

## Cómo sigue una idea

Cuando el cliente valide la demanda y la asigne a un hito: se redactan sus requisitos y escenarios, se dibuja su
pantalla y se escribe su spec propia (con su alcance de entrega y su matriz de pantalla).
