import { mkdir, writeFile } from "node:fs/promises"
import JSON5 from "json5"
import { exists, getFileName, getRelativePathFrom } from "./utility.ts"
import { Octokit } from "octokit"
import type { AnalysisContext } from "./context.ts"

const MOD_ALLOW_LIST: string[] | null = process.env.MOD_ALLOW_LIST
    ? process.env.MOD_ALLOW_LIST.split(',').map(s => s.trim())
    : null

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
})

export async function fetchAndLoadModsFromGitHub(ctx: AnalysisContext) {
    console.log('Fetching mods from GitHub...')
    
    const modCacheRootDir = `${process.cwd()}/mod-cache`

    /*
    Example data from mods.json:
    [
        {
        "authorDisplay": "Alek & friends",
        "name": "OWML",
        "repo": "amazingalek/owml",
        "required": true,
        "tags": [
            "library"
        ],
        "uniqueName": "Alek.OWML",
        "utility": true
        },
        // ...
    ]
    */

    // Load the official mod database mods list
    const modDB = await getGitHubJsonContent('ow-mods', 'ow-mod-db', 'mods.json')

    // Process each mod in the database

    for (const mod of modDB.mods) {
        try {
            if (MOD_ALLOW_LIST && !MOD_ALLOW_LIST.includes(mod.uniqueName)) {
                continue
            }
            if (!mod.repo) {
                console.log(`Skipping mod ${mod.uniqueName} with no repo`)
                continue
            }
            console.log(`Fetching mod ${mod.uniqueName} from repo ${mod.repo}`)
            const [owner, repo] = mod.repo.split('/')
            const defaultBranch = await getGitHubDefaultBranch(owner, repo)
            const fileTree = await getGitHubFileTree(owner, repo, defaultBranch)

            // First, we want to find the "manifest.json" file that contains the mod metadata and version number.
            const manifestPath = findSingleGitHubFileByName(fileTree, 'manifest.json', mod.uniqueName, mod.repo)
            if (!manifestPath) {
                console.log(`No manifest.json file found for mod ${mod.uniqueName} in repo ${mod.repo}`)
                continue
            }

            /*
            Example manifest.json content:
            {
                "$schema": "https://raw.githubusercontent.com/ow-mods/owml/master/schemas/manifest_schema.json",
                "filename": "QSB.dll",
                "author": "Nebula, John, Alek, & Rai",
                "name": "Quantum Space Buddies",
                "uniqueName": "Raicuparta.QuantumSpaceBuddies",
                "version": "1.5.0",
                "owmlVersion": "2.14.0",
                "dependencies": [ "JohnCorby.VanillaFix" ],
                "pathsToPreserve": [ "debugsettings.json" ],
                "conflicts": [
                    "Vesper.AutoResume",
                    "Vesper.OuterWildsMMO",
                    "_nebula.StopTime",
                    "PacificEngine.OW_CommonResources"
                ],
                "requireLatestVersion": true,
                "patcher": "QSBPatcher.exe",
                "donateLinks": [ "https://www.paypal.me/nebula2056", "https://www.paypal.me/johncorby" ]
            }
            */
            const manifest = await getGitHubJsonContent(owner, repo, manifestPath)

            // If we already have this version cached, skip further processing
            const version = manifest.version || '0.0.0'
            const modCacheDir = `${modCacheRootDir}/${mod.uniqueName}/${version}`
            if (await exists(modCacheDir)) {
                console.log(`Mod ${mod.uniqueName} version ${version} is already cached, skipping`)
                continue
            }

            // Cache the manifest file locally
            await mkdir(modCacheDir, { recursive: true })
            await writeFile(`${modCacheDir}/manifest.json`, JSON.stringify(manifest, null, 2))
            ctx.manifestConfigs[mod.uniqueName] = manifest
            // Also store latest manifest for the mod in the root so we can grab the latest version easily later
            const latestModCacheDir = `${modCacheRootDir}/${mod.uniqueName}`
            await mkdir(latestModCacheDir, { recursive: true })
            await writeFile(`${latestModCacheDir}/manifest.json`, JSON.stringify(manifest, null, 2))

            // Repeat the process for other common mod metadata files, if they exist:
            const metadataFileConfigs = [
                { name: 'title-screen.json', store: ctx.titleScreenConfigs },
                { name: 'addon-manifest.json', store: ctx.addonConfigs },
                { name: 'default-config.json', store: ctx.settingConfigs }
            ]
            
            for (const { name: metadataFileName, store } of metadataFileConfigs) {
                const metadataPath = findSingleGitHubFileByName(fileTree, metadataFileName, mod.uniqueName, mod.repo)
                if (!metadataPath) {
                    continue
                }
                const metadataContent = await getGitHubJsonContent(owner, repo, metadataPath)
                await saveMetadataFile(modCacheDir, metadataFileName, metadataContent, store, mod.uniqueName)
            }

            // Next, we grab and cache any planet configs (JSON files with a "planets" directory in the path)
            const planetConfigFiles = findFilesInGitHubDirectory(fileTree, 'planets/')
            await processGitHubConfigFiles(owner, repo, planetConfigFiles, 'planets/', modCacheDir, ctx.planetConfigs, mod.uniqueName)

            // Same with solar system configs (JSON files with "systems/" in the path)
            const systemConfigFiles = findFilesInGitHubDirectory(fileTree, 'systems/')
            await processGitHubConfigFiles(owner, repo, systemConfigFiles, 'systems/', modCacheDir, ctx.systemConfigs, mod.uniqueName)
        } catch (e) {
            console.log(`Error processing mod ${mod.uniqueName} from repo ${mod.repo}: ${e}`)
        }
    }
}

