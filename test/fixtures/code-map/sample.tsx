// sample.tsx — fixture for TSX scanner tests (interfaces + JSX + forwardRef)
import { forwardRef, memo, useState } from 'react';
import type { ReactNode } from 'react';

export interface ButtonProps {
  label: string;
  onClick?: () => void;
  children?: ReactNode;
}

export interface CardProps {
  title: string;
}

export type Variant = 'primary' | 'secondary';

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { label, onClick, children },
  ref,
) {
  return (
    <button ref={ref} onClick={onClick}>
      {label}
      {children}
    </button>
  );
});

export const Card = memo(function Card({ title }: CardProps) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <h2>{title}</h2>
      <button onClick={() => setOpen(o => !o)}>
        {open ? 'close' : 'open'}
      </button>
    </section>
  );
});

export function PlainComponent({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}

export const handler = async (): Promise<void> => {
  await Promise.resolve();
};
