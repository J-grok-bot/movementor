export function Footer() {
  return (
    <footer className="mt-8 space-y-1 text-xs text-zinc-500" data-testid="footer">
      <p>
        <strong className="text-zinc-400">Not affiliated with Chess.com.</strong> Game data comes from the public Chess.com
        Published-Data API.
      </p>
      <p>
        MoveMentor is free software (GPL-3.0):{" "}
        <a className="underline" href="https://github.com/J-grok-bot/movementor" target="_blank" rel="noreferrer">
          source code
        </a>
        . Analysis by{" "}
        <a className="underline" href="https://stockfishchess.org" target="_blank" rel="noreferrer">
          Stockfish
        </a>{" "}
        via{" "}
        <a className="underline" href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noreferrer">
          stockfish.js
        </a>{" "}
        (GPLv3,{" "}
        <a className="underline" href="/stockfish/COPYING-GPLv3.txt">
          license
        </a>
        ,{" "}
        <a className="underline" href="https://github.com/official-stockfish/Stockfish" target="_blank" rel="noreferrer">
          engine source
        </a>
        ). Opening names from{" "}
        <a className="underline" href="https://github.com/lichess-org/chess-openings" target="_blank" rel="noreferrer">
          lichess-org/chess-openings
        </a>{" "}
        (CC0). Daily puzzles from the{" "}
        <a className="underline" href="https://database.lichess.org/#puzzles" target="_blank" rel="noreferrer">
          Lichess puzzle database
        </a>{" "}
        (CC0).
      </p>
    </footer>
  );
}
