'use client';

import { ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-xl font-medium tracking-wide transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-electric/70 disabled:opacity-50 disabled:cursor-not-allowed select-none';

const variants: Record<Variant, string> = {
  primary:
    'bg-gradient-to-b from-violet-electric to-violet-electric/80 text-white shadow-glow hover:brightness-110 active:scale-[0.98]',
  secondary:
    'bg-charcoal-700 text-slate-100 border border-charcoal-600 hover:bg-charcoal-600 active:scale-[0.98]',
  danger:
    'bg-gradient-to-b from-crimson-glow to-crimson text-white shadow-glow-crimson hover:brightness-110 active:scale-[0.98]',
  ghost: 'bg-transparent text-slate-300 hover:bg-white/5',
};

const sizes: Record<Size, string> = {
  sm: 'text-sm px-3 py-1.5',
  md: 'text-sm px-4 py-2.5',
  lg: 'text-base px-6 py-3.5',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', size = 'md', loading, className = '', children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {loading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
      )}
      {children}
    </button>
  );
});
