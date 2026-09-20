// wrangler.toml [[rules]] type = "Data" for *.woff2: the default export is
// the file's bytes as an ArrayBuffer. vitest.config.ts mirrors this.
declare module "*.woff2" {
  const content: ArrayBuffer;
  export default content;
}
// Wrangler's default module rules treat "*.txt" as a Text module: the
// default export is the file's raw contents as a string. This declaration
// makes the same import shape typecheck; vitest.config.ts teaches vitest the
// same convention so both toolchains agree on one import.
declare module "*.txt" {
  const content: string;
  export default content;
}
