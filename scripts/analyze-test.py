# Position calculator (/analyze): clear board, drag + tap placement, drag-off removal, validation errors,
# persistence, Calculate (best move arrow + SAN, 3 lines, mate score), play best move, checkmate/stalemate,
# back to editor, nav fit, no overflow / scroll jumps. Desktop + iPhone 13 emulation (touch drag via CDP).
# Writes docs/screenshot-analyze-editor.png and docs/screenshot-analyze-result.png (mobile).
# usage: python3 scripts/analyze-test.py [baseUrl]
import sys, os
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs") + os.sep
fails = []
def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: fails.append(msg)

A = "[data-testid=analyze]"
def attr(m, name): return m.get_attribute(A, name)
def placement(m): return attr(m, "data-fen").split()[0]
def center(m, sel):
    b = m.locator(sel).first.bounding_box()
    return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
def sq(s): return f"[data-testid=editor-board] [data-square={s}]"

def drag(m, src, dst, mobile, cdp=None):
    (x0, y0), (x1, y1) = center(m, src), center(m, dst) if isinstance(dst, str) else dst
    if mobile:
        pt = lambda x, y: [{"x": x, "y": y, "id": 1, "radiusX": 2, "radiusY": 2, "force": 1}]
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": pt(x0, y0)})
        for i in range(1, 13):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": pt(x0 + (x1 - x0) * i / 12, y0 + (y1 - y0) * i / 12)})
            m.wait_for_timeout(16)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    else:
        m.mouse.move(x0, y0); m.mouse.down()
        for i in range(1, 13): m.mouse.move(x0 + (x1 - x0) * i / 12, y0 + (y1 - y0) * i / 12); m.wait_for_timeout(16)
        m.mouse.up()
    m.wait_for_timeout(150)

def tap(m, sel, mobile):
    el = m.locator(sel).first
    el.tap() if mobile else el.click()
    m.wait_for_timeout(80)

