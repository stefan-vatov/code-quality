/* -------------------------------------------------------------------------- */
/*          AST-backed opt-in strict custom Effect lint rule specs.           */
/* -------------------------------------------------------------------------- */
import {
  arrayValue,
  effectCallPredicate,
  effectWrapperStatement,
  hasCryptoRandomUUID,
  hasEffectSucceedWithVoid,
  hasGlobalFetch,
  hasLayerEffectWithScope,
  hasMapFlatten,
  hasMapToVoid,
  hasMultipleProvideChain,
  hasNonDeterministicServiceKey,
  hasSchemaInstanceof,
  hasSchemaStructWithTag,
  hasSchemaUnionOfLiterals,
  identifierName,
  isMember,
  isSchemaMember,
  isVoidZero,
  literalValue,
  nodeType,
  objectValue,
  reportAST,
  serviceKeyFromClass,
} from './effect-strict-internals';
import type { RuleSpec } from './effect-rule-core';
import { isConfiguredPath } from './effect-path-options';
import { stripCommentsAndStrings } from './effect-source-helpers';

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const effectStrictASTSpecs: readonly RuleSpec[] = [
  {
    ast: (context): Record<string, (node: object) => void> => ({
      CallExpression(node): void {
        if (isMember(objectValue(node, 'callee'), 'crypto', 'randomUUID')) {
          reportAST(
            context,
            'Use Effect Random or an injected UUID service instead of crypto.randomUUID.',
            node,
          );
        }
      },
    }),
    check: hasCryptoRandomUUID,
    message: 'Use Effect Random or an injected UUID service instead of crypto.randomUUID.',
    name: 'effect-no-crypto-randomUUID',
    tokens: ['crypto.randomUUID'],
  },
  {
    ast: (context): Record<string, (node: object) => void> => ({
      BinaryExpression(node): void {
        const binary = node as { operator?: string; right?: object };
        const rightName = identifierName(binary.right);
        if (
          binary.operator === 'instanceof' &&
          rightName &&
          /(?:Schema|Request)$/.test(rightName)
        ) {
          reportAST(
            context,
            'Use Schema.is for schema-modeled domain checks instead of instanceof.',
            node,
          );
        }
      },
    }),
    check: hasSchemaInstanceof,
    message: 'Use Schema.is for schema-modeled domain checks instead of instanceof.',
    name: 'effect-require-schema-is-over-instanceof',
    tokens: ['instanceof'],
  },
  {
    ast: (context, source): Record<string, (node: object) => void> => ({
      CallExpression(node): void {
        const callArguments = arrayValue(objectValue(node, 'arguments'));
        const [firstArg] = callArguments;
        if (
          !isSchemaMember(objectValue(node, 'callee'), source, 'Struct') ||
          nodeType(firstArg) !== 'ObjectExpression'
        ) {
          return;
        }
        if (
          arrayValue(objectValue(firstArg, 'properties')).some(
            (property): boolean =>
              identifierName(objectValue(property, 'key')) === '_tag' &&
              isSchemaMember(
                objectValue(objectValue(property, 'value'), 'callee'),
                source,
                'Literal',
              ),
          )
        ) {
          reportAST(
            context,
            'Use Schema.TaggedStruct or Schema.TaggedClass instead of Struct with _tag.',
            node,
          );
        }
      },
    }),
    check: hasSchemaStructWithTag,
    message: 'Use Schema.TaggedStruct or Schema.TaggedClass instead of Struct with _tag.',
    name: 'effect-prefer-schema-tagged-struct',
    tokens: ['Schema', '_tag'],
  },
  {
    ast: (context, source): Record<string, (node: object) => void> => ({
      CallExpression(node): void {
        const callArguments = arrayValue(objectValue(node, 'arguments'));
        const literalArgCount = callArguments.filter((argument): boolean =>
          isSchemaMember(objectValue(argument, 'callee'), source, 'Literal'),
        ).length;
        if (isSchemaMember(objectValue(node, 'callee'), source, 'Union') && literalArgCount > 1) {
          reportAST(context, 'Combine literal alternatives into one Schema.Literal call.', node);
        }
      },
    }),
    check: hasSchemaUnionOfLiterals,
    message: 'Combine literal alternatives into one Schema.Literal call.',
    name: 'effect-prefer-single-schema-literal-union',
    tokens: ['Schema.Union', 'Schema.Literal', 'effect'],
  },
  {
    ast: (context, source): Record<string, (node: object) => void> => ({
      ClassDeclaration(node): void {
        const { className, key } = serviceKeyFromClass(node, source);
        if (className && key && className !== key && !key.endsWith(`/${className}`)) {
          reportAST(
            context,
            'Service/tag identifiers must deterministically match the service class.',
            node,
          );
        }
      },
    }),
    check: hasNonDeterministicServiceKey,
    message: 'Service/tag identifiers must deterministically match the service class.',
    name: 'effect-require-deterministic-service-keys',
    tokens: ['Context.Tag', 'Effect.Service', 'Effect.Tag'],
  },
  {
    check: hasMultipleProvideChain,
    message: 'Avoid chaining Effect.provide calls; compose layers deliberately at the root.',
    name: 'effect-no-multiple-provide-chain',
    tokens: ['Effect.provide'],
  },
  {
    check: hasLayerEffectWithScope,
    message: 'Use Layer.scoped when a Layer effect requires Scope.',
    name: 'effect-require-layer-scoped-when-scope-required',
    tokens: ['Layer.effect', 'Scope'],
  },
  {
    ast: (context): Record<string, (node: object) => void> => ({
      ImportDeclaration(node): void {
        const sourceValue = literalValue((node as { source?: object }).source);
        if (
          !isConfiguredPath(context, 'adapterLayers') &&
          typeof sourceValue === 'string' &&
          /^node:(?:fs|fs\/promises|path|child_process|crypto|stream|http|https)$/.test(sourceValue)
        ) {
          reportAST(
            context,
            'Use Effect platform services instead of direct Node built-in imports.',
            node,
          );
        }
      },
    }),
    message: 'Use Effect platform services instead of direct Node built-in imports.',
    name: 'effect-no-node-builtins-when-effect-platform-exists',
    tokens: ['node:'],
  },
  {
    ast: (context, source): Record<string, (node: object) => void> => ({
      CallExpression(node): void {
        const calleeName = identifierName(objectValue(node, 'callee'));
        const wrappedFetch = effectWrapperStatement(
          stripCommentsAndStrings(source),
          (node as { start?: number }).start ?? 0,
        );
        if (calleeName === 'fetch' && !isConfiguredPath(context, 'adapterLayers') && wrappedFetch) {
          reportAST(
            context,
            'Use the Effect HTTP client or an adapter service instead of global fetch.',
            node,
          );
        }
      },
    }),
    check: hasGlobalFetch,
    message: 'Use the Effect HTTP client or an adapter service instead of global fetch.',
    name: 'effect-no-global-fetch',
    tokens: ['fetch'],
  },
  {
    ast: (context, source): Record<string, (node: object) => void> => {
      const isEffectSucceed = effectCallPredicate(source, ['succeed']);
      return {
        CallExpression(node): void {
          const callArguments = arrayValue(objectValue(node, 'arguments'));
          const [firstArg] = callArguments;
          if (
            isEffectSucceed(objectValue(node, 'callee')) &&
            (!firstArg || identifierName(firstArg) === 'undefined' || isVoidZero(firstArg))
          ) {
            reportAST(context, 'Use Effect.void instead of Effect.succeed(undefined).', node);
          }
        },
      };
    },
    check: hasEffectSucceedWithVoid,
    message: 'Use Effect.void instead of Effect.succeed(undefined).',
    name: 'effect-prefer-effect-void',
    tokens: ['succeed'],
  },
  {
    check: hasMapToVoid,
    message: 'Use Effect.asVoid instead of mapping to undefined or an empty block.',
    name: 'effect-prefer-asVoid',
    tokens: ['Effect', 'effect'],
  },
  {
    check: hasMapFlatten,
    message: 'Use Effect.flatMap instead of Effect.map followed by Effect.flatten.',
    name: 'effect-prefer-flatMap-over-map-flatten',
    tokens: ['Effect', 'effect'],
  },
] satisfies readonly RuleSpec[];
