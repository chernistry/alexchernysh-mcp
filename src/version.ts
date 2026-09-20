import pkg from "../package.json" with { type: "json" };

/** Package version, kept out of the Worker entry module: workerd rejects non-handler named exports there. */
export const VERSION: string = pkg.version;
