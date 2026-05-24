import { eslintCompatPlugin } from '@oxlint/plugins';
import isCommentedOutCode from './no-commented-out-code.js';
import isPascalCase, { toPascalCase } from './pascal-case-types.js';
import { isCamelCase, isUpperCase, toCamelCase } from './camel-case-identifiers.js';
import hasBooleanPrefix, { suggestBooleanName } from './boolean-prefix.js';
import hasLeadingUnderscore, { suggestPrivateName } from './private-underscore.js';
import findMisCasedAcronyms, { fixAcronymCase } from './acronym-case.js';
import findLongLines from './max-line-length.js';
import countImportDepth from './max-import-depth.js';
import hasRequiredFileDoc from './require-file-doc.js';
import hasRequiredFunctionDocs from './require-function-doc.js';
import { readCachedSource } from './source-cache.js';
import effectDefaultRules from './effect-default.js';
import effectStrictRules from './effect-strict.js';

/**
 * Oxlint plugin for The Thracian custom rules.
 */

interface NamedNode {
  id?: { name: string } | null;
  key?: { name: string };
}

function getIdentifierName(node: { name?: unknown } | null | undefined): string | undefined {
  return typeof node?.name === 'string' ? node.name : undefined;
}

type Context = {
  report: (descriptor: { message: string; node: object }) => void;
  filename?: string;
};

type VisitorMap = Record<string, ((node: never) => void) | undefined>;

function readSource(context: Context): string {
  return readCachedSource(context);
}

function withCreateOnce<
  RuleWithCreateOnce extends { createOnce: (context: Context) => VisitorMap },
>(rule: RuleWithCreateOnce): RuleWithCreateOnce & { create: RuleWithCreateOnce['createOnce'] } {
  return Object.assign(rule, { create: rule.createOnce });
}

function reportCommentedOutCode(context: Context, node: object, source: string): void {
  let searchStart = 0;
  while (searchStart < source.length) {
    const lineCommentStart = source.indexOf('//', searchStart);
    const blockCommentStart = source.indexOf('/*', searchStart);

    if (lineCommentStart === -1 && blockCommentStart === -1) {
      return;
    }

    if (
      blockCommentStart !== -1 &&
      (lineCommentStart === -1 || blockCommentStart < lineCommentStart)
    ) {
      const bodyStart = blockCommentStart + 2;
      const bodyEnd = source.indexOf('*/', bodyStart);
      const commentEnd = bodyEnd === -1 ? source.length : bodyEnd;
      if (isCommentedOutCode(source.slice(bodyStart, commentEnd))) {
        context.report({
          message: 'Remove this commented-out code instead of leaving it dead.',
          node,
        });
      }
      searchStart = bodyEnd === -1 ? source.length : bodyEnd + 2;
      continue;
    }

    const bodyStart = lineCommentStart + 2;
    const bodyEnd = source.indexOf('\n', bodyStart);
    const commentEnd = bodyEnd === -1 ? source.length : bodyEnd;
    if (isCommentedOutCode(source.slice(bodyStart, commentEnd))) {
      context.report({
        message: 'Remove this commented-out code instead of leaving it dead.',
        node,
      });
    }
    searchStart = bodyEnd === -1 ? source.length : bodyEnd + 1;
  }
}

const noCommentedOutCodeRule = withCreateOnce({
  createOnce(context: Context) {
    return {
      Program(node: object) {
        const source = readSource(context);
        if (!source) {
          return;
        }

        reportCommentedOutCode(context, node, source);
      },
    };
  },
});

