import { GlobalStyles } from '@mui/material'
import { colorFoco } from './colorFoco'

// Indicador de foco de teclado único para la tienda (WCAG 2.4.7, 1.4.11; MSF-849): contorno de 2 px a 2 px del control en enlaces, botones y
// selectores (`:focus-visible`: no aparece al tocar con el mouse). El color sale de `colorFoco` (el primario si llega a 3:1 y, si no, el
// texto, el negro o el blanco) y se publica en `--tienda-color-foco` para que lo usen también los controles con contorno propio (campos,
// casilla, píldoras). El prototipo no define foco y los botones de MUI solo muestran una onda tenue. Sobre fondos oscuros (los elementos con
// `data-foco="oscuro"`: barra superior y pie) el contorno toma el color del texto. Se monta en el layout de la tienda (tema de la identidad) y
// en la raíz de la app pública (estados de carga, error y «Volvemos pronto», con el tema base).
export function FocoVisible() {
  return (
    <GlobalStyles
      styles={(tema) => ({
        html: { '--tienda-color-foco': colorFoco(tema.palette.primary.main, tema.palette.text.primary, tema.palette.background.default) },
        // El prefijo `html` sube la especificidad por encima de los `outline: 0` que MUI pone en `:focus` (p. ej. el selector de orden). El campo
        // de texto del buscador (`input` con `role=combobox`) se excluye: ya cambia su borde y no debe tener un doble anillo.
        'html a:focus-visible, html button:focus-visible, html [role="button"]:focus-visible, html [role="combobox"]:not(input):focus-visible': {
          outline: '2px solid var(--tienda-color-foco)',
          outlineOffset: '2px',
        },
        'html [data-foco="oscuro"] a:focus-visible': { outlineColor: 'currentColor' },
      })}
    />
  )
}
