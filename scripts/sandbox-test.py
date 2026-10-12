# Browser check for "Your analysis" sandbox moves in the review (desktop Chromium + 390x844 WebKit iPhone).
# usage: python3 scripts/sandbox-test.py [baseUrl] [gameIndex] [ply]
import sys, os, re, json, subprocess, time
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
GAME = int(sys.argv[2]) if len(sys.argv) > 2 else 5
PLY = int(sys.argv[3]) if len(sys.argv) > 3 else 28
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "docs") + os.sep

def legal(fen):
    js = "const {Chess}=require('chess.js');const c=new Chess(process.argv[1]);console.log(JSON.stringify(c.moves({verbose:true}).map(m=>({uci:m.from+m.to+(m.promotion||''),san:m.san,promo:!!m.promotion}))))"
    return json.loads(subprocess.check_output(["node", "-e", js, fen], cwd=ROOT))

def pick(fen, avoid):
    ms = [m for m in legal(fen) if m["uci"] not in avoid and not m["promo"]]
    quiet = [m for m in ms if "x" not in m["san"] and "+" not in m["san"]]
    return (quiet or ms)[0]

JUMPS = []
def tap_move(m, scope, uci, mobile):
    # Bring the board into view first so the harness itself doesn't scroll, then measure the app's effect.
    m.locator(f'{scope} [data-square="{uci[:2]}"]').scroll_into_view_if_needed(); m.wait_for_timeout(150)
    before = m.evaluate("scrollY")
    for sq in (uci[:2], uci[2:4]):
        el = m.locator(f'{scope} [data-square="{sq}"]')
        el.tap() if mobile else el.click()
        m.wait_for_timeout(120)
    m.wait_for_timeout(400)
    JUMPS.append(m.evaluate("scrollY") - before)

def wait_eval(m, min_depth=10, timeout=60):
    t0 = time.time(); seen = []
    while time.time() - t0 < timeout:
        txt = m.locator("[data-testid=live-eval]").inner_text() if m.locator("[data-testid=live-eval]").count() else ""
        d = re.search(r"depth (\d+)", txt)
        if d and (not seen or seen[-1] != int(d.group(1))): seen.append(int(d.group(1)))
        if d and int(d.group(1)) >= min_depth: return f"depths seen {seen}: " + txt.replace("\n", " | ")
        m.wait_for_timeout(60)
    return "TIMEOUT " + txt

def run(m, mobile, label, shot=None):
    errs = []
    m.on("pageerror", lambda e: errs.append(str(e)))
    m.goto(BASE + "/?user=Killer5291", wait_until="networkidle")
    m.wait_for_selector("button[data-game-id]", timeout=60000)
    card = m.locator("button[data-game-id]").nth(GAME)
    card.tap() if mobile else card.click()
    m.wait_for_selector("[data-testid=start-review]", timeout=240000)
    m.click("[data-testid=start-review]")
    m.click(f'[data-ply="{PLY}"]'); m.wait_for_timeout(300)
    board = "[data-testid=game-board-column]"
    nxt = m.get_attribute(f'[data-ply="{PLY + 1}"]', "data-uci")
    y0 = m.evaluate("scrollY")
    # 1) the actual game move just advances the game
    tap_move(m, board, nxt, mobile); m.wait_for_timeout(300)
    adv = m.inner_text("[data-testid=move-detail]").split("\n")[0:2]
    print(f"[{label}] played the game move {nxt}: review now at", " ".join(adv), "| explorer open:", m.locator("[data-testid=line-explorer]").count() > 0)
    m.click(f'[data-ply="{PLY}"]'); m.wait_for_timeout(300)
    # 2) any other legal move opens the sandbox with a live eval
    fen = m.get_attribute(board, "data-fen")
    mv = pick(fen, {nxt})
    tap_move(m, board, mv["uci"], mobile)
    m.wait_for_selector('[data-testid=line-explorer][data-state=open]', timeout=5000)
    print(f"[{label}] user move {mv['san']} -> overlay:", m.inner_text("[data-testid=explorer-title]"), "| step", m.inner_text("[data-testid=explorer-step]"))
    first = wait_eval(m, 18, 90)
    deep = first
    print(f"[{label}]   live eval: first '{first}' -> deeper '{deep}' | chip", m.inner_text("[data-testid=explorer-eval]"))
    print(f"[{label}]   game board still frozen at played position:", m.get_attribute(board, "data-frozen"), m.get_attribute(board, "data-fen") == fen)
    # 3) continue the variation on the overlay board
    xb = "[data-testid=explorer-board]"
    xfen = m.get_attribute(xb, "data-fen")
    mv2 = pick(xfen, set())
    tap_move(m, xb, mv2["uci"], mobile)
    m.wait_for_timeout(300)
    print(f"[{label}]   continued with {mv2['san']}: step", m.inner_text("[data-testid=explorer-step]"), "| strip:", m.inner_text("[data-testid=explorer-strip]").replace("\n", " "))
    print(f"[{label}]   eval for new position: '{wait_eval(m, 10, 60)}'")
    if shot:
        m.wait_for_timeout(500); m.screenshot(path=shot)
    m.click("[data-testid=sandbox-undo]"); m.wait_for_timeout(300)
    print(f"[{label}]   undo -> step", m.inner_text("[data-testid=explorer-step]"))
    m.keyboard.press("Escape")
    m.wait_for_selector("[data-testid=line-explorer]", state="detached", timeout=3000)
    print(f"[{label}]   Esc -> back to game, review at", m.inner_text("[data-testid=move-detail]").split("\n")[0])
    # 4) mid-preview: branch off an engine line
    m.locator("[data-testid=engine-lines] button", has_text="Preview").first.click()
    m.wait_for_selector('[data-testid=line-explorer][data-state=open]'); m.wait_for_timeout(400)
    title0 = m.inner_text("[data-testid=explorer-title]")
    xfen = m.get_attribute(xb, "data-fen")
    mv3 = pick(xfen, set())
    tap_move(m, xb, mv3["uci"], mobile); m.wait_for_timeout(400)
    print(f"[{label}] mid-preview ({title0}) user move {mv3['san']} ->", m.inner_text("[data-testid=explorer-title]"), "| step", m.inner_text("[data-testid=explorer-step]"))
    print(f"[{label}]   eval: '{wait_eval(m, 10, 60)}'")
    m.click("[data-testid=explorer-close]")
    m.wait_for_selector("[data-testid=line-explorer]", state="detached", timeout=3000)
    print(f"[{label}] window scroll change caused by each board move: {JUMPS}", "| errors:", errs or "none")
    JUMPS.clear()

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    m = b.new_page(viewport={"width": 1400, "height": 1000})
    run(m, False, "desktop", OUT + "screenshot-sandbox.png")
    b.close()
    w = p.webkit.launch()
    dev = dict(p.devices["iPhone 13"]); dev.pop("default_browser_type"); dev["viewport"] = {"width": 390, "height": 844}
    m = w.new_context(**dev).new_page()
    run(m, True, "mobile", "/tmp/sandbox-mobile.png")
    w.close()
