// Estilos comunes de las columnas del pie (MSF-841, MSF-847): título de 14 px y enlaces del color del pie, sin atenuar
// (el texto atenuado sobre el fondo oscuro no cumple el contraste AA), con las filas de 28 px del prototipo (interlineado 2).
export const estiloEnlacePie = { color: 'inherit', display: 'inline-block', textDecoration: 'none', py: 0, lineHeight: '28px', overflowWrap: 'anywhere', '&:hover, &:focus-visible': { textDecoration: 'underline' } } as const
export const estiloTituloPie = { fontWeight: 700, lineHeight: '28px', fontSize: 14 } as const // estilos-sueltos: ok
