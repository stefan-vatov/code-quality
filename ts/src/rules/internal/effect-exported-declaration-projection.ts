import type { ModuleBindingDeclaration } from './effect-module-source-index';

export const sourceOrderedDeclarations = (
  declarations: readonly ModuleBindingDeclaration[],
): readonly ModuleBindingDeclaration[] => {
  let previousStart = -1;
  let isOrdered = true;
  for (const declaration of declarations) {
    if (declaration.declaratorStart < previousStart) {
      isOrdered = false;
      break;
    }
    previousStart = declaration.declaratorStart;
  }
  if (isOrdered) {
    return declarations;
  }
  return [...declarations].sort(
    (left, right): number => left.declaratorStart - right.declaratorStart,
  );
};

export const privateSiblingHasEffect = (
  source: string,
  statementStart: number,
  statementEnd: number,
  selectedDeclarations: readonly ModuleBindingDeclaration[],
): boolean => {
  const orderedDeclarations = sourceOrderedDeclarations(selectedDeclarations);
  let sourceIndex = statementStart;
  for (const declaration of orderedDeclarations) {
    if (/\b(?:Effect|Promise)\b/.test(source.slice(sourceIndex, declaration.declaratorStart))) {
      return true;
    }
    sourceIndex = Math.max(sourceIndex, declaration.declaratorEnd);
  }
  return /\b(?:Effect|Promise)\b/.test(source.slice(sourceIndex, statementEnd + 1));
};

export const declarationsGroupedByStatement = (
  declarations: readonly ModuleBindingDeclaration[],
): Map<number, ModuleBindingDeclaration[]> => {
  const grouped = new Map<number, ModuleBindingDeclaration[]>();
  for (const declaration of declarations) {
    const statementDeclarations = grouped.get(declaration.statementStart);
    if (statementDeclarations === undefined) {
      grouped.set(declaration.statementStart, [declaration]);
    } else {
      statementDeclarations.push(declaration);
    }
  }
  return grouped;
};

export const privateEffectsByStatement = (
  source: string,
  declarationsByStatement: ReadonlyMap<number, readonly ModuleBindingDeclaration[]>,
): Map<number, boolean> => {
  const privateEffects = new Map<number, boolean>();
  for (const [statementStart, declarationsAtStatement] of declarationsByStatement) {
    const [declaration] = declarationsAtStatement;
    if (declaration) {
      privateEffects.set(
        statementStart,
        privateSiblingHasEffect(
          source,
          declaration.statementStart,
          declaration.statementEnd,
          declarationsAtStatement,
        ),
      );
    }
  }
  return privateEffects;
};
