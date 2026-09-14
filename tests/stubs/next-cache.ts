/**
 * Test stub for `next/cache`.
 *
 * `revalidatePath` throws outside a request scope, so any test that calls a Server Action
 * straight through hits that before it can assert on the action's own result — which is why the
 * only existing coverage of these handlers reads their source text and greps for the call.
 *
 * Recording the calls rather than discarding them lets a test assert that a mutation invalidated
 * the page it changed, which is the part worth checking.
 */
const revalidatedPaths: string[] = [];
const revalidatedTags: string[] = [];

export function revalidatePath(path: string): void {
  revalidatedPaths.push(path);
}

export function revalidateTag(tag: string): void {
  revalidatedTags.push(tag);
}

export function __revalidatedPaths(): readonly string[] {
  return [...revalidatedPaths];
}

export function __revalidatedTags(): readonly string[] {
  return [...revalidatedTags];
}

export function __resetRevalidations(): void {
  revalidatedPaths.length = 0;
  revalidatedTags.length = 0;
}
