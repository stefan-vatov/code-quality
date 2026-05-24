/* -------------------------------------------------------------------------- */
/*       Oxlint JavaScript plugin entry for The Thracian custom rules.        */
/* -------------------------------------------------------------------------- */
import findMisCasedAcronyms, { fixAcronymCase } from './acronym-case';
import hasLeadingUnderscore, { suggestPrivateName } from './private-underscore';
import { isCamelCase, isUpperCase, toCamelCase } from './camel-case-identifiers';
import isPascalCase, { toPascalCase } from './pascal-case-types';
import countImportDepth from './max-import-depth';
import effectDefaultRules from './effect-default';
import effectStrictRules from './effect-strict';
import { eslintCompatPlugin } from '@oxlint/plugins';
import findLongLines from './max-line-length';
import hasBooleanPrefix from './boolean-prefix';
import hasRequiredFileDoc from './require-file-doc';
import hasRequiredFunctionDocs from './require-function-doc';
import noCommentedOutCodeRule from './plugin-commented-out-code-rule';
import { readCachedSource } from './source-cache';

/**
 * Oxlint plugin for The Thracian custom rules.
 */

interface NamedNode {
  id?: IdentifierNode | null;
  key?: IdentifierNode;
}

interface IdentifierNode {
  name: string;
  range?: [number, number];
}

const getIdentifierName = (node: { name?: unknown } | null | undefined): string | undefined => {
  if (typeof node?.name === 'string') {
    return node.name;
  }
  return undefined;
};

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

const isBooleanVar = (node: DeclNode): boolean => {
  if (
    node.typeAnnotation &&
    node.typeAnnotation.typeAnnotation &&
    node.typeAnnotation.typeAnnotation.type === 'TSBooleanKeyword'
  ) {
    return true;
  }
  if (node.init && node.init.type === 'Literal' && typeof node.init.value === 'boolean') {
    return true;
  }
  return false;
};

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
        message: `Rename ${kind} from '${name}' to '${toPascalCase(name)}' (PascalCase required for types).`,
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
            message: `Rename function '${node.id.name}' to '${toCamelCase(node.id.name)}' (camelCase required).`,
            node,
          });
        }
      },
      MethodDefinition(node: NamedNode): void {
        if (node.key && !isCamelCase(node.key.name)) {
          context.report({
            message: `Rename method '${node.key.name}' to '${toCamelCase(node.key.name)}' (camelCase required).`,
            node,
          });
        }
      },
      Parameter(node: DeclNode): void {
        if (node.type === 'Identifier' && node.value && !isCamelCase(node.value.name)) {
          context.report({
            message: `Rename parameter '${node.value.name}' to '${toCamelCase(node.value.name)}' (camelCase required).`,
            node,
          });
        }
      },
      PropertyDefinition(node: NamedNode): void {
        if (node.key && !isCamelCase(node.key.name)) {
          context.report({
            message: `Rename property '${node.key.name}' to '${toCamelCase(node.key.name)}' (camelCase required).`,
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
          if (!isCamelCase(name) && !isUpperCase(name)) {
            context.report({
              message: `Rename constant '${name}' to '${toCamelCase(name)}' for camelCase, or '${name.toUpperCase()}' for UPPER_CASE convention.`,
              node,
            });
          }
        } else {
          if (!isCamelCase(name)) {
            context.report({
              message: `Rename variable '${name}' to '${toCamelCase(name)}' (camelCase required).`,
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
            message: `Rename boolean '${name}' with an is_/has_/should_ prefix.`,
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
            message:
              `Rename private method '${node.key.name}' to '${replacement}' ` +
              '(leading underscore required for private members).',
            node,
          });
        }
      },
      PropertyDefinition(node: DeclNode): void {
        if (node.key && node.accessibility === 'private' && !hasLeadingUnderscore(node.key.name)) {
          const replacement = suggestPrivateName(node.key.name);
          context.report({
            message:
              `Rename private property '${node.key.name}' to '${replacement}' ` +
              '(leading underscore required for private members).',
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
      if (violations.length > 0) {
        const listed = violations.map((acr) => `'${acr}'`).join(', ');
        const replacement = fixAcronymCase(name);
        const pluralSuffix = ((): string => {
          if (violations.length > 1) {
            return 's';
          }
          return '';
        })();
        context.report({
          message: `Rename '${name}' to '${replacement}' — acronym${pluralSuffix} ${listed} must be uppercase.`,
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
    message: `Use extensionless TypeScript module specifiers instead of emitted JavaScript extension '${specifier}'.`,
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
        const firstArgument = node.arguments?.[0]?.value;
        if (isJavaScriptSpecifier(firstArgument)) {
          reportJavaScriptSpecifier(context, node, firstArgument);
        }
      },
      ImportExpression(node: RuntimeSpecifierNode): void {
        const source = node.source?.value;
        if (isJavaScriptSpecifier(source)) {
          reportJavaScriptSpecifier(context, node, source);
        }
      },
    };
  },
});

interface ExportNamedNode {
  declaration?: object | null;
  source?: object | null;
  specifiers?: object[];
}

const noLocalExportListRule = withCreateOnce({
  createOnce(context: Context) {
    return {
      ExportNamedDeclaration(node: ExportNamedNode): void {
        if (node.source || node.declaration || !node.specifiers || node.specifiers.length === 0) {
          return;
        }
        context.report({
          message:
            'Export declarations inline at their definition instead of using a local export list.',
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
          message:
            `Import path depth ${depth} exceeds maximum of ${MAX_DEPTH} ` +
            `(found '${importPath}'). Use a flatter directory structure or path alias.`,
          node,
        });
      }
    };

    return {
      CallExpression(node: ImportNode): void {
        if (
          node.callee?.name === 'require' &&
          node.arguments &&
          node.arguments.length > 0 &&
          typeof node.arguments[0].value === 'string'
        ) {
          checkPath(node.arguments[0].value, node);
        }
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

        for (const violation of findLongLines(source)) {
          context.report({
            message: `Line ${violation.line} has ${violation.length} characters, exceeding the maximum of 150.`,
            node,
          });
        }
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
            message: `Missing file-purpose header. Add a top-of-file divider header in this exact format:
/* -------------------------------------------------------------------------- */
/*                     Describe this file's purpose here.                     */
/* -------------------------------------------------------------------------- */

The text line must be a real description of what the file is for; declaration JSDoc does not count.`,
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

        if (!hasRequiredFunctionDocs(source)) {
          context.report({
            message: `Missing public declaration JSDoc. Add a /** ... */ block immediately above the export in this shape:
/**
 * Describe what this exported declaration does.
 *
 * @param name - Describe this parameter.
 * @returns Describe the return value.
 * @throws Describe expected error conditions, or state that it does not throw.
 */

The prose must be specific; generated placeholder text does not satisfy the rule.`,
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

const pluginInput: unknown = plugin;

if (!isPlugin(pluginInput)) {
  throw new TypeError('Invalid The Thracian Oxlint plugin shape.');
}

/**
 * Oxlint-compatible JavaScript plugin containing The Thracian custom rules.
 *
 * @internal
 */
export default eslintCompatPlugin(pluginInput);
