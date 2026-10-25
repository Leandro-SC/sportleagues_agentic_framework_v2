// Textos de Política de privacidad y Términos de uso. Describen lo que la app hace HOY (ver ADR-013, ADR-020, ADR-024–026):
// si cambia el tratamiento de datos, este archivo se actualiza en el mismo cambio. La versión fija la fecha visible.
export const LEGAL_VERSION = '2026-10-24'

export type LegalSection = { title: string; paragraphs: string[] }
export type LegalDoc = { title: string; intro: string; sections: LegalSection[] }

export const PRIVACY: LegalDoc = {
  title: 'Política de privacidad',
  intro: 'SportLeagues es una plataforma para organizar quinielas deportivas entre amigos y comunidades. Esta política explica qué datos usamos, para qué y cómo puedes eliminarlos.',
  sections: [
    { title: 'Datos que guardamos', paragraphs: [
      'Cuenta: tu correo electrónico y tu nombre visible. Si entras con Google, recibimos de Google tu correo y tu nombre; no recibimos tu contraseña de Google.',
      'Actividad en quinielas: las quinielas a las que te unes, tus pronósticos, tus puntos y posiciones, tus tickets y el estado de participación que registra el organizador (por ejemplo, pagado, pendiente o invitado). SportLeagues no cobra ni procesa pagos.',
      'Organizadores: nombre de la organización y de su plataforma, colores, logo y banner que suban.',
      'Avisos: las notificaciones de resultados que te enviamos dentro de la app.',
      'Datos técnicos mínimos: registros de errores sin datos personales (correos, tokens y códigos se eliminan antes de guardarlos) y reportes de seguridad del navegador.',
    ] },
    { title: 'Para qué los usamos', paragraphs: [
      'Para que puedas iniciar sesión, unirte a quinielas, pronosticar, ver la tabla y recibir avisos de resultados.',
      'Para que el organizador administre su quiniela. Tus pronósticos permanecen ocultos para los demás jugadores hasta el cierre de cada partido.',
      'Para mantener la seguridad y la integridad de las competencias (por ejemplo, registros de auditoría de cambios administrativos).',
      'No vendemos tus datos ni los usamos para publicidad. Las sugerencias de marcador son estadísticas (Elo y Poisson), no recomendaciones de apuesta.',
      'Guardamos la versión y la fecha en que aceptaste estos documentos para demostrar tu consentimiento. No almacenamos tu dirección IP ni datos de tarjeta para este fin.',
    ] },
    { title: 'Quién más los trata', paragraphs: [
      'Supabase aloja la base de datos y la autenticación. Vercel aloja la aplicación web. Google interviene solo si eliges entrar con Google.',
      'Otros jugadores de tu quiniela ven tu nombre visible, tus puntos y, después del cierre de cada partido, tu pronóstico. El organizador ve además tu estado de participación.',
    ] },
    { title: 'Imágenes que eliges en tu teléfono', paragraphs: [
      'Las fotos que agregas como fondo de una imagen para compartir se procesan en tu dispositivo y no se suben a nuestros servidores. Lo que compartas por WhatsApp u otras apps queda sujeto a las políticas de esas apps.',
    ] },
    { title: 'Cuánto tiempo los conservamos', paragraphs: [
      'Mientras tu cuenta esté activa. Los avisos ya leídos se eliminan después de 180 días.',
      'Si eliminas tu cuenta, borramos tu correo y tus datos de acceso, y tu nombre pasa a mostrarse como «Usuario eliminado». Conservamos sin datos de contacto los resultados, puntos y registros de auditoría de las quinielas en las que participaste, para no alterar competencias ya jugadas.',
    ] },
    { title: 'Tus derechos', paragraphs: [
      'Puedes ver y corregir tu nombre en la app, y eliminar tu cuenta en Perfil → Ajustes → Eliminar mi cuenta. Si administras una organización o una quiniela, primero debes transferir esa administración.',
      'También puedes pedir acceso a tus datos o hacer consultas escribiendo al contacto de privacidad indicado abajo.',
    ] },
    { title: 'Menores de edad', paragraphs: ['SportLeagues no está dirigido a menores de 13 años. Si crees que un menor nos dio datos, escríbenos para eliminarlos.'] },
    { title: 'Cambios', paragraphs: ['Si cambiamos esta política, actualizaremos la fecha de versión y te lo indicaremos en la app cuando el cambio sea relevante.'] },
  ],
}

export const TERMS: LegalDoc = {
  title: 'Términos de uso',
  intro: 'Al crear una cuenta o usar SportLeagues aceptas estos términos.',
  sections: [
    { title: 'Qué es SportLeagues', paragraphs: [
      'Una herramienta para organizar quinielas y pronósticos deportivos entre personas que se conocen. No es una casa de apuestas: no recibe dinero, no paga premios y no ofrece cuotas.',
      'Si un organizador acuerda aportes o premios con sus jugadores, ese acuerdo es exclusivamente entre ellos; SportLeagues solo permite registrar manualmente un estado de participación.',
      'Los precios y beneficios mostrados en Planes son ofertas informativas que pueden actualizarse. Solicitar un plan no genera cobro, renovación ni cambio automático de tu plan.',
    ] },
    { title: 'Tu cuenta', paragraphs: [
      'Eres responsable de mantener segura tu contraseña y de la actividad hecha con tu cuenta. Usa un nombre visible que no suplante a otra persona.',
    ] },
    { title: 'Reglas de las quinielas', paragraphs: [
      'El cierre de pronósticos lo decide el servidor según la hora de inicio de cada partido; después del cierre no se pueden crear ni editar pronósticos.',
      'Quien administra una quiniela no puede competir en ella. Las reglas de puntuación quedan fijas a partir del primer cierre.',
      'Los resultados oficiales los publica el organizador (o un proveedor deportivo cuando esté habilitado) y pueden corregirse; la tabla se recalcula sin duplicar puntos.',
    ] },
    { title: 'Planes y solicitudes', paragraphs: [
      'FREE permite una quiniela activa y hasta 10 participantes. Los planes PRO pueden cubrir una organización completa o una sola quiniela, según la oferta visible.',
      'Solo propietarios o administradores pueden solicitar un plan para su organización. La aprobación es manual; hasta recibir confirmación, se conservan los límites del plan actual.',
    ] },
    { title: 'Contenido de los organizadores', paragraphs: [
      'Los organizadores son responsables de los nombres, logos e imágenes que suben y deben tener derecho a usarlos. Podemos retirar contenido que infrinja derechos de terceros o estos términos.',
    ] },
    { title: 'Uso aceptable', paragraphs: [
      'No intentes acceder a datos de otras organizaciones, alterar resultados o eludir los cierres, ni uses la plataforma para actividades ilegales o de apuestas con dinero.',
    ] },
    { title: 'Disponibilidad y responsabilidad', paragraphs: [
      'Trabajamos para que el servicio esté disponible y sea correcto, pero se ofrece tal cual. Las sugerencias estadísticas no garantizan resultados.',
    ] },
    { title: 'Baja', paragraphs: ['Puedes eliminar tu cuenta cuando quieras desde Perfil. Podemos suspender cuentas que incumplan estos términos.'] },
  ],
}

export function legalContactEmail(raw: string | undefined = import.meta.env.VITE_LEGAL_CONTACT_EMAIL): string | null {
  const value = raw?.trim() ?? ''
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null
}
