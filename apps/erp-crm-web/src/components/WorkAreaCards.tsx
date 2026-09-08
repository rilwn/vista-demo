import { Icon, type IconName } from './Icon';
import { Link } from '../routing/Router';
import './work-area-cards.css';

export interface WorkAreaItem {
  path: string;
  label: string;
  description: string;
  icon: IconName;
}

export function WorkAreaCards({ items, title }: { items: WorkAreaItem[]; title: string }) {
  return (
    <nav aria-label={title} className="work-area-list">
      {items.map((item) => (
        <Link className="work-area-link" key={item.path} to={item.path}>
          <span className="work-area-symbol">
            <Icon name={item.icon} size={18} />
          </span>
          <span className="work-area-copy">
            <strong>{item.label}</strong>
            <small>{item.description}</small>
          </span>
          <span className="work-area-arrow">
            <Icon name="arrow" size={15} />
          </span>
        </Link>
      ))}
    </nav>
  );
}
