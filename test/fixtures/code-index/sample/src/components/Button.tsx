import type { ReactNode } from 'react';
import { helper } from '@/lib/utils';

export default function Button({ label }: { label: string }): ReactNode {
  return <button>{helper(label)}</button>;
}
