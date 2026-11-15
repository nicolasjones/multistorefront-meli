---
owner: producto
sources:
  - specs
---

# Empresas: datos generales y estado de la tienda

> **Guía de referencia de ingeniería.** Existe una versión reorganizada: [versión técnica](tecnico/empresas.md). Esta página conserva el detalle de contratos, RPC, migraciones y decisiones que las otras versiones pueden no repetir; ante una diferencia, verificá contra el código y la spec.

Spec: `specs/20261012-140000-empresas/` (épica MSF-138, F-EMP-01/02/04/05).
Migraciones: `supabase/migrations/20261013120000_empresas.sql` y
`20261013130001_empresas_updated_at.sql`.
Pruebas: `supabase/tests/database/empresas.test.sql`, `apps/web/src/pages/empresas/{list,edit}.test.tsx`.
Guía técnica: [Empresas: construcción interna](tecnico/empresas.md).

Una **empresa** es quien vende (su precio, su tienda web y sus cuentas de Mercado Libre); el
producto, el stock y la cotización son de la organización. Una organización puede tener **1..N**
empresas: en el lanzamiento el primer cliente tiene dos (San Javucho y Mundo JC), pero **ningún
código, consulta, constraint ni prueba asume que son exactamente dos** (FR-003). MSF-121 agrega el rol
por empresa y la empresa activa: el selector y las secciones por empresa se acotan con
`private.empresas_accesibles()`, mientras la lectura de `dominio.empresas` sigue siendo por organización
(todos ven las empresas de su organización).

## Esquema y RLS (Constitución, Principio VII)

| Tabla | Esquema | Justificación | RLS |
|-------|---------|---------------|-----|
| `empresas` | **`dominio`** | Entidad de negocio del producto (quién vende), no mecanismo de plataforma. | Sí, por organización (ver abajo). |

Columnas: `id`, `organizacion_id` (FK a `public.organizaciones`, `on delete cascade`), `nombre`
(no vacío tras `btrim`), `whatsapp`, `correo`, `instagram`, `direccion`, `activa` (default `true`),
`created_at`, `updated_at`. Índice por `organizacion_id`.

Políticas (migración `20261013120000`):

- `empresas_select`: `for select to authenticated` con `organizacion_id = private.organizacion_id()`.
- `empresas_update`: `for update to authenticated` con `organizacion_id = private.organizacion_id()
  and private.puede_escribir()`, en `using` y `with check`.
- **Sin política INSERT/DELETE**: el alta es solo por la RPC `public.crear_empresa` (ver «Alta de empresas»); borrar no está en la spec.
- Grants: `usage` de `dominio` y `select` a `authenticated`; `update` **solo** sobre las columnas
  editables (`nombre`, `whatsapp`, `correo`, `instagram`, `direccion`, `activa`) — `id`,
  `organizacion_id` y `created_at` quedan inmutables para el rol.
- `updated_at` se mantiene sola con el trigger `empresas_updated_at` (función
  `private.tocar_updated_at()`, migración `20261013130001`), para que pausar/reactivar deje la marca.

## Pantallas

> Exportación total: `private.conjuntos_exportacion_total()` incluye `ordenes_compra` de toda la organización sin alcance por empresa (copia de respaldo); solo la ejecuta el rol de servicio `workers_orquestacion` desde el worker de exportación, nunca una persona de la app. Ver [ordenes-compra.md](ordenes-compra.md).

- `/empresas` (listado): una fila (o tarjeta en pantallas angostas) por empresa con nombre, tienda
  web, Mercado Libre, precio, moneda y productos visibles; lo que aún no alimenta ninguna épica
  muestra «Sin configurar». Botón «Nueva empresa» y fila final «Crear» solo con permiso de escritura.
- `/empresas/edit/:id` (General): nombre, dominio solo lectura, idioma «Español (Argentina)» y
  moneda «ARS» fijos, WhatsApp, correo, Instagram, dirección opcional, razón social y CUIT (11 dígitos, opcionales; se imprimen en la
  factura y el remito, ver `docs/ventas-impresion.md`). Validación (nombre
  obligatorio, formato de correo, CUIT de 11 dígitos), aviso de cambios sin guardar y estados de carga/error/éxito.
- `/empresas/edit/:id/precios` («Precios y moneda», F-PRE-07): regla de precio de la empresa y tabla «Así quedan los precios»;
  ver `docs/catalogo.md` (sección «Regla de precio por empresa»). La ficha muestra las pestañas «General» y «Precios y moneda».
- Activar/pausar es una acción inmediata e independiente del formulario; el listado muestra el estado.

## Gestión de la tienda (MSF-147)

Cada empresa tiene su tienda online resuelta por dominio. La gestión vive dentro de Empresas, en
`/empresas/:id/tienda/:pestaña` (`identidad`, `contenido`, `catalogo`), y requiere **edición en Empresas**;
sin ese permiso no se ve la entrada ni se accede por URL. El interruptor `activa` de la empresa es el que
publica o pausa la tienda (F-EMP-04): con la empresa pausada o sin dominio, el visitante ve «Volvemos
pronto».

