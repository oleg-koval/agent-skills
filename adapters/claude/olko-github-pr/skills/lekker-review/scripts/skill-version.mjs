// Reads the plugin version for run-log. Pure: the caller supplies the reader.
// Returns null (never '' or a guess) when the file is missing, unparseable or
// has no string version, so a run row never records a made-up version.
export function readSkillVersion(readText) {
  try {
    const text = readText()
    const version = typeof text === 'string' ? JSON.parse(text)?.version : null
    return typeof version === 'string' && version !== '' ? version : null
  } catch {
    return null
  }
}