def run(m, mobile, label):
    errs = []; m.on("pageerror", lambda e: errs.append(str(e)))
    cdp = m.context.new_cdp_session(m) if mobile else None
    m.goto(BASE + "/analyze", wait_until="networkidle")
    m.evaluate("localStorage.removeItem('movementor-analyze')"); m.reload(wait_until="networkidle")
    m.wait_for_selector(sq("e1"))
    check(attr(m, "data-fen").startswith("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq"), f"[{label}] opens on the starting position")
    check(m.is_enabled("[data-testid=calculate]"), f"[{label}] Calculate enabled for the start position")
    # nav: four tabs fit on every page
    for path in ["/", "/openings", "/puzzles", "/analyze"]:
        if path != "/analyze": m.goto(BASE + path, wait_until="networkidle")
        r = m.evaluate("(() => { const n = document.querySelector('[data-testid=nav-analyze]').getBoundingClientRect(); return [n.right, innerWidth, document.documentElement.scrollWidth] })()")
        check(r[0] <= r[1] and r[2] <= r[1], f"[{label}] 4 nav tabs fit on {path} (Analyze right edge {r[0]:.0f} <= {r[1]})")
    m.goto(BASE + "/analyze", wait_until="networkidle"); m.wait_for_selector(sq("e1"))
    check(m.get_attribute("[data-testid=nav-analyze]", "aria-current") == "page" or "bg-zinc-700" in (m.get_attribute("[data-testid=nav-analyze]", "class") or ""), f"[{label}] Analyze tab active")

    # clear board
    tap(m, "[data-testid=clear-board]", mobile)
    check(placement(m) == "8/8/8/8/8/8/8/8", f"[{label}] Clear board empties it")
    check(not m.is_enabled("[data-testid=calculate]") and "needs a king" in m.inner_text("[data-testid=validation]"), f"[{label}] empty board: 'needs a king' error, Calculate disabled")
    # drag a white king from the palette
    drag(m, "[data-testid=palette-wK]", sq("g6"), mobile, cdp)
    check(placement(m) == "8/8/6K1/8/8/8/8/8", f"[{label}] drag palette wK -> g6 ({placement(m)})")
    # tap-to-place a black king; same piece again removes it; again places it
    tap(m, "[data-testid=palette-bK]", mobile)
    check(m.get_attribute("[data-testid=palette-bK]", "data-active") == "true", f"[{label}] tap selects palette bK")
    tap(m, sq("h8"), mobile)
    check(placement(m) == "7k/8/6K1/8/8/8/8/8", f"[{label}] tap h8 places bK ({placement(m)})")
    tap(m, sq("h8"), mobile)
    check(placement(m) == "8/8/6K1/8/8/8/8/8", f"[{label}] tap h8 again with bK removes it")
    tap(m, sq("h8"), mobile)
    tap(m, "[data-testid=palette-bK]", mobile)  # deselect tool
    check(m.get_attribute("[data-testid=palette-bK]", "data-active") == "false", f"[{label}] tap palette bK again deselects")
    drag(m, "[data-testid=palette-wQ]", sq("d1"), mobile, cdp)
    check(placement(m) == "7k/8/6K1/8/8/8/8/3Q4", f"[{label}] drag palette wQ -> d1 ({placement(m)})")
    check(m.is_enabled("[data-testid=calculate]"), f"[{label}] K+Q vs K valid, Calculate enabled")
    # validation error: pawn on the 1st rank
    tap(m, "[data-testid=palette-bP]", mobile); tap(m, sq("a1"), mobile); tap(m, "[data-testid=palette-bP]", mobile)
    check("1st or 8th rank" in m.inner_text("[data-testid=validation]") and not m.is_enabled("[data-testid=calculate]"), f"[{label}] pawn on a1 -> error, Calculate disabled")
    # board-to-board drag, then drag off the board (onto the trash) to remove
    drag(m, sq("a1"), sq("a4"), mobile, cdp)
    check(placement(m) == "7k/8/6K1/8/p7/8/8/3Q4", f"[{label}] drag a1 -> a4 moves the pawn ({placement(m)})")
    drag(m, sq("a4"), "[data-testid=trash]", mobile, cdp)
    check(placement(m) == "7k/8/6K1/8/8/8/8/3Q4", f"[{label}] drag to trash / off board removes it ({placement(m)})")
    # black in check with White to move
    tap(m, "[data-testid=palette-wR]", mobile); tap(m, sq("h1"), mobile); tap(m, "[data-testid=palette-wR]", mobile)
    check("in check" in m.inner_text("[data-testid=validation]") and not m.is_enabled("[data-testid=calculate]"), f"[{label}] side not to move in check -> error")
    tap(m, "[data-testid=tool-erase]", mobile); tap(m, sq("h1"), mobile); tap(m, "[data-testid=tool-erase]", mobile)
    check(placement(m) == "7k/8/6K1/8/8/8/8/3Q4" and m.is_enabled("[data-testid=calculate]"), f"[{label}] eraser removes h1, valid again")
    # persistence
    m.reload(wait_until="networkidle"); m.wait_for_selector(sq("e1"))
    check(placement(m) == "7k/8/6K1/8/8/8/8/3Q4", f"[{label}] position persists across reload")
    if mobile: m.screenshot(path=OUT + "screenshot-analyze-editor.png")

    # calculate: no scroll jump when lines deepen
    m.evaluate("window.scrollTo(0, 60)"); m.wait_for_timeout(100)
    y0 = m.evaluate("scrollY")
    tap(m, "[data-testid=calculate]", mobile)
    m.wait_for_selector(f"{A}[data-mode=calc]"); m.wait_for_timeout(150)
    check(m.evaluate("document.querySelector('[data-testid=calc-board]').getBoundingClientRect().top") >= 0, f"[{label}] board in view after Calculate")
    y0 = m.evaluate("scrollY")
    top0 = m.evaluate("document.querySelector('[data-testid=calc-board]').getBoundingClientRect().top")
    m.wait_for_function("document.querySelector('[data-testid=best-san]')?.textContent.includes('Qd8')", timeout=20000)
    m.wait_for_function("document.querySelectorAll('[data-testid=calc-line]').length === 3", timeout=20000)
    m.wait_for_timeout(1500)
    check("M1" in m.inner_text("[data-testid=calc-eval]"), f"[{label}] eval shows mate in 1 ({m.inner_text('[data-testid=calc-eval]')})")
    check(m.get_attribute("[data-testid=best-arrow]", "data-uci") == "d1d8", f"[{label}] best-move arrow d1->d8")
    check(m.locator("[data-testid=calc-board] svg line, [data-testid=calc-board] svg path").count() > 0 or m.locator("[data-testid=calc-board] [data-arrow], [data-testid=calc-board] svg").count() > 0, f"[{label}] arrow drawn")
    check(m.evaluate("scrollY") == y0 and abs(m.evaluate("document.querySelector('[data-testid=calc-board]').getBoundingClientRect().top") - top0) < 1, f"[{label}] no scroll jump while engine deepens (scrollY {y0}->{m.evaluate('scrollY')}, board top {top0:.0f}->{m.evaluate("document.querySelector('[data-testid=calc-board]').getBoundingClientRect().top"):.0f}, doc h {m.evaluate('document.documentElement.scrollHeight')})")
    if mobile: m.screenshot(path=OUT + "screenshot-analyze-result-mate.png")
    # play best -> checkmate
    tap(m, "[data-testid=play-best]", mobile)
    m.wait_for_selector("[data-testid=game-end]")
    check("Checkmate, White wins" in m.inner_text("[data-testid=game-end]"), f"[{label}] Play best move -> 'Checkmate, White wins'")
    check(not m.is_enabled("[data-testid=play-best]"), f"[{label}] Play best disabled at game over")
    tap(m, "[data-testid=undo]", mobile)
    m.wait_for_selector("[data-testid=best-san]")
    # user move on the board (tap-tap), then reset
    b = m.locator("[data-testid=calc-board] [data-square=d1]").first; b.tap() if mobile else b.click(); m.wait_for_timeout(80)
    b = m.locator("[data-testid=calc-board] [data-square=d5]").first; b.tap() if mobile else b.click(); m.wait_for_timeout(150)
    check(attr(m, "data-fen").startswith("7k/8/6K1/3Q4/8/8/8/8 b"), f"[{label}] free play: Qd5 by tap-tap ({attr(m, 'data-fen')})")
    check("Qd5" in m.inner_text("[data-testid=played-moves]"), f"[{label}] played move listed")
    tap(m, "[data-testid=reset-setup]", mobile)
    check(attr(m, "data-fen").startswith("7k/8/6K1/8/8/8/8/3Q4 w"), f"[{label}] Reset to setup")
    tap(m, "[data-testid=back-to-editor]", mobile)
    m.wait_for_selector(f"{A}[data-mode=edit]")
    check(placement(m) == "7k/8/6K1/8/8/8/8/3Q4", f"[{label}] Back to editor keeps the setup")
    # stalemate via FEN paste
    m.fill("[data-testid=fen-input]", "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"); tap(m, "[data-testid=fen-load]", mobile)
    check(attr(m, "data-fen").startswith("7k/5Q2/6K1/8/8/8/8/8 b"), f"[{label}] FEN paste + Load")
    tap(m, "[data-testid=calculate]", mobile)
    m.wait_for_selector("[data-testid=game-end]")
    check("Stalemate" in m.inner_text("[data-testid=game-end]"), f"[{label}] stalemate handled")
    tap(m, "[data-testid=back-to-editor]", mobile)
    # castling auto-clear: start position, move h1 rook away -> K right cleared, checkbox disabled
    tap(m, "[data-testid=start-position]", mobile)
    check(m.is_checked("[data-testid=castle-K]"), f"[{label}] start position has castling K")
    drag(m, sq("h1"), sq("h4"), mobile, cdp)
    check(not m.is_checked("[data-testid=castle-K]") and m.is_disabled("[data-testid=castle-K]") and " w Qkq " in attr(m, "data-fen"), f"[{label}] moving the h1 rook clears + disables White O-O ({attr(m, 'data-fen')})")
    # deep link
    m.goto(BASE + "/analyze?fen=" + "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R%20b%20KQkq%20-%203%203", wait_until="networkidle")
    m.wait_for_selector(sq("e1"))
    check(attr(m, "data-fen").startswith("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq"), f"[{label}] ?fen= deep link loads")
    check(attr(m, "data-orientation") == "black", f"[{label}] deep link with Black to move flips the board")
    if mobile:
        tap(m, "[data-testid=calculate]", mobile)
        m.wait_for_function("document.querySelectorAll('[data-testid=calc-line]').length === 3", timeout=20000)
        m.wait_for_function("(document.querySelector('[data-testid=calc-eval]')?.textContent || '').includes('d14') || (document.querySelector('[data-testid=calc-eval]')?.textContent || '').includes('d18') || (document.querySelector('[data-testid=calc-eval]')?.textContent || '').includes('d20')", timeout=30000)
        m.evaluate("window.scrollTo(0, 0)"); m.wait_for_timeout(300)
        m.screenshot(path=OUT + "screenshot-analyze-result.png")
    check(m.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"[{label}] no horizontal overflow")
    check(not errs, f"[{label}] no page errors {errs[:2]}")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    run(b.new_context(viewport={"width": 1280, "height": 900}).new_page(), False, "desktop")
    dev = {k: v for k, v in p.devices["iPhone 13"].items() if k != "default_browser_type"}
    run(b.new_context(**dev).new_page(), True, "mobile 390x844")
    b.close()
print("RESULT:", "PASS" if not fails else f"FAIL ({len(fails)})")
sys.exit(1 if fails else 0)
