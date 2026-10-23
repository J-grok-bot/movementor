import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boardToPlacement,
  type BoardMap,
  cleanCastling,
  emptySetup,
  epCandidates,
  fenToSetup,
  gameEnd,
  gameEndText,
  setupToFen,
  START_FEN,
  startSetup,
  validateSetup,
  withBoard,
} from "../src/lib/position";

const setup = (fen: string) => fenToSetup(fen)!;

test("FEN round trip and start position", () => {
  assert.equal(setupToFen(startSetup()), START_FEN);
  assert.equal(boardToPlacement(setup("8/8/8/3k4/8/8/4K3/8 w - - 0 1").board), "8/8/8/3k4/8/8/4K3/8");
  assert.equal(fenToSetup("not a fen"), null);
  assert.equal(fenToSetup("8/8/8/8/8/8/8/9 w - - 0 1"), null);
  assert.deepEqual(validateSetup(startSetup()), []);
});

test("castling rights are cleared when the king or rook leaves home", () => {
  const s = startSetup();
  const noH1 = { ...s.board };
  delete noH1.h1;
  assert.deepEqual(cleanCastling(noH1, s.castling), { K: false, Q: true, k: true, q: true });
  const kingMoved: BoardMap = { ...s.board, f8: "bK" };
  delete kingMoved.e8;
  assert.deepEqual(withBoard(s, kingMoved).castling, { K: true, Q: true, k: false, q: false });
  // a pasted FEN can't claim impossible rights
  assert.equal(setupToFen(setup("4k3/8/8/8/8/8/8/R3K3 w KQkq - 0 1")).split(" ")[2], "Q");
  assert.equal(setupToFen(emptySetup()).split(" ")[2], "-");
});

test("en passant only when a pawn could just have double-stepped next to an enemy pawn", () => {
  const s = setup("4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1");
  assert.deepEqual(epCandidates(s.board, "w"), ["d6"]);
  assert.equal(setupToFen({ ...s, ep: "d6" }).split(" ")[3], "d6");
  assert.equal(setupToFen({ ...s, ep: "c6" }).split(" ")[3], "-");
  assert.deepEqual(epCandidates(s.board, "b"), []);
});

test("validation: kings, back-rank pawns, check on the side not to move, piece counts", () => {
  assert.match(validateSetup(emptySetup()).join(" "), /White needs a king.*Black needs a king/);
  assert.match(validateSetup(setup("4k3/8/8/8/8/8/8/4KK2 w - - 0 1")).join(" "), /White has 2 kings/);
  assert.match(validateSetup(setup("P3k3/8/8/8/8/8/8/4K2p w - - 0 1")).join(" "), /1st or 8th rank \(a8, h1\)/);
  // black king attacked by the rook while it's white to move -> illegal; fine when black is to move
  assert.match(validateSetup(setup("4k3/8/8/8/8/8/8/4RK2 w - - 0 1")).join(" "), /Black is in check but it's White's move/);
  assert.deepEqual(validateSetup(setup("4k3/8/8/8/8/8/8/4RK2 b - - 0 1")), []);
  assert.match(validateSetup(setup("4k3/8/8/8/8/PPPPPPPP/PPPPPPPP/4K3 w - - 0 1")).join(" "), /17 pieces.*16 pawns/);
  assert.match(validateSetup(setup("QQQQk3/8/8/8/8/8/PPPPPPPP/4K3 w - - 0 1")).join(" "), /too many promoted pieces/);
  assert.deepEqual(validateSetup(setup("8/8/8/7k/8/QQQQ4/PPPPP3/4K3 w - - 0 1")), []);
});

test("game end detection", () => {
  assert.equal(gameEndText(gameEnd("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1")!), "Checkmate, White wins");
  assert.equal(gameEndText(gameEnd("7k/8/6QK/8/8/8/8/8 b - - 0 1")!), "Stalemate (draw)");
  assert.equal(gameEnd(START_FEN), null);
});
