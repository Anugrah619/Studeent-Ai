import { useMemo } from "react";
import katex from "katex";
// Registers \ce{} and \pu{} on the same KaTeX instance. ~34 kB minified, and
// chemistry is a third of every paper, so it is always on.
import "katex/contrib/mhchem";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";

export type MathSegment =
  | { kind: "text"; value: string }
  | { kind: "math"; value: string; display: boolean };

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

/**
 * Split a string into plain text and TeX.
 *
 * Delimiters: `$$…$$` and `\[…\]` (display), `$…$` and `\(…\)` (inline), and
 * `\$` for a literal dollar. A single `$` only opens maths when the next
 * character is not a space, and only closes it when the previous character is
 * not a space and the next is not a digit — pandoc's rule — and only if that
 * closing `$` is the very next one. So prose like "costs $5 and $10" stays
 * prose. An unmatched delimiter is just text.
 */
export function parseMath(input: string): MathSegment[] {
  const out: MathSegment[] = [];
  let text = "";
  let i = 0;

  const pushText = () => {
    if (text) out.push({ kind: "text", value: text });
    text = "";
  };
  const pushMath = (value: string, display: boolean) => {
    pushText();
    out.push({ kind: "math", value, display });
  };

  while (i < input.length) {
    const c = input[i];
    const next = input[i + 1];

    if (c === "\\" && next === "$") {
      text += "$";
      i += 2;
      continue;
    }

    if (c === "\\" && (next === "(" || next === "[")) {
      const close = next === "(" ? "\\)" : "\\]";
      const end = input.indexOf(close, i + 2);
      if (end > i + 2) {
        pushMath(input.slice(i + 2, end), next === "[");
        i = end + 2;
        continue;
      }
    }

    if (c === "$" && next === "$") {
      const end = input.indexOf("$$", i + 2);
      if (end > i + 2) {
        pushMath(input.slice(i + 2, end), true);
        i = end + 2;
        continue;
      }
      text += "$$";
      i += 2;
      continue;
    }

    if (c === "$" && !isSpace(next)) {
      // The FIRST unescaped `$` decides. If it cannot close, this `$` was
      // never maths — scanning on past it is how "$5 and $10 … $x$" turns a
      // sentence of prose into one broken formula.
      let j = i + 1;
      let end = -1;
      while (j < input.length) {
        if (input[j] === "\\") {
          j += 2;
          continue;
        }
        if (input[j] === "$") {
          if (!isSpace(input[j - 1]) && !isDigit(input[j + 1])) end = j;
          break;
        }
        j += 1;
      }
      if (end > i + 1) {
        pushMath(input.slice(i + 1, end), false);
        i = end + 1;
        continue;
      }
    }

    text += c;
    i += 1;
  }

  pushText();
  return out;
}

function renderTeX(tex: string, display: boolean): string {
  return katex.renderToString(tex, {
    displayMode: display,
    // A malformed formula renders as its own source, in muted ink, rather than
    // throwing or shouting in KaTeX's default red — red means "critical" here.
    throwOnError: false,
    errorColor: "var(--muted-foreground)",
    // No \href, \includegraphics or raw HTML from a question's text.
    trust: false,
    // Question text mixes Unicode (°, ×, Devanagari) into maths; that is not
    // an error worth a console warning per render.
    strict: "ignore",
    output: "htmlAndMathml",
  });
}

interface MathTextProps {
  /** A string that may contain TeX. Anything else renders as plain text. */
  children: string | null | undefined;
  as?: "span" | "p" | "div";
  className?: string;
}

/**
 * Text with inline and display maths, typeset by KaTeX.
 *
 * Only KaTeX's own output is injected as HTML; every character outside a
 * formula goes through React as text, so a question stem cannot smuggle
 * markup in. KaTeX also emits MathML alongside, which screen readers read.
 */
export function MathText({ children, as = "span", className }: MathTextProps) {
  const segments = useMemo(() => parseMath(children ?? ""), [children]);
  const Component = as;

  return (
    <Component data-math="" className={className}>
      {segments.map((segment, index) =>
        segment.kind === "text" ? (
          segment.value
        ) : (
          <span
            key={index}
            className={cn(
              segment.display && "my-2 block overflow-x-auto overflow-y-hidden",
            )}
            dangerouslySetInnerHTML={{ __html: renderTeX(segment.value, segment.display) }}
          />
        ),
      )}
    </Component>
  );
}
