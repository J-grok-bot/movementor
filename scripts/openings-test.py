# Browser check for /openings (desktop Chromium + 390x844 WebKit iPhone emulation) and the review -> openings link.
# usage: python3 scripts/openings-test.py [baseUrl]
import sys, os, re
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs") + os.sep
def name(m): return m.inner_text("[data-testid=opening-name]").replace("\n", " ")
def sq(m, s): m.locator(f'[data-testid=openings-board] [data-square="{s}"]').click()
def drag(m, a, b):
    ba = m.locator(f'[data-testid=openings-board] [data-square="{a}"]').bounding_box()
    bb = m.locator(f'[data-testid=openings-board] [data-square="{b}"]').bounding_box()
    m.mouse.move(ba["x"] + ba["width"] / 2, ba["y"] + ba["height"] / 2); m.mouse.down()
    m.mouse.move(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2, steps=12); m.mouse.up()
with sync_playwright() as p:
    errs = []
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    m = b.new_page(viewport={"width": 1400, "height": 1000})
    m.on("pageerror", lambda e: errs.append(str(e)))
    m.goto(BASE + "/openings", wait_until="networkidle")
    m.wait_for_selector("[data-testid=continuation]", timeout=60000)
    print("nav:", m.inner_text("[data-testid=app-nav]").replace("\n", " | "), "| start book moves:", m.locator("[data-testid=continuation]").count())
    drag(m, "e2", "e4"); m.wait_for_timeout(300)
    print("after drag e2-e4:", name(m))
    sq(m, "c7"); sq(m, "c5"); m.wait_for_timeout(300)
    print("after tap c7,c5:", name(m))
    m.locator("[data-testid=continuation]", has_text="Nf3").first.click(); m.wait_for_timeout(200)
    for s in ["d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3"]:
        m.locator("[data-testid=continuation]").filter(has=m.locator(f'span:text-is("{s}")')).first.click(); m.wait_for_timeout(120)
    conts = m.locator("[data-testid=continuation]")
    print("after 5.Nc3 continuations:", [conts.nth(i).inner_text().replace("\n", " ") for i in range(min(4, conts.count()))])
    m.locator("[data-testid=continuation]").filter(has=m.locator('span:text-is("a6")')).first.click(); m.wait_for_timeout(200)
    print("after a6:", name(m), "| url:", m.url.replace(BASE, ""))
    m.click("[data-testid=undo]"); print("undo:", name(m))
    m.click("[data-testid=eval-toggle]"); m.wait_for_function("document.querySelector('[data-testid=eval-toggle]').parentElement.innerText.includes(':')", timeout=60000)
    print("eval:", m.locator("[data-testid=eval-toggle]").locator("xpath=..").inner_text())
    m.click("[data-testid=flip]")
    m.wait_for_timeout(400)
    m.screenshot(path=OUT + "screenshot-openings-explorer.png")
    m.click("[data-testid=eval-toggle]")
    # Transposition: different move order, same position
    m.goto(BASE + "/openings?moves=Nf3,d6,e4,c5,d4,cxd4,Nxd4,Nf6,Nc3,a6", wait_until="networkidle")
    m.wait_for_selector("[data-testid=continuation]", timeout=60000); m.wait_for_timeout(300)
    print("transposed order:", name(m))
    m.click("[data-testid=reset]"); print("reset:", name(m), "| url:", m.url.replace(BASE, ""))
    # Search
    m.fill("[data-testid=opening-search]", "london")
    print("search 'london':", [m.locator("[data-testid=search-result]").nth(i).inner_text().split("\n")[0] for i in range(3)])
    m.fill("[data-testid=opening-search]", "sicilian najdorf")
    print("search 'sicilian najdorf':", m.locator("[data-testid=search-result]").first.inner_text().replace("\n", " | "))
    # Review -> openings link
    m.goto(BASE + "/?user=Killer5291", wait_until="networkidle")
    m.wait_for_selector("button[data-game-id]", timeout=60000)
    m.locator("button[data-game-id]").nth(5).click()
    m.wait_for_selector("[data-testid=opening-link]", timeout=240000)
    print("review opening link:", m.inner_text("[data-testid=opening-link]"), "->", m.get_attribute("[data-testid=opening-link]", "href"))
    m.click("[data-testid=opening-link]"); m.wait_for_url(re.compile(r"/openings")); m.wait_for_selector("[data-testid=opening-name]")
    m.wait_for_timeout(800)
    print("after following link:", name(m))
    b.close()

    # Mobile walkthrough (WebKit iPhone)
    w = p.webkit.launch()
    dev = dict(p.devices["iPhone 13"]); dev.pop("default_browser_type"); dev["viewport"] = {"width": 390, "height": 844}
    m = w.new_context(**dev).new_page()
    m.on("pageerror", lambda e: errs.append("mobile: " + str(e)))
    m.goto(BASE + "/openings", wait_until="networkidle")
    m.wait_for_selector("[data-testid=continuation]", timeout=60000)
    m.fill("[data-testid=opening-search]", "london system")
    m.locator("[data-testid=search-result]").first.tap()
    m.wait_for_selector("[data-testid=walkthrough]")
    print("walkthrough:", m.inner_text("[data-testid=walkthrough] h2"), "| url:", m.url.replace(BASE, ""))
    seen = []
    for i in range(10):
        if m.locator("[data-testid=walk-next]").is_disabled(): break
        m.tap("[data-testid=walk-next]"); m.wait_for_timeout(150)
        seen.append(name(m))
    print("names while stepping:", " -> ".join(dict.fromkeys(seen)))
    m.tap("[data-testid=walk-prev]"); m.tap("[data-testid=walk-prev]"); m.wait_for_timeout(200)
    m.evaluate("window.scrollTo(0, 0)"); m.wait_for_timeout(300)
    m.screenshot(path=OUT + "screenshot-openings-walkthrough.png")
    # Practice: wrong move, hint, right moves
    m.tap("[data-testid=mode-practice]"); m.wait_for_timeout(200)
    print("practice prompt:", m.inner_text("[data-testid=walk-feedback]"))
    sq(m, "e2"); sq(m, "e4"); m.wait_for_timeout(200)
    print("wrong move:", m.inner_text("[data-testid=walk-feedback]"), "| counter", m.inner_text("[data-testid=walk-counter]"))
    m.tap("[data-testid=hint]"); m.wait_for_timeout(200)
    print("hint:", m.inner_text("[data-testid=walk-feedback]"))
    sq(m, "d2"); sq(m, "d4"); m.wait_for_timeout(200)
    print("right move:", m.inner_text("[data-testid=walk-feedback]"), "| counter", m.inner_text("[data-testid=walk-counter]"))
    shared = m.url
    m.goto(shared, wait_until="networkidle"); m.wait_for_selector("[data-testid=walkthrough]", timeout=60000)
    print("shared URL restores:", m.inner_text("[data-testid=walk-counter]"), m.inner_text("[data-testid=walkthrough] .text-xs.uppercase"), "|", shared.replace(BASE, ""))
    w.close()
    print("page errors:", errs or "none")
