import { useId, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { MyTopic } from "@/api/types";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { uniq } from "./lib";
import { SubjectLabel } from "./ui";

/**
 * Pick one chapter of your syllabus: a search box over the list, grouped by
 * subject and then by unit, in teaching order.
 *
 * Native radio buttons underneath, so it works with a keyboard, a screen
 * reader and a phone's own focus handling with nothing to manage; the list
 * scrolls inside itself so a 70-chapter NEET syllabus does not push the rest of
 * the form off the screen.
 */
export function ChapterPicker({
  topics,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  topics: MyTopic[];
  value: number | null;
  onChange: (id: number) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const name = useId();

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? topics.filter((t) =>
          `${t.name} ${t.unit} ${t.subject}`.toLowerCase().includes(needle),
        )
      : topics;
    return uniq(matching.map((t) => t.subject)).map((subject) => {
      const inSubject = matching.filter((t) => t.subject === subject);
      return {
        subject,
        units: uniq(inSubject.map((t) => t.unit)).map((unit) => ({
          unit,
          chapters: inSubject.filter((t) => t.unit === unit),
        })),
      };
    });
  }, [topics, query]);

  const chosen = topics.find((t) => t.id === value);

  return (
    <div>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {chosen ? (
          <>
            Chosen: <span className="font-medium text-foreground">{chosen.name}</span>, {chosen.subject}
          </>
        ) : (
          "No chapter chosen yet."
        )}
      </p>

      <div className="relative mt-2">
        <label htmlFor={searchId} className="sr-only">
          Search chapters
        </label>
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={searchId}
          type="search"
          placeholder="Search chapters"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
          autoComplete="off"
        />
      </div>

      <div
        className={cn(
          "mt-2 max-h-80 overflow-y-auto rounded-md border bg-card",
          invalid ? "border-foreground/60" : "border-border",
        )}
        aria-describedby={describedBy}
      >
        {groups.length ? (
          groups.map((group) => (
            <fieldset key={group.subject} className="border-b border-border last:border-b-0">
              <legend className="sr-only">{group.subject}</legend>
              <p
                aria-hidden
                className="sticky top-0 z-10 bg-card/95 px-3 pt-2.5 pb-1 text-sm font-semibold text-foreground backdrop-blur"
              >
                <SubjectLabel subject={group.subject} />
              </p>
              {group.units.map((unit) => (
                <div key={unit.unit} className="pb-1.5">
                  {unit.unit && unit.unit !== unit.chapters[0]?.name ? (
                    <p className="px-3 pt-1 pb-0.5 text-xs text-muted-foreground">{unit.unit}</p>
                  ) : null}
                  {unit.chapters.map((chapter) => (
                    <label
                      key={chapter.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 px-3 py-2 text-sm leading-snug hover:bg-muted/60",
                        value === chapter.id && "bg-brand-soft",
                      )}
                    >
                      <input
                        type="radio"
                        name={name}
                        value={chapter.id}
                        checked={value === chapter.id}
                        onChange={() => onChange(chapter.id)}
                        className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
                        data-chapter-id={chapter.id}
                      />
                      <span className="text-foreground">{chapter.name}</span>
                    </label>
                  ))}
                </div>
              ))}
            </fieldset>
          ))
        ) : (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            No chapter matches &ldquo;{query}&rdquo;. Try part of its name.
          </p>
        )}
      </div>
    </div>
  );
}
