# Contrato: navegación del panel

## Mecanismo (portable)

`destinosPanel.ts` expone tres piezas que cualquier producto derivado
reutiliza tal cual:

```ts
export type AudienciaDestino = 'autenticada' | 'organizacion' | 'administrador' | 'superadmin'

export type DestinoPanel = {
  id: string
  etiqueta: string
  ruta: string
  icono: ComponentType<SvgIconProps>
  audiencia: AudienciaDestino
  rutasAnteriores?: string[]
}

export type SeccionPanel = { id: string; etiqueta: string | null; destinos: DestinoPanel[] }

export function destinoVisible(destino: DestinoPanel, contexto: ContextoPanel): boolean
```

`SiderPanel` renderiza `SECCIONES_PANEL` filtrado por `destinoVisible`, como
un acordeón con una sola sección abierta a la vez (la primera con etiqueta,
por defecto). La sección "Inicio" no lleva etiqueta ni encabezado clickeable
y siempre está visible.

## Regla de audiencia

| Audiencia | Visible para |
|---|---|
| `autenticada` | Cualquier sesión válida |
| `organizacion` | Cualquier persona con organización efectiva (para superadmin, solo si tiene una activa) |
| `administrador` | `contexto.puede_escribir` (administrador de su organización, o superadmin con organización activa) |
| `superadmin` | `contexto.es_superadmin` |

## Datos (no portable)

`SECCIONES_PANEL` — la lista real de destinos, etiquetas, íconos y rutas —
es propia de cada producto derivado. Este repo (el template) declara los
suyos en `apps/web/src/components/navegacion/destinosPanel.ts` a partir de
sus recursos existentes (`organizaciones`, `servidores`, `clientes`,
`conexiones`, `ejecuciones`, `analitica`, `features-administrar`, `miembros`,
`ia`); un producto derivado reemplaza ese archivo por sus propios recursos de
negocio sin tocar el mecanismo.

## Compatibilidad de rutas

`DestinoPanel.rutasAnteriores` es opcional: si un producto derivado
reorganiza sus URLs, declara ahí las rutas anteriores y arma sus propios
redirects `replace` a partir de esa misma lista (mismo mecanismo que usa
`REDIRECTS_ANTERIORES` en `App.tsx` del producto derivado que originó este
kit). Este PR no reorganiza ninguna URL del template — todas las rutas
existentes se mantienen igual.
