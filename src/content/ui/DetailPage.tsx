import React, { useState, useEffect } from 'react';
import { store } from '../../store';
import type { WorkitemDetail, WorkitemField } from '../../types';
import { workitemDetailService } from '../index';

interface Props {
  identifier: string;
  subject: string;
}

function getDisplayFields(detail: WorkitemDetail): WorkitemField[] {
  return detail.fields.filter(f =>
    f.displayValue &&
    f.identifier !== 'subject' &&
    f.className !== 'richText'
  );
}

export const DetailPage: React.FC<Props> = React.memo(({ identifier, subject }) => {
  const [detail, setDetail] = useState<WorkitemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await workitemDetailService.fetchDetail(identifier);
      setDetail(d);
    } catch {
      setError('获取详情失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [identifier]);

  const handleRetry = () => {
    workitemDetailService.clearDetail(identifier);
    fetchDetail();
  };

  const handleBack = () => {
    store.setState({ detailView: null });
  };

  const fields = detail ? getDisplayFields(detail) : [];

  return (
    <div className="dw-detail-page">
      <div className="dw-detail-header" data-drag-handle>
        <button className="dw-detail-back" onClick={handleBack} aria-label="返回">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div className="dw-detail-title-wrap">
          <span className="dw-detail-id">{identifier}</span>
          <span className="dw-detail-title">{subject}</span>
        </div>
      </div>

      <div className="dw-detail-content" data-no-drag>
        {loading && (
          <div className="dw-detail-status">
            <span className="dw-req-spinner" />
            <span>加载中...</span>
          </div>
        )}
        {error && (
          <div className="dw-detail-status error">
            <span>{error}</span>
            <button className="dw-req-retry" onClick={handleRetry}>重试</button>
          </div>
        )}
        {!loading && !error && fields.length === 0 && (
          <div className="dw-detail-status">暂无字段数据</div>
        )}
        {fields.length > 0 && (
          <div className="dw-detail-fields">
            {fields.map(field => (
              <div key={field.identifier} className="dw-detail-field">
                <span className="dw-detail-field-label">{field.displayName}</span>
                <span className="dw-detail-field-value">{field.displayValue}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
