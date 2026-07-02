import path from "path";

import workerpool from "workerpool";

export interface AsyncEncoder {
  encode(text: string): Promise<number[]>;
  decode(tokens: number[]): Promise<string>;
  close(): Promise<void>;
}

const TOKENIZER_WORKER_POOL_OPTIONS = {
  // Indexing can submit hundreds of chunks at once. workerpool otherwise uses
  // every available core, which starves VS Code's renderer and makes agent/chat
  // controls appear unclickable on large or decompiled workspaces.
  minWorkers: 1,
  maxWorkers: 1,
} as const;

export class LlamaAsyncEncoder implements AsyncEncoder {
  private workerPool: workerpool.Pool;

  constructor() {
    this.workerPool = workerpool.pool(
      workerCodeFilePath("llamaTokenizerWorkerPool.mjs"),
      TOKENIZER_WORKER_POOL_OPTIONS,
    );
  }

  async encode(text: string): Promise<number[]> {
    return this.workerPool.exec("encode", [text]);
  }

  async decode(tokens: number[]): Promise<string> {
    return this.workerPool.exec("decode", [tokens]);
  }

  // TODO: this should be called somewhere before exit or potentially with a shutdown hook
  public async close(): Promise<void> {
    await this.workerPool.terminate();
  }
}

// this class does not yet do anything asynchronous
export class GPTAsyncEncoder implements AsyncEncoder {
  private workerPool: workerpool.Pool;

  constructor() {
    this.workerPool = workerpool.pool(
      workerCodeFilePath("tiktokenWorkerPool.mjs"),
      TOKENIZER_WORKER_POOL_OPTIONS,
    );
  }

  async encode(text: string): Promise<number[]> {
    return this.workerPool.exec("encode", [text]);
  }

  async decode(tokens: number[]): Promise<string> {
    return this.workerPool.exec("decode", [tokens]);
  }

  // TODO: this should be called somewhere before exit or potentially with a shutdown hook
  public async close(): Promise<void> {
    await this.workerPool.terminate();
  }
}

function workerCodeFilePath(workerFileName: string): string {
  if (process.env.NODE_ENV === "test") {
    // `cross-env` seems to make it so __dirname is the root of the project and not the directory containing this file
    return path.join(__dirname, "llm", workerFileName);
  }
  return path.join(__dirname, workerFileName);
}
