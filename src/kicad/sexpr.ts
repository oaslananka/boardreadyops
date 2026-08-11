interface SexprSourcePosition {
  offset: number;
  line: number;
  column: number;
}

export interface SexprSourceSpan {
  start: SexprSourcePosition;
  end: SexprSourcePosition;
}

interface SexprParseError {
  message: string;
  span: SexprSourceSpan;
}

interface SexprAtomNode {
  kind: "atom" | "string";
  value: string;
  raw: string;
  span: SexprSourceSpan;
}

export interface SexprListNode {
  kind: "list";
  children: SexprNode[];
  span: SexprSourceSpan;
}

export type SexprNode = SexprAtomNode | SexprListNode;

export interface SexprDocument {
  text: string;
  nodes: SexprNode[];
  errors: SexprParseError[];
}

interface MutablePosition {
  offset: number;
  line: number;
  column: number;
}

export function parseSexprDocument(text: string): SexprDocument {
  const nodes: SexprNode[] = [];
  const errors: SexprParseError[] = [];
  const stack: SexprListNode[] = [];
  const position: MutablePosition = { offset: 0, line: 1, column: 1 };

  while (position.offset < text.length) {
    const char = text[position.offset];
    if (char === undefined) {
      break;
    }
    processSexprToken(text, char, position, nodes, stack, errors);
  }

  const end = mark(position);
  for (const list of stack.toReversed()) {
    list.span.end = end;
    errors.push({ message: "Unclosed list", span: { start: list.span.start, end } });
  }

  return { text, nodes, errors };
}

export function extractBlocks(text: string, head: string): string[] {
  const document = parseSexprDocument(text);
  return findSexprLists(document, head).map((list) => sexprSourceText(text, list));
}

export function sexprStringAfter(block: string, head: string): string | undefined {
  const document = parseSexprDocument(block);
  const list = findSexprLists(document, head)[0];
  return list ? sexprListValue(list, 1) : undefined;
}

export function findSexprLists(
  root: SexprDocument | SexprListNode | readonly SexprNode[],
  head: string,
  options: { recursive?: boolean } = {},
): SexprListNode[] {
  const recursive = options.recursive ?? true;
  const nodes = rootNodes(root);
  const matches: SexprListNode[] = [];
  for (const node of nodes) {
    if (node.kind !== "list") {
      continue;
    }
    if (sexprHead(node) === head) {
      matches.push(node);
    }
    if (recursive) {
      matches.push(...findSexprLists(node.children, head, options));
    }
  }
  return matches;
}

export function sexprChildLists(list: SexprListNode, head?: string | undefined): SexprListNode[] {
  return list.children.filter(
    (node): node is SexprListNode => node.kind === "list" && (!head || sexprHead(node) === head),
  );
}

export function sexprHead(list: SexprListNode): string | undefined {
  return sexprScalar(list.children[0]);
}

export function sexprListValue(list: SexprListNode, index = 1): string | undefined {
  return sexprScalar(list.children[index]);
}

export function sexprChildValue(list: SexprListNode, head: string, index = 1): string | undefined {
  const child = sexprChildLists(list, head)[0];
  return child ? sexprListValue(child, index) : undefined;
}

function sexprScalar(node: SexprNode | undefined): string | undefined {
  if (!node || node.kind === "list") {
    return undefined;
  }
  return node.value;
}

export function sexprDescendantScalars(root: SexprListNode): string[] {
  const values: string[] = [];
  for (const child of root.children) {
    if (child.kind === "list") {
      values.push(...sexprDescendantScalars(child));
    } else {
      values.push(child.value);
    }
  }
  return values;
}

export function sexprSourceText(text: string, node: SexprNode): string {
  return text.slice(node.span.start.offset, node.span.end.offset);
}

function rootNodes(root: SexprDocument | SexprListNode | readonly SexprNode[]): readonly SexprNode[] {
  if (isNodeArray(root)) {
    return root;
  }
  if (isDocument(root)) {
    return root.nodes;
  }
  return root.children;
}

