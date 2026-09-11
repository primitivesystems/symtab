import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import DOMPurify from "dompurify";
import { ThemeProvider } from "@flux/shared-ui/components/theme-provider";
import ReadingView from "../src/editor/reading-view";

test("reading view renders the current note immediately, before effects or diagram loading", () => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const sanitize = DOMPurify.sanitize;
  // This test covers render timing, not sanitizer correctness; no browser DOM is needed.
  DOMPurify.sanitize = ((html: string) => html) as typeof sanitize;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement: { classList: { contains: () => false } } },
  });
  try {
    for (const value of ["First note", "Second note"]) {
      const html = renderToStaticMarkup(
        <ThemeProvider theme="light">
          <ReadingView value={value} documents={[]} />
        </ThemeProvider>
      );
      expect(html).toContain(`<p>${value}</p>`);
      expect(html).not.toContain(value === "First note" ? "Second note" : "First note");
    }
  } finally {
    DOMPurify.sanitize = sanitize;
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
