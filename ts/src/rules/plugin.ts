import { readFileSync } from 'node:fs';
import isCommentedOutCode from './no-commented-out-code.js';
import isPascalCase, { toPascalCase } from './pascal-case-types.js';
import { isCamelCase, isUpperCase, toCamelCase } from './camel-case-identifiers.js';
import hasBooleanPrefix, { suggestBooleanName } from './boolean-prefix.js';
import hasLeadingUnderscore, { suggestPrivateName } from './private-underscore.js';
import findMisCasedAcronyms, { fixAcronymCase } from './acronym-case.js';
import countImportDepth from './max-import-depth.js';

/**
 * Oxlint plugin for The Thracian custom rules.
 */

interface NamedNode {
  id?: { name: string } | null;
  key?: { name: string };
}

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
              message: 'Remove this commented-out code instead of leaving it dead.',
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
              message: 'Remove this commented-out code instead of leaving it dead.',
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
            message: `Rename boolean '${node.id.name}' to '${suggestBooleanName(node.id.name)}' (is_/has_/should_ prefix required for boolean variables).`,
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
};

const acronymCaseRule = {
  create(context: Context) {
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

interface ImportNode {
  source?: { value: string; raw: string } | null;
  arguments?: Array<{ value: string }>;
  callee?: { name: string };
}

const maxImportDepthRule = {
  create(context: Context) {
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
    'max-import-depth': maxImportDepthRule,
  },
};

export default plugin;