function isNodeArray(root: SexprDocument | SexprListNode | readonly SexprNode[]): root is readonly SexprNode[] {
  return Array.isArray(root);
}

function isDocument(root: SexprDocument | SexprListNode): root is SexprDocument {
  return "nodes" in root;
}

function appendNode(nodes: SexprNode[], stack: SexprListNode[], node: SexprNode): void {
  const parent = stack.at(-1);
  if (parent) {
    parent.children.push(node);
  } else {
    nodes.push(node);
  }
}

function lastList(stack: SexprListNode[], nodes: SexprNode[]): SexprListNode | undefined {
  const parent = stack.at(-1);
  const node = parent ? parent.children.at(-1) : nodes.at(-1);
  return node?.kind === "list" ? node : undefined;
}

function parseString(text: string, position: MutablePosition, errors: SexprParseError[]): SexprAtomNode {
  const start = mark(position);
  let value = "";
  advance(position, '"');
  let closed = false;
  while (position.offset < text.length) {
    const char = text[position.offset];
    if (char === undefined) {
      break;
    }
    if (char === '"') {
      advance(position, char);
      closed = true;
      break;
    }
    if (char === "\\") {
      advance(position, char);
      const escaped = text[position.offset];
      if (escaped === undefined) {
        break;
      }
      value += decodeEscape(escaped);
      advance(position, escaped);
      continue;
    }
    value += char;
    advance(position, char);
  }
  const end = mark(position);
  if (!closed) {
    errors.push({ message: "Unclosed string", span: { start, end } });
  }
  return { kind: "string", value, raw: text.slice(start.offset, end.offset), span: { start, end } };
}

function parseAtom(text: string, position: MutablePosition): SexprAtomNode {
  const start = mark(position);
  while (position.offset < text.length) {
    const char = text[position.offset];
    if (char === undefined || /\s|\(|\)|;/.test(char)) {
      break;
    }
    advance(position, char);
  }
  const end = mark(position);
  const raw = text.slice(start.offset, end.offset);
  return { kind: "atom", value: raw, raw, span: { start, end } };
}

function skipComment(text: string, position: MutablePosition): void {
  while (position.offset < text.length) {
    const char = text[position.offset];
    if (char === undefined) {
      return;
    }
    advance(position, char);
    if (char === "\n") {
      return;
    }
  }
}

function decodeEscape(char: string): string {
  switch (char) {
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    default:
      return char;
  }
}

function mark(position: MutablePosition): SexprSourcePosition {
  return { offset: position.offset, line: position.line, column: position.column };
}

function advance(position: MutablePosition, char: string): void {
  position.offset += char.length;
  if (char === "\n") {
    position.line += 1;
    position.column = 1;
    return;
  }
  position.column += 1;
}

function processSexprToken(
  text: string,
  char: string,
  position: MutablePosition,
  nodes: SexprNode[],
  stack: SexprListNode[],
  errors: SexprParseError[],
): void {
  if (/\s/.test(char)) {
    advance(position, char);
    return;
  }
  if (char === ";") {
    skipComment(text, position);
    return;
  }
  if (char === "(") {
    const start = mark(position);
    advance(position, char);
    appendNode(nodes, stack, { kind: "list", children: [], span: { start, end: mark(position) } });
    const list = lastList(stack, nodes);
    if (list) {
      stack.push(list);
    }
    return;
  }
  if (char === ")") {
    const start = mark(position);
    advance(position, char);
    const list = stack.pop();
    if (!list) {
      errors.push({ message: "Unexpected closing parenthesis", span: { start, end: mark(position) } });
    } else {
      list.span.end = mark(position);
    }
    return;
  }
  if (char === '"') {
    appendNode(nodes, stack, parseString(text, position, errors));
    return;
  }
  appendNode(nodes, stack, parseAtom(text, position));
}
