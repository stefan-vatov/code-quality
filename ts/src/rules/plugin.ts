/* -------------------------------------------------------------------------- */
/*       Oxlint JavaScript plugin entry for The Thracian custom rules.        */
/* -------------------------------------------------------------------------- */
import { Array, Option, pipe } from 'effect';
import {
  acronymDiagnosticMessage,
  booleanDiagnosticMessage,
  constantDiagnosticMessage,
  fileDocDiagnosticMessage,
  functionDocDiagnosticMessage,
  importDepthDiagnosticMessage,
  jsExtensionDiagnosticMessage,
  lineLengthDiagnosticMessage,
  localExportListDiagnosticMessage,
  privateMemberDiagnosticMessage,
  renameDiagnosticMessage,
  typeDiagnosticMessage,
} from './diagnostic-guidance';
import findMisCasedAcronyms, { fixAcronymCase } from './acronym-case';
import hasLeadingUnderscore, { suggestPrivateName } from './private-underscore';
import { isCamelCase, isUpperCase, toCamelCase } from './camel-case-identifiers';
import isPascalCase, { toPascalCase } from './pascal-case-types';
import countImportDepth from './max-import-depth';
import effectDefaultRules from './effect-default';
import effectStrictRules from './effect-strict';
import { eslintCompatPlugin } from '@oxlint/plugins';
import findLongLines from './max-line-length';
import { findRequiredFunctionDocFailure } from './require-function-doc';
import hasBooleanPrefix from './boolean-prefix';
import hasRequiredFileDoc from './require-file-doc';
import noCommentedOutCodeRule from './plugin-commented-out-code-rule';
import { readCachedSource } from './source-cache';

interface NamedNode {
  id?: IdentifierNode | null;
  key?: IdentifierNode;
}

interface IdentifierNode {
  name: string;
  range?: [number, number];
}

const getIdentifierName = (node: { name?: unknown } | null | undefined): string | undefined =>
  pipe(
    Option.fromNullable(node?.name),
    Option.filter((name): name is string => typeof name === 'string'),
    Option.getOrUndefined,
  );

interface ReportDescriptor {
  message: string;
  node: object;
}

interface Context {
  report: (descriptor: ReportDescriptor) => void;
  filename?: string;
}

type VisitorMap = Record<string, ((node: never) => void) | undefined>;
type OxlintPlugin = Parameters<typeof eslintCompatPlugin>[0];
const readSource = (context: Context): string => readCachedSource(context);
const isBooleanVar = (node: DeclNode): boolean =>
  node.typeAnnotation?.typeAnnotation.type === 'TSBooleanKeyword' ||
  (node.init?.type === 'Literal' && typeof node.init.value === 'boolean');

const withCreateOnce = <
  RuleWithCreateOnce extends { createOnce: (context: Context) => VisitorMap },
>(
  rule: RuleWithCreateOnce,
): RuleWithCreateOnce & { create: RuleWithCreateOnce['createOnce'] } =>
  Object.assign(rule, { create: rule.createOnce });

const pascalCaseTypesRule = withCreateOnce({
  createOnce(context: Context) {
    const reportType = (kind: string, name: string, node: object): void => {
      context.report({
        message: typeDiagnosticMessage(kind, name, toPascalCase(name)),
        node,
      });
    };

    return {
      ClassDeclaration(node: NamedNode): void {
        if (node.id && !isPascalCase(node.id.name)) {
          reportType('class', node.id.name, node);
        }
      },
      TSEnumDeclaration(node: NamedNode): void {
        if (node.id && !isPascalCase(node.id.name)) {
          reportType('enum', node.id.name, node);
        }
      },
      TSInterfaceDeclaration(node: NamedNode): void {
        if (node.id && !isPascalCase(node.id.name)) {
          reportType('interface', node.id.name, node);
        }
      },
      TSTypeAliasDeclaration(node: NamedNode): void {
        if (node.id && !isPascalCase(node.id.name)) {
          reportType('type', node.id.name, node);
        }
      },
    };
  },
});

interface DeclNode extends NamedNode {
  parent?: { kind: string };
  init?: { type: string; value: unknown };
  typeAnnotation?: { typeAnnotation: { type: string } };
  accessibility?: string;
  type?: string;
  value?: { name: string };
}

