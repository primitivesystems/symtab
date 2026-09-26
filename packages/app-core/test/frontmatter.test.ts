import { expect, test } from "bun:test";
import { setFrontmatterProperty, splitFrontmatter } from "../src/editor/frontmatter";

test("keeps frontmatter out of the editor while preserving it in the file", () => {
  const file = "---\ntags: [symtab]\n---\n\n# Note";
  expect(splitFrontmatter(file).body).toBe("\n# Note");
  expect(setFrontmatterProperty(file, "status", "draft")).toBe(
    '---\ntags: [symtab]\nstatus: "draft"\n---\n\n# Note'
  );
});
