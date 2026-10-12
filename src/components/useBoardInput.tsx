"use client";
import { useEffect, useMemo, useState } from "react";
import { legalMove, legalTargets, needsPromotion, type UserMove } from "@/lib/sandbox";

const PROMO = [
  ["q", "♛", "Queen"],
  ["r", "♜", "Rook"],
  ["b", "♝", "Bishop"],
  ["n", "♞", "Knight"],
] as const;

/**
 * Drag-and-drop + tap-tap move input for a react-chessboard board, legal moves only, with a promotion picker.
 * `onMove` receives a legal move; render `picker` inside a `relative` wrapper around the board.
 */
export function useBoardInput(fen: string, enabled: boolean, onMove: (m: UserMove) => void) {
  const [selected, setSelected] = useState<string | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  useEffect(() => {
    setSelected(null);
    setPromo(null);
  }, [fen, enabled]);
  const turn = fen.split(" ")[1];

  const attempt = (from: string, to: string): boolean => {
    if (needsPromotion(fen, from, to)) {
      setPromo({ from, to });
      return false;
    }
    if (!legalMove(fen, { from, to })) return false;
    onMove({ from, to });
    return true;
  };

  const handlers = {
    canDragPiece: ({ piece }: { piece: { pieceType: string } }) => enabled && piece.pieceType[0] === turn,
    onPieceDrop: ({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) => {
      setSelected(null);
      if (!enabled || !targetSquare || targetSquare === sourceSquare) return false;
      attempt(sourceSquare, targetSquare);
      return false; // the parent re-renders the position itself
    },
    onSquareClick: ({ square, piece }: { square: string; piece: { pieceType: string } | null }) => {
      if (!enabled) return;
      if (selected && selected !== square && legalTargets(fen, selected).includes(square)) {
        setSelected(null);
        attempt(selected, square);
        return;
      }
      setSelected(piece && piece.pieceType[0] === turn && selected !== square ? square : null);
    },
  };

  const styles = useMemo(() => {
    const st: Record<string, React.CSSProperties> = {};
    if (!selected) return st;
    st[selected] = { backgroundColor: "rgba(59, 130, 246, 0.55)" };
    for (const t of legalTargets(fen, selected)) st[t] = { background: "radial-gradient(circle, rgba(15,23,42,.45) 22%, transparent 24%)" };
    return st;
  }, [selected, fen]);

  const picker = promo ? (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50" data-testid="promotion-picker">
      <div className="rounded-xl bg-zinc-900 p-3 shadow-2xl ring-1 ring-zinc-700">
        <div className="mb-2 text-center text-xs text-zinc-300">Promote to</div>
        <div className="flex gap-2">
          {PROMO.map(([p, sym, label]) => (
            <button
              key={p}
              onClick={() => {
                setPromo(null);
                onMove({ ...promo, promotion: p });
              }}
              className={`h-12 w-12 rounded-lg bg-zinc-100 text-3xl leading-none hover:bg-white ${turn === "w" ? "text-zinc-50 [text-shadow:0_0_2px_#000,0_0_1px_#000]" : "text-zinc-900"}`}
              aria-label={label}
              data-promo={p}
            >
              {sym}
            </button>
          ))}
        </div>
        <button onClick={() => setPromo(null)} className="mt-2 w-full text-xs text-zinc-400 underline">
          Cancel
        </button>
      </div>
    </div>
  ) : null;

  return { handlers, styles, picker, selected };
}
