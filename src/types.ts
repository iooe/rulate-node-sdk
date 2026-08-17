export type UnknownRecord = Record<string, unknown>;

export interface Person {
  id: number | null;
  name: string;
  url: string | null;
  role: string | null;
  scope: "chapter" | "project" | "catalog";
}

export interface ImageAsset {
  url: string;
  type: "poster" | "cover" | "illustration" | "other";
  alt: string | null;
  title: string | null;
  sourceAttribute: "src" | "data-src" | "data-lazy-src" | "data-original" | "srcset";
}

export interface RatingValue { value: number | null; percent: number | null; votes: number; }

export interface ChapterDescriptor {
  id: number;
  bookId: number;
  title: string;
  number: string | null;
  url: string;
  xhrUrl: string;
  publishedAt: string | null;
  paid: boolean | null;
  available: boolean;
  rawHtml: string;
}

export interface CatalogBook {
  id: number;
  url: string;
  title: string;
  originalTitle: string | null;
  description: string | null;
  poster: ImageAsset | null;
  translator: Person | null;
  genres: string[];
  tags: string[];
  status: string | null;
  lastActivityAt: string | null;
  chapters: { total: number | null; paid: number | null };
  rating: RatingValue;
  translationRating: RatingValue;
  likes: number | null;
  rawHtml: string;
}

export interface CatalogPage {
  page: number;
  totalPages: number | null;
  hasNextPage: boolean;
  items: CatalogBook[];
  sourceUrl: string;
  rawHtml: string;
  fetchedAt: string;
}

export interface CatalogQuery {
  page?: number;
  text?: string;
  sort?: string;
  category?: number;
  genres?: number[];
  tags?: number[];
  fandoms?: number[];
  signal?: AbortSignal;
  refresh?: boolean;
}

export interface RulateBook {
  id: number;
  url: string;
  title: string;
  originalTitle: string | null;
  description: { rawHtml: string; formattedHtml: string; text: string };
  poster: ImageAsset | null;
  images: ImageAsset[];
  authors: Person[];
  translators: Person[];
  genres: string[];
  tags: string[];
  fandoms: string[];
  status: string | null;
  translationStatus: string | null;
  rating: RatingValue;
  translationRating: RatingValue;
  likes: number | null;
  thanks: number | null;
  views: number | null;
  chapters: ChapterDescriptor[];
  chapterStats: { total: number; paid: number | null };
  rawPageHtml: string;
  fetchedAt: string;
}

export interface ChapterContent {
  id: number;
  bookId: number;
  title: string;
  sourceUrl: string;
  xhrUrl: string;
  publishedAt: string | null;
  translators: Person[];
  images: ImageAsset[];
  rawHtml: string;
  formattedHtml: string;
  text: string;
  pageHtml: string | null;
  rawResponse: unknown;
  fetchedAt: string;
}

export interface RequestOptions { signal?: AbortSignal; refresh?: boolean; }
export interface ChapterOptions extends RequestOptions { includePageHtml?: boolean; includeTranslators?: boolean; }
export interface BatchOptions extends ChapterOptions { concurrency?: number; continueOnError?: boolean; }
export interface BatchResult { descriptor: ChapterDescriptor; chapter: ChapterContent | null; error: Error | null; }

export interface ClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxConcurrency?: number;
  minRequestIntervalMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  metadataCacheTtlMs?: number;
  chapterCacheTtlMs?: number;
  cookie?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  userAgent?: string;
}
