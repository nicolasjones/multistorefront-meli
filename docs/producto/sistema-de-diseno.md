---
owner: producto
sources:
  - specs
  - apps/web/src/tema
---

# Sistema de diseño (MSF-117)

**Épica:** MSF-117 · **Historias:** MSF-420 (DS-01, tokens y tema), MSF-426 (DS-02, componentes base),
MSF-431 (DS-03, estructura del panel) y MSF-435 (DS-04, tema por empresa para tiendas).
**Spec:** `specs/20261012-130000-sistema-de-diseno/`.
**Construcción interna:** [Sistema de diseño: tokens, tema y catálogo](../sistema-de-diseno.md).

El panel de MSF tiene **una estética propia y única** y cada tienda pública puede tener **la suya**.
Ninguna pantalla copia el prototipo: todas toman colores, tipografías, formas y estados de un mismo
sistema.

## Qué resuelve

- **Antes:** cada épica con pantallas reinterpretaba el prototipo y escribía sus propios colores, radios
  y alturas. Dos pantallas del mismo producto se veían distintas.
- **Ahora:** la estética está definida **en un solo lugar** (tokens) y se aplica como tema sobre el tema
  del template. Cualquier pantalla nueva la hereda sin definir nada por su cuenta.
- **El marco del panel es compartido:** encabezado, menú lateral, selector de empresa y menú de cuenta se
  ven igual en todas las secciones, sin cambiar rutas, permisos ni destinos.
- **Las tiendas pueden tener identidad propia:** cada empresa puede tener sus propias tipografías y colores
  en su tienda pública, sin que eso altere el panel.

## Para quién

| Persona | Qué ve |
|---|---|
| **Toda persona que usa el panel** (Administrador, Operador, Mostrador, Depósito, Administración, Consulta, Técnico) | La misma estética en todas las pantallas: tipografía, colores, altura de los botones y estados de carga, vacío y error |
| **Persona con más de una empresa** | El selector de empresa del encabezado, con la empresa activa marcada y el resto de sus empresas listadas; con una sola empresa ve solo la etiqueta, sin opción de cambio |
| **Dueño/a de una empresa con tienda online** | Su tienda puede verse con su propia identidad (tipografías y colores), distinta del panel |
| **Equipo de producto y desarrollo** | Un catálogo de componentes base con sus variantes y estados, y un guardián automático que impide escribir valores sueltos en las pantallas |

## Qué ve la persona

Valores que fija la épica (confirmados contra el prototipo, sin diferencias):

| Elemento | Cómo se ve |
|---|---|
| Títulos | **Sora** |
| Texto | **Instrument Sans** |
| Botón principal | Azul `#2B55E6`, al pasar el cursor `#1E3FB8` |
| Botones | 38 px de alto y esquinas de 9 px (chicos 32 px y grandes 46 px) |
| Texto | `#15181D`; texto secundario `#5F6670` |
| Bordes | `#D9D8D2` y `#E6E5E0` |
| Fondos | `#F5F5F2` y `#EEEDE8` |
| Peligro | `#C62828` |
| Menú lateral | Fondo oscuro `#15181D`; el ítem activo usa el azul de acción |

Si una fuente no está disponible, la pantalla cae a la tipografía del sistema sin romperse.

## Cómo se usa

Para el equipo que arma pantallas, el sistema es **el catálogo de componentes base**: botones, campos,
tarjetas, etiquetas de estado, tablas, miniaturas y los estados de página (carga, vacío, éxito y error).
Cada uno viene con sus variantes, sus estados y cuándo usarlo.

Reglas que rigen en el repo:

1. Se usa el componente base o el tema; **no** se escriben colores, radios ni alturas sueltos en una
   pantalla. Un control automático del CI falla si aparece un valor suelto.
2. **No se copia HTML ni CSS del prototipo**: se reproduce lo que muestra con estos componentes.
3. Todo listado o recurso que carga datos cubre **cargando, vacío y error**.
4. Si falta un componente, se agrega primero en `components/base/` con sus tokens y sus pruebas.
5. Una diferencia con el prototipo se anota en la descripción del PR, no se resuelve con valores sueltos.

El catálogo completo, con los estados de cada componente, está en
[Sistema de diseño: tokens, tema y catálogo](../sistema-de-diseno.md).

## La tienda con identidad propia (DS-04)

Cada empresa puede tener **tipografías y colores propios** en su tienda pública, distintos de los del
panel:

- **Mundo JC** usa **Barlow Condensed** para los títulos y **Barlow** para el texto (lo fija la épica).
- Los colores de Mundo JC y todos los valores de San Javucho son **de ejemplo**: sirven para validar el
  mecanismo, no son la identidad definitiva.
- Una empresa **sin identidad configurada** no se rompe: su tienda usa un tema por defecto, neutro y
  distinto del del panel.
- El panel no cambia por esto: la identidad de una tienda nunca altera el tema del panel.

## Límites y fuera de alcance

- **El tema por empresa todavía no está en ninguna pantalla.** El mecanismo existe y está probado, pero
  falta conectarlo con la configuración de «Empresa · Identidad visual» y leerla de la base. Eso es de la
  épica MSF-147 (Tienda · dominio e identidad).
- **Cómo se comparten los tokens** con el front público, si algún día vive en otro repositorio, no está
  definido.
- **Modo oscuro**: no está incluido; queda como tema aparte.
- **Búsqueda global (⌘K)** en el encabezado: no tiene comportamiento definido y no se incluye.
- **Identidad por organización** (el logo y el nombre propios de cada organización): no está incluida;
  queda en el roadmap del template.
- No se construye un sistema de diseño desde cero: se adapta el tema y el kit de panel del template.

## Empresa activa

**No aplica.** El sistema de diseño define la estética y no lee ni escribe datos de empresa: ningún
token, componente ni regla depende de la empresa activa, y cambiar de empresa no recarga ni altera
pantallas por su causa. El selector de empresa del encabezado (DS-03) es parte del marco, pero lo que
cambia la empresa activa es el contexto de la aplicación, no el tema.

## Estado

Las cuatro historias están implementadas y mergeadas: **MSF-420** (tokens y tema), **MSF-426**
(componentes base y catálogo), **MSF-431** (encabezado, menú lateral y selector de empresa) y **MSF-435**
(tema por empresa para tiendas). La épica no agrega migraciones ni cambia el modelo de datos.

Detalle técnico (archivos, pruebas y contrato del tema por empresa):
[Sistema de diseño: tokens, tema y catálogo](../sistema-de-diseno.md).
