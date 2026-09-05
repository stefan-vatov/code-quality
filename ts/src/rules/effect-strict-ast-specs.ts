/* -------------------------------------------------------------------------- */
/*          AST-backed opt-in strict custom Effect lint rule specs.           */
/* -------------------------------------------------------------------------- */
import { Array, Option, Predicate, pipe } from 'effect';
import {
  arrayValue,
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
import type { RuleSpec, VisitorMap } from './effect-rule-core';
import { asNode } from './effect-ast';
import { effectGlobalFetchAST } from './effect-global-fetch-ast';
import { importedEffectCallMatcher } from './effect-imported-call-matcher';
import { isConfiguredPath } from './effect-path-options';

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const effectStrictASTSpecs: readonly RuleSpec[] = pipe(
  [
    {
      ast: (context): VisitorMap => ({
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
      ast: (context): VisitorMap => ({
        BinaryExpression(node): void {
          const operator = objectValue(node, 'operator');
          const rightName = identifierName(objectValue(node, 'right'));
          if (operator === 'instanceof' && rightName && /(?:Schema|Request)$/.test(rightName)) {
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
      ast: (context, source): VisitorMap => ({
        CallExpression(node): void {
          const callArguments = arrayValue(objectValue(node, 'arguments'));
          const firstArg = pipe(callArguments, Array.head, Option.getOrUndefined);
          if (
            !isSchemaMember(objectValue(node, 'callee'), source, 'Struct') ||
            nodeType(firstArg) !== 'ObjectExpression'
          ) {
            return;
          }
          if (
            pipe(
              arrayValue(objectValue(firstArg, 'properties')),
              Array.some(
                (property): boolean =>
                  identifierName(objectValue(property, 'key')) === '_tag' &&
                  isSchemaMember(
                    objectValue(objectValue(property, 'value'), 'callee'),
                    source,
                    'Literal',
                  ),
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
      ast: (context, source): VisitorMap => ({
        CallExpression(node): void {
          const callArguments = arrayValue(objectValue(node, 'arguments'));
          const literalArgCount = pipe(
            callArguments,
            Array.filter((argument): boolean =>
              isSchemaMember(objectValue(argument, 'callee'), source, 'Literal'),
            ),
            Array.length,
          );
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
      ast: (context, source): VisitorMap => ({
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
      ast: (context): VisitorMap => ({
        ImportDeclaration(node): void {
          const sourceValue = literalValue(objectValue(node, 'source'));
          if (
            !isConfiguredPath(context, 'adapterLayers') &&
            Predicate.isString(sourceValue) &&
            /^node:(?:fs|fs\/promises|path|child_process|crypto|stream|http|https)$/.test(
              sourceValue,
            )
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
      ast: (context, source): VisitorMap => {
        if (isConfiguredPath(context, 'adapterLayers')) {
          return { Program(): void {} };
        }
        return effectGlobalFetchAST(context, source);
      },
      check: hasGlobalFetch,
      message: 'Use the Effect HTTP client or an adapter service instead of global fetch.',
      name: 'effect-no-global-fetch',
      tokens: ['fetch'],
    },
    {
      ast: (context): VisitorMap => {
        const effectSucceed = importedEffectCallMatcher(context, 'Effect', ['succeed']);
        return {
          CallExpression(node): void {
            const callArguments = arrayValue(objectValue(node, 'arguments'));
            const firstArg = pipe(callArguments, Array.head, Option.getOrUndefined);
            if (
              effectSucceed.matches(asNode(objectValue(node, 'callee'))) &&
              (!firstArg || identifierName(firstArg) === 'undefined' || isVoidZero(firstArg))
            ) {
              reportAST(context, 'Use Effect.void instead of Effect.succeed(undefined).', node);
            }
          },
          Program: effectSucceed.initialize,
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
  ] satisfies readonly RuleSpec[],
  Array.map((spec): RuleSpec => spec),
);
