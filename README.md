# @iooe/rulate-sdk

Production-oriented TypeScript SDK for public or account-authorized `tl.rulate.ru` catalog, book metadata and chapter content.

## Included

- Catalog iteration and search with pagination.
- Book metadata, descriptions, ratings, status, genres, tags, fandoms, posters and image sets.
- Chapter IDs, titles, dates, access hints and translators.
- `rawHtml`: exact chapter fragment from the source response, without DOM reserialization.
- `formattedHtml`: safe content-only HTML preserving paragraphs, emphasis, headings, lists, quotes, tables, links and illustrations.
- Optional complete `pageHtml`.
- Images from `src`, `data-src`, `data-lazy-src`, `data-original` and `srcset`.
- Reused HTTP connections through Node fetch, bounded concurrency, start-rate control, retries with `Retry-After`, jittered backoff, timeouts, response limits, duplicate-request coalescing and TTL cache.
- Ordered batches and completion-order async streams.
- Optional user-owned cookie. The SDK does not bypass authentication or purchases.

```ts
import { RulateClient } from "@iooe/rulate-sdk";
const client = new RulateClient({ maxConcurrency: 12, minRequestIntervalMs: 80 });
const book = await client.getBook(201009);
const chapter = await client.getChapter(book.id, book.chapters[0]!);
console.log(chapter.rawHtml, chapter.formattedHtml, chapter.translators, chapter.images);
```

Use one client per import process and limits agreed with the source operator.
