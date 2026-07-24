/* -------------------------------------------------------------------------- */
/*       Normalized must-execute proofs for runtime Effect task events.       */
/* -------------------------------------------------------------------------- */

import type { RuntimeExecution } from './effect-promise-runtime-model';

/**
 * A normalized Boolean proof over exact runtime executions.
 *
 * @internal
 */
export type RuntimeProof =
  | RuntimeAllProof
  | RuntimeAnyProof
  | RuntimeEventProof
  | RuntimeFalseProof;

interface RuntimeFalseProof {
  kind: 'false';
}

interface RuntimeEventProof {
  execution: RuntimeExecution;
  kind: 'event';
}

interface RuntimeAnyProof {
  children: readonly RuntimeProof[];
  kind: 'any';
}

interface RuntimeAllProof {
  children: readonly RuntimeProof[];
  kind: 'all';
}

/**
 * Proof result retaining one exact event that satisfies the proof.
 *
 * @internal
 */
export interface RuntimeProofWitness {
  execution: RuntimeExecution;
}

/**
 * Canonical proof showing that no qualifying runtime execution exists.
 *
 * @internal
 */
export const runtimeFalseProof: RuntimeProof = Object.freeze({ kind: 'false' });

const oppositeProofKind = (kind: 'all' | 'any'): 'all' | 'any' => {
  if (kind === 'all') {
    return 'any';
  }
  return 'all';
};

/**
 * Per-interpretation hash-cons table for normalized proof nodes.
 *
 * @internal
 */
export class RuntimeProofFactory {
  readonly events = new WeakMap<RuntimeExecution, RuntimeProof>();

  readonly proofIdentifiers = new WeakMap<object, number>();

  readonly nodes = new Map<string, RuntimeProof>();

  nextProofIdentifier = 1;

  event(execution: RuntimeExecution): RuntimeProof {
    const existing = this.events.get(execution);
    if (existing) {
      return existing;
    }
    const proof: RuntimeProof = Object.freeze({ execution, kind: 'event' });
    this.events.set(execution, proof);
    return proof;
  }

  any(left: RuntimeProof, right: RuntimeProof): RuntimeProof {
    return this.composite('any', left, right);
  }

  all(left: RuntimeProof, right: RuntimeProof): RuntimeProof {
    return this.composite('all', left, right);
  }

  composite(kind: 'all' | 'any', left: RuntimeProof, right: RuntimeProof): RuntimeProof {
    const simplified = this.simplifiedComposite(kind, left, right);
    if (simplified) {
      return simplified;
    }
    return this.intern(kind, this.normalizedChildren(kind, left, right));
  }

  simplifiedComposite(
    kind: 'all' | 'any',
    left: RuntimeProof,
    right: RuntimeProof,
  ): RuntimeProof | undefined {
    if (left === right) {
      return left;
    }
    if (kind === 'all' && (left.kind === 'false' || right.kind === 'false')) {
      return runtimeFalseProof;
    }
    const absorbed = this.absorbedProof(kind, left, right);
    if (absorbed) {
      return absorbed;
    }
    return undefined;
  }

  normalizedChildren(kind: 'all' | 'any', left: RuntimeProof, right: RuntimeProof): RuntimeProof[] {
    const children = [left, right].filter(
      (proof): boolean => proof.kind !== 'false' || kind !== 'any',
    );
    children.sort(
      (first, second): number => this.proofIdentifier(first) - this.proofIdentifier(second),
    );
    return children;
  }

  intern(kind: 'all' | 'any', children: readonly RuntimeProof[]): RuntimeProof {
    const normalized = this.normalizedInternChildren(kind, children);
    return this.internNormalized(kind, normalized);
  }

  internNormalized(kind: 'all' | 'any', normalized: RuntimeProof[]): RuntimeProof {
    if (normalized.length === 0) {
      return runtimeFalseProof;
    }
    if (normalized.length === 1) {
      return normalized[0] ?? runtimeFalseProof;
    }
    const key = this.compositeKey(kind, normalized);
    return this.storeComposite(kind, normalized, key);
  }

  compositeKey(kind: 'all' | 'any', normalized: readonly RuntimeProof[]): string {
    return `${kind}:${normalized.map((child): number => this.proofIdentifier(child)).join(',')}`;
  }

  storeComposite(kind: 'all' | 'any', normalized: RuntimeProof[], key: string): RuntimeProof {
    const existing = this.nodes.get(key);
    if (existing) {
      return existing;
    }
    const proof: RuntimeProof = Object.freeze({ children: Object.freeze(normalized), kind });
    this.nodes.set(key, proof);
    return proof;
  }

  normalizedInternChildren(kind: 'all' | 'any', children: readonly RuntimeProof[]): RuntimeProof[] {
    if (kind === 'all' && children.some((proof): boolean => proof.kind === 'false')) {
      return [];
    }
    const normalized = children.filter(
      (proof): boolean => proof.kind !== 'false' || kind !== 'any',
    );
    normalized.sort(
      (first, second): number => this.proofIdentifier(first) - this.proofIdentifier(second),
    );
    return normalized.filter(
      (proof, index): boolean => index === 0 || proof !== normalized[index - 1],
    );
  }

  absorbedProof(
    kind: 'all' | 'any',
    left: RuntimeProof,
    right: RuntimeProof,
  ): RuntimeProof | undefined {
    const opposite = oppositeProofKind(kind);
    if (left.kind === opposite && left.children.includes(right)) {
      return right;
    }
    if (right.kind === opposite && right.children.includes(left)) {
      return left;
    }
    return undefined;
  }

