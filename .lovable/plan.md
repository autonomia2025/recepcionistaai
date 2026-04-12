

# Fix: Web Scraping Timeout (504)

## Problem
The `scrape-website` function times out (504) after ~150 seconds. Here's why:
- **Crawling**: 200 pages takes ~120 seconds
- **AI Processing**: 41 chunks × ~20 seconds each = ~820 seconds needed
- **Edge function limit**: ~150 seconds max

The function successfully crawls 200 pages and collects 4.3MB of text, but then dies trying to process 41 AI chunks sequentially.

## Solution: Skip AI summarization, store cleaned text directly as RAG chunks

The AI summarization step is unnecessary and wasteful. The `process-rag-document` function already splits text into chunks for RAG. We're essentially doing double work: AI summarizes → then we chunk the summary. Instead, we should chunk the cleaned HTML text directly.

### Changes to `supabase/functions/scrape-website/index.ts`

1. **Reduce max pages to 50** (still comprehensive, but keeps crawl under 60 seconds)
2. **Remove ALL AI processing** — no more Gemini calls in scrape-website
3. **Send cleaned text directly to `process-rag-document`** as `plain_text`
4. **Add page URL as prefix to each page's text** so the bot knows where info came from
5. **Cap total text to ~500K chars** to avoid oversized payloads

The flow becomes:
```text
Crawl 50 pages (~30-40s) → Clean HTML → Send to process-rag-document (~30-40s)
Total: ~60-80 seconds (well within timeout)
```

### Changes to `src/components/bot/WebImporter.tsx`

- Increase the fetch timeout on the client side to 120 seconds (currently uses default ~30s which also causes issues)
- Better loading state messaging

### Why this works better

- The raw product pages already contain product names, specs, prices — the AI summarization was actually *losing* detail by condensing 4.3MB into ~17K chars
- RAG search works on chunks anyway, so having more granular chunks from raw text is actually better for retrieval
- 50 pages is plenty for most commercial sites (covers all product/category pages)
- Total execution stays well under the 150s timeout

### Files to modify
- `supabase/functions/scrape-website/index.ts` — simplify to crawl + clean + forward
- `src/components/bot/WebImporter.tsx` — increase timeout, improve UX

