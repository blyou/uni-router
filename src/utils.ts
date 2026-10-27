import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative } from 'node:path'

/** Normalize a file-system path to the forward-slash form used in manifests. */
export function normalizePath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

/** Whether `file` is `directory` itself or one of its descendants. */
export function inside(file: string, directory: string) {
  const path = relative(directory, file)
  return !path || (!path.startsWith('..') && !isAbsolute(path))
}

/** Assign an own enumerable property without triggering the `__proto__` setter. */
export function setOwn<T extends object>(target: T, key: string, value: unknown) {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  })
}

/** Write a file through a temporary sibling followed by an atomic rename. */
export async function writeFileAtomic(file: string, content: string) {
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    await writeFile(temporary, content, 'utf8')
    await rename(temporary, file)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

/** Run async work over a list with a bounded number of concurrent tasks. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let next = 0
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await mapper(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}
