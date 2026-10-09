export type TreeNode = { name: string; fullPath: string; children: Map<string, TreeNode> };

/** Catégories imbriquées : Films/Kaamelott. */
export function buildTree(categories: string[]): TreeNode {
  const root: TreeNode = { name: "", fullPath: "", children: new Map() };
  for (const cat of categories) {
    let cur = root;
    let path = "";
    for (const part of cat.split("/").filter(Boolean)) {
      path = path ? `${path}/${part}` : part;
      let next = cur.children.get(part);
      if (!next) {
        next = { name: part, fullPath: path, children: new Map() };
        cur.children.set(part, next);
      }
      cur = next;
    }
  }
  return root;
}

export function findNode(root: TreeNode, path: string | null): TreeNode | null {
  if (!path) return root;
  let cur: TreeNode | undefined = root;
  for (const part of path.split("/").filter(Boolean)) {
    cur = cur?.children.get(part);
    if (!cur) return null;
  }
  return cur || null;
}

export const sortedChildren = (node: TreeNode | null) =>
  node ? Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name)) : [];

export const parentPath = (path: string): string | null => {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? parts.join("/") : null;
};

export const normaliserCategorie = (valeur?: unknown): string =>
  (typeof valeur === "string" ? valeur : "").split("/").map((part) => part.trim()).filter(Boolean).join("/") || "Autre";