- **Identidad visual:** colores, tipografías, logo y banners de la tienda.
- **Contenido:** textos del banner, bienvenida, pie, aviso de ficha y botón de contacto.
- **Catálogo visible:** qué categorías y productos se muestran y cuáles se destacan; precio y stock son de
  lectura.

La pantalla opera sobre la **empresa activa** de la barra superior (Principio VIII). Los cambios se
aplican al guardar, sin borrador. Alcance, límites y pendientes:
[Tienda online: dominio, identidad y vidriera](producto/tienda-dominio-e-identidad.md); detalle técnico:
[Tienda online: dominio, identidad y catálogo visible](tecnico/tienda-dominio-e-identidad.md).

## Carga inicial (San Javucho y Mundo JC) — dato, no esquema

La carga inicial es **dato de la organización del primer cliente**, no parte de la migración. Se
inserta con la organización real (por ejemplo, vía SQL o el seed del entorno) — nunca en el código:

```sql
-- Reemplazar <organizacion_id> por la organización real (uuid).
insert into dominio.empresas (organizacion_id, nombre, correo)
values
  ('<organizacion_id>', 'San Javucho', null),
  ('<organizacion_id>', 'Mundo JC', null);
```

Las pruebas insertan sus propias filas (1, 2 y 3 por organización) para no asumir cantidad.

## Actividad hacia F-AUD-01 (FR-010)

`apps/web/src/lib/eventosActividad.ts` define el contrato y el punto de emisión; F-AUD-01 todavía no
existe, así que sin destino registrado no hace nada. Eventos emitidos desde la pantalla:

| Evento | Cuándo | Cambios |
|---|---|---|
| `empresa.actualizada` | Guardar «General» | Campos modificados (`antes`/`despues`). |
| `empresa.pausada` | Pausar la tienda | `activa` `true` → `false`. |
| `empresa.reactivada` | Reactivar la tienda | `activa` `false` → `true`. |

La actividad es secundaria al guardado: un destino que falle **no** revierte la edición ya
persistida (queda `console.warn`). Cuando F-AUD-01 llegue, registra su destino con
`registrarDestinoActividad` y no hay que tocar a quien emite.

## Reversión

Migración aditiva (tabla nueva). Revertir en una migración **posterior** (no en el mismo PR):

```sql
drop trigger if exists empresas_updated_at on dominio.empresas;
drop function if exists private.tocar_updated_at();
drop table if exists dominio.empresas;
```

Deshacer la spec completa: `git revert -m 1 <merge>`.

## Alta de empresas (épica MSF-475, historia F-EMP-03 / MSF-277)

**Qué resuelve y para quién:** el administrador de la organización crea una empresa nueva sin armarla de cero, opcionalmente copiando la configuración de otra empresa de su misma organización. Fuera de alcance (roadmap): importar empresas existentes (decisión abierta de la épica), copiar dominio o cuentas, y las tablas de configuración por empresa (precio, tienda web, Mercado Libre), que aún no existen.

Spec: `specs/20261015-100000-alta-de-empresas/`. Migración: `supabase/migrations/20261015110000_alta_de_empresas.sql`.
Pruebas: `supabase/tests/database/alta_de_empresas.test.sql`, `apps/web/src/components/empresas/DialogoNuevaEmpresa.test.tsx`,
`apps/web/src/hooks/useCrearEmpresa.test.tsx`, `apps/web/src/pages/empresas/list.test.tsx`.

- **RPC** `public.crear_empresa(p_nombre, p_copiar_de default null)`: `security definer`, `search_path` vacío; la
  organización la resuelve el servidor y exige `private.puede_escribir()` (administrador activo). Recorta el nombre;
  errores: `42501` sin permiso, `22023` nombre vacío/largo u origen inválido o de otra organización, `23505` nombre
  repetido. `revoke … from public, anon` y `grant execute … to authenticated`. Sigue sin INSERT directo.
- **Nombre único** por organización sin distinguir mayúsculas ni espacios al borde: índice único
  `empresas_organizacion_nombre_uq (organizacion_id, lower(btrim(nombre)))`, que cubre también las altas simultáneas.
  Pre-chequeo antes de aplicar (debe dar 0 filas): ver el encabezado de la migración.
- **Qué se copia**: `private.copiar_configuracion_empresa(origen, destino)`, en la misma transacción del alta. Copia la
  configuración por empresa (reglas de precio, tienda web, reglas de Mercado Libre) **sin dominio ni cuentas**. Hoy
  **no hay tablas de configuración por empresa**, así que solo valida el origen y no copia nada. Se muestra y se
  pide igual: la empresa nace sin tienda publicada ni cuenta de Mercado Libre y comparte catálogo, stock, clientes y
  proveedores de la organización.
- **Punto de extensión (FR-010)**: cada épica que agregue una tabla por empresa la suma a esa función y a su prueba
  pgTAP, excluyendo dominio y cuentas, y declara su esquema (`dominio`) y RLS.
- **«Borrador»**: es un término de la interfaz («Empresa creada como borrador»); no hay un estado nuevo en base: la
  empresa nace `activa` por defecto y se la distingue por estar «Sin configurar».
