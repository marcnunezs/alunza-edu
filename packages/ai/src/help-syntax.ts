import { Parser } from 'acorn';
import type { Node, Token } from 'acorn';

// These limits bound optional retrieval analysis, never accepted student code.
// A partial or unsupported parse contributes no structural assertions.
const LIMITS = Object.freeze({
  bytes: 2048,
  tokens: 512,
  depth: 32,
  nodes: 512,
});
export const HELP_SYNTAX_UNAVAILABLE = 'Estructura sintáctica no disponible.';
const unavailable = [HELP_SYNTAX_UNAVAILABLE];
class UnavailableSyntax extends Error {}

class RetrievalParser extends Parser {
  // Acorn normally validates and constructs RegExp literals while parsing.
  // Refuse that path before either operation; student regexes are never run
  // or compiled by this optional representation helper.
  readRegexp(): never {
    throw new UnavailableSyntax();
  }
}

type AstNode = Node & Record<string, unknown>;
interface FunctionFacts {
  expressionBody: boolean;
  arrow: boolean;
  returns: number;
  valueReturns: number;
  conditionalReturns: number;
  expressions: number;
  expressionCalls: number;
  variables: number;
  assignments: number;
  conditions: number;
}
interface PendingNode {
  node: AstNode;
  depth: number;
  owner: FunctionFacts | null;
  inIf: boolean;
  inExpression: boolean;
}
function isNode(value: unknown): value is AstNode {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    typeof value.type === 'string'
  );
}

/** Literal syntax facts only: no execution, path analysis or correctness claim. */
export function describeHelpSyntax(code: string): string[] {
  if (Buffer.byteLength(code, 'utf8') > LIMITS.bytes) return [...unavailable];
  let tokens = 0;
  let nesting = 0;
  try {
    const tree = RetrievalParser.parse(code, {
      ecmaVersion: 2022,
      sourceType: 'script',
      onToken(token: Token) {
        if (++tokens > LIMITS.tokens) throw new UnavailableSyntax();
        if (['(', '[', '{', '${'].includes(token.type.label)) nesting++;
        if ([')', ']', '}'].includes(token.type.label)) nesting--;
        if (nesting > LIMITS.depth) throw new UnavailableSyntax();
      },
    });
    if (!isNode(tree)) return [...unavailable];
    const functions: FunctionFacts[] = [];
    const pending: PendingNode[] = [
      {
        node: tree,
        depth: 0,
        owner: null,
        inIf: false,
        inExpression: false,
      },
    ];
    let nodes = 0;
    while (pending.length) {
      const item = pending.pop()!;
      if (++nodes > LIMITS.nodes || item.depth > LIMITS.depth)
        throw new UnavailableSyntax();
      const node = item.node;
      let { owner, inIf, inExpression } = item;
      if (
        [
          'FunctionDeclaration',
          'FunctionExpression',
          'ArrowFunctionExpression',
        ].includes(node.type)
      ) {
        owner = {
          arrow: node.type === 'ArrowFunctionExpression',
          expressionBody:
            isNode(node.body) && node.body.type !== 'BlockStatement',
          returns: 0,
          valueReturns: 0,
          conditionalReturns: 0,
          expressions: 0,
          expressionCalls: 0,
          variables: 0,
          assignments: 0,
          conditions: 0,
        };
        functions.push(owner);
        // Nested functions have their own return and conditional scopes.
        inIf = false;
        inExpression = false;
      }
      if (owner) {
        if (node.type === 'ReturnStatement') {
          owner.returns++;
          if (node.argument !== null) owner.valueReturns++;
          if (inIf) owner.conditionalReturns++;
        }
        if (node.type === 'IfStatement') {
          owner.conditions++;
          inIf = true;
        }
        if (node.type === 'ExpressionStatement') {
          owner.expressions++;
          inExpression = true;
        }
        if (node.type === 'CallExpression' && inExpression)
          owner.expressionCalls++;
        if (node.type === 'VariableDeclarator') owner.variables++;
        if (node.type === 'AssignmentExpression') owner.assignments++;
      }
      // Iterative traversal bounds our own stack and follows source order.
      const children = Object.values(node)
        .flatMap((value) =>
          Array.isArray(value)
            ? value.filter(isNode)
            : isNode(value)
              ? [value]
              : [],
        )
        .sort((left, right) => left.start - right.start);
      for (const child of children.reverse())
        pending.push({
          node: child,
          depth: item.depth + 1,
          owner,
          inIf,
          inExpression,
        });
    }
    if (!functions.length) return [...unavailable];
    return functions.map((facts, index) => {
      if (facts.expressionBody)
        return `Función ${index + 1}: flecha con cuerpo de expresión (retorno implícito), sin bloque de instrucciones.`;
      const parts = [
        `Función ${index + 1}: ${facts.arrow ? 'flecha con ' : ''}cuerpo de bloque`,
      ];
      if (facts.returns === 0) parts[0] += ' sin instrucciones return propias';
      else
        parts.push(
          `${facts.returns} instrucciones return propias (${facts.valueReturns} con expresión)`,
        );
      if (facts.conditionalReturns) parts.push('return dentro de if');
      if (facts.variables) parts.push('declaraciones de variables');
      if (facts.assignments) parts.push('asignaciones');
      if (facts.expressions) parts.push('expresiones usadas como sentencias');
      if (facts.expressionCalls)
        parts.push('llamadas dentro de esas expresiones');
      if (facts.conditions) parts.push('condicionales if');
      return parts.join('; ') + '.';
    });
  } catch {
    // Parser errors, complexity bounds and unsupported grammar are optional
    // analysis failures. Never replace the runner's persisted diagnosis.
    return [...unavailable];
  }
}
