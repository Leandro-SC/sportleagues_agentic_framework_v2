// Validación y mensajes de la autenticación con correo y contraseña (ADR-013). Todo esto es UX:
// la política real de contraseñas, la confirmación de correo y el rate limit viven en Supabase Auth.

export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 72 // límite de bcrypt que aplica Supabase Auth
export const MAX_NAME_LENGTH = 80 // profiles.display_name check (1..80)

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

/** Nombre apto para `profiles.display_name`: sin caracteres de control, espacios colapsados, 1..80. */
export function sanitizeFullName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const name = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
  return name.length >= 1 && name.length <= MAX_NAME_LENGTH ? name : null
}

export function validateEmail(value: string): string | null {
  const email = normalizeEmail(value)
  if (!email) return 'Ingresa tu correo electrónico.'
  if (email.length > 254 || !EMAIL.test(email)) return 'Ingresa un correo electrónico válido.'
  return null
}

export function validateNewPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`
  if (password.length > MAX_PASSWORD_LENGTH) return `La contraseña no puede superar ${MAX_PASSWORD_LENGTH} caracteres.`
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'La contraseña debe incluir letras y números.'
  return null
}

export type FieldErrors<K extends string> = Partial<Record<K, string>>

export type SignUpInput = { fullName: string; email: string; password: string; confirmPassword: string }

export function validateSignUp(input: SignUpInput): FieldErrors<keyof SignUpInput> {
  const errors: FieldErrors<keyof SignUpInput> = {}
  if (!sanitizeFullName(input.fullName)) errors.fullName = `Ingresa tu nombre completo (hasta ${MAX_NAME_LENGTH} caracteres).`
  const email = validateEmail(input.email)
  if (email) errors.email = email
  const password = validateNewPassword(input.password)
  if (password) errors.password = password
  else if (input.password !== input.confirmPassword) errors.confirmPassword = 'Las contraseñas no coinciden.'
  return errors
}

export function validateSignIn(input: { email: string; password: string }): FieldErrors<'email' | 'password'> {
  const errors: FieldErrors<'email' | 'password'> = {}
  const email = validateEmail(input.email)
  if (email) errors.email = email
  if (!input.password) errors.password = 'Ingresa tu contraseña.'
  return errors
}

export function validatePasswordUpdate(input: { password: string; confirmPassword: string }): FieldErrors<'password' | 'confirmPassword'> {
  const errors: FieldErrors<'password' | 'confirmPassword'> = {}
  const password = validateNewPassword(input.password)
  if (password) errors.password = password
  else if (input.password !== input.confirmPassword) errors.confirmPassword = 'Las contraseñas no coinciden.'
  return errors
}

type AuthErrorLike = { code?: string; status?: number; message?: string } | null | undefined

/**
 * Mensajes deliberadamente genéricos: no distinguen "el correo no existe" de "contraseña incorrecta"
 * y no reenvían texto crudo del servidor (evita enumeración de cuentas y filtrado de detalles).
 */
export function authErrorMessage(error: AuthErrorLike): string {
  switch (error?.code) {
    case 'invalid_credentials':
      return 'Correo o contraseña incorrectos.'
    case 'email_not_confirmed':
      return 'Confirma tu correo antes de iniciar sesión. Revisa tu bandeja de entrada.'
    case 'weak_password':
      return 'La contraseña no cumple los requisitos de seguridad.'
    case 'same_password':
      return 'La nueva contraseña debe ser distinta de la actual.'
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.'
    case 'signup_disabled':
      return 'El registro no está disponible por ahora.'
    default:
      return error?.status === 429
        ? 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.'
        : 'No se pudo completar la operación. Inténtalo de nuevo.'
  }
}

export const SIGN_UP_NOTICE =
  'Si el correo puede registrarse, te enviamos un mensaje para confirmar tu cuenta. Si ya tienes una cuenta, inicia sesión o recupera tu contraseña.'
export const PASSWORD_RESET_NOTICE =
  'Si existe una cuenta con ese correo, te enviamos un enlace para crear una nueva contraseña.'