const camelCaseIdentifiersRule = withCreateOnce({
  createOnce(context: Context) {
    return {
      FunctionDeclaration(node: NamedNode): void {
        if (node.id && !isCamelCase(node.id.name)) {
          context.report({
            message: renameDiagnosticMessage('function', node.id.name, toCamelCase(node.id.name)),
            node,
          });
        }
      },
      MethodDefinition(node: NamedNode): void {
        if (node.key && !isCamelCase(node.key.name)) {
          context.report({
            message: renameDiagnosticMessage('method', node.key.name, toCamelCase(node.key.name)),
            node,
          });
        }
      },
      Parameter(node: DeclNode): void {
        if (node.type === 'Identifier' && node.value && !isCamelCase(node.value.name)) {
          context.report({
            message: renameDiagnosticMessage(
              'parameter',
              node.value.name,
              toCamelCase(node.value.name),
            ),
            node,
          });
        }
      },
      PropertyDefinition(node: NamedNode): void {
        if (node.key && !isCamelCase(node.key.name)) {
          context.report({
            message: renameDiagnosticMessage('property', node.key.name, toCamelCase(node.key.name)),
            node,
          });
        }
      },
      VariableDeclarator(node: DeclNode): void {
        const name = getIdentifierName(node.id);
        if (!name) {
          return;
        }
        const isConst = node.parent && node.parent.kind === 'const';
        if (isConst) {
          if (!isCamelCase(name) && !isUpperCase(name) && !isPascalCase(name)) {
            context.report({
              message: constantDiagnosticMessage(name, toCamelCase(name)),
              node,
            });
          }
        } else {
          if (!isCamelCase(name)) {
            context.report({
              message: renameDiagnosticMessage('variable', name, toCamelCase(name)),
              node,
            });
          }
        }
      },
    };
  },
});

const booleanPrefixRule = withCreateOnce({
  createOnce(context: Context) {
    return {
      VariableDeclarator(node: DeclNode): void {
        const name = getIdentifierName(node.id);
        if (!name) {
          return;
        }
        if (isBooleanVar(node) && !hasBooleanPrefix(name)) {
          context.report({
            message: booleanDiagnosticMessage(name),
            node,
          });
        }
      },
    };
  },
});

const privateUnderscoreRule = withCreateOnce({
  createOnce(context: Context) {
    return {
      MethodDefinition(node: DeclNode): void {
        if (node.key && node.accessibility === 'private' && !hasLeadingUnderscore(node.key.name)) {
          const replacement = suggestPrivateName(node.key.name);
          context.report({
            message: privateMemberDiagnosticMessage('method', node.key.name, replacement),
            node,
          });
        }
      },
      PropertyDefinition(node: DeclNode): void {
        if (node.key && node.accessibility === 'private' && !hasLeadingUnderscore(node.key.name)) {
          const replacement = suggestPrivateName(node.key.name);
          context.report({
            message: privateMemberDiagnosticMessage('property', node.key.name, replacement),
            node,
          });
        }
      },
    };
  },
});

const acronymCaseRule = withCreateOnce({
  createOnce(context: Context) {
    const checkAcronyms = (name: string, node: object): void => {
      const violations = findMisCasedAcronyms(name);
      if (Array.isNonEmptyReadonlyArray(violations)) {
        const replacement = fixAcronymCase(name);
        context.report({
          message: acronymDiagnosticMessage(name, replacement, violations),
          node,
        });
      }
    };

    return {
      ClassDeclaration(node: NamedNode): void {
        if (node.id) {
          checkAcronyms(node.id.name, node);
        }
      },
      FunctionDeclaration(node: NamedNode): void {
        if (node.id) {
          checkAcronyms(node.id.name, node);
        }
      },
      MethodDefinition(node: NamedNode): void {
        if (node.key) {
          checkAcronyms(node.key.name, node);
        }
      },
      Parameter(node: DeclNode): void {
        if (node.type === 'Identifier' && node.value) {
          checkAcronyms(node.value.name, node);
        }
      },
      PropertyDefinition(node: NamedNode): void {
        if (node.key) {
          checkAcronyms(node.key.name, node);
        }
      },
      VariableDeclarator(node: NamedNode): void {
        const name = getIdentifierName(node.id);
        if (name) {
          checkAcronyms(name, node);
        }
      },
    };
  },
});

interface ImportNode {
  source?: { value: string; raw: string } | null;
  arguments?: { value: string }[];
  callee?: { name: string };
}

interface RuntimeSpecifierNode {
  arguments?: { value?: unknown }[];
  callee?: { name?: unknown };
  source?: { value?: unknown };
}

const isJavaScriptSpecifier = (specifier: unknown): specifier is string =>
  typeof specifier === 'string' && specifier.endsWith('.js');

const reportJavaScriptSpecifier = (context: Context, node: object, specifier: string): void => {
  context.report({
    message: jsExtensionDiagnosticMessage(specifier),
    node,
  });
};

