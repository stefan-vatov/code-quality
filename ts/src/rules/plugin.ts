import { readFileSync } from 'node:fs';
import isCommentedOutCode from './no-commented-out-code.js';
import isPascalCase from './pascal-case-types.js';
import { isCamelCase, isUpperCase } from './camel-case-identifiers.js';
import hasBooleanPrefix from './boolean-prefix.js';
import hasLeadingUnderscore from './private-underscore.js';
import findMisCasedAcronyms from './acronym-case.js';

/**
 * Oxlint plugin for The Thracian custom rules.
 */

interface NamedNode {
  id?: { name: string } | null;
  key?: { name: string };
}

// Biome-ignore lint/complexity/noBannedTypes: Oxlint ESLint-compat API
type Context = {
  report: (descriptor: { message: string; node: object }) => void;
  filename?: string;
};

const noCommentedOutCodeRule = {
  create(context: Context) {
    return {
      Program() {
        if (!context.filename) {
          return;
        }
        let source: string | undefined = undefined;
        try {
          source = readFileSync(context.filename, 'utf-8');
        } catch {
          return;
        }
        if (!source) {
          return;
        }

        const lines = source.split('\n');
        const singleLineRe = /\/\/\s*(.+)$/;
        for (let idx = 0; idx < lines.length; idx++) {
          const match = singleLineRe.exec(lines[idx]);
          if (match && isCommentedOutCode(match[1])) {
            context.report({
              message: 'Commented-out code found. Remove it instead of commenting it out.',
              node: {},
            });
          }
        }

        const multiLineRe = /\/\*\s*([\s\S]*?)\s*\*\//g;
        let mm: RegExpExecArray | null = null;
        while ((mm = multiLineRe.exec(source)) !== null) {
          const [, body] = mm;
          if (isCommentedOutCode(body)) {
            context.report({
              message: 'Commented-out code found. Remove it instead of commenting it out.',
              node: {},
            });
          }
        }
      },
    };
  },
};

const pascalCaseTypesRule = {
  create(context: Context) {
    return {
      ClassDeclaration(node: NamedNode) {
        if (node.id && !isPascalCase(node.id.name)) {
          context.report({
            message: `Class name '${node.id.name}' must be PascalCase.`,
            node,
          });
        }
      },
      TSInterfaceDeclaration(node: NamedNode) {
        if (node.id && !isPascalCase(node.id.name)) {
          context.report({
            message: `Interface name '${node.id.name}' must be PascalCase.`,
            node,
          });
        }
      },
      TSTypeAliasDeclaration(node: NamedNode) {
        if (node.id && !isPascalCase(node.id.name)) {
          context.report({
            message: `Type alias '${node.id.name}' must be PascalCase.`,
            node,
          });
        }
      },
      TSEnumDeclaration(node: NamedNode) {
        if (node.id && !isPascalCase(node.id.name)) {
          context.report({
            message: `Enum name '${node.id.name}' must be PascalCase.`,
            node,
          });
        }
      },
    };
  },
};

interface DeclNode extends NamedNode {
  parent?: { kind: string };
  init?: { type: string; value: unknown };
  typeAnnotation?: { typeAnnotation: { type: string } };
  accessibility?: string;
  type?: string;
  value?: { name: string };
}

const camelCaseIdentifiersRule = {
  create(context: Context) {
    return {
      VariableDeclarator(node: DeclNode) {
        if (!node.id) {
          return;
        }
        const { name } = node.id;
        const isConst = node.parent && node.parent.kind === 'const';
        if (isConst) {
          if (!isCamelCase(name) && !isUpperCase(name)) {
            context.report({
              message: `Constant '${name}' must be camelCase or UPPER_CASE.`,
              node,
            });
          }
        } else {
          if (!isCamelCase(name)) {
            context.report({
              message: `Variable '${name}' must be camelCase.`,
              node,
            });
          }
        }
      },
      FunctionDeclaration(node: NamedNode) {
        if (node.id && !isCamelCase(node.id.name)) {
          context.report({
            message: `Function name '${node.id.name}' must be camelCase.`,
            node,
          });
        }
      },
      Parameter(node: DeclNode) {
        if (node.type === 'Identifier' && node.value && !isCamelCase(node.value.name)) {
          context.report({
            message: `Parameter '${node.value.name}' must be camelCase.`,
            node,
          });
        }
      },
      MethodDefinition(node: NamedNode) {
        if (node.key && !isCamelCase(node.key.name)) {
          context.report({
            message: `Method '${node.key.name}' must be camelCase.`,
            node,
          });
        }
      },
      PropertyDefinition(node: NamedNode) {
        if (node.key && !isCamelCase(node.key.name)) {
          context.report({
            message: `Property '${node.key.name}' must be camelCase.`,
            node,
          });
        }
      },
    };
  },
};

const booleanPrefixRule = {
  create(context: Context) {
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
        if (!node.id) {
          return;
        }
        if (isBooleanVar(node) && !hasBooleanPrefix(node.id.name)) {
          context.report({
            message: `Boolean variable '${node.id.name}' must use is_, has_, or should_ prefix.`,
            node,
          });
        }
      },
    };
  },
};

const privateUnderscoreRule = {
  create(context: Context) {
    return {
      PropertyDefinition(node: DeclNode) {
        if (node.key && node.accessibility === 'private' && !hasLeadingUnderscore(node.key.name)) {
          context.report({
            message: `Private property '${node.key.name}' must use leading underscore.`,
            node,
          });
        }
      },
      MethodDefinition(node: DeclNode) {
        if (node.key && node.accessibility === 'private' && !hasLeadingUnderscore(node.key.name)) {
          context.report({
            message: `Private method '${node.key.name}' must use leading underscore.`,
            node,
          });
        }
      },
    };
  },
};

const acronymCaseRule = {
  create(context: Context) {
    function checkAcronyms(name: string, node: object) {
      const violations = findMisCasedAcronyms(name);
      if (violations.length > 0) {
        const listed = violations.map((acr) => `'${acr}'`).join(', ');
        context.report({
          message: `Acronym${violations.length > 1 ? 's' : ''} ${listed} in '${name}' should be uppercase.`,
          node,
        });
      }
    }

    return {
      VariableDeclarator(node: NamedNode) {
        if (node.id) {
          checkAcronyms(node.id.name, node);
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
};

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
  },
};

export default plugin;
