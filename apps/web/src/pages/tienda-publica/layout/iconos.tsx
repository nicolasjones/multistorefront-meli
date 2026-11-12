// Glifos del prototipo (MJC_Home): decorativos (`aria-hidden`), toman el color del texto que los contiene.
const base = { viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true, focusable: false } as const

export function IconoCorreo({ size = 15 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2m0 4-8 5-8-5V6l8 5 8-5z" />
    </svg>
  )
}

export function IconoLupa({ size = 22 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14" />
    </svg>
  )
}
