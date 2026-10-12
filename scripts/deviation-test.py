# Browser check for the one-board review: blue engine-line previews, amber user deviations, live eval,
# truncation, Resume/Esc, no page jumps. Desktop Chromium + 390x844 WebKit iPhone emulation.
# usage: python3 scripts/deviation-test.py [baseUrl] [gameIndex] [ply]
import sys, os, re, json, subprocess, time
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
GAME = int(sys.argv[2]) if len(sys.argv) > 2 else 5
PLY = int(sys.argv[3]) if len(sys.argv) > 3 else 28
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "docs") + os.sep
COL = "[data-testid=game-board-column]"
BOARD = "[data-testid=review-board]"

def legal(fen):
    js = "const {Chess}=require('chess.js');const c=new Chess(process.argv[1]);console.log(JSON.stringify(c.moves({verbose:true}).map(m=>({uci:m.from+m.to+(m.promotion||''),san:m.san,promo:!!m.promotion}))))"
    return json.loads(subprocess.check_output(["node", "-e", js, fen], cwd=ROOT))

def pick(fen, avoid, n=0):
    ms = [m for m in legal(fen) if m["uci"] not in avoid and not m["promo"]]
    quiet = [m for m in ms if "x" not in m["san"] and "+" not in m["san"]] or ms
    return quiet[min(n, len(quiet) - 1)]

JUMPS = []
def tap_move(m, uci, mobile):
    m.locator(f'{BOARD} [data-square="{uci[:2]}"]').scroll_into_view_if_needed(); m.wait_for_timeout(150)
    before = m.evaluate("scrollY")
    for sq in (uci[:2], uci[2:4]):
        el = m.locator(f'{BOARD} [data-square="{sq}"]')
        el.tap() if mobile else el.click()
        m.wait_for_timeout(120)
    m.wait_for_timeout(400)
    JUMPS.append(m.evaluate("scrollY") - before)

def state(m):
    b = m.locator("[data-testid=deviation-banner]")
    return {"hue": m.get_attribute(COL, "data-hue"), "ply": int(m.get_attribute(COL, "data-ply")),
            "banner": b.inner_text().replace("\n", " ") if b.count() else None,
            "step": b.get_attribute("data-step") if b.count() else None, "len": b.get_attribute("data-len") if b.count() else None}

def wait_live(m, min_depth=10, timeout=90):
    t0 = time.time(); seen = []
    while time.time() - t0 < timeout:
        d = m.locator("[data-testid=live-depth]")
        txt = d.inner_text() if d.count() else ""
        g = re.search(r"depth (\d+)", txt)
        if g and (not seen or seen[-1] != int(g.group(1))): seen.append(int(g.group(1)))
        if g and int(g.group(1)) >= min_depth:
            best = m.locator("[data-testid=live-best]")
            return f"eval {m.inner_text('[data-testid=live-eval-chip]')} best {best.inner_text() if best.count() else '-'} (depths seen {seen})"
        m.wait_for_timeout(60)
    return "TIMEOUT"

def step_next(m, mobile):
    if mobile: m.tap("[data-testid=nav-next]")
    else: m.keyboard.press("ArrowRight")
    m.wait_for_timeout(250)

def step_prev(m, mobile):
    if mobile: m.tap("[data-testid=nav-prev]")
    else: m.keyboard.press("ArrowLeft")
    m.wait_for_timeout(250)

