import type { ASTNode, ScopeStack } from '../../src/rules/effect-ast-scope';
import { describe, expect, it } from 'vitest';
import { scopesForChild, withNodeScope } from '../../src/rules/effect-ast-scope';

type Fields = {
  argument?: ASTNode;
  body?: ASTNode | ASTNode[] | null;
  boundaries?: ASTNode[];
  cases?: ASTNode[];
  consequent?: ASTNode[];
  declaration?: ASTNode | null;
  declarations?: ASTNode[];
  discriminant?: ASTNode;
  elements?: (ASTNode | null)[];
  id?: ASTNode;
  importKind?: 'type' | 'value';
  init?: ASTNode | null;
  kind?: 'const' | 'let' | 'var';
  left?: ASTNode;
  name?: string;
  param?: ASTNode;
  parameter?: ASTNode;
  params?: ASTNode[];
  properties?: ASTNode[];
  right?: ASTNode;
  specifiers?: ASTNode[];
  value?: ASTNode;
  visible?: ASTNode;
};

const ast = (type: string, fields: Fields = {}): ASTNode => ({ type, ...fields });
const identifier = (name: string): ASTNode => ast('Identifier', { name });
const declarator = (pattern: ASTNode): ASTNode => ast('VariableDeclarator', { id: pattern });
const variable = (kind: 'const' | 'let' | 'var', pattern: ASTNode): ASTNode =>
  ast('VariableDeclaration', { declarations: [declarator(pattern)], kind });
const block = (...body: ASTNode[]): ASTNode => ast('BlockStatement', { body });
const scopeNames = (scopes: ScopeStack): string[][] =>
  scopes.map((scope) => [...scope].sort((left, right) => left.localeCompare(right)));

const registerDeclarationScopeTests = (): void => {
  it('unwraps named and default export declarations without treating export lists as declarations', (): void => {
    const program = ast('Program', {
      body: [
        ast('ExportNamedDeclaration', {
          declaration: ast('ClassDeclaration', { id: identifier('NamedClass') }),
        }),
        ast('ExportDefaultDeclaration', {
          declaration: ast('FunctionDeclaration', { id: identifier('DefaultFunction') }),
        }),
        ast('ExportNamedDeclaration', { declaration: null, specifiers: [] }),
      ],
    });

    expect(scopeNames(withNodeScope([], program))).toEqual([['DefaultFunction', 'NamedClass']]);
  });

  it('collects let, const, and hoisted var at program scope but only lexical variables in blocks', (): void => {
    const declarations = [
      variable('let', identifier('letValue')),
      variable('const', identifier('constValue')),
      variable('var', identifier('varValue')),
    ];

    expect(scopeNames(withNodeScope([], ast('Program', { body: declarations })))).toEqual([
      ['constValue', 'letValue', 'varValue'],
    ]);
    expect(scopeNames(withNodeScope([], block(...declarations)))).toEqual([
      ['constValue', 'letValue'],
    ]);
  });

  it('collects value import-equals declarations and ignores type-only declarations', (): void => {
    const program = ast('Program', {
      body: [
        ast('TSImportEqualsDeclaration', {
          id: identifier('RuntimeImport'),
          importKind: 'value',
        }),
        ast('TSImportEqualsDeclaration', {
          id: identifier('TypeImport'),
          importKind: 'type',
        }),
      ],
    });

    expect(scopeNames(withNodeScope([], program))).toEqual([['RuntimeImport']]);
  });

  it('binds a qualified namespace root in its container and every runtime path segment inside it', (): void => {
    const qualifiedName = ast('TSQualifiedName', {
      left: ast('TSQualifiedName', {
        left: identifier('Root'),
        right: identifier('Middle'),
      }),
      right: identifier('Leaf'),
    });
    const declaration = ast('TSModuleDeclaration', { id: qualifiedName });

    expect(scopeNames(withNodeScope([], ast('Program', { body: [declaration] })))).toEqual([
      ['Root'],
    ]);
    expect(scopeNames(withNodeScope([], declaration))).toEqual([['Leaf', 'Middle', 'Root']]);
  });

  it('collects class, function, and enum declaration names', (): void => {
    const program = ast('Program', {
      body: [
        ast('ClassDeclaration', { id: identifier('ClassName') }),
        ast('FunctionDeclaration', { id: identifier('functionName') }),
        ast('TSEnumDeclaration', { id: identifier('EnumName') }),
      ],
    });

    expect(scopeNames(withNodeScope([], program))).toEqual([
      ['ClassName', 'EnumName', 'functionName'],
    ]);
  });

  it('does not bind type-only or declare-only shapes merely because they have an id', (): void => {
    const inherited: ScopeStack = [new Set(['outer'])];
    const program = ast('Program', {
      body: [
        ast('TSInterfaceDeclaration', { id: identifier('InterfaceOnly') }),
        ast('TSTypeAliasDeclaration', { id: identifier('AliasOnly') }),
        ast('TSDeclareFunction', { id: identifier('DeclareOnly') }),
      ],
    });

    expect(withNodeScope(inherited, program)).toBe(inherited);
  });

  it('collects wrapped, destructured, sparse, and parameter-property patterns', (): void => {
    const parameters = [
      ast('AssignmentPattern', { left: identifier('assigned') }),
      ast('RestElement', { argument: identifier('rest') }),
      ast('ObjectPattern', {
        properties: [
          ast('Property', { value: identifier('objectValue') }),
          ast('RestElement', { argument: identifier('objectRest') }),
        ],
      }),
      ast('ArrayPattern', {
        elements: [
          identifier('arrayValue'),
          null,
          ast('AssignmentPattern', { left: identifier('arrayAssigned') }),
        ],
      }),
      ast('TSParameterProperty', { parameter: identifier('parameterProperty') }),
    ];
    const functionExpression = ast('FunctionExpression', {
      id: identifier('namedFunction'),
      params: parameters,
    });

    expect(scopeNames(withNodeScope([], functionExpression))).toEqual([
      [
        'arrayAssigned',
        'arrayValue',
        'assigned',
        'namedFunction',
        'objectRest',
        'objectValue',
        'parameterProperty',
        'rest',
      ],
    ]);
  });
};

