export type IconName =
  | 'activity'
  | 'arrow'
  | 'bell'
  | 'brand'
  | 'chart'
  | 'check'
  | 'chevron'
  | 'close'
  | 'copy'
  | 'customers'
  | 'finance'
  | 'home'
  | 'key'
  | 'language'
  | 'logistics'
  | 'logout'
  | 'menu'
  | 'organization'
  | 'plus'
  | 'procurement'
  | 'profile'
  | 'sales'
  | 'search'
  | 'service'
  | 'shield'
  | 'warehouse';

interface IconProps {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 19 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className="app-icon"
      fill="none"
      focusable="false"
      height={size}
      shapeRendering="geometricPrecision"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name]}
    </svg>
  );
}

const paths: Record<IconName, React.ReactNode> = {
  activity: <path d="M3 12h4l2.3-6 4.2 12 2.2-6H21" />,
  arrow: <path d="m9 18 6-6-6-6M4 12h11" />,
  bell: <path d="M18 10a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 22h4" />,
  brand: (
    <>
      <path d="M3.8 5.2 10.3 19 20.2 5.2" />
      <path d="M8 5.2 12 13.8l4.2-8.6" />
      <circle cx="20.2" cy="5.2" fill="currentColor" r="1.35" stroke="none" />
    </>
  ),
  chart: <path d="M4 19V9m5 10V5m6 14v-7m5 7V8M3 19h18" />,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m8 10 4 4 4-4" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="13" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </>
  ),
  customers: (
    <>
      <path d="M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20" />
      <circle cx="10" cy="8" r="3" />
      <path d="M16 11a3 3 0 1 0 0-6m1 10a3.5 3.5 0 0 1 3 3.5V20" />
    </>
  ),
  finance: (
    <>
      <rect height="16" rx="2" width="18" x="3" y="4" />
      <path d="M3 9h18M7 15h4" />
    </>
  ),
  home: <path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1v-9Z" />,
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8-8m-3 3 2 2m-5 1 2 2" />
    </>
  ),
  language: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.3 2.5 3.5 5.5 3.5 9S14.3 18.5 12 21M12 3C9.7 5.5 8.5 8.5 8.5 12s1.2 6.5 3.5 9" />
    </>
  ),
  logistics: (
    <>
      <path d="M3 6h11v11H3zM14 10h4l3 4v3h-7z" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>
  ),
  logout: <path d="M10 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5m5-4 4-3-4-3m4 3H9" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  organization: (
    <>
      <path d="M4 21V8l8-5 8 5v13M8 21v-5h8v5M8 10h2m4 0h2" />
      <path d="M2 21h20" />
    </>
  ),
  procurement: (
    <>
      <path d="M5 7h14l-1 13H6L5 7Z" />
      <path d="M9 7V5a3 3 0 0 1 6 0v2" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 21a7 7 0 0 1 14 0" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  sales: (
    <>
      <path d="M20 12V5H4v14h9" />
      <path d="M8 9h8M8 13h5m3 5h6m-3-3v6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  service: (
    <path d="M14.7 6.3a4 4 0 0 0-5 5L3 18v3h3l6.7-6.7a4 4 0 0 0 5-5l-2.3 2.3-3-3 2.3-2.3Z" />
  ),
  shield: <path d="M12 22s8-3.8 8-10.5V5l-8-3-8 3v6.5C4 18.2 12 22 12 22Zm-3-10 2 2 4-5" />,
  warehouse: (
    <>
      <path d="m3 10 9-6 9 6v10H3V10Z" />
      <path d="M7 20v-7h10v7M9 16h6" />
    </>
  ),
};
