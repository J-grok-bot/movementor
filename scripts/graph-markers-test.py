# Eval-graph markers: default only Brilliant/Blunder, legend toggles, tooltip, click-to-jump, clusters at 390px.
# usage: python3 scripts/graph-markers-test.py [baseUrl] [gameIndex]
import sys, os
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
GAME = int(sys.argv[2]) if len(sys.argv) > 2 else 5
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs") + os.sep
MK = "[data-testid=graph-marker]"
fails = []
def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: fails.append(msg)

def overlaps(m):
    return m.evaluate("""() => { const r=[...document.querySelectorAll('[data-testid=graph-marker]')].filter(e=>e.offsetParent).map(e=>e.getBoundingClientRect());
      let c=0; for(let i=0;i<r.length;i++)for(let j=i+1;j<r.length;j++){const a=r[i],b=r[j]; if(a.left<b.right-2&&b.left<a.right-2&&a.top<b.bottom-2&&b.top<a.bottom-2)c++} return c }""")

def classes(m):
    return sorted(set(m.eval_on_selector_all(MK, "es=>es.filter(e=>e.offsetParent).map(e=>e.dataset.class)")))

def run(m, mobile, label, shot):
    errs = []; m.on("pageerror", lambda e: errs.append(str(e)))
    m.goto(BASE + "/?user=Killer5291", wait_until="networkidle")
    m.evaluate("localStorage.removeItem('movementor-graph-markers')")
    m.wait_for_selector("button[data-game-id]", timeout=60000)
    card = m.locator("button[data-game-id]").nth(GAME); card.tap() if mobile else card.click()
    m.wait_for_selector("[data-testid=start-review]", timeout=240000); m.wait_for_timeout(500)
    # overview graph
    ov = classes(m)
    check(set(ov) <= {"Brilliant", "Blunder"}, f"[{label}] overview defaults only Brilliant/Blunder: {ov}")
    check(overlaps(m) == 0, f"[{label}] overview markers don't overlap")
    if shot and not mobile:
        m.locator("[data-testid=eval-graph-wrap]").first.screenshot(path="/tmp/graph-overview.png")
    m.click("[data-testid=start-review]"); m.wait_for_timeout(500)
    wrap = m.locator("[data-testid=eval-graph-wrap]").first
    wrap.scroll_into_view_if_needed()
    n0 = m.locator(MK).count()
    m.click("[data-testid=graph-toggle-great]"); m.click("[data-testid=graph-toggle-errors]"); m.wait_for_timeout(200)
    allc = classes(m); n1 = m.locator(MK).count()
    check(n1 >= n0, f"[{label}] toggles add markers {n0} -> {n1}: {allc}")
    check("Inaccuracy" not in allc, f"[{label}] inaccuracies never shown")
    check(overlaps(m) == 0, f"[{label}] no overlap with all toggles (clusters: {m.eval_on_selector_all(MK, 'es=>es.filter(e=>+e.dataset.count>1).length')})")
    sides = m.eval_on_selector_all(MK, "es=>es.map(e=>e.dataset.side)")
    check(set(sides) <= {"white", "black"}, f"[{label}] sides {sorted(set(sides))}")
    m.click("[data-testid=graph-toggle-blunder]"); m.wait_for_timeout(100)
    check("Blunder" not in classes(m), f"[{label}] blunder toggle hides blunders")
    m.click("[data-testid=graph-toggle-blunder]"); m.wait_for_timeout(100)
    # single marker: hover/tap -> tooltip, click -> jump
    single = m.locator(f'{MK}[data-count="1"]').first
    if single.count():
        target = int(single.get_attribute("data-marker-ply"))
        y0 = m.evaluate("scrollY")
        if mobile: single.tap()
        else: single.hover(); m.wait_for_timeout(150)
        tip = m.locator("[data-testid=graph-tooltip]")
        check(tip.count() == 1 and "→" in tip.inner_text(), f"[{label}] tooltip: {tip.inner_text() if tip.count() else None!r}")
        if not mobile: single.click()
        m.wait_for_timeout(400)
        ply = int(m.get_attribute("[data-testid=game-board-column]", "data-ply"))
        check(ply == target, f"[{label}] click jumps to ply {target} (now {ply})")
        check(abs(m.evaluate("scrollY") - y0) < 2, f"[{label}] no page jump")
    cl = m.locator(f'{MK}:not([data-count="1"])').first
    if cl.count():
        cl.tap() if mobile else cl.click(); m.wait_for_timeout(200)
        items = m.locator("[data-testid=graph-tooltip-item]")
        check(items.count() == int(cl.get_attribute("data-count")), f"[{label}] cluster lists {items.count()} moves")
        t = items.nth(1).inner_text(); items.nth(1).click(); m.wait_for_timeout(300)
        print(f"  jumped via cluster item {t!r} -> ply", m.get_attribute("[data-testid=game-board-column]", "data-ply"))
    if shot:
        m.click("[data-testid=graph-toggle-great]"); m.click("[data-testid=graph-toggle-errors]")  # back to defaults
        m.mouse.move(0, 0); m.wait_for_timeout(100)
        s = m.locator(MK).first
        if not mobile:
            s.hover(); m.wait_for_timeout(200)
            box = wrap.bounding_box()
            m.screenshot(path=OUT + "screenshot-graph-markers.png", clip={"x": box["x"] - 10, "y": box["y"] - 60, "width": box["width"] + 20, "height": box["height"] + 80})
        else:
            wrap.screenshot(path="/tmp/graph-markers-mobile.png")
    check(not errs, f"[{label}] page errors: {errs}")

with sync_playwright() as p:
    br = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    run(br.new_page(viewport={"width": 1400, "height": 1000}), False, "desktop", True); br.close()
    w = p.webkit.launch()
    dev = dict(p.devices["iPhone 13"]); dev.pop("default_browser_type"); dev["viewport"] = {"width": 390, "height": 844}
    run(w.new_context(**dev).new_page(), True, "mobile", True); w.close()
print("RESULT:", "FAIL" if fails else "PASS", fails)
