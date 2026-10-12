"use client";
// Runs Stockfish (lite, single-threaded WASM) in a dedicated Web Worker.
// Single-threaded means no SharedArrayBuffer, so no COOP/COEP headers are required.
import { UciSearchParser, type EngineResult, type Evaluator } from "./analysis";

export const ENGINE_URL = "/stockfish/stockfish-19-lite-single.js";

export class BrowserEngine {
  private worker: Worker;
  private parser = new UciSearchParser();
  private pending: ((r: EngineResult) => void) | null = null;
  private readyWaiters: (() => void)[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  public name = "Stockfish";

  constructor(url = ENGINE_URL) {
    this.worker = new Worker(url);
    this.worker.onmessage = (e: MessageEvent) => this.onLine(String(e.data));
  }

  private onLine(line: string) {
    if (line.startsWith("id name ")) this.name = line.slice(8);
    if (line === "readyok") {
      this.readyWaiters.shift()?.();
      return;
    }
    const r = this.parser.feed(line);
    if (r && this.pending) {
      const p = this.pending;
      this.pending = null;
      p(r);
    }
  }

  async init(hashMb = 32, multiPv = 2) {
    this.worker.postMessage("uci");
    this.worker.postMessage(`setoption name Hash value ${hashMb}`);
    this.worker.postMessage(`setoption name MultiPV value ${multiPv}`);
    this.worker.postMessage("ucinewgame");
    await this.isReady();
  }

  isReady() {
    return new Promise<void>((res) => {
      this.readyWaiters.push(res);
      this.worker.postMessage("isready");
    });
  }

  setMultiPv(n: number) {
    this.worker.postMessage(`setoption name MultiPV value ${n}`);
    return this.isReady();
  }

  newGame() {
    this.worker.postMessage("ucinewgame");
    return this.isReady();
  }

  /** Searches are serialized: one position at a time. */
  evaluate: Evaluator = (fen, depth) => {
    const run = () =>
      new Promise<EngineResult>((res) => {
        this.pending = res;
        this.worker.postMessage(`position fen ${fen}`);
        this.worker.postMessage(`go depth ${depth}`);
      });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  };

  stop() {
    this.worker.postMessage("stop");
  }

  terminate() {
    this.worker.terminate();
  }
}