const pascalCaseTypesRule = withCreateOnce({
  createOnce(context: Context) {
    function reportType(kind: string, name: string, node: object) {
      context.report({
        message: `Rename ${kind} from '${name}' to '${toPascalCase(name)}' (PascalCase required for types).`,
        node,
      });
    }

    return {
      ClassDeclaration(node: NamedNode) {
        if (node.id && !isPascalCase(node.id.name)) {
          reportType('class', node.id.name, node);
        }
      },
      TSInterfaceDeclaration(node: NamedNode) {
        if (node.id && !isPascalCase(node.id.name)) {
          reportType('interface', node.id.name, node);
        }
      },
      TSTypeAliasDeclaration(node: NamedNode) {
        if (node.id && !isPascalCase(node.id.name)) {
          reportType('type', node.id.name, node);
        }
      },
      TSEnumDeclaration(node: NamedNode) {
        if (node.id && !isPascalCase(node.id.name)) {
          reportType('enum', node.id.name, node);
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
      VariableDeclarator(node: DeclNode) {
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
      FunctionDeclaration(node: NamedNode) {
        if (node.id && !isCamelCase(node.id.name)) {
          context.report({
            message: `Rename function '${node.id.name}' to '${toCamelCase(node.id.name)}' (camelCase required).`,
            node,
          });
        }
      },
      Parameter(node: DeclNode) {
        if (node.type === 'Identifier' && node.value && !isCamelCase(node.value.name)) {
          context.report({
            message: `Rename parameter '${node.value.name}' to '${toCamelCase(node.value.name)}' (camelCase required).`,
            node,
          });
        }
      },
      MethodDefinition(node: NamedNode) {
        if (node.key && !isCamelCase(node.key.name)) {
          context.report({
            message: `Rename method '${node.key.name}' to '${toCamelCase(node.key.name)}' (camelCase required).`,
            node,
          });
        }
      },
      PropertyDefinition(node: NamedNode) {
        if (node.key && !isCamelCase(node.key.name)) {
          context.report({
            message: `Rename property '${node.key.name}' to '${toCamelCase(node.key.name)}' (camelCase required).`,
            node,
          });
        }
      },
    };
  },
});

const booleanPrefixRule = withCreateOnce({
  createOnce(context: Context) {
    function isBooleanVar(node: DeclNode): boolean {
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
    }

    return {
      VariableDeclarator(node: DeclNode) {
        const name = getIdentifierName(node.id);
        if (!name) {
          return;
        }
        if (isBooleanVar(node) && !hasBooleanPrefix(name)) {
          context.report({
            message: `Rename boolean '${name}' to '${suggestBooleanName(name)}' (is_/has_/should_ prefix required for boolean variables).`,
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
      PropertyDefinition(node: DeclNode) {
        if (node.key && node.accessibility === 'private' && !hasLeadingUnderscore(node.key.name)) {
          context.report({
            message: `Rename private property '${node.key.name}' to '${suggestPrivateName(node.key.name)}' (leading underscore required for private members).`,
            node,
          });
        }
      },
      MethodDefinition(node: DeclNode) {
        if (node.key && node.accessibility === 'private' && !hasLeadingUnderscore(node.key.name)) {
          context.report({
            message: `Rename private method '${node.key.name}' to '${suggestPrivateName(node.key.name)}' (leading underscore required for private members).`,
            node,
          });
        }
      },
    };
  },
});

const acronymCaseRule = withCreateOnce({
  createOnce(context: Context) {
    function checkAcronyms(name: string, node: object) {
      const violations = findMisCasedAcronyms(name);
      if (violations.length > 0) {
        const listed = violations.map((acr) => `'${acr}'`).join(', ');
        context.report({
          message: `Rename '${name}' to '${fixAcronymCase(name)}' — acronym${violations.length > 1 ? 's' : ''} ${listed} must be uppercase.`,
          node,
        });
      }
    }

    return {
      VariableDeclarator(node: NamedNode) {
        const name = getIdentifierName(node.id);
        if (name) {
          checkAcronyms(name, node);
        }
      },
      FunctionDeclaration(node: NamedNode) {
        if (node.id) {
          checkAcronyms(node.id.name, node);
        }
      },
      ClassDeclaration(node: NamedNode) {
        if (node.id) {
          checkAcronyms(node.id.name, node);
        }
      },
      MethodDefinition(node: NamedNode) {
        if (node.key) {
          checkAcronyms(node.key.name, node);
        }
      },
      PropertyDefinition(node: NamedNode) {
        if (node.key) {
          checkAcronyms(node.key.name, node);
        }
      },
      Parameter(node: DeclNode) {
        if (node.type === 'Identifier' && node.value) {
          checkAcronyms(node.value.name, node);
        }
      },
    };
  },
});

interface ImportNode {
  source?: { value: string; raw: string } | null;
  arguments?: Array<{ value: string }>;
  callee?: { name: string };
}

const maxImportDepthRule = withCreateOnce({
  createOnce(context: Context) {
    const MAX_DEPTH = 4;

    function checkPath(importPath: string, node: object) {
      const depth = countImportDepth(importPath);
      if (depth > MAX_DEPTH) {
        context.report({
          message: `Import path depth ${depth} exceeds maximum of ${MAX_DEPTH} (found '${importPath}'). Use a flatter directory structure or path alias.`,
          node,
        });
      }
    }

    return {
      ImportDeclaration(node: ImportNode) {
        if (node.source?.value) {
          checkPath(node.source.value, node);
        }
      },
      CallExpression(node: ImportNode) {
        if (
          node.callee?.name === 'require' &&
          node.arguments &&
          node.arguments.length > 0 &&
          typeof node.arguments[0].value === 'string'
        ) {
          checkPath(node.arguments[0].value, node);
        }
      },
    };
  },
});

const maxLineLengthRule = withCreateOnce({
  createOnce(context: Context) {
    return {
      Program(node: object) {
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
      Program(node: object) {
        const source = readSource(context);
        if (source === '') {
          return;
        }

        if (!hasRequiredFileDoc(source)) {
          context.report({
            message:
              'File must have a JSDoc header comment (' +
              '/** ... */)' +
              ' describing its purpose. Use // @internal to opt out for internal modules.',
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
      Program(node: object) {
        const source = readSource(context);
        if (source === '') {
          return;
        }

        if (!hasRequiredFunctionDocs(source)) {
          context.report({
            message:
              'Missing JSDoc on an exported declaration. Every public function, class, type, ' +
              'interface, enum, and const must have a non-empty /** ... */ JSDoc comment with ' +
              'a description of its purpose, parameters, return value, and error conditions.',
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
    'no-commented-out-code': noCommentedOutCodeRule,
    'pascal-case-types': pascalCaseTypesRule,
    'camel-case-identifiers': camelCaseIdentifiersRule,
    'boolean-prefix': booleanPrefixRule,
    'private-underscore': privateUnderscoreRule,
    'acronym-case': acronymCaseRule,
    'max-import-depth': maxImportDepthRule,
    'max-line-length': maxLineLengthRule,
    'require-file-doc': requireFileDocRule,
    'require-function-doc': requireFunctionDocRule,
    ...effectDefaultRules,
    ...effectStrictRules,
  },
};

export default eslintCompatPlugin(plugin as never);
