# bun-plugin-baml

Import `.baml` files directly in Bun — no `baml-cli generate`, no `baml_client`,
no codegen step. The plugin loads your `baml_src/` through
[BAML](https://docs.boundaryml.com)'s native Rust runtime in-process and hands
back a callable client.

```ts
import b from "./baml_src/main.baml";

const resume = await b.ExtractResume({ text: "Jane Doe, knows Rust and Bun" });
```

## How it works

`BunPlugin.onLoad` intercepts `*.baml` imports, walks up to the enclosing
`baml_src/` directory, and loads it with `BamlRuntime.fromDirectory(...)` from
`@boundaryml/baml`'s native module — the same runtime the official generated
client wraps. The imported module resolves to a `Proxy`: any property access
(`b.SomeFunction`) becomes a `callFunction` call into that runtime. Sources
are hashed, so the runtime is only rebuilt when a `.baml` file actually
changes (hot reload friendly).

No files are generated on disk and no subprocess is spawned.

## Install

```bash
bun add bun-plugin-baml @boundaryml/baml
```

## Setup

Register the plugin so plain `import` statements pick it up. Add a
`bunfig.toml` next to your entrypoint:

```toml
preload = ["bun-plugin-baml/preload"]
```

Then just import `.baml` files:

```ts
// baml_src/main.baml
// class Resume { name string, skills string[] }
// function ExtractResume(text: string) -> Resume { ... }

import b from "./baml_src/main.baml";

const resume = await b.ExtractResume({ text: "..." });
console.log(resume.name, resume.skills);
```

## Caveats

- The returned client is untyped (`any` via `Proxy`) — there's no `.d.ts`
  generation yet.
- This is a runtime plugin (via `preload`). For `bun build`, register the
  same plugin in your bundler config and keep `@boundaryml/baml` external.
- `@boundaryml/baml` is a required peer dependency — it owns the native
  runtime that actually parses and executes your BAML functions.

## Demo

See [`demo/`](./demo) for a runnable example (uses a Moonshot/Kimi
`openai-generic` client):

```bash
cd demo
bun install
MOONSHOT_API_KEY=sk-... bun main.ts
```
