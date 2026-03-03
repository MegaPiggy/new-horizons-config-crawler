import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import type { AnalysisContext } from "./context.ts"
import JSON5 from "json5"
import { getRelativePathFrom } from "./utility.ts"

export async function loadModsFromCache(ctx: AnalysisContext, externalRootDir?: string) {
    const modSource = externalRootDir ? 'external' : 'local'
    console.log(`Loading mods from ${modSource} cache...`)
    
    const modCacheRootDir = externalRootDir ?? `${process.cwd()}/mod-cache`
    // Only create the local cache root; external roots should not be created/modified
    if (!externalRootDir) await mkdir(modCacheRootDir, { recursive: true })

    // Loop through mod-cache directory and load all cached mod metadata files into in-memory caches
    const modUniqueNames = await readdir(modCacheRootDir)
    for (const modFolderUniqueName of modUniqueNames) {
        // Read the latest manifest file to get the version
        const latestManifestPath = `${modCacheRootDir}/${modFolderUniqueName}/manifest.json`
        let manifest: any
        try {
            manifest = await getLocalJsonContent(latestManifestPath)
        } catch (err: any) {
            // If manifest is missing or unreadable, log and continue to next mod
            console.error(`Failed to load manifest for '${modFolderUniqueName}' at '${latestManifestPath}': ${err?.message ?? err}`)
            continue
        }
        const modUniqueName = manifest.uniqueName || modFolderUniqueName
        ctx.manifestConfigs[modUniqueName] = manifest
        const version = manifest.version || '0.0.0'
        // If reading from an external root, mods are expected to be stored without a version subfolder
        const modDir = externalRootDir
            ? `${modCacheRootDir}/${modUniqueName}`
            : `${modCacheRootDir}/${modUniqueName}/${version}`
        if (!externalRootDir) await mkdir(modDir, { recursive: true })

        // Load metadata files if they exist
        await loadMetadataFile(modDir, 'title-screen.json', ctx.titleScreenConfigs, modUniqueName)
        await loadMetadataFile(modDir, 'addon-manifest.json', ctx.addonConfigs, modUniqueName)
        await loadMetadataFile(modDir, 'default-config.json', ctx.settingConfigs, modUniqueName)
        
        // Load planet and system configs
        await loadLocalConfigDirectory(modDir, 'planets', modUniqueName, ctx.planetConfigs)
        await loadLocalConfigDirectory(modDir, 'systems', modUniqueName, ctx.systemConfigs)
    }
}

/**
 * Load config files from a specific directory on local file system, including nested subdirectories
 */
async function loadLocalConfigDirectory(
    modDir: string,
    directoryName: string,
    modUniqueName: string,
    configStore: Record<string, Record<string, any>>
) {
    configStore[modUniqueName] = {}
    try {
        const configDir = `${modDir}/${directoryName}`
        await loadConfigFilesRecursively(configDir, directoryName, modUniqueName, configStore)
    } catch {}
}

/**
 * Recursively scan a directory and load all JSON files, preserving directory structure
 */
async function loadConfigFilesRecursively(
    dirPath: string,
    relativeFrom: string,
    modUniqueName: string,
    configStore: Record<string, Record<string, any>>
) {
    const files = await readdir(dirPath, { withFileTypes: true })
    for (const file of files) {
        const fullPath = `${dirPath}/${file.name}`
        if (file.isDirectory()) {
            // Recursively scan subdirectories
            await loadConfigFilesRecursively(fullPath, relativeFrom, modUniqueName, configStore)
        } else if (file.isFile() && file.name.toLowerCase().endsWith('.json')) {
            // Load JSON files and compute relative path from the config type directory
            const content = await getLocalJsonContent(fullPath)
            // If this is a system config and it doesn't specify a name, use the file name (no extension)
            if (relativeFrom.toLowerCase() === 'systems') {
                const hasName = typeof content?.name === 'string' && content.name.length > 0
                if (!hasName) {
                    const fileBase = file.name.replace(/\.[^/.]+$/, '')
                    content.name = fileBase
                }
            }
            const relativePath = getRelativePathFrom(fullPath.replace(/\\/g, '/'), relativeFrom)
            configStore[modUniqueName][relativePath] = content
        }
    }
}

/**
 * Load metadata file from cache into in-memory store if it exists
 */
async function loadMetadataFile(
    modDir: string,
    fileName: string,
    inMemoryStore: Record<string, any>,
    modUniqueName: string
) {
    try {
        const filePath = `${modDir}/${fileName}`
        const content = await getLocalJsonContent(filePath)
        inMemoryStore[modUniqueName] = content
    } catch {}
}

/** Load a JSON file from the local file system and parse it using JSON5 */
async function getLocalJsonContent(filePath: string) {
    const data = await readFile(filePath, 'utf-8')
    return JSON5.parse(data)
}
