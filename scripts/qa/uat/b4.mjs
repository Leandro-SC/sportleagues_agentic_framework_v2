// Bloque b4: calidad móvil medible por pantalla y viewport (criterios 1, 4, 5, 6 y 9 de docs/testing/MOBILE-FIRST-ACCEPTANCE.md).
// Para cada pantalla real (visitante, participante qa-user1, organizador qa-requester) y cada ancho 320/390/430 px:
//   Q.<pantalla>.<ancho>      sin scroll horizontal ni elementos desbordados, objetivos táctiles >= 44x44 px, controles con nombre accesible,
//                             imágenes con alt y sin errores de consola/excepciones durante la pantalla.
//   A11Y.contraste.<pantalla> (solo 390) ningún texto por debajo de 4.5:1 (3:1 si es grande), con colores computados y fondo efectivo.
//   A11Y.texto200.<pantalla>  (solo 390) con la fuente raíz al 200 % no aparece scroll horizontal ni desbordes (texto escalable).
//   A11Y.foco.<pantalla>      recorrido real con Tab: cada elemento enfocado cambia visualmente (indicador de foco).
//   A11Y.documento            idioma, título y meta viewport sin bloqueo de zoom.
// La auditoría es DOM (scripts/qa/uat/audit.mjs), no Lighthouse. Las pantallas de organizador usan la misma reescritura de UAT-01 que b1
// para que se mida la pantalla con datos y no el estado de error.
import { BASE, audit, consoleErrors, focusWalk, loginUI, settle, shot, summarize } from './lib.mjs'
import { sleep } from './cdp.mjs'

const VIEWPORTS = [{ w: 320, h: 568 }, { w: 390, h: 844 }, { w: 430, h: 932 }]

