/** Import path depth fixtures for benchmarking. */

export function importDepthFixtures(): string[] {
  const paths: string[] = [
    'react',
    'lodash/map',
    '@scope/pkg/foo',
    './foo',
    './utils/bar',
    '../foo',
    '../utils/bar',
    '../../foo',
    '../../utils/bar',
    '../../../foo',
    '../../../utils/bar',
    '../../../../foo',
    '../../../../utils/bar',
    '../../../../../foo',
    '../../../../../features/auth/domain/models/user',
  ];

  const suffixes = ['foo', 'bar', 'utils/helpers', 'components/Button', 'models/User'];
  for (let d = 0; d <= 7; d++) {
    const prefix = '../'.repeat(d);
    for (const suffix of suffixes) {
      paths.push(prefix + suffix);
    }
  }

  return paths;
}
