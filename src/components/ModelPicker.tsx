import { useState, useRef, useEffect, useMemo, useId } from 'react';
import { ChevronDown, Check, Search, Sparkles, X, Plus } from 'lucide-react';
import type { Model } from '../lib/types';
import {
  getModelCategory,
  formatModelDisplayName,
  getModelTags,
  enrichModel,
  type ModelCategory,
  type ModelCapability
} from '../lib/models';
import {
  ChatAgentSvg,
  ImageSynthesisSvg,
  VideoMotionSvg,
  AudioWaveSvg,
  ModelChipSvg,
  AnimatedRefreshSvg
} from './svg/AnimatedIcons';

interface ModelPickerProps {
  value: string;
  onChange: (modelId: string) => void;
  models: Model[];
  targetCategory?: ModelCategory;
  disabled?: boolean;
  onRefresh?: () => Promise<void> | void;
  loading?: boolean;
  label?: string;
  className?: string;
}

export default function ModelPicker({
  value,
  onChange,
  models,
  targetCategory,
  disabled = false,
  onRefresh,
  loading = false,
  label = 'AI 模型',
  className = '',
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<ModelCategory | 'all'>(targetCategory || 'all');
  const [customInput, setCustomInput] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownId = useId();

  // 解析丰富模型列表
  const enrichedModels: ModelCapability[] = useMemo(() => {
    return models.map(m => enrichModel(m));
  }, [models]);

  // 当前选中的模型信息
  const currentModelInfo = useMemo(() => {
    const found = enrichedModels.find(m => m.id === value);
    if (found) return found;
    const cat = getModelCategory(value);
    return {
      id: value,
      name: formatModelDisplayName(value) || value || '未选择模型',
      category: cat,
      categoryLabel: cat === 'chat' ? '对话' : cat === 'image' ? '图像' : cat === 'video' ? '视频' : cat === 'music' ? '音乐' : '模型',
      tags: getModelTags(value, cat),
      description: '当前正在使用的模型',
    };
  }, [value, enrichedModels]);

  // 点击外部关闭弹层
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleOutsideClick);
      searchInputRef.current?.focus();
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [open]);

  // 过滤后的模型列表
  const filteredModels = useMemo(() => {
    return enrichedModels.filter(m => {
      if (targetCategory && m.category !== targetCategory) return false;
      // 筛选分类
      if (activeTab !== 'all' && m.category !== activeTab) {
        return false;
      }
      // 搜索框过滤
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const matchesId = m.id.toLowerCase().includes(q);
        const matchesName = m.name.toLowerCase().includes(q);
        const matchesTags = m.tags.some(t => t.toLowerCase().includes(q));
        return matchesId || matchesName || matchesTags;
      }
      return true;
    });
  }, [enrichedModels, activeTab, search, targetCategory]);

  const selectModel = (id: string) => {
    onChange(id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleApplyCustom = () => {
    if (customInput.trim()) {
      onChange(customInput.trim());
      setOpen(false);
      triggerRef.current?.focus();
      setCustomInput('');
      setShowCustomInput(false);
    }
  };

  const getCategoryIcon = (cat: ModelCategory, size = 16, active = false) => {
    switch (cat) {
      case 'chat':
        return <ChatAgentSvg size={size} active={active} />;
      case 'image':
        return <ImageSynthesisSvg size={size} active={active} />;
      case 'video':
        return <VideoMotionSvg size={size} active={active} />;
      case 'music':
        return <AudioWaveSvg size={size} active={active} />;
      default:
        return <ModelChipSvg size={size} />;
    }
  };

  return (
    <div className={`model-picker-wrapper ${className}`} ref={containerRef} onKeyDown={e => { if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); triggerRef.current?.focus(); } }}>
      {/* 触发器按钮 */}
      <button
        ref={triggerRef}
        type="button"
        className={`model-picker-trigger ${open ? 'expanded' : ''} ${disabled ? 'disabled' : ''}`}
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        aria-label={`${label}：当前为 ${currentModelInfo.name}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? dropdownId : undefined}
      >
        <div className="trigger-chip-icon">
          {getCategoryIcon(currentModelInfo.category, 16, true)}
        </div>
        <div className="trigger-content">
          <span className="trigger-name" title={currentModelInfo.id}>
            {currentModelInfo.name}
          </span>
          {currentModelInfo.tags[0] && (
            <span className="trigger-tag">{currentModelInfo.tags[0]}</span>
          )}
        </div>
        <div className="trigger-status-indicator">
          <span className="live-dot" />
        </div>
        <ChevronDown size={14} className={`trigger-chevron ${open ? 'rotated' : ''}`} />
      </button>

      {/* 展开的下拉弹窗 */}
      {open && (
        <div className="model-picker-dropdown" id={dropdownId} role="dialog" aria-label={`选择${label}`}>
          {/* 顶部搜索与控制栏 */}
          <div className="picker-header">
            <div className="picker-search-bar">
              <Search size={15} className="search-icon" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索模型名称、ID 或能力标签…"
                className="picker-search-input"
                aria-label="搜索模型"
              />
              {search && (
                <button
                  type="button"
                  className="icon-button-subtle"
                  onClick={() => setSearch('')}
                  aria-label="清空搜索"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {onRefresh && (
              <button
                type="button"
                className="picker-refresh-button"
                onClick={() => void onRefresh()}
                disabled={loading}
                title="刷新可用模型"
              >
                <AnimatedRefreshSvg size={14} spinning={loading} />
                <span>{loading ? '同步中' : '刷新'}</span>
              </button>
            )}
          </div>

          {/* 分类切换 Tab */}
          <div className="picker-tabs">
            {(
              [
                ['all', '全部模型', null],
                ['chat', '对话', 'chat'],
                ['image', '图像', 'image'],
                ['video', '视频', 'video'],
                ['music', '音乐', 'music'],
              ] as const
            ).map(([key, tabLabel, cat]) => {
              const count =
                key === 'all'
                  ? enrichedModels.length
                  : enrichedModels.filter(m => m.category === key).length;
              if (targetCategory && key !== 'all' && key !== targetCategory) {
                return null;
              }
              return (
                <button
                  key={key}
                  type="button"
                  className={`picker-tab ${activeTab === key ? 'active' : ''}`}
                  onClick={() => setActiveTab(key)}
                  aria-pressed={activeTab === key}
                >
                  {cat && getCategoryIcon(cat, 13, activeTab === key)}
                  <span>{tabLabel}</span>
                  <span className="tab-count">{count}</span>
                </button>
              );
            })}
          </div>

          {/* 模型卡片列表 */}
          <div className="picker-list">
            {loading ? <div className="picker-empty" role="status"><AnimatedRefreshSvg size={24} spinning /><p>正在获取可用模型…</p></div> : filteredModels.length > 0 ? (
              filteredModels.map(model => {
                const isSelected = model.id === value;
                return (
                  <button
                    key={model.id}
                    type="button"
                    className={`picker-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => selectModel(model.id)}
                    aria-pressed={isSelected}
                  >
                    <div className="item-icon-col">
                      <div className={`model-cat-badge ${model.category}`}>
                        {getCategoryIcon(model.category, 16, isSelected)}
                      </div>
                    </div>
                    <div className="item-main">
                      <div className="item-title-row">
                        <strong className="model-display-name">{model.name}</strong>
                        {isSelected && <span className="current-badge"><Check size={12} /> 当前使用</span>}
                        {model.isPopular && !isSelected && (
                          <span className="recommend-badge">推荐</span>
                        )}
                      </div>
                      <div className="item-sub-row">
                        <code className="model-id-code">{model.id}</code>
                        <div className="item-tags">
                          {model.tags.map(t => (
                            <span key={t} className="model-pill-tag">
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="picker-empty">
                <Sparkles size={24} className="empty-spark" />
                <p>{search ? `没有找到与「${search}」匹配的模型` : '暂时没有可用模型，请先连接服务。'}</p>
                <button
                  type="button"
                  className="secondary-button small"
                  onClick={() => setShowCustomInput(true)}
                >
                  <Plus size={13} /> 直接指定模型 ID
                </button>
              </div>
            )}
          </div>

          {/* 底部信息与自定义模型输入 */}
          <div className="picker-footer">
            <div className="picker-meta-info">
              <span className="online-indicator" />
              <span>{models.length ? `${models.length} 个可用模型 · 按能力选择` : '连接服务后即可选择模型'}</span>
            </div>

            {!showCustomInput ? (
              <button
                type="button"
                className="custom-model-link"
                onClick={() => setShowCustomInput(true)}
              >
                输入其他自定义模型 ID
              </button>
            ) : (
              <div className="custom-input-bar">
                <input
                  type="text"
                  placeholder="例如：gemini-3.8-flash"
                  value={customInput}
                  onChange={e => setCustomInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleApplyCustom();
                  }}
                  autoFocus
                  aria-label="自定义模型 ID"
                />
                <button
                  type="button"
                  className="primary-button small"
                  onClick={handleApplyCustom}
                >
                  应用
                </button>
                <button
                  type="button"
                  className="icon-button-subtle"
                  onClick={() => setShowCustomInput(false)}
                  aria-label="取消自定义模型"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
