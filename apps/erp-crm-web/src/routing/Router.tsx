import {
  createContext,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export interface RouteLocation {
  pathname: string;
  state: unknown;
}

interface NavigateOptions {
  replace?: boolean;
  state?: unknown;
}

interface RouterValue {
  location: RouteLocation;
  navigate: (to: string, options?: NavigateOptions) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export function RouterProvider({
  children,
  initialPath,
}: PropsWithChildren<{ initialPath?: string }>) {
  const memoryMode = initialPath !== undefined;
  const [location, setLocation] = useState<RouteLocation>(() => ({
    pathname: normalizePath(initialPath ?? window.location.pathname),
    state: memoryMode ? null : window.history.state,
  }));

  useEffect(() => {
    if (memoryMode) return;
    const handlePopState = (event: PopStateEvent) => {
      setLocation({ pathname: normalizePath(window.location.pathname), state: event.state });
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [memoryMode]);

  const navigate = useCallback(
    (to: string, options: NavigateOptions = {}) => {
      const pathname = normalizePath(to);
      if (!memoryMode) {
        const method = options.replace ? 'replaceState' : 'pushState';
        window.history[method](options.state ?? null, '', pathname);
      }
      setLocation({ pathname, state: options.state ?? null });
      if (!memoryMode) window.scrollTo({ left: 0, top: 0 });
    },
    [memoryMode],
  );

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const context = useContext(RouterContext);
  if (!context) throw new Error('useRouter must be used within RouterProvider');
  return context;
}

export function Navigate({
  replace = false,
  state,
  to,
}: {
  replace?: boolean;
  state?: unknown;
  to: string;
}) {
  const { navigate } = useRouter();
  useEffect(() => navigate(to, { replace, state }), [navigate, replace, state, to]);
  return null;
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'href' | 'onClick'> & {
  className?: string | ((state: { isActive: boolean }) => string | undefined);
  end?: boolean;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  to: string;
};

export function Link({
  children,
  className,
  end = false,
  onClick,
  target,
  to,
  ...props
}: LinkProps) {
  const { location, navigate } = useRouter();
  const isActive = end ? location.pathname === to : location.pathname.startsWith(to);
  const resolvedClassName = typeof className === 'function' ? className({ isActive }) : className;

  function follow(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      target === '_blank'
    ) {
      return;
    }
    event.preventDefault();
    navigate(to);
  }

  return (
    <a {...props} className={resolvedClassName} href={to} onClick={follow} target={target}>
      {children}
    </a>
  );
}

function normalizePath(path: string): string {
  const withoutOrigin = path.startsWith('/') ? path : `/${path}`;
  const [pathname = '/'] = withoutOrigin.split(/[?#]/u, 1);
  return pathname !== '/' ? pathname.replace(/\/+$/u, '') : pathname;
}
