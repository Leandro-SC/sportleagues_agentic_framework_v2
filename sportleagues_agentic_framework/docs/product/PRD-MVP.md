# PRD — MVP SportLeagues / BetAdmin

## Visión

Eliminar la operación manual de quinielas: Excel, verificación individual de pagos, recálculo manual de puntos y coordinación por chats.

## Personas

### Organizador

Crea y configura quinielas, reglas, partidos, participantes, branding y resultados.

### Participante

Se une mediante código/deep link, registra pronósticos, consulta ranking y comparte contenido.

## Capacidades MVP

### Administración

- crear/editar/pausar/archivar quinielas;
- configurar reglas de puntos y desempate;
- fijar bloqueo antes del inicio;
- crear torneos/partidos manualmente;
- cargar/corregir resultados oficiales;
- aprobar participantes;
- estado: pagado/pendiente/invitado;
- branding PRO: logo, colores y banner.

### Participante

- Google OAuth o magic link soportado por el proveedor de auth;
- unirse por código de 6 caracteres o deep link;
- pronosticar marcadores con UX táctil;
- ver estado abierto/bloqueado/en vivo/finalizado;
- auto-fill basado en Elo/Poisson;
- leaderboard general, por jornada y rachas;
- visibilidad de pronósticos ajenos solo cuando corresponda.

### Estadística

- Elo dinámico;
- distribución Poisson de marcadores;
- probabilidades internas 1X2;
- auto-fill explicable como sugerencia estadística.

### Growth

- flyer de ranking;
- flyer de próxima jornada;
- flyer de ganador;
- QR de acceso;
- marca de agua en FREE y eliminación en PRO.

## Entitlements

FREE:

- hasta 10 participantes;
- 1 quiniela activa;
- scoring estándar;
- branding SportLeagues;
- flyers con watermark;
- sin exportación.

PRO:

- participantes ilimitados;
- múltiples quinielas;
- scoring personalizable;
- white-label básico;
- flyers sin watermark;
- exportación futura/según fase de producto.
