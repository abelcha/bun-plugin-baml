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

// model -> provider/base_url, so a raw model id can override the .baml-declared
// client at call time without needing a matching client<llm> block.
const PROVIDERS: Record<string, { provider: string; base_url?: string; envKey: string }> = {
  "gpt-": { provider: "openai", envKey: "OPENAI_API_KEY" },
  "claude-": { provider: "anthropic", envKey: "ANTHROPIC_API_KEY" },
  "gemini-": { provider: "google-ai", envKey: "GEMINI_API_KEY" },
  "grok-": { provider: "openai-generic", base_url: "https://api.x.ai/v1", envKey: "XAI_API_KEY" },
  "kimi-": { provider: "openai-generic", base_url: "https://api.moonshot.ai/v1", envKey: "MOONSHOT_API_KEY" },
  "moonshot-": { provider: "openai-generic", base_url: "https://api.moonshot.ai/v1", envKey: "MOONSHOT_API_KEY" },
  "glm-": { provider: "openai-generic", base_url: "https://api.z.ai/api/paas/v4", envKey: "Z_API_KEY" },
  "deepseek-": { provider: "openai-generic", base_url: "https://api.deepseek.com/v1", envKey: "DEEPSEEK_API_KEY" },
  "llama-": { provider: "openai-generic", base_url: "https://api.groq.com/openai/v1", envKey: "GROQ_API_KEY" },
  "minimax-": { provider: "openai-generic", base_url: "https://api.minimax.io/v1", envKey: "MINIMAX_API_KEY" },
};

function resolveProvider(model: string) {
  for (const [prefix, cfg] of Object.entries(PROVIDERS)) {
    if (model.toLowerCase().includes(prefix.toLowerCase())) return cfg;
  }
  return { provider: "openai-generic", envKey: "OPENAI_API_KEY" };
}

// A .baml import resolves to a Proxy: `b.SomeFunction(args, { model, verbose })` -> native call.
// Any property is treated as a baml function name, so no codegen / enumeration.
function makeClient(srcDir: string) {
  const call = async (name: string, args: Record<string, any>, opts?: { model?: string; verbose?: boolean }) => {
    const rt = await getRuntime(srcDir); // re-resolve in case sources changed (hot reload)
    const ctx = rt.createContextManager();
    let cr: any = null;
    if (opts?.model) {
      const { ClientRegistry } = require("@boundaryml/baml/native");
      const { provider, base_url, envKey } = resolveProvider(opts.model);
      cr = new ClientRegistry();
      cr.addLlmClient("__call_override", provider, {
        model: opts.model,
        base_url,
        api_key: process.env[envKey],
      });
      cr.setPrimary("__call_override");
    }
    let collectors: any[] = [];
    if (opts?.verbose) {
      const { Collector } = require("@boundaryml/baml/native");
      collectors = [new Collector(name)];
    }
    const result = await rt.callFunction(name, args ?? {}, ctx, null, cr, collectors, {}, process.env);
    if (opts?.verbose) {
      for (const log of collectors[0].logs) console.error(log.toString());
    }
    return result.parsed(false);
  };
  return new Proxy(
    {},
    {
      get: (_t, name: string) =>
        (args: Record<string, any>, opts?: { model?: string; verbose?: boolean }) => call(name, args, opts),
    },
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
