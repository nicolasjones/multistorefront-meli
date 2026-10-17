// Variantes tipográficas de la escala del prototipo (FR-003).
// Permiten usar <Typography variant="t1" | "t2" | "t3" | "b" | "bl" | "s" | "xs" | "kpi">.
import type { CSSProperties } from 'react'

declare module '@mui/material/styles' {
  interface TypographyVariants {
    t1: CSSProperties
    t2: CSSProperties
    t3: CSSProperties
    b: CSSProperties
    bl: CSSProperties
    s: CSSProperties
    xs: CSSProperties
    kpi: CSSProperties
  }

  interface TypographyVariantsOptions {
    t1?: CSSProperties
    t2?: CSSProperties
    t3?: CSSProperties
    b?: CSSProperties
    bl?: CSSProperties
    s?: CSSProperties
    xs?: CSSProperties
    kpi?: CSSProperties
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    t1: true
    t2: true
    t3: true
    b: true
    bl: true
    s: true
    xs: true
    kpi: true
  }
}
