export async function jsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

/**
 * 比较两个字符串数组的内容是否一致。
 *
 * 技能名在一份技能列表里是唯一的，所以这里按「集合」语义比较：
 * 忽略顺序、忽略重复项。传入 undefined / null 时按空数组处理，
 * 这样老的 conversationRecord（没有 selectedSkills 字段）也能安全比较。
 */
export function hasSameStringItems(
  left: readonly string[] | undefined | null,
  right: readonly string[] | undefined | null,
): boolean {
  if (left === right) return true;
  const leftSet = new Set(left ?? []);
  const rightSet = new Set(right ?? []);
  if (leftSet.size !== rightSet.size) return false;
  for (const item of leftSet) {
    if (!rightSet.has(item)) return false;
  }
  return true;
}