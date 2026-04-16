import React from 'react';
import { UploadHistoryItem } from './UploadHistoryItem.jsx';

export function UploadHistoryList({ items, onUpdate, onDelete }) {
  return (
    <ul className="space-y-3">
      {items.map(item => (
        <li key={item.subtitle_id}>
          <UploadHistoryItem item={item} onUpdate={onUpdate} onDelete={onDelete} />
        </li>
      ))}
    </ul>
  );
}
