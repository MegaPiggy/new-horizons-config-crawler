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
    const lowerDir = `/${directoryName.toLowerCase()}/`
    const index = lowerPath.indexOf(lowerDir)
    if (index === -1) {
        throw new Error(`Directory '${directoryName}' not found in path '${fullPath}'`)
    }
    return normalized.substring(index)
}