export async function run(ctx) {
  const { rep, identities, D } = ctx
  const matrix = []

  async function measure(page, name, open, { focus = false } = {}) {
    for (const vp of VIEWPORTS) {
      await page.setMobile({ width: vp.w, height: vp.h, dpr: 3 })
      const t0 = Date.now()
      await open(page)
      await settle(page, { timeout: 20000 })
      await page.eval('window.scrollTo(0, 0)')
      const a = await audit(page)
      const errs = consoleErrors(page, t0)
      await shot(page, `b4-${name}-${vp.w}`)
      const s = summarize(a)
      matrix.push({ screen: name, w: vp.w, ...s, url: a.url, consoleErrors: errs.length })
      const ok = a.hscroll.ok && a.overflowers.length === 0 && a.touch.small.length === 0 && a.names.unnamed.length === 0 && a.names.placeholderOnly.length === 0 && a.images.missingAlt.length === 0 && errs.length === 0
      rep.check(`Q.${name}.${vp.w}`, ok,
        `${a.url}: scroll horizontal=${!a.hscroll.ok} (${a.hscroll.scrollWidth}/${a.hscroll.clientWidth}); desbordes=${JSON.stringify(a.overflowers.slice(0, 3))}; táctiles <44px ${a.touch.small.length}/${a.touch.interactive}: ${JSON.stringify(a.touch.small.slice(0, 5).map((x) => `${x.text || x.sel} ${x.w}x${x.h}`))}; sin nombre=${JSON.stringify(a.names.unnamed.slice(0, 3))}; solo placeholder=${JSON.stringify(a.names.placeholderOnly.slice(0, 3))}; img sin alt=${a.images.missingAlt.length}; estados=${JSON.stringify(a.states)}; errores de consola=${JSON.stringify(errs.slice(0, 3))}`)
      if (vp.w === 390) {
        rep.check(`A11Y.contraste.${name}`, a.contrast.failing.length === 0,
          `${a.contrast.textElements} textos medidos (${a.contrast.indeterminateBgImage} sobre imagen de fondo, indeterminados); por debajo del mínimo: ${JSON.stringify(a.contrast.failing.slice(0, 4).map((g) => `«${g.sample}» ${g.fg} sobre ${g.bg} = ${g.ratio}:1 (mín ${g.need}) ×${g.count} ${g.sel}`))}`)
        // Texto al 200 %: la app usa rem, así que se escala la fuente raíz (equivalente al ajuste de tamaño de texto del sistema).
        await page.eval(`document.documentElement.style.fontSize = '200%'`)
        await sleep(600)
        const big = await audit(page)
        // Diagnóstico: elementos más anchos que la vista (incluidos los que están dentro de contenedores con scroll propio).
        const wide = big.hscroll.ok ? [] : await page.eval(`[...document.querySelectorAll('body *')].map((e) => ({ e, r: e.getBoundingClientRect() })).filter(({ r }) => r.right > innerWidth + 1 && r.width > 0).sort((a, b) => b.r.right - a.r.right).slice(0, 3).map(({ e, r }) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + [...e.classList].slice(0, 3).join('.') + ' «' + (e.innerText || '').trim().slice(0, 24) + '» right=' + Math.round(r.right))`)
        big.overflowers = big.overflowers.length ? big.overflowers : wide.map((sel) => ({ sel }))
        await shot(page, `b4-${name}-texto200`)
        await page.eval(`document.documentElement.style.fontSize = ''`)
        rep.check(`A11Y.texto200.${name}`, big.hscroll.ok && big.overflowers.length === 0,
          `fuente raíz 200 %: scroll horizontal=${!big.hscroll.ok} (${big.hscroll.scrollWidth}/${big.hscroll.clientWidth}); desbordes=${JSON.stringify(big.overflowers.slice(0, 4))}; truncados=${big.truncated.length}`)
        if (focus) {
          await page.eval('window.scrollTo(0, 0)')
          const walk = await focusWalk(page, 14)
          const missing = walk.filter((f) => !f.indicator)
          rep.check(`A11Y.foco.${name}`, walk.length >= 3 && missing.length === 0,
            `${walk.length} paradas con Tab; sin indicador visible: ${JSON.stringify(missing.slice(0, 5).map((f) => f.text || f.sel))}`)
        }
      }
    }
  }

  // ---------------- Visitante ----------------
  {
    const chrome = await ctx.launch('b4-guest')
    try {
      const page = await chrome.newPage({ width: 390, height: 844, dpr: 3 })
      await page.goto(`${BASE}/`); await settle(page)
      const doc = await page.eval(`({ lang: document.documentElement.lang, title: document.title, vp: document.querySelector('meta[name=viewport]')?.content ?? '' })`)
      rep.check('A11Y.documento', doc.lang === 'es' && doc.title.length > 0 && /width=device-width/.test(doc.vp) && !/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/.test(doc.vp),
        `lang="${doc.lang}", title="${doc.title}", viewport="${doc.vp}"`)
      await measure(page, 'visitante', (p) => p.goto(`${BASE}/`), { focus: true })
      await measure(page, 'acceso', async (p) => { await p.goto(`${BASE}/`); await settle(p); await p.tap('button', 'Iniciar sesión'); await p.waitFor('#email') }, { focus: true })
    } catch (e) { await ctx.errShot(chrome, 'b4-guest'); throw e } finally { await chrome.close() }
  }

  // ---------------- Participante (qa-user1) ----------------
  {
    const chrome = await ctx.launch('b4-user')
    try {
      const page = await chrome.newPage({ width: 390, height: 844, dpr: 3 })
      await loginUI(page, identities.user1)
      const pool = async (p, tab) => {
        await p.goto(`${BASE}/p/${D.pool.id}`)
        await p.waitFor(`/Esta quiniela usa tickets|Próximos partidos|No fue posible/.test(document.body.innerText)`, { timeout: 25000 })
        if (tab) { await settle(p); await p.tap('[role=tab]', tab) }
      }
      await measure(page, 'inicio', (p) => p.goto(`${BASE}/`), { focus: true })
      await measure(page, 'partidos', (p) => p.goto(`${BASE}/partidos`))
      await measure(page, 'ligas', (p) => p.goto(`${BASE}/ligas`))
      await measure(page, 'unirme', (p) => p.goto(`${BASE}/ligas/unirme`))
      await measure(page, 'quiniela-resumen', (p) => pool(p, null))
      await measure(page, 'quiniela-tickets', (p) => pool(p, 'Partidos'), { focus: true })
      await measure(page, 'quiniela-tabla', (p) => pool(p, 'Tabla'))
      await measure(page, 'puntos', (p) => p.goto(`${BASE}/mis-puntos`))
      await measure(page, 'mis-tickets', (p) => p.goto(`${BASE}/mis-tickets`))
      await measure(page, 'perfil', (p) => p.goto(`${BASE}/perfil`))
    } catch (e) { await ctx.errShot(chrome, 'b4-user'); throw e } finally { await chrome.close() }
  }

  // ---------------- Participante en quiniela clásica (formulario de pronóstico; qa-user2 en B) ----------------
  {
    const chrome = await ctx.launch('b4-user2')
    try {
      const page = await chrome.newPage({ width: 390, height: 844, dpr: 3 })
      await loginUI(page, identities.user2)
      await measure(page, 'quiniela-clasica', async (p) => {
        await p.goto(`${BASE}/p/${D.poolB.id}`)
        await p.waitFor(`/Próximos partidos|Tu inscripción|No tienes acceso/.test(document.body.innerText)`, { timeout: 25000 })
        await settle(p); await p.tap('[role=tab]', 'Partidos')
      }, { focus: true })
    } catch (e) { await ctx.errShot(chrome, 'b4-user2'); throw e } finally { await chrome.close() }
  }

  // ---------------- Organizador (qa-requester) ----------------
  {
    const chrome = await ctx.launch('b4-org')
    try {
      const page = await chrome.newPage({ width: 390, height: 844, dpr: 3 })
      await loginUI(page, identities.requester)
      await page.rewriteRequests('*/rest/v1/participants?select=*', (u) => u.replace('%2Cprofiles%28display_name%29', ''))
      await measure(page, 'org-panel', (p) => p.goto(`${BASE}/organizador`))
      await measure(page, 'org-quinielas', async (p) => { await p.goto(`${BASE}/admin`); await p.waitFor('#admin-lock-minutes', { timeout: 25000 }) }, { focus: true })
      await measure(page, 'org-parrilla', async (p) => { await p.goto(`${BASE}/admin/parrilla`); await p.waitFor('select', { timeout: 25000 }) })
      await measure(page, 'org-finanzas', async (p) => { await p.goto(`${BASE}/admin/ingresos`); await p.waitForText('Resumen de la organización', { timeout: 25000 }) })
    } catch (e) { await ctx.errShot(chrome, 'b4-org'); throw e } finally { await chrome.close() }
  }

  rep.data('b4.matrix', matrix)
}