const registerContainerScopeTests = (): void => {
  it.each([
    [
      'Program',
      ast('Program', {
        body: [
          variable('let', identifier('programLet')),
          variable('var', identifier('programVar')),
        ],
      }),
      ['programLet', 'programVar'],
    ],
    [
      'BlockStatement',
      block(variable('const', identifier('blockConst')), variable('var', identifier('blockVar'))),
      ['blockConst'],
    ],
    [
      'StaticBlock',
      ast('StaticBlock', {
        body: [
          variable('const', identifier('staticConst')),
          variable('var', identifier('staticVar')),
        ],
      }),
      ['staticConst', 'staticVar'],
    ],
    [
      'TSModuleBlock',
      ast('TSModuleBlock', {
        body: [variable('let', identifier('moduleLet')), variable('var', identifier('moduleVar'))],
      }),
      ['moduleLet', 'moduleVar'],
    ],
  ] as const)('collects the exact bindings for a %s container', (_name, container, names): void => {
    expect(scopeNames(withNodeScope([], container))).toEqual([[...names].sort()]);
  });

  it('does not hoist vars through function, class, static-block, or namespace boundaries', (): void => {
    const hiddenVar = (name: string): ASTNode => variable('var', identifier(name));
    const program = ast('Program', {
      body: [],
      boundaries: [
        ast('ArrowFunctionExpression', { body: block(hiddenVar('arrowVar')), params: [] }),
        ast('FunctionDeclaration', { body: block(hiddenVar('declarationVar')), params: [] }),
        ast('FunctionExpression', { body: block(hiddenVar('expressionVar')), params: [] }),
        ast('ClassDeclaration', { body: ast('ClassBody', { body: [hiddenVar('classVar')] }) }),
        ast('StaticBlock', { body: [hiddenVar('staticVar')] }),
        ast('TSModuleBlock', { body: [hiddenVar('moduleBlockVar')] }),
        ast('TSModuleDeclaration', {
          body: ast('TSModuleBlock', { body: [hiddenVar('namespaceVar')] }),
        }),
      ],
      visible: hiddenVar('visibleVar'),
    });

    expect(scopeNames(withNodeScope([], program))).toEqual([['visibleVar']]);
  });

  it('ignores enumerable circular parent edges while collecting hoisted vars', (): void => {
    const program = ast('Program', {
      body: [variable('var', identifier('programVar'))],
    });
    const parent = block(variable('var', identifier('parentVar')));
    Reflect.set(program, 'parent', parent);
    Reflect.set(parent, 'parent', program);

    expect(scopeNames(withNodeScope([], program))).toEqual([['programVar']]);
  });
};

