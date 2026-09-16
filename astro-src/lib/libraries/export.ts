// astro-src/lib/libraries/export.ts
//
// R7 LP.6: Library export to JSON.
//
// Export library data as JSON with metadata.

/** Library data structure. */
export interface LibraryData {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  paperCount?: number;
  [key: string]: unknown;
}

/** Export document structure. */
export interface LibraryExport {
  schemaVersion: string;
  exportedAt: string;
  library: LibraryData;
}

/**
 * Export a library to JSON-safe object.
 *
 * @param library - Library data to export
 * @returns Export document with metadata
 */
export function libraryToJson(library: LibraryData): LibraryExport {
  return {
    schemaVersion: '1.0.0',
    exportedAt: new Date().toISOString(),
    library: {
      ...library,
    },
  };
}

/**
 * Serialize library export to JSON string.
 *
 * @param library - Library data to export
 * @param pretty - Whether to pretty-print (default: true)
 * @returns JSON string
 */
export function libraryToJsonString(
  library: LibraryData,
  pretty = true
): string {
  const exportDoc = libraryToJson(library);
  return JSON.stringify(exportDoc, null, pretty ? 2 : 0);
}

/**
 * Parse a library export JSON string.
 *
 * @param jsonString - JSON string to parse
 * @returns Library data or null if invalid
 */
export function parseLibraryExport(jsonString: string): LibraryData | null {
  try {
    const parsed = JSON.parse(jsonString);

    // Validate structure
    if (!parsed.schemaVersion || !parsed.exportedAt || !parsed.library) {
      return null;
    }

    return parsed.library;
  } catch {
    return null;
  }
}
