# Feature Specification: Clientes · habilitados en empresas (tiendas)

**Feature Branch**: `feat/clientes-empresas`

**Jira Epic**: sin épica nueva — fidelidad de MSF-180 (Clientes) sobre el prototipo
`design/pantallas/Clientes.dc.html` y `ClienteFicha.dc.html`.

**Created**: 2026-10-18

**Status**: Implementada (PR contra `dokploy`).

**Delivery scope**: `refine` (`apps/web`) y `supabase` (migración, RPC, RLS y pgTAP).
Sin `kestra`, `superset` ni `workers`.

**Input** (pedido del usuario): «en la lista de clientes deben verse las empresas/tiendas a las
que pertenece cada cliente; en el diálogo de alta/edición se elige a qué empresa(s) corresponde
(“Habilitado en”); y que todo el desarrollo que venga entienda la relación.»

## Por qué

Hasta esta entrega un cliente era **solo de la organización**: no existía forma de decir en qué
tienda compra. El prototipo ya muestra la columna **Tiendas** en el listado y el bloque
**Habilitado en** en el diálogo. Sin la relación, la columna es un placeholder `—` y el formulario
no puede representar lo que el prototipo pide. Esta spec agrega el dato, su contrato y su lectura;
no agrega cuentas web, invitaciones ni correo masivo.

## Historias y criterios de aceptación

### US1 · El listado muestra las tiendas de cada cliente

- **US1-CA1** La columna «Tiendas» muestra un chip por empresa (nombre) en la que el cliente está
  habilitado, y `—` cuando no tiene ninguna.
- **US1-CA2** Los nombres llegan con el listado (no se hace una consulta por fila desde el
  navegador): `buscar_clientes` devuelve `empresas` como `jsonb` de `{id, nombre}` ordenado por
  nombre; `[]` cuando no hay.
- **US1-CA3** En pantalla angosta (tarjeta) se ve la misma información que en la tabla.

### US2 · Alta y edición eligen las tiendas («Habilitado en»)

- **US2-CA1** El formulario compartido (alta y edición) muestra «Habilitado en» con las empresas de
  la organización como chips seleccionables (teclado y `aria-pressed`).
- **US2-CA2** Al crear, el cliente arranca habilitado en **todas** las tiendas (preseleccionadas);
  se puede dejar en ninguna. El texto de ayuda dice: «El cliente es único en la organización. Elegí
  en qué tiendas puede comprar.»
- **US2-CA3** Al editar se preseleccionan las tiendas actuales del cliente.
- **US2-CA4** Al guardar se reemplaza el conjunto completo de tiendas del cliente (no se acumulan
  duplicados) mediante una única RPC; la tabla `clientes` **no** recibe una columna `empresas`.
- **US2-CA5** Si el catálogo de tiendas falla, el formulario lo informa sin romper el alta/edición.

### US3 · La ficha muestra las tiendas

- **US3-CA1** La ficha del cliente muestra «Habilitado en» con chips de sus tiendas y `—` si no
  tiene. Es solo lectura: la edición de tiendas se hace desde «Editar cliente» (los switches en
  línea y la «Cuenta web» por tienda del prototipo pertenecen a MSF-450).

### US4 · Contrato y seguridad del dato

- **US4-CA1** Solo escribe la RPC `public.guardar_empresas_de_cliente`; exige
  `private.nivel_seccion('clientes') = 'edicion'` (error `42501`).
- **US4-CA2** Un cliente y una empresa solo se relacionan dentro de la misma organización; se
  valida en la RPC (`42501`/`P0002`) **y** en un disparador de la tabla.
- **US4-CA3** La lectura de la relación respeta RLS por organización y sección (`lectura` y
  `edicion` leen; `ninguno` no). `anon` no lee ni ejecuta la RPC.
- **US4-CA4** La clave primaria `(cliente_id, empresa_id)` impide repetir la misma tienda.
- **US4-CA5** Los clientes existentes quedan habilitados en todas las tiendas de su organización
  (backfill) para conservar el comportamiento previo.

