import { build } from "esbuild";

build({
  entryPoints: ["main.js"],
  bundle: true,
  minify: false,
  outfile: "../javascript/codemirror6.bundle.js",
  format: "iife",
  globalName: "CodeMirrorBundle",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
}).catch(() => process.exit(1));
