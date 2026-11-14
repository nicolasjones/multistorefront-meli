import { GlobalStyles } from '@mui/material'

// Indicador de foco de teclado único para toda la tienda (WCAG 2.4.7; MSF-849): contorno de 2 px del color primario a 2 px del
// control en enlaces, botones y selectores (`:focus-visible`: no aparece al tocar con el mouse). El prototipo no define foco y
// los botones de MUI solo muestran una onda tenue (contraste bajo). Sobre fondos oscuros (barra superior y pie) el contorno toma el
// color del texto para no perder contraste. Los controles que ya traen su propio contorno (campos, casilla, píldoras, héroe,
// diálogo de WhatsApp) lo conservan: sus reglas tienen más especificidad.
export function FocoVisible() {
  return (
    <GlobalStyles
      styles={(tema) => ({
        // El prefijo `html` sube la especificidad por encima de los `outline: 0` que MUI pone en `:focus` (p. ej. el selector de orden).
        'html a:focus-visible, html button:focus-visible, html [role="button"]:focus-visible, html [role="combobox"]:focus-visible': {
          outline: `2px solid ${tema.palette.primary.main}`,
          outlineOffset: '2px',
        },
        'html footer a:focus-visible, html [data-testid="barra-superior"] a:focus-visible': { outlineColor: 'currentColor' },
      })}
    />
  )
}