## Requisitos funcionales

- **FR-001** Tabla `public.clientes_empresas` con PK `(cliente_id, empresa_id)`, `organizacion_id`,
  `created_at`, FKs en cascada e índices por `empresa_id` y `organizacion_id`.
- **FR-002** Disparador `clientes_empresas_validar` (`private.validar_cliente_empresa`): cliente y
  empresa de la organización de la fila.
- **FR-003** RLS: `select` por organización + `private.nivel_seccion('clientes') in
  ('lectura','edicion')`; sin `insert`/`delete` para `authenticated`.
- **FR-004** `public.buscar_clientes` (misma firma de entrada) suma `empresas jsonb`.
- **FR-005** `public.guardar_empresas_de_cliente(p_cliente_id uuid, p_empresa_ids uuid[])`:
  security definer, `search_path` vacío, valida, normaliza (sin nulos ni repetidos), reemplaza y
  devuelve el total. `authenticated` ejecuta; `anon`/`public` no.
- **FR-006** Backfill de clientes existentes a todas las empresas de su organización.
- **FR-007** Web: `useEmpresasDeCliente` (lectura), `useGuardarEmpresasDeCliente` (escritura),
  chips en `list.tsx`, bloque «Habilitado en» en `FormularioCliente` y en `show.tsx`.
- **FR-008** Documentar la relación en `docs/clientes.md` para que el próximo desarrollo no la
  redescubra (tabla, RPC, RLS, defaults, pruebas).

## Fuera de alcance (explícito)

- **Cuenta web** e invitación (MSF-450): la columna «Cuenta web» sigue en `—` y no se crean cuentas.
- **Correo masivo** (MSF-155) y **etiquetas** (MSF-445): no se ofrecen.
- **Importación** (MSF-142) y **ranking** (MSF-171): no se implementan.
- **Tipo Distribuidor**: el `check` de `clientes.tipo` sigue admitiendo `minorista`/`mayorista`.
- **Filtro por tienda** (`{{tFilt}}` del prototipo): queda pendiente y trazado; no se toca la firma
  de `buscar_clientes`/`exportar_clientes`.

## Modelo y contrato

```
public.clientes_empresas
  cliente_id       uuid  → public.clientes(id)        on delete cascade
  empresa_id       uuid  → dominio.empresas(id)       on delete cascade
  organizacion_id  uuid  → public.organizaciones(id)  on delete cascade
  created_at       timestamptz not null default now()
  primary key (cliente_id, empresa_id)
```

`buscar_clientes` agrega, por cliente:

```json
"empresas": [{ "id": "<uuid>", "nombre": "San Javucho" }]
```

`guardar_empresas_de_cliente(clienteId, [empresaId, …])` reemplaza el conjunto y devuelve cuántas
quedaron. Detalle operativo en `docs/clientes.md` § «Relación con empresas / tiendas».

## Matriz pantalla↔criterios

Ítems tomados de `design/pantallas/Clientes.inventory.json` y
`design/pantallas/ClienteFicha.inventory.json`. Lo no listado no cambia en esta entrega.

### Clientes · Listado (`Clientes.inventory.json`)

| Ítem del inventario | Dueño | Criterio / nota |
|---|---|---|
| Columna «Tiendas» de la tabla | Esta spec (F-CLI-05) | US1-CA1/CA2/CA3 · FR-004/FR-007: chips por empresa; `—` sin tiendas |
| Campo «Habilitado en» (diálogo) | Esta spec (F-CLI-05) | US2-CA1…CA5 · FR-005/FR-007 |
| Texto de ayuda «El cliente es único en la organización…» | Esta spec (F-CLI-05) | US2-CA2 |
| Columna «Cuenta web» | Fuera de alcance (MSF-450) | Placeholder `—`; sin backend |
| Diálogo «Enviar correo a seleccionados» | Fuera de alcance (MSF-155) | No se implementa |
| «Importar», «Etiquetas» | Fuera de alcance (MSF-142/445) | No se implementan |
| Tabs Listado/Ranking | Fuera de alcance (MSF-171) | Ranking no se implementa |
| Filtro por tienda (`{{tFilt}}`) | Pendiente (sin dueño) | Trazado en `docs/clientes.md`; no cambia firmas de RPC |
| Tipo «Distribuidor» | Fuera de alcance (sin dueño) | El check sigue `minorista`/`mayorista` |

