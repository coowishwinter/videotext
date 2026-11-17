import React from 'react';
import { FolderPlus } from 'lucide-react';
import { ActiveNavTab } from '../types/transcribe';

interface TopHeaderProps {
  activeTab: ActiveNavTab;
  onSelectTab: (tab: ActiveNavTab) => void;
  onOpenFilePicker: () => void;
}

const NAV_ITEMS: Array<{ id: ActiveNavTab; label: string }> = [
  { id: 'workspace', label: '转录工作台' },
  { id: 'models', label: '离线模型库' },
  { id: 'formats', label: '导出规范' },
  { id: 'privacy', label: '隐私与说明' },
];

export const TopHeader: React.FC<TopHeaderProps> = ({
  activeTab,
  onSelectTab,
  onOpenFilePicker,
}) => {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-8 border-b border-slate-200 bg-white/95 px-4 backdrop-blur-sm sm:px-6 dark:border-slate-800 dark:bg-slate-900/95">
      {/* Zone 1: Single-line Brand Wordmark */}
      <button
        type="button"
        onClick={() => onSelectTab('workspace')}
        className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded dark:text-slate-100"
      >
        声迹工坊
      </button>

      {/* Zone 2: Concise single-line navigation links */}
      <nav
        aria-label="主导航"
        className="hidden md:flex items-center gap-6 overflow-x-auto"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`relative py-4 text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                isActive
                  ? 'text-blue-700 dark:text-blue-400'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {item.label}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-600 dark:bg-blue-400"
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Single primary action */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onOpenFilePicker}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 whitespace-nowrap shrink-0 dark:bg-blue-600 dark:hover:bg-blue-500"
        >
          <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
          添加媒体文件
        </button>
      </div>
    </header>
  );
};
