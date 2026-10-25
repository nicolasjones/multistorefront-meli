---
owner: producto
sources:
  - specs
  - apps/web/src
  - design/pantallas
---

# Ventas · catálogos de cobro y envío (MSF-139)

Esta página explica **qué resuelve** la épica MSF-139 (spec
`ventas-catalogos-de-cobro-y-envio`) para quien opera el negocio. El detalle de datos, RPC, permisos y
pruebas está en [Ventas · catálogos de cobro y envío (técnico)](../tecnico/ventas-catalogos.md).

!!! note "Estado"
    Implementado en la rama de la épica `epic/MSF-139-ventas-y-despacho-ventas-catalogos-de-co`,
    **pendiente de merge a `main`**. Las cuatro historias (F-VTA-01, F-VTA-02, F-VTA-03 y F-VTA-04)
    quedaron finalizadas.

## Qué resuelve y para quién

Antes de cargar un comprobante, cada tienda necesita saber **cómo cobra y cómo despacha**, y la
organización necesita tener cargadas sus **cuentas de cobro** y sus **transportes**. Esta épica deja
esos cuatro catálogos listos para que MSF-159 los ofrezca al armar una factura o un presupuesto.

- **Administrador:** crea y edita los catálogos, habilita cuentas y transportes por empresa y
  activa o desactiva cada ítem.
- **Quien tiene la sección Ventas en lectura:** consulta los catálogos, pero no los modifica.
- **Quien no tiene acceso a Ventas:** no ve las pantallas; recibe «Acceso restringido».

## Formas de pago por empresa

Cada empresa tiene su propia lista de formas de pago. Se administran en **Ventas › Configuración de
ventas**, pestaña **Formas de pago** (`/ventas/configuracion`).

- La tabla muestra **Orden**, **Forma de pago**, **Pide cuenta de cobro**, **Genera deuda** y el
  interruptor **Activo**.
- **Nueva forma de pago** crea un ítem independiente por cada empresa marcada. Al editar, el cambio
  aplica solo a la empresa de la fila.
- Tipos: **Efectivo**, **Transferencia o depósito bancario**, **Contrarreembolso**, **Tarjeta** y
  **Otro**.
- Cada forma define si **exige cuenta de cobro**, si **genera deuda** y con qué **estado inicial del
  comprobante** nace (Pendiente, Aceptado, Cobrado o Deuda).
- Un nombre repetido en la misma empresa se rechaza; el mismo nombre en otra empresa es válido.
- **No se borra:** apagar **Activo** deja la forma fuera de uso sin perder sus datos; volver a
  encenderla la reactiva.

## Formas de envío por empresa

En la misma pantalla, pestaña **Formas de envío**.

- La tabla muestra **Orden**, **Forma de envío**, **Requiere transporte y guía**, **Costo por
  defecto** y **Activo**. Sin costo cargado se muestra **«—»**.
- Tipos: **Retiro en local**, **Correo**, **Expreso**, **Moto** y **Terminal**.
- Cada forma define si **exige transporte y guía**, un **costo por defecto en ARS** (opcional, nunca
  negativo) y el **estado de despacho inicial** (Sin armar, Armando o Listo para despachar).
- Mismas reglas de alta multiempresa, edición por empresa, nombre único y desactivación que las
  formas de pago.

## Cuentas de cobro

Las cuentas bancarias y billeteras son de la **organización** y se habilitan por empresa en
**«Disponible en»**. Se administran en **Ventas › Cuentas de cobro** (`/ventas/cuentas-cobro`).

- La tabla muestra **Cuenta**, **Titular**, **Banco**, **CBU**, **CUIT**, **Disponible en** (chips por
  tienda), **Estado** y la acción de editar. Tiene filtro **Tienda**, filtro de estado
  (**Todas / Activas / No usar**), recuento y paginación.
- **Nueva cuenta de cobro** pide nombre, titular, CUIT del titular, banco, alias, CBU/CVU, tipo de
  cuenta (Cuenta corriente / Caja de ahorro / Billetera virtual), moneda (ARS / USD), orden, notas
  internas y las empresas donde está disponible.
- **CBU/CVU y CUIT se validan en la base y en el formulario.** El CBU/CVU debe tener 22 dígitos con
  sus dígitos verificadores; el CUIT se acepta con o sin guiones y se guarda normalizado.
- **«No usar»** (`Activa` apagado) no ofrece la cuenta al cargar un comprobante pero **conserva su
  historial**; se puede reactivar. Nada se borra.
- Una cuenta **sin empresas marcadas** se permite y queda «sin disponibilidad»: no se ofrece en
  ningún comprobante.
- **Datos sensibles:** solo el Administrador edita. El CBU y el CUIT **no** se escriben en el
  registro de Actividad ni se muestran en mensajes de error o en la consola del navegador.

## Transportes y terminales de retiro