def run(m, mobile, label, shots):
    errs = []
    m.on("pageerror", lambda e: errs.append(str(e)))
    m.goto(BASE + "/?user=Killer5291", wait_until="networkidle")
    m.wait_for_selector("button[data-game-id]", timeout=60000)
    card = m.locator("button[data-game-id]").nth(GAME)
    card.tap() if mobile else card.click()
    m.wait_for_selector("[data-testid=start-review]", timeout=240000)
    m.click("[data-testid=start-review]")
    m.click(f'[data-ply="{PLY}"]'); m.wait_for_timeout(300)
    print(f"[{label}] on game:", state(m))
    # 1) engine-line preview -> blue, steps on the main board
    m.locator("[data-testid=engine-lines] button", has_text="Preview").first.click(); m.wait_for_timeout(400)
    s1 = state(m); step_next(m, mobile); s2 = state(m)
    print(f"[{label}] Preview -> {s1['hue']} | {s1['banner']} | next -> step {s2['step']}/{s2['len']}")
    if shots.get("blue"): m.locator(COL).scroll_into_view_if_needed(); m.wait_for_timeout(500); m.screenshot(path=shots["blue"])
    m.click("[data-testid=resume]"); m.wait_for_timeout(300)
    print(f"[{label}] Resume ->", state(m), f"(deviation started at the position before ply {PLY})")
    m.click(f'[data-ply="{PLY}"]'); m.wait_for_timeout(300)
    # 2) the actual next game move just advances
    nxt = m.get_attribute(f'[data-ply="{PLY + 1}"]', "data-uci")
    tap_move(m, nxt, mobile)
    print(f"[{label}] played the real game move {nxt} ->", state(m))
    m.click(f'[data-ply="{PLY}"]'); m.wait_for_timeout(300)
    # 3) another move mid-review -> amber + live eval
    fen = m.get_attribute(COL, "data-fen")
    a = pick(fen, {nxt}); tap_move(m, a["uci"], mobile)
    print(f"[{label}] user move {a['san']} ->", state(m), "|", wait_live(m, 14))
    b = pick(m.get_attribute(COL, "data-fen"), set()); tap_move(m, b["uci"], mobile)
    print(f"[{label}] then {b['san']} ->", state(m)["banner"], "|", wait_live(m, 10))
    c = pick(m.get_attribute(COL, "data-fen"), set()); tap_move(m, c["uci"], mobile)
    s3 = state(m)
    # step back twice, play a different move: the rest is replaced
    step_prev(m, mobile); step_prev(m, mobile)
    fen1 = m.get_attribute(COL, "data-fen")
    d = pick(fen1, {b["uci"]}, 1); tap_move(m, d["uci"], mobile)
    s4 = state(m)
    print(f"[{label}] line {s3['step']}/{s3['len']} -> back 2, play {d['san']} -> {s4['step']}/{s4['len']} | {s4['banner']} | {wait_live(m, 10)}")
    if shots.get("amber"): m.locator(COL).scroll_into_view_if_needed(); m.wait_for_timeout(500); m.screenshot(path=shots["amber"])
    # 4) Preview of the live line continues in blue on the same board
    m.click("[data-testid=live-preview]"); m.wait_for_timeout(300)
    s5 = state(m); print(f"[{label}] live Preview -> {s5['hue']} | {s5['banner']}")
    # 5) Resume returns to the deviation-start game move
    (m.click("[data-testid=resume]") if not mobile else m.tap("[data-testid=resume]")); m.wait_for_timeout(300)
    print(f"[{label}] Resume ->", state(m))
    # 6) move mid-preview -> amber; Esc resumes
    m.locator("[data-testid=engine-lines] button", has_text="Preview").first.click(); m.wait_for_timeout(300)
    lf = m.get_attribute(COL, "data-fen"); e = pick(lf, set(), 2); tap_move(m, e["uci"], mobile)
    print(f"[{label}] move {e['san']} mid-preview ->", state(m), "|", wait_live(m, 10))
    m.keyboard.press("Escape"); m.wait_for_timeout(300)
    print(f"[{label}] Esc ->", state(m))
    print(f"[{label}] window scroll change per board move: {JUMPS} | errors: {errs or 'none'}")
    JUMPS.clear()

with sync_playwright() as p:
    br = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    m = br.new_page(viewport={"width": 1400, "height": 1000})
    run(m, False, "desktop", {"blue": OUT + "screenshot-deviation-blue.png", "amber": OUT + "screenshot-deviation-amber.png"})
    br.close()
    w = p.webkit.launch()
    dev = dict(p.devices["iPhone 13"]); dev.pop("default_browser_type"); dev["viewport"] = {"width": 390, "height": 844}
    m = w.new_context(**dev).new_page()
    run(m, True, "mobile", {"amber": "/tmp/deviation-mobile-amber.png", "blue": "/tmp/deviation-mobile-blue.png"})
    w.close()
