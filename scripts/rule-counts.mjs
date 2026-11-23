const nativeSyntaxOnly = 146;
const nativeTypeAware = 31;
const packageBase = 18;
const effect = 35;
const effectServiceConstructor = 1;
const repositoryOnly = 1;

const native = nativeSyntaxOnly + nativeTypeAware;
const effectEnabled = effect + effectServiceConstructor;
const syntaxOnly = nativeSyntaxOnly + packageBase;
const typeAware = native + packageBase;

const expectedRuleCounts = Object.freeze({
  effect,
  native,
  nativeSyntaxOnly,
  packageBase,
  packageWithEffect: packageBase + effectEnabled,
  repository: typeAware + effectEnabled + repositoryOnly,
  syntaxOnly,
  syntaxOnlyWithEffect: syntaxOnly + effectEnabled,
  typeAware,
  typeAwareWithEffect: typeAware + effectEnabled,
});

export { expectedRuleCounts };
