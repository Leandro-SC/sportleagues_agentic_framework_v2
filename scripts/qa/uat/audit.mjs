// Auditoría móvil medible por DOM. `auditPage` se serializa con toString() y se ejecuta EN la página (Runtime.evaluate), por lo que debe
// ser autocontenida. Devuelve datos crudos; la interpretación (PASS/FAIL) la hace run.mjs. NO es un informe Lighthouse.
export function auditPage() {
  const vw = window.innerWidth
  const round1 = (n) => Math.round(n * 10) / 10
  const isVisible = (e) => {
    const r = e.getBoundingClientRect(); const s = getComputedStyle(e)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'
  }
  const cssPath = (e) => {
    const parts = []; let el = e
    for (let i = 0; el && el.nodeType === 1 && i < 4; i += 1, el = el.parentElement) {
      let p = el.tagName.toLowerCase()
      if (el.id) { parts.unshift(`${p}#${el.id}`); break }
      const dt = el.getAttribute('data-test')
      if (dt) p += `[data-test=${dt}]`
      else {
        const al = el.getAttribute('aria-label')
        if (al) p += `[aria-label="${al.slice(0, 30)}"]`
        else { const c = [...el.classList].filter((x) => !/^[\d.]|\[|:|\//.test(x)).slice(0, 2).join('.'); if (c) p += `.${c}` }
      }
      parts.unshift(p)
    }
    return parts.join('>')
  }
  const out = { viewport: { width: vw, height: window.innerHeight }, url: location.pathname + location.search }

  // 1. Scroll horizontal
  const de = document.documentElement
  out.hscroll = { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, bodyScrollWidth: document.body.scrollWidth, ok: de.scrollWidth <= de.clientWidth && document.body.scrollWidth <= de.clientWidth }
  const inScroller = (e) => {
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a)
      if (s.overflowX === 'auto' || s.overflowX === 'scroll') return true
      if (s.overflowX === 'hidden' && a.getBoundingClientRect().right <= vw + 1) return true
    }
    return false
  }
  out.overflowers = [...document.querySelectorAll('body *')].filter((e) => isVisible(e) && e.getBoundingClientRect().right > vw + 1 && !inScroller(e)).slice(0, 8).map((e) => ({ sel: cssPath(e), right: round1(e.getBoundingClientRect().right) }))

  // 2. Objetivos táctiles
  const interactive = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=link], summary')]
  const small = []; let interactiveCount = 0; let inlineLinks = 0
  for (const e of interactive) {
    if (e.disabled || e.getAttribute('aria-disabled') === 'true') continue
    let t = e
    if (e.tagName === 'INPUT' && (e.type === 'checkbox' || e.type === 'radio')) t = e.closest('label') ?? e
    if (!isVisible(t)) continue
    const r = t.getBoundingClientRect()
    if (r.width <= 2 && r.height <= 2) continue // sr-only sin etiqueta visible
    if (e.tagName === 'A' && getComputedStyle(e).display === 'inline' && e.closest('p, li > span, span')) { inlineLinks += 1; continue }
    interactiveCount += 1
    if (r.width < 43.5 || r.height < 43.5) small.push({ sel: cssPath(t), w: round1(r.width), h: round1(r.height), text: (t.innerText || t.getAttribute('aria-label') || t.value || '').trim().slice(0, 30) })
  }
  out.touch = { interactive: interactiveCount, inlineLinksExempt: inlineLinks, small }

  // 3. Nombres accesibles
  const nameOf = (e) => {
    const lb = e.getAttribute('aria-labelledby')
    if (lb) { const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim(); if (t) return t }
    const al = e.getAttribute('aria-label'); if (al && al.trim()) return al.trim()
    if (e.labels && e.labels.length) { const t = [...e.labels].map((l) => l.textContent).join(' ').trim(); if (t) return t }
    const t = (e.innerText || e.textContent || '').trim(); if (t) return t
    const img = e.querySelector('img[alt]'); if (img && img.alt.trim()) return img.alt.trim()
    const svg = e.querySelector('svg[aria-label], svg title'); if (svg && (svg.getAttribute('aria-label') || svg.textContent)) return (svg.getAttribute('aria-label') || svg.textContent).trim()
    if (e.getAttribute('title')) return e.getAttribute('title')
    return ''
  }
  const unnamed = []; const placeholderOnly = []
  for (const e of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab]')) {
    const probe = e.tagName === 'INPUT' && (e.type === 'checkbox' || e.type === 'radio') ? (e.closest('label') ?? e) : e
    if (!isVisible(probe) && !(e.getBoundingClientRect().width <= 2 && e.closest('label'))) continue
    if (!nameOf(e)) {
      if ((e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') && e.getAttribute('placeholder')) placeholderOnly.push(cssPath(e))
      else unnamed.push({ sel: cssPath(e), tag: e.tagName.toLowerCase() })
    }
  }
  out.names = { unnamed, placeholderOnly }

  // 4. Imágenes
  const imgs = [...document.querySelectorAll('img')].filter(isVisible)
  out.images = { total: imgs.length, missingAlt: imgs.filter((i) => i.getAttribute('alt') === null).map((i) => cssPath(i)), decorativeEmptyAlt: imgs.filter((i) => i.getAttribute('alt') === '').length, svgNoHidden: [...document.querySelectorAll('svg')].filter((s) => isVisible(s) && !s.closest('button, a, [aria-hidden=true]') && !s.hasAttribute('aria-hidden') && !s.hasAttribute('aria-label') && !s.querySelector('title')).length }

  // 5. Contraste (colores computados + fondo efectivo)
  const cv = document.createElement('canvas'); cv.width = cv.height = 1
  const cx = cv.getContext('2d', { willReadFrequently: true })
  const cache = new Map()
  const parse = (css) => {
    if (cache.has(css)) return cache.get(css)
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = css; cx.fillRect(0, 0, 1, 1)
    const d = cx.getImageData(0, 0, 1, 1).data
    // Con alfa parcial getImageData devuelve valores premultiplicados -> se recupera el color y el alfa
    const a = d[3] / 255
    const rgba = a === 0 ? [0, 0, 0, 0] : [Math.min(255, Math.round(d[0] / a)), Math.min(255, Math.round(d[1] / a)), Math.min(255, Math.round(d[2] / a)), a]
    cache.set(css, rgba); return rgba
  }
  const over = (top, bottom) => { const a = top[3] + bottom[3] * (1 - top[3]); if (a === 0) return [0, 0, 0, 0]; return [0, 1, 2].map((i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a).concat(a) }
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
  const hex = (c) => `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
  const effective = (el) => {
    const layers = []; let bgImage = false
    for (let a = el; a; a = a.parentElement) {
      const s = getComputedStyle(a)
      if (s.backgroundImage !== 'none') bgImage = true
      const bg = parse(s.backgroundColor)
      if (bg[3] > 0) { layers.push(bg); if (bg[3] >= 0.999) break }
    }
    let base = [3, 17, 28, 1]
    if (!layers.length || layers[layers.length - 1][3] < 0.999) base = over(parse(getComputedStyle(document.documentElement).backgroundColor), [255, 255, 255, 1]).slice(0, 3).concat(1)
    let acc = base
    for (let i = layers.length - 1; i >= 0; i -= 1) acc = over(layers[i], acc)
    return { bg: acc, bgImage }
  }
  const groups = new Map(); let textNodes = 0; let indeterminate = 0
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const txt = n.nodeValue.trim(); const el = n.parentElement
    if (!txt || !el || seen.has(el) || ['SCRIPT', 'STYLE', 'OPTION'].includes(el.tagName)) continue
    seen.add(el)
    if (!isVisible(el)) continue
    const r = el.getBoundingClientRect(); if (r.width <= 2 || r.height <= 2) continue
    if (el.closest(':disabled, [aria-disabled=true], [aria-hidden=true]')) continue
    const s = getComputedStyle(el)
    let alpha = 1; for (let a = el; a; a = a.parentElement) alpha *= Number(getComputedStyle(a).opacity)
    textNodes += 1
    const { bg, bgImage } = effective(el)
    let fg = parse(s.color); fg = over([fg[0], fg[1], fg[2], fg[3] * alpha], bg)
    if (bgImage) { indeterminate += 1 }
    const l1 = lum(fg); const l2 = lum(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    const size = parseFloat(s.fontSize); const weight = Number(s.fontWeight)
    const large = size >= 24 || (size >= 18.66 && weight >= 700)
    const need = large ? 3 : 4.5
    if (ratio < need) {
      const key = `${hex(fg)}|${hex(bg)}|${large ? 'L' : 'N'}`
      const g = groups.get(key) ?? { fg: hex(fg), bg: hex(bg), ratio: Math.round(ratio * 100) / 100, need, count: 0, bgImage, sample: txt.slice(0, 40), sel: cssPath(el), size }
      g.count += 1; groups.set(key, g)
    }
  }
  out.contrast = { textElements: textNodes, indeterminateBgImage: indeterminate, failing: [...groups.values()].sort((a, b) => a.ratio - b.ratio) }

  // 6. Truncado de texto
  out.truncated = [...document.querySelectorAll('body *')].filter((e) => isVisible(e) && e.scrollWidth > e.clientWidth + 1 && ['ellipsis', 'clip'].includes(getComputedStyle(e).textOverflow)).slice(0, 8).map((e) => ({ sel: cssPath(e), text: (e.innerText || '').trim().slice(0, 40), hasTitle: Boolean(e.getAttribute('title') || e.getAttribute('aria-label')) }))
  // 7. Estados visibles
  const body = document.body.innerText
  out.states = {
    loading: /Cargando|Verificando|Comprobando|Validando|Calculando/i.test(body) || document.querySelectorAll('[role=status][aria-label^=Cargando], .skeleton-shimmer, .animate-spin').length > 0,
    empty: /Todavía no|Aún no|Sin |No hay|aparecerá|No sigues/i.test(body),
    error: Boolean(document.querySelector('[role=alert]')) || /No fue posible|No pudimos/i.test(body),
    textLength: body.length,
  }
  out.title = document.title
  out.lang = document.documentElement.lang
  out.viewportMeta = document.querySelector('meta[name=viewport]')?.getAttribute('content') ?? null
  return out
}

/** Marca de recorrido por teclado: ¿el elemento enfocado cambia visualmente al tener foco? Se ejecuta tras cada Tab real. */
export function focusProbe() {
  const e = document.activeElement
  if (!e || e === document.body) return null
  // Sin transiciones durante la medición: si no, el estilo computado justo tras blur() aún es el del foco (falso «sin indicador»).
  if (!document.getElementById('uat-no-transition')) { const st = document.createElement('style'); st.id = 'uat-no-transition'; st.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}'; document.head.appendChild(st) }
  const sig = (x) => { const s = getComputedStyle(x); return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.backgroundColor, s.color].join('|') }
  const sibSig = (x) => (x.nextElementSibling ? sig(x.nextElementSibling) : '')
  // También el contenedor (estilos :focus-within, p. ej. campos con icono cuyo borde está en el envoltorio).
  const parentSig = (x) => (x.parentElement ? sig(x.parentElement) : '')
  const focused = sig(e) + sibSig(e) + parentSig(e)
  const fv = e.matches(':focus-visible')
  e.blur()
  const blurred = sig(e) + sibSig(e) + parentSig(e)
  e.focus({ focusVisible: true })
  const r = e.getBoundingClientRect()
  const path = e.tagName.toLowerCase() + (e.id ? `#${e.id}` : '') + (e.getAttribute('aria-label') ? `[aria-label="${e.getAttribute('aria-label').slice(0, 30)}"]` : '')
  return { sel: path, text: (e.innerText || e.value || '').trim().slice(0, 30), focusVisible: fv, indicator: focused !== blurred, w: Math.round(r.width), h: Math.round(r.height), inViewport: r.bottom > 0 && r.top < innerHeight }
}

/** Observadores de rendimiento (inyectar con Page.addScriptToEvaluateOnNewDocument antes de navegar). */
export function perfObservers() {
  window.__perf = { fcp: null, lcp: null, cls: 0, longTasks: 0, tbt: 0 }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__perf.fcp = e.startTime }).observe({ type: 'paint', buffered: true }) } catch { /* no soportado */ }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = e.startTime }).observe({ type: 'largest-contentful-paint', buffered: true }) } catch { /* no soportado */ }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value }).observe({ type: 'layout-shift', buffered: true }) } catch { /* no soportado */ }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__perf.longTasks += 1; window.__perf.tbt += Math.max(0, e.duration - 50) } }).observe({ type: 'longtask', buffered: true }) } catch { /* no soportado */ }
}