Los transportes son de la **organización** y se marcan las empresas donde se usan. Se administran en
**Ventas › Transportes** (`/ventas/transportes`).

- La tabla muestra **Empresa de transporte**, **Terminal de retiro**, **Localidad**, **Teléfono** y
  **Contacto**, con filtro **Tienda**, recuento («N de M empresas de transporte») y **Nueva empresa**.
- **Nueva empresa** pide nombre, tipo (**Expreso / Correo / Moto propia**), CUIT opcional, terminal de
  retiro, localidad, teléfono, correo, persona de contacto, dirección de la oficina, si **cobra
  contrarreembolso**, comisión (%), plazo de rendición (días), orden y **empresas donde se usa**.
- El CUIT es **opcional** (una moto propia puede no tenerlo), pero si se carga se valida. El correo,
  la comisión (0–100) y el plazo (0–3650 días) también se validan.
- El nombre es único por organización, sin distinguir mayúsculas ni espacios, incluso entre
  desactivados. **No se borra:** se desactiva con **Activa**.
- **Comisión y plazo son datos del catálogo.** Su uso al rendir un contrarreembolso es del despacho,
  no de esta épica.

## Permisos

| Quién | Qué puede hacer |
|---|---|
| Administrador de la organización | Leer y escribir los cuatro catálogos; es el único que crea, edita, activa o desactiva. |
| Rol con la sección **Ventas** en `lectura` | Leer los catálogos de las empresas a las que accede; no ve «Nueva», «Editar» ni los interruptores. |
| Rol con **Ventas** en `edición` pero que no es Administrador | Lee, pero **no escribe**: la pantalla oculta las acciones y la base rechaza igual la escritura. |
| Sin la sección **Ventas** | «Acceso restringido»; la ruta no muestra datos. |

La autorización real es la base (RLS y RPC). Ocultar un botón no es el control de seguridad.

## Empresa activa

La épica respeta la empresa activa de la barra superior (Principio VIII), con matices por pantalla:

- **Configuración de ventas:** su selector **Empresa** arranca en la empresa activa y permite cambiar
  de tienda dentro de la pantalla; cada pestaña recarga la lista de la empresa elegida y descarta
  respuestas viejas. Un alta puede repartirse en varias empresas.
- **Cuentas de cobro:** el filtro **Tienda** sigue a la empresa activa y se puede ampliar a «Todas las
  tiendas». Al cambiar la empresa se recargan las consultas y se descarta la selección anterior.
- **Transportes:** el filtro **Tienda** arranca en «Todas las tiendas» y se puede acotar a una; no
  depende de la empresa activa para listar. La pantalla se recarga al cambiar de organización.

Ninguna pantalla muestra ni guarda datos de una empresa que el usuario no tenga asignada.

## Actividad

Las cuentas de cobro dejan eventos en **Actividad** (`cuenta_cobro.creada`, `cuenta_cobro.editada`,
`cuenta_cobro.desactivada` y `cuenta_cobro.reactivada`), con el nombre de la cuenta y el actor. El
detalle **nunca** incluye el CBU ni el CUIT. Las formas de pago, las formas de envío y los transportes
no registran eventos en esta épica.

## Límites y fuera de alcance

- **La elección en el comprobante es de MSF-159.** Esta épica deja los catálogos cargados y
  consultables; no crea facturas ni presupuestos.
- **La carga de los datos reales** (unas 70 cuentas y unos 30 transportes del panel anterior) es de la
  migración inicial (MSF-142). Acá queda la estructura lista.
- **Fuera de alcance:** pestañas RMA, Contrarreembolsos y Estados de Configuración de ventas; los
  tableros de contrarreembolsos y motos; la columna «Envíos del mes»; **Exportar**; el **transporte
  preferido del cliente** (campo de Clientes y proveedores, MSF-180) y la conciliación de pagos.
- El prototipo muestra esas secciones porque pertenecen a otras historias; implementar solo lo que
  piden F-VTA-01 a F-VTA-04 está declarado en la matriz pantalla↔criterios de la spec.
- **Banco es texto libre:** el prototipo muestra un selector, pero la spec no define un catálogo de
  bancos.

## Para seguir

- **[Ventas · catálogos de cobro y envío (técnico)](../tecnico/ventas-catalogos.md)** — tablas,
  migraciones, RPC, RLS, validaciones y reversión.
- **[Datos y DER](../tecnico/datos.md#ventas-catalogos-de-cobro-y-envio-msf-139)** — modelo completo.
- **[Ventas · comprobantes](ventas-comprobantes.md)** — quién elige estos catálogos al vender.
- **[Empresa activa](../empresa-activa.md)** y **[Permisos por rol](../permisos-por-rol.md)** —
  contexto de empresa y matriz de acceso.
- **[Actividad](../actividad.md)** — historial de las cuentas de cobro.