const noDynamicJSExtensionImportsRule = withCreateOnce({
  createOnce(context: Context) {
    return {
      CallExpression(node: RuntimeSpecifierNode): void {
        if (node.callee?.name !== 'require') {
          return;
        }
        pipe(
          Option.fromNullable(node.arguments),
          Option.flatMap(Array.head),
          Option.map((argument): unknown => argument.value),
          Option.filter(isJavaScriptSpecifier),
          Option.map((specifier): void => reportJavaScriptSpecifier(context, node, specifier)),
        );
      },
      ImportExpression(node: RuntimeSpecifierNode): void {
        pipe(
          Option.fromNullable(node.source?.value),
          Option.filter(isJavaScriptSpecifier),
          Option.map((specifier): void => reportJavaScriptSpecifier(context, node, specifier)),
        );
      },
    };
  },
});

interface ExportNamedNode {
  declaration?: object | null;
  source?: object | null;
  specifiers?: object[];
}

const isIndexModule = (filename: string | undefined): boolean =>
  filename !== undefined && /(?:^|\/)index\.[cm]?[jt]sx?$/u.test(filename);

const noLocalExportListRule = withCreateOnce({
  createOnce(context: Context) {
    return {
      ExportNamedDeclaration(node: ExportNamedNode): void {
        if (
          node.source ||
          node.declaration ||
          !node.specifiers ||
          Array.isEmptyReadonlyArray(node.specifiers) ||
          node.specifiers.length === 1 ||
          isIndexModule(context.filename)
        ) {
          return;
        }
        context.report({
          message: localExportListDiagnosticMessage(),
          node,
        });
      },
    };
  },
});

const maxImportDepthRule = withCreateOnce({
  createOnce(context: Context) {
    const MAX_DEPTH = 4;

    const checkPath = (importPath: string, node: object): void => {
      const depth = countImportDepth(importPath);
      if (depth > MAX_DEPTH) {
        context.report({
          message: importDepthDiagnosticMessage(depth, MAX_DEPTH, importPath),
          node,
        });
      }
    };

    return {
      CallExpression(node: ImportNode): void {
        pipe(
          Option.fromNullable(node.arguments),
          Option.flatMap(Array.head),
          Option.map((argument): unknown => argument.value),
          Option.filter((value): value is string => typeof value === 'string'),
          Option.filter((): boolean => node.callee?.name === 'require'),
          Option.map((importPath): void => checkPath(importPath, node)),
        );
      },
      ImportDeclaration(node: ImportNode): void {
        if (node.source?.value) {
          checkPath(node.source.value, node);
        }
      },
    };
  },
});

const maxLineLengthRule = withCreateOnce({
  createOnce(context: Context) {
    return {
      Program(node: object): void {
        const source = readSource(context);

        pipe(
          findLongLines(source),
          Array.forEach((violation): void => {
            context.report({
              message: lineLengthDiagnosticMessage(violation.line, violation.length),
              node,
            });
          }),
        );
      },
    };
  },
});

const requireFileDocRule = withCreateOnce({
  createOnce(context: Context) {
    return {
      Program(node: object): void {
        const source = readSource(context);
        if (source === '') {
          return;
        }

        if (!hasRequiredFileDoc(source)) {
          context.report({
            message: fileDocDiagnosticMessage(),
            node,
          });
        }
      },
    };
  },
});

const requireFunctionDocRule = withCreateOnce({
  createOnce(context: Context) {
    return {
      Program(node: object): void {
        const source = readSource(context);
        if (source === '') {
          return;
        }

        const failure = findRequiredFunctionDocFailure(source);
        if (failure !== undefined) {
          context.report({
            message: functionDocDiagnosticMessage(failure),
            node,
          });
        }
      },
    };
  },
});

const plugin = {
  meta: {
    name: 'thethracian',
  },
  rules: {
    'acronym-case': acronymCaseRule,
    'boolean-prefix': booleanPrefixRule,
    'camel-case-identifiers': camelCaseIdentifiersRule,
    'max-import-depth': maxImportDepthRule,
    'max-line-length': maxLineLengthRule,
    'no-commented-out-code': noCommentedOutCodeRule,
    'no-dynamic-js-extension-imports': noDynamicJSExtensionImportsRule,
    'no-local-export-list': noLocalExportListRule,
    'pascal-case-types': pascalCaseTypesRule,
    'private-underscore': privateUnderscoreRule,
    'require-file-doc': requireFileDocRule,
    'require-function-doc': requireFunctionDocRule,
    ...effectDefaultRules,
    ...effectStrictRules,
  },
};

const isPlugin = (value: unknown): value is OxlintPlugin => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const rules: unknown = Reflect.get(value, 'rules');
  return typeof rules === 'object' && rules !== null;
};

if (!isPlugin(plugin)) {
  throw new TypeError('Invalid The Thracian Oxlint plugin shape.');
}

/**
 * Oxlint-compatible JavaScript plugin containing The Thracian custom rules.
 *
 * @internal
 */
export default eslintCompatPlugin(plugin);
