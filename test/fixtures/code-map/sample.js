// sample.js — fixture for code-map scanner tests
import { foo, bar } from './utils.js';
import defaultExport from 'some-module';
import 'side-effect-module';

const require = createRequire(import.meta.url);
require('legacy-module');

const MAX_RETRIES = 3;
const API_BASE_URL = 'https://example.com';

export class Bar {
  compute(x) {
    return x * 2;
  }
}

export const handler = async () => {
  const result = await fetch(API_BASE_URL);
  return result.json();
};

export function declared() {
  return 'declared function';
}

const helper = function namedHelper() {
  return 42;
};

export default {
  Bar,
  handler,
  declared,
  helper,
};
