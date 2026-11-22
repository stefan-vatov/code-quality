import { Array, Option, pipe } from 'effect';
import type {
  AssignmentExpression,
  BlockStatement,
  Expression,
  Identifier,
  IfStatement,
  Statement,
  UpdateExpression,
  VariableDeclaration,
  VariableDeclarator,
} from 'jscodeshift';
import {
  codemodObjectValues,
  isCodemodArray,
  isCodemodNode,
  nodeEnd,
  nodeStart,
  sourceForNode,
  type CodemodRecord,
  type CodemodValue,
} from './ast-helpers';

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

interface BranchReplacementInput {
  declaration: VariableDeclarator;
  declarationStatement: VariableDeclaration;
  ifStatement: IfStatement;
  index: number;
  source: string;
  statements: readonly Statement[];
}

const INDENT_STEP = '  ';

const isIdentifier = (node: CodemodValue): node is Identifier =>
  isCodemodNode(node) && node.type === 'Identifier';

const isStatement = (node: CodemodValue): node is Statement => isCodemodNode(node);

const isVariableDeclaration = (node: CodemodValue): node is VariableDeclaration =>
  isCodemodNode(node) && node.type === 'VariableDeclaration';

const isVariableDeclarator = (node: CodemodValue): node is VariableDeclarator =>
  isCodemodNode(node) && node.type === 'VariableDeclarator';

const isIfStatement = (node: CodemodValue): node is IfStatement =>
  isCodemodNode(node) && node.type === 'IfStatement';

const isAssignmentExpression = (node: CodemodValue): node is AssignmentExpression =>
  isCodemodNode(node) && node.type === 'AssignmentExpression';

const isUpdateExpression = (node: CodemodValue): node is UpdateExpression =>
  isCodemodNode(node) && node.type === 'UpdateExpression';

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

const statementFromBlock = (statement: Statement): Statement | undefined =>
  pipe(
    Option.some(statement),
    Option.filter((value): value is BlockStatement => value.type === 'BlockStatement'),
    Option.flatMapNullable((value) => value.body),
    Option.filter((body): boolean => body.length === 1),
    Option.flatMap(Array.head),
    Option.filter(isStatement),
    Option.getOrUndefined,
  );

const normalizedStatement = (statement: Statement): Statement | undefined =>
  statementFromBlock(statement) ?? statement;

const assignmentExpression = (statement: Statement | undefined): AssignmentExpression | undefined =>
  pipe(
    Option.fromNullable(statement),
    Option.filter(
      (value): value is Statement & { expression: Expression } =>
        value.type === 'ExpressionStatement',
    ),
    Option.flatMapNullable((value) => value.expression),
    Option.filter(isAssignmentExpression),
    Option.filter((expression): boolean => expression.operator === '='),
    Option.getOrUndefined,
  );

const assignedExpression = (statement: Statement, name: string): Expression | undefined => {
  const expression = assignmentExpression(normalizedStatement(statement));
  return pipe(
    Option.fromNullable(expression),
    Option.filter((value): boolean => isIdentifier(value.left) && value.left.name === name),
    Option.map((value): Expression => value.right),
    Option.getOrUndefined,
  );
};

interface WriteSearch {
  name: string;
  seen: WeakSet<object>;
}

const writesIdentifierInRecord = (node: CodemodRecord, search: WriteSearch): boolean => {
  if (search.seen.has(node)) {
    return false;
  }
  search.seen.add(node);
  if (isAssignmentExpression(node) && isIdentifier(node.left)) {
    return node.operator === '=' && node.left.name === search.name;
  }
  if (isUpdateExpression(node) && isIdentifier(node.argument)) {
    return node.argument.name === search.name;
  }
  return pipe(
    codemodObjectValues(node),
    Array.some((value): boolean => writesIdentifierInValue(value, search)),
  );
};

const writesIdentifierInValue = (node: CodemodValue, search: WriteSearch): boolean => {
  if (isCodemodArray(node)) {
    return pipe(
      node,
      Array.some((entry): boolean => writesIdentifierInValue(entry, search)),
    );
  }
  if (!isCodemodNode(node)) {
    return false;
  }
  return writesIdentifierInRecord(node, search);
};

const writesIdentifier = (node: CodemodValue, name: string): boolean =>
  writesIdentifierInValue(node, { name, seen: new WeakSet() });

const hasLaterWrite = (
  statements: readonly Statement[],
  startIndex: number,
  name: string,
): boolean =>
  pipe(
    statements,
    Array.drop(startIndex),
    Array.some((statement): boolean => writesIdentifier(statement, name)),
  );