const registerChildScopeTests = (): void => {
  it('separates function header bindings from vars visible only on the body edge', (): void => {
    const functionNode = ast('FunctionDeclaration', {
      body: block(
        block(variable('var', identifier('bodyVar'))),
        ast('ArrowFunctionExpression', {
          body: block(variable('var', identifier('nestedFunctionVar'))),
          params: [],
        }),
      ),
      id: identifier('functionName'),
      params: [identifier('parameterName')],
    });
    const headerScopes = withNodeScope([], functionNode);

    expect(scopeNames(headerScopes)).toEqual([['functionName', 'parameterName']]);
    expect(scopesForChild(headerScopes, functionNode, 'params')).toBe(headerScopes);
    expect(scopeNames(scopesForChild(headerScopes, functionNode, 'body'))).toEqual([
      ['functionName', 'parameterName'],
      ['bodyVar'],
    ]);
  });

  it('keeps an ambient function body edge unchanged when there is no body', (): void => {
    const ambient = ast('FunctionDeclaration', {
      body: null,
      id: identifier('ambient'),
      params: [],
    });
    const headerScopes = withNodeScope([], ambient);

    expect(scopesForChild(headerScopes, ambient, 'body')).toBe(headerScopes);
  });

  it.each([
    ['for let', ast('ForStatement', { init: variable('let', identifier('forLet')) }), ['forLet']],
    ['for var', ast('ForStatement', { init: variable('var', identifier('forVar')) }), []],
    ['for expression', ast('ForStatement', { init: identifier('expression') }), []],
    [
      'for-in const',
      ast('ForInStatement', { left: variable('const', identifier('forIn')) }),
      ['forIn'],
    ],
    [
      'for-of let',
      ast('ForOfStatement', { left: variable('let', identifier('forOf')) }),
      ['forOf'],
    ],
    ['for-of var', ast('ForOfStatement', { left: variable('var', identifier('forOfVar')) }), []],
  ] as const)('collects the exact bindings for %s', (_name, loop, names): void => {
    const inherited: ScopeStack = [new Set(['outer'])];
    const result = withNodeScope(inherited, loop);

    expect(scopeNames(result)).toEqual(names.length === 0 ? [['outer']] : [['outer'], [...names]]);
    if (names.length === 0) {
      expect(result).toBe(inherited);
    }
  });

  it('preserves inherited scope identity for a ForStatement without an initializer', (): void => {
    const inherited: ScopeStack = [new Set(['outer'])];

    expect(withNodeScope(inherited, ast('ForStatement', { init: null }))).toBe(inherited);
  });

  it('collects catch bindings and named class-expression bindings', (): void => {
    expect(
      scopeNames(withNodeScope([], ast('CatchClause', { param: identifier('caught') }))),
    ).toEqual([['caught']]);
    expect(
      scopeNames(withNodeScope([], ast('ClassExpression', { id: identifier('InnerClass') }))),
    ).toEqual([['InnerClass']]);
  });

  it('adds switch-case lexical bindings only along the cases edge', (): void => {
    const switchNode = ast('SwitchStatement', {
      cases: [
        ast('SwitchCase', {
          consequent: [
            variable('const', identifier('caseConst')),
            ast('ClassDeclaration', { id: identifier('CaseClass') }),
            variable('var', identifier('caseVar')),
          ],
        }),
      ],
      discriminant: identifier('kind'),
    });
    const inherited: ScopeStack = [new Set(['outer'])];

    expect(withNodeScope(inherited, switchNode)).toBe(inherited);
    expect(scopesForChild(inherited, switchNode, 'discriminant')).toBe(inherited);
    expect(scopeNames(scopesForChild(inherited, switchNode, 'cases'))).toEqual([
      ['outer'],
      ['CaseClass', 'caseConst'],
    ]);
  });

  it('preserves scope-stack identity when a node or child edge introduces no bindings', (): void => {
    const inherited: ScopeStack = [new Set(['outer'])];
    const emptyNode = ast('ExpressionStatement');

    expect(withNodeScope(inherited, emptyNode)).toBe(inherited);
    expect(scopesForChild(inherited, emptyNode, 'expression')).toBe(inherited);
  });
};

describe('effect AST lexical scopes', (): void => {
  registerDeclarationScopeTests();
  registerContainerScopeTests();
  registerChildScopeTests();
});
