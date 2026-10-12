# End-to-end browser check: loads the app in headless Chrome, checks background preloading, analyzes
# a real game (overview, reviewed move, engine-line explorer), then the mobile list -> review flow.
# usage: python3 scripts/screenshot.py [gameIndex] [ply]
import sys, os, re, time
from playwright.sync_api import sync_playwright
game = int(sys.argv[1]) if len(sys.argv) > 1 else 5
ply = sys.argv[2] if len(sys.argv) > 2 else "28"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs") + os.sep
BASE = "http://localhost:3000"
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 1400, "height": 1000})
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(BASE + "/", wait_until="networkidle")
    pg.wait_for_selector("button[data-game-id]", timeout=60000)
    print("games listed:", pg.locator("button[data-game-id]").count())
    pg.wait_for_selector("[data-testid=preload-progress]", timeout=30000)
    print("preload started on:", pg.locator("[data-testid=preload-progress]").first.inner_text())
    # Opening a game pauses preloading; the user's game gets the engine.
    pg.locator("button[data-game-id]").nth(game).click()
    pg.wait_for_selector("[data-testid=progress]", timeout=60000)
    time.sleep(1)
    prog = pg.locator("[data-testid=progress]")
    print("user progress:", prog.inner_text().replace("\n", " ") if prog.count() else "(already done)",
          "| preload indicators while user analyzes:", pg.locator("[data-testid=preload-progress]").count())
    print("desktop URL:", pg.url)
    pg.wait_for_selector("[data-testid=overview]", timeout=240000)
    print(pg.inner_text("[data-testid=analysis-done]"))
    print("--- counts ---\n" + pg.inner_text("[data-testid=counts-table]"))
    print("--- phases ---\n" + pg.inner_text("[data-testid=phase-table]"))
    print("--- key moments ---\n" + pg.inner_text("[data-testid=key-moments]"))
    print("--- summary ---\n" + pg.inner_text("[data-testid=summary]"))
    pg.screenshot(path=OUT + "screenshot-overview.png", full_page=True)

    pg.click("[data-testid=start-review]")
    pg.wait_for_selector("[data-testid=move-list]")
    nply = pg.locator("[data-ply]").count()
    if nply < int(ply):
        ply = str(max(1, nply * 2 // 3))
    pg.click(f'[data-ply="{ply}"]')
    pg.wait_for_timeout(800)
    print("--- move ---\n" + pg.inner_text("[data-testid=move-detail]"))
    lines = pg.locator("[data-testid=engine-lines]")
    for i in range(lines.count()):
        print("  ", lines.nth(i).inner_text().replace("\n", " ")[:300])
    pg.screenshot(path=OUT + "screenshot-move.png", full_page=True)

    # Open the line explorer overlay from the top engine line (3rd move), step with the keyboard.
    first_id = pg.locator("[data-line]").first.get_attribute("data-line")
    pg.click(f'[data-line="{first_id}"][data-step="3"]')
    pg.wait_for_selector('[data-testid=line-explorer][data-state=open]')
    pg.keyboard.press("ArrowRight")
    pg.wait_for_timeout(500)
    print("explorer:", pg.inner_text("[data-testid=explorer-title]"), "| step", pg.inner_text("[data-testid=explorer-step]"))
    print("game board frozen:", pg.get_attribute("[data-testid=game-board-column]", "data-frozen"))
    pg.keyboard.press("Home"); pg.wait_for_timeout(150)
    print("after Home:", pg.inner_text("[data-testid=explorer-step]"))
    pg.keyboard.press("End"); pg.wait_for_timeout(150)
    print("after End:", pg.inner_text("[data-testid=explorer-step]"))
    pg.keyboard.press("ArrowLeft"); pg.keyboard.press("ArrowLeft"); pg.wait_for_timeout(400)
    print("after 2x Left:", pg.inner_text("[data-testid=explorer-step]"))
    pg.screenshot(path=OUT + "screenshot-overlay.png", full_page=True)
    pg.keyboard.press("Escape")
    pg.wait_for_selector("[data-testid=line-explorer]", state="detached", timeout=3000)
    print("after Esc: explorer closed, board frozen:", pg.get_attribute("[data-testid=game-board-column]", "data-frozen"))
    # Re-open and close with the button
    pg.click('[data-testid=engine-lines] button:has-text("Preview")')
    pg.wait_for_selector('[data-testid=line-explorer][data-state=open]')
    pg.click("[data-testid=explorer-close]")
    pg.wait_for_selector("[data-testid=line-explorer]", state="detached", timeout=3000)
    print("close button works: True")
    # Main game navigation still works after closing
    pg.keyboard.press("ArrowRight"); pg.wait_for_timeout(300)
    print("game nav after close:", pg.inner_text("[data-testid=move-detail]").split("\n")[1] if "\n" in pg.inner_text("[data-testid=move-detail]") else pg.inner_text("[data-testid=move-detail]")[:40])

    # Reduced motion: overlay opens/closes without transition delay
    rm = ctx.new_page()
    rm.emulate_media(reduced_motion="reduce")
    rm.goto(pg.url, wait_until="networkidle")
    rm.wait_for_selector("[data-testid=overview]", timeout=240000)
    rm.click("[data-testid=start-review]"); rm.click(f'[data-ply="{ply}"]')
    rm.click('[data-testid=engine-lines] button:has-text("Preview")')
    rm.wait_for_selector('[data-testid=line-explorer][data-state=open]')
    rm.keyboard.press("Escape")
    rm.wait_for_selector("[data-testid=line-explorer]", state="detached", timeout=100)
    print("reduced-motion close is immediate: True")
    rm.close()
    pg.click("[data-testid=back-overview]")
    print("back to overview:", pg.locator("[data-testid=overview]").count() == 1)

    # Preloading resumes after the user's game is done: wait for 3 newest + the opened one.
    t0 = time.time()
    while pg.locator("[data-testid=reviewed-badge]").count() < 4 and time.time() - t0 < 900:
        time.sleep(5)
    badges = [pg.locator("button[data-game-id]").nth(i).locator("[data-testid=reviewed-badge]").count() for i in range(6)]
    print(f"reviewed badges on first 6 cards: {badges} (after {round(time.time()-t0)}s)")
    # Settings toggle persists
    pg.click("text=Settings")
    pg.uncheck("[data-testid=preload-toggle]")
    pg.reload(wait_until="networkidle"); pg.click("text=Settings")
    print("preload toggle after reload (off expected):", pg.is_checked("[data-testid=preload-toggle]"),
          "| stored:", pg.evaluate("localStorage.getItem('movementor:settings')"))
    pg.check("[data-testid=preload-toggle]")
    print("desktop deep link ?g=:", pg.evaluate("location.search"))

    # Mobile: phone-sized touch context sharing the analysis cache (localStorage).
    state = ctx.storage_state()
    mctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True,
                         has_touch=True, storage_state=state)
    m = mctx.new_page()
    m.on("pageerror", lambda e: errors.append("mobile: " + str(e)))
    m.goto(BASE + "/", wait_until="networkidle")
    m.wait_for_selector("button[data-game-id]", timeout=60000)
    print("mobile: review pane visible on list page:", m.locator("[data-testid=overview]").count() > 0)
    print("mobile: card height px:", round(m.locator("button[data-game-id]").first.bounding_box()["height"]))
    time.sleep(1)
    m.screenshot(path=OUT + "screenshot-mobile-list.png")
    # Tap a cached game -> full-screen review
    m.locator("button[data-game-id]").nth(game).tap()
    m.wait_for_url(re.compile(r"/game/"), timeout=10000)
    m.wait_for_selector("[data-testid=game-header]")
    m.wait_for_selector("[data-testid=overview]", timeout=240000)
    print("mobile review URL:", m.url.replace(BASE, ""))
    print("mobile header:", m.inner_text("[data-testid=game-header]").replace("\n", " | "))
    m.click("[data-testid=start-review]")
    m.click(f'[data-ply="{ply}"]')
    m.wait_for_timeout(500)
    # Board bottom, coach card and engine lines in view (what you see while stepping)
    m.evaluate("window.scrollTo(0, 260)"); m.wait_for_timeout(400)
    m.screenshot(path=OUT + "screenshot-mobile-review.png")
    print("mobile nav:", m.inner_text("[data-testid=mobile-nav-counter]").replace("\n", " "))
    m.mouse.wheel(0, 300); m.wait_for_timeout(300)
    hdr = m.locator("[data-testid=game-header]").bounding_box()
    print("sticky header top after scrolling:", round(hdr["y"]))
    fid = m.locator("[data-line]").first.get_attribute("data-line")
    m.click(f'[data-line="{fid}"][data-step="3"]')
    m.wait_for_selector('[data-testid=line-explorer][data-state=open]')
    m.wait_for_timeout(500)
    box = m.locator("[data-testid=line-explorer]").bounding_box()
    print("mobile sheet box:", {k: round(v) for k, v in box.items()}, "| mini played board visible:", m.locator("[data-testid=explorer-played-mini]").is_visible())
    m.screenshot(path=OUT + "screenshot-overlay-mobile.png")
    m.keyboard.press("Escape")
    m.wait_for_selector("[data-testid=line-explorer]", state="detached", timeout=3000)
    m.click("[data-testid=back-to-list]")
    m.wait_for_selector("button[data-game-id]")
    print("back ->", m.url.replace(BASE, ""))
    # Scroll restoration: scroll down, open an un-reviewed game, back.
    m.evaluate("window.scrollTo(0, 1500)"); m.wait_for_timeout(400)
    y0 = m.evaluate("scrollY")
    cards = m.locator("button[data-game-id]")
    target = None
    for i in range(cards.count()):
        bb = cards.nth(i).bounding_box()
        if bb and 200 < bb["y"] < 700 and cards.nth(i).locator("[data-testid=reviewed-badge]").count() == 0:
            target = cards.nth(i); break
    target.tap()
    m.wait_for_selector("[data-testid=header-progress]", timeout=20000)
    time.sleep(2)
    print("uncached game header progress:", m.inner_text("[data-testid=header-progress]"))
    m.click("[data-testid=back-to-list]")
    m.wait_for_selector("button[data-game-id]"); m.wait_for_timeout(600)
    print(f"scroll before {y0}, after back {m.evaluate('scrollY')}")
    m.close()
    print("page errors:", errors or "none")
    b.close()
