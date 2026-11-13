import { createContext, useContext } from 'react'

// `true` dentro del layout de la tienda (MSF-841): ahí la barra superior y el pie ya muestran el eslogan, la
// bienvenida y el texto del pie; las secciones de la portada que antes los dibujaban se callan para no duplicarlos.
// Fuera del layout (vista previa del panel) siguen dibujándolos ellas.
export const ContextoEnLayout = createContext(false)

export const useEnLayout = () => useContext(ContextoEnLayout)
