import os from "node:os";
export function defaultConcurrency(): number {
  return Math.max(1, typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length);
}

export { mapLimit } from "../util/async.js";
