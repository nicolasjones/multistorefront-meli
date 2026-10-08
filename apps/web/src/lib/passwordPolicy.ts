export const passwordPolicyDescription =
  'La contrasena debe tener al menos 12 caracteres e incluir mayuscula, minuscula, numero y simbolo.'

export type PasswordPolicyResult =
  | { valid: true }
  | {
      valid: false
      message: string
    }

const hasUppercase = /[A-Z]/
const hasLowercase = /[a-z]/
const hasNumber = /\d/
const hasSymbol = /[^A-Za-z0-9]/

export function validatePassword(password: string, confirmation?: string): PasswordPolicyResult {
  const meetsPolicy =
    password.length >= 12 &&
    hasUppercase.test(password) &&
    hasLowercase.test(password) &&
    hasNumber.test(password) &&
    hasSymbol.test(password)

  if (!meetsPolicy) {
    return { valid: false, message: passwordPolicyDescription }
  }

  if (confirmation !== undefined && password !== confirmation) {
    return { valid: false, message: 'Las contrasenas no coinciden.' }
  }

  return { valid: true }
}
