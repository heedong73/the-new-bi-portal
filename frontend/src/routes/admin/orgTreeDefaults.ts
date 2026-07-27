const PRIMARY_COMPANY_NAME = '(주)삼천리'
const DEFAULT_EXPANDED_ORG_NAME = '회장단'

interface OrgTreeNodeLike {
  dept_id: string
  dept_name: string
  children: readonly OrgTreeNodeLike[]
}

function hasName(item: { dept_name: string }, name: string): boolean {
  return item.dept_name.trim() === name
}

/** 원래 순서는 유지하면서 주 회사를 배열의 맨 앞으로 옮긴다. */
export function prioritizePrimaryCompany<T extends { dept_name: string }>(items: readonly T[]): T[] {
  const primary = items.filter((item) => hasName(item, PRIMARY_COMPANY_NAME))
  const others = items.filter((item) => !hasName(item, PRIMARY_COMPANY_NAME))
  return [...primary, ...others]
}

function findPath(node: OrgTreeNodeLike, targetName: string): string[] | null {
  if (hasName(node, targetName)) return [node.dept_id]

  for (const child of node.children) {
    const childPath = findPath(child, targetName)
    if (childPath) return [node.dept_id, ...childPath]
  }
  return null
}

/** 주 회사에서 회장단까지의 경로를 기본 펼침 ID로 반환한다. */
export function getDefaultExpandedOrgIds(tree: readonly OrgTreeNodeLike[]): Set<string> {
  const primaryRoot = tree.find((node) => hasName(node, PRIMARY_COMPANY_NAME))
  if (!primaryRoot) return new Set()

  const path = findPath(primaryRoot, DEFAULT_EXPANDED_ORG_NAME)
  return new Set(path ?? [primaryRoot.dept_id])
}
