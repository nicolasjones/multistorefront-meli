// Estilos comunes de las columnas del pie (MSF-841): título de 14 px y enlaces del color del pie, sin atenuar
// (el texto atenuado sobre el fondo oscuro no cumple el contraste AA).
export const estiloEnlacePie = { color: 'inherit', display: 'inline-block', py: 0.5, overflowWrap: 'anywhere', '&:hover, &:focus-visible': { textDecoration: 'underline' } } as const
export const estiloTituloPie = { fontWeight: 700, mb: 1, fontSize: 14 } as const // estilos-sueltos: ok
