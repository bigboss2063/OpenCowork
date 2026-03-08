import * as path from 'path'

export interface GitIgnoreMatcher {
  rootDir: string
  ignores: (targetPath: string, isDir: boolean) => Promise<boolean>
}

type GitIgnoreRule = {
  baseDir: string
  negated: boolean
  directoryOnly: boolean
  basenameOnly: boolean
  regex: RegExp
}

function normalizeGitPath(inputPath: string): string {
  let normalized = inputPath.replace(/\\/g, '/')
  normalized = normalized.replace(/\/+/g, '/')
  if (/^[A-Z]:/.test(normalized)) {
    normalized = normalized[0].toLowerCase() + normalized.slice(1)
  }
  if (/^[a-z]:$/.test(normalized)) {
    normalized += '/'
  }
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.replace(/\/+$/, '')
    if (/^[a-z]:$/.test(normalized)) normalized += '/'
  }
  return normalized || '.'
}

function isPathInside(rootDir: string, targetPath: string): boolean {
  return (
    targetPath === rootDir || targetPath.startsWith(rootDir.endsWith('/') ? rootDir : `${rootDir}/`)
  )
}

function compileIgnoreRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const regexBody = escaped
    .replace(/\*\*/g, '__DOUBLE_STAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/__DOUBLE_STAR__/g, '.*')
  return new RegExp(`^${regexBody}$`)
}

function unescapeIgnorePattern(pattern: string): string {
  return pattern.replace(/\\([#! ])/g, '$1').replace(/\\\\/g, '\\')
}

function parseGitIgnoreRules(baseDir: string, content: string): GitIgnoreRule[] {
  const rules: GitIgnoreRule[] = []

  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('#')) continue

    let negated = false
    if (line.startsWith('!')) {
      negated = true
      line = line.slice(1).trim()
    }
    if (!line) continue

    line = unescapeIgnorePattern(line)

    let directoryOnly = false
    if (line.endsWith('/')) {
      directoryOnly = true
      line = line.replace(/\/+$/, '')
    }
    if (!line) continue

    const basenameOnly = !line.includes('/')
    if (line.startsWith('/')) {
      line = line.slice(1)
    }

    rules.push({
      baseDir,
      negated,
      directoryOnly,
      basenameOnly,
      regex: compileIgnoreRegex(line)
    })
  }

  return rules
}

function buildMatchCandidates(
  relativePath: string,
  isDir: boolean
): Array<{ path: string; name: string; isDir: boolean }> {
  const normalized = relativePath.replace(/^\.\/?/, '').replace(/\\/g, '/')
  if (!normalized) return []

  const segments = normalized.split('/').filter(Boolean)
  return segments.map((segment, index) => ({
    path: segments.slice(0, index + 1).join('/'),
    name: segment,
    isDir: isDir || index < segments.length - 1
  }))
}

function matchesGitIgnoreRule(rule: GitIgnoreRule, targetPath: string, isDir: boolean): boolean {
  if (!isPathInside(rule.baseDir, targetPath)) return false

  const relativePath = path.posix.relative(rule.baseDir, targetPath).replace(/\\/g, '/')
  if (!relativePath || relativePath.startsWith('..')) return false

  const candidates = buildMatchCandidates(relativePath, isDir)
  if (rule.basenameOnly) {
    return candidates.some((candidate) => {
      if (rule.directoryOnly && !candidate.isDir) return false
      return rule.regex.test(candidate.name)
    })
  }

  return candidates.some((candidate) => {
    if (rule.directoryOnly && !candidate.isDir) return false
    return rule.regex.test(candidate.path)
  })
}

function buildAncestorDirs(rootDir: string, targetPath: string, isDir: boolean): string[] {
  if (!isPathInside(rootDir, targetPath)) return []

  const targetDir = isDir ? targetPath : normalizeGitPath(path.posix.dirname(targetPath))
  const relativeDir = path.posix.relative(rootDir, targetDir)
  if (!relativeDir || relativeDir === '.') return [rootDir]
  if (relativeDir.startsWith('..')) return []

  const dirs = [rootDir]
  let current = rootDir
  for (const segment of relativeDir.split('/').filter(Boolean)) {
    current = normalizeGitPath(path.posix.join(current, segment))
    dirs.push(current)
  }
  return dirs
}

export function createGitIgnoreMatcher(args: {
  rootDir: string
  readIgnoreFile: (filePath: string) => Promise<string | null>
  extraPatterns?: string[]
}): GitIgnoreMatcher {
  const rootDir = normalizeGitPath(args.rootDir)
  const ruleCache = new Map<string, GitIgnoreRule[]>()
  const extraRules = (args.extraPatterns ?? []).flatMap((pattern) =>
    parseGitIgnoreRules(rootDir, String(pattern))
  )

  const readRulesForDir = async (dirPath: string): Promise<GitIgnoreRule[]> => {
    const normalizedDir = normalizeGitPath(dirPath)
    const cached = ruleCache.get(normalizedDir)
    if (cached) return cached

    const ignorePath = normalizeGitPath(path.posix.join(normalizedDir, '.gitignore'))
    const content = await args.readIgnoreFile(ignorePath)
    const rules = content ? parseGitIgnoreRules(normalizedDir, content) : []
    ruleCache.set(normalizedDir, rules)
    return rules
  }

  return {
    rootDir,
    ignores: async (targetPath: string, isDir: boolean): Promise<boolean> => {
      const normalizedTarget = normalizeGitPath(targetPath)
      if (!isPathInside(rootDir, normalizedTarget)) return false

      let ignored = false
      for (const dirPath of buildAncestorDirs(rootDir, normalizedTarget, isDir)) {
        for (const rule of await readRulesForDir(dirPath)) {
          if (matchesGitIgnoreRule(rule, normalizedTarget, isDir)) {
            ignored = !rule.negated
          }
        }
      }

      for (const rule of extraRules) {
        if (matchesGitIgnoreRule(rule, normalizedTarget, isDir)) {
          ignored = !rule.negated
        }
      }

      return ignored
    }
  }
}

export function normalizeGitIgnorePath(inputPath: string): string {
  return normalizeGitPath(inputPath)
}
