# Mobile regression test (WebKit iPhone emulation if available): stepping moves must never scroll the window.
# usage: python3 scripts/mobile-scroll-test.py [baseUrl] [gameIndex] [screenshot-path]
import sys, re
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
GAME = int(sys.argv[2]) if len(sys.argv) > 2 else 5
SHOT = sys.argv[3] if len(sys.argv) > 3 else None
with sync_playwright() as p:
    try:
        b = p.webkit.launch(); engine = "webkit"
    except Exception:
        b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"]); engine = "chromium"
    dev = dict(p.devices["iPhone 13"]); dev["viewport"] = {"width": 390, "height": 844}
    if engine == "chromium": dev.pop("default_browser_type", None)
    ctx = b.new_context(**{k: v for k, v in dev.items() if k != "default_browser_type"})
    m = ctx.new_page(); errs = []
    m.on("pageerror", lambda e: errs.append(str(e)))
    m.goto(BASE + "/", wait_until="networkidle")
    m.wait_for_selector("button[data-game-id]", timeout=60000)
    m.locator("button[data-game-id]").nth(GAME).tap()
    m.wait_for_url(re.compile(r"/game/"))
    m.wait_for_selector("[data-testid=start-review]", timeout=240000)
    m.click("[data-testid=start-review]")
    m.wait_for_selector("[data-testid=move-list]")
    m.wait_for_timeout(500)
    new_ui = m.locator("[data-testid=nav-next]").count() > 0
    nxt = "[data-testid=nav-next]" if new_ui else 'button[title="Next (→)"]'
    def run(label, scroll_to):
        m.evaluate(f"window.scrollTo(0, {scroll_to})"); m.wait_for_timeout(800)
        ys = [m.evaluate("Math.round(scrollY)")]; shs = [m.evaluate("document.documentElement.scrollHeight")]
        for _ in range(10):
            if new_ui: m.tap(nxt)
            else:
                m.evaluate(f"document.querySelector('{nxt}').click()")
            m.wait_for_timeout(250)
            ys.append(m.evaluate("Math.round(scrollY)")); shs.append(m.evaluate("document.documentElement.scrollHeight"))
        print(f"[{engine}] {label}: scrollY {ys} -> {"STABLE" if len(set(ys)) == 1 else "MOVED"} (page heights {sorted(set(shs))})")
        return len(set(ys)) == 1
    ok = run("top of page", 0)
    ok &= run("scrolled to coach card", m.evaluate("Math.round(document.querySelector('[data-testid=move-detail]').getBoundingClientRect().top + scrollY - 140)"))
    ok &= run("scrolled to bottom", m.evaluate("document.documentElement.scrollHeight - innerHeight"))
    if new_ui:
        nb = m.locator("[data-testid=mobile-nav]").bounding_box()
        print("mobile nav bar:", {k: round(v) for k, v in nb.items()}, "| counter:", m.inner_text("[data-testid=mobile-nav-counter]"))
        ml = m.evaluate("(() => { const e = document.querySelector('[data-testid=move-list]'); return [e.clientHeight, e.scrollHeight, e.scrollTop]; })()")
        print("move list clientHeight/scrollHeight/scrollTop:", ml)
    if SHOT:
        m.evaluate("window.scrollTo(0, 0)"); m.wait_for_timeout(400)
        m.screenshot(path=SHOT)
    print("RESULT:", "PASS" if ok else "FAIL", "| page errors:", errs or "none")
    b.close()
