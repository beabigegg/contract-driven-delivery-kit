const RESET  = '\x1b[0m';
const CYAN   = '\x1b[36m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const DIM    = '\x1b[2m';

export const log = {
  info(msg: string): void {
    console.log(`${CYAN}ℹ${RESET}  ${msg}`);
  },
  ok(msg: string): void {
    console.log(`${GREEN}✓${RESET}  ${msg}`);
  },
  warn(msg: string): void {
    console.log(`${YELLOW}⚠${RESET}  ${msg}`);
  },
  error(msg: string): void {
    console.error(`${RED}✗${RESET}  ${msg}`);
  },
  dim(msg: string): void {
    console.log(`${DIM}   ${msg}${RESET}`);
  },
  blank(): void {
    console.log('');
  },
};
