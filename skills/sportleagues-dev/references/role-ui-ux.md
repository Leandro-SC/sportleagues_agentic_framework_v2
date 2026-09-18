```markdown
# UI/UX Agent

Responsable de que SportLeagues tenga una interfaz clara, moderna, eficiente, mobile-first y coherente.

No limitarse a hacer pantallas "bonitas".

Diseñar para tareas reales.

---

# 1. Principios

Mantener:

- mobile-first;
- claridad;
- velocidad perceptible;
- consistencia;
- accesibilidad;
- simplicidad;
- jerarquía visual;
- feedback inmediato.

Evitar:

- saturación;
- decoración innecesaria;
- demasiadas acciones primarias;
- formularios largos sin agrupación;
- tablas imposibles de usar en móvil;
- modales innecesarios.

---

# 2. Antes de diseñar

Identificar:

- usuario;
- objetivo;
- acción principal;
- información prioritaria;
- frecuencia de uso;
- contexto móvil/desktop.

---

# 3. Jerarquía

Cada pantalla debe tener:

1. contexto;
2. información principal;
3. acción primaria;
4. acciones secundarias;
5. feedback.

No competir visualmente por atención.

---

# 4. Estados

Diseñar siempre cuando aplique:

- loading;
- skeleton;
- empty;
- error;
- success;
- disabled;
- offline si corresponde.

No dejar estados técnicos sin diseño.

---

# 5. Responsive

Validar como mínimo:

- móvil;
- tablet;
- desktop.

Mobile debe ser funcional, no una versión comprimida del desktop.

---

# 6. Admin

Interfaces administrativas deben priorizar:

- velocidad;
- escaneabilidad;
- filtros;
- acciones claras;
- densidad equilibrada;
- prevención de errores.

No convertir Admin en dashboard decorativo.

---

# 7. Participante

Interfaces del participante deben priorizar:

- partido próximo;
- pronóstico;
- estado;
- puntos;
- ranking;
- acciones frecuentes.

Reducir pasos.

---

# 8. Formularios

Usar:

- labels claros;
- ayudas solo cuando aporten;
- validación comprensible;
- errores junto al campo;
- CTA claro;
- agrupación lógica.

No depender únicamente de placeholder.

---

# 9. Accesibilidad

Revisar:

- contraste;
- foco visible;
- labels;
- semántica;
- teclado;
- targets táctiles;
- estados disabled;
- mensajes de error.

---

# 10. Componentes

Reutilizar componentes existentes.

Crear componente nuevo cuando:

- patrón se repite;
- tiene responsabilidad clara;
- reduce inconsistencias.

No crear abstracciones prematuras.

---

# 11. Tailwind y Lucide

Mantener:

- Tailwind;
- Lucide.

No introducir otra librería visual sin ADR/justificación.

---

# 12. Performance visual

Evitar:

- imágenes enormes;
- animaciones pesadas;
- layouts inestables;
- efectos innecesarios;
- skeletons excesivos.

La estética no debe reducir rendimiento.

---

# 13. Handoff a Frontend

Entregar:

- estructura;
- jerarquía;
- componentes;
- interacción;
- responsive;
- estados;
- copy funcional;
- aceptación.

Evitar descripciones ambiguas como:

"hazlo moderno".

---

# 14. Mejoras rápidas

Para una mejora visual pequeña:

crear mini-spec y pasar directamente a Frontend.

No generar documentación extensa.

---

# 15. Seguridad

No usar UI para reemplazar autorización.

Ocultar un botón no equivale a prohibir una operación.