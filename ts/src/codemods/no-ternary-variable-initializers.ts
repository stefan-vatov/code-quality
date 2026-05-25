/* -------------------------------------------------------------------------- */
/*       Variable-initializer repairs for the no-ternary codemod only.        */
/* -------------------------------------------------------------------------- */
import { Array, Option, Predicate, pipe } from 'effect';
import type {
  ArrowFunctionExpression,
  BlockStatement,
  ConditionalExpression,
  Expression,
  Identifier,
  Node,
  VariableDeclaration,
  VariableDeclarator,
} from 'jscodeshift';
import jscodeshift from 'jscodeshift';

interface Replacement {
  end: number;
  start: number;
  text: string;
}

interface BranchTextInput {
  condition: string;
  falseText: string;
  indent: string;
  keyword: 'const' | 'let';
  name: string;
  returnType: string;
  trueText: string;
  typeText: string;
}

const INDENT_STEP = '  ';
const NOT_FOUND_INDEX = -1;
const codemodAPI = jscodeshift.withParser('ts');

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Predicate.isObject(value);

const nodeStart = (node: unknown): number =>
  pipe(
    Option.some(node),
    Option.filter(isObjectRecord),
    Option.flatMapNullable((value) => value.start),
    Option.filter(Predicate.isNumber),
    Option.getOrThrowWith(() => new Error('jscodeshift node is missing a start offset')),
  );

const nodeEnd = (node: unknown): number =>
  pipe(
    Option.some(node),
    Option.filter(isObjectRecord),
    Option.flatMapNullable((value) => value.end),
    Option.filter(Predicate.isNumber),
    Option.getOrThrowWith(() => new Error('jscodeshift node is missing an end offset')),
  );

const sourceForNode = (source: string, node: unknown): string =>
  source.slice(nodeStart(node), nodeEnd(node));

const isIdentifier = (node: Node | null | undefined): node is Identifier =>
  node?.type === 'Identifier';

const lineIndent = (source: string, index: number): string => {
  const lineStart = source.lastIndexOf('\n', index) + 1;
  let cursor = lineStart;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character !== ' ' && character !== '\t') {
      break;
    }
    cursor += 1;
  }
  return source.slice(lineStart, cursor);
};

const containsConditionalExpressionInValue = (node: unknown, seen: WeakSet<object>): boolean => {
  if (globalThis.Array.isArray(node)) {
    return pipe(
      node,
      Array.some((entry): boolean => containsConditionalExpressionInValue(entry, seen)),
    );
  }
  if (!isObjectRecord(node)) {
    return false;
  }
  if (seen.has(node)) {
    return false;
  }
  seen.add(node);
  if (node.type === 'ConditionalExpression') {
    return true;
  }
  return pipe(
    Object.values(node),
    Array.some((entry): boolean => containsConditionalExpressionInValue(entry, seen)),
  );
};

const containsConditionalExpression = (node: unknown): boolean =>
  containsConditionalExpressionInValue(node, new WeakSet());

const hasUnsafeBranches = (expression: ConditionalExpression): boolean =>
  containsConditionalExpression(expression.consequent) ||
  containsConditionalExpression(expression.alternate);

const primitiveTypeOf = (expression: Expression): string | undefined =>
  pipe(
    Option.some(expression.type),
    Option.flatMap((type) => {
      if (type === 'StringLiteral') {
        return Option.some('string');
      }
      if (type === 'NumericLiteral') {
        return Option.some('number');
      }
      if (type === 'BooleanLiteral') {
        return Option.some('boolean');
      }
      if (type === 'NullLiteral') {
        return Option.some('null');
      }
      return Option.none<string>();
    }),
    Option.getOrUndefined,
  );

const declaredTypeText = (source: string, declaration: VariableDeclarator): string | undefined =>
  pipe(
    Option.some(declaration.id),
    Option.filter(isIdentifier),
    Option.flatMapNullable((identifier) => identifier.typeAnnotation),
    Option.map((annotation): string => {
      const raw = sourceForNode(source, annotation).trim();
      if (raw.startsWith(':')) {
        return raw.slice(1).trim();
      }
      return raw;
    }),
    Option.getOrUndefined,
  );

