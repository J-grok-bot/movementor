# End-to-end browser check: loads the app in headless Chrome, analyzes a real game, captures
# the overview, then a reviewed move (coach explanation + engine lines) and an engine-line preview.
# usage: python3 scripts/screenshot.py [gameIndex] [ply]
import sys
from playwright.sync_api import sync_playwright
game = sys.argv[1] if len(sys.argv) > 1 else "0"
ply = sys.argv[2] if len(sys.argv) > 2 else "28"
import os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs") + os.sep
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 1400, "height": 1000})
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(f"http://localhost:3000/?game={game}&depth=14", wait_until="networkidle")
    pg.wait_for_selector("[data-testid=progress]", timeout=60000)
    print("progress:", pg.inner_text("[data-testid=progress]").replace("\n", " "))
    pg.wait_for_selector("[data-testid=overview]", timeout=240000)
    print(pg.inner_text("[data-testid=analysis-done]"))
    print("--- counts ---\n" + pg.inner_text("[data-testid=counts-table]"))
    print("--- phases ---\n" + pg.inner_text("[data-testid=phase-table]"))
    print("--- key moments ---\n" + pg.inner_text("[data-testid=key-moments]"))
    print("--- summary ---\n" + pg.inner_text("[data-testid=summary]"))
    pg.screenshot(path=OUT + "screenshot-overview.png", full_page=True)

    pg.click("[data-testid=start-review]")
    pg.wait_for_selector("[data-testid=move-list]")
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

    # Mobile width (same browser context, so the analysis comes from the localStorage cache)
    m = pg.context.new_page()
    m.set_viewport_size({"width": 390, "height": 844})
    m.on("pageerror", lambda e: errors.append("mobile: " + str(e)))
    m.goto(f"http://localhost:3000/?game={game}&depth=14", wait_until="networkidle")
    m.wait_for_selector("[data-testid=overview]", timeout=240000)
    m.click("[data-testid=start-review]")
    m.click(f'[data-ply="{ply}"]')
    m.wait_for_timeout(500)
    fid = m.locator("[data-line]").first.get_attribute("data-line")
    m.click(f'[data-line="{fid}"][data-step="3"]')
    m.wait_for_selector('[data-testid=line-explorer][data-state=open]')
    m.wait_for_timeout(500)
    box = m.locator("[data-testid=line-explorer]").bounding_box()
    print("mobile sheet box:", {k: round(v) for k, v in box.items()}, "| mini played board visible:", m.locator("[data-testid=explorer-played-mini]").is_visible())
    m.screenshot(path=OUT + "screenshot-overlay-mobile.png")
    m.keyboard.press("Escape")
    m.wait_for_selector("[data-testid=line-explorer]", state="detached", timeout=3000)
    print("mobile Esc closes: True")
    m.close()

    # Reduced motion: overlay opens/closes without transition delay
    rm = pg.context.new_page()
    rm.emulate_media(reduced_motion="reduce")
    rm.goto(f"http://localhost:3000/?game={game}&depth=14", wait_until="networkidle")
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
    print("page errors:", errors or "none")
    b.close()