- **Interfaz**: el diálogo «Nueva empresa» (Nombre, «Copiar configuración de», Cancelar / «Crear empresa») conserva lo
  escrito ante un error de servidor y deshabilita el envío mientras guarda. Sin empresas de origen, el selector queda
  deshabilitado con un aviso y se puede crear igual.
- **Reversión** (migración posterior, no en el mismo PR): `drop function public.crear_empresa(text, uuid);
  drop function private.copiar_configuracion_empresa(uuid, uuid); drop index dominio.empresas_organizacion_nombre_uq;`.
  Las empresas creadas no se pierden al revertir. Deshacer el PR: `git revert -m 1 <merge>`.

## Límites conocidos

- Sin E2E automatizado: el repo no tiene suite Playwright de la app (solo `infra/playwright`);
  listado, edición y pausa/reactivación están cubiertos por Vitest y pgTAP (tareas T011/T017/T021/T025
  con nota de desvío). La capacidad «E2E en CI» está en el roadmap del template (#7); la deuda de la suite de la app está trazada en **MSF-499**.
- El rol por empresa y la empresa activa son de MSF-121 ([Empresa activa](empresa-activa.md)); la RLS de
  `dominio.empresas` sigue siendo por organización, así que todos ven las empresas de su organización.
- Borrar una organización borra en cascada sus empresas; no hay papelera (roadmap #33).
  La cascada completa también con **ingresos de mercadería** (cabecera, líneas, movimientos de stock, proveedores y
  productos): sus claves `restrict` son diferibles desde MSF-844/MSF-847 (ver más abajo) y lo cubre
  `supabase/tests/database/baja_organizacion_ingresos.test.sql` (MSF-857). Siguen fuera de ese alcance las claves de
  ventas, motos, cotizaciones y el resto del stock: con esos datos `delete from public.organizaciones` puede fallar por
  clave foránea. No hay ningún flujo de producto que dé de baja una organización (ninguna pantalla la borra); el único
  camino de código es el rollback de la Edge `crear-organizacion` (organización recién creada, sin datos). Si algún día
  se necesita una baja real, la decisión de fondo es de producto (¿borrar o conservar el historial?) y no está tomada;
  la recomendación técnica es una función administrativa `baja_organizacion(uuid)` que borre en orden y con prueba
  pgTAP, no diferir más claves.

La tienda online de cada empresa (dominio, identidad visual, contenido y catálogo visible) se describe en [tiendas-online.md](./tiendas-online.md).

### Baja de organización: claves de reparaciones y error diferido (MSF-847, MSF-848)

La clave `dominio.reparaciones.empresa_id → empresas` pasa a `deferrable initially deferred`, como las demás del alcance de la baja (MSF-844), para que la cascada no falle con 23503. Siguen fuera del alcance las claves de ventas, motos, cotizaciones y stock. Se agrega `private.confirmar_claves_diferidas()`, que fuerza la comprobación de las claves diferidas y traduce la violación a un error de negocio (P0001, «No se puede borrar: el registro está en uso por otros datos.»); una RPC que borre estas tablas debe invocarla al final de su cuerpo. Revisión de MSF-848: hoy ninguna RPC de las migraciones borra `public.organizaciones`, `dominio.empresas`, proveedores, productos, ingresos de mercadería ni reparaciones (la única baja de organización es el borrado de compensación de la función `crear-organizacion`, que recibe el error por PostgREST), así que no hay función a la que agregar la llamada; la primera RPC de baja de organización o empresa debe llamarla. Una prueba pgTAP con una reparación real (`baja_organizacion_reparaciones_real.test.sql`) comprueba que la baja de la empresa con reparaciones da P0001, que sin referencias la baja se completa y que la cascada de la organización borra las reparaciones. Migración `20270324120300`. Seguridad retroactiva de #1008: la primera versión dejaba diferidas, al terminar, todas las restricciones diferibles de la transacción (`set constraints all deferred`), incluso las `deferrable initially immediate`; `20270347000200` restaura el modo de declaración (solo vuelven a diferirse las `initially deferred`, con nombre calificado) y `baja_organizacion_confirmar_claves_modo.test.sql` lo prueba. Límite explícito: restaura el modo **declarado**, no el que tenía la sesión; si quien la llama había hecho `set constraints X immediate` sobre una `initially deferred`, X vuelve a diferirse (y una `initially immediate` puesta en `deferred` queda inmediata).
### Aviso de formato del número de WhatsApp (MSF-743)

En la ficha de empresa y en el formulario público de contacto, el campo WhatsApp avisa, sin bloquear, cuando el número no se puede normalizar para `wa.me` (`avisoFormatoWhatsapp` en `apps/web/src/lib/whatsapp.ts`): no avisa con el campo vacío, con un correo ni con un número válido. El formulario público no impide el envío con un número raro; la validación del servidor (8 a 15 dígitos) no cambia. Además, en Documentos IA, si falla la actualización del nombre de una versión, esta se marca `fallida` antes de abortar y no se invoca la indexación (MSF-750), para que no quede en `procesando`.
