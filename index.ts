import type { BunPlugin } from "bun";

// Walk up from a .baml file to the baml_src root (dir named baml_src, else the
// topmost ancestor still containing .baml files).
function findBamlSrc(file: string) {
  const glob = new Bun.Glob("*.baml");
  let dir = file.replace(/\/[^/]+$/, "");
  let candidate = dir;
  for (;;) {
    if (dir.split("/").pop() === "baml_src") return dir;
    const parent = dir.replace(/\/[^/]+$/, "");
    if (parent === dir) break;
    if (glob.scanSync({ cwd: parent }).next().done) break;
    candidate = dir = parent;
  }
  return candidate;
}

function bamlFiles(dir: string) {
  return [...new Bun.Glob("**/*.baml").scanSync({ cwd: dir, absolute: true })];
}

// Identity of the sources, so the runtime is rebuilt only when a .baml changes.
async function sourceHash(dir: string) {
  const h = new Bun.CryptoHasher("blake2b256");
  for (const f of bamlFiles(dir).sort()) {
    h.update(f);
    h.update(await Bun.file(f).bytes());
  }
  return h.digest("hex");
}

// One parsed runtime per baml_src, keyed by its source hash.
const cache = new Map<string, { hash: string; rt: any }>();

async function getRuntime(srcDir: string) {
  const hash = await sourceHash(srcDir);
  const hit = cache.get(srcDir);
  if (hit?.hash === hash) return hit.rt;

  // The native NAPI module — same Rust runtime the generated client uses.
  const { BamlRuntime } = require("@boundaryml/baml/native");
  const rt = BamlRuntime.fromDirectory(srcDir, process.env);
  cache.set(srcDir, { hash, rt });
  return rt;
}

// A .baml import resolves to a Proxy: `b.SomeFunction(args)` -> native call.
// Any property is treated as a baml function name, so no codegen / enumeration.
function makeClient(srcDir: string) {
  const call = async (name: string, args: Record<string, any>) => {
    const rt = await getRuntime(srcDir); // re-resolve in case sources changed (hot reload)
    const ctx = rt.createContextManager();
    const result = await rt.callFunction(name, args ?? {}, ctx, null, null, [], {}, process.env);
    return result.parsed(false);
  };
  return new Proxy(
    {},
    { get: (_t, name: string) => (args: Record<string, any>) => call(name, args) },
  );
}

const bamlPlugin: BunPlugin = {
  name: "baml",
  setup(build) {
    // Stash one client builder per baml_src on globalThis so the emitted module
    // can reach it without re-importing this plugin.
    const reg: Record<string, () => any> = ((globalThis as any).__baml ??= {});

    build.onLoad({ filter: /\.baml$/ }, (args) => {
      const srcDir = findBamlSrc(args.path);
      reg[srcDir] = () => makeClient(srcDir);
      return {
        contents:
          `const b = globalThis.__baml[${JSON.stringify(srcDir)}]();\n` +
          `export { b };\nexport default b;\n`,
        loader: "js",
      };
    });
  },
};

export default bamlPlugin;