### Clientes · Ficha (`ClienteFicha.inventory.json`)

| Ítem del inventario | Dueño | Criterio / nota |
|---|---|---|
| Tarjeta «Tiendas» (switches por tienda) | Parcial (F-CLI-05) | US3-CA1: se muestran las tiendas como chips de solo lectura en «Habilitado en». Los switches de edición en línea y el estado de «Cuenta web» por tienda quedan fuera (MSF-450); se edita desde «Editar cliente» |
| Tarjeta «Cuenta web» | Fuera de alcance (MSF-450) | No se implementa |
| «Comunicaciones» / correo masivo | Fuera de alcance (MSF-155) | No se implementa |
| «Configurar tipos de cliente» | Fuera de alcance (sin dueño) | No se implementa |

## Decisiones

- **Una tabla de relación, no una columna en `clientes`:** un cliente se habilita en N tiendas; la
  relación es N:M y se escribe solo por RPC (mismo patrón que `usuarios_empresas`).
- **Lectura incluida en `buscar_clientes`:** evita N+1 desde el navegador y mantiene el listado en
  una sola llamada.
- **Default = todas las tiendas:** coincide con el prototipo y conserva el comportamiento previo
  (antes no había restricción por tienda); el backfill aplica lo mismo a los clientes existentes.
- **Sin switches en la ficha:** el prototipo los muestra junto a «Cuenta web»; implementarlos exige
  decidir el estado web por tienda (MSF-450). La ficha muestra el dato, la edición se hace en el
  formulario.
- **Alta en dos pasos:** el cliente se crea primero (la base asigna el id) y después se guardan sus
  tiendas. Si el segundo paso falla, el cliente ya quedó creado: se registra el error y se navega a
  la ficha (reintentar el alta duplicaría el cliente). En edición el reintento es seguro.

## Supuestos

- Toda organización tiene 0..N empresas en `dominio.empresas`; no se asume ninguna fija.
- Las empresas inactivas se siguen mostrando si el cliente está habilitado en ellas (el dato es
  histórico); no se filtran por `activa`.
- El «Consumidor final» es un cliente más para la relación (el backfill lo alcanza); no tiene trato
  especial.
- El prototipo sigue siendo la fuente visual; esta spec no copia CSS.

## Pruebas

- **pgTAP** `supabase/tests/database/clientes_empresas.test.sql`: RPC (alta/reemplazo/vacío/nulo/
  duplicados), permisos por rol, aislamiento entre organizaciones, disparador, PK, `anon`,
  `buscar_clientes.empresas`.
- **Vitest** `apps/web/src/hooks/useEmpresasDeCliente.test.tsx`,
  `components/clientes/FormularioCliente.test.tsx`, `pages/clientes/{list,edit,show}.test.tsx`.
- Regresión: `pnpm test` (web + DB), `pnpm lint`, `pnpm build`, `pnpm estilos:check`,
  `pnpm prototipo:check`, `pnpm matriz:check`, `pnpm docs:check`.

## Reversión

Migración aditiva `20261018090000_clientes_empresas.sql`. La reversión (en una migración posterior,
no en este PR) es: `drop function public.guardar_empresas_de_cliente(uuid, uuid[])`;
`drop function private.validar_cliente_empresa()`; `drop trigger clientes_empresas_validar on
public.clientes_empresas`; `drop table public.clientes_empresas`; y restaurar `public.buscar_clientes`
a su definición de `20261017120001_clientes_expreso_preferido.sql` (sin `empresas`).
