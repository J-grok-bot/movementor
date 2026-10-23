"use client";
// Position editor board: react-chessboard with spare pieces (drag from the palette, drag between squares,
// drag off the board / onto the trash to remove) plus tap-to-place for touch screens.
import { useRef } from "react";
import { ChessboardProvider, Chessboard, SparePiece } from "react-chessboard";
import { PIECES, type BoardMap, type PieceCode } from "@/lib/position";

export type Tool = PieceCode | "erase" | null;
const NAMES: Record<string, string> = { K: "king", Q: "queen", R: "rook", B: "bishop", N: "knight", P: "pawn" };

export function EditorBoard({
  board,
  orientation,
  tool,
  selected,
  onBoard,
  onTool,
  onSelect,
}: {
  board: BoardMap;
  orientation: "white" | "black";
  tool: Tool;
  selected: string | null; // square picked for a tap-tap move (no tool active)
  onBoard: (b: BoardMap) => void;
  onTool: (t: Tool) => void;
  onSelect: (sq: string | null) => void;
}) {
  // react-chessboard memoises its drag-end handler, so route drops through a ref to always see the latest board
  const latest = useRef({ board, tool, selected, onBoard, onTool, onSelect });
  latest.current = { board, tool, selected, onBoard, onTool, onSelect };

  // Palette taps: handled with pointer events because the drag sensor can swallow the click on touch screens
  const down = useRef<{ x: number; y: number } | null>(null);
  const tapHandlers = (p: PieceCode) => ({
    onPointerDownCapture: (e: React.PointerEvent) => {
      down.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUpCapture: (e: React.PointerEvent) => {
      const d = down.current;
      down.current = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) return; // that was a drag
      onTool(tool === p ? null : p);
    },
  });

  const position = Object.fromEntries(Object.entries(board).map(([sq, p]) => [sq, { pieceType: p! }]));
  const squareStyles: Record<string, React.CSSProperties> = {};
  if (selected) squareStyles[selected] = { backgroundColor: "rgba(59, 130, 246, 0.55)" };

  const options = {
    id: "editor-board",
    position,
    boardOrientation: orientation,
    allowDragOffBoard: true,
    animationDurationInMs: 0,
    squareStyles,
    darkSquareStyle: { backgroundColor: "#769656" },
    lightSquareStyle: { backgroundColor: "#eeeed2" },
    onPieceDrop: ({ piece, sourceSquare, targetSquare }: { piece: { isSparePiece: boolean; pieceType: string }; sourceSquare: string; targetSquare: string | null }) => {
      const { board: b, onBoard: set, onSelect: sel } = latest.current;
      sel(null);
      const next = { ...b };
      if (piece.isSparePiece) {
        if (!targetSquare) return false;
        next[targetSquare] = piece.pieceType as PieceCode;
      } else {
        if (targetSquare === sourceSquare) return false;
        delete next[sourceSquare]; // dropped off the board or on the trash = removed
        if (targetSquare) next[targetSquare] = piece.pieceType as PieceCode;
      }
      set(next);
      return true;
    },
    onSquareClick: ({ square }: { square: string }) => {
      const { board: b, tool: t, selected: s, onBoard: set, onSelect: sel } = latest.current;
      const next = { ...b };
      if (t === "erase") delete next[square];
      else if (t) {
        if (next[square] === t) delete next[square];
        else next[square] = t;
      } else {
        // no tool: tap a piece, then tap a square to move it there
        if (s && s !== square) {
          next[square] = next[s]!;
          delete next[s];
          sel(null);
        } else {
          sel(!s && next[square] ? square : null);
          return;
        }
      }
      set(next);
    },
  };

  return (
    <ChessboardProvider options={options}>
      <div className="relative" data-testid="editor-board">
        <Chessboard />
      </div>
      <div className="mt-2 rounded-lg bg-zinc-900 p-2" data-testid="palette">
        {(["w", "b"] as const).map((c) => (
          <div key={c} className="grid grid-cols-7 gap-1">
            {PIECES.filter((p) => p[0] === c).map((p) => (
              <div
                key={p}
                data-testid={`palette-${p}`}
                data-active={tool === p}
                {...tapHandlers(p)}
                title={`${c === "w" ? "White" : "Black"} ${NAMES[p[1]]}: drag onto the board, or tap then tap squares`}
                className={`aspect-square rounded-md p-0.5 ${tool === p ? "bg-sky-500/40 ring-2 ring-sky-400" : "hover:bg-zinc-800"}`}
              >
                <SparePiece pieceType={p} />
              </div>
            ))}
            {c === "w" ? (
              <button
                onClick={() => onTool(tool === "erase" ? null : "erase")}
                data-testid="tool-erase"
                data-active={tool === "erase"}
                title="Eraser: tap squares to remove pieces"
                className={`flex aspect-square items-center justify-center rounded-md text-xl ${tool === "erase" ? "bg-sky-500/40 ring-2 ring-sky-400" : "bg-zinc-800 hover:bg-zinc-700"}`}
                aria-label="Eraser"
              >
                ⌫
              </button>
            ) : (
              <TrashTarget />
            )}
          </div>
        ))}
        <p className="mt-1 min-h-4 text-center text-[11px] text-zinc-500" data-testid="palette-hint">
          {tool === "erase"
            ? "Eraser on: tap pieces to remove them."
            : tool
              ? `Tap squares to place the ${tool[0] === "w" ? "white" : "black"} ${NAMES[tool[1]]} (tap it again to remove).`
              : "Drag pieces onto the board, or tap one here and then tap squares. Drag off the board to remove."}
        </p>
      </div>
    </ChessboardProvider>
  );
}

/** Drop target outside the board: anything dropped here (or anywhere off the board) is removed. */
function TrashTarget() {
  return (
    <div
      data-testid="trash"
      title="Drag a piece here (or anywhere off the board) to remove it"
      className="flex aspect-square items-center justify-center rounded-md border border-dashed border-zinc-600 text-xl text-zinc-400"
      aria-label="Trash"
    >
      🗑
    </div>
  );
}
