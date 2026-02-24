import { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export const PageHeader = ({ title, description, actions }: PageHeaderProps) => {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 md:mb-8">
      <div className="space-y-1">
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-foreground text-balance">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground text-balance">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 sm:gap-3">
          {actions}
        </div>
      )}
    </div>
  );
};