const branchAssignmentExpressions = (
  ifStatement: IfStatement,
  declaration: VariableDeclarator,
): { name: string; whenFalse: Expression; whenTrue: Expression } | undefined =>
  pipe(
    Option.all({
      alternate: Option.fromNullable(ifStatement.alternate),
      identifier: pipe(Option.some(declaration.id), Option.filter(isIdentifier)),
    }),
    Option.flatMap(({ alternate, identifier }) =>
      pipe(
        Option.all({
          whenFalse: Option.fromNullable(assignedExpression(alternate, identifier.name)),
          whenTrue: Option.fromNullable(
            assignedExpression(ifStatement.consequent, identifier.name),
          ),
        }),
        Option.map(({ whenFalse, whenTrue }) => ({
          name: identifier.name,
          whenFalse,
          whenTrue,
        })),
      ),
    ),
    Option.getOrUndefined,
  );

const declarationKeyword = (
  statements: readonly Statement[],
  index: number,
  name: string,
): 'const' | 'let' =>
  pipe(
    Option.some(hasLaterWrite(statements, index + 2, name)),
    Option.filter(Boolean),
    Option.match({
      onNone: (): 'const' => 'const',
      onSome: (): 'let' => 'let',
    }),
  );

const singleEmptyDeclarator = (node: VariableDeclaration): VariableDeclarator | undefined =>
  pipe(
    node.declarations,
    Option.liftPredicate((declarations): boolean => declarations.length === 1),
    Option.flatMap(Array.head),
    Option.filter(isVariableDeclarator),
    Option.filter((declaration): boolean => !declaration.init),
    Option.getOrUndefined,
  );

const branchInitializerReplacement = (
  source: string,
  statements: readonly Statement[],
  index: number,
): Replacement | undefined => {
  const declarationStatement = statements[index];
  const ifStatement = statements[index + 1];
  return pipe(
    Option.all({
      declarationStatement: pipe(
        Option.fromNullable(declarationStatement),
        Option.filter(isVariableDeclaration),
      ),
      ifStatement: pipe(Option.fromNullable(ifStatement), Option.filter(isIfStatement)),
    }),
    Option.flatMap(
      ({ declarationStatement: checkedDeclarationStatement, ifStatement: checkedIfStatement }) =>
        pipe(
          Option.fromNullable(singleEmptyDeclarator(checkedDeclarationStatement)),
          Option.flatMap((declaration) =>
            Option.fromNullable(
              replacementFromBranches({
                declaration,
                declarationStatement: checkedDeclarationStatement,
                ifStatement: checkedIfStatement,
                index,
                source,
                statements,
              }),
            ),
          ),
        ),
    ),
    Option.getOrUndefined,
  );
};

const replacementFromBranches = (input: BranchReplacementInput): Replacement | undefined => {
  const { declaration, declarationStatement, ifStatement, source } = input;
  return pipe(
    Option.fromNullable(branchAssignmentExpressions(ifStatement, declaration)),
    Option.flatMap((branches) =>
      pipe(
        Option.fromNullable(
          initializerReturnType(source, declaration, branches.whenTrue, branches.whenFalse),
        ),
        Option.map(
          (returnType): Replacement => ({
            end: nodeEnd(ifStatement),
            start: nodeStart(declarationStatement),
            text: branchInitializerText({
              condition: sourceForNode(source, ifStatement.test),
              falseText: sourceForNode(source, branches.whenFalse),
              indent: lineIndent(source, nodeStart(declarationStatement)),
              keyword: declarationKeyword(input.statements, input.index, branches.name),
              name: branches.name,
              returnType,
              trueText: sourceForNode(source, branches.whenTrue),
              typeText: optionalTypeText(source, declaration, returnType),
            }),
          }),
        ),
      ),
    ),
    Option.getOrUndefined,
  );
};

export const collectBranchInitializerRepairs = (
  source: string,
  statements: readonly Statement[],
  replacements: Replacement[],
): void => {
  pipe(
    Array.range(0, Math.max(0, statements.length - 2)),
    Array.reduce(0, (skipUntil, idx): number => {
      if (idx < skipUntil) {
        return skipUntil;
      }
      return pipe(
        Option.fromNullable(branchInitializerReplacement(source, statements, idx)),
        Option.match({
          onNone: (): number => skipUntil,
          onSome: (replacement): number => {
            replacements.push(replacement);
            return idx + 2;
          },
        }),
      );
    }),
  );
};
