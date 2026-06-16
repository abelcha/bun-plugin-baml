// Import a .baml file directly — the plugin parses baml_src via the native
// runtime and hands back a callable client. No baml_client, no codegen step.
import b from "./baml_src/main.baml";

const text = `
  Jane Doe — jane@example.com
  Senior engineer. Rust, Bun, TypeScript, DuckDB.
`;

if (!process.env.MOONSHOT_API_KEY) {
  console.error("Set MOONSHOT_API_KEY to run the demo, e.g.\n  MOONSHOT_API_KEY=sk-... bun start");
  process.exit(1);
}

const resume = await b.ExtractResume({ text });
console.log(resume);
