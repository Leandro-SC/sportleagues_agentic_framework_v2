# Requisitos — Pronósticos y scoring

- Un pronóstico se asocia a participante + partido + quiniela.
- Debe existir unicidad lógica que evite duplicados.
- El lock se calcula con `match.starts_at - pool.lock_offset`.
- No se aceptan cambios después del lock mediante API/RPC/DB.
- Scoring estándar: exacto, resultado 1X2 y bonos configurables.
- Desempates configurables, inicialmente: exactos y fecha de registro.
- Recálculo idempotente ante corrección de resultado.
