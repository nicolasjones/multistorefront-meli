import { useId, useState } from 'react'
import { Button, Menu, MenuItem } from '@mui/material'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'

export type OpcionDesplegable = { valor: string; etiqueta: string }

type Props = {
  etiqueta: string
  /** '' = «Todos». */
  valor: string
  opciones: ReadonlyArray<OpcionDesplegable>
  onCambiar: (valor: string) => void
}

// Filtro «Etiqueta: valor» del prototipo (chip que abre un menú con «Todos» y las opciones). Es el patrón de los
// filtros Operador/Estado/Pago/Envío de Comprobantes; las tiendas NO se eligen acá (usan `FiltroEmpresa`).
export function FiltroDesplegable({ etiqueta, valor, opciones, onCambiar }: Props) {
  const [ancla, setAncla] = useState<HTMLElement | null>(null)
  const id = useId()
  const actual = opciones.find((o) => o.valor === valor)?.etiqueta ?? 'Todos'
  const elegir = (nuevo: string) => {
    setAncla(null)
    onCambiar(nuevo)
  }

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        color={valor === '' ? 'inherit' : 'primary'}
        aria-haspopup="menu"
        aria-expanded={ancla ? 'true' : undefined}
        aria-controls={ancla ? id : undefined}
        endIcon={<ArrowDropDownIcon />}
        onClick={(evento) => setAncla(evento.currentTarget)}
        sx={{ borderRadius: 999, textTransform: 'none' }}
      >
        {etiqueta}:&nbsp;<b>{actual}</b>
      </Button>
      <Menu id={id} anchorEl={ancla} open={ancla !== null} onClose={() => setAncla(null)} slotProps={{ list: { 'aria-label': `Filtrar por ${etiqueta.toLowerCase()}` } }}>
        <MenuItem selected={valor === ''} onClick={() => elegir('')}>Todos</MenuItem>
        {opciones.map((o) => (
          <MenuItem key={o.valor} selected={o.valor === valor} onClick={() => elegir(o.valor)}>{o.etiqueta}</MenuItem>
        ))}
      </Menu>
    </>
  )
}
