# Data

Three shelves. Each one is filled only from the one before it.

| Shelf | Folder | What lives there | In git? |
|---|---|---|---|
| 1 · Originals | `raw/` | Official PDFs exactly as downloaded, never edited, plus `manifest.json` recording where each came from, when, and its checksum | **No** |
| 2 · Read out | `extracted/` | What was read out of each PDF — questions, options, official answer, cross-check result — as JSON, one file per paper | **No** |
| 3 · Structure | `syllabus/` | Official chapter trees for each exam, each chapter linked to its NCERT chapter | Yes |

After checking, shelf 2 and 3 are loaded into the database, which is what the
product actually reads.

**Rule: open book, not closed book.** Everything here traces to an official
document. Gemini reads, sorts and tags those documents; it is never the source of
a fact.