async function getGitHubDefaultBranch(owner: string, repo: string) {
    const res = await octokit.rest.repos.get({
        owner,
        repo,
    })
    if (res.status !== 200) {
        throw new Error(`Failed to get repo info for ${owner}/${repo}: ${res.status}`)
    }
    return res.data.default_branch
}

async function getGitHubFileTree(owner: string, repo: string, ref: string) {
    const res = await octokit.rest.git.getTree({
        owner,
        repo,
        tree_sha: ref,
        recursive: 'true',
    })
    if (res.status !== 200) {
        throw new Error(`Failed to get file tree for ${owner}/${repo}@${ref}: ${res.status}`)
    }
    return res.data.tree
}

async function getGitHubJsonContent(owner: string, repo: string, path: string) {
    const res = await octokit.rest.repos.getContent({ owner, repo, path })
    if (res.status !== 200) {
        throw new Error(`Failed to get content for ${owner}/${repo}/${path}: ${res.status}`)
    }
    if (!('content' in res.data)) {
        throw new Error(`Content for ${owner}/${repo}/${path} is not a file`)
    }
    const content = Buffer.from(res.data.content, 'base64').toString('utf-8')
    // Contents may be 'loose' JSON with comments and trailing commas, so we use a more forgiving superset parser
    try {
        return JSON5.parse(content)
    } catch (e) {
        throw new Error(`Failed to parse JSON content for ${owner}/${repo}/${path}: ${e}`)
    }
}


/**
 * Find files in a GitHub tree by exact file name (case-insensitive)
 */
function findGitHubFilesByName(tree: { type: string; path?: string }[], fileName: string): any[] {
    const lowerFileName = fileName.toLowerCase()
    return tree.filter(file => 
        file.type === 'blob' && 
        getFileName(file.path || '').toLowerCase() === lowerFileName
    )
}

/**
 * Find a single file in a GitHub tree by name, logging a warning if multiple copies exist
 */
function findSingleGitHubFileByName(
    tree: { type: string; path?: string }[],
    fileName: string,
    modUniqueName: string,
    repo: string
): string | null {
    let files = findGitHubFilesByName(tree, fileName)
    // HACK: Filter out Unity package manifests in a "Packages" folder which are also named manifest.json
    if (fileName.toLowerCase() === 'manifest.json') {
        files = files.filter(f => !(f.path || '').toLowerCase().includes('packages/'))
    }
    // HACK: Filter out build outputs in "bin/Debug" or "bin/Release" folders, no matter what filename we're looking for
    files = files.filter(f => {
        const lowerPath = (f.path || '').toLowerCase()
        return !(lowerPath.includes('/bin/debug/') || lowerPath.includes('/bin/release/'))
    })
    if (files.length === 0) {
        return null
    }
    if (files.length > 1) {
        const filePaths = files.map(f => f.path).join(', ')
        console.log(`Warning: multiple ${fileName} files found for mod ${modUniqueName} in repo ${repo}, using the first one found: ${filePaths}`)
    }
    return files[0].path
}

/**
 * Find files in a GitHub tree that are in a specific directory (e.g., 'planets/', 'systems/'),
 * including files in nested subdirectories. The GitHub tree is already flat and recursive.
 */
function findFilesInGitHubDirectory(tree: { type: string; path?: string }[], directoryName: string): any[] {
    const normalizedDir = directoryName.toLowerCase()
    return tree.filter(file => 
        file.type === 'blob' && 
        file.path?.toLowerCase().includes(normalizedDir) &&
        file.path.toLowerCase().endsWith('.json')
    )
}

/**
 * Save metadata file to cache and optionally to in-memory store
 */
async function saveMetadataFile(
    modCacheDir: string,
    fileName: string,
    content: any,
    inMemoryStore: Record<string, any>,
    modUniqueName: string
) {
    await writeFile(`${modCacheDir}/${fileName}`, JSON.stringify(content, null, 2))
    inMemoryStore[modUniqueName] = content
}

/**
 * Process config files from a specific directory (planets/ or systems/)
 */
async function processGitHubConfigFiles(
    owner: string,
    repo: string,
    configFiles: { path: string }[],
    directoryName: string,
    modCacheDir: string,
    configStore: Record<string, Record<string, any>>,
    modUniqueName: string
) {
    for (const configFile of configFiles) {
        const configPath = configFile.path!
        const configContent = await getGitHubJsonContent(owner, repo, configPath)
        
        // Save to mod cache, preserving directory structure
        const relativePath = getRelativePathFrom(configPath, directoryName)
        const savePath = `${modCacheDir}/${relativePath}`
        
        // Ensure directory exists
        const saveDir = savePath.substring(0, savePath.lastIndexOf('/'))
        await mkdir(saveDir, { recursive: true })
        await writeFile(savePath, JSON.stringify(configContent, null, 2))
        
        // Store in in-memory cache
        configStore[modUniqueName] = configStore[modUniqueName] || {}
        configStore[modUniqueName][relativePath] = configContent
    }
}