const initializerReturnType = (
  source: string,
  declaration: VariableDeclarator,
  whenTrue: Expression,
  whenFalse: Expression,
): string | undefined =>
  pipe(
    Option.fromNullable(declaredTypeText(source, declaration)),
    Option.orElse(() =>
      pipe(
        Option.all({
          falseType: Option.fromNullable(primitiveTypeOf(whenFalse)),
          trueType: Option.fromNullable(primitiveTypeOf(whenTrue)),
        }),
        Option.filter(({ falseType, trueType }): boolean => trueType === falseType),
        Option.map(({ trueType }): string => trueType),
      ),
    ),
    Option.getOrUndefined,
  );

const optionalTypeText = (
  source: string,
  declaration: VariableDeclarator,
  returnType: string,
): string =>
  pipe(
    Option.fromNullable(declaredTypeText(source, declaration)),
    Option.match({
      onNone: (): string => '',
      onSome: (): string => `: ${returnType}`,
    }),
  );

const branchInitializerText = (input: BranchTextInput): string => {
  const bodyIndent = `${input.indent}${INDENT_STEP}`;
  const returnIndent = `${bodyIndent}${INDENT_STEP}`;
  return [
    `${input.keyword} ${input.name}${input.typeText} = ((): ${input.returnType} => {`,
    `${bodyIndent}if (${input.condition}) {`,
    `${returnIndent}return ${input.trueText};`,
    `${bodyIndent}}`,
    `${bodyIndent}return ${input.falseText};`,
    `${input.indent}})();`,
  ].join('\n');
};

const declarationKeyword = (statement: VariableDeclaration): 'const' | 'let' =>
  pipe(
    Option.some(statement.kind),
    Option.filter((kind): boolean => kind === 'const'),
    Option.match({
      onNone: (): 'let' => 'let',
      onSome: (): 'const' => 'const',
    }),
  );

const explicitInitializerText = (
  source: string,
  statement: VariableDeclaration,
  declaration: VariableDeclarator,
  expression: ConditionalExpression,
  indent: string,
): string | undefined =>
  pipe(
    Option.some(declaration.id),
    Option.filter(isIdentifier),
    Option.filter((): boolean => !hasUnsafeBranches(expression)),
    Option.flatMap((identifier) =>
      pipe(
        Option.fromNullable(
          initializerReturnType(source, declaration, expression.consequent, expression.alternate),
        ),
        Option.map((returnType): string =>
          branchInitializerText({
            condition: sourceForNode(source, expression.test),
            falseText: sourceForNode(source, expression.alternate),
            indent,
            keyword: declarationKeyword(statement),
            name: identifier.name,
            returnType,
            trueText: sourceForNode(source, expression.consequent),
            typeText: optionalTypeText(source, declaration, returnType),
          }),
        ),
      ),
    ),
    Option.getOrUndefined,
  );

const isWhitespaceChar = (char: string | undefined): boolean =>
  char === ' ' || char === '\n' || char === '\r' || char === '\t';

const arrowReturnTypeInsertPosition = (source: string, arrow: ArrowFunctionExpression): number => {
  const bodyStart = nodeStart(arrow.body);
  const arrowStart = source.lastIndexOf('=>', bodyStart);
  let insertAt = bodyStart;
  if (arrowStart !== NOT_FOUND_INDEX) {
    insertAt = arrowStart;
  }
  while (insertAt > nodeStart(arrow) && isWhitespaceChar(source[insertAt - 1])) {
    insertAt -= 1;
  }
  return insertAt;
};

const returnExpressions = (body: BlockStatement): Expression[] =>
  pipe(
    codemodAPI(body).find(codemodAPI.ReturnStatement).paths(),
    Array.filterMap((path) => Option.fromNullable(path.value.argument)),
  );