  proofIdentifier(proof: RuntimeProof): number {
    const existing = this.proofIdentifiers.get(proof);
    if (existing) {
      return existing;
    }
    const proofIdentifier = this.nextProofIdentifier;
    this.nextProofIdentifier += 1;
    this.proofIdentifiers.set(proof, proofIdentifier);
    return proofIdentifier;
  }
}

type CachedWitness = RuntimeProofWitness | false;

interface WitnessFrame {
  index: number;
  proof: RuntimeAllProof | RuntimeAnyProof;
  witness?: RuntimeProofWitness;
}

const eventWitness = (
  proof: RuntimeEventProof,
  evaluate: (execution: RuntimeExecution) => boolean,
): CachedWitness => {
  if (evaluate(proof.execution)) {
    return { execution: proof.execution };
  }
  return false;
};

const cachedLeafWitness = (
  proof: RuntimeProof,
  evaluate: (execution: RuntimeExecution) => boolean,
  memo: WeakMap<object, CachedWitness>,
): CachedWitness | undefined => {
  const cached = memo.get(proof);
  if (cached !== undefined) {
    return cached;
  }
  if (proof.kind === 'false') {
    return cacheFalseWitness(proof, memo);
  }
  if (proof.kind === 'event') {
    const result = eventWitness(proof, evaluate);
    memo.set(proof, result);
    return result;
  }
  return undefined;
};

const cacheFalseWitness = (proof: RuntimeProof, memo: WeakMap<object, CachedWitness>): false => {
  memo.set(proof, false);
  return false;
};

const finishFrame = (
  frame: WitnessFrame,
  memo: WeakMap<object, CachedWitness>,
  stack: WitnessFrame[],
): void => {
  memo.set(frame.proof, completedFrameWitness(frame));
  stack.pop();
};

const completedFrameWitness = (frame: WitnessFrame): CachedWitness => {
  const { proof, witness } = frame;
  if (proof.kind === 'all' && witness) {
    return witness;
  }
  return false;
};

const advancedFrame = (frame: WitnessFrame, child: CachedWitness): WitnessFrame => {
  let { witness } = frame;
  if (child !== false && !witness) {
    witness = child;
  }
  return {
    index: frame.index + 1,
    proof: frame.proof,
    witness,
  };
};

const acceptChild = (
  frame: WitnessFrame,
  child: CachedWitness,
  memo: WeakMap<object, CachedWitness>,
  stack: WitnessFrame[],
): void => {
  if (frame.proof.kind === 'any' && child !== false) {
    memo.set(frame.proof, child);
    stack.pop();
    return;
  }
  if (frame.proof.kind === 'all' && child === false) {
    memo.set(frame.proof, false);
    stack.pop();
    return;
  }
  stack.splice(-1, 1, advancedFrame(frame, child));
};

const visitWitnessChild = (
  frame: WitnessFrame,
  child: RuntimeProof,
  stack: WitnessFrame[],
  evaluate: (execution: RuntimeExecution) => boolean,
  memo: WeakMap<object, CachedWitness>,
): void => {
  const cached = cachedLeafWitness(child, evaluate, memo);
  if (cached !== undefined) {
    acceptChild(frame, cached, memo, stack);
  } else if (child.kind === 'all' || child.kind === 'any') {
    stack.push({ index: 0, proof: child });
  }
};

const visitWitnessFrame = (
  stack: WitnessFrame[],
  evaluate: (execution: RuntimeExecution) => boolean,
  memo: WeakMap<object, CachedWitness>,
): void => {
  const frame = stack[stack.length - 1];
  if (!frame) {
    return;
  }
  const child = frame.proof.children[frame.index];
  if (child) {
    visitWitnessChild(frame, child, stack, evaluate, memo);
  } else {
    finishFrame(frame, memo, stack);
  }
};

const evaluateCompositeWitness = (
  proof: RuntimeAllProof | RuntimeAnyProof,
  evaluate: (execution: RuntimeExecution) => boolean,
  memo: WeakMap<object, CachedWitness>,
): CachedWitness => {
  const stack: WitnessFrame[] = [{ index: 0, proof }];
  while (stack.length > 0) {
    visitWitnessFrame(stack, evaluate, memo);
  }
  return memo.get(proof) ?? false;
};

/**
 * Evaluate a proof once per shared node and return one exact satisfying event.
 *
 * @internal
 */
export const runtimeProofWitness = (
  proof: RuntimeProof,
  evaluate: (execution: RuntimeExecution) => boolean,
): RuntimeProofWitness | undefined => {
  const memo = new WeakMap<object, CachedWitness>();
  const leaf = cachedLeafWitness(proof, evaluate, memo);
  let result = leaf;
  if (result === undefined && (proof.kind === 'all' || proof.kind === 'any')) {
    result = evaluateCompositeWitness(proof, evaluate, memo);
  }
  if (result === false) {
    return undefined;
  }
  return result;
};

const collectProofExecution = (
  current: RuntimeProof | undefined,
  pending: RuntimeProof[],
  seen: WeakSet<object>,
  executions: RuntimeExecution[],
): void => {
  if (!current || seen.has(current)) {
    return;
  }
  seen.add(current);
  if (current.kind === 'event') {
    executions.push(current.execution);
  } else if (current.kind !== 'false') {
    pending.push(...current.children);
  }
};

/**
 * Collect exact run syntax nodes referenced by a proof without expanding shared DAGs.
 *
 * @internal
 */
export const runtimeProofExecutions = (proof: RuntimeProof): readonly RuntimeExecution[] => {
  const executions: RuntimeExecution[] = [];
  const seen = new WeakSet();
  const pending = [proof];
  while (pending.length > 0) {
    collectProofExecution(pending.pop(), pending, seen, executions);
  }
  return executions;
};
