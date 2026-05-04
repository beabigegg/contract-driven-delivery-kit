// sample.ts — fixture for TypeScript code-map scanner tests
import { foo, bar } from './utils';
import type { Config } from './types';
import defaultExport from 'some-module';

const MAX_RETRIES = 3;
const API_BASE = 'https://example.com';

export interface User {
  id: number;
  name: string;
  email?: string;
}

interface InternalState {
  loaded: boolean;
}

export type UserId = number | string;

type LocalAlias = { x: number };

export enum Status {
  Pending = 'pending',
  Active = 'active',
  Done = 'done',
}

enum LocalEnum {
  A,
  B,
  C,
}

export class Service {
  private items: User[] = [];

  add(u: User): void {
    this.items.push(u);
  }

  async fetch(id: UserId): Promise<User | null> {
    return null;
  }
}

export function declared(x: number): number {
  return x * 2;
}

export const handler = async (id: UserId): Promise<void> => {
  await Promise.resolve();
};

const helper = function namedHelper() {
  return 42;
};

export function genericFn<T extends User>(input: T): T {
  return input;
}
