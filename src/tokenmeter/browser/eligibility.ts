/**
 * Project eligibility before provisional paint.
 * A project is eligible only if its filesystem path exists, is a directory,
 * is a Git repository/worktree (has .git), and is not "/", HOME, or a direct
 * child of HOME. Nested paths like ~/projects/foo are retained.
 * Uses only sync filesystem calls — no git process per project.
 */

import { existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, parse } from "node:path"

import { isSafeDirectory } from "./is-safe-directory"

function normalize(p: string): string {
  return p.replace(/\/+$/, "")
}

function isDirectChildOfHome(p: string): boolean {
  try {
    const hd = homedir()
    if (!hd) return false
    const n = normalize(p)
    const h = normalize(hd)
    if (n === h) return false
    const d = normalize(dirname(n))
    return d === h
  } catch {
    return false
  }
}

function isGitRepository(p: string): boolean {
  try {
    return existsSync(join(p, ".git"))
  } catch {
    return false
  }
}

function existsAndIsDirectory(p: string): boolean {
  try {
    if (!existsSync(p)) return false
    const st = statSync(p)
    return st.isDirectory()
  } catch {
    return false
  }
}

export function isEligibleProjectPath(p: unknown): boolean {
  if (typeof p !== "string") return false
  const t = p.trim()
  if (!t) return false
  // base safe check (/, HOME, root, empty)
  if (!isSafeDirectory(t)) return false
  // direct child of HOME
  if (isDirectChildOfHome(t)) return false
  // must exist and be directory
  if (!existsAndIsDirectory(t)) return false
  // must be git repo/worktree
  if (!isGitRepository(t)) return false
  // extra root check (already in isSafeDirectory, but keep)
  try {
    if (parse(t).root === t) return false
  } catch {
    return false
  }
  return true
}
