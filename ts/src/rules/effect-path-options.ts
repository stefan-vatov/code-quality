import type { Context } from './effect-rule-core';

export const isEffectTestPath = (context: Pick<Context, 'filename'>): boolean =>
  /\.(?:test|spec)\.tsx?$/.test(context.filename?.replace(/\\/g, '/') ?? '');
