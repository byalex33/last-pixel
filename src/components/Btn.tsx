import type { ButtonHTMLAttributes, MouseEvent } from 'react';
import { sfx } from '../game/audio';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost';
  active?: boolean;
}

export function Btn({ variant = 'default', active, className = '', onClick, ...rest }: Props) {
  const handle = (e: MouseEvent<HTMLButtonElement>) => {
    sfx.unlock();
    onClick?.(e);
    // Drop focus so Space stays bound to "send wave" instead of re-clicking this button.
    e.currentTarget.blur();
  };
  return (
    <button
      type="button"
      className={`btn btn-${variant}${active ? ' is-active' : ''} ${className}`}
      onClick={handle}
      {...rest}
    />
  );
}
