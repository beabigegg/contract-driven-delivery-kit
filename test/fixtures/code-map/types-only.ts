// types-only.ts — fixture: a file that contains nothing but type declarations
export interface Repo {
  name: string;
  stars: number;
}

export interface Owner {
  login: string;
  url: string;
}

export type Sortable<T> = T & { sortKey: string };

export type Predicate<T> = (value: T) => boolean;

export enum Severity {
  Low = 1,
  Medium,
  High,
  Critical,
}
