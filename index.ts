import { analyzeModConfigs } from "./analysis.ts"
import { createAnalysisContext } from "./context.ts"
import { loadModsFromCache } from "./cache.ts"
import { fetchAndLoadModsFromGitHub } from "./github.ts"

const SKIP_LOCAL_CACHE = process.env.SKIP_LOCAL_CACHE === 'true' // Set to true to always fetch from GitHub and skip local cache
const LOCAL_CACHE_ONLY = process.env.LOCAL_CACHE_ONLY === 'true' // Set to true to skip GitHub fetching and only load from local cache
const EXTERNAL_CACHE = process.env.EXTERNAL_CACHE

const ctx = createAnalysisContext()

if (!SKIP_LOCAL_CACHE) {
    await loadModsFromCache(ctx, EXTERNAL_CACHE)
}
if (!LOCAL_CACHE_ONLY) {
    await fetchAndLoadModsFromGitHub(ctx)
}
await analyzeModConfigs(ctx)