const commonPrimitiveReturnType = (body: BlockStatement): string | undefined => {
  const expressions = returnExpressions(body);
  return pipe(
    expressions,
    Array.head,
    Option.flatMap((firstExpression) =>
      pipe(
        Option.fromNullable(primitiveTypeOf(firstExpression)),
        Option.filter((firstType): boolean =>
          pipe(
            expressions,
            Array.every((expression): boolean => primitiveTypeOf(expression) === firstType),
          ),
        ),
      ),
    ),
    Option.getOrUndefined,
  );
};

const arrowIIFEReturnType = (
  source: string,
  declaration: VariableDeclarator,
  arrow: ArrowFunctionExpression,
): string | undefined =>
  pipe(
    Option.fromNullable(declaredTypeText(source, declaration)),
    Option.orElse(() => {
      if (arrow.body.type === 'BlockStatement') {
        return Option.fromNullable(commonPrimitiveReturnType(arrow.body));
      }
      return Option.fromNullable(primitiveTypeOf(arrow.body));
    }),
    Option.getOrUndefined,
  );

const zeroArgArrowIIFE = (declaration: VariableDeclarator): ArrowFunctionExpression | undefined =>
  pipe(
    Option.fromNullable(declaration.init),
    Option.filter((init): boolean => init.type === 'CallExpression'),
    Option.flatMapNullable((init) => {
      if (isObjectRecord(init)) {
        return init.callee;
      }
      return undefined;
    }),
    Option.filter(
      (callee): callee is ArrowFunctionExpression =>
        isObjectRecord(callee) &&
        callee.type === 'ArrowFunctionExpression' &&
        globalThis.Array.isArray(callee.params) &&
        callee.params.length === 0 &&
        !callee.returnType,
    ),
    Option.getOrUndefined,
  );

const arrowIIFEReturnTypeReplacement = (
  source: string,
  declaration: VariableDeclarator,
): Replacement | undefined =>
  pipe(
    Option.fromNullable(zeroArgArrowIIFE(declaration)),
    Option.flatMap((arrow) =>
      pipe(
        Option.fromNullable(arrowIIFEReturnType(source, declaration, arrow)),
        Option.map((returnType): Replacement => {
          const insertAt = arrowReturnTypeInsertPosition(source, arrow);
          return { end: insertAt, start: insertAt, text: `: ${returnType}` };
        }),
      ),
    ),
    Option.getOrUndefined,
  );

const initializerReplacement = (
  source: string,
  node: VariableDeclaration,
  declaration: VariableDeclarator,
): Replacement | undefined =>
  pipe(
    Option.fromNullable(declaration.init),
    Option.flatMap((init) => {
      if (init.type !== 'ConditionalExpression') {
        return Option.fromNullable(arrowIIFEReturnTypeReplacement(source, declaration));
      }
      return pipe(
        Option.fromNullable(
          explicitInitializerText(
            source,
            node,
            declaration,
            init,
            lineIndent(source, nodeStart(node)),
          ),
        ),
        Option.map((text): Replacement => ({ end: nodeEnd(node), start: nodeStart(node), text })),
      );
    }),
    Option.getOrUndefined,
  );

const isVariableDeclarator = (node: unknown): node is VariableDeclarator =>
  isObjectRecord(node) && node.type === 'VariableDeclarator';

/**
 * Internal helper exported for the no-ternary codemod composition.
 *
 * @internal
 */
export const variableReplacement = (
  source: string,
  node: VariableDeclaration,
): Replacement | undefined =>
  pipe(
    node.declarations,
    Option.liftPredicate((declarations): boolean => declarations.length === 1),
    Option.flatMap(Array.head),
    Option.filter(isVariableDeclarator),
    Option.filter((declaration): boolean => Boolean(declaration.init)),
    Option.flatMap((declaration) =>
      Option.fromNullable(initializerReplacement(source, node, declaration)),
    ),
    Option.getOrUndefined,
  );
