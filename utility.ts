import { access } from "node:fs/promises"

/** Check if a local file or directory exists */
export async function exists(path: string): Promise<boolean> {
    try {
        await access(path)
        return true
    } catch {
        return false
    }
}

/**
 * Get the file name from a path (handles both forward and backward slashes)
 */
export function getFileName(path: string): string {
    const normalized = path.replace(/\\/g, '/')
    return normalized.substring(normalized.lastIndexOf('/') + 1)
}

/**
 * Extract the relative path starting from a specific directory name
 */
export function getRelativePathFrom(fullPath: string, directoryName: string): string {
    const normalized = fullPath.replace(/\\/g, '/')
    const lowerPath = normalized.toLowerCase()
    // Normalize directoryName by removing leading/trailing slashes
    const dir = directoryName.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase()
    const pattern = `/${dir}/`
    let index = lowerPath.indexOf(pattern)
    // If not found, maybe the path starts with the directory without a leading slash
    if (index === -1 && lowerPath.startsWith(`${dir}/`)) {
        index = 0
    }
    if (index === -1) {
        throw new Error(`Directory '${directoryName}' not found in path '${fullPath}'`)
    }
    // Return relative path without a leading slash
    return index === 0 ? normalized.substring(0) : normalized.substring(index + 1)
}
